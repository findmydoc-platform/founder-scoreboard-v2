import type { GoogleCalendarCapability } from "@/lib/credentials";
import { berlinCivilInstant, calendarWindowsForDate } from "../model/team-workweek-calendar";
import { inflatePublishedTeamWorkweekWindows } from "../model/team-workweek-draft";
import type { WorkweekGooglePayload } from "./team-workweek-immediate-effects";

export type KnownGoogleWorkweekWindow = Readonly<{ id: string; weekday: number; startMinute: number; endMinute: number }>;

export type KnownGoogleWorkweekSeries = Readonly<{
  projectionPart?: string;
  logicalSources?: KnownGoogleWorkweekWindow[];
  intendedPayload?: WorkweekGooglePayload;
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
  observedPayload?: WorkweekGooglePayload;
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
    observations?: GoogleWorkweekObservation[];
    appRestoreSupported?: boolean;
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
  url.searchParams.set("fields", series.intendedPayload ? `${EVENT_FIELDS},summary,description,transparency,visibility,reminders` : EVENT_FIELDS);
  return url.toString();
}

function observedAt(now: () => Date) {
  return now().toISOString();
}

async function waitForRetry(attempt: number) {
  await new Promise((resolve) => setTimeout(resolve, attempt * 200));
}

async function readKnownEvent({
  fetchImpl,
  maxAttempts,
  now,
  series,
  wait,
}: {
  fetchImpl: GoogleCalendarCapability["request"];
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
        headers: { },
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
    && privateProperties?.founderopsWorkweekRevision === String(series.confirmedFounderopsRevision)
    && (!series.intendedPayload || Object.entries(series.intendedPayload.extendedProperties.private)
      .every(([key, value]) => privateProperties?.[key] === value));
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
  const civil=berlinEventClock(value);
  return civil?{date:civil.date,minute:civil.minute}:null;
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
  fetchImpl = accessToken.request,
  maxAttempts = 3,
  now = () => new Date(),
  series,
  logicalWindows,
  verifyKnownPayloads = false,
  wait = waitForRetry,
}: {
  accessToken: GoogleCalendarCapability;
  fetchImpl?: GoogleCalendarCapability["request"];
  maxAttempts?: number;
  now?: () => Date;
  series: KnownGoogleWorkweekSeries[];
  logicalWindows?: KnownGoogleWorkweekWindow[];
  verifyKnownPayloads?: boolean;
  wait?: (attempt: number) => Promise<void>;
}): Promise<GoogleWorkweekReconciliationResult> {
  const timestamp = observedAt(now);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    return { state: "conflict", errorClass: "invalid_series", observedAt: timestamp };
  }
  if (logicalWindows || series.some((known) => known.intendedPayload)) {
    return observePhysicalProjection({ accessToken, fetchImpl, maxAttempts, now, series, logicalWindows, wait,verifyKnownPayloads });
  }
  const observations: GoogleWorkweekObservation[] = [];
  const windows: Array<Readonly<{ weekday: number; startMinute: number; endMinute: number }>> = [];

  for (const known of series) {
    const result = await readKnownEvent({ fetchImpl, maxAttempts, now, series: known, wait });
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

function recurrenceKey(value: unknown) {
  if (!Array.isArray(value) || value.length !== 1 || typeof value[0] !== "string" || !value[0].startsWith("RRULE:")) return null;
  return value[0].slice(6).toUpperCase().split(";").sort().join(";");
}

function berlinEventClock(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const input = value as {dateTime?: unknown; timeZone?: unknown; date?: unknown};
  if (typeof input.dateTime !== "string" || input.timeZone !== "Europe/Berlin" || input.date !== undefined) return null;
  const instant = new Date(input.dateTime);
  if (!Number.isFinite(instant.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(instant).map(part=>[part.type,part.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,minute:Number(parts.hour)*60+Number(parts.minute),instant:instant.getTime()};
}

function samePhysicalSchedule(event: GoogleCalendarEvent, payload: WorkweekGooglePayload) {
  const start=berlinEventClock(event.start), end=berlinEventClock(event.end);
  return start && end && start.instant===new Date(payload.start.dateTime).getTime()
    && end.instant===new Date(payload.end.dateTime).getTime() && recurrenceKey(event.recurrence)===recurrenceKey(payload.recurrence);
}

async function observePhysicalProjection({fetchImpl,maxAttempts,now,series,logicalWindows,wait,verifyKnownPayloads}: {
  accessToken:GoogleCalendarCapability;fetchImpl:GoogleCalendarCapability["request"];maxAttempts:number;now:()=>Date;series:KnownGoogleWorkweekSeries[];
  logicalWindows?:KnownGoogleWorkweekWindow[];wait:(attempt:number)=>Promise<void>;
  verifyKnownPayloads:boolean;
}): Promise<GoogleWorkweekReconciliationResult> {
  const timestamp=observedAt(now);
  const sources=new Map<string,KnownGoogleWorkweekWindow>();
  for(const source of logicalWindows || series.flatMap(known=>known.logicalSources || [{id:known.id,weekday:known.weekday,startMinute:known.startMinute,endMinute:known.endMinute}])) sources.set(source.id,source);
  const events=new Map<string,GoogleCalendarEvent|null>();
  const observations:GoogleWorkweekObservation[]=[];
  for(const known of series){
    const result=await readKnownEvent({fetchImpl,maxAttempts,now,series:known,wait});
    if(result.state==="delayed") return result;
    const event=result.state==="deleted"?null:result.event;
    if(event && (event.status==="cancelled" ? event.id!==known.googleEventId || event.recurringEventId!==undefined : !eventIdentityMatches(event,known))) return {state:"conflict",errorClass:"provider_identity_mismatch",observedAt:timestamp};
    const deleted=!event || event.status==="cancelled";
    const etag=typeof event?.etag==="string"?event.etag.trim():"";
    if(!deleted && (event.status!=="confirmed" || !etag || event.recurringEventId!==undefined || event.originalStartTime!==undefined)) return {state:"conflict",errorClass:"provider_identity_mismatch",observedAt:timestamp};
    events.set(known.id,deleted?null:event);
    observations.push({seriesId:known.id,priorEtag:known.confirmedEtag,observedEtag:etag || known.confirmedEtag,
      founderopsRevision:known.confirmedFounderopsRevision,providerState:deleted?"deleted":"active",
      ...(!deleted?{observedPayload:event as WorkweekGooglePayload}:{})});
  }
  const conflict=():Extract<GoogleWorkweekReconciliationResult,{state:"conflict"}>=>({state:"conflict",errorClass:"invalid_series",observedAt:timestamp,observations,
    appRestoreSupported:series.every(known=>{const event=events.get(known.id);const start=berlinEventClock(event?.start),end=berlinEventClock(event?.end);return !event || Boolean(start && end && end.instant>start.instant && recurrenceKey(event.recurrence) && known.intendedPayload && recurrenceKey(event.recurrence)?.replace(/;(COUNT|UNTIL)=[^;]+/g,"")===recurrenceKey(known.intendedPayload.recurrence)?.replace(/;(COUNT|UNTIL)=[^;]+/g,"") && (samePhysicalSchedule(event,known.intendedPayload) || !String((event.recurrence as string[])[0]).includes("COUNT=")));})});
  if(verifyKnownPayloads){
    for(const known of series){
      const event=events.get(known.id),expected=known.intendedPayload;
      if(!event && expected?.status==="cancelled")continue;
      if(!event || !expected || expected.status==="cancelled" || !samePhysicalSchedule(event,expected))return {...conflict(),appRestoreSupported:series.every(item=>{
        const physical=events.get(item.id),intended=item.intendedPayload;
        return !physical || Boolean(intended && intended.status!=="cancelled" && samePhysicalSchedule(physical,intended));
      })};
    }
    return {state:"unchanged",observations,observedAt:timestamp};
  }
  const candidates=new Map(sources);
  for(const source of sources.values()){
    const parts=series.filter(known=>(known.logicalSources || [{id:known.id}]).some(item=>item.id===source.id));
    if(!parts.length) continue;
    const active=parts.filter(known=>events.get(known.id));
    if(!active.length){candidates.delete(source.id);continue;}
    if(active.length!==parts.length) return conflict();
    let inferred:KnownGoogleWorkweekWindow|null=null;
    for(const known of active){
      const event=events.get(known.id)!;
      if(known.intendedPayload && samePhysicalSchedule(event,known.intendedPayload)) continue;
      if((known.logicalSources?.length || 1)!==1 || known.projectionPart==="spring") continue;
      const start=berlinEventClock(event.start),end=berlinEventClock(event.end);
      if(!start || !end || start.date!==end.date || start.minute>=end.minute || !recurrenceKey(event.recurrence)
        || (known.intendedPayload && recurrenceKey(event.recurrence)!==recurrenceKey(known.intendedPayload.recurrence))) return conflict();
      const weekday=weekdayForDate(start.date);
      if(!weekday || (known.projectionPart && known.projectionPart!=="weekly" && known.projectionPart!=="legacy" && weekday!==7)) return conflict();
      const next={id:source.id,weekday,startMinute:start.minute,endMinute:end.minute};
      if(inferred && !sameWindows([inferred],[next])) return conflict();
      inferred=next;
    }
    if(inferred) candidates.set(source.id,inferred);
  }
  for(const known of series){
    const event=events.get(known.id);
    if(!event) continue;
    const start=berlinEventClock(event.start),end=berlinEventClock(event.end);
    if(!start || !end || (known.intendedPayload && recurrenceKey(event.recurrence)!==recurrenceKey(known.intendedPayload.recurrence))) return conflict();
    const group=(known.logicalSources || [{id:known.id}]).map(source=>candidates.get(source.id)).filter((source):source is KnownGoogleWorkweekWindow=>Boolean(source));
    if(known.intendedPayload && samePhysicalSchedule(event,known.intendedPayload)
      && group.every(source=>{const baseline=sources.get(source.id);return baseline && sameWindows([source],[baseline]);}))continue;
    const windows=inflatePublishedTeamWorkweekWindows(group);
    const projected=calendarWindowsForDate({id:known.id,ownerProfileId:"managed",effectiveFrom:start.date,effectiveTo:null,timezone:"Europe/Berlin",publicationRevision:1,lastSyncAt:timestamp,windows},start.date);
    if(projected.length!==1) return conflict();
    const projectedStart=projected[0].startsAt?Date.parse(projected[0].startsAt):berlinCivilInstant(start.date,projected[0].start);
    const projectedEnd=projected[0].endsAt?Date.parse(projected[0].endsAt):berlinCivilInstant(start.date,projected[0].end);
    if(start.instant!==projectedStart || end.instant!==projectedEnd) return conflict();
  }
  const current=canonicalWindows([...sources.values()]);
  const next=canonicalWindows([...candidates.values()]);
  if(!validWindows(next)) return { ...conflict(),errorClass:"invalid_windows" } as GoogleWorkweekReconciliationResult;
  return sameWindows(current,next)?{state:"unchanged",observations,observedAt:timestamp}:{state:"changed",observations,windows:next.map(({weekday,startMinute,endMinute})=>({weekday,startMinute,endMinute})),observedAt:timestamp};
}
