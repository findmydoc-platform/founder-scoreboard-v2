import type { PlanningShellState, Task, TaskActivity } from "@/lib/types";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "../planning-state";
import type { TaskAttachmentAdapter, TaskAttachmentUploadResult, TaskAttachmentUploadView } from "@/features/tasks/model/task-attachment-upload";
export function createTaskAttachmentUploads(options: {
 initial: readonly TaskActivity[]; adapter: TaskAttachmentAdapter; active(): boolean; generation(): number;
 changed(): void; nextSequence(): number; canRead(id: string): boolean; dependencyPending(task: Task): boolean;
 invalidateTask(id: string): void; refresh(id: string, after: number): Promise<PlanningReadStatus>; endSession(): void;
}) {
 const operations = new Map<string, { view: TaskAttachmentUploadView; after: number }>();
 const attachmentActivity = (row: TaskActivity) => row.action === "task.attachment_uploaded";
 const receipts = new Map(options.initial.filter(attachmentActivity).map(row => [row.id, { taskId: row.taskId, row: row as TaskActivity | null, stamp: 0 }]));
 const completeThrough = new Map<string, number>(), authorities = new Map<string, number>(), denied = new Set<string>();
 const checks = new Map<string, Promise<PlanningTaskSaveCheck>>();
 let nextId = 0;
 const current = (id: string) => options.active() && !denied.has(id) && options.canRead(id);
 const pending = (view: TaskAttachmentUploadView) => view.phase === "uploading" || view.phase === "unconfirmed" || view.phase === "uploaded" && view.taskReadStatus !== "current";
 const blocksTask = (id: string) => [...operations.values()].some(operation => operation.view.taskId === id && pending(operation.view));
 function acceptRead(rows: readonly TaskActivity[], started: number, complete: boolean, taskId: string) {
  denied.delete(taskId);
  const incoming = new Map(rows.filter(row => row.taskId === taskId && attachmentActivity(row)).map(row => [row.id, row]));
  for (const [id, receipt] of receipts) {
   if (receipt.taskId !== taskId || receipt.stamp > started) continue;
   const row = incoming.get(id);
   if (row) receipts.set(id, { taskId, row, stamp: started });
   else if (complete) receipts.set(id, { taskId, row: null, stamp: started });
  }
  for (const [id, row] of incoming) if (!receipts.has(id) && (completeThrough.get(taskId) || 0) <= started) receipts.set(id, { taskId, row, stamp: started });
  if (complete) completeThrough.set(taskId, Math.max(completeThrough.get(taskId) || 0, started));
 }
 async function check(id: string): Promise<PlanningTaskSaveCheck> {
  if (!options.active()) return { outcome: "session-ended", readStatus: "not-needed" };
  const operation = operations.get(id);
  if (!operation || !current(operation.view.taskId) || !["uploaded", "unconfirmed"].includes(operation.view.phase)) return { outcome: "not-pending", readStatus: "not-needed" };
  const existing = checks.get(id); if (existing) return existing;
  if (operation.view.phase === "uploaded" && operation.view.taskReadStatus === "current") return { outcome: "not-pending", readStatus: "current" };
  const generation = options.generation(), authority = authorities.get(operation.view.taskId) || 0;
  operation.view = { ...operation.view, checking: true }; options.changed();
  const promise = (async (): Promise<PlanningTaskSaveCheck> => {
   const readStatus = await options.refresh(operation.view.taskId, operation.after);
   if (!options.active() || generation !== options.generation()) return { outcome: "session-ended", readStatus: "not-needed" };
   if (!current(operation.view.taskId) || authority !== (authorities.get(operation.view.taskId) || 0)) return { outcome: "unconfirmed", readStatus: "forbidden" };
   operation.view = { ...operation.view, checking: false, taskReadStatus: readStatus }; options.changed();
   return { outcome: operation.view.phase === "uploaded" && readStatus === "current" ? "not-pending" : "unconfirmed", readStatus };
  })();
  checks.set(id, promise); void promise.finally(() => { if (checks.get(id) === promise) checks.delete(id); }).catch(() => undefined); return promise;
 }
 async function upload(task: Task, file: File): Promise<TaskAttachmentUploadResult> {
  if (!current(task.id)) return { ok: false, kind: "ended", error: "Diese Aufgabe ist in der Sitzung nicht verfügbar." };
  if (blocksTask(task.id) || options.dependencyPending(task)) return { ok: false, kind: "blocked", error: "Ein betroffener Vorgang ist noch offen. Es wurde kein weiterer Anhang gesendet." };
  if (!options.adapter.uploadTaskAttachment) return { ok: false, kind: "rejected", error: "Anhänge können nur mit aktiver Verbindung hochgeladen werden." };
  const id = `attachment:${++nextId}`, generation = options.generation(), authority = authorities.get(task.id) || 0;
  // The operation retains metadata only. The File stays in this local invocation and its adapter.
  const operation = { view: { id, taskId: task.id, filename: file.name, contentType: file.type, size: file.size, phase: "uploading", markdown: "", url: "", error: "", warning: "", effects: "pending", taskReadStatus: "not-loaded", checking: false } as TaskAttachmentUploadView, after: 0 };
  operations.set(id, operation); options.changed();
  const valid = () => current(task.id) && generation === options.generation() && authority === (authorities.get(task.id) || 0);
  try {
   const receipt = await options.adapter.uploadTaskAttachment(task.id, file);
   if (!valid()) return { ok: false, kind: "ended", error: "Die Sitzung oder der Zugriff wurde beendet." };
   if (!receipt.markdown || !receipt.path.startsWith(`.fmd-attachments/tasks/${task.id}/`) || receipt.filename !== file.name || receipt.size !== file.size || receipt.contentType !== file.type || ![receipt.markdown, receipt.url, receipt.htmlUrl].every(value => typeof value === "string") || !["confirmed", "unconfirmed"].includes(receipt.effects)) throw new Error("Die Upload-Bestätigung ist unvollständig.");
   const returnedActivity = receipt.activity;
   const activity = returnedActivity && returnedActivity.taskId === task.id && attachmentActivity(returnedActivity) && Number.isSafeInteger(returnedActivity.id) && returnedActivity.id > 0 && typeof returnedActivity.createdAt === "string" ? returnedActivity : null;
   const effects = receipt.effects === "confirmed" && activity ? "confirmed" : "unconfirmed";
   operation.after = options.nextSequence();
   if (activity) receipts.set(activity.id, { taskId: task.id, row: structuredClone(activity), stamp: operation.after });
   operation.view = { ...operation.view, phase: "uploaded", markdown: receipt.markdown, url: receipt.url, effects, warning: receipt.warning || (effects === "unconfirmed" ? "Anhang hochgeladen. Die Folgewirkungen sind noch nicht vollständig bestätigt." : ""), taskReadStatus: "stale" };
   options.invalidateTask(task.id); options.changed(); void check(id);
   return { ok: true, markdown: receipt.markdown };
  } catch (error) {
   if (!valid()) return { ok: false, kind: "ended", error: "Die Sitzung oder der Zugriff wurde beendet." };
   const failure = error as { status?: number; code?: string; message?: string };
   if (failure.code === "session_superseded") { options.endSession(); return { ok: false, kind: "ended", error: "Die Sitzung wurde ersetzt." }; }
   const phase = failure.status && failure.status < 500 ? "rejected" : "unconfirmed";
   operation.view = { ...operation.view, phase, error: failure.message || "Der Upload ist noch nicht bestätigt.", effects: phase === "unconfirmed" ? "unconfirmed" : "pending" };
   if (phase === "unconfirmed") { operation.after = options.nextSequence(); operation.view.taskReadStatus = "stale"; options.invalidateTask(task.id); }
   options.changed(); return { ok: false, kind: phase, error: operation.view.error };
  }
 }
 return {
  upload, check, blocksTask,
  views: (taskId: string) => current(taskId) ? [...operations.values()].filter(operation => operation.view.taskId === taskId).map(operation => structuredClone(operation.view)) : [],
  checkTask(taskId: string) { const operation = [...operations.values()].find(operation => operation.view.taskId === taskId && pending(operation.view)); return operation ? check(operation.view.id) : Promise.resolve({ outcome: "not-pending" as const, readStatus: "not-needed" as const }); },
  acceptRead,
  acceptTaskRead(taskId: string, started: number, accepted: boolean, revision?: string) { if (accepted && revision) for (const operation of operations.values()) if (operation.view.taskId === taskId && operation.after < started && operation.view.phase !== "uploading") operation.view = { ...operation.view, taskReadStatus: "current" }; },
  projectConfirmed(data: PlanningShellState): PlanningShellState { return { ...data, taskActivity: [...data.taskActivity.filter(row => !attachmentActivity(row)), ...[...receipts.values()].filter(receipt => receipt.row && !denied.has(receipt.taskId)).map(receipt => receipt.row!)] }; },
  protect(data: PlanningShellState): PlanningShellState { return { ...data, tasks: data.tasks.map(task => [...operations.values()].some(operation => operation.view.taskId === task.id && ["uploaded", "unconfirmed"].includes(operation.view.phase) && operation.view.taskReadStatus !== "current") ? { ...task, updatedAt: undefined } : task) }; },
  failed(taskId: string) { denied.add(taskId); authorities.set(taskId, (authorities.get(taskId) || 0) + 1); for (const [id, operation] of operations) if (operation.view.taskId === taskId) operations.delete(id); },
  clear() { operations.clear(); receipts.clear(); completeThrough.clear(); authorities.clear(); denied.clear(); checks.clear(); },
 };
}
