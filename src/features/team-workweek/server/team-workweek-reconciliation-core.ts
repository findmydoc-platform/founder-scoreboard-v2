export type KnownGoogleWorkweekSeries = Readonly<{
  id: string;
  calendarId: "primary";
  googleEventId: string;
  confirmedEtag: string;
  confirmedFounderopsRevision: number;
  weekday: number;
  startMinute: number;
  endMinute: number;
}>;

export type GoogleWorkweekObservation = Readonly<{
  seriesId: string;
  priorEtag: string;
  observedEtag: string;
  founderopsRevision: number;
  providerState: "active" | "deleted";
}>;

export type GoogleWorkweekReconciliationResult =
  | Readonly<{
    state: "unchanged";
    observations: GoogleWorkweekObservation[];
    observedAt: string;
  }>
  | Readonly<{
    state: "changed";
    observations: GoogleWorkweekObservation[];
    windows: Array<Readonly<{ weekday: number; startMinute: number; endMinute: number }>>;
    observedAt: string;
  }>
  | Readonly<{
    state: "conflict";
    errorClass: "provider_identity_mismatch" | "invalid_series" | "invalid_windows";
    observedAt: string;
  }>
  | Readonly<{
    state: "delayed";
    errorClass: "provider_unavailable" | "quota_exceeded" | "oauth_reconnect_required";
    observedAt: string;
  }>;

type GoogleCalendarEvent = Readonly<{
  id?: unknown;
  etag?: unknown;
  status?: unknown;
  start?: unknown;
  end?: unknown;
  recurrence?: unknown;
  recurringEventId?: unknown;
  originalStartTime?: unknown;
  extendedProperties?: Readonly<{ private?: Readonly<Record<string, unknown>> }>;
}>;

type EventReadResult =
  | Readonly<{ state: "found"; event: GoogleCalendarEvent }>
  | Readonly<{ state: "deleted" }>
  | Extract<GoogleWorkweekReconciliationResult, { state: "delayed" }>;

const EVENT_FIELDS = [
  "id",
  "etag",
  "status",
  "start(date,dateTime,timeZone)",
  "end(date,dateTime,timeZone)",
  "recurrence",
  "recurringEventId",
  "originalStartTime",
  "extendedProperties/private",
].join(",");

function eventEndpoint(series: KnownGoogleWorkweekSeries) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(series.calendarId)}/events/${encodeURIComponent(series.googleEventId)}`);
  url.searchParams.set("fields", EVENT_FIELDS);
  return url.toString();
}

function observedAt(now: () => Date) {
  return now().toISOString();
}

async function waitForRetry(attempt: number) {
  await new Promise((resolve) => setTimeout(resolve, attempt * 200));
}

async function readKnownEvent({
  accessToken,
  fetchImpl,
  maxAttempts,
  now,
  series,
  wait,
}: {
  accessToken: string;
  fetchImpl: typeof fetch;
  maxAttempts: number;
  now: () => Date;
  series: KnownGoogleWorkweekSeries;
  wait: (attempt: number) => Promise<void>;
}): Promise<EventReadResult> {
  let lastErrorClass: "provider_unavailable" | "quota_exceeded" = "provider_unavailable";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(eventEndpoint(series), {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
    } catch {
      lastErrorClass = "provider_unavailable";
      if (attempt < maxAttempts) await wait(attempt);
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      return { state: "delayed", errorClass: "oauth_reconnect_required", observedAt: observedAt(now) };
    }
    if (response.status === 404 || response.status === 410) return { state: "deleted" };
    if (response.status === 429 || response.status >= 500) {
      lastErrorClass = response.status === 429 ? "quota_exceeded" : "provider_unavailable";
      if (attempt < maxAttempts) await wait(attempt);
      continue;
    }
    if (!response.ok) {
      return { state: "delayed", errorClass: "provider_unavailable", observedAt: observedAt(now) };
    }
    const event = await response.json().catch(() => null) as GoogleCalendarEvent | null;
    return event ? { state: "found", event } : {
      state: "delayed",
      errorClass: "provider_unavailable",
      observedAt: observedAt(now),
    };
  }
  return { state: "delayed", errorClass: lastErrorClass, observedAt: observedAt(now) };
}

function eventIdentityMatches(event: GoogleCalendarEvent, series: KnownGoogleWorkweekSeries) {
  const privateProperties = event.extendedProperties?.private;
  return event.id === series.googleEventId
    && privateProperties?.founderopsWorkweekSeriesId === series.id
    && privateProperties?.founderopsWorkweekRevision === String(series.confirmedFounderopsRevision);
}

function localDateTime(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (input.timeZone !== "Europe/Berlin" || typeof input.dateTime !== "string" || input.date !== undefined) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(input.dateTime);
  if (!match) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  return { date: match[1], minute: hour * 60 + minute };
}

const recurrenceWeekdays = ["", "MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

function weeklyRecurrence(value: unknown, weekday: number) {
  if (!Array.isArray(value) || value.length !== 1 || typeof value[0] !== "string") return false;
  const recurrence = value[0].toUpperCase();
  if (!recurrence.startsWith("RRULE:")) return false;
  const entries = recurrence.slice(6).split(";").map((entry) => entry.split("=", 2));
  if (entries.some(([key, entryValue]) => !key || !entryValue)) return false;
  const rules = new Map(entries as Array<[string, string]>);
  if (rules.size !== entries.length || rules.get("FREQ") !== "WEEKLY") return false;
  if (rules.has("INTERVAL") && rules.get("INTERVAL") !== "1") return false;
  if (rules.has("WKST") && rules.get("WKST") !== "MO") return false;
  if (rules.has("BYDAY") && rules.get("BYDAY") !== recurrenceWeekdays[weekday]) return false;
  return [...rules.keys()].every((key) => key === "FREQ" || key === "INTERVAL" || key === "WKST" || key === "BYDAY");
}

function weekdayForDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date.getUTCDay() || 7;
}

function eventWindow(event: GoogleCalendarEvent) {
  if (event.recurringEventId !== undefined || event.originalStartTime !== undefined) return null;
  const start = localDateTime(event.start);
  const end = localDateTime(event.end);
  if (!start || !end || start.date !== end.date || start.minute >= end.minute) return null;
  const weekday = weekdayForDate(start.date);
  return weekday && weeklyRecurrence(event.recurrence, weekday)
    ? { weekday, startMinute: start.minute, endMinute: end.minute }
    : null;
}

function canonicalWindows(windows: Array<Readonly<{ weekday: number; startMinute: number; endMinute: number }>>) {
  return [...windows].sort((left, right) => (
    left.weekday - right.weekday
    || left.startMinute - right.startMinute
    || left.endMinute - right.endMinute
  ));
}

function validWindows(windows: ReturnType<typeof canonicalWindows>) {
  if (windows.length > 84) return false;
  const perDay = new Map<number, number>();
  for (let index = 0; index < windows.length; index += 1) {
    const window = windows[index];
    if (!Number.isInteger(window.weekday) || window.weekday < 1 || window.weekday > 7
      || !Number.isInteger(window.startMinute) || window.startMinute < 0 || window.startMinute > 1438
      || !Number.isInteger(window.endMinute) || window.endMinute < 1 || window.endMinute > 1439
      || window.startMinute >= window.endMinute) return false;
    const count = (perDay.get(window.weekday) || 0) + 1;
    if (count > 12) return false;
    perDay.set(window.weekday, count);
    const previous = windows[index - 1];
    if (previous?.weekday === window.weekday && previous.endMinute > window.startMinute) return false;
  }
  return true;
}

function sameWindows(
  left: ReturnType<typeof canonicalWindows>,
  right: ReturnType<typeof canonicalWindows>,
) {
  return left.length === right.length && left.every((window, index) => (
    window.weekday === right[index]?.weekday
    && window.startMinute === right[index]?.startMinute
    && window.endMinute === right[index]?.endMinute
  ));
}

export async function observeGoogleWorkweek({
  accessToken,
  fetchImpl = fetch,
  maxAttempts = 3,
  now = () => new Date(),
  series,
  wait = waitForRetry,
}: {
  accessToken: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  now?: () => Date;
  series: KnownGoogleWorkweekSeries[];
  wait?: (attempt: number) => Promise<void>;
}): Promise<GoogleWorkweekReconciliationResult> {
  const timestamp = observedAt(now);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    return { state: "conflict", errorClass: "invalid_series", observedAt: timestamp };
  }
  const observations: GoogleWorkweekObservation[] = [];
  const windows: Array<Readonly<{ weekday: number; startMinute: number; endMinute: number }>> = [];

  for (const known of series) {
    const result = await readKnownEvent({ accessToken, fetchImpl, maxAttempts, now, series: known, wait });
    if (result.state === "delayed") return result;
    if (result.state === "deleted") {
      observations.push({
        seriesId: known.id,
        priorEtag: known.confirmedEtag,
        observedEtag: known.confirmedEtag,
        founderopsRevision: known.confirmedFounderopsRevision,
        providerState: "deleted",
      });
      continue;
    }

    const event = result.event;
    if (event.status === "cancelled" && event.recurringEventId === undefined) {
      observations.push({
        seriesId: known.id,
        priorEtag: known.confirmedEtag,
        observedEtag: known.confirmedEtag,
        founderopsRevision: known.confirmedFounderopsRevision,
        providerState: "deleted",
      });
      continue;
    }
    const etag = typeof event.etag === "string" ? event.etag.trim() : "";
    if (event.status !== "confirmed" || !etag || !eventIdentityMatches(event, known)) {
      return { state: "conflict", errorClass: "provider_identity_mismatch", observedAt: timestamp };
    }
    const nextWindow = etag === known.confirmedEtag
      ? { weekday: known.weekday, startMinute: known.startMinute, endMinute: known.endMinute }
      : eventWindow(event);
    if (!nextWindow) return { state: "conflict", errorClass: "invalid_series", observedAt: timestamp };
    observations.push({
      seriesId: known.id,
      priorEtag: known.confirmedEtag,
      observedEtag: etag,
      founderopsRevision: known.confirmedFounderopsRevision,
      providerState: "active",
    });
    windows.push(nextWindow);
  }

  const currentWindows = canonicalWindows(series.map((known) => ({
    weekday: known.weekday,
    startMinute: known.startMinute,
    endMinute: known.endMinute,
  })));
  const nextWindows = canonicalWindows(windows);
  if (!validWindows(nextWindows)) {
    return { state: "conflict", errorClass: "invalid_windows", observedAt: timestamp };
  }
  if (sameWindows(currentWindows, nextWindows)) {
    return { state: "unchanged", observations, observedAt: timestamp };
  }
  return { state: "changed", observations, windows: nextWindows, observedAt: timestamp };
}
