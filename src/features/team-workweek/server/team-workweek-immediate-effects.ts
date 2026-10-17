import type { GoogleCalendarCapability } from "@/lib/credentials";
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

export type WorkweekProviderWriteJournal = Readonly<{
  beforeWrite: () => Promise<void>;
  outcome: (state: "settled" | "uncertain") => Promise<void>;
}>;

async function mutate(fetchImpl: GoogleCalendarCapability["request"], url: string, init: RequestInit, journal?: WorkweekProviderWriteJournal) {
  await journal?.beforeWrite();
  try {
    const response = await fetchImpl(url, init);
    await journal?.outcome(response.status < 500 ? "settled" : "uncertain");
    return response;
  } catch (error) {
    await journal?.outcome("uncertain");
    throw error;
  }
}

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

async function observe(fetchImpl: GoogleCalendarCapability["request"], accessToken: GoogleCalendarCapability, effect: PreparedWorkweekEffect, restoring = false, cancellationFence = false) {
  try {
    const response = await fetchImpl(endpoint(effect), {
      headers: { }, cache: "no-store", signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404 || response.status === 410) return { state: "absent" as const };
    if (!response.ok) return errorFor(response);
    const event = await response.json().catch(() => null) as ObservedEvent | null;
    if (event?.id === effect.googleEventId && event.status === "cancelled" && effect.operation === "create") {
      if (cancellationFence && event.etag) return {state:"confirmed" as const,etag:event.etag};
      if (restoring) return {state:"absent" as const};
    }
    if (effect.cleanupPayload && matchesPayload(event,effect.cleanupPayload)) return {state:"cleaned" as const,etag:event!.etag!};
    if (matchesEffect(event, effect)) return { state: "confirmed" as const, etag: event!.etag! };
    if (effect.operation && effect.operation !== "create" && effect.expectedPayload && matchesPayload(event, effect.expectedPayload)
      && (restoring || event!.etag === effect.expectedEtag)) return { state: "baseline" as const, etag: event!.etag! };
    return { state: "delayed" as const, errorClass: "provider_identity_mismatch" as const };
  } catch {
    return { state: "delayed" as const, errorClass: "provider_unavailable" as const };
  }
}

export async function ensureGoogleWorkweekEffect({ accessToken, effect, fetchImpl = accessToken.request, now = () => new Date(), writeJournal, readOnly = false, cancellationFence = false }: {
  accessToken: GoogleCalendarCapability; effect: PreparedWorkweekEffect; fetchImpl?: GoogleCalendarCapability["request"]; now?: () => Date; writeJournal?: WorkweekProviderWriteJournal; readOnly?: boolean; cancellationFence?: boolean;
}): Promise<GoogleWorkweekSeriesResult> {
  const observed = await observe(fetchImpl, accessToken, effect, false, cancellationFence);
  if (observed.state === "cleaned") return {state:"delayed",errorClass:"provider_identity_mismatch"};
  if (observed.state === "confirmed") {
    await writeJournal?.outcome("settled");
    return { ...observed, observedAt: now().toISOString() };
  }
  if (observed.state === "delayed") return observed;
  if (readOnly) return { state: "delayed", errorClass: "provider_unavailable" };
  const updating = effect.operation && effect.operation !== "create";
  if (updating && observed.state === "absent") return { state: "delayed", errorClass: "provider_identity_mismatch" };
  try {
    const response = await mutate(fetchImpl, updating ? `${endpoint(effect)}?sendUpdates=none` : endpoint(effect, true), {
      method: updating ? "PUT" : "POST", headers: { "content-type": "application/json", ...(updating ? { "if-match": effect.expectedEtag! } : {}) },
      body: JSON.stringify(effect.payload), cache: "no-store", signal: AbortSignal.timeout(8_000),
    }, writeJournal);
    if (response.ok) {
      const event = await response.json().catch(() => null) as ObservedEvent | null;
      return (matchesEffect(event, effect) || (cancellationFence && event?.id===effect.googleEventId && event.status==="cancelled" && Boolean(event.etag)))
        ? { state: "confirmed", etag: event!.etag!, observedAt: now().toISOString() }
        : { state: "delayed", errorClass: "provider_identity_mismatch" };
    }
    if (response.status === 412) return {state:"delayed",errorClass:"provider_identity_mismatch"};
    if (response.status !== 409 && response.status < 500) return errorFor(response);
  } catch {
    // A lost response does not prove that Google rejected the immutable mutation.
  }
  const recovered = await observe(fetchImpl, accessToken, effect, false, cancellationFence);
  if (recovered.state === "confirmed") await writeJournal?.outcome("settled");
  return recovered.state === "confirmed" ? { ...recovered, observedAt: now().toISOString() }
    : recovered.state === "delayed" ? recovered : { state: "delayed", errorClass: "provider_unavailable" };
}

export async function cleanupGoogleWorkweekEffect({ accessToken, effect, fetchImpl = accessToken.request, now = () => new Date(), writeJournal, readOnly = false }: {
  accessToken: GoogleCalendarCapability; effect: PreparedWorkweekEffect; fetchImpl?: GoogleCalendarCapability["request"]; now?: () => Date; writeJournal?: WorkweekProviderWriteJournal; readOnly?: boolean;
}): Promise<GoogleWorkweekSeriesResult & { preserved?: boolean }> {
  if (effect.cleanupDisposition) return cleanupPlannedEffect({accessToken,effect,fetchImpl,now,writeJournal,readOnly});
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
    if (readOnly) return { state: "delayed", errorClass: "provider_unavailable" };
    const response = await mutate(fetchImpl, `${endpoint(effect)}?sendUpdates=none`, {
      method: updating ? "PUT" : "DELETE", headers: { "if-match": observed.etag,
        ...(updating ? {"content-type":"application/json"} : {}) },
      ...(updating ? {body:JSON.stringify({...effect.expectedPayload,status:"confirmed"})} : {}),
      cache: "no-store", signal: AbortSignal.timeout(8_000),
    }, writeJournal);
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

async function cleanupPlannedEffect({accessToken,effect,fetchImpl,now,writeJournal,readOnly}:{accessToken:GoogleCalendarCapability;effect:PreparedWorkweekEffect;fetchImpl:GoogleCalendarCapability["request"];now:()=>Date;writeJournal?:WorkweekProviderWriteJournal;readOnly?:boolean}):Promise<GoogleWorkweekSeriesResult & {preserved?:boolean}> {
  if(effect.instanceOf && !effect.expectedEtag && effect.kind!=="cleanup_crossing")return {state:"confirmed",etag:"unbound",observedAt:now().toISOString(),preserved:false};
  const observed=await observe(fetchImpl,accessToken,effect,true);
  const preservation=effect.cleanupDisposition==="preserve" || effect.cleanupDisposition==="retain";
  const confirmed=async(etag:string,preserved=preservation)=>{
    await writeJournal?.outcome("settled");
    return {state:"confirmed" as const,etag,observedAt:now().toISOString(),preserved};
  };
  if(observed.state==="cleaned") return confirmed(observed.etag);
  if(observed.state==="delayed") return observed;
  if(observed.state==="absent") return effect.operation && effect.operation!=="create"
    ? {state:"delayed",errorClass:"provider_identity_mismatch"} : confirmed("absent",false);
  if(effect.cleanupDisposition==="retain") return {state:"delayed",errorClass:"provider_identity_mismatch"};
  if(observed.state==="baseline" && !(effect.kind==="cleanup_crossing" && observed.etag===effect.expectedEtag)) return effect.cleanupDisposition==="restore"
    ? confirmed(observed.etag,false) : {state:"delayed",errorClass:"provider_identity_mismatch"};
  if(readOnly)return {state:"delayed",errorClass:"provider_unavailable"};
  if(effect.cleanupDeadline && now().getTime()>=Date.parse(effect.cleanupDeadline))return {state:"delayed",errorClass:"provider_identity_mismatch"};
  // A persisted future-only decision cannot delete an occurrence that has since started.
  if(effect.cleanupDisposition==="delete" && now().getTime()>=new Date(effect.payload.start.dateTime).getTime()) return {state:"delayed",errorClass:"provider_identity_mismatch"};
  const deleting=effect.cleanupDisposition==="delete";
  try {
    const response=await mutate(fetchImpl,`${endpoint(effect)}?sendUpdates=none`,{method:deleting?"DELETE":"PUT",headers:{"if-match":observed.etag,...(!deleting?{"content-type":"application/json"}:{})},...(!deleting?{body:JSON.stringify(effect.cleanupPayload)}:{}),cache:"no-store",signal:AbortSignal.timeout(8_000)},writeJournal);
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

export async function discoverGoogleWorkweekInstance({accessToken,effect,fetchImpl=accessToken.request}: {
  accessToken:GoogleCalendarCapability; effect:PreparedWorkweekEffect; fetchImpl?:GoogleCalendarCapability["request"];
}): Promise<Readonly<{state:"observed";eventId:string;etag:string;originalPayload:WorkweekGooglePayload}> | Extract<GoogleWorkweekSeriesResult,{state:"delayed"}>> {
  if (!effect.instanceOf || !effect.originalStart || !effect.expectedPayload) return {state:"delayed",errorClass:"provider_identity_mismatch"};
  const url=new URL(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(effect.instanceOf)}/instances`);
  url.searchParams.set("originalStart",effect.originalStart);url.searchParams.set("showDeleted","true");url.searchParams.set("maxResults","10");
  try {
    const response=await fetchImpl(url,{headers:{},cache:"no-store",signal:AbortSignal.timeout(8_000)});
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


/** Resolve a journaled dispatch using provider identity/CAS, never elapsed time alone. */
export async function recoverGoogleWorkweekWrite({accessToken,effect,purpose,abandon=false,fetchImpl=accessToken.request,now=()=>new Date(),writeJournal}:{
  accessToken:GoogleCalendarCapability;effect:PreparedWorkweekEffect;purpose:"publish"|"cleanup";abandon?:boolean;
  fetchImpl?:GoogleCalendarCapability["request"];now?:()=>Date;writeJournal:WorkweekProviderWriteJournal;
}):Promise<GoogleWorkweekSeriesResult> {
  if(purpose==="cleanup")return cleanupGoogleWorkweekEffect({accessToken,effect,fetchImpl,now,writeJournal});
  if(!abandon)return ensureGoogleWorkweekEffect({accessToken,effect,fetchImpl,now,writeJournal});
  const observed=await observe(fetchImpl,accessToken,effect,true);
  if(observed.state==="confirmed" || observed.state==="baseline" && observed.etag!==effect.expectedEtag){
    await writeJournal.outcome("settled");
    return {state:"confirmed",etag:observed.etag,observedAt:now().toISOString()};
  }
  if(effect.operation==="create" && (observed.state==="absent" || observed.state==="delayed" && observed.errorClass==="provider_identity_mismatch")) {
    // The deterministic ID remains occupied. An original POST arriving later
    // cannot recreate this generation after cleanup.
    return ensureGoogleWorkweekEffect({accessToken,effect:{...effect,payload:{...effect.payload,status:"cancelled"}},fetchImpl,now,writeJournal,cancellationFence:true});
  }
  if(observed.state!=="baseline" || !effect.expectedPayload || !effect.expectedEtag)return observed.state==="delayed"?observed:{state:"delayed",errorClass:"provider_identity_mismatch"};
  try{
    const response=await mutate(fetchImpl,`${endpoint(effect)}?sendUpdates=none`,{
      method:"PUT",headers:{"content-type":"application/json","if-match":effect.expectedEtag},
      body:JSON.stringify({...effect.expectedPayload,extendedProperties:{private:{...effect.expectedPayload.extendedProperties.private,founderopsWorkweekRecoveryFence:effect.id}}}),cache:"no-store",signal:AbortSignal.timeout(8_000),
    },writeJournal);
    if(!response.ok && response.status!==412 && response.status<500)return errorFor(response);
  }catch{/* Observe the baseline and its rotated ETag before releasing the fence. */}
  const fenced=await observe(fetchImpl,accessToken,effect,true);
  if(fenced.state==="baseline" && fenced.etag!==effect.expectedEtag || fenced.state==="confirmed"){
    await writeJournal.outcome("settled");
    return {state:"confirmed",etag:fenced.etag,observedAt:now().toISOString()};
  }
  return fenced.state==="delayed"?fenced:{state:"delayed",errorClass:"provider_unavailable"};
}
