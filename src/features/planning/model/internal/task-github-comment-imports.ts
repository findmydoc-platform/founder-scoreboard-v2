import type { PlanningShellState, Task, TaskExternalComment } from "@/lib/types";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "../planning-state";
import type { TaskGitHubImportAdapter, TaskGitHubImportResult, TaskGitHubImportView } from "@/features/tasks/model/task-github-comment-import";

export function createTaskGitHubImports(options: {
 initial: readonly TaskExternalComment[]; adapter: TaskGitHubImportAdapter;
 active(): boolean; generation(): number; changed(): void; nextSequence(): number;
 canRead(id: string): boolean; dependencyPending(task: Task): boolean;
 invalidateTask(id: string): void; invalidateNotifications(): void; endSession(): void;
 refresh(id: string, after: number): Promise<PlanningReadStatus>;
}) {
 const operations = new Map<string, { view: TaskGitHubImportView; after: number; taskEffect: boolean }>();
 const attempts = new Set<string>(), denied = new Set<string>(), authorities = new Map<string, number>();
 const key = (row: TaskExternalComment) => `${row.taskId}:${row.source}:${row.externalId}`;
 const receipts = new Map(options.initial.map(row => [key(row), { taskId: row.taskId, row: row as TaskExternalComment | null, stamp: 0 }]));
 const scopes = new Map<string, { completeness: "complete" | "partial"; readStatus: PlanningReadStatus; stamp: number }>();
 // Complete absence also excludes identities that an older response has not revealed yet.
 const completeThrough = new Map<string, number>();
 const checks = new Map<string, Promise<PlanningTaskSaveCheck>>();
 const current = (id: string) => options.active() && !denied.has(id) && options.canRead(id);
 const blocksTask = (id: string) => { const operation = operations.get(id); return Boolean(operation && (operation.view.phase === "saving" || operation.taskEffect && (operation.view.phase === "unconfirmed" || operation.view.taskReadStatus !== "current"))); };
 function acceptRead(rows: readonly TaskExternalComment[], started: number, complete: boolean, taskId?: string, basis = started) {
  const newerTasks = new Set([...receipts.values()].filter(receipt => receipt.stamp > basis).map(receipt => receipt.taskId));
  if (taskId) denied.delete(taskId);
  const incoming = new Map(rows.filter(row => row.source === "github" && (!taskId || row.taskId === taskId)).map(row => [key(row), row]));
  for (const [id, receipt] of receipts) {
   if (receipt.stamp > basis || taskId && receipt.taskId !== taskId) continue;
   const row = incoming.get(id);
   if (row) receipts.set(id, { taskId: row.taskId, row, stamp: started });
   else if (complete) receipts.set(id, { ...receipt, row: null, stamp: started });
  }
  for (const [id, row] of incoming) if (!denied.has(row.taskId) && !receipts.has(id) && (completeThrough.get(row.taskId) || 0) <= basis) receipts.set(id, { taskId: row.taskId, row, stamp: started });
  const ids = taskId ? [taskId] : [...new Set([...scopes.keys(), ...rows.map(row => row.taskId), ...[...receipts.values()].map(row => row.taskId)])];
  for (const id of ids) {
   if ((scopes.get(id)?.stamp || 0) > basis) continue;
   if (complete) completeThrough.set(id, Math.max(completeThrough.get(id) || 0, started));
   const stale = newerTasks.has(id);
   scopes.set(id, { completeness: complete && !stale ? "complete" : "partial", readStatus: stale ? "stale" : "current", stamp: started });
  }
 }
 async function check(id: string): Promise<PlanningTaskSaveCheck> {
  if (!options.active()) return { outcome: "session-ended", readStatus: "not-needed" };
  const operation = operations.get(id);
  if (!operation || !current(id) || !operation.taskEffect || !["confirmed", "unconfirmed"].includes(operation.view.phase)) return { outcome: "not-pending", readStatus: "not-needed" };
  if (operation.view.phase === "confirmed" && operation.view.taskReadStatus === "current") return { outcome: "not-pending", readStatus: "current" };
  const existing = checks.get(id); if (existing) return existing;
  const generation = options.generation(), authority = authorities.get(id) || 0;
  operation.view = { ...operation.view, checking: true }; options.changed();
  const promise = (async (): Promise<PlanningTaskSaveCheck> => {
   const readStatus = await options.refresh(id, operation.after);
   if (!options.active() || generation !== options.generation()) return { outcome: "session-ended", readStatus: "not-needed" };
   if (!current(id) || authority !== (authorities.get(id) || 0)) return { outcome: "unconfirmed", readStatus: "forbidden" };
   operation.view = { ...operation.view, checking: false, taskReadStatus: operation.view.taskReadStatus === "current" ? "current" : readStatus }; options.changed();
   return { outcome: operation.view.phase === "confirmed" && readStatus === "current" ? "not-pending" : "unconfirmed", readStatus };
  })();
  checks.set(id, promise); void promise.finally(() => { if (checks.get(id) === promise) checks.delete(id); }).catch(() => undefined); return promise;
 }
 async function importComments(task: Task, input: { automatic?: boolean } = {}): Promise<TaskGitHubImportResult> {
  if (!current(task.id)) return { ok: false, kind: "ended", error: "Diese Diskussion ist in der Sitzung nicht verfügbar." };
  if (blocksTask(task.id) || input.automatic && attempts.has(task.id) || options.dependencyPending(task)) return { ok: false, kind: "blocked", error: "Ein betroffener Vorgang ist noch offen. Es wurde kein weiterer Import gesendet." };
  if (!options.adapter.importTaskGitHubComments) return { ok: false, kind: "rejected", error: "GitHub-Kommentarimport ist in diesem Arbeitsmodus nicht verfügbar." };
  attempts.add(task.id);
  const started = options.nextSequence();
  const generation = options.generation(), authority = authorities.get(task.id) || 0;
  const operation = { view: { taskId: task.id, phase: "saving", automatic: Boolean(input.automatic), error: "", notice: "", imported: null, taskReadStatus: "not-loaded", checking: false } as TaskGitHubImportView, after: 0, taskEffect: false };
  operations.set(task.id, operation); options.changed();
  const valid = () => current(task.id) && generation === options.generation() && authority === (authorities.get(task.id) || 0);
  try {
   const receipt = await options.adapter.importTaskGitHubComments(task.id);
   if (!valid()) return { ok: false, kind: "ended", error: "Die Sitzung oder der Zugriff wurde beendet." };
   if (!Array.isArray(receipt.comments) || typeof receipt.evidenceLink !== "string" || !Number.isSafeInteger(receipt.imported) || receipt.imported < 0 || receipt.comments.some(row => row.taskId !== task.id || row.source !== "github" || !Number.isSafeInteger(row.id) || row.id <= 0 || ![row.externalId, row.body, row.authorLogin, row.authorAvatarUrl, row.htmlUrl, row.createdAt, row.importedAt].every(value => typeof value === "string"))) throw new Error("Die Importbestätigung ist unvollständig.");
   operation.after = options.nextSequence();
   // Respect reads accepted after this import began; fence earlier reads after accepting its receipt.
   acceptRead(receipt.comments, operation.after, receipt.commentsCoverage === "complete", task.id, started);
   const total = receipt.comments.length;
   operation.taskEffect = Boolean(receipt.evidenceLink);
   operation.view = { ...operation.view, phase: "confirmed", imported: receipt.imported, taskReadStatus: operation.taskEffect ? "stale" : "current", notice: input.automatic ? "" : total ? `GitHub-Kommentare geladen: ${total} Kommentar${total === 1 ? "" : "e"}.${receipt.commentsCoverage === "complete" ? "" : " Weitere Kommentare sind möglicherweise noch nicht geladen."}` : receipt.commentsCoverage === "complete" ? "GitHub wurde geprüft, aber für dieses Issue wurden keine externen Kommentare gefunden." : "GitHub wurde geprüft. Die Kommentarliste ist noch unvollständig." };
   if (operation.taskEffect) options.invalidateTask(task.id);
   options.invalidateNotifications(); options.changed(); if (operation.taskEffect) void check(task.id);
   return { ok: true };
  } catch (error) {
   if (!valid()) return { ok: false, kind: "ended", error: "Die Sitzung oder der Zugriff wurde beendet." };
   const failure = error as { status?: number; code?: string; message?: string };
   if (failure.code === "session_superseded") { options.endSession(); return { ok: false, kind: "ended", error: "Die Sitzung wurde ersetzt." }; }
   // Later stages can fail after Evidence or comments persisted. A GET cannot prove that POST.
   const phase = failure.status && failure.status < 500 ? "rejected" : "unconfirmed";
   operation.view = { ...operation.view, phase, error: failure.message || "Der GitHub-Import ist noch nicht bestätigt." };
   if (phase === "unconfirmed") {
    operation.after = options.nextSequence(); operation.taskEffect = true; operation.view.taskReadStatus = "stale";
    scopes.set(task.id, { completeness: "partial", readStatus: "stale", stamp: scopes.get(task.id)?.stamp || 0 });
    options.invalidateTask(task.id); options.invalidateNotifications();
   }
   options.changed(); return { ok: false, kind: phase, error: operation.view.error };
  }
 }
 return {
  importComments, check, blocksTask, acceptRead,
  view: (id: string) => current(id) && operations.has(id) ? structuredClone(operations.get(id)!.view) : null,
  comments: (id: string, data: PlanningShellState) => ({ comments: current(id) ? data.taskExternalComments.filter(row => row.taskId === id && row.source === "github") : [], completeness: scopes.get(id)?.completeness || "partial" as const, readStatus: current(id) ? scopes.get(id)?.readStatus || "not-loaded" : "forbidden" as const }),
  acceptTaskRead(id: string, started: number, accepted: boolean, revision?: string) { const operation = operations.get(id); if (operation && accepted && revision && operation.after < started && operation.view.phase !== "saving") operation.view = { ...operation.view, taskReadStatus: "current" }; },
  failed(id: string, status: "forbidden" | "unavailable") { scopes.set(id, { completeness: "partial", readStatus: status, stamp: scopes.get(id)?.stamp || 0 }); if (status === "forbidden") { denied.add(id); authorities.set(id, (authorities.get(id) || 0) + 1); operations.delete(id); } },
  projectConfirmed(data: PlanningShellState): PlanningShellState {
   return { ...data, taskExternalComments: [...receipts.values()].filter(receipt => receipt.row && !denied.has(receipt.taskId)).map(receipt => receipt.row!) };
  },
  protect(data: PlanningShellState): PlanningShellState { return { ...data, tasks: data.tasks.map(task => { const operation = operations.get(task.id); return operation?.taskEffect && operation.view.taskReadStatus !== "current" ? { ...task, updatedAt: undefined } : task; }) }; },
  clear() { operations.clear(); attempts.clear(); denied.clear(); authorities.clear(); receipts.clear(); scopes.clear(); completeThrough.clear(); checks.clear(); },
 };
}
