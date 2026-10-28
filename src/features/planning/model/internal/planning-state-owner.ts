import { createHeaderNotificationsState, type HeaderNotificationsAdapter } from "./header-notifications-state";
import type { BrowserSessionSnapshot } from "@/lib/credentials/browser";
import type { AuthenticatedProfile, PlanningHeaderData, PlanningShellState, Task, TaskActivity } from "@/lib/types";
import type { PlanningState, PlanningTaskSaveStatus, PlanningReadStatus, PlanningWorkspaceView, PlanningTaskSaveView } from "../planning-state";
import type { AppWorkspace } from "../workspace-routes";
import type { TaskUpdateResult } from "@/features/tasks/hooks/task-mutation-command-types";
import type { TaskDetailModel, TaskDetailUnavailableArea } from "@/features/tasks/model/task-detail-read-model";
import { applyTaskDetailModel } from "@/features/tasks/model/task-detail-planning-shell-projection";
import { emptyPlanningShellState } from "../planning-shell-state";
import { sprintViewCoverage } from "./sprint-read-coverage";
import { createSprintState } from "./sprint-state";
import { createTaskLifecycle } from "./task-lifecycle";
import type { PlanningTaskCreationInput, PlanningTaskCreationConfirmation, PlanningTaskRemovalConfirmation } from "../planning-task-lifecycle";
import { createProfileApiTokensState } from "./profile-api-tokens-state";
import { createProfileSettingsState } from "./profile-settings-state";
import type { OwnProfileSettingsConfirmation, OwnProfileSettingsPatch } from "@/features/profile/model/profile-settings-contract";
import { createTaskEditing } from "./task-editing";
import { applyDeliverableApprovalPatch } from "../approval-domain";

import { projectCoveredRead, workspaceReadCoverage, type PlanningReadCoverage } from "./planning-read-scopes";

export type PlanningWorkspaceRead = { notificationCoverage?: import("@/features/notifications/model/notifications-read-model").NotificationsWorkspaceModel["coverage"]; data: PlanningShellState; coverage?: PlanningReadCoverage; taskCoverage?: "complete" | "partial" | "none"; headerData?: PlanningHeaderData; currentProfile?: AuthenticatedProfile | null };
type TaskSave = { task: Partial<Task>; activities?: TaskActivity[] };
export type PlanningStateAdapter = HeaderNotificationsAdapter & import("@/features/profile/model/profile-api-token-state").ProfileApiTokenAdapter & {
  saveSprint?: (sprint: import("@/lib/types").Sprint, patch: import("@/features/sprint/model/sprint-editing").SprintEditPatch) => Promise<{ sprint: import("@/lib/types").Sprint }>;
  now?: () => number;
  removeTask?: (task: Task, action: "withdraw" | "reject", reason: string) => Promise<PlanningTaskRemovalConfirmation>;
  createTask?: (input: PlanningTaskCreationInput) => Promise<PlanningTaskCreationConfirmation>;
  acknowledgeFeatureTour?: (tourId: string) => Promise<import("@/lib/types").ProfileFeatureTourAcknowledgement>;
  saveOwnProfileSettings?: (patch: OwnProfileSettingsPatch) => Promise<OwnProfileSettingsConfirmation>;
  saveTask(task: Task, patch: Partial<Task>): Promise<TaskSave>;
  readWorkspace(workspace: AppWorkspace): Promise<PlanningWorkspaceRead | null>;
  readTaskDetail?: (taskId: string) => Promise<{ model: TaskDetailModel; unavailable?: TaskDetailUnavailableArea[] }>;
  subscribeSession?: (listener: (userId: string | null) => void) => () => void;
};

export function createPlanningState({ userId, initialData, initialWorkspace = "planning", initialSession, initialHeaderData, adapter, publishCache, acceptWorkspaceContext }: {
  userId: string;
  initialData: PlanningShellState;
  initialWorkspace?: AppWorkspace;
  initialSession?: BrowserSessionSnapshot;
  initialHeaderData?: PlanningHeaderData;
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
  const notifications = createHeaderNotificationsState({ initialData: active ? initialData : emptyPlanningShellState, initialHeaderData: active ? initialHeaderData : undefined, notificationsLoaded: initialWorkspace === "notifications", adapter, isActive, generation: () => sessionGeneration, changed: publish, refreshNotifications: () => planning.refreshWorkspace("notifications") });
  const profileSettings = createProfileSettingsState({ confirmed: () => confirmed, update: data => { confirmed = data; }, changed: publish, active: isActive, generation: () => sessionGeneration, readStatus: () => workspaceStatuses.get("profile") || "not-loaded", save: adapter.saveOwnProfileSettings, acknowledge: adapter.acknowledgeFeatureTour, refresh: () => planning.refreshWorkspace("profile"), nextSequence: () => ++sequence });
  const profileTokens = createProfileApiTokensState({ active: isActive, generation: () => sessionGeneration, changed: publish, adapter });
  const sprintState = createSprintState({ current: () => confirmed, update: data => { confirmed = data; }, changed: publish, active: isActive, generation: () => sessionGeneration, nextSequence: () => ++sequence, save: adapter.saveSprint, readStatus: () => workspaceStatuses.get("sprint") || "not-loaded", refresh: () => planning.refreshWorkspace("sprint") });
  function publish() {
    confirmed = notifications.projectConfirmed(lifecycle.projectConfirmed(confirmed));
    const taskView = { ...confirmed, tasks: confirmed.tasks.map(task => {
      let result = task;
      for (const operation of pending.values()) {
        if (operation.taskId === task.id) result = { ...result, ...operation.patch };
      }
      return result;
    }) };
    visible = sprintState.project(profileSettings.project(lifecycle.projectVisible(taskView)));
    visible = notifications.projectVisible(visible);
    if (!isActive()) publishCache?.(null);
    else for (const [workspace, members] of memberships) {
      if (workspaceStatuses.get(workspace) === "forbidden") publishCache?.(null, workspace);
      else publishCache?.({ ...profileSettings.protect(confirmed), tasks: confirmed.tasks.filter(task => members.has(task.id)) }, workspace);
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
    if (lifecycle.isRemoving(task)) return Promise.resolve({ ok: false, kind: "unconfirmed", code: "predecessor_unconfirmed", error: "Das Entfernen dieser Aufgabe ist noch nicht bestätigt. Diese Änderung wurde noch nicht gesendet." });
    if (lifecycle.isRemoved(task)) return Promise.resolve({ ok: false, kind: "rejected", code: "task_removed", error: "Diese Aufgabe wurde entfernt." });
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
        if (lifecycle.isRemoving(task)) throw Object.assign(new Error("Das Entfernen dieser Aufgabe ist noch nicht bestätigt. Diese Änderung wurde noch nicht gesendet."), { status: 409, code: "dependency_pending" });
        if (lifecycle.isRemoved(task)) throw Object.assign(new Error("Diese Aufgabe wurde entfernt."), { status: 409, code: "task_removed" });
        const current = confirmed.tasks.find(item => item.id === task.id);
        if (current?.updatedAt && current.updatedAt !== task.updatedAt) throw Object.assign(new Error("Aufgabe wurde zwischenzeitlich geändert. Bitte den aktuellen Stand prüfen."), { status: 409, kind: "versionConflict" });
        pending.get(operation)!.phase = "saving";
        const result = await adapter.saveTask(task, patch);
        if (!isActive() || generation !== sessionGeneration) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt.", status: 409 };
        if (lifecycle.isRemoved(task)) {
          pending.delete(operation);
          status.set(task.id, "rejected");
          publish();
          return { ok: false, kind: "rejected", code: "task_removed", error: "Diese Aufgabe wurde entfernt." };
        }
        if (!result.task.updatedAt) throw new Error("Die Speicherung ist noch nicht bestätigt.");
        if (!isActive() || generation !== sessionGeneration) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt.", status: 409 };
        taskConfirmedAt.set(task.id, ++sequence);
        notifications.invalidateHeader(["notifications"]);
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
  const lifecycle = createTaskLifecycle({
    createTask: adapter.createTask,
    removeTask: adapter.removeTask,
    checkCreation: async () => { await planning.refreshWorkspace("planning"); return planning.workspace("planning").readStatus; },
    checkRemoval: async taskId => { await planning.loadTaskDetail(taskId); return planning.taskDetail(taskId).readStatus; },
    acceptRemoval(ids, action, rootId) {
      for (const id of ids) taskConfirmedAt.set(id, ++sequence);
      for (const members of memberships.values()) for (const id of ids) members.delete(id);
      confirmed = lifecycle.projectConfirmed(confirmed);
      notifications.invalidateHeader(["notifications"]);
      if (action === "reject") { freshness = "stale"; void planning.loadTaskDetail(rootId); }
    },
    current: () => confirmed,
    capture: () => ++sequence,
    acceptCreation(result, started, relatedBasis) {
      const incoming = [result.task, ...(result.relatedTask?.updatedAt ? [result.relatedTask] : [])];
      for (const task of incoming) {
        const current = confirmed.tasks.find(item => item.id === task.id);
        const unchangedRelatedBasis = relatedBasis?.id === task.id && current?.updatedAt === relatedBasis.updatedAt;
        if (((taskConfirmedAt.get(task.id) || 0) > started || (taskReadAt.get(task.id) || 0) > started) && !unchangedRelatedBasis) { freshness = "stale"; continue; }
        const known = confirmed.tasks.some(item => item.id === task.id);
        if (known) confirmed = { ...confirmed, tasks: confirmed.tasks.map(item => item.id === task.id ? { ...item, ...task } : item) };
        else if (task.id === result.task.id) confirmed = { ...confirmed, tasks: [...confirmed.tasks, result.task] };
        else { void planning.loadTaskDetail(task.id); continue; }
        taskConfirmedAt.set(task.id, ++sequence);
      }
      for (const workspace of ["planning", "projects"] as const) if (memberships.has(workspace)) memberships.get(workspace)!.add(result.task.id);
      if (result.relation) confirmed = { ...confirmed, taskRelations: [result.relation, ...confirmed.taskRelations.filter(item => item.id !== result.relation!.id)] };
      if (result.relatedTask && !result.relatedTask.updatedAt) { freshness = "stale"; void planning.loadTaskDetail(result.relatedTask.id); }
      notifications.invalidateHeader(["notifications"]);
    },
    generation: () => sessionGeneration,
    isActive,
    changed: publish,
  });
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
    checkSprintSave: id => sprintState.check(id),
    sprintEdits: id => sprintState.views(id),
    beginSprintEdit: sprint => sprintState.begin(sprint),
    sprintWorkspace: () => {
      isActive();
      const data = sprintState.denied() ? emptyPlanningShellState : visible;
      return { readStatus: workspaceStatuses.get("sprint") || "not-loaded", model: { coverage: sprintViewCoverage(sprintState.coverage()), revision: "", project: data.project, people: data.profiles, items: sprintState.denied() ? [] : planning.workspace("sprint").tasks, sprints: data.sprints, commitments: data.sprintCommitments, scores: data.founderSprintScores, strikeStates: data.founderStrikeStates, strikeEvents: data.strikeEvents, objections: data.scoreObjections, meetings: data.meetings, attendance: data.meetingAttendance } };
    },
    ...notifications.publicState,
    createTask: input => lifecycle.createTask(input),
    taskLifecycle: () => lifecycle.views(),
    checkTaskLifecycle: id => lifecycle.check(id),
    withdrawTask: (task, reason) => lifecycle.removeTask(task, "withdraw", reason),
    rejectTask: (task, reason) => lifecycle.removeTask(task, "reject", reason),
    profileApiTokens: profileTokens.view,
    loadProfileApiTokens: profileTokens.load,
    issueProfileApiToken: profileTokens.issue,
    revokeProfileApiToken: profileTokens.revoke,
    acknowledgeFeatureTour: profileSettings.acknowledge,
    checkOwnProfileSettings: profileSettings.check,
    profileSettings: profileSettings.view,
    saveOwnProfileSettings: profileSettings.save,
    board: () => ({ tasks: planning.workspace("planning").tasks, freshness }),
    workspace: workspace => { isActive(); return ({ tasks: workspaceStatuses.get(workspace) === "forbidden" ? [] : visible.tasks.filter(task => memberships.get(workspace)?.has(task.id) || ((workspace === "planning" || workspace === "projects") && lifecycle.isTemporary(task.id))), readStatus: workspaceStatuses.get(workspace) || "not-loaded", completeness: completeness.get(workspace) || "none" }); },
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
    protectedCache(workspace) {
      if (!isActive() || (workspace && (!memberships.has(workspace) || workspaceStatuses.get(workspace) === "forbidden"))) return null;
      const data = profileSettings.protect(confirmed);
      return { tasks: data.tasks.filter(task => !deniedTaskReads.has(task.id) && (!workspace || memberships.get(workspace)?.has(task.id))), profiles: data.profiles, sprints: data.sprints, notificationPreferences: data.notificationPreferences, profileUiPreferences: data.profileUiPreferences, profileFeatureTourAcknowledgements: data.profileFeatureTourAcknowledgements };
    },
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
        const detailProjection = applyTaskDetailModel(confirmed, result.model, result.unavailable, result.model.coverage || {});
        const sprintRead = sprintState.acceptRead(detailProjection, { sprints: "partial" }, started, { ...detailProjection, sprints: [...result.model.sprints] });
        const next = sprintRead.data;
        if (!result.unavailable?.includes("relationships")) lifecycle.acceptRelationshipRead(next, started, result.model.coverage?.relationships === "complete", taskId);
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
        if (sprintRead.stale || returnedTasks.some(task => protectedIds.has(task.id))) {
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
      const notificationRead = notifications.beginWorkspaceRead(workspace);
      acceptedRead.set(workspace, started);
      workspaceStatuses.set(workspace, "loading");
      publish();
      let result: PlanningWorkspaceRead | null;
      try { result = await adapter.readWorkspace(workspace); }
      catch (error) {
        if (!isActive() || generation !== sessionGeneration || acceptedRead.get(workspace) !== started) return false;
        notifications.workspaceFailed(workspace, error);
        workspaceStatuses.set(workspace, readErrorStatus(error));
        if (workspace === "sprint") sprintState.readStatus(readErrorStatus(error));
        if (workspace === "profile") profileSettings.readStatus(readErrorStatus(error));
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
      const covered = projectCoveredRead(confirmed, result.data, coverage);
      if (coverage.taskRelations) lifecycle.acceptRelationshipRead(covered, started, coverage.taskRelations === "complete");
      const profileRead = profileSettings.acceptRead(covered, coverage, started);
      const sprintRead = sprintState.acceptRead(profileRead.data, coverage, started, result.data);
      confirmed = {
        ...sprintRead.data,
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
      const stale = sprintRead.stale || profileRead.stale || incoming.some(task => protectedIds.has(task.id)) || (taskCoverage === "complete" && [...protectedIds].some(id => memberships.get(workspace)?.has(id)));
      workspaceStatuses.set(workspace, stale ? "stale" : "current");
      notifications.acceptWorkspaceRead(workspace, result.data, result.headerData, notificationRead, result.notificationCoverage);
      if (workspace === "profile") profileSettings.readStatus(stale ? "stale" : "current");
      if (workspace === "sprint") sprintState.readStatus(stale ? "stale" : "current");
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
    lifecycle.clear();
    sprintState.clear();
    profileSettings.clear();
    profileTokens.clear();
    pending.clear();
    status.clear();
    memberships.clear();
    workspaceStatuses.clear();
    completeness.clear();
    detailStatuses.clear();
    deniedTaskReads.clear();
    confirmed = emptyPlanningShellState;
    notifications.clear();
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
    confirmed = { ...incoming, ...profileSettings.preserveOwned(confirmed), tasks: confirmed.tasks, sprints: confirmed.sprints };
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
    confirmedHeader: notifications.confirmedHeader,
    acceptHeaderHydration: notifications.hydrateHeader,
    invalidateHeader: notifications.invalidateHeader,
    invalidateNotificationAuthority: notifications.invalidateNotificationAuthority,
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
