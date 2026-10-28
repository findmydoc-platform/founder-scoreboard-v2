import { createTaskGitHubImports } from "./task-github-comment-imports";
import { createAdministrationPersonState } from "./administration-person-state";
import { createTaskCommentCreations } from "./task-comment-creations";
import { createTaskBlockerReports } from "./task-blocker-reports";
import { createBacklogOrdering } from "./backlog-ordering-state";
import { createBacklogAssignments } from "./backlog-assignment-state";
import { createToolsState } from "./tool-state";
import { createGoogleWorkspaceState } from "./google-workspace-state";
import { createPrivateWorkweekState } from "./private-workweek-state";
import { createEventsState } from "./event-state";
import { createPublishedWorkweekCalendars } from "./published-workweek-calendars";
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
import { createSprintLockState } from "./sprint-lock-state";
import { createSprintPlanState } from "./sprint-plan-state";
import { createReviewWindowState } from "./review-window-state";
import { createSprintState } from "./sprint-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { createTaskLifecycle } from "./task-lifecycle";
import type { PlanningTaskCreationInput, PlanningTaskCreationConfirmation, PlanningTaskRemovalConfirmation } from "../planning-task-lifecycle";
import { createProfileApiTokensState } from "./profile-api-tokens-state";
import { createProfileSettingsState } from "./profile-settings-state";
import type { OwnProfileSettingsConfirmation, OwnProfileSettingsPatch } from "@/features/profile/model/profile-settings-contract";
import { createTaskEditing } from "./task-editing";
import { applyDeliverableApprovalPatch } from "../approval-domain";

import { projectCoveredRead, workspaceReadCoverage, type PlanningReadCoverage } from "./planning-read-scopes";

export type PlanningWorkspaceRead = { backlogCoverage?: import("@/features/backlog/model/backlog-read-model").BacklogReadCoverage; taskOmittedFields?: readonly (keyof Task)[]; toolCoverage?: "complete" | "partial"; eventCoverage?: import("@/features/events/model/event-state").EventCoverage; notificationCoverage?: import("@/features/notifications/model/notifications-read-model").NotificationsWorkspaceModel["coverage"]; data: PlanningShellState; coverage?: PlanningReadCoverage; taskCoverage?: "complete" | "partial" | "none"; headerData?: PlanningHeaderData; currentProfile?: AuthenticatedProfile | null };
type TaskSave = { task: Partial<Task>; activities?: TaskActivity[] };
export type PlanningStateAdapter = import("@/features/team-workweek/model/google-workspace-state").GoogleWorkspaceAdapter & import("@/features/tasks/model/task-github-comment-import").TaskGitHubImportAdapter & import("@/features/tasks/model/task-comment-creation").TaskCommentCreationAdapter & import("@/features/administration/model/administration-state").AdministrationPersonAdapter & import("@/features/tasks/model/task-blocker-report").TaskBlockerReportAdapter & import("@/features/backlog/model/backlog-ordering").BacklogOrderingAdapter & import("@/features/backlog/model/backlog-assignment").BacklogAssignmentAdapter & import("@/features/team-workweek/model/private-workweek-planning-state").PrivateWorkweekAdapter & import("@/features/tools/model/tool-state").ToolsAdapter & import("@/features/events/model/event-state").EventsAdapter & HeaderNotificationsAdapter & import("@/features/profile/model/profile-api-token-state").ProfileApiTokenAdapter & {
  lockSprint?: (basis: import("@/features/sprint/model/sprint-lock").SprintLockBasis) => Promise<import("@/features/sprint/model/sprint-lock").SprintLockReceipt>;
  readSprintLock?: (sprintId: string) => Promise<import("@/features/sprint/model/sprint-lock").SprintLockObservation>;

  createSprintPlan?: (options: import("@/features/sprint/model/sprint-planning-options").SprintPlanningOptions, basis: import("@/features/sprint/model/sprint-plan").SprintPlanBasis) => Promise<import("@/features/sprint/model/sprint-plan").SprintPlanConfirmation>;
  saveReviewWindow?: (expectedHours: number, hours: number) => Promise<import("@/features/sprint/model/review-window-editing").ReviewWindowConfirmation>;
  saveSprint?: (sprint: import("@/lib/types").Sprint, patch: import("@/features/sprint/model/sprint-editing").SprintEditPatch) => Promise<{ sprint: import("@/lib/types").Sprint }>;
  readWorkweekCalendar?: (scope: import("@/features/team-workweek/model/published-workweek-calendar-state").WorkweekCalendarScope) => Promise<import("@/features/team-workweek/model/published-workweek-calendar-state").WorkweekCalendarResponse>;
  now?: () => number;
  removeTask?: (task: Task, action: "withdraw" | "reject", reason: string) => Promise<PlanningTaskRemovalConfirmation>;
  createTask?: (input: PlanningTaskCreationInput) => Promise<PlanningTaskCreationConfirmation>;
  acknowledgeFeatureTour?: (tourId: string) => Promise<import("@/lib/types").ProfileFeatureTourAcknowledgement>;
  saveTeamProfile?: (profileId: string, patch: import("../planning-team-state").TeamProfilePatch, expected: Record<string, unknown>) => Promise<Partial<import("@/lib/types").Profile> & { id: string }>;
  saveOwnProfileSettings?: (patch: OwnProfileSettingsPatch) => Promise<OwnProfileSettingsConfirmation>;
  saveTask(task: Task, patch: Partial<Task>): Promise<TaskSave>;
  readWorkspace(workspace: AppWorkspace): Promise<PlanningWorkspaceRead | null>;
  readTaskDetail?: (taskId: string) => Promise<{ model: TaskDetailModel; unavailable?: TaskDetailUnavailableArea[] }>;
  subscribeSession?: (listener: (userId: string | null) => void) => () => void;
};

export function createPlanningState({ userId, initialData, initialWorkspace = "planning", initialSession, initialHeaderData, initialAdministrationAuthority, administrationActorProfileId, adapter, publishCache, acceptWorkspaceContext }: {
  userId: string;
  initialData: PlanningShellState;
  initialWorkspace?: AppWorkspace;
  initialSession?: BrowserSessionSnapshot;
  initialHeaderData?: PlanningHeaderData;
  administrationActorProfileId?: string;
  initialAdministrationAuthority?: import("@/features/administrator-access/model/administrator-access").AuthorityProjection;
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
  let backlogCoverage: import("@/features/backlog/model/backlog-read-model").BacklogReadCoverage = {};
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
  const workweekCalendars = createPublishedWorkweekCalendars({ active: isActive, generation: () => sessionGeneration, changed: publish, now: () => adapter.now?.() ?? Date.now(), read: adapter.readWorkweekCalendar });
  const privateWorkweek = createPrivateWorkweekState({ adapter, active: isActive, generation: () => sessionGeneration, changed: () => { if (!googleWorkspace.privateContextChanged()) publish(); }, published: workweekCalendars.invalidatePublishedWorkweeks, publicationBlocked: () => googleWorkspace.blocksPublication() });
  const googleWorkspace = createGoogleWorkspaceState({ adapter, active: isActive, generation: () => sessionGeneration, changed: publish, invalidate: workweekCalendars.invalidatePublishedWorkweeks, privateBusy: privateWorkweek.publicationBusy, privateContext: privateWorkweek.disconnectBinding, privateChanged: privateWorkweek.connectionChanged });
  const administration = createAdministrationPersonState({ actorRole: () => confirmed.profiles.find(profile => profile.id === administrationActorProfileId)?.platformRole || null, active: isActive, generation: () => sessionGeneration, changed: publish, now: () => adapter.now?.() ?? Date.now(), profiles: () => visible.profiles, nextSequence: () => ++sequence, acceptCommonPeople: (people, started) => profileSettings.acceptAdministrationPeople(people, started), commonProject: () => confirmed.project, acceptCommonProject: project => { confirmed = {...confirmed,project:{...confirmed.project,githubProjectOwner:project.owner,githubProjectNumber:project.number}}; }, initialAuthority: initialAdministrationAuthority, read: adapter.readAdministration, adapter });
  const notifications = createHeaderNotificationsState({ initialData: active ? initialData : emptyPlanningShellState, initialHeaderData: active ? initialHeaderData : undefined, notificationsLoaded: initialWorkspace === "notifications", adapter, isActive, generation: () => sessionGeneration, changed: publish, refreshNotifications: () => planning.refreshWorkspace("notifications") });
  const events = createEventsState({ initial: active ? initialData.events : [], loaded: initialWorkspace === "events", adapter, active: isActive, generation: () => sessionGeneration, changed: publish, invalidateCalendar: () => notifications.invalidateHeader(["calendarEvents"]), refreshWorkspace: () => planning.refreshWorkspace("events"), endSession,
    beginHeaderRead: () => notifications.beginWorkspaceRead("events"),
    acceptHeaderRead: (data, started) => notifications.acceptWorkspaceRead("events", confirmed, { ...emptyPlanningHeaderData, calendarEvents: notifications.publicState.header().slots.calendarEvents.readStatus === "not-loaded" ? emptyPlanningHeaderData.calendarEvents : data.calendarEvents }, started),
  });
  const tools = createToolsState({ initial: active ? initialData.fmdTools : [], loaded: initialWorkspace === "tools", adapter, active: isActive, generation: () => sessionGeneration, changed: publish, endSession, invalidateQuickLinks: () => notifications.invalidateHeader(["quickLinks"]), refreshWorkspace: () => planning.refreshWorkspace("tools"), beginHeaderRead: () => notifications.beginWorkspaceRead("tools"), acceptHeaderRead: (data, started) => notifications.acceptWorkspaceRead("tools", confirmed, { ...emptyPlanningHeaderData, quickLinks: notifications.publicState.header().slots.quickLinks.readStatus === "not-loaded" ? emptyPlanningHeaderData.quickLinks : data.quickLinks }, started) });
  const blockerReports = createTaskBlockerReports({ initial: active ? initialData.taskBlockers : [], adapter, active: isActive, generation: () => sessionGeneration, changed: publish, nextSequence: () => ++sequence,
    canRead: id => !deniedTaskReads.has(id) && confirmed.tasks.some(task => task.id === id && !lifecycle.isRemoved(task)),
    dependencyPending: task => githubImports.blocksTask(task.id) || lifecycle.isRemoving(task) || backlogAssignments.blocksTask(task.id) || backlogOrdering.blocksTask(task.id) || sprintLock.blocksTask(task) || taskSchedulePending(task.id),
    invalidateTask(id) { taskConfirmedAt.set(id, ++sequence); freshness = "stale"; detailStatuses.set(id, "stale"); for (const [workspace, members] of memberships) if (members.has(id)) workspaceStatuses.set(workspace, "stale"); },
    invalidateNotifications: () => notifications.invalidateHeader(["notifications"]), endSession, refresh: reloadBlockerTask,
  });
  const commentCreations = createTaskCommentCreations({ initial: active ? initialData.taskComments : [], adapter, active: isActive, generation: () => sessionGeneration, changed: publish, nextSequence: () => ++sequence,
    canRead: id => !deniedTaskReads.has(id) && confirmed.tasks.some(task => task.id === id && !lifecycle.isRemoved(task)), removing: task => lifecycle.isRemoving(task), detailStatus: id => detailStatuses.get(id) || "not-loaded", endSession,
    invalidateNotifications: () => notifications.invalidateHeader(["notifications"]), refresh: reloadCommentDiscussion,
  });
  const githubImports = createTaskGitHubImports({ initial: active ? initialData.taskExternalComments : [], adapter, active: isActive, generation: () => sessionGeneration, changed: publish, nextSequence: () => ++sequence,
    canRead: id => !deniedTaskReads.has(id) && confirmed.tasks.some(task => task.id === id && !lifecycle.isRemoved(task)),
    dependencyPending: task => lifecycle.isRemoving(task) || blockerReports.blocksTask(task.id) || backlogAssignments.blocksTask(task.id) || backlogOrdering.blocksTask(task.id) || sprintLock.blocksTask(task) || taskSchedulePending(task.id) || [...pending.values()].some(item => item.taskId === task.id),
    invalidateTask(id) { taskConfirmedAt.set(id, ++sequence); freshness = "stale"; detailStatuses.set(id, "stale"); for (const [workspace, members] of memberships) if (members.has(id)) workspaceStatuses.set(workspace, "stale"); },
    invalidateNotifications: () => notifications.invalidateHeader(["notifications"]), endSession, refresh: reloadGitHubImport,
  });
  const profileSettings = createProfileSettingsState({ confirmed: () => confirmed, update: data => { confirmed = data; }, changed: publish, active: isActive, generation: () => sessionGeneration, initialWorkspace, readStatus: (workspace = "profile") => workspaceStatuses.get(workspace) || "not-loaded", save: adapter.saveOwnProfileSettings, saveTeam: adapter.saveTeamProfile, governanceAuthorityChanged: notifications.invalidateNotificationAuthority, refreshTeam: () => planning.refreshWorkspace("team"), acknowledge: adapter.acknowledgeFeatureTour, refresh: () => planning.refreshWorkspace("profile"), nextSequence: () => ++sequence });
  const profileTokens = createProfileApiTokensState({ active: isActive, generation: () => sessionGeneration, changed: publish, adapter });
  const sprintState = createSprintState({ current: () => confirmed, update: data => { confirmed = data; }, changed: publish, active: isActive, generation: () => sessionGeneration, nextSequence: () => ++sequence, save: adapter.saveSprint, dependencyPending: id => blockerBlocksSprint(id) || backlogAssignments.blocksSprint(id) || orderingBlocksSprint(id), checkDependency: async id => { if (blockerBlocksSprint(id)) return checkSprintBlocker(id); if (orderingBlocksSprint(id)) await checkOrdering(); else await backlogAssignments.checkSprint(id); return { outcome: isActive() ? "unconfirmed" : "session-ended", readStatus: workspaceStatuses.get("backlog") || "unavailable" }; }, lockPending: id=>sprintLock.blocksSprint(id), checkLock:id=>sprintLock.check(id), planPending: id => sprintPlan.blocksSprint(id), checkPlan: () => sprintPlan.check(), reviewWindowPending: () => reviewWindow.blocksSprints(), checkReviewWindow: () => reviewWindow.check(), readStatus: () => workspaceStatuses.get("sprint") || "not-loaded", refresh: () => planning.refreshWorkspace("sprint") });
  const reviewWindow = createReviewWindowState({ current: () => confirmed, active: isActive, generation: () => sessionGeneration, changed: publish, nextSequence: () => ++sequence, schedulesPending: () => sprintState.schedulesPending() || sprintPlan.blocksSchedules() || sprintLock.pending() || backlogAssignments.pending() || backlogOrdering.pending() || confirmed.tasks.some(task => task.sprintId && taskEffectsPending(task.id)), checkSchedules: () => confirmed.tasks.some(task => task.sprintId && taskEffectsPending(task.id)) ? checkSprintBlocker() : backlogOrdering.pending() ? checkOrdering() : sprintLock.pending() ? sprintLock.check() : sprintPlan.blocksSchedules() ? sprintPlan.check() : sprintState.checkPendingSchedules(), save: adapter.saveReviewWindow, accept: sprintState.acceptReviewWindow, denied: sprintState.denied, readVersion: sprintState.reviewWindowReadVersion, readStatus: () => workspaceStatuses.get("sprint") || "not-loaded", refresh: () => planning.refreshWorkspace("sprint") });
  const sprintPlan = createSprintPlanState({ schedulesPending: () => sprintState.schedulesPending() || reviewWindow.blocksSprints() || sprintLock.pending() || backlogAssignments.pending() || backlogOrdering.pending() || confirmed.tasks.some(task => task.sprintId && taskEffectsPending(task.id)), checkSchedules: () => confirmed.tasks.some(task => task.sprintId && taskEffectsPending(task.id)) ? checkSprintBlocker() : backlogOrdering.pending() ? checkOrdering() : sprintLock.pending() ? sprintLock.check() : reviewWindow.blocksSprints() ? reviewWindow.check() : sprintState.checkPendingSchedules(), current: () => confirmed, active: isActive, generation: () => sessionGeneration, changed: publish, nextSequence: () => ++sequence, create: adapter.createSprintPlan, accept: sprintState.acceptPlan, denied: sprintState.denied, readStatus: () => workspaceStatuses.get("sprint") || "not-loaded", refresh: () => planning.refreshWorkspace("sprint") });
  const sprintLock = createSprintLockState({
    dependenciesPending: basis => blockerBlocksSprint(basis.sprint.id) || sprintLock.blocksSprint(basis.sprint.id)
      || orderingBlocksSprint(basis.sprint.id)
      || basis.tasks.some(task => taskEffectsPending(task.id))
      || basis.tasks.some(task => backlogOrdering.blocksTask(task.id))
      || backlogAssignments.blocksSprint(basis.sprint.id)
      || basis.tasks.some(task => backlogAssignments.blocksTask(task.id))
      || sprintState.schedulesPending(basis.sprint.id)
      || sprintPlan.blocksSprint(basis.sprint.id)
      || reviewWindow.blocksSprints()
      || basis.tasks.some(row => {
        const task = confirmed.tasks.find(task => task.id === row.id);
        return task && lifecycle.isRemoving(task);
      })
      || [...pending.values()].some(operation => basis.tasks.some(task => task.id === operation.taskId)
        || confirmed.tasks.some(task => task.id === operation.taskId && task.sprintId === basis.sprint.id)
        || operation.patch.sprintId === basis.sprint.id),
    active: isActive,
    generation: () => sessionGeneration,
    current: () => confirmed,
    changed: publish,
    denied: sprintState.denied,
    nextSequence: () => ++sequence,
    async refresh() {
      const loaded = (["planning", "projects", "backlog"] as const).filter(workspace => workspaceStatuses.has(workspace));
      const refreshed = await planning.refreshWorkspace("sprint");
      for (const workspace of loaded) if (isActive()) await planning.refreshWorkspace(workspace);
      return refreshed;
    },
    readStatus: () => workspaceStatuses.get("sprint") || "not-loaded",
    lock: adapter.lockSprint,
    observe: adapter.readSprintLock,
    accept(receipt, basis) {
      sprintState.acceptLock(receipt);
      for (const task of basis.tasks) {
        taskConfirmedAt.set(task.id, ++sequence);
        if (detailStatuses.has(task.id)) detailStatuses.set(task.id, "stale");
      }
      for (const workspace of ["sprint", "planning", "projects", "backlog"] as const) {
        if (workspaceStatuses.has(workspace)) workspaceStatuses.set(workspace, "stale");
      }
      freshness = "stale";
      notifications.invalidateHeader(["notifications"]);
    },
    plan: input => planning.beginSprintPlan().create(input),
  });
  const backlogAssignments = createBacklogAssignments({ current: () => confirmed, active: isActive, generation: () => sessionGeneration, canRead: () => workspaceStatuses.get("backlog") !== "forbidden", changed: publish, nextSequence: () => ++sequence, readTaskVersion: id => taskReadAt.get(id) || 0, readSprintVersion: id => sprintState.readVersion(id), adapter, endSession, refresh: () => planning.refreshWorkspace("backlog"), pendingTask: id => taskEffectsPending(id) || backlogOrdering.blocksTask(id) || Boolean(confirmed.tasks.find(task => task.id === id && sprintLock.blocksTask(task))) || [...pending.values()].some(item => item.taskId === id) || lifecycle.isRemoving({ id } as Task), pendingSprint: id => sprintLock.blocksSprint(id) || sprintState.pending(id) || sprintPlan.blocksSprint(id) || reviewWindow.blocksSprints(), accept(updates, started, basis, activities) {
    const patches = new Map(updates.map(update => [update.id, update]));
    confirmed = { ...confirmed, tasks: confirmed.tasks.map(task => {
      const patch = patches.get(task.id); if (!patch || lifecycle.isRemoved(task)) return task;
      const original = basis.find(item => item.id === task.id);
      if (Math.max(taskConfirmedAt.get(task.id) || 0, taskReadAt.get(task.id) || 0) > started && task.updatedAt !== original?.updatedAt && task.updatedAt !== patch.updatedAt) return task;
      taskConfirmedAt.set(task.id, ++sequence); return { ...task, ...patch };
    }) };
    if (activities?.length) { const byId = new Map(confirmed.taskActivity.map(activity => [activity.id, activity])); for (const activity of activities) byId.set(activity.id, activity); confirmed = { ...confirmed, taskActivity: [...byId.values()] }; }
  }, invalidateDependencies(unknown) {
    if (unknown) { freshness = "stale"; workspaceStatuses.set("backlog", "stale"); }
    if (workspaceStatuses.has("sprint")) workspaceStatuses.set("sprint", "stale");
    notifications.invalidateHeader(["notifications"]);
  } });
  const backlogOrdering = createBacklogOrdering({ current: () => confirmed, active: isActive, generation: () => sessionGeneration, canRead: () => workspaceStatuses.get("backlog") !== "forbidden", changed: publish, nextSequence: () => ++sequence, readVersion: id => taskReadAt.get(id) || 0, adapter, endSession, pendingTask: id => taskEffectsPending(id) || Boolean(confirmed.tasks.find(task => task.id === id && sprintLock.blocksTask(task))) || [...pending.values()].some(item => item.taskId === id) || backlogAssignments.blocksTask(id) || lifecycle.isRemoving({ id } as Task) || taskSchedulePending(id), refresh: () => planning.refreshWorkspace("backlog"), accept(updates, started, basis) {
    const patches = new Map(updates.map(update => [update.id,update])); let unresolved = false;
    for (const update of updates) if (!confirmed.tasks.some(task => task.id === update.id)) { unresolved = true; taskConfirmedAt.set(update.id,++sequence); }
    confirmed = { ...confirmed, tasks: confirmed.tasks.map(task => {
      const update = patches.get(task.id); if (!update || lifecycle.isRemoved(task)) return task;
      const original = basis.find(item => item.id === task.id);
      if (Math.max(taskConfirmedAt.get(task.id) || 0, taskReadAt.get(task.id) || 0) > started && task.updatedAt !== original?.updatedAt && task.updatedAt !== update.updatedAt) return task;
      taskConfirmedAt.set(task.id,++sequence); return { ...task, order: update.sortOrder, updatedAt: update.updatedAt };
    }) }; return unresolved;
  }, invalidate(unknown) { freshness = "stale"; workspaceStatuses.set("backlog", "stale"); if (unknown && workspaceStatuses.has("sprint")) workspaceStatuses.set("sprint", "stale"); } });
  async function reloadGitHubImport(id: string, after: number): Promise<import("../planning-state").PlanningReadStatus> {
    const taskStatus = await reloadBlockerTask(id, after);
    if (taskStatus !== "current") return taskStatus;
    const discussionStatus = githubImports.comments(id, confirmed).readStatus;
    return discussionStatus === "current" ? taskStatus : discussionStatus;
  }
  async function reloadCommentDiscussion(id: string, after: number): Promise<import("../planning-state").PlanningReadStatus> {
    const joining = detailReads.has(id); await planning.loadTaskDetail(id);
    if (!isActive()) return "not-loaded";
    if (commentCreations.readStatus(id) === "forbidden") return "forbidden";
    if (joining && commentCreations.readVersion(id) <= after) await planning.loadTaskDetail(id);
    return commentCreations.readStatus(id);
  }
  async function reloadBlockerTask(id: string, after: number): Promise<import("../planning-state").PlanningReadStatus> {
    const joining = detailReads.has(id);
    await planning.loadTaskDetail(id);
    if (!isActive()) return "not-loaded";
    if (deniedTaskReads.has(id)) return "forbidden";
    if (joining && (taskReadAt.get(id) || 0) <= after) await planning.loadTaskDetail(id);
    if (deniedTaskReads.has(id)) return "forbidden";
    return (taskReadAt.get(id) || 0) > after && confirmed.tasks.find(task => task.id === id)?.updatedAt ? "current" : detailStatuses.get(id) === "current" ? "stale" : detailStatuses.get(id) || "unavailable";
  }
  function taskEffectsPending(id: string) { return blockerReports.blocksTask(id) || githubImports.blocksTask(id); }
  function blockerBlocksSprint(id: string) { return confirmed.tasks.some(task => task.sprintId === id && taskEffectsPending(task.id)); }
  async function checkSprintBlocker(id?: string): Promise<import("../planning-state").PlanningTaskSaveCheck> { const task = confirmed.tasks.find(task => (id ? task.sprintId === id : Boolean(task.sprintId)) && taskEffectsPending(task.id)); return task ? githubImports.blocksTask(task.id) ? githubImports.check(task.id) : blockerReports.checkTask(task.id) : { outcome: "not-pending", readStatus: "not-needed" }; }
  function taskSchedulePending(id: string) { const sprintId = confirmed.tasks.find(task => task.id === id)?.sprintId; return Boolean(sprintId && (sprintLock.blocksSprint(sprintId) || sprintState.pending(sprintId) || sprintPlan.blocksSprint(sprintId) || reviewWindow.blocksSprints())); }
  function orderingBlocksSprint(id: string) { return confirmed.tasks.some(task => task.sprintId === id && backlogOrdering.blocksTask(task.id)); }
  async function checkOrdering(): Promise<import("../planning-state").PlanningTaskSaveCheck> { const task = confirmed.tasks.find(task => backlogOrdering.blocksTask(task.id)); if (task) await backlogOrdering.checkTask(task.id); return { outcome: isActive() ? "unconfirmed" : "session-ended", readStatus: workspaceStatuses.get("backlog") || "unavailable" }; }
  function publish() {
    confirmed = tools.projectConfirmed(events.projectConfirmed(notifications.projectConfirmed(lifecycle.projectConfirmed(githubImports.projectConfirmed(commentCreations.projectConfirmed(blockerReports.projectConfirmed(confirmed)))))));
    const taskView = { ...confirmed, tasks: confirmed.tasks.map(task => {
      let result = task;
      for (const operation of pending.values()) {
        if (operation.taskId === task.id) result = { ...result, ...operation.patch };
      }
      return result;
    }) };
    visible = sprintLock.project(backlogOrdering.project(backlogAssignments.project(sprintPlan.project(reviewWindow.project(sprintState.project(profileSettings.project(lifecycle.projectVisible(taskView))))))));
    visible = githubImports.protect(blockerReports.protect(blockerReports.projectVisible(visible)));
    visible = administration.projectVisible(tools.projectVisible(events.projectVisible(notifications.projectVisible(visible))));

    if (!isActive()) publishCache?.(null);
    else for (const [workspace, members] of memberships) {
      if (workspaceStatuses.get(workspace) === "forbidden") publishCache?.(null, workspace);
      else { const protectedData = profileSettings.protect(githubImports.protect(blockerReports.protect(confirmed))); publishCache?.({ ...protectedData, tasks: protectedData.tasks.filter(task => members.has(task.id)) }, workspace); }
    }
    listeners.forEach(listener => listener());
  }
  function saveTaskWithContext(task: Task, patch: Partial<Task>, context: symbol): Promise<TaskUpdateResult> {
    if (!isActive()) return Promise.resolve({ ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt.", status: 409 });
    if (sprintLock.blocksTask(task,patch.sprintId)) return Promise.resolve({ok:false,kind:"unconfirmed",code:"predecessor_unconfirmed",error:"Der Sprint-Abschluss ist noch nicht vollständig bestätigt. Diese Änderung wurde nicht gesendet."});
    if (taskEffectsPending(task.id)) return Promise.resolve({ ok: false, kind: "unconfirmed", code: "predecessor_unconfirmed", error: "Eine betroffene Aufgabe ist noch nicht vollständig bestätigt. Diese Änderung wurde nicht gesendet." });
    if (backlogOrdering.blocksTask(task.id)) return Promise.resolve({ ok: false, kind: "unconfirmed", code: "predecessor_unconfirmed", error: "Die Rangfolge einer betroffenen Aufgabe ist noch nicht bestätigt. Diese Änderung wurde nicht gesendet." });
    if (backlogAssignments.blocksTask(task.id)) return Promise.resolve({ ok: false, kind: "unconfirmed", code: "predecessor_unconfirmed", error: "Die Sprint-Zuordnung dieser Aufgabe ist noch nicht bestätigt. Diese Änderung wurde nicht gesendet." });

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
  function backlogBlocksRemoval(root: Task) {
    return confirmed.tasks.some(task => {
      if (!taskEffectsPending(task.id) && !backlogAssignments.blocksTask(task.id) && !backlogOrdering.blocksTask(task.id)) return false;
      const seen = new Set<string>(); let current: Task | undefined = task;
      while (current && !seen.has(current.id)) { if (current.id === root.id) return true; seen.add(current.id); current = confirmed.tasks.find(parent => parent.id === current!.parentTaskId); }
      return false;
    });
  }
  const lifecycle = createTaskLifecycle({
    removalBlocked:task=>taskEffectsPending(task.id) || sprintLock.blocksTask(task) || backlogAssignments.blocksTask(task.id) || backlogOrdering.blocksTask(task.id),
    createTask: adapter.createTask,
    removeTask: adapter.removeTask,
    checkCreation: async () => { await planning.refreshWorkspace("planning"); return planning.workspace("planning").readStatus; },
    checkRemoval: async taskId => { await planning.loadTaskDetail(taskId); return planning.taskDetail(taskId).readStatus; },
    acceptRemoval(ids, action, rootId) {
      for (const id of ids) taskConfirmedAt.set(id, ++sequence);
      for (const members of memberships.values()) for (const id of ids) members.delete(id);
      confirmed = lifecycle.projectConfirmed(githubImports.projectConfirmed(commentCreations.projectConfirmed(blockerReports.projectConfirmed(confirmed))));
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
    beginAdministrationProjectEdit: administration.beginProject,
    administrationProjectEdits: administration.projectViews,
    resumeAdministrationProjectEdit: administration.resumeProject,
    administration: administration.view,
    loadAdministration: administration.load,
    beginAdministrationPersonEdit: administration.begin,
    administrationPersonEdits: administration.views,
    resumeAdministrationPersonEdit: administration.resume,
    importTaskGitHubComments: githubImports.importComments,
    taskGitHubImport: githubImports.view,
    taskGitHubComments: taskId => githubImports.comments(taskId, visible),
    checkTaskGitHubImport: githubImports.check,
    createTaskComment: commentCreations.create,
    taskComments: taskId => commentCreations.view(taskId, visible),
    taskCommentCreations: commentCreations.views,
    checkTaskCommentCreation: commentCreations.check,
    reportTaskBlocker: blockerReports.report,
    taskBlockerReports: blockerReports.views,
    checkTaskBlockerReport: blockerReports.check,
    beginSprintLock: (sprint,tasks) => sprintLock.begin(sprint,tasks),
    sprintLocks: id => { isActive(); return sprintLock.views(id); },
    resumeSprintLock: sprintLock.resume,
    beginBacklogOrder: backlogOrdering.begin,
    backlogOrders: backlogOrdering.views,
    resumeBacklogOrder: backlogOrdering.resume,
    beginBacklogAssignment: backlogAssignments.begin,
    backlogAssignments: backlogAssignments.views,
    resumeBacklogAssignment: backlogAssignments.resume,
    backlog: () => { const view = planning.workspace("backlog"); return { model: { revision: "", coverage: view.tasks.some(task => taskEffectsPending(task.id)) || backlogOrdering.pending() || backlogAssignments.pending() || pending.size ? { ...backlogCoverage, items: "partial" as const } : backlogCoverage, items: view.tasks, people: view.readStatus === "forbidden" || !isActive() ? [] : visible.profiles, sprints: view.readStatus === "forbidden" || !isActive() ? [] : visible.sprints, commitments: view.readStatus === "forbidden" || !isActive() ? [] : visible.sprintCommitments }, readStatus: view.readStatus }; },

    sprintPlan: () => { isActive(); return sprintPlan.view(); },
    checkSprintPlan: () => sprintPlan.check(),
    resumeSprintPlan: () => sprintPlan.resume(),
    beginSprintPlan: () => sprintPlan.begin(),
    checkReviewWindowSave: () => reviewWindow.check(),
    reviewWindow: () => { const active = isActive(); return { hours: !active || sprintState.denied() ? null : visible.project.reviewObjectionWindowHours, edits: reviewWindow.views(), readStatus: workspaceStatuses.get("sprint") || "not-loaded" }; },
    resumeReviewWindowEdit: () => reviewWindow.resume(),
    beginReviewWindowEdit: hours => reviewWindow.begin(hours),
    checkSprintSave: id => sprintState.check(id),
    sprintEdits: id => sprintState.views(id),
    beginSprintEdit: sprint => sprintState.begin(sprint),
    sprintWorkspace: () => {
      isActive();
      const data = sprintState.denied() ? emptyPlanningShellState : visible;
      return { readStatus: workspaceStatuses.get("sprint") || "not-loaded", model: { coverage: sprintViewCoverage(sprintState.coverage()), revision: "", project: data.project, people: data.profiles, items: sprintState.denied() ? [] : planning.workspace("sprint").tasks, sprints: data.sprints, commitments: data.sprintCommitments, scores: data.founderSprintScores, strikeStates: data.founderStrikeStates, strikeEvents: data.strikeEvents, objections: data.scoreObjections, meetings: data.meetings, attendance: data.meetingAttendance } };
    },
    ...workweekCalendars.publicState,
    ...privateWorkweek.publicState,
    ...googleWorkspace.publicState,
    ...notifications.publicState,
    ...events.publicState,
    ...tools.publicState,
    createTask: input => (backlogOrdering.pending() && input.taskType === "deliverable") || backlogOrdering.blocksTask(input.relatedTaskId || input.parentTaskId) ? Promise.resolve({ ok: false, kind: "unconfirmed", error: "Eine betroffene Rangänderung ist noch nicht bestätigt. Die Aufgabe wurde noch nicht erstellt." }) : lifecycle.createTask(input),
    taskLifecycle: () => lifecycle.views(),
    checkTaskLifecycle: id => lifecycle.check(id),
    withdrawTask: (task, reason) => backlogBlocksRemoval(task) ? Promise.resolve({ ok: false, kind: "unconfirmed", error: "Eine betroffene Aufgabenänderung ist noch nicht bestätigt." }) : lifecycle.removeTask(task, "withdraw", reason),
    rejectTask: (task, reason) => backlogBlocksRemoval(task) ? Promise.resolve({ ok: false, kind: "unconfirmed", error: "Eine betroffene Aufgabenänderung ist noch nicht bestätigt." }) : lifecycle.removeTask(task, "reject", reason),
    beginOwnProfileEdit: profileSettings.beginOwnEdit,
    beginTeamProfileEdit: profileSettings.beginTeamEdit,
    team: profileSettings.team,
    saveTeamProfile: profileSettings.saveTeam,
    checkTeamProfile: profileSettings.checkTeam,
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
      saveStatus: githubImports.blocksTask(taskId) ? githubImports.view(taskId)?.phase === "saving" ? "saving" : "unconfirmed" : blockerReports.saveStatus(taskId) || backlogOrdering.saveStatus(taskId) || backlogAssignments.saveStatus(taskId) || status.get(taskId) || "saved", unavailable: detailUnavailable.get(taskId) || [], readStatus: detailStatuses.get(taskId) || "not-loaded",
      comments: deniedTaskReads.has(taskId) ? [] : visible.taskComments.filter(item => item.taskId === taskId),
      externalComments: deniedTaskReads.has(taskId) ? [] : visible.taskExternalComments.filter(item => item.taskId === taskId),
      blockers: deniedTaskReads.has(taskId) ? [] : visible.taskBlockers.filter(item => item.taskId === taskId),
      relationships: deniedTaskReads.has(taskId) ? [] : visible.taskRelations.filter(item => item.taskId === taskId || item.relatedTaskId === taskId),
      activities: deniedTaskReads.has(taskId) ? [] : visible.taskActivity.filter(item => item.taskId === taskId),
      reviews: deniedTaskReads.has(taskId) ? [] : visible.taskReviews.filter(item => item.taskId === taskId),
    }); },
    protectedCache(workspace) {
      if (!isActive() || (workspace && (!memberships.has(workspace) || workspaceStatuses.get(workspace) === "forbidden"))) return null;
      const data = profileSettings.protect(githubImports.protect(blockerReports.protect(confirmed)));
      return { tasks: data.tasks.filter(task => !deniedTaskReads.has(task.id) && (!workspace || memberships.get(workspace)?.has(task.id))), profiles: data.profiles, sprints: data.sprints, notificationPreferences: data.notificationPreferences, profileUiPreferences: data.profileUiPreferences, profileFeatureTourAcknowledgements: data.profileFeatureTourAcknowledgements };
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    taskSaves: taskId => {
      if (!isActive()) return [];
      const forbidden = deniedTaskReads.has(taskId);
      const imported = githubImports.view(taskId);
      return [...(imported && githubImports.blocksTask(taskId) ? [{ phase: imported.phase === "saving" ? "saving" as const : "unconfirmed" as const, submitted: null, checkStatus: imported.checking ? "checking" as const : imported.taskReadStatus === "current" ? "checked" as const : "not-checked" as const, serverTask: null }] : []), ...blockerReports.views(taskId).filter(view => view.phase === "saving" || view.phase === "unconfirmed" || view.phase === "confirmed" && view.taskReadStatus !== "current").map(view => ({ phase: view.phase === "saving" ? "saving" as const : "unconfirmed" as const, submitted: forbidden ? null : { status: "Blockiert" }, checkStatus: view.checking ? "checking" as const : view.taskReadStatus === "current" ? "checked" as const : view.taskReadStatus === "unavailable" ? "unavailable" as const : "not-checked" as const, serverTask: forbidden ? null : view.serverTask })), ...backlogOrdering.views().filter(view => ["saving", "unconfirmed"].includes(view.phase) && backlogOrdering.blocksTask(taskId)).map(view => ({ phase: view.phase as "saving" | "unconfirmed", submitted: forbidden ? null : { order: visible.tasks.find(task => task.id === taskId)?.order }, checkStatus: view.checking ? "checking" as const : "not-checked" as const, serverTask: null })), ...backlogAssignments.views().filter(view => ["saving", "unconfirmed"].includes(view.phase) && view.tasks.some(task => task.id === taskId)).map(view => ({ phase: view.phase as "saving" | "unconfirmed", submitted: forbidden ? null : { sprintId: view.targetSprint?.id || "", scoreRelevant: Boolean(view.targetSprint) }, checkStatus: view.checking ? "checking" as const : "not-checked" as const, serverTask: null })), ...[...pending.values()].filter(operation => operation.taskId === taskId).map(operation => ({
        phase: operation.phase, submitted: forbidden ? null : operation.submitted,
        checkStatus: outcomeCheckStatus.get(taskId) || "not-checked",
        serverTask: forbidden || outcomeCheckStatus.get(taskId) !== "checked" ? null : confirmed.tasks.find(task => task.id === taskId) || null,
      }))];
    },
    checkTaskSave(taskId) {
      if (!isActive()) return Promise.resolve({ outcome: "session-ended", readStatus: "not-needed" });
      const lockTask=confirmed.tasks.find(task=>task.id===taskId);
      if(lockTask&&sprintLock.blocksTask(lockTask)) return (async():Promise<import("../planning-state").PlanningTaskSaveCheck>=>{
        const checked=await sprintLock.check();
        if(!isActive())return{outcome:"session-ended",readStatus:"not-needed"};
        const current=confirmed.tasks.find(task=>task.id===taskId);
        if(checked.outcome==="not-pending"&&current&&sprintLock.blocksTask(current)&&adapter.readTaskDetail)await planning.loadTaskDetail(taskId);
        const after=confirmed.tasks.find(task=>task.id===taskId);
        return after&&sprintLock.blocksTask(after)?{outcome:"unconfirmed",readStatus:checked.readStatus}:checked;
      })();
      if (githubImports.blocksTask(taskId)) return githubImports.check(taskId);
      if (blockerReports.blocksTask(taskId)) return blockerReports.checkTask(taskId);
      if (backlogOrdering.blocksTask(taskId)) return backlogOrdering.checkTask(taskId).then(() => ({ outcome: isActive() ? "unconfirmed" as const : "session-ended" as const, readStatus: workspaceStatuses.get("backlog") || "unavailable" }));
      if (backlogAssignments.blocksTask(taskId)) return backlogAssignments.checkTask(taskId).then(() => ({ outcome: isActive() ? "unconfirmed" as const : "session-ended" as const, readStatus: workspaceStatuses.get("backlog") || "unavailable" }));

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
      commentCreations.beginRead(taskId);
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
          commentCreations.failed(taskId, failedStatus);
          githubImports.failed(taskId, failedStatus);
          if (failedStatus === "forbidden") { deniedTaskReads.add(taskId); blockerReports.denied(taskId); }
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
        const unresolvedIds = new Set(next.tasks.filter(task => !confirmed.tasks.some(current => current.id === task.id) && (taskConfirmedAt.get(task.id) || 0) > started).map(task => task.id));
        confirmed = {
          ...next,
          tasks: next.tasks.filter(task => !unresolvedIds.has(task.id)).map(task => protectedIds.has(task.id) ? confirmed.tasks.find(item => item.id === task.id)! : task),
          ...((taskConfirmedAt.get(taskId) || 0) > started ? { taskActivity: confirmed.taskActivity } : {}),
        };
        if (result.unavailable?.includes("discussion")) commentCreations.failed(taskId, "unavailable");
        else commentCreations.acceptRead(result.model.discussion.comments, started, result.model.coverage?.discussion === "complete", taskId);
        if (result.unavailable?.includes("discussion")) githubImports.failed(taskId, "unavailable");
        else githubImports.acceptRead(result.model.discussion.externalComments, started, result.model.coverage?.discussion === "complete", taskId);
        githubImports.acceptTaskRead(taskId, started, !protectedIds.has(taskId) && !unresolvedIds.has(taskId), result.model.item.updatedAt);
        blockerReports.acceptDetailRead(result.model, started, !protectedIds.has(taskId) && !unresolvedIds.has(taskId), !result.unavailable?.includes("relationships"));
        const returnedTasks = [result.model.item, ...result.model.ancestors, ...result.model.children, ...result.model.relatedItems];
        for (const task of returnedTasks) {
          if (!protectedIds.has(task.id) && !unresolvedIds.has(task.id)) taskReadAt.set(task.id, started);
        }
        if (sprintRead.stale || unresolvedIds.size || returnedTasks.some(task => protectedIds.has(task.id))) {
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
      const eventRead = workspace === "events" ? events.beginRead() : null;
      const toolRead = workspace === "tools" ? tools.beginRead() : null;
      acceptedRead.set(workspace, started);
      workspaceStatuses.set(workspace, "loading");
      publish();
      let result: PlanningWorkspaceRead | null;
      try { result = await adapter.readWorkspace(workspace); }
      catch (error) {
        if (!isActive() || generation !== sessionGeneration || acceptedRead.get(workspace) !== started) return false;
        notifications.workspaceFailed(workspace, error);
        if (workspace === "backlog" && readErrorStatus(error) === "forbidden") { backlogAssignments.denied(); backlogOrdering.denied(); }
        if (toolRead !== null) tools.failed(error, toolRead);
        if (workspace === "events" && eventRead !== null) events.failed(error, eventRead);
        workspaceStatuses.set(workspace, readErrorStatus(error));
        if (workspace === "sprint") sprintState.readStatus(readErrorStatus(error));
        profileSettings.readStatus(readErrorStatus(error), workspace);
        publish();
        return false;
      }
      if (!isActive() || generation !== sessionGeneration || acceptedRead.get(workspace) !== started) return false;
      if (!result) {
        if (toolRead !== null) tools.failed(new Error("Links konnten nicht geladen werden."), toolRead);
        if (eventRead !== null) events.failed(new Error("Events konnten nicht geladen werden."), eventRead);
        workspaceStatuses.set(workspace, "unavailable");
        publish();
        return false;
      }
      if (workspace === "backlog") backlogCoverage = result.backlogCoverage || {};
      const coverage = result.coverage || workspaceReadCoverage(workspace);
      if (coverage.taskExternalComments) githubImports.acceptRead(result.data.taskExternalComments, started, coverage.taskExternalComments === "complete");
      if (coverage.taskComments) commentCreations.acceptRead(result.data.taskComments, started, coverage.taskComments === "complete");
      if (coverage.taskBlockers) blockerReports.acceptBlockerRead(result.data.taskBlockers, started, coverage.taskBlockers === "complete");
      const taskCoverage = result.taskCoverage === "none" ? undefined : result.taskCoverage || coverage.tasks;
      const rawIncoming = taskCoverage ? result.data.tasks : [];
      const currentIds = new Set(confirmed.tasks.map(task => task.id));
      // A late full row cannot precede a confirmed partial receipt for a still-unresolved identity.
      const incoming = rawIncoming.filter(task => currentIds.has(task.id) || (taskConfirmedAt.get(task.id) || 0) <= started);
      const protectedIds = new Set(confirmed.tasks.filter(task => (taskConfirmedAt.get(task.id) || 0) > started || (taskReadAt.get(task.id) || 0) > started).map(task => task.id));
      const acceptedTask = (task: Task) => {
        const previous = confirmed.tasks.find(item => item.id === task.id);
        if (!previous || !result.taskOmittedFields?.length) return task;
        const next = { ...previous, ...task };
        for (const field of result.taskOmittedFields) Object.assign(next, { [field]: previous[field] });
        if (detailStatuses.get(task.id) === "current") detailStatuses.set(task.id, "stale");
        return next;
      };
      const replacements = new Map(incoming.filter(task => !protectedIds.has(task.id)).map(task => [task.id, acceptedTask(task)]));
      const known = new Set(confirmed.tasks.map(task => task.id));
      for (const task of replacements.values()) taskReadAt.set(task.id, started);
      const covered = projectCoveredRead(confirmed, result.data, coverage);
      const projectRead = coverage.project ? administration.acceptProjectRead(covered.project, started) : {project:covered.project,stale:false};
      covered.project=projectRead.project;
      if (coverage.taskRelations) lifecycle.acceptRelationshipRead(covered, started, coverage.taskRelations === "complete");
      const profileRead = profileSettings.acceptRead(covered, coverage, started, workspace, result.data);
      const sprintRead = sprintState.acceptRead(profileRead.data, coverage, started, result.data);
      confirmed = {
        ...sprintRead.data,
        project: {...sprintRead.data.project,githubProjectOwner:projectRead.project.githubProjectOwner,githubProjectNumber:projectRead.project.githubProjectNumber},
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
      const stale = projectRead.stale || rawIncoming.length !== incoming.length || sprintRead.stale || profileRead.stale || incoming.some(task => protectedIds.has(task.id)) || (taskCoverage === "complete" && [...protectedIds].some(id => memberships.get(workspace)?.has(id)));
      workspaceStatuses.set(workspace, stale ? "stale" : "current");
      if (toolRead !== null) tools.acceptRead({ tools: result.data.fmdTools, completeness: result.toolCoverage || "partial" }, toolRead, Boolean(result.headerData && result.headerData.quickLinks.state === "ready"));
      if (eventRead !== null) events.acceptRead({ events: result.data.events, coverage: result.eventCoverage || { range: null, completeness: "partial" } }, eventRead, Boolean(result.headerData && result.headerData.calendarEvents.state !== "idle"));
      notifications.acceptWorkspaceRead(workspace, result.data, result.headerData, notificationRead, result.notificationCoverage);
      profileSettings.readStatus(stale ? "stale" : "current", workspace);
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
    githubImports.clear();
    commentCreations.clear();
    blockerReports.clear();
    lifecycle.clear();
    administration.clear();
    backlogOrdering.clear();
    backlogAssignments.clear();
    sprintState.clear();
    reviewWindow.clear();
    sprintPlan.clear();
    sprintLock.clear();
    profileSettings.clear();
    profileTokens.clear();
    pending.clear();
    status.clear();
    memberships.clear();
    workspaceStatuses.clear();
    completeness.clear();
    backlogCoverage = {};
    detailStatuses.clear();
    deniedTaskReads.clear();
    confirmed = emptyPlanningShellState;
    workweekCalendars.clear();
    privateWorkweek.clear();
    googleWorkspace.clear();
    notifications.clear();
    events.clear();
    tools.clear();
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
    confirmed = { ...incoming, ...profileSettings.preserveOwned(confirmed), ...sprintState.preserveLockScopes(incoming,confirmed), tasks: confirmed.tasks, sprints: confirmed.sprints, project: { ...incoming.project, githubProjectOwner: confirmed.project.githubProjectOwner, githubProjectNumber: confirmed.project.githubProjectNumber, reviewObjectionWindowHours: confirmed.project.reviewObjectionWindowHours } };
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
    githubImports.acceptRead(data.taskExternalComments, ++sequence, false);
    if (workspace === "tools") tools.acceptRead({ tools: data.fmdTools, completeness: "partial" }, tools.beginRead());
    if (workspace === "events") events.acceptRead({ events: data.events, coverage: { range: null, completeness: "partial" } }, events.beginRead());
    const coverage = workspaceReadCoverage(workspace);
    const known = new Set(confirmed.tasks.map(task => task.id));
    confirmed = { ...projectCoveredRead(confirmed, data, coverage), tasks: [...confirmed.tasks, ...data.tasks.filter(task => !known.has(task.id))] };
    memberships.set(workspace, new Set(data.tasks.map(task => task.id)));
    profileSettings.hydrate(data, workspace);
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
    bindAdministrationAuthority: administration.bindAuthority,
    confirmedHeader: notifications.confirmedHeader,
    acceptHeaderHydration: notifications.hydrateHeader,
    invalidateHeader: notifications.invalidateHeader,
    invalidatePublishedWorkweeks: workweekCalendars.invalidatePublishedWorkweeks,
    invalidateWorkweekCalendarAuthority: workweekCalendars.invalidateAuthority,
    invalidateNotificationAuthority: notifications.invalidateNotificationAuthority,
    applyLegacyProjection,
    acceptHydration,
    invalidateTaskViews,
    sessionChanged,
    bindSession,
    suspendProtected,
    endSession,
    dispose: () => { administration.clear(); unsubscribeSession?.(); },
  } };
}
