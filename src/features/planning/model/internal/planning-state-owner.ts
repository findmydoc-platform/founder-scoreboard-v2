import type { AuthenticatedProfile, PlanningHeaderData, PlanningShellState, Task, TaskActivity } from "@/lib/types";
import type { PlanningState, PlanningTaskSaveStatus } from "../planning-state";
import type { AppWorkspace } from "../workspace-routes";
import type { TaskUpdateResult } from "@/features/tasks/hooks/task-mutation-command-types";
import type { TaskDetailModel, TaskDetailUnavailableArea } from "@/features/tasks/model/task-detail-read-model";
import { applyTaskDetailModel } from "@/features/tasks/model/task-detail-planning-shell-projection";
import { emptyPlanningShellState } from "../planning-shell-state";
import { createTaskEditing } from "./task-editing";
import { applyDeliverableApprovalPatch } from "../approval-domain";

export type PlanningWorkspaceRead = { data: PlanningShellState; taskCoverage?: "complete" | "partial" | "none"; headerData?: PlanningHeaderData; currentProfile?: AuthenticatedProfile | null };
type TaskSave = { task: Partial<Task>; activities?: TaskActivity[] };
export type PlanningStateAdapter = {
  saveTask(task: Task, patch: Partial<Task>): Promise<TaskSave>;
  readWorkspace(workspace: AppWorkspace): Promise<PlanningWorkspaceRead | null>;
  readTaskDetail?: (taskId: string) => Promise<{ model: TaskDetailModel; unavailable?: TaskDetailUnavailableArea[] }>;
  subscribeSession?: (listener: (userId: string | null) => void) => () => void;
};

export function createPlanningState({ userId, initialData, adapter, publishCache, acceptWorkspaceContext }: {
  userId: string;
  initialData: PlanningShellState;
  adapter: PlanningStateAdapter;
  publishCache?: (data: PlanningShellState | null) => void;
  acceptWorkspaceContext?: (result: PlanningWorkspaceRead) => void;
}) {
  let confirmed = initialData;
  let visible = initialData;
  let active = Boolean(userId);
  let sequence = 0;
  let sessionGeneration = 0;
  const taskConfirmedAt = new Map<string, number>();
  const acceptedRead = new Map<AppWorkspace, number>();
  let freshness: "current" | "stale" = "current";
  let ended = false;
  const detailReads = new Map<string, ReturnType<PlanningState["loadTaskDetail"]>>();
  const tails = new Map<string, { context: symbol; result: Promise<TaskUpdateResult> }>();
  const pending = new Map<symbol, { taskId: string; patch: Partial<Task> }>();
  const status = new Map<string, PlanningTaskSaveStatus>();
  const listeners = new Set<() => void>();
  function publish() {
    visible = { ...confirmed, tasks: confirmed.tasks.map(task => {
      let result = task;
      for (const operation of pending.values()) {
        if (operation.taskId === task.id) result = { ...result, ...operation.patch };
      }
      return result;
    }) };
    publishCache?.(active ? confirmed : null);
    listeners.forEach(listener => listener());
  }
  function saveTaskWithContext(task: Task, patch: Partial<Task>, context: symbol): Promise<TaskUpdateResult> {
      if (!active) return Promise.resolve({ ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt.", status: 409 });
      if (status.get(task.id) === "unconfirmed") return Promise.resolve({ ok: false, kind: "unconfirmed", error: "Die Speicherung ist noch nicht bestätigt." });
      const generation = sessionGeneration;
      const operation = Symbol(task.id);
      pending.set(operation, { taskId: task.id, patch: { ...patch, githubIssueSyncStatus: "not_synced", githubIssueSyncError: "", githubIssueSyncPendingSince: "" } });
      status.set(task.id, "saving");
      publish();
      const previous = tails.get(task.id);
      const saved = (async (): Promise<TaskUpdateResult> => {
        if (previous) {
          const predecessor = await previous.result;
          if (!predecessor.ok && (previous.context === context || predecessor.kind === "unconfirmed")) {
            if (active && status.get(task.id) !== "unconfirmed") { pending.delete(operation); publish(); }
            return predecessor;
          }
          if (predecessor.ok && previous.context === context) task = { ...task, updatedAt: predecessor.task.updatedAt || task.updatedAt };
        }
        if (!active || generation !== sessionGeneration) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt.", status: 409 };
        try {
          const current = confirmed.tasks.find(item => item.id === task.id);
          if (current?.updatedAt && current.updatedAt !== task.updatedAt) throw Object.assign(new Error("Aufgabe wurde zwischenzeitlich geändert. Bitte den aktuellen Stand prüfen."), { status: 409, kind: "versionConflict" });
          const result = await adapter.saveTask(task, patch);
          if (!result.task.updatedAt) throw new Error("Die Speicherung ist noch nicht bestätigt.");
          if (!active || generation !== sessionGeneration) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt.", status: 409 };
          taskConfirmedAt.set(task.id, ++sequence);
          const currentAfterWrite = confirmed.tasks.find(item => item.id === task.id);
          const foreignConfirmed = currentAfterWrite?.updatedAt !== task.updatedAt && currentAfterWrite?.updatedAt !== result.task.updatedAt;
          const saved = foreignConfirmed ? currentAfterWrite! : { ...result.task, id: task.id };
          confirmed = task.taskType === "deliverable" && saved.approvalStatus !== undefined
            ? applyDeliverableApprovalPatch(confirmed, { ...saved, approvalStatus: saved.approvalStatus })
            : { ...confirmed, tasks: confirmed.tasks.map(item => item.id === task.id ? { ...item, ...saved } : item) };
          if (result.activities?.length) confirmed = { ...confirmed, taskActivity: [...result.activities, ...confirmed.taskActivity] };
          pending.delete(operation);
          status.set(task.id, [...pending.values()].some(item => item.taskId === task.id) ? "saving" : "saved");
          publish();
          return { ok: true, task: result.task };
        } catch (error) {
          if (!active || generation !== sessionGeneration) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt.", status: 409 };
          const failure = error as { kind?: string; code?: string };
          const statusCode = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined;
          const kind = failure.kind === "versionConflict" ? "versionConflict"
            : failure.code === "session_superseded" ? "sessionSuperseded"
            : failure.code === "administrator_access_expired" || failure.code === "administrator_access_required" ? "authorityEnded"
            : statusCode && statusCode < 500 ? "rejected" : "unconfirmed";
          if (kind !== "unconfirmed") {
            pending.delete(operation);
            status.set(task.id, "rejected");
          } else {
            status.set(task.id, "unconfirmed");
            freshness = "stale";
          }
          publish();
          return { ok: false, kind, code: failure.code, status: statusCode, error: error instanceof Error ? error.message : "Änderung konnte nicht gespeichert werden." };
        }
      })();
      tails.set(task.id, { context, result: saved });
      void saved.then(() => { if (tails.get(task.id)?.result === saved && status.get(task.id) !== "unconfirmed") tails.delete(task.id); });
      return saved;
    }
  const editing = createTaskEditing({
    currentTask: taskId => confirmed.tasks.find(task => task.id === taskId) || null,
    saveTask: saveTaskWithContext,
    reload: taskId => planning.loadTaskDetail(taskId),
    generation: () => sessionGeneration,
    isActive: () => active,
    changed: publish,
  });
  const planning: PlanningState = {
    board: () => ({ tasks: visible.tasks, freshness }),
    taskDetail: taskId => ({ task: visible.tasks.find(task => task.id === taskId) || null, saveStatus: status.get(taskId) || "saved" }),
    protectedCache: () => active ? { tasks: confirmed.tasks } : null,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    taskEdits: taskId => editing.views(taskId),
    beginTaskEdit: taskId => editing.begin(taskId),
    saveTask: (task, patch) => saveTaskWithContext(task, patch, Symbol(task.id)),
    loadTaskDetail(taskId) {
      if (!active || !adapter.readTaskDetail) return Promise.resolve({ ok: false });
      const existing = detailReads.get(taskId);
      if (existing) return existing;
      const readTaskDetail = adapter.readTaskDetail;
      const loaded = (async () => {
        const generation = sessionGeneration;
        const started = ++sequence;
        const result = await readTaskDetail(taskId);
        if (!active || generation !== sessionGeneration) return { ok: false };
        const next = applyTaskDetailModel(confirmed, result.model);
        const protectedIds = new Set(confirmed.tasks.filter(task => (taskConfirmedAt.get(task.id) || 0) > started).map(task => task.id));
        confirmed = {
          ...next,
          tasks: next.tasks.map(task => protectedIds.has(task.id) ? confirmed.tasks.find(item => item.id === task.id)! : task),
          ...((taskConfirmedAt.get(taskId) || 0) > started ? { taskActivity: confirmed.taskActivity } : {}),
        };
        if (protectedIds.size) freshness = "stale";
        publish();
        return { ok: true, unavailable: result.unavailable };
      })();
      detailReads.set(taskId, loaded);
      void loaded.finally(() => { if (detailReads.get(taskId) === loaded) detailReads.delete(taskId); }).catch(() => undefined);
      return loaded;
    },
    async refreshWorkspace(workspace) {
      if (!active) return false;
      const generation = sessionGeneration;
      const started = ++sequence;
      const result = await adapter.readWorkspace(workspace);
      if (!active || generation !== sessionGeneration || !result || (acceptedRead.get(workspace) || 0) > started) return false;
      acceptedRead.set(workspace, started);
      const incomingIds = new Set(result.data.tasks.map(task => task.id));
      const protectedTasks = confirmed.tasks.filter(task =>
        (taskConfirmedAt.get(task.id) || 0) > started
        || result.taskCoverage === "none"
        || (result.taskCoverage === "partial" && !incomingIds.has(task.id)));

      const protectedIds = new Set(protectedTasks.map(task => task.id));
      confirmed = { ...result.data, tasks: [...result.data.tasks.filter(task => !protectedIds.has(task.id)), ...protectedTasks] };
      acceptWorkspaceContext?.(result);
      freshness = protectedTasks.length ? "stale" : "current";
      publish();
      return true;
    },
  };
  function suspendProtected() {
    sessionGeneration++;
    active = false;
    tails.clear();
    detailReads.clear();
    editing.clear();
    pending.clear();
    status.clear();
    confirmed = emptyPlanningShellState;
    publish();
  }
  function endSession() {
    ended = true;
    suspendProtected();
  }
  function sessionChanged(account: string | null) {
    if (!userId && !ended && account) { userId = account; return; }
    if (account !== userId) endSession();
  }
  const unsubscribeSession = adapter.subscribeSession?.(sessionChanged);
  // The legacy projection is internal migration scaffolding. Callers cannot confirm tasks through it.
  function applyLegacyProjection(update: PlanningShellState | ((current: PlanningShellState) => PlanningShellState)) {
    if (!active) return;
    const incoming = typeof update === "function" ? update(visible) : update;
    if (incoming.tasks !== visible.tasks) freshness = "stale";
    confirmed = { ...incoming, tasks: confirmed.tasks };
    publish();
  }
  function acceptHydration(data: PlanningShellState, account: string) {
    if (ended || (userId && userId !== account)) return;
    userId = account;
    active = Boolean(account);
    if (!active) return;
    // Hydration has no causal proof that it supersedes any already accepted task.
    const known = new Map(confirmed.tasks.map(task => [task.id, task]));
    confirmed = { ...data, tasks: [...data.tasks.map(task => known.get(task.id) || task), ...confirmed.tasks.filter(task => !data.tasks.some(item => item.id === task.id))] };
    publish();
  }
  function invalidateTaskViews() {
    if (!active) return;
    freshness = "stale";
    publish();
  }
  return { planning, internal: {
    getSnapshot: () => visible,
    applyLegacyProjection,
    acceptHydration,
    invalidateTaskViews,
    sessionChanged,
    suspendProtected,
    endSession,
    dispose: () => unsubscribeSession?.(),
  } };
}
