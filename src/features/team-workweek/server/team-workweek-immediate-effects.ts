import type { GoogleWorkweekSeriesResult } from "./team-workweek-publication-core";

export type WorkweekGooglePayload = Readonly<{
  id: string;
  status?: "confirmed" | "cancelled";
  summary?: string;
  description?: string;
  transparency?: string;
  visibility?: string;
  reminders?: Readonly<{useDefault: boolean}>;
  start: Readonly<{ dateTime: string; timeZone: "Europe/Berlin" }>;
  end: Readonly<{ dateTime: string; timeZone: "Europe/Berlin" }>;
  recurrence?: readonly string[];
  extendedProperties: Readonly<{ private: Readonly<Record<string, string>> }>;
}>;

export type PreparedWorkweekEffect = Readonly<{
  id: string;
  calendarId: "primary";
  googleEventId: string;
  generation: number;
  kind?: string;
  operation?: "create" | "update" | "cancel";
  expectedPayload?: WorkweekGooglePayload | null;
  expectedEtag?: string | null;
  instanceOf?: string | null;
  originalStart?: string | null;
  payload: WorkweekGooglePayload;
  state: "pending" | "confirmed" | "cleaned";
  confirmedEtag: string | null;
  cleanupAt?: string;
  cleanupPayload?: WorkweekGooglePayload | null;
  cleanupDisposition?: "delete" | "preserve" | "retain" | "restore";
  cleanupParentId?: string | null;
  cleanupPreserved?: boolean;
  cleanupDeadline?: string;
}>;

type ObservedEvent = Partial<WorkweekGooglePayload> & { etag?: string };

function endpoint(effect: PreparedWorkweekEffect, collection = false) {
  const base = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  return collection ? `${base}?sendUpdates=none` : `${base}/${encodeURIComponent(effect.googleEventId)}`;
}

function matchesPayload(event: ObservedEvent | null, expected: WorkweekGooglePayload) {
  const properties = event?.extendedProperties?.private;
  return event?.id === expected.id && Boolean(event.etag?.trim())
    && Object.entries(expected.extendedProperties.private).every(([key, value]) => properties?.[key] === value)
    && properties?.founderopsWorkweekTransitionId === expected.extendedProperties.private.founderopsWorkweekTransitionId
    && (event.status || "confirmed") === (expected.status || "confirmed")
    && ["summary", "description", "transparency", "visibility"].every((key) => expected[key as keyof WorkweekGooglePayload] === undefined || event[key as keyof ObservedEvent] === expected[key as keyof WorkweekGooglePayload])
    && (!expected.reminders || event.reminders?.useDefault === expected.reminders.useDefault)
    && event.start?.timeZone === "Europe/Berlin" && event.end?.timeZone === "Europe/Berlin"
    && new Date(event.start.dateTime).getTime() === new Date(expected.start.dateTime).getTime()
    && new Date(event.end.dateTime).getTime() === new Date(expected.end.dateTime).getTime()
    && JSON.stringify(event.recurrence || []) === JSON.stringify(expected.recurrence || []);
}

function matchesEffect(event: ObservedEvent | null, effect: PreparedWorkweekEffect) {
  return matchesPayload(event, effect.payload);
}

function errorFor(response: Response): GoogleWorkweekSeriesResult {
  return { state: "delayed", errorClass: response.status === 401 || response.status === 403
    ? "oauth_reconnect_required" : "provider_unavailable" };
}

async function observe(fetchImpl: typeof fetch, accessToken: string, effect: PreparedWorkweekEffect, restoring = false) {
  try {
    const response = await fetchImpl(endpoint(effect), {
      headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404 || response.status === 410) return { state: "absent" as const };
    if (!response.ok) return errorFor(response);
    const event = await response.json().catch(() => null) as ObservedEvent | null;
    if (effect.cleanupPayload && matchesPayload(event,effect.cleanupPayload)) return {state:"cleaned" as const,etag:event!.etag!};
    if (matchesEffect(event, effect)) return { state: "confirmed" as const, etag: event!.etag! };
    if (effect.operation && effect.operation !== "create" && effect.expectedPayload && matchesPayload(event, effect.expectedPayload)
      && (restoring || event!.etag === effect.expectedEtag)) return { state: "baseline" as const, etag: event!.etag! };
    return { state: "delayed" as const, errorClass: "provider_identity_mismatch" as const };
  } catch {
    return { state: "delayed" as const, errorClass: "provider_unavailable" as const };
  }
}

export async function ensureGoogleWorkweekEffect({ accessToken, effect, fetchImpl = fetch, now = () => new Date() }: {
  accessToken: string; effect: PreparedWorkweekEffect; fetchImpl?: typeof fetch; now?: () => Date;
}): Promise<GoogleWorkweekSeriesResult> {
  const observed = await observe(fetchImpl, accessToken, effect);
  if (observed.state === "cleaned") return {state:"delayed",errorClass:"provider_identity_mismatch"};
  if (observed.state === "confirmed") return { ...observed, observedAt: now().toISOString() };
  if (observed.state === "delayed") return observed;
  const updating = effect.operation && effect.operation !== "create";
  if (updating && observed.state === "absent") return { state: "delayed", errorClass: "provider_identity_mismatch" };
  try {
    const response = await fetchImpl(updating ? `${endpoint(effect)}?sendUpdates=none` : endpoint(effect, true), {
      method: updating ? "PUT" : "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...(updating ? { "if-match": effect.expectedEtag! } : {}) },
      body: JSON.stringify(effect.payload), cache: "no-store", signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) {
      const event = await response.json().catch(() => null) as ObservedEvent | null;
      return matchesEffect(event, effect)
        ? { state: "confirmed", etag: event!.etag!, observedAt: now().toISOString() }
        : { state: "delayed", errorClass: "provider_identity_mismatch" };
    }
    if (response.status === 412) return {state:"delayed",errorClass:"provider_identity_mismatch"};
    if (response.status !== 409 && response.status < 500) return errorFor(response);
  } catch {
    // A lost response does not prove that Google rejected the immutable mutation.
  }
  const recovered = await observe(fetchImpl, accessToken, effect);
  return recovered.state === "confirmed" ? { ...recovered, observedAt: now().toISOString() }
    : recovered.state === "delayed" ? recovered : { state: "delayed", errorClass: "provider_unavailable" };
}

export async function cleanupGoogleWorkweekEffect({ accessToken, effect, fetchImpl = fetch, now = () => new Date() }: {
  accessToken: string; effect: PreparedWorkweekEffect; fetchImpl?: typeof fetch; now?: () => Date;
}): Promise<GoogleWorkweekSeriesResult & { preserved?: boolean }> {
  if (effect.cleanupDisposition) return cleanupPlannedEffect({accessToken,effect,fetchImpl,now});
  if (effect.instanceOf && !effect.expectedEtag) return {state:"confirmed",etag:"unbound",observedAt:now().toISOString()};
  const observed = await observe(fetchImpl, accessToken, effect, true);
  const updating = effect.operation && effect.operation !== "create";
  if (observed.state === "baseline") return {state:"confirmed",etag:observed.etag,observedAt:now().toISOString()};
  if (observed.state === "absent") return updating
    ? {state:"delayed",errorClass:"provider_identity_mismatch"}
    : { state: "confirmed", etag: "absent", observedAt: now().toISOString() };
  if (observed.state === "delayed") return observed;
  if (observed.state === "cleaned") return {state:"confirmed",etag:observed.etag,observedAt:now().toISOString()};
  try {
    const response = await fetchImpl(`${endpoint(effect)}?sendUpdates=none`, {
      method: updating ? "PUT" : "DELETE", headers: { authorization: `Bearer ${accessToken}`, "if-match": observed.etag,
        ...(updating ? {"content-type":"application/json"} : {}) },
      ...(updating ? {body:JSON.stringify({...effect.expectedPayload,status:"confirmed"})} : {}),
      cache: "no-store", signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) {
      if (!updating) return {state:"confirmed",etag:observed.etag,observedAt:now().toISOString()};
      const restored = await response.json().catch(()=>null) as ObservedEvent | null;
      return effect.expectedPayload && matchesPayload(restored,effect.expectedPayload)
        ? {state:"confirmed",etag:restored!.etag!,observedAt:now().toISOString()}
        : {state:"delayed",errorClass:"provider_identity_mismatch"};
    }
    if (!updating && (response.status === 404 || response.status === 410)) return {state:"confirmed",etag:observed.etag,observedAt:now().toISOString()};
    if (response.status === 412) return { state: "delayed", errorClass: "provider_identity_mismatch" };
    if (response.status < 500) return errorFor(response);
  } catch {
    // Observe before replaying a DELETE whose response was lost.
  }
  const recovered = await observe(fetchImpl, accessToken, effect, true);
  if (recovered.state === "baseline") return {state:"confirmed",etag:recovered.etag,observedAt:now().toISOString()};
  return !updating && recovered.state === "absent" ? { state: "confirmed", etag: "absent", observedAt: now().toISOString() }
    : recovered.state === "delayed" ? recovered : { state: "delayed", errorClass: "provider_unavailable" };
}

async function cleanupPlannedEffect({accessToken,effect,fetchImpl,now}:{accessToken:string;effect:PreparedWorkweekEffect;fetchImpl:typeof fetch;now:()=>Date}):Promise<GoogleWorkweekSeriesResult & {preserved?:boolean}> {
  if(effect.instanceOf && !effect.expectedEtag && effect.kind!=="cleanup_crossing")return {state:"confirmed",etag:"unbound",observedAt:now().toISOString(),preserved:false};
  const observed=await observe(fetchImpl,accessToken,effect,true);
  const preservation=effect.cleanupDisposition==="preserve" || effect.cleanupDisposition==="retain";
  const confirmed=(etag:string,preserved=preservation)=>({state:"confirmed" as const,etag,observedAt:now().toISOString(),preserved});
  if(observed.state==="cleaned") return confirmed(observed.etag);
  if(observed.state==="delayed") return observed;
  if(observed.state==="absent") return effect.operation && effect.operation!=="create"
    ? {state:"delayed",errorClass:"provider_identity_mismatch"} : confirmed("absent",false);
  if(effect.cleanupDisposition==="retain") return {state:"delayed",errorClass:"provider_identity_mismatch"};
  if(observed.state==="baseline" && !(effect.kind==="cleanup_crossing" && observed.etag===effect.expectedEtag)) return effect.cleanupDisposition==="restore"
    ? confirmed(observed.etag,false) : {state:"delayed",errorClass:"provider_identity_mismatch"};
  if(effect.cleanupDeadline && now().getTime()>=Date.parse(effect.cleanupDeadline))return {state:"delayed",errorClass:"provider_identity_mismatch"};
  // A persisted future-only decision cannot delete an occurrence that has since started.
  if(effect.cleanupDisposition==="delete" && now().getTime()>=new Date(effect.payload.start.dateTime).getTime()) return {state:"delayed",errorClass:"provider_identity_mismatch"};
  const deleting=effect.cleanupDisposition==="delete";
  try {
    const response=await fetchImpl(`${endpoint(effect)}?sendUpdates=none`,{method:deleting?"DELETE":"PUT",headers:{authorization:`Bearer ${accessToken}`,"if-match":observed.etag,...(!deleting?{"content-type":"application/json"}:{})},...(!deleting?{body:JSON.stringify(effect.cleanupPayload)}:{}),cache:"no-store",signal:AbortSignal.timeout(8_000)});
    if(response.ok){
      if(deleting)return confirmed(observed.etag,false);
      const event=await response.json().catch(()=>null) as ObservedEvent|null;
      return effect.cleanupPayload && matchesPayload(event,effect.cleanupPayload) ? confirmed(event!.etag!) : {state:"delayed",errorClass:"provider_identity_mismatch"};
    }
    if(deleting && (response.status===404 || response.status===410))return confirmed("absent",false);
    if(response.status===412)return {state:"delayed",errorClass:"provider_identity_mismatch"};
    if(response.status<500)return errorFor(response);
  }catch{/* Re-observe the exact persisted cleanup target after an uncertain response. */}
  const recovered=await observe(fetchImpl,accessToken,effect,true);
  if(recovered.state==="cleaned")return confirmed(recovered.etag);
  if(deleting && recovered.state==="absent")return confirmed("absent",false);
  if(effect.cleanupDisposition==="restore" && recovered.state==="baseline")return confirmed(recovered.etag,false);
  return recovered.state==="delayed"?recovered:{state:"delayed",errorClass:"provider_unavailable"};
}

export async function discoverGoogleWorkweekInstance({accessToken,effect,fetchImpl=fetch}: {
  accessToken:string; effect:PreparedWorkweekEffect; fetchImpl?:typeof fetch;
}): Promise<Readonly<{state:"observed";eventId:string;etag:string;originalPayload:WorkweekGooglePayload}> | Extract<GoogleWorkweekSeriesResult,{state:"delayed"}>> {
  if (!effect.instanceOf || !effect.originalStart || !effect.expectedPayload) return {state:"delayed",errorClass:"provider_identity_mismatch"};
  const url=new URL(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(effect.instanceOf)}/instances`);
  url.searchParams.set("originalStart",effect.originalStart);url.searchParams.set("showDeleted","true");url.searchParams.set("maxResults","10");
  try {
    const response=await fetchImpl(url,{headers:{authorization:`Bearer ${accessToken}`},cache:"no-store",signal:AbortSignal.timeout(8_000)});
    if (!response.ok) return {state:"delayed",errorClass:response.status===401||response.status===403?"oauth_reconnect_required":"provider_unavailable"};
    const body=await response.json() as {items?:Array<ObservedEvent & {recurringEventId?:string;originalStartTime?:{dateTime?:string}}>};
    const instance=(body.items||[]).find(item=>item.recurringEventId===effect.instanceOf && new Date(item.originalStartTime?.dateTime||"").getTime()===new Date(effect.originalStart!).getTime());
    if (!instance?.id || !matchesPayload(instance,{...effect.expectedPayload,id:instance.id})) return {state:"delayed",errorClass:"provider_identity_mismatch"};
    const originalPayload:WorkweekGooglePayload={id:instance.id,start:instance.start!,end:instance.end!,extendedProperties:instance.extendedProperties!,
      ...(instance.summary!==undefined?{summary:instance.summary}:{}),...(instance.description!==undefined?{description:instance.description}:{}),
      ...(instance.transparency!==undefined?{transparency:instance.transparency}:{}),...(instance.visibility!==undefined?{visibility:instance.visibility}:{}),
      ...(instance.reminders?{reminders:{useDefault:instance.reminders.useDefault}}:{}),...(instance.status?{status:instance.status}:{})};
    return {state:"observed",eventId:instance.id,etag:instance.etag!,originalPayload};
  } catch {return {state:"delayed",errorClass:"provider_unavailable"};}
}
