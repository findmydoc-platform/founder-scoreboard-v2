import type { BrowserSessionSnapshot } from "@/lib/credentials/browser";
import type { AuthenticatedProfile, PlanningHeaderData, PlanningShellState, Task, TaskActivity } from "@/lib/types";
import type { PlanningState, PlanningTaskSaveStatus, PlanningReadStatus, PlanningWorkspaceView, PlanningTaskSaveView } from "../planning-state";
import type { AppWorkspace } from "../workspace-routes";
import type { TaskUpdateResult } from "@/features/tasks/hooks/task-mutation-command-types";
import type { TaskDetailModel, TaskDetailUnavailableArea } from "@/features/tasks/model/task-detail-read-model";
import { applyTaskDetailModel } from "@/features/tasks/model/task-detail-planning-shell-projection";
import { emptyPlanningShellState } from "../planning-shell-state";
import { createTaskEditing } from "./task-editing";
import { applyDeliverableApprovalPatch } from "../approval-domain";

import { projectCoveredRead, workspaceReadCoverage, type PlanningReadCoverage } from "./planning-read-scopes";

export type PlanningWorkspaceRead = { data: PlanningShellState; coverage?: PlanningReadCoverage; taskCoverage?: "complete" | "partial" | "none"; headerData?: PlanningHeaderData; currentProfile?: AuthenticatedProfile | null };
type TaskSave = { task: Partial<Task>; activities?: TaskActivity[] };
export type PlanningStateAdapter = {
  now?: () => number;
  saveTask(task: Task, patch: Partial<Task>): Promise<TaskSave>;
  readWorkspace(workspace: AppWorkspace): Promise<PlanningWorkspaceRead | null>;
  readTaskDetail?: (taskId: string) => Promise<{ model: TaskDetailModel; unavailable?: TaskDetailUnavailableArea[] }>;
  subscribeSession?: (listener: (userId: string | null) => void) => () => void;
};

export function createPlanningState({ userId, initialData, initialWorkspace = "planning", initialSession, adapter, publishCache, acceptWorkspaceContext }: {
  userId: string;
  initialData: PlanningShellState;
  initialWorkspace?: AppWorkspace;
  initialSession?: BrowserSessionSnapshot;
  adapter: PlanningStateAdapter;
  publishCache?: (data: PlanningShellState | null, workspace?: AppWorkspace) => void;
  acceptWorkspaceContext?: (result: PlanningWorkspaceRead) => void;
}) {
  let confirmed = initialData;
  let visible = initialData;
  let active = Boolean(userId);
  let initialized = active;
  let sequence = 0;
  let sessionGeneration = 0;
  let sessionExpiresAt = initialSession?.expiresAt;
  const taskConfirmedAt = new Map<string, number>();
  const taskReadAt = new Map<string, number>();
  const memberships = new Map<AppWorkspace, Set<string>>([[initialWorkspace, new Set(initialData.tasks.map(task => task.id))]]);
  const workspaceStatuses = new Map<AppWorkspace, PlanningReadStatus>([[initialWorkspace, "current"]]);
  const completeness = new Map<AppWorkspace, PlanningWorkspaceView["completeness"]>([[initialWorkspace, workspaceReadCoverage(initialWorkspace).tasks || "none"]]);
  const acceptedRead = new Map<AppWorkspace, number>();
  let freshness: "current" | "stale" = "current";
  let ended = false;
  const detailUnavailable = new Map<string, TaskDetailUnavailableArea[]>();
  const deniedTaskReads = new Set<string>();
  const detailStatuses = new Map<string, PlanningReadStatus>();
  const detailReads = new Map<string, ReturnType<PlanningState["loadTaskDetail"]>>();
  const tails = new Map<string, { context: symbol; result: Promise<TaskUpdateResult> }>();
  const pending = new Map<symbol, { taskId: string; patch: Partial<Task>; submitted: Partial<Task>; phase: PlanningTaskSaveView["phase"] }>();
  const outcomeChecks = new Map<string, ReturnType<PlanningState["checkTaskSave"]>>();
  const outcomeCheckStatus = new Map<string, PlanningTaskSaveView["checkStatus"]>();
  const status = new Map<string, PlanningTaskSaveStatus>();
  const listeners = new Set<() => void>();
  function isActive() {
    if (active && sessionExpiresAt !== undefined && sessionExpiresAt * 1000 <= (adapter.now?.() ?? Date.now())) suspendProtected();
    return active;
  }
  function readErrorStatus(error: unknown): "forbidden" | "unavailable" {
    return typeof error === "object" && error !== null && "status" in error && (error.status === 401 || error.status === 403) ? "forbidden" : "unavailable";
  }
  function publish() {
    visible = { ...confirmed, tasks: confirmed.tasks.map(task => {
      let result = task;
      for (const operation of pending.values()) {
        if (operation.taskId === task.id) result = { ...result, ...operation.patch };
      }
      return result;
    }) };
    if (!isActive()) publishCache?.(null);
    else for (const [workspace, members] of memberships) {
      if (workspaceStatuses.get(workspace) === "forbidden") publishCache?.(null, workspace);
      else publishCache?.({ ...confirmed, tasks: confirmed.tasks.filter(task => members.has(task.id)) }, workspace);
    }
    listeners.forEach(listener => listener());
  }
  function saveTaskWithContext(task: Task, patch: Partial<Task>, context: symbol): Promise<TaskUpdateResult> {
    if (!isActive()) return Promise.resolve({ ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt.", status: 409 });
    if (status.get(task.id) === "unconfirmed") {
      pending.set(Symbol(task.id), { taskId: task.id, submitted: structuredClone(patch), patch: structuredClone(patch), phase: "blocked" });
      publish();
      return Promise.resolve({ ok: false, kind: "unconfirmed", code: "predecessor_unconfirmed", error: "Eine vorherige Speicherung ist noch nicht bestätigt. Diese Änderung wurde noch nicht gesendet." });
    }
    const generation = sessionGeneration;
    const operation = Symbol(task.id);
    const previous = tails.get(task.id);
    pending.set(operation, { taskId: task.id, submitted: structuredClone(patch), phase: previous ? "queued" : "saving", patch: { ...patch, githubIssueSyncStatus: "not_synced", githubIssueSyncError: "", githubIssueSyncPendingSince: "" } });
    status.set(task.id, "saving");
    publish();
    const saved = (async (): Promise<TaskUpdateResult> => {
      if (previous) {
        const predecessor = await previous.result;
        if (!predecessor.ok && (previous.context === context || status.get(task.id) === "unconfirmed")) {
          if (isActive() && generation === sessionGeneration && status.get(task.id) === "unconfirmed") {
            pending.get(operation)!.phase = "blocked";
            publish();
            return { ok: false, kind: "unconfirmed", code: "predecessor_unconfirmed", error: "Eine vorherige Speicherung ist noch nicht bestätigt. Diese Änderung wurde noch nicht gesendet." };
          }
          if (isActive()) { pending.delete(operation); publish(); }
          return predecessor;
        }
        if (predecessor.ok && previous.context === context) task = { ...task, updatedAt: predecessor.task.updatedAt || task.updatedAt };
      }
      if (!isActive() || generation !== sessionGeneration) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt.", status: 409 };
      try {
        const current = confirmed.tasks.find(item => item.id === task.id);
        if (current?.updatedAt && current.updatedAt !== task.updatedAt) throw Object.assign(new Error("Aufgabe wurde zwischenzeitlich geändert. Bitte den aktuellen Stand prüfen."), { status: 409, kind: "versionConflict" });
        pending.get(operation)!.phase = "saving";
        const result = await adapter.saveTask(task, patch);
        if (!result.task.updatedAt) throw new Error("Die Speicherung ist noch nicht bestätigt.");
        if (!isActive() || generation !== sessionGeneration) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt.", status: 409 };
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
        if (!isActive() || generation !== sessionGeneration) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt.", status: 409 };
        const failure = error && typeof error === "object" ? error as { kind?: string; code?: string } : {};
        const statusCode = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined;
        const kind = failure.kind === "versionConflict" ? "versionConflict"
          : failure.code === "session_superseded" ? "sessionSuperseded"
          : failure.code === "administrator_access_expired" || failure.code === "administrator_access_required" ? "authorityEnded"
          : statusCode && statusCode < 500 ? "rejected" : "unconfirmed";
        if (kind !== "unconfirmed" && kind !== "sessionSuperseded") {
          pending.delete(operation);
          status.set(task.id, "rejected");
        } else {
          pending.get(operation)!.phase = "unconfirmed";
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
    checkOutcome: taskId => planning.checkTaskSave(taskId),
    generation: () => sessionGeneration,
    isActive,
    canReadTask: taskId => !deniedTaskReads.has(taskId),
    changed: publish,
  });
  const planning: PlanningState = {
    board: () => ({ tasks: planning.workspace("planning").tasks, freshness }),
    workspace: workspace => { isActive(); return ({ tasks: workspaceStatuses.get(workspace) === "forbidden" ? [] : visible.tasks.filter(task => memberships.get(workspace)?.has(task.id)), readStatus: workspaceStatuses.get(workspace) || "not-loaded", completeness: completeness.get(workspace) || "none" }); },
    taskDetail: taskId => { isActive(); return ({
      task: deniedTaskReads.has(taskId) ? null : visible.tasks.find(task => task.id === taskId) || null,
      saveStatus: status.get(taskId) || "saved", unavailable: detailUnavailable.get(taskId) || [], readStatus: detailStatuses.get(taskId) || "not-loaded",
      comments: deniedTaskReads.has(taskId) ? [] : visible.taskComments.filter(item => item.taskId === taskId),
      externalComments: deniedTaskReads.has(taskId) ? [] : visible.taskExternalComments.filter(item => item.taskId === taskId),
      blockers: deniedTaskReads.has(taskId) ? [] : visible.taskBlockers.filter(item => item.taskId === taskId),
      relationships: deniedTaskReads.has(taskId) ? [] : visible.taskRelations.filter(item => item.taskId === taskId || item.relatedTaskId === taskId),
      activities: deniedTaskReads.has(taskId) ? [] : visible.taskActivity.filter(item => item.taskId === taskId),
      reviews: deniedTaskReads.has(taskId) ? [] : visible.taskReviews.filter(item => item.taskId === taskId),
    }); },
    protectedCache: workspace => isActive() && (!workspace || (memberships.has(workspace) && workspaceStatuses.get(workspace) !== "forbidden")) ? { tasks: workspace ? confirmed.tasks.filter(task => memberships.get(workspace)?.has(task.id)) : confirmed.tasks } : null,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    taskSaves: taskId => {
      if (!isActive()) return [];
      const forbidden = deniedTaskReads.has(taskId);
      return [...pending.values()].filter(operation => operation.taskId === taskId).map(operation => ({
        phase: operation.phase, submitted: forbidden ? null : operation.submitted,
        checkStatus: outcomeCheckStatus.get(taskId) || "not-checked",
        serverTask: forbidden || outcomeCheckStatus.get(taskId) !== "checked" ? null : confirmed.tasks.find(task => task.id === taskId) || null,
      }));
    },
    checkTaskSave(taskId) {
      if (!isActive()) return Promise.resolve({ outcome: "session-ended", readStatus: "not-needed" });
      if (status.get(taskId) !== "unconfirmed") return Promise.resolve({ outcome: "not-pending", readStatus: "not-needed" });
      const existing = outcomeChecks.get(taskId);
      if (existing) return existing;
      const generation = sessionGeneration;
      outcomeCheckStatus.set(taskId, "checking");
      publish();
      const checked = (async (): ReturnType<PlanningState["checkTaskSave"]> => {
        const read = await planning.loadTaskDetail(taskId);
        if (!isActive() || generation !== sessionGeneration) return { outcome: "session-ended", readStatus: "not-needed" };
        const readStatus = detailStatuses.get(taskId) || "unavailable";
        outcomeCheckStatus.set(taskId, read.ok ? "checked" : readStatus === "forbidden" ? "forbidden" : "unavailable");
        publish();
        // A current record does not prove that this write and its side effects completed.
        return { outcome: "unconfirmed", readStatus };
      })();
      outcomeChecks.set(taskId, checked);
      void checked.finally(() => { if (outcomeChecks.get(taskId) === checked) outcomeChecks.delete(taskId); });
      return checked;
    },
    taskEdits: taskId => { isActive(); return editing.views(taskId); },
    beginTaskEdit: taskId => editing.begin(taskId),
    saveTask: (task, patch) => saveTaskWithContext(task, patch, Symbol(task.id)),
    loadTaskDetail(taskId) {
      if (!isActive() || !adapter.readTaskDetail) return Promise.resolve({ ok: false });
      const existing = detailReads.get(taskId);
      if (existing) return existing;
      const readTaskDetail = adapter.readTaskDetail;
      detailStatuses.set(taskId, "loading");
      publish();
      const loaded = (async () => {
        const generation = sessionGeneration;
        const started = ++sequence;
        let result: Awaited<ReturnType<typeof readTaskDetail>>;
        try {
          result = await readTaskDetail(taskId);
          if (result.model.item.id !== taskId) throw new Error("Die Detailantwort gehört zu einer anderen Aufgabe.");
        } catch (error) {
          if (!isActive() || generation !== sessionGeneration) return { ok: false };
          const failedStatus = readErrorStatus(error);
          if (failedStatus === "forbidden") deniedTaskReads.add(taskId);
          detailStatuses.set(taskId, failedStatus);
          publish();
          return { ok: false, error: error instanceof Error ? error.message : "Task-Details konnten nicht geladen werden." };
        }
        if (!isActive() || generation !== sessionGeneration) return { ok: false };
        const next = applyTaskDetailModel(confirmed, result.model, result.unavailable, result.model.coverage || {});
        deniedTaskReads.delete(taskId);
        detailUnavailable.set(taskId, result.unavailable || []);
        detailStatuses.set(taskId, result.unavailable?.length ? "unavailable" : "current");
        const protectedIds = new Set(confirmed.tasks.filter(task => (taskConfirmedAt.get(task.id) || 0) > started || (taskReadAt.get(task.id) || 0) > started).map(task => task.id));
        confirmed = {
          ...next,
          tasks: next.tasks.map(task => protectedIds.has(task.id) ? confirmed.tasks.find(item => item.id === task.id)! : task),
          ...((taskConfirmedAt.get(taskId) || 0) > started ? { taskActivity: confirmed.taskActivity } : {}),
        };
        const returnedTasks = [result.model.item, ...result.model.ancestors, ...result.model.children, ...result.model.relatedItems];
        for (const task of returnedTasks) {
          if (!protectedIds.has(task.id)) taskReadAt.set(task.id, started);
        }
        if (returnedTasks.some(task => protectedIds.has(task.id))) {
          freshness = "stale";
          if (!result.unavailable?.length) detailStatuses.set(taskId, "stale");
        }
        publish();
        return { ok: true, unavailable: result.unavailable };
      })();
      detailReads.set(taskId, loaded);
      void loaded.finally(() => { if (detailReads.get(taskId) === loaded) detailReads.delete(taskId); }).catch(() => undefined);
      return loaded;
    },
    async refreshWorkspace(workspace) {
      if (!isActive()) return false;
      const generation = sessionGeneration;
      const started = ++sequence;
      acceptedRead.set(workspace, started);
      workspaceStatuses.set(workspace, "loading");
      publish();
      let result: PlanningWorkspaceRead | null;
      try { result = await adapter.readWorkspace(workspace); }
      catch (error) {
        if (!isActive() || generation !== sessionGeneration || acceptedRead.get(workspace) !== started) return false;
        workspaceStatuses.set(workspace, readErrorStatus(error));
        publish();
        return false;
      }
      if (!isActive() || generation !== sessionGeneration || acceptedRead.get(workspace) !== started) return false;
      if (!result) {
        workspaceStatuses.set(workspace, "unavailable");
        publish();
        return false;
      }
      const coverage = result.coverage || workspaceReadCoverage(workspace);
      const taskCoverage = result.taskCoverage === "none" ? undefined : result.taskCoverage || coverage.tasks;
      const incoming = taskCoverage ? result.data.tasks : [];
      const protectedIds = new Set(confirmed.tasks.filter(task => (taskConfirmedAt.get(task.id) || 0) > started || (taskReadAt.get(task.id) || 0) > started).map(task => task.id));
      const replacements = new Map(incoming.filter(task => !protectedIds.has(task.id)).map(task => [task.id, task]));
      const known = new Set(confirmed.tasks.map(task => task.id));
      for (const task of replacements.values()) taskReadAt.set(task.id, started);
      confirmed = {
        ...projectCoveredRead(confirmed, result.data, coverage),
        tasks: [...confirmed.tasks.map(task => replacements.get(task.id) || task), ...incoming.filter(task => !known.has(task.id))],
      };
      if (taskCoverage) {
        const members = taskCoverage === "complete" ? new Set<string>() : new Set(memberships.get(workspace));
        incoming.forEach(task => members.add(task.id));
        for (const id of protectedIds) if (memberships.get(workspace)?.has(id)) members.add(id);
        memberships.set(workspace, members);
      }
      if (!memberships.has(workspace)) memberships.set(workspace, new Set());
      completeness.set(workspace, taskCoverage || "none");
      const stale = incoming.some(task => protectedIds.has(task.id)) || (taskCoverage === "complete" && [...protectedIds].some(id => memberships.get(workspace)?.has(id)));
      workspaceStatuses.set(workspace, stale ? "stale" : "current");
      acceptWorkspaceContext?.(result);
      freshness = stale ? "stale" : "current";
      publish();
      return true;
    },
  };
  function suspendProtected() {
    sessionGeneration++;
    active = false;
    initialized = false;
    tails.clear();
    detailReads.clear();
    outcomeChecks.clear();
    outcomeCheckStatus.clear();
    editing.clear();
    pending.clear();
    status.clear();
    memberships.clear();
    workspaceStatuses.clear();
    completeness.clear();
    detailStatuses.clear();
    deniedTaskReads.clear();
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
  function bindSession(session: BrowserSessionSnapshot | null) {
    sessionChanged(session?.userId || null);
    if (session?.userId === userId && !ended) sessionExpiresAt = session.expiresAt;
    isActive();
  }
  const unsubscribeSession = adapter.subscribeSession?.(sessionChanged);
  // The legacy projection is internal migration scaffolding. Callers cannot confirm tasks through it.
  function applyLegacyProjection(update: PlanningShellState | ((current: PlanningShellState) => PlanningShellState)) {
    if (!isActive()) return;
    const incoming = typeof update === "function" ? update(visible) : update;
    if (incoming.tasks !== visible.tasks) freshness = "stale";
    confirmed = { ...incoming, tasks: confirmed.tasks };
    publish();
  }
  function acceptHydration(data: PlanningShellState, account: string, workspace: AppWorkspace = initialWorkspace) {
    if (ended || (userId && userId !== account)) return;
    userId = account;
    active = Boolean(account);
    if (!isActive()) return;
    // Page/cache snapshots carry no request token. They cannot prove that any existing scope is newer.
    if (initialized) {
      workspaceStatuses.set(workspace, "stale");
      freshness = "stale";
      publish();
      void planning.refreshWorkspace(workspace);
      return;
    }
    initialized = true;
    const coverage = workspaceReadCoverage(workspace);
    const known = new Set(confirmed.tasks.map(task => task.id));
    confirmed = { ...projectCoveredRead(confirmed, data, coverage), tasks: [...confirmed.tasks, ...data.tasks.filter(task => !known.has(task.id))] };
    memberships.set(workspace, new Set(data.tasks.map(task => task.id)));
    workspaceStatuses.set(workspace, "current");
    completeness.set(workspace, coverage.tasks || "none");
    publish();
  }
  function invalidateTaskViews() {
    if (!isActive()) return;
    freshness = "stale";
    publish();
  }
  return { planning, internal: {
    getSnapshot: () => visible,
    applyLegacyProjection,
    acceptHydration,
    invalidateTaskViews,
    sessionChanged,
    bindSession,
    suspendProtected,
    endSession,
    dispose: () => unsubscribeSession?.(),
  } };
}
