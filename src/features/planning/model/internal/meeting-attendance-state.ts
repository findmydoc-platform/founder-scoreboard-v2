import type { Meeting, MeetingAttendance, PlanningShellState } from "@/lib/types";
import type { MeetingAttendanceAdapter, MeetingAttendanceEditor, MeetingAttendanceEditView, MeetingAttendancePatch, MeetingAttendanceResult } from "@/features/sprint/model/meeting-attendance-state";
import type { PlanningTaskSaveCheck } from "../planning-state";
const keyOf = (meetingId: number, profileId: string) => `${meetingId}:${profileId}`;
const blank = (meetingId: number, profileId: string): MeetingAttendance => ({ id: 0, meetingId, profileId, status: "pending", absenceReason: "", reasonAccepted: false, writtenUpdate: "", points: 0, createdAt: "", updatedAt: "" });
export function createMeetingAttendanceState(options: { initial: readonly MeetingAttendance[]; adapter: MeetingAttendanceAdapter; active(): boolean; generation(): number; nextSequence(): number; changed(): void; endSession(): void; dependencyPending(meeting: Meeting): boolean; invalidateNotifications(): void }) {
 const records = new Map(options.initial.map(row => [keyOf(row.meetingId, row.profileId), { row: structuredClone(row) as MeetingAttendance | null, stamp: 0 }]));
 const ownReceipts = new Map<string, { started: number; acceptedAt: number; readThrough: number; basisVersion: string | undefined }>();
 function canAcceptRead(key: string, row: MeetingAttendance | null | undefined, started: number) {
  const current = records.get(key), own = ownReceipts.get(key);
  return (current?.stamp || 0) <= started || Boolean(row && own && current?.stamp === own.acceptedAt && started >= own.readThrough && started > own.started && row.updatedAt !== own.basisVersion);
 }
 const editors = new Map<string, { editor: MeetingAttendanceEditor; view: MeetingAttendanceEditView; key: string; meeting: Meeting; pending: MeetingAttendance | null; after: number }>();
 const checks = new Map<string, Promise<{ attendance: MeetingAttendance | null; started: number }>>();
 const denied = new Set<string>();
 const pairAuthorities = new Map<string, number>();
 let completeThrough = -1, complete = false, sequence = 0, authority = 0, workspaceDenied = false;
 const active = (key: string) => options.active() && !workspaceDenied && !denied.has(key);
 const blocks = (key: string) => [...editors.values()].some(context => context.key === key && ["saving", "unconfirmed"].includes(context.view.phase));
 function valid(row: MeetingAttendance | null, meetingId: number, profileId: string) { return row === null || Boolean(row.id > 0 && row.meetingId === meetingId && row.profileId === profileId && row.updatedAt); }
 async function read(meetingId: number, profileId: string) {
  const key = keyOf(meetingId, profileId), existing = checks.get(key); if (existing) return existing;
  if (!options.adapter.readMeetingAttendance) throw new Error("Weekly-Rückmeldung kann gerade nicht geprüft werden.");
  const generation = options.generation(), heldAuthority = authority, pairAuthority = pairAuthorities.get(key) || 0, started = options.nextSequence();
  const request = (async () => {
   try {
    const result = await options.adapter.readMeetingAttendance!(meetingId, profileId);
    if (!options.active() || generation !== options.generation() || heldAuthority !== authority || pairAuthority !== (pairAuthorities.get(key) || 0)) throw Object.assign(new Error("Die Sitzung wurde beendet."), { code: "session_superseded" });
    if (!valid(result.attendance, meetingId, profileId)) throw new Error("Die Weekly-Bestätigung ist unvollständig.");
    denied.delete(key);
    if ((records.has(key) || started >= completeThrough) && canAcceptRead(key, result.attendance, started)) { records.set(key, { row: structuredClone(result.attendance), stamp: started }); ownReceipts.delete(key); }
    options.changed(); return { attendance: structuredClone(records.get(key)?.row || null), started };
   } catch (error) { const failure = error as { status?: number }; if (failure.status === 403 && options.active() && generation === options.generation()) { denied.add(key); pairAuthorities.set(key, (pairAuthorities.get(key) || 0) + 1); for (const context of editors.values()) if (context.key === key) context.pending = null; options.changed(); } throw error; }
  })();
  checks.set(key, request); void request.finally(() => { if (checks.get(key) === request) checks.delete(key); }).catch(() => undefined); return request;
 }
 function begin(meeting: Meeting, profileId: string, shown: MeetingAttendance | null): MeetingAttendanceEditor {
  const key = keyOf(meeting.id, profileId), generation = options.generation(), heldAuthority = authority, pairAuthority = pairAuthorities.get(key) || 0;
  let basis = structuredClone(shown), prepared = Boolean(shown?.updatedAt) || (complete && !records.get(key)?.row), closed = false;
  const id = `attendance:${++sequence}`;
  const context = { key, after: 0, meeting: structuredClone(meeting), pending: null as MeetingAttendance | null, view: { id, meetingId: meeting.id, profileId, phase: "editing", submitted: null, serverRecord: null, compared: false, error: "", warning: "", checking: false, readStatus: prepared ? "current" : "not-loaded" } as MeetingAttendanceEditView, editor: null as unknown as MeetingAttendanceEditor };
  const available = () => !closed && active(key) && generation === options.generation() && heldAuthority === authority && pairAuthority === (pairAuthorities.get(key) || 0);
  const view = () => available() ? structuredClone(context.view) : { ...context.view, phase: "ended" as const, submitted: null, serverRecord: null, error: "", warning: "" };
  async function prepare() {
   if (!available()) return null;
   if (prepared) return structuredClone(basis);
   context.view = { ...context.view, phase: "loading", error: "" }; options.changed();
   try { const result = await read(meeting.id, profileId); if (available()) { basis = structuredClone(result.attendance); prepared = true; context.view = { ...context.view, phase: "editing", readStatus: "current" }; options.changed(); } return available() ? structuredClone(basis) : null; }
   catch (error) { if (available()) { context.view = { ...context.view, phase: "rejected", readStatus: "unavailable", error: error instanceof Error ? error.message : "Weekly konnte nicht geladen werden." }; options.changed(); } return null; }
  }
  async function save(patch: MeetingAttendancePatch): Promise<MeetingAttendanceResult> {
   if (!available()) return { ok: false, kind: "ended", error: "Die Weekly-Bearbeitung wurde beendet." };
   if (["saving", "unconfirmed"].includes(context.view.phase)) return { ok: false, kind: "blocked", error: "Die ursprüngliche Rückmeldung ist noch nicht bestätigt. Nicht erneut senden." };
   if (!prepared || blocks(key) || options.dependencyPending(meeting)) { context.view = { ...context.view, phase: "blocked", submitted: structuredClone(patch), error: "Eine betroffene Änderung muss zuerst geprüft werden. Diese Rückmeldung wurde nicht gesendet." }; options.changed(); return { ok: false, kind: "blocked", error: context.view.error }; }
   if (context.view.phase === "conflict") return { ok: false, kind: "conflict", error: context.view.error };
   if (!options.adapter.saveMeetingAttendance) return { ok: false, kind: "rejected", error: "Weekly kann gerade nicht gespeichert werden." };
   const submitted = structuredClone(patch), record = { ...(basis || blank(meeting.id, profileId)), ...submitted, meetingId: meeting.id, profileId };
   const basisVersion = basis?.updatedAt;
   context.after = options.nextSequence(); const started = context.after; context.pending = record; context.view = { ...context.view, phase: "saving", submitted, error: "", warning: "", compared: false }; options.changed();
   try {
    const receipt = await options.adapter.saveMeetingAttendance(structuredClone(meeting), structuredClone(basis), record);
    if (!available()) return { ok: false, kind: "ended", error: "Die Sitzung oder der Zugriff wurde beendet." };
    if (!receipt.attendance || !valid(receipt.attendance, meeting.id, profileId)) throw new Error("Die gespeicherte Weekly-Rückmeldung ist noch nicht bestätigt.");
    // The editor advances only to its own receipt, even when shared data has a foreign successor.
    basis = structuredClone(receipt.attendance);
    const current = records.get(key);
    const foreign = Math.max(current?.stamp || 0, completeThrough) > started && current?.row?.updatedAt !== basisVersion && current?.row?.updatedAt !== basis.updatedAt;
    if (!foreign) {
     const acceptedAt = options.nextSequence(); records.set(key, { row: basis, stamp: acceptedAt }); ownReceipts.set(key, { started, acceptedAt, readThrough: current?.stamp || 0, basisVersion });
    }
    context.pending = null;
    context.view = { ...context.view, phase: "confirmed", warning: receipt.warning || (receipt.effects === "unconfirmed" ? "Rückmeldung gespeichert. Benachrichtigung oder Protokoll noch nicht bestätigt." : ""), readStatus: "current" };
    options.invalidateNotifications(); options.changed(); return { ok: true };
   } catch (error) {
    if (!available()) return { ok: false, kind: "ended", error: "Die Sitzung oder der Zugriff wurde beendet." };
    const failure = error as { status?: number; code?: string; message?: string };
    if (failure.code === "session_superseded") { options.endSession(); return { ok: false, kind: "ended", error: "Die Sitzung wurde ersetzt." }; }
    const phase = failure.code === "attendance_revision_conflict" ? "conflict" : failure.status && failure.status < 500 ? "rejected" : "unconfirmed";
    if (phase !== "unconfirmed") context.pending = null; else context.after = options.nextSequence();
    context.view = { ...context.view, phase, error: failure.message || "Weekly-Rückmeldung ist noch nicht bestätigt.", readStatus: phase === "unconfirmed" ? "stale" : context.view.readStatus };
    if (phase === "unconfirmed") options.invalidateNotifications(); options.changed(); return { ok: false, kind: phase, error: context.view.error };
   }
  }
  async function checkOutcome(): Promise<PlanningTaskSaveCheck> {
   if (!available()) return { outcome: "session-ended", readStatus: "not-needed" };
   context.view.checking = true; options.changed();
   try { let result = await read(meeting.id, profileId); if (result.started <= context.after) result = await read(meeting.id, profileId); if (!available()) return { outcome: "session-ended", readStatus: "not-needed" }; context.view = { ...context.view, checking: false, serverRecord: structuredClone(result.attendance), readStatus: "current" }; options.changed(); return { outcome: context.view.phase === "unconfirmed" ? "unconfirmed" : "not-pending", readStatus: "current" }; }
   catch (error) { if (!available()) return { outcome: "session-ended", readStatus: "not-needed" }; context.view = { ...context.view, checking: false, readStatus: "unavailable", error: error instanceof Error ? error.message : "Prüfung fehlgeschlagen." }; options.changed(); return { outcome: "unconfirmed", readStatus: "unavailable" }; }
  }
  const editor: MeetingAttendanceEditor = { view, prepare, save, checkOutcome, async refreshConflict() { if (context.view.phase !== "conflict") return; const checked = await checkOutcome(); if (checked.readStatus === "current" && available()) { context.view.compared = true; options.changed(); } }, async resave(patch) { if (!available() || context.view.phase !== "conflict" || !context.view.compared) return { ok: false, kind: "blocked", error: "Bitte zuerst den aktuellen Serverstand vergleichen." }; basis = structuredClone(context.view.serverRecord); prepared = true; context.view.phase = "editing"; return save(patch); }, close() { if (["editing", "rejected", "blocked"].includes(context.view.phase)) { closed = true; editors.delete(id); } } };
  context.editor = editor; editors.set(id, context); return editor;
 }
 return { begin,
  resume: (id: string) => options.active() ? editors.get(id)?.editor || null : null,
  views: (meetingId: number, profileId: string) => [...editors.values()].filter(context => context.key === keyOf(meetingId, profileId) && active(context.key)).map(context => context.editor.view()),
  pair(meetingId: number, profileId: string) { const key = keyOf(meetingId, profileId); return { record: active(key) ? structuredClone(records.get(key)?.row || null) : null, readStatus: !active(key) ? "forbidden" as const : records.has(key) || complete ? "current" as const : "not-loaded" as const }; },
  pendingSprint: (id: string) => [...editors.values()].some(context => context.meeting.sprintId === id && blocks(context.key)),
  coverage: () => complete && ![...editors.values()].some(context => blocks(context.key)) ? "complete" as const : "partial" as const,
  acceptRead(rows: readonly MeetingAttendance[], started: number, isComplete: boolean) { workspaceDenied = false; const incoming = new Map(rows.map(row => [keyOf(row.meetingId,row.profileId),row])); for (const [key] of records) if (canAcceptRead(key, incoming.get(key), started)) { if (incoming.has(key)) { records.set(key,{row:structuredClone(incoming.get(key)!),stamp:started}); ownReceipts.delete(key); } else if (isComplete) { records.set(key,{row:null,stamp:started}); ownReceipts.delete(key); } } for (const [key,row] of incoming) if (!records.has(key) && started >= completeThrough) records.set(key,{row:structuredClone(row),stamp:started}); if (isComplete && started >= completeThrough) { complete = true; completeThrough = started; } },
  projectConfirmed(data: PlanningShellState): PlanningShellState { return { ...data, meetingAttendance: workspaceDenied ? [] : [...records.entries()].filter(([key,receipt]) => receipt.row && !denied.has(key)).map(([,receipt]) => receipt.row!) }; },
  projectVisible(data: PlanningShellState): PlanningShellState { const rows = new Map(data.meetingAttendance.map(row => [keyOf(row.meetingId,row.profileId),row])); for (const context of editors.values()) if (context.pending && active(context.key)) rows.set(context.key,context.pending); return { ...data, meetingAttendance: [...rows.values()] }; },
  denyWorkspace() { workspaceDenied = true; authority++; for (const context of editors.values()) context.pending = null; },
  clear() { records.clear(); ownReceipts.clear(); editors.clear(); checks.clear(); denied.clear(); pairAuthorities.clear(); complete = false; completeThrough = -1; authority++; },
 };
}
