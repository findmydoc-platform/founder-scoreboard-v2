import type { PlanningShellState, Task, TaskRelation } from "@/lib/types";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "../planning-state";
import type { TaskRelationshipAdapter, TaskRelationshipInput, TaskRelationshipChangeResult, TaskRelationshipChangeView } from "@/features/tasks/model/task-relationship-change";
export function createTaskRelationshipChanges(options: {
 initial: readonly TaskRelation[]; adapter: TaskRelationshipAdapter; active(): boolean; generation(): number; changed(): void; nextSequence(): number;
 canRead(id: string): boolean; currentTask(id: string): Task | undefined; dependencyPending(id: string): boolean;
 invalidateTask(id: string): void; invalidateNotifications(): void; endSession(): void;
 refresh(id: string, after: number): Promise<PlanningReadStatus>; confirmRelation(relation: TaskRelation): void; removeRelation(id: number): void;
}) {
 const operations = new Map<string, { view: TaskRelationshipChangeView; after: number; endpoints: string[] }>();
 const receipts = new Map(options.initial.map(relation => [relation.id, { relation: relation as TaskRelation | null, taskId: relation.taskId, relatedTaskId: relation.relatedTaskId, stamp: 0 }]));
 const completeThrough = new Map<string, number>(), authorities = new Map<string, number>(), denied = new Set<string>();
 const scopes = new Map<string, { completeness: "complete" | "partial"; readStatus: PlanningReadStatus; stamp: number }>();
 const checks = new Map<string, Promise<PlanningTaskSaveCheck>>();
 let nextId = 0;
 const current = (id: string) => options.active() && !denied.has(id);
 const pendingFor = (view: TaskRelationshipChangeView, id: string) => view.phase === "saving" || view.phase === "unconfirmed" || view.phase === "confirmed" && view.taskReads[id] !== "current";
 const blocksTask = (id: string) => [...operations.values()].some(operation => operation.endpoints.includes(id) && pendingFor(operation.view, id));
 function acceptRead(rows: readonly TaskRelation[], started: number, complete: boolean, taskId?: string) {
  if (taskId) denied.delete(taskId);
  const covered = (row: { taskId: string; relatedTaskId: string }) => !taskId || row.taskId === taskId || row.relatedTaskId === taskId;
  const incoming = new Map(rows.filter(covered).map(row => [row.id, row]));
  const newer = new Set([...receipts.values()].filter(receipt => receipt.stamp > started).flatMap(receipt => [receipt.taskId, receipt.relatedTaskId]));
  for (const [id, receipt] of receipts) {
   if (!covered(receipt) || receipt.stamp > started) continue;
   const relation = incoming.get(id);
   if (relation) receipts.set(id, { ...receipt, relation, stamp: started });
   else if (complete) receipts.set(id, { ...receipt, relation: null, stamp: started });
  }
  for (const [id, relation] of incoming) if (!receipts.has(id) && !denied.has(relation.taskId) && !denied.has(relation.relatedTaskId) && Math.max(completeThrough.get(relation.taskId) || 0, completeThrough.get(relation.relatedTaskId) || 0) <= started) receipts.set(id, { relation, taskId: relation.taskId, relatedTaskId: relation.relatedTaskId, stamp: started });
  const ids = taskId ? [taskId] : [...new Set([...rows.flatMap(row => [row.taskId, row.relatedTaskId]), ...[...receipts.values()].flatMap(row => [row.taskId, row.relatedTaskId])])];
  for (const id of ids) {
   if ((scopes.get(id)?.stamp || 0) > started) continue;
   if (complete) completeThrough.set(id, Math.max(completeThrough.get(id) || 0, started));
   scopes.set(id, { completeness: complete && !newer.has(id) ? "complete" : "partial", readStatus: newer.has(id) ? "stale" : "current", stamp: started });
  }
 }
 async function check(id: string): Promise<PlanningTaskSaveCheck> {
  if (!options.active()) return { outcome: "session-ended", readStatus: "not-needed" };
  const operation = operations.get(id);
  if (!operation || !["confirmed", "unconfirmed"].includes(operation.view.phase)) return { outcome: "not-pending", readStatus: "not-needed" };
  const existing = checks.get(id); if (existing) return existing;
  if (operation.view.phase === "confirmed" && operation.endpoints.every(id => operation.view.taskReads[id] === "current")) return { outcome: "not-pending", readStatus: "current" };
  const generation = options.generation(), authority = operation.endpoints.map(id => authorities.get(id) || 0);
  operation.view = { ...operation.view, checking: true }; options.changed();
  const promise = (async (): Promise<PlanningTaskSaveCheck> => {
   const statuses = await Promise.all(operation.endpoints.map(async id => [id, operation.view.phase === "confirmed" && operation.view.taskReads[id] === "current" ? "current" : await options.refresh(id, operation.after)] as const));
   if (!options.active() || generation !== options.generation()) return { outcome: "session-ended", readStatus: "not-needed" };
   if (operation.endpoints.some((id, index) => !current(id) || authority[index] !== (authorities.get(id) || 0))) return { outcome: "unconfirmed", readStatus: "forbidden" };
   operation.view = { ...operation.view, checking: false, taskReads: Object.fromEntries(statuses) }; options.changed();
   const failed = statuses.find(([,status]) => status !== "current");
   return { outcome: operation.view.phase === "confirmed" && !failed ? "not-pending" : "unconfirmed", readStatus: failed?.[1] || "current" };
  })();
  checks.set(id, promise); void promise.finally(() => { if (checks.get(id) === promise) checks.delete(id); }).catch(() => undefined); return promise;
 }
 async function change(kind: "add" | "remove", task: Task, submitted: TaskRelationshipInput, relation?: TaskRelation): Promise<TaskRelationshipChangeResult> {
  const endpoints = [...new Set(kind === "remove" && relation ? [relation.taskId, relation.relatedTaskId] : [task.id, submitted.relatedTaskId])];
  if (!current(task.id) || !options.canRead(task.id) || endpoints.some(id => !current(id))) return { ok: false, kind: "ended", error: "Diese Beziehung ist in der Sitzung nicht verfügbar." };
  if (endpoints.length !== 2 || endpoints.some(id => !id) || relation && (!Number.isSafeInteger(relation.id) || relation.id <= 0) || !endpoints.includes(task.id) || !["blocked_by", "blocks", "relates_to"].includes(submitted.relationType)) return { ok: false, kind: "rejected", error: "Bitte eine andere Aufgabe auswählen.", status: 400 };
  if (endpoints.some(id => blocksTask(id) || options.dependencyPending(id))) return { ok: false, kind: "blocked", error: "Eine betroffene Änderung ist noch nicht bestätigt. Die Beziehung wurde nicht erneut gesendet." };
  if (!task.updatedAt) return { ok: false, kind: "blocked", error: "Die angezeigte Aufgaben-Version muss zuerst geprüft werden." };
  if (options.currentTask(task.id)?.updatedAt !== task.updatedAt) return { ok: false, kind: "rejected", status: 409, error: "Die Aufgabe wurde seit dem Öffnen geändert. Schließe das Formular und öffne es erneut; die Eingaben bleiben erhalten." };
  if (kind === "add" && !options.adapter.addTaskRelationship || kind === "remove" && !options.adapter.removeTaskRelationship) return { ok: false, kind: "rejected", error: "Beziehungen können gerade nicht gespeichert werden." };
  const id = `relationship:${++nextId}`, generation = options.generation(), authority = endpoints.map(id => authorities.get(id) || 0), started = options.nextSequence();
  const operation = { view: { id, kind, taskId: task.id, relatedTaskId: endpoints.find(id => id !== task.id)!, relationId: relation?.id || null, submitted: structuredClone(submitted), phase: "saving", error: "", checking: false, taskReads: Object.fromEntries(endpoints.map(id => [id, "not-loaded"])) } as TaskRelationshipChangeView, after: 0, endpoints };
  operations.set(id, operation); options.changed();
  const valid = () => options.active() && generation === options.generation() && endpoints.every((id, index) => current(id) && authority[index] === (authorities.get(id) || 0));
  try {
   let accepted: TaskRelation | null = null;
   if (kind === "add") {
    accepted = (await options.adapter.addTaskRelationship!(structuredClone(task), structuredClone(submitted))).relation;
    if (!valid()) return { ok: false, kind: "ended", error: "Die Sitzung oder der Zugriff wurde beendet." };
    if (!accepted || !Number.isSafeInteger(accepted.id) || accepted.id <= 0 || accepted.taskId !== task.id || accepted.relatedTaskId !== submitted.relatedTaskId || accepted.relationType !== submitted.relationType || ![accepted.note, accepted.createdAt, accepted.createdBy].every(value => typeof value === "string")) throw new Error("Ob die Verknüpfung geändert wurde, ist noch unklar.");
   } else {
    const receipt = await options.adapter.removeTaskRelationship!(structuredClone(task), structuredClone(relation!));
    if (!valid()) return { ok: false, kind: "ended", error: "Die Sitzung oder der Zugriff wurde beendet." };
    if (receipt.relationId !== relation!.id) throw new Error("Die Entfernung ist noch nicht bestätigt.");
   }
   operation.after = options.nextSequence();
   if (accepted) {
    if ((receipts.get(accepted.id)?.stamp || 0) <= started) { receipts.set(accepted.id, { relation: structuredClone(accepted), taskId: accepted.taskId, relatedTaskId: accepted.relatedTaskId, stamp: operation.after }); options.confirmRelation(accepted); }
    operation.view.relationId = accepted.id;
   } else { receipts.set(relation!.id, { relation: null, taskId: relation!.taskId, relatedTaskId: relation!.relatedTaskId, stamp: operation.after }); options.removeRelation(relation!.id); }
   operation.view = { ...operation.view, phase: "confirmed", taskReads: Object.fromEntries(endpoints.map(id => [id, "stale"])) };
   for (const id of endpoints) options.invalidateTask(id);
   if (kind === "add" && submitted.note.includes("@")) options.invalidateNotifications();
   options.changed(); void check(id); return { ok: true };
  } catch (error) {
   if (!valid()) return { ok: false, kind: "ended", error: "Die Sitzung oder der Zugriff wurde beendet." };
   const failure = error as { status?: number; code?: string; message?: string };
   if (failure.code === "session_superseded") { options.endSession(); return { ok: false, kind: "ended", error: "Die Sitzung wurde ersetzt." }; }
   const phase = failure.status && failure.status < 500 ? "rejected" : "unconfirmed";
   operation.view = { ...operation.view, phase, error: failure.message || "Die Beziehungsänderung ist noch nicht bestätigt." };
   if (phase === "unconfirmed") { operation.after = options.nextSequence(); for (const id of endpoints) options.invalidateTask(id); if (kind === "add" && submitted.note.includes("@")) options.invalidateNotifications(); }
   options.changed(); return { ok: false, kind: phase, error: operation.view.error, status: failure.status };
  }
 }
 return {
  add: (task: Task, input: TaskRelationshipInput) => change("add", structuredClone(task), structuredClone(input)),
  remove: (task: Task, relation: TaskRelation) => change("remove", structuredClone(task), { relationType: relation.relationType, relatedTaskId: relation.relatedTaskId, note: relation.note }, structuredClone(relation)),
  check, blocksTask,
  pendingViews: (id: string) => current(id) && options.canRead(id) ? [...operations.values()].filter(operation => operation.endpoints.includes(id) && pendingFor(operation.view, id)).map(operation => ({ phase: operation.view.phase, checking: operation.view.checking, readStatus: operation.view.taskReads[id] })) : [],
  checkTask(id: string) { const operation = [...operations.values()].find(operation => operation.endpoints.includes(id) && pendingFor(operation.view, id)); return operation ? check(operation.view.id) : Promise.resolve({ outcome: "not-pending" as const, readStatus: "not-needed" as const }); },
  views: (id: string) => current(id) && options.canRead(id) ? [...operations.values()].filter(operation => operation.endpoints.includes(id) && operation.endpoints.every(current)).map(operation => structuredClone(operation.view)) : [],
  view(id: string, data: PlanningShellState) { return { relations: current(id) && options.canRead(id) ? data.taskRelations.filter(row => row.taskId === id || row.relatedTaskId === id) : [], completeness: blocksTask(id) ? "partial" as const : scopes.get(id)?.completeness || "partial" as const, readStatus: current(id) ? scopes.get(id)?.readStatus || "not-loaded" : "forbidden" as const }; },
  acceptRead,
  acceptTaskRead(id: string, started: number, accepted: boolean, revision?: string) { if (accepted && revision) for (const operation of operations.values()) if (operation.endpoints.includes(id) && operation.after < started && operation.view.phase !== "saving") operation.view = { ...operation.view, taskReads: { ...operation.view.taskReads, [id]: "current" } }; },
  projectConfirmed(data: PlanningShellState): PlanningShellState { return { ...data, taskRelations: [...receipts.values()].filter(receipt => receipt.relation && current(receipt.taskId) && current(receipt.relatedTaskId)).map(receipt => receipt.relation!) }; },
  projectVisible(data: PlanningShellState): PlanningShellState { const hidden = new Set([...operations.values()].filter(operation => operation.view.kind === "remove" && ["saving", "unconfirmed"].includes(operation.view.phase)).map(operation => operation.view.relationId)); return { ...data, taskRelations: data.taskRelations.filter(row => !hidden.has(row.id)) }; },
  protect(data: PlanningShellState): PlanningShellState { return { ...data, tasks: data.tasks.map(task => [...operations.values()].some(operation => operation.endpoints.includes(task.id) && ["confirmed", "unconfirmed"].includes(operation.view.phase) && operation.view.taskReads[task.id] !== "current") ? { ...task, updatedAt: undefined } : task) }; },
  denied(id: string) {
   denied.add(id); authorities.set(id, (authorities.get(id) || 0) + 1);
   for (const operation of operations.values()) if (operation.endpoints.includes(id)) {
    const wasSaving = operation.view.phase === "saving";
    operation.view = { ...operation.view, phase: wasSaving ? "unconfirmed" : operation.view.phase, checking: false, taskReads: { ...operation.view.taskReads, [id]: "forbidden" } };
    if (wasSaving) { operation.after = options.nextSequence(); for (const endpoint of operation.endpoints) options.invalidateTask(endpoint); }
   }
  },
  clear() { operations.clear(); receipts.clear(); completeThrough.clear(); authorities.clear(); denied.clear(); scopes.clear(); checks.clear(); },
 };
}
