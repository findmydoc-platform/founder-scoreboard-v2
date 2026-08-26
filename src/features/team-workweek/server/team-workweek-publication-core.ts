export const FOUNDEROPS_WORKWEEK_PROPERTY_KEY = "founderopsWorkweekSeriesId";

export type PreparedWorkweekSeries = Readonly<{
  id: string;
  calendarId: "primary";
  googleEventId: string;
  state: "pending" | "confirmed";
  confirmedEtag: string | null;
  weekday: number;
  startMinute: number;
  endMinute: number;
}>;

export type PreparedWorkweekPublication = Readonly<{
  id: string;
  sourceVersionId: string;
  ownerProfileId: string;
  effectiveFrom: string;
  timezone: "Europe/Berlin";
  status: "preparing" | "published";
  syncState: "pending" | "confirmed";
  publicationRevision: number;
  publishedAt: string | null;
  lastSyncAt: string | null;
  series: PreparedWorkweekSeries[];
}>;

export type GoogleWorkweekSeriesResult =
  | Readonly<{ state: "confirmed"; etag: string; observedAt: string }>
  | Readonly<{
    state: "delayed";
    errorClass: "provider_unavailable" | "provider_identity_mismatch" | "oauth_reconnect_required";
  }>;

export type GoogleWorkweekRecovery = "retry" | "reconnect" | "identity_conflict";

export function googleWorkweekRecovery(
  errorClass: Extract<GoogleWorkweekSeriesResult, { state: "delayed" }>["errorClass"],
): GoogleWorkweekRecovery {
  if (errorClass === "oauth_reconnect_required") return "reconnect";
  if (errorClass === "provider_identity_mismatch") return "identity_conflict";
  return "retry";
}

type GoogleCalendarEvent = Readonly<{
  id?: unknown;
  etag?: unknown;
  extendedProperties?: Readonly<{ private?: Readonly<Record<string, unknown>> }>;
}>;

function dateForWeekday(monday: string, weekday: number) {
  const date = new Date(`${monday}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + weekday - 1);
  return date.toISOString().slice(0, 10);
}

function clockForMinute(value: number) {
  const hour = Math.floor(value / 60).toString().padStart(2, "0");
  const minute = (value % 60).toString().padStart(2, "0");
  return `${hour}:${minute}:00`;
}

export function googleWorkweekSeriesEvent(
  publication: Pick<PreparedWorkweekPublication, "effectiveFrom" | "timezone" | "publicationRevision">,
  series: PreparedWorkweekSeries,
) {
  const date = dateForWeekday(publication.effectiveFrom, series.weekday);
  return {
    id: series.googleEventId,
    summary: "Arbeitszeit",
    description: "Mit FounderOps synchronisiert",
    start: {
      dateTime: `${date}T${clockForMinute(series.startMinute)}`,
      timeZone: publication.timezone,
    },
    end: {
      dateTime: `${date}T${clockForMinute(series.endMinute)}`,
      timeZone: publication.timezone,
    },
    recurrence: ["RRULE:FREQ=WEEKLY"],
    transparency: "transparent",
    visibility: "private",
    reminders: { useDefault: false },
    extendedProperties: {
      private: {
        [FOUNDEROPS_WORKWEEK_PROPERTY_KEY]: series.id,
        founderopsWorkweekRevision: String(publication.publicationRevision),
      },
    },
  } as const;
}

function eventEndpoint(series: PreparedWorkweekSeries) {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(series.calendarId)}/events/${encodeURIComponent(series.googleEventId)}`;
}

function collectionEndpoint(series: PreparedWorkweekSeries) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(series.calendarId)}/events`);
  url.searchParams.set("sendUpdates", "none");
  return url.toString();
}

async function readEvent(response: Response) {
  return await response.json().catch(() => null) as GoogleCalendarEvent | null;
}

function confirmedEvent(
  event: GoogleCalendarEvent | null,
  publication: Pick<PreparedWorkweekPublication, "publicationRevision">,
  series: PreparedWorkweekSeries,
) {
  const etag = typeof event?.etag === "string" ? event.etag.trim() : "";
  const marker = event?.extendedProperties?.private?.[FOUNDEROPS_WORKWEEK_PROPERTY_KEY];
  const revision = event?.extendedProperties?.private?.founderopsWorkweekRevision;
  return event?.id === series.googleEventId
    && marker === series.id
    && revision === String(publication.publicationRevision)
    && etag
    ? { etag }
    : null;
}

async function observeSeries(
  fetchImpl: typeof fetch,
  accessToken: string,
  publication: Pick<PreparedWorkweekPublication, "publicationRevision">,
  series: PreparedWorkweekSeries,
) {
  try {
    const response = await fetchImpl(eventEndpoint(series), {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (response.status === 404) return { state: "absent" as const };
    if (response.status === 401 || response.status === 403) {
      return { state: "delayed" as const, errorClass: "oauth_reconnect_required" as const };
    }
    if (!response.ok) return { state: "delayed" as const, errorClass: "provider_unavailable" as const };
    const confirmation = confirmedEvent(await readEvent(response), publication, series);
    return confirmation
      ? { state: "confirmed" as const, etag: confirmation.etag }
      : { state: "delayed" as const, errorClass: "provider_identity_mismatch" as const };
  } catch {
    return { state: "delayed" as const, errorClass: "provider_unavailable" as const };
  }
}

export async function ensureGoogleWorkweekSeries({
  accessToken,
  fetchImpl = fetch,
  now = () => new Date(),
  publication,
  series,
}: {
  accessToken: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  publication: PreparedWorkweekPublication;
  series: PreparedWorkweekSeries;
}): Promise<GoogleWorkweekSeriesResult> {
  const observed = await observeSeries(fetchImpl, accessToken, publication, series);
  if (observed.state === "confirmed") {
    return { state: "confirmed", etag: observed.etag, observedAt: now().toISOString() };
  }
  if (observed.state === "delayed") return observed;

  let response: Response;
  try {
    response = await fetchImpl(collectionEndpoint(series), {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(googleWorkweekSeriesEvent(publication, series)),
      cache: "no-store",
    });
  } catch {
    const recovered = await observeSeries(fetchImpl, accessToken, publication, series);
    return recovered.state === "confirmed"
      ? { state: "confirmed", etag: recovered.etag, observedAt: now().toISOString() }
      : recovered.state === "delayed"
        ? recovered
        : { state: "delayed", errorClass: "provider_unavailable" };
  }

  if (response.ok) {
    const confirmation = confirmedEvent(await readEvent(response), publication, series);
    return confirmation
      ? { state: "confirmed", etag: confirmation.etag, observedAt: now().toISOString() }
      : { state: "delayed", errorClass: "provider_identity_mismatch" };
  }
  if (response.status === 401 || response.status === 403) {
    return { state: "delayed", errorClass: "oauth_reconnect_required" };
  }
  if (response.status === 409 || response.status >= 500) {
    const recovered = await observeSeries(fetchImpl, accessToken, publication, series);
    if (recovered.state === "confirmed") {
      return { state: "confirmed", etag: recovered.etag, observedAt: now().toISOString() };
    }
    if (response.status === 409 && recovered.state === "absent") {
      return { state: "delayed", errorClass: "provider_identity_mismatch" };
    }
    return recovered.state === "delayed"
      ? recovered
      : { state: "delayed", errorClass: "provider_unavailable" };
  }
  return { state: "delayed", errorClass: "provider_unavailable" };
}
