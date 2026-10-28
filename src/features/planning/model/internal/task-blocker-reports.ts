import type { PlanningShellState, Task, TaskBlocker } from "@/lib/types";
import type { TaskDetailModel } from "@/features/tasks/model/task-detail-read-model";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "../planning-state";
import type { TaskBlockerReportAdapter, TaskBlockerReportResult, TaskBlockerReportView, TaskBlockerSubmission } from "@/features/tasks/model/task-blocker-report";

export function createTaskBlockerReports(options: {
  initial: readonly TaskBlocker[]; adapter: TaskBlockerReportAdapter; active(): boolean; generation(): number; changed(): void;
  canRead(taskId: string): boolean; dependencyPending(task: Task): boolean; nextSequence(): number;
  invalidateTask(taskId: string): void; invalidateNotifications(): void; endSession(): void;
  refresh(taskId: string, after: number): Promise<PlanningReadStatus>;
}) {
  const operations = new Map<string, { view: TaskBlockerReportView; after: number }>();
  const receipts = new Map(options.initial.map(blocker => [blocker.id, { blocker: blocker as TaskBlocker | null, stamp: 0 }]));
  const checks = new Map<string, Promise<PlanningTaskSaveCheck>>();
  const authorities = new Map<string, number>(), denied = new Set<string>();
  let nextId = 0;
  const pending = (view: TaskBlockerReportView) => view.phase === "saving" || view.phase === "unconfirmed" || view.phase === "confirmed" && view.taskReadStatus !== "current";
  const blocksTask = (id: string) => [...operations.values()].some(item => item.view.taskId === id && pending(item.view));
  function acceptBlockerRead(rows: readonly TaskBlocker[], started: number, complete: boolean, taskId?: string) {
    const incoming = new Map(rows.map(row => [row.id, row]));
    for (const [id, receipt] of receipts) {
      if (receipt.stamp > started || taskId && receipt.blocker?.taskId !== taskId) continue;
      const row = incoming.get(id);
      if (row) receipts.set(id, { blocker: row, stamp: started });
      else if (complete && receipt.blocker) receipts.set(id, { blocker: null, stamp: started });
    }
    for (const row of rows) if (!denied.has(row.taskId) && !receipts.has(row.id)) receipts.set(row.id, { blocker: row, stamp: started });
  }
  async function check(id: string): Promise<PlanningTaskSaveCheck> {
    if (!options.active()) return { outcome: "session-ended", readStatus: "not-needed" };
    const operation = operations.get(id);
    if (!operation || !options.canRead(operation.view.taskId)) return { outcome: "not-pending", readStatus: "not-needed" };
    if (operation.view.phase === "rejected" || operation.view.phase === "saving") return { outcome: "not-pending", readStatus: "not-needed" };
    if (operation.view.phase === "confirmed" && operation.view.taskReadStatus === "current") return { outcome: "not-pending", readStatus: "current" };
    const existing = checks.get(id); if (existing) return existing;
    const generation = options.generation(), authority = authorities.get(operation.view.taskId) || 0;
    operation.view = { ...operation.view, checking: true, taskReadStatus: "loading" }; options.changed();
    const promise = (async (): Promise<PlanningTaskSaveCheck> => {
      const readStatus = await options.refresh(operation.view.taskId, operation.after);
      if (!options.active() || generation !== options.generation()) return { outcome: "session-ended", readStatus: "not-needed" };
      if (authority !== (authorities.get(operation.view.taskId) || 0) || !options.canRead(operation.view.taskId)) return { outcome: "unconfirmed", readStatus: "forbidden" };
      operation.view = { ...operation.view, checking: false, taskReadStatus: readStatus }; options.changed();
      return { outcome: operation.view.phase === "confirmed" && readStatus === "current" ? "not-pending" : "unconfirmed", readStatus };
    })();
    checks.set(id, promise); void promise.finally(() => { if (checks.get(id) === promise) checks.delete(id); }).catch(() => undefined); return promise;
  }
  async function report(task: Task, input: TaskBlockerSubmission): Promise<TaskBlockerReportResult> {
    if (!options.active() || !options.canRead(task.id)) return { ok: false, kind: "ended", error: "Diese Aufgabe ist in der Sitzung nicht verfügbar." };
    if (blocksTask(task.id) || options.dependencyPending(task)) return { ok: false, kind: "blocked", error: "Eine betroffene Änderung ist noch nicht bestätigt. Es wurde kein weiterer Blocker gesendet." };
    const submitted = structuredClone(input);
    if (submitted.reason.trim().length < 5) return { ok: false, kind: "rejected", error: "Blocker-Grund ist erforderlich.", status: 400 };
    if (!options.adapter.reportBlocker) return { ok: false, kind: "rejected", error: "Blocker-Meldung ist nicht verfügbar." };
    const id = `blocker:${++nextId}`, generation = options.generation(), authority = authorities.get(task.id) || 0;
    const operation = { view: { id, taskId: task.id, phase: "saving", submitted, blocker: null, error: "", taskReadStatus: "stale", checking: false, serverTask: null } as TaskBlockerReportView, after: 0 };
    operations.set(id, operation); options.changed();
    const valid = () => options.active() && generation === options.generation() && authority === (authorities.get(task.id) || 0) && options.canRead(task.id);
    try {
      const { blocker } = await options.adapter.reportBlocker(task.id, submitted);
      if (!valid()) return { ok: false, kind: "ended", error: "Die Sitzung oder der Zugriff wurde beendet." };
      if (!blocker || blocker.taskId !== task.id || !Number.isSafeInteger(blocker.id) || blocker.id <= 0 || ![blocker.profileId, blocker.reason, blocker.impact, blocker.needsHelpFrom, blocker.createdAt, blocker.resolvedAt].every(value => typeof value === "string") || !["open", "resolved"].includes(blocker.status)) throw new Error("Die Blocker-Bestätigung ist unvollständig.");
      operation.after = options.nextSequence(); receipts.set(blocker.id, { blocker: structuredClone(blocker), stamp: operation.after });
      operation.view = { ...operation.view, phase: "confirmed", blocker: structuredClone(blocker) };
      options.invalidateTask(task.id); options.invalidateNotifications(); options.changed(); void check(id);
      return { ok: true, blocker };
    } catch (error) {
      if (!valid()) return { ok: false, kind: "ended", error: "Die Sitzung oder der Zugriff wurde beendet." };
      const failure = error as { status?: number; code?: string; message?: string };
      if (failure.code === "session_superseded") { options.endSession(); return { ok: false, kind: "ended", error: "Die Sitzung wurde ersetzt." }; }
      const phase = failure.status && failure.status < 500 ? "rejected" : "unconfirmed";
      operation.view = { ...operation.view, phase, error: failure.message || "Die Blocker-Meldung ist noch nicht bestätigt." };
      if (phase === "unconfirmed") { operation.after = options.nextSequence(); options.invalidateTask(task.id); options.invalidateNotifications(); }
      options.changed(); return { ok: false, kind: phase, error: operation.view.error, status: failure.status };
    }
  }
  return {
    report, blocksTask, check,
    views(taskId?: string) { return options.active() ? [...operations.values()].filter(item => (!taskId || taskId === item.view.taskId) && options.canRead(item.view.taskId)).map(item => structuredClone(item.view)) : []; },
    saveStatus(taskId: string): "saving" | "unconfirmed" | undefined { const operation = [...operations.values()].find(item => item.view.taskId === taskId && pending(item.view)); return operation ? operation.view.phase === "saving" ? "saving" : "unconfirmed" : undefined; },
    checkTask: (taskId: string) => { const operation = [...operations.values()].find(item => item.view.taskId === taskId && pending(item.view)); return operation ? check(operation.view.id) : Promise.resolve({ outcome: "not-pending" as const, readStatus: "not-needed" as const }); },
    acceptDetailRead(model: TaskDetailModel, started: number, taskAccepted: boolean, relationshipsAvailable: boolean) {
      denied.delete(model.item.id);
      if (relationshipsAvailable) acceptBlockerRead(model.blockers, started, model.coverage?.relationships === "complete", model.item.id);
      if (taskAccepted && model.item.updatedAt) for (const operation of operations.values()) if (operation.view.taskId === model.item.id && operation.after < started && operation.view.phase !== "saving") operation.view = { ...operation.view, taskReadStatus: "current", serverTask: structuredClone(model.item) };
    },
    acceptBlockerRead,
    projectConfirmed(data: PlanningShellState): PlanningShellState {
      const known = new Set(data.taskBlockers.map(row => row.id));
      const rows = data.taskBlockers.filter(row => !denied.has(row.taskId) && (!receipts.has(row.id) || receipts.get(row.id)!.blocker)).map(row => receipts.get(row.id)?.blocker || row);
      const taskBlockers = [...rows, ...[...receipts.values()].filter(receipt => receipt.blocker && !denied.has(receipt.blocker.taskId) && !known.has(receipt.blocker.id)).map(receipt => receipt.blocker!)];
      return { ...data, taskBlockers };
    },
    protect(data: PlanningShellState): PlanningShellState { return { ...data, tasks: data.tasks.map(task => [...operations.values()].some(item => item.view.taskId === task.id && ["confirmed", "unconfirmed"].includes(item.view.phase) && item.view.taskReadStatus !== "current") ? { ...task, updatedAt: undefined } : task) }; },
    projectVisible(data: PlanningShellState): PlanningShellState { return { ...data, tasks: data.tasks.map(task => [...operations.values()].some(item => item.view.taskId === task.id && pending(item.view)) ? { ...task, status: "Blockiert", githubIssueSyncStatus: "not_synced", githubIssueSyncError: "" } : task) }; },
    denied(taskId: string) { denied.add(taskId); authorities.set(taskId, (authorities.get(taskId) || 0) + 1); for (const [id, item] of operations) if (item.view.taskId === taskId) operations.delete(id); },
    clear() { operations.clear(); receipts.clear(); authorities.clear(); denied.clear(); checks.clear(); },
  };
}
