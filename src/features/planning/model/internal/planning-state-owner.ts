import { normalizeBacklogSupport, validBacklogControls, validBacklogBuckets, type BacklogControls, type BacklogSprintBasis, type BacklogSupportQuery } from "@/features/backlog/model/backlog-support";
import { normalizeBacklogSelection, type BacklogSelection, type BacklogSelectionQuery } from "@/features/backlog/model/backlog-selection";
import { taskChildProgress } from "@/features/tasks/model/task-card-presentation";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardQuery, type PlanningBoardQueryInput, type PlanningBoardResult } from "../planning-board-query";
import { allowedPlanningItemStatuses } from "@/features/tasks/model/planning-item-capabilities";
import { createDecisionLogState } from "./decision-log-state";
import { createHierarchyCommands } from "./hierarchy-commands";
import { createMeetingAttendanceState } from "./meeting-attendance-state";
import { createTaskRelationshipChanges } from "./task-relationship-changes";
import { createTaskGitHubSyncState } from "./task-github-sync-state";
import { createGitHubConnectionState } from "./github-connection-state";
import { createTaskAttachmentUploads } from "./task-attachment-uploads";
import { createTaskReviewOperations } from "./task-review-operations";
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
import { isThisWeek } from "../planning-app-model";
import { normalizeStatus, taskStatuses } from "@/lib/status";
import type { PlanningBoardColumnOutcome, PlanningBoardOutcome, PlanningBoardSummaryOutcome } from "../planning-board-delivery";
import type { PlanningBoardSummaryFrame, PlanningBoardSummaryRequest } from "../planning-board-summaries";
import type { BrowserSessionSnapshot } from "@/lib/credentials/browser";
import type { AuthenticatedProfile, PlanningHeaderData, PlanningShellState, Task, TaskActivity, TaskStatus } from "@/lib/types";
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
import { createSprintCommitmentState } from "./sprint-commitment-state";
import { createScoreObjectionState } from "./score-objection-state";
import { createSprintState } from "./sprint-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { createTaskLifecycle } from "./task-lifecycle";
import type { PlanningTaskCreationInput, PlanningTaskCreationConfirmation, PlanningTaskRemovalConfirmation } from "../planning-task-lifecycle";
import { createProfileApiTokensState } from "./profile-api-tokens-state";
import { createProfileSettingsState } from "./profile-settings-state";
import type { OwnProfileSettingsConfirmation, OwnProfileSettingsPatch } from "@/features/profile/model/profile-settings-contract";
import { createTaskEditing } from "./task-editing";
import { applyPlanningItemApprovalPatch } from "../approval-domain";
import { createPlanningCandidateReads } from "./planning-candidate-reads";

import { projectCoveredRead, workspaceReadCoverage, type PlanningReadCoverage } from "./planning-read-scopes";

type PlanningTableResult = import("../planning-table-result").PlanningTableResult;

export type PlanningWorkspaceRead = { backlogControls?: BacklogControls; backlogSprintBasis?: BacklogSprintBasis; backlogSelection?: BacklogSelection; readActor?: { profileId: string; platformRole: import("@/lib/types").Profile["platformRole"] }; table?: PlanningTableResult; readAuthority?: import("../planning-server-header-read").PlanningReadAuthority; scopeRevision?: string; board?: PlanningBoardResult; query?: PlanningBoardQueryInput; queryRevision?: string; append?: boolean; profileOmittedFields?: readonly (keyof import("@/lib/types").Profile)[]; projectOmittedFields?: readonly (keyof import("@/lib/types").Project)[]; backlogCoverage?: import("@/features/backlog/model/backlog-read-model").BacklogReadCoverage; taskOmittedFields?: readonly (keyof Task)[]; toolCoverage?: "complete" | "partial"; eventCoverage?: import("@/features/events/model/event-state").EventCoverage; notificationCoverage?: import("@/features/notifications/model/notifications-read-model").NotificationsWorkspaceModel["coverage"]; data: PlanningShellState; coverage?: PlanningReadCoverage; taskCoverage?: "complete" | "partial" | "none"; headerData?: PlanningHeaderData; currentProfile?: AuthenticatedProfile | null };
export type PlanningWorkspaceProgress =
  | { kind: "basis"; readId: string; read: PlanningWorkspaceRead }
  | { kind: "column"; readId: string; column: TaskStatus; read: PlanningWorkspaceRead }
  | { kind: "failure"; readId: string; column?: TaskStatus; error: { status: number; code?: string } }
  | { kind: "outcome"; outcome: PlanningBoardOutcome };
type PlanningWeekBasis = { observedAt: number; sprints: import("@/lib/types").Sprint[] };
function planningWeekBasis(board: Pick<PlanningBoardResult, "observedAt"> | undefined, coverage: PlanningReadCoverage | undefined, sprints: readonly import("@/lib/types").Sprint[]): PlanningWeekBasis | undefined {
  const observedAt = Date.parse(board?.observedAt || "");
  if (coverage?.sprints !== "complete" || !Number.isFinite(observedAt)) return undefined;
  return { observedAt, sprints: sprints.map(sprint => ({ ...sprint })) };
}
function planningWeekIsCurrent(query: PlanningBoardQuery | undefined, basis: PlanningWeekBasis | undefined, now: number) {
  if (!query || query.view === "complete" || !query.filters.quick.includes("week")) return true;
  return Boolean(basis && basis.sprints.every(sprint =>
    isThisWeek({ sprintId: sprint.id }, [sprint], new Date(basis.observedAt)) === isThisWeek({ sprintId: sprint.id }, [sprint], new Date(now))));
}
type TaskSave = { task: Partial<Task>; activities?: TaskActivity[] };
export type PlanningStateAdapter = import("@/features/tasks/model/task-github-sync-state").TaskGitHubSyncAdapter & import("@/features/sprint/model/meeting-attendance-state").MeetingAttendanceAdapter & import("@/features/reviews/model/planning-task-review").TaskReviewAdapter & import("@/features/tasks/model/task-relationship-change").TaskRelationshipAdapter & import("@/features/team-workweek/model/google-workspace-state").GoogleWorkspaceAdapter & import("@/features/tasks/model/task-attachment-upload").TaskAttachmentAdapter & import("@/features/tasks/model/task-github-comment-import").TaskGitHubImportAdapter & import("@/features/tasks/model/task-comment-creation").TaskCommentCreationAdapter & import("@/features/administration/model/administration-state").AdministrationPersonAdapter & import("@/features/tasks/model/task-blocker-report").TaskBlockerReportAdapter & import("@/features/backlog/model/backlog-ordering").BacklogOrderingAdapter & import("@/features/backlog/model/backlog-assignment").BacklogAssignmentAdapter & import("@/features/team-workweek/model/private-workweek-planning-state").PrivateWorkweekAdapter & import("@/features/tools/model/tool-state").ToolsAdapter & import("@/features/events/model/event-state").EventsAdapter & HeaderNotificationsAdapter & import("@/features/profile/model/profile-api-token-state").ProfileApiTokenAdapter & {
  readDecisionLog?: () => Promise<import("@/lib/notion-decision-log").NotionDecisionLogResult>;
  createScoreObjection?: (sprintId: string, comment: string) => Promise<import("@/features/sprint/model/score-objection-state").ScoreObjectionConfirmation>;
  processScoreObjection?: (objection: import("@/lib/types").ScoreObjection, score: import("@/lib/types").FounderSprintScore | null, input: import("@/lib/types").ScoreObjectionResolutionInput) => Promise<import("@/features/sprint/model/score-objection-state").ScoreObjectionConfirmation>;
  saveSprintCommitment?: (basis: import("@/lib/types").SprintCommitment, patch: import("@/features/sprint/model/sprint-commitment-editing").SprintCommitmentPatch) => Promise<import("@/features/sprint/model/sprint-commitment-editing").SprintCommitmentConfirmation>;
  lockSprint?: (basis: import("@/features/sprint/model/sprint-lock").SprintLockBasis) => Promise<import("@/features/sprint/model/sprint-lock").SprintLockReceipt>;
  readSprintLock?: (sprintId: string) => Promise<import("@/features/sprint/model/sprint-lock").SprintLockObservation>;

  createSprintPlan?: (options: import("@/features/sprint/model/sprint-planning-options").SprintPlanningOptions, basis: import("@/features/sprint/model/sprint-plan").SprintPlanBasis) => Promise<import("@/features/sprint/model/sprint-plan").SprintPlanConfirmation>;
  saveReviewWindow?: (expectedHours: number, hours: number) => Promise<import("@/features/sprint/model/review-window-editing").ReviewWindowConfirmation>;
  saveSprint?: (sprint: import("@/lib/types").Sprint, patch: import("@/features/sprint/model/sprint-editing").SprintEditPatch) => Promise<{ sprint: import("@/lib/types").Sprint }>;
  readWorkweekCalendar?: (scope: import("@/features/team-workweek/model/published-workweek-calendar-state").WorkweekCalendarScope) => Promise<import("@/features/team-workweek/model/published-workweek-calendar-state").WorkweekCalendarResponse>;
  now?: () => number;
  removeTask?: (task: Task, action: "withdraw" | "reject" | "delete_epic", reason: string) => Promise<PlanningTaskRemovalConfirmation>;
  createTask?: (input: PlanningTaskCreationInput) => Promise<PlanningTaskCreationConfirmation>;
  acknowledgeFeatureTour?: (tourId: string) => Promise<import("@/lib/types").ProfileFeatureTourAcknowledgement>;
  saveTeamProfile?: (profileId: string, patch: import("../planning-team-state").TeamProfilePatch, expected: Record<string, unknown>) => Promise<Partial<import("@/lib/types").Profile> & { id: string }>;
  saveOwnProfileSettings?: (patch: OwnProfileSettingsPatch) => Promise<OwnProfileSettingsConfirmation>;
  saveTask(task: Task, patch: Partial<Task>): Promise<TaskSave>;
  readPlanningSourceVersion?: (options?: { signal?: AbortSignal }) => Promise<string>;
  readCandidates?: (query: import("@/features/planning-items/model/planning-item-candidates").PlanningItemCandidateQuery, options?: { signal?: AbortSignal }) => Promise<import("@/features/planning-items/model/planning-item-candidates").PlanningItemCandidateReceipt>;
  readTableRisks?: (token: string, options?: { signal?: AbortSignal }) => Promise<{ summaries: import("../planning-table-result").PlanningTableRiskFrame; readAuthority: import("../planning-server-header-read").PlanningReadAuthority }>;
  readBoardSummaries?: (token: string, options?: { signal?: AbortSignal }) => Promise<{ summaries: PlanningBoardSummaryFrame; readAuthority: import("../planning-server-header-read").PlanningReadAuthority }>;
  readBacklogSupport?: (query: BacklogSupportQuery, options?: { signal?: AbortSignal }) => Promise<PlanningWorkspaceRead | null>;
  readBacklogSelection?: (query: BacklogSelectionQuery, options?: { signal?: AbortSignal }) => Promise<PlanningWorkspaceRead | null>;
  readWorkspace(workspace: AppWorkspace, query?: PlanningBoardQueryInput, options?: { signal?: AbortSignal; onBoardStream?: (event: PlanningWorkspaceProgress) => void }): Promise<PlanningWorkspaceRead | null>;
  readTaskDetail?: (taskId: string, options?: { area?: import("@/features/tasks/model/task-detail-read-model").TaskDetailReadArea; signal?: AbortSignal }) => Promise<{ model: TaskDetailModel; unavailable?: TaskDetailUnavailableArea[]; readAuthority?: import("../planning-server-header-read").PlanningReadAuthority }>;
  subscribeSession?: (listener: (userId: string | null) => void) => () => void;
};

export function createPlanningState({ userId, initialData, initialWorkspace = "planning", initialWorkspaceRead, initialTaskDetailRead, initialSession, initialServerHeaderRead, initialHeaderData, initialCurrentProfile, initialDecisionLogResult, initialAdministrationAuthority, administrationActorProfileId, adapter, publishCache, acceptWorkspaceContext }: {
  userId: string;
  initialData: PlanningShellState;
  initialWorkspace?: AppWorkspace;
  initialWorkspaceRead?: import("../planning-workspace-hydration").PlanningWorkspaceHydration;
  initialTaskDetailRead?: import("@/features/tasks/model/task-detail-read-model").TaskDetailHydration;
  initialSession?: BrowserSessionSnapshot;
  initialServerHeaderRead?: import("../planning-server-header-read").PlanningServerHeaderRead;
  initialHeaderData?: PlanningHeaderData;
  initialDecisionLogResult?: import("@/lib/notion-decision-log").NotionDecisionLogResult;
  initialCurrentProfile?: AuthenticatedProfile | null;
  administrationActorProfileId?: string;
  initialAdministrationAuthority?: import("@/features/administrator-access/model/administrator-access").AuthorityProjection;
  adapter: PlanningStateAdapter;
  publishCache?: (data: PlanningShellState | null, workspace?: AppWorkspace) => void;
  acceptWorkspaceContext?: (result: PlanningWorkspaceRead) => void;
}) {
  function validDetailReceipt(model: TaskDetailModel, authority: import("../planning-server-header-read").PlanningReadAuthority | undefined, actor = initialCurrentProfile) {
    const now = adapter.now?.() ?? Date.now();
    return Boolean((!actor || model.readActor?.profileId === actor.id && model.readActor?.platformRole === actor.platformRole)
      && authority && authority.userId === userId && Number.isFinite(authority.deadline) && authority.deadline > now
      && typeof model.authorityDeadline === "number" && Number.isFinite(model.authorityDeadline) && model.authorityDeadline > now
      && typeof model.sourceRevision === "string" && model.sourceRevision.length && typeof model.observedAt === "string" && Number.isFinite(Date.parse(model.observedAt))
      && (model.validUntil === null || typeof model.validUntil === "string" && Number.isFinite(Date.parse(model.validUntil)) && Date.parse(model.validUntil) > now));
  }
  if (initialTaskDetailRead && (initialTaskDetailRead.itemId !== initialTaskDetailRead.model.item.id || !validDetailReceipt(initialTaskDetailRead.model, initialTaskDetailRead.readAuthority)
    || initialTaskDetailRead.session.userId !== userId || initialSession?.revision !== initialTaskDetailRead.session.revision)) initialData = emptyPlanningShellState;
  let actorIdentity = initialCurrentProfile || null;
  let confirmed = initialData;
  let visible = initialData;
  let active = Boolean(userId);
  let initialized = active;
  let requiresBoundHydration = false;
  let sequence = 0;
  let sessionGeneration = 0;
  let sessionExpiresAt = initialSession?.expiresAt;
  let sessionRevision = initialSession?.revision;
  let planningAuthority = initialWorkspaceRead?.workspace === "planning" ? initialWorkspaceRead.readAuthority || { userId, deadline: 0 } : undefined;
  const hydrationReads = new Map<AppWorkspace, import("../planning-workspace-hydration").PlanningWorkspaceHydration>();
  if (initialWorkspaceRead && initialWorkspaceRead.workspace === initialWorkspace && initialWorkspaceRead.session.userId === userId) hydrationReads.set(initialWorkspace, initialWorkspaceRead);
  const taskConfirmedAt = new Map<string, number>();
  const taskReadAt = new Map<string, number>();
  let planningSourceEpoch = 0;
  const candidateReads = createPlanningCandidateReads({ read: adapter.readCandidates, publish, now: () => adapter.now?.() ?? Date.now(),
    binding: () => ({ active: isActive(), generation: sessionGeneration, sourceEpoch: planningSourceEpoch, sessionRevision, userId, actor: actorIdentity }) });

  let planningInteraction: import("../planning-state").PlanningInteraction = { selectedTaskId: null };
  const boardInteractions = new Set<symbol>();
  const heldReads = new Set<() => void>();
  function releaseHeldReads() {
    for (const resolve of heldReads) resolve();
    heldReads.clear();
  }
  const planningConsumers = new Set<symbol>();
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let invalidatedAt = 0;
  function clearAutomaticRefresh() {
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }
  function scheduleAffectedRefresh() {
    clearAutomaticRefresh();
    if (!planningConsumers.size || !active) return;
    const delay = Math.max(0, invalidatedAt + 500 - (adapter.now?.() ?? Date.now()));
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      if (!planningConsumers.size || !isActive() || workspaceStatuses.get("planning") === "forbidden") return;
      const pending = workspaceReads.get("planning")?.result || boardRead?.result || (columnReads.size ? Promise.all([...columnReads.values()].map(read => read.result)) : undefined);
      if (pending) {
        void pending.finally(() => {
          if (workspaceStatuses.get("planning") === "stale") scheduleAffectedRefresh();
        });
        return;
      }
      void planning.refreshWorkspace("planning");
    }, delay);
  }
  function invalidatePlanningSource(invalidateChildren = true) {
    candidateReads.invalidate();
    selectedBacklog = undefined; selectedBacklogRead?.controller.abort(); clearBacklogSupport();
    if (invalidateChildren) for (const [id, list] of childLists) {
      if (list.readStatus === "current" || list.readStatus === "loading") childLists.set(id, { ...list, readStatus: "stale" });
    }
    releaseHeldReads();
    planningSourceEpoch++;
    invalidatedAt = adapter.now?.() ?? Date.now();
    sourceStatus = "changed";
    freshness = "stale";
    planningQueries.clear();
    queryRevision = undefined;
    for (const workspace of workspaceStatuses.keys()) {
      if (workspace !== "planning" && workspaceReadCoverage(workspace).tasks && workspaceStatuses.get(workspace) !== "forbidden") workspaceStatuses.set(workspace, "stale");
    }
    scheduleAffectedRefresh();
    if (tableResult) tableResult = { ...tableResult, page: { ...tableResult.page, continuation: null }, risksById: Object.fromEntries(tableResult.rowIds.map(id => [id, null])) };
    if (!boardResult) {
      pageStatus = "stale";
      if (workspaceStatuses.has("planning")) workspaceStatuses.set("planning", "stale");
      return;
    }
    boardResult = { ...boardResult, columns: Object.fromEntries(Object.entries(boardResult.columns).map(([column, value]) => {
      columnReadStatus[column as TaskStatus] = "stale";
      return [column, { ...value, continuation: null }];
    })) as PlanningBoardResult["columns"] };
    pageStatus = "stale";
    workspaceStatuses.set("planning", "stale");
  }
  function confirmTaskRevision(id: string, accepted: number, newParentId?: string | null) {
    taskConfirmedAt.set(id, accepted);
    const previousParentId = confirmed.tasks.find(task => task.id === id)?.parentTaskId;
    for (const [parentId, list] of childLists) {
      if (list.readStatus === "current" && (parentId === id || parentId === previousParentId || parentId === newParentId || list.ids.has(id))) childLists.set(parentId, { ...list, readStatus: "stale" });
    }
    // A confirmed write identifies its affected parents above. An observed
    // external source change has no such narrower membership evidence.
    invalidatePlanningSource(false);
  }
  function detachPlanningMetadata() {
    releaseHeldReads();
    planningSourceEpoch++;
    freshness = "stale";
    boardResult = undefined;
    tableResult = undefined;
    tableRead = undefined; tableRequest = undefined;
    boardQueryKey = undefined;
    planningQueries.clear();
    queryRevision = undefined;
    scopeRevision = undefined;
    scopeRevisionReadAt = 0;
    weekBasis = undefined;
    pageStatus = "not-loaded";
    columnReads.clear();
    columnRequests.clear();
    for (const read of summaryReads.values()) read.controller.abort();
    summaryReads.clear(); summarySequences.clear();
    for (const column of Object.keys(columnReadStatus) as TaskStatus[]) delete columnReadStatus[column];
  }
  function denyPlanningScope() {
    candidateReads.deny();
    detachPlanningMetadata();
    for (const id of new Set([...confirmed.tasks.map(task => task.id), ...detailReads.keys()])) {
      deniedTaskReads.add(id);
      taskDeniedAt.set(id, ++sequence);
      detailStatuses.set(id, "forbidden");
      const list = childLists.get(id);
      if (list) childLists.set(id, { ...list, readStatus: "forbidden" });
    }
    workspaceStatuses.set("planning", "forbidden");
  }
  const memberships = new Map<AppWorkspace, Set<string>>([[initialWorkspace, new Set(initialData.tasks.map(task => task.id))]]);
  const workspaceStatuses = new Map<AppWorkspace, PlanningReadStatus>([[initialWorkspace, "current"]]);
  const completeness = new Map<AppWorkspace, PlanningWorkspaceView["completeness"]>([[initialWorkspace, initialWorkspaceRead?.coverage.tasks || workspaceReadCoverage(initialWorkspace).tasks || "none"]]);
  const acceptedRead = new Map<AppWorkspace, number>();
  const workspaceReads = new Map<AppWorkspace, { result: Promise<boolean>; generation: number; started: number; sourceEpoch: number; sessionRevision?: string }>();
  const readTransports = new Map<number, { workspace: AppWorkspace; controller: AbortController }>();
  function cancelPlanningReads() {
    for (const read of readTransports.values()) if (read.workspace === "planning") read.controller.abort();
    for (const read of summaryReads.values()) read.controller.abort();
  }
  const hydrationRequests = new Map<AppWorkspace, ReturnType<typeof beginWorkspaceRead>>();
  type SupportEntry = { value: BacklogControls | BacklogSprintBasis; generation: number; session: string | undefined; epoch: number; actorId: string; actorRole: string; deadline: number };
  type SupportPending = { key: string; result: Promise<boolean>; controller: AbortController; consumers: Set<symbol> };
  const backlogSupport = new Map<BacklogSupportQuery["area"], SupportEntry>();
  const backlogSupportReads = new Map<BacklogSupportQuery["area"], SupportPending>();
  const backlogSupportSequences = new Map<BacklogSupportQuery["area"], number>();
  const backlogSupportStatuses = new Map<BacklogSupportQuery["area"], PlanningReadStatus>();
  let backlogSourceReceipt: { revision: string; started: number; generation: number; session: string | undefined; epoch: number; actorId: string; actorRole: string; deadline: number } | undefined;
  function clearBacklogSupport() {
    backlogSourceReceipt = undefined;
    for (const read of backlogSupportReads.values()) read.controller.abort();
    backlogSupportReads.clear(); backlogSupport.clear(); backlogSupportSequences.clear(); backlogSupportStatuses.clear();
  }
  let selectedBacklog: { selection: BacklogSelection; generation: number; session: string | undefined; epoch: number; deadline: number } | undefined;
  let selectedBacklogRead: { key: string; result: Promise<boolean>; controller: AbortController; consumers: Set<symbol> } | undefined;
  let backlogCoverage: import("@/features/backlog/model/backlog-read-model").BacklogReadCoverage = {};
  let freshness: "current" | "stale" = "current";
  let boardResult = initialWorkspaceRead?.board;
  let tableResult = initialWorkspaceRead?.table;
  let tableRead: { key: string; result: Promise<boolean> } | undefined;
  let tableRequest: number | undefined;
  let weekBasis = planningWeekBasis(boardResult || tableResult, initialWorkspaceRead?.coverage, initialData.sprints);
  let boardQuery = initialWorkspaceRead?.query || boardResult?.query || tableResult?.query;
  let displayedQuery = boardQuery;
  let boardQueryKey = boardQuery ? planningBoardQueryKey(boardQuery) : undefined;
  let pageStatus: PlanningReadStatus = "current";
  const columnReadStatus: Partial<Record<TaskStatus, PlanningReadStatus>> = {};
  for (const [column, coverage] of Object.entries(boardResult?.columns || {})) if (coverage.availability === "not-loaded") columnReadStatus[column as TaskStatus] = "not-loaded";
  const columnReads = new Map<TaskStatus, { key: string; result: Promise<boolean> }>();
  const columnRequests = new Map<TaskStatus, number>();
  const summarySequences = new Map<string, number>();
  const summaryReads = new Map<string, { result: Promise<boolean>; controller: AbortController }>();
  const boardDeliveries = new Map<string, { basis: PlanningWorkspaceRead; tokens: Map<TaskStatus, ReturnType<typeof beginWorkspaceRead>>; pending: Set<TaskStatus>; summaries: Map<string, ReturnType<typeof beginBoardSummaryRead>> }>();
  let boardRead: { key: string; result: Promise<boolean>; sequence: number; sourceEpoch: number } | undefined;
  let queryRevision = initialWorkspaceRead?.queryRevision || boardResult?.revision || tableResult?.revision;
  let scopeRevision = initialWorkspaceRead?.scopeRevision;
  let scopeRevisionReadAt = 0;
  let sourceStatus: import("../planning-state").PlanningSourceStatus = "current";
  let sourceObservation: Promise<import("../planning-state").PlanningSourceObservation> | undefined;
  let sourceTransport: AbortController | undefined;
  const planningQueries = new Map<string, {
    query: NonNullable<typeof boardQuery>;
    revision: string;
    result: typeof boardResult;
    table: typeof tableResult;
    taskIds: Set<string>;
    completeness: PlanningWorkspaceView["completeness"];
    pageStatus: PlanningReadStatus;
    columnReadStatus: Partial<Record<TaskStatus, PlanningReadStatus>>;
    sourceEpoch: number;
    weekBasis?: PlanningWeekBasis;
    readAuthority?: import("../planning-server-header-read").PlanningReadAuthority;
  }>();
  let queuedQuery: { query: PlanningBoardQuery; result: Promise<boolean>; resolve: (accepted: boolean) => void; timer: ReturnType<typeof setTimeout> } | undefined;
  let failedQueryDemand: { query: string; generation: number; sourceEpoch: number } | undefined;
  function discardQueuedQuery() {
    if (!queuedQuery) return;
    clearTimeout(queuedQuery.timer);
    queuedQuery.resolve(false);
    queuedQuery = undefined;
  }
  function rememberPlanningQuery() {
    if (!boardQuery || !boardQueryKey || !queryRevision || workspaceStatuses.get("planning") !== "current") return;
    planningQueries.set(boardQueryKey, {
      query: boardQuery, revision: queryRevision, result: boardResult, table: tableResult,
      taskIds: new Set(memberships.get("planning")), completeness: completeness.get("planning") || "none",
      pageStatus, columnReadStatus: { ...columnReadStatus }, sourceEpoch: planningSourceEpoch, weekBasis, readAuthority: planningAuthority,
    });
  }
  let ended = false;
  const detailUnavailable = new Map<string, TaskDetailUnavailableArea[]>();
  const deniedTaskReads = new Set<string>();
  const taskDeniedAt = new Map<string, number>();
  const retainedTaskFields = new Map<string, Set<keyof Task>>();
  const summaryDetailFields: (keyof Task)[] = ["problemStatement", "intendedOutcome", "scopeConstraints", "evidenceRequired", "note"];
  const staleSnapshotFields: (keyof Task)[] = [...summaryDetailFields,"dependsOn","strategy","raciAssignments","evidenceLink","evidenceLinks","linkedPullRequests","assignee","owner","createdBy","parentApprovalStatus"];
  function restoreTaskFieldCoverage(tasks: readonly Task[]) {
    for (const task of tasks) {
      if (task.detailAvailability === "summary") retainedTaskFields.set(task.id,new Set(summaryDetailFields));
      if (task.detailAvailability === "stale") retainedTaskFields.set(task.id,new Set(staleSnapshotFields));
    }
  }
  restoreTaskFieldCoverage(initialData.tasks);
  for (const task of initialData.tasks) if (initialWorkspaceRead?.taskOmittedFields?.length) retainedTaskFields.set(task.id, new Set(initialWorkspaceRead.taskOmittedFields));
  function acceptTaskFieldCoverage(task: Partial<Task> & { id: string }, omitted: readonly (keyof Task)[] = []) {
    const previous = confirmed.tasks.find(row => row.id === task.id);
    const retained = new Set(retainedTaskFields.get(task.id));
    const excluded = new Set(omitted);
    for (const field of Object.keys(task) as (keyof Task)[]) if (!excluded.has(field)) retained.delete(field);
    if (previous?.updatedAt !== task.updatedAt) omitted.forEach(field => retained.add(field));
    if (retained.size) retainedTaskFields.set(task.id, retained); else retainedTaskFields.delete(task.id);
  }

  const profileScopes = new Map<string, Set<string>>([[initialWorkspace, new Set(initialData.profiles.map(profile => profile.id))]]);
  if (administrationActorProfileId) profileScopes.set("session", new Set([administrationActorProfileId]));
  function acceptProfileScope(scope: string, profiles: readonly { id: string }[], complete = false) {
    const members = complete ? new Set<string>() : new Set(profileScopes.get(scope));
    profiles.forEach(profile => members.add(profile.id));
    profileScopes.set(scope, members);
  }
  function canPresentProfile(id: string) {
    return [...profileScopes].some(([scope, members]) => members.has(id) && (scope.startsWith("task:") ? !deniedTaskReads.has(scope.slice(5)) : workspaceStatuses.get(scope as AppWorkspace) !== "forbidden"));
  }

  const detailStatuses = new Map<string, PlanningReadStatus>(initialData.tasks.filter(task=>task.detailAvailability === "stale").map(task=>[task.id,"stale"]));
  const childLists = new Map<string, { ids: Set<string>; started: number; readStatus: PlanningReadStatus; coverage?: "complete" | "partial"; progress?: ReturnType<typeof taskChildProgress> }>();
  const scopedDetailIds = new Set<string>();
  type DetailReadBinding = {
    generation: number; sourceEpoch: number; sessionRevision: string | undefined; userId: string;
    actor: TaskDetailModel["readActor"];
  };
  type DetailReceipt = DetailReadBinding & {
    taskId: string; area: import("@/features/tasks/model/task-detail-read-model").TaskDetailReadArea;
    ids: string[]; contextIds: string[]; omittedFields: readonly (keyof Task)[]; started: number;
    deadline: number; validUntil: string | null; sourceRevision: string;
  };
  const detailReceipts = new Map<string, DetailReceipt>();
  function rememberDetailReceipt(taskId: string, area: import("@/features/tasks/model/task-detail-read-model").TaskDetailReadArea, model: TaskDetailModel, authority: import("../planning-server-header-read").PlanningReadAuthority, started = 0,
    binding: DetailReadBinding = { generation: sessionGeneration, sourceEpoch: planningSourceEpoch, sessionRevision, userId: authority.userId, actor: model.readActor }) {
    const children = new Set(model.children.map(row => row.id));
    const contextIds = [model.item.id, ...model.ancestors.map(row => row.id)].filter(id => !children.has(id));
    detailReceipts.set(taskId+":"+area, { ...binding,
      actor: binding.actor && model.readActor && binding.actor.profileId === model.readActor.profileId && binding.actor.platformRole === model.readActor.platformRole ? { ...model.readActor } : undefined,
      taskId, area, started, contextIds, omittedFields: [...model.taskOmittedFields || []],
      ids: [model.item.id, ...model.ancestors.map(row => row.id), ...(area === "children" ? model.children.map(row => row.id) : [])],
      deadline: Math.min(authority.deadline, model.authorityDeadline!), validUntil: model.validUntil!, sourceRevision: model.sourceRevision! });
  }
  const detailAreaStatuses = new Map<string, PlanningReadStatus>();
  const detailReads = new Map<string, ReturnType<PlanningState["loadTaskDetail"]>>();
  const detailDemands = new Map<string, { controller: AbortController; consumers: Set<symbol>; settled: boolean; previous: PlanningReadStatus }>();
  function retainDetailRead(key: string, taskId: string, area: import("@/features/tasks/model/task-detail-read-model").TaskDetailReadArea, promise: ReturnType<PlanningState["loadTaskDetail"]>, signal?: AbortSignal) {
    const demand = detailDemands.get(key);
    if (!demand) return promise;
    const consumer = Symbol(key);
    demand.consumers.add(consumer);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      signal?.removeEventListener("abort", release);
      demand.consumers.delete(consumer);
      if (!demand.consumers.size && !demand.settled && detailDemands.get(key) === demand) {
        demand.controller.abort();
        detailDemands.delete(key);
        detailReads.delete(key);
        if (isActive()) {
          const next = demand.previous === "current" ? "stale" : demand.previous;
          if (area === "target") detailStatuses.set(taskId, next);
          else if (area === "children") {
            const list = childLists.get(taskId);
            if (list) childLists.set(taskId, { ...list, readStatus: next });
          } else detailAreaStatuses.set(key, next);
          publish();
        }
      }
    };
    signal?.addEventListener("abort", release, { once: true });
    if (signal?.aborted) release();
    return promise.then(result => signal?.aborted ? { ok: false } : result).finally(release);
  }

  const tails = new Map<string, { context: symbol; result: Promise<TaskUpdateResult> }>();
  const pending = new Map<symbol, { taskId: string; patch: Partial<Task>; submitted: Partial<Task>; phase: PlanningTaskSaveView["phase"] }>();
  const outcomeChecks = new Map<string, ReturnType<PlanningState["checkTaskSave"]>>();
  const outcomeCheckStatus = new Map<string, PlanningTaskSaveView["checkStatus"]>();
  const status = new Map<string, PlanningTaskSaveStatus>();
  const listeners = new Set<() => void>();
  let deferNotifications = false;
  const commentDrafts = new Map<string, { text: string }>();
  function isActive() {
    if (active && sessionExpiresAt !== undefined && sessionExpiresAt * 1000 <= (adapter.now?.() ?? Date.now())) suspendProtected();
    if (active) {
      const now = adapter.now?.() ?? Date.now();
      const expired = [...detailReceipts].filter(([,read]) => read.deadline <= now || read.validUntil && Date.parse(read.validUntil) <= now);
      for (const [key] of expired) detailReceipts.delete(key);
      for (const [,read] of expired) {
        if (read.area === "children") {
          const list = childLists.get(read.taskId);
          if (list) childLists.set(read.taskId, { ...list, readStatus: "stale" });
        }
        if (read.area === "discussion") {
          confirmed = { ...confirmed, taskComments: confirmed.taskComments.filter(row => row.taskId !== read.taskId), taskExternalComments: confirmed.taskExternalComments.filter(row => row.taskId !== read.taskId) };
          visible = { ...visible, taskComments: visible.taskComments.filter(row => row.taskId !== read.taskId), taskExternalComments: visible.taskExternalComments.filter(row => row.taskId !== read.taskId) };
          detailAreaStatuses.set(read.taskId+":discussion", "stale");
        }
        if (read.area === "timeline") {
          confirmed = { ...confirmed, taskActivity: confirmed.taskActivity.filter(row => row.taskId !== read.taskId), taskReviews: confirmed.taskReviews.filter(row => row.taskId !== read.taskId) };
          visible = { ...visible, taskActivity: visible.taskActivity.filter(row => row.taskId !== read.taskId), taskReviews: visible.taskReviews.filter(row => row.taskId !== read.taskId) };
          detailAreaStatuses.set(read.taskId+":timeline", "stale");
        }
        for (const id of read.ids) if (![...detailReceipts.values()].some(other => other.ids.includes(id))) deniedTaskReads.add(id);
        if (deniedTaskReads.has(read.taskId)) detailStatuses.set(read.taskId, "stale");
      }
      if (expired.length) { visible = protectedPublication(visible); publishCache?.(null); }
    }
    if (active && planningAuthority && (planningAuthority.userId !== userId || !Number.isFinite(planningAuthority.deadline) || planningAuthority.deadline <= (adapter.now?.() ?? Date.now()))) {
      planningAuthority = undefined;
      const expired = memberships.get("planning") || new Set<string>();
      for (const id of expired) if (![...memberships].some(([scope, members]) => scope !== "planning" && members.has(id)) && detailStatuses.get(id) !== "current") deniedTaskReads.add(id);
      detachPlanningMetadata();
      memberships.delete("planning");
      profileScopes.delete("planning");
      completeness.set("planning", "none");
      workspaceStatuses.set("planning", "not-loaded");
      visible = protectedPublication(visible);
    }
    return active;
  }
  function readErrorStatus(error: unknown): "forbidden" | "unavailable" {
    return typeof error === "object" && error !== null && "status" in error && (error.status === 401 || error.status === 403) ? "forbidden" : "unavailable";
  }
  const githubConnection = createGitHubConnectionState({active:isActive,generation:()=>sessionGeneration,changed:publish,endSession,read:adapter.readGitHubConnection});
  const githubSync = createTaskGitHubSyncState({adapter,current:()=>confirmed,active:isActive,generation:()=>sessionGeneration,changed:publish,nextSequence:()=>++sequence,now:()=>adapter.now?.()??Date.now(),canRead:id=>!deniedTaskReads.has(id)&&confirmed.tasks.some(task=>task.id===id&&!lifecycle.isRemoved(task)),dependencyPending:task=>relationshipChanges.blocksTask(task.id)||taskReviews.blocksTask(task.id)||attachmentUploads.blocksTask(task.id)||blockerReports.blocksTask(task.id)||githubImports.blocksTask(task.id)||lifecycle.isRemoving(task)||backlogAssignments.blocksTask(task.id)||backlogOrdering.blocksTask(task.id)||sprintLock.blocksTask(task)||taskSchedulePending(task.id)||[...pending.values()].some(operation=>operation.taskId===task.id),accept(task,patch,started){
    const current=confirmed.tasks.find(row=>row.id===task.id);
    if(!current)return false;
    if(Math.max(taskConfirmedAt.get(task.id)||0,taskReadAt.get(task.id)||0)>started&&current.updatedAt!==task.updatedAt&&current.updatedAt!==patch.updatedAt)return false;
    confirmed={...confirmed,tasks:confirmed.tasks.map(row=>row.id===task.id?{...row,...patch}:row)};confirmTaskRevision(task.id,++sequence);return true;
  },invalidateTask(id){confirmTaskRevision(id,++sequence);freshness="stale";detailStatuses.set(id,"stale");for(const [workspace,members] of memberships)if(members.has(id))workspaceStatuses.set(workspace,"stale");},refresh:reloadBlockerTask,timelineLoaded:id=>detailReads.has(id)||detailStatuses.get(id)==="current"||confirmed.taskComments.some(comment=>comment.taskId===id),invalidateConnection:githubConnection.invalidate,endSession});
  const workweekCalendars = createPublishedWorkweekCalendars({ active: isActive, generation: () => sessionGeneration, changed: publish, now: () => adapter.now?.() ?? Date.now(), read: adapter.readWorkweekCalendar });
  const privateWorkweek = createPrivateWorkweekState({ adapter, active: isActive, generation: () => sessionGeneration, changed: () => { if (!googleWorkspace.privateContextChanged()) publish(); }, published: workweekCalendars.invalidatePublishedWorkweeks, publicationBlocked: () => googleWorkspace.blocksPublication() });
  const googleWorkspace = createGoogleWorkspaceState({ adapter, active: isActive, generation: () => sessionGeneration, changed: publish, invalidate: workweekCalendars.invalidatePublishedWorkweeks, privateBusy: privateWorkweek.publicationBusy, privateContext: privateWorkweek.disconnectBinding, privateChanged: privateWorkweek.connectionChanged });
  const administration = createAdministrationPersonState({ actorRole: () => confirmed.profiles.find(profile => profile.id === administrationActorProfileId)?.platformRole || null, active: isActive, generation: () => sessionGeneration, changed: publish, now: () => adapter.now?.() ?? Date.now(), profiles: () => visible.profiles, nextSequence: () => ++sequence, acceptCommonPeople: (people, started) => profileSettings.acceptAdministrationPeople(people, started), invalidateDeliveryEffects: () => notifications.deliveryStarted(), refreshDeliveryEffects: () => notifications.refreshDeliveryEffects(), commonProject: () => confirmed.project, acceptCommonProject: project => { confirmed = {...confirmed,project:{...confirmed.project,githubProjectOwner:project.owner,githubProjectNumber:project.number}}; }, initialAuthority: initialAdministrationAuthority, read: adapter.readAdministration, adapter });
  const notifications = createHeaderNotificationsState({ initialData: active ? initialData : emptyPlanningShellState, initialHeaderData: active ? initialHeaderData : undefined, serverRead: initialServerHeaderRead, acceptsReadAuthority: read => isActive() && read.userId === userId && read.deadline > (adapter.now?.() ?? Date.now()), acceptsServerRead: read => isActive() && read.userId === userId && read.sessionRevision === sessionRevision && read.deadline > (adapter.now?.() ?? Date.now()) && Number.isFinite(read.timeoutAt) && read.timeoutAt > (adapter.now?.() ?? Date.now()), notificationsLoaded: initialWorkspace === "notifications", adapter, isActive, generation: () => sessionGeneration, changed: publish, refreshNotifications: () => planning.refreshWorkspace("notifications") });
  const events = createEventsState({ initial: active ? initialData.events : [], loaded: initialWorkspace === "events", adapter, active: isActive, generation: () => sessionGeneration, changed: publish, invalidateCalendar: () => notifications.invalidateHeader(["calendarEvents"]), refreshWorkspace: () => planning.refreshWorkspace("events"), endSession,
    beginHeaderRead: () => notifications.beginWorkspaceRead("events"),
    acceptHeaderRead: (data, started) => notifications.acceptWorkspaceRead("events", confirmed, { ...emptyPlanningHeaderData, calendarEvents: notifications.publicState.header().slots.calendarEvents.readStatus === "not-loaded" ? emptyPlanningHeaderData.calendarEvents : data.calendarEvents }, started),
  });
  const tools = createToolsState({ initial: active ? initialData.fmdTools : [], loaded: initialWorkspace === "tools", adapter, active: isActive, generation: () => sessionGeneration, changed: publish, endSession, invalidateQuickLinks: () => notifications.invalidateHeader(["quickLinks"]), refreshWorkspace: () => planning.refreshWorkspace("tools"), beginHeaderRead: () => notifications.beginWorkspaceRead("tools"), acceptHeaderRead: (data, started) => notifications.acceptWorkspaceRead("tools", confirmed, { ...emptyPlanningHeaderData, quickLinks: notifications.publicState.header().slots.quickLinks.readStatus === "not-loaded" ? emptyPlanningHeaderData.quickLinks : data.quickLinks }, started) });
  const blockerReports = createTaskBlockerReports({ initial: active ? initialData.taskBlockers : [], adapter, active: isActive, generation: () => sessionGeneration, changed: publish, nextSequence: () => ++sequence,
    canRead: id => !deniedTaskReads.has(id) && confirmed.tasks.some(task => task.id === id && !lifecycle.isRemoved(task)),
    dependencyPending: task => githubSync.blocksTask(task.id) || taskReviews.blocksTask(task.id) || relationshipChanges.blocksTask(task.id) || attachmentUploads.blocksTask(task.id) || githubImports.blocksTask(task.id) || lifecycle.isRemoving(task) || backlogAssignments.blocksTask(task.id) || backlogOrdering.blocksTask(task.id) || sprintLock.blocksTask(task) || taskSchedulePending(task.id),
    invalidateTask(id) { confirmTaskRevision(id, ++sequence); freshness = "stale"; detailStatuses.set(id, "stale"); for (const [workspace, members] of memberships) if (members.has(id)) workspaceStatuses.set(workspace, "stale"); },
    invalidateNotifications: () => notifications.invalidateHeader(["notifications"]), endSession, refresh: reloadBlockerTask,
  });
  const commentCreations = createTaskCommentCreations({ actor: userId, initial: active ? initialData.taskComments : [], adapter, active: isActive, generation: () => sessionGeneration, changed: publish, nextSequence: () => ++sequence,
    canRead: id => !deniedTaskReads.has(id) && confirmed.tasks.some(task => task.id === id && !lifecycle.isRemoved(task)), removing: id => { const task=confirmed.tasks.find(task=>task.id===id); return !task || lifecycle.isRemoving(task); }, detailStatus: id => detailStatuses.get(id) || "not-loaded", endSession,
    invalidateNotifications: () => notifications.invalidateHeader(["notifications"]), refresh: reloadCommentDiscussion,
  });
  const githubImports = createTaskGitHubImports({ initial: active ? initialData.taskExternalComments : [], adapter, active: isActive, generation: () => sessionGeneration, changed: publish, nextSequence: () => ++sequence,
    canRead: id => !deniedTaskReads.has(id) && confirmed.tasks.some(task => task.id === id && !lifecycle.isRemoved(task)),
    dependencyPending: task => githubSync.blocksTask(task.id) || taskReviews.blocksTask(task.id) || relationshipChanges.blocksTask(task.id) || attachmentUploads.blocksTask(task.id) || lifecycle.isRemoving(task) || blockerReports.blocksTask(task.id) || backlogAssignments.blocksTask(task.id) || backlogOrdering.blocksTask(task.id) || sprintLock.blocksTask(task) || taskSchedulePending(task.id) || [...pending.values()].some(item => item.taskId === task.id),
    invalidateTask(id) { confirmTaskRevision(id, ++sequence); freshness = "stale"; detailStatuses.set(id, "stale"); for (const [workspace, members] of memberships) if (members.has(id)) workspaceStatuses.set(workspace, "stale"); },
    invalidateNotifications: () => notifications.invalidateHeader(["notifications"]), endSession, refresh: reloadGitHubImport,
  });
  const attachmentUploads = createTaskAttachmentUploads({ initial: active ? initialData.taskActivity : [], adapter, active: isActive, generation: () => sessionGeneration, changed: publish, nextSequence: () => ++sequence,
    canRead: id => !deniedTaskReads.has(id) && confirmed.tasks.some(task => task.id === id && !lifecycle.isRemoved(task)),
    dependencyPending: task => githubSync.blocksTask(task.id) || taskReviews.blocksTask(task.id) || relationshipChanges.blocksTask(task.id) || blockerReports.blocksTask(task.id) || githubImports.blocksTask(task.id) || lifecycle.isRemoving(task) || backlogAssignments.blocksTask(task.id) || backlogOrdering.blocksTask(task.id) || sprintLock.blocksTask(task) || taskSchedulePending(task.id),
    invalidateTask(id) { confirmTaskRevision(id, ++sequence); freshness = "stale"; detailStatuses.set(id, "stale"); for (const [workspace, members] of memberships) if (members.has(id)) workspaceStatuses.set(workspace, "stale"); },
    endSession, refresh: reloadBlockerTask,
  });
  const relationshipChanges = createTaskRelationshipChanges({ initial: active ? initialData.taskRelations : [], adapter, active: isActive, generation: () => sessionGeneration, changed: publish, nextSequence: () => ++sequence,
    canRead: id => !deniedTaskReads.has(id) && confirmed.tasks.some(task => task.id === id && !lifecycle.isRemoved(task)), currentTask: id => confirmed.tasks.find(task => task.id === id),
    dependencyPending: id => githubSync.blocksTask(id) || taskReviews.blocksTask(id) || taskSchedulePending(id) || blockerReports.blocksTask(id) || githubImports.blocksTask(id) || attachmentUploads.blocksTask(id) || backlogAssignments.blocksTask(id) || backlogOrdering.blocksTask(id) || lifecycle.isRemoving({ id } as Task) || lifecycle.isRemoved({ id } as Task) || Boolean(confirmed.tasks.find(task => task.id === id && sprintLock.blocksTask(task))),
    invalidateTask(id) { confirmTaskRevision(id, ++sequence); freshness = "stale"; detailStatuses.set(id, "stale"); for (const [workspace, members] of memberships) if (members.has(id)) workspaceStatuses.set(workspace, "stale"); },
    invalidateNotifications: () => notifications.invalidateHeader(["notifications"]), endSession, refresh: reloadBlockerTask,
    confirmRelation: relation => { lifecycle.confirmRelationship(relation); invalidatePlanningSource(); }, removeRelation: id => { lifecycle.confirmRelationshipRemoval(id); invalidatePlanningSource(); },
  });
  const taskReviews = createTaskReviewOperations({ adapter, current: () => confirmed, active:isActive, generation:()=>sessionGeneration, changed:publish,nextSequence:()=>++sequence,canRead:id=>!deniedTaskReads.has(id)&&confirmed.tasks.some(task=>task.id===id&&!lifecycle.isRemoved(task)),dependencyPending:task=>githubSync.blocksTask(task.id)||relationshipChanges.blocksTask(task.id)||attachmentUploads.blocksTask(task.id)||lifecycle.isRemoving(task)||githubImports.blocksTask(task.id)||blockerReports.blocksTask(task.id)||backlogAssignments.blocksTask(task.id)||backlogOrdering.blocksTask(task.id)||sprintLock.blocksTask(task)||taskSchedulePending(task.id)||[...pending.values()].some(op=>op.taskId===task.id),refresh:reloadBlockerTask,invalidate:()=>notifications.invalidateHeader(["notifications"]),accept(receipt,task,started,command){
    const current=confirmed.tasks.find(row=>row.id===task.id);
    const newer=Math.max(taskConfirmedAt.get(task.id)||0,taskReadAt.get(task.id)||0)>started&&current?.updatedAt!==task.updatedAt&&current?.updatedAt!==receipt.task.updatedAt;
    if(!newer) { const patch={...receipt.task,id:task.id}; confirmed=patch.approvalStatus!==undefined?applyPlanningItemApprovalPatch(confirmed,{...patch,approvalStatus:patch.approvalStatus}):{...confirmed,tasks:confirmed.tasks.map(row=>row.id===task.id?{...row,...patch}:row)};confirmTaskRevision(task.id,++sequence);
      if(receipt.task.approvalStatus!==undefined)for(const child of confirmed.tasks)if(child.taskType===(task.taskType==="initiative"?"deliverable":"sub_issue")&&child.parentTaskId===task.id)confirmTaskRevision(child.id,++sequence);
    }
    if(receipt.review)confirmed={...confirmed,taskReviews:[receipt.review,...confirmed.taskReviews.filter(review=>review.id!==receipt.review!.id)]};
    if(receipt.activities?.length){const byId=new Map(confirmed.taskActivity.map(activity=>[activity.id,activity]));for(const activity of receipt.activities)byId.set(activity.id,activity);confirmed={...confirmed,taskActivity:[...byId.values()]};}
    if(command.kind==="approval"&&detailStatuses.get(task.id)==="current") {detailStatuses.set(task.id,"stale");void planning.loadTaskDetail(task.id);}
  }});
  const attendanceState = createMeetingAttendanceState({ initial: active ? initialData.meetingAttendance : [], adapter, active: isActive, generation: () => sessionGeneration, nextSequence: () => ++sequence, changed: publish, endSession, dependencyPending: meeting => sprintLock.blocksSprint(meeting.sprintId), invalidateNotifications: () => notifications.invalidateHeader(["notifications"]) });
  const profileSettings = createProfileSettingsState({ confirmed: () => confirmed, update: data => {
    const directory = (profiles: PlanningShellState["profiles"]) => profiles.map(({ id, name, platformRole, githubLogin, avatarUrl, color, orgRole, focus, weeklyCapacity }) => ({ id, name, platformRole, githubLogin, avatarUrl, color, orgRole, focus, weeklyCapacity }));
    const sourceChanged = JSON.stringify(directory(data.profiles)) !== JSON.stringify(directory(confirmed.profiles));
    confirmed = data;
    if (sourceChanged) invalidatePlanningSource();
  }, changed: publish, active: isActive, generation: () => sessionGeneration, initialWorkspace, readStatus: (workspace = "profile") => workspaceStatuses.get(workspace) || "not-loaded", save: adapter.saveOwnProfileSettings, saveTeam: adapter.saveTeamProfile, governanceAuthorityChanged: notifications.invalidateNotificationAuthority, refreshTeam: () => planning.refreshWorkspace("team"), acknowledge: adapter.acknowledgeFeatureTour, refresh: () => planning.refreshWorkspace("profile"), nextSequence: () => ++sequence });
  const profileTokens = createProfileApiTokensState({ active: isActive, generation: () => sessionGeneration, changed: publish, adapter });
  const scoreObjections=createScoreObjectionState({current:()=>confirmed,update:data=>{confirmed=data;},changed:publish,nextSequence:()=>++sequence,active:isActive,generation:()=>sessionGeneration,refresh:()=>planning.refreshWorkspace("sprint"),readStatus:()=>workspaceStatuses.get("sprint")||"not-loaded",canRead:()=>!sprintState.denied(),dependencyPending:id=>sprintLock.blocksSprint(id),create:adapter.createScoreObjection,process:adapter.processScoreObjection});
  const commitments = createSprintCommitmentState({current:()=>confirmed,update:data=>{confirmed=data;},changed:publish,active:isActive,generation:()=>sessionGeneration,nextSequence:()=>++sequence,save:adapter.saveSprintCommitment,dependencyPending:id=>sprintLock.blocksSprint(id),checkDependency:id=>sprintLock.check(id),refresh:()=>planning.refreshWorkspace("sprint"),readStatus:()=>workspaceStatuses.get("sprint")||"not-loaded"});
  const sprintState = createSprintState({ current: () => confirmed, update: data => { const sourceChanged = data.sprints.length !== confirmed.sprints.length || data.sprints.some((sprint, index) => sprint !== confirmed.sprints[index]); confirmed = data; if (sourceChanged) invalidatePlanningSource(); }, changed: publish, active: isActive, generation: () => sessionGeneration, nextSequence: () => ++sequence, save: adapter.saveSprint, dependencyPending: id => blockerBlocksSprint(id) || backlogAssignments.blocksSprint(id) || orderingBlocksSprint(id), checkDependency: async id => { if (blockerBlocksSprint(id)) return checkSprintBlocker(id); if (orderingBlocksSprint(id)) await checkOrdering(); else await backlogAssignments.checkSprint(id); return { outcome: isActive() ? "unconfirmed" : "session-ended", readStatus: workspaceStatuses.get("backlog") || "unavailable" }; }, lockPending: id=>sprintLock.blocksSprint(id), checkLock:id=>sprintLock.check(id), planPending: id => sprintPlan.blocksSprint(id), checkPlan: () => sprintPlan.check(), reviewWindowPending: () => reviewWindow.blocksSprints(), checkReviewWindow: () => reviewWindow.check(), readStatus: () => workspaceStatuses.get("sprint") || "not-loaded", refresh: () => planning.refreshWorkspace("sprint") });
  const reviewWindow = createReviewWindowState({ current: () => confirmed, active: isActive, generation: () => sessionGeneration, changed: publish, nextSequence: () => ++sequence, schedulesPending: () => sprintState.schedulesPending() || sprintPlan.blocksSchedules() || sprintLock.pending() || backlogAssignments.pending() || backlogOrdering.pending() || confirmed.tasks.some(task => task.sprintId && taskEffectsPending(task.id)), checkSchedules: () => confirmed.tasks.some(task => task.sprintId && taskEffectsPending(task.id)) ? checkSprintBlocker() : backlogOrdering.pending() ? checkOrdering() : sprintLock.pending() ? sprintLock.check() : sprintPlan.blocksSchedules() ? sprintPlan.check() : sprintState.checkPendingSchedules(), save: adapter.saveReviewWindow, accept: sprintState.acceptReviewWindow, denied: sprintState.denied, readVersion: sprintState.reviewWindowReadVersion, readStatus: () => workspaceStatuses.get("sprint") || "not-loaded", refresh: () => planning.refreshWorkspace("sprint") });
  const sprintPlan = createSprintPlanState({ schedulesPending: () => sprintState.schedulesPending() || reviewWindow.blocksSprints() || sprintLock.pending() || backlogAssignments.pending() || backlogOrdering.pending() || confirmed.tasks.some(task => task.sprintId && taskEffectsPending(task.id)), checkSchedules: () => confirmed.tasks.some(task => task.sprintId && taskEffectsPending(task.id)) ? checkSprintBlocker() : backlogOrdering.pending() ? checkOrdering() : sprintLock.pending() ? sprintLock.check() : reviewWindow.blocksSprints() ? reviewWindow.check() : sprintState.checkPendingSchedules(), current: () => confirmed, active: isActive, generation: () => sessionGeneration, changed: publish, nextSequence: () => ++sequence, create: adapter.createSprintPlan, accept: sprintState.acceptPlan, denied: sprintState.denied, readStatus: () => workspaceStatuses.get("sprint") || "not-loaded", refresh: () => planning.refreshWorkspace("sprint") });
  const sprintLock = createSprintLockState({
    dependenciesPending: basis => attendanceState.pendingSprint(basis.sprint.id) || blockerBlocksSprint(basis.sprint.id) || sprintLock.blocksSprint(basis.sprint.id)
      || orderingBlocksSprint(basis.sprint.id)
      || commitments.pending(basis.sprint.id)
      || scoreObjections.blocks(basis.sprint.id)
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
      scoreObjections.acceptLock(receipt.sprint.id);
      for (const task of basis.tasks) {
        confirmTaskRevision(task.id, ++sequence);
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
      confirmTaskRevision(task.id, ++sequence); return { ...task, ...patch };
    }) };
    if (activities?.length) { const byId = new Map(confirmed.taskActivity.map(activity => [activity.id, activity])); for (const activity of activities) byId.set(activity.id, activity); confirmed = { ...confirmed, taskActivity: [...byId.values()] }; }
  }, invalidateDependencies(unknown) {
    if (unknown) { freshness = "stale"; workspaceStatuses.set("backlog", "stale"); }
    if (workspaceStatuses.has("sprint")) workspaceStatuses.set("sprint", "stale");
    notifications.invalidateHeader(["notifications"]);
  } });
  const backlogOrdering = createBacklogOrdering({ current: () => confirmed, active: isActive, generation: () => sessionGeneration, canRead: () => workspaceStatuses.get("backlog") !== "forbidden", changed: publish, nextSequence: () => ++sequence, readVersion: id => taskReadAt.get(id) || 0, adapter, endSession, pendingTask: id => taskEffectsPending(id) || Boolean(confirmed.tasks.find(task => task.id === id && sprintLock.blocksTask(task))) || [...pending.values()].some(item => item.taskId === id) || backlogAssignments.blocksTask(id) || lifecycle.isRemoving({ id } as Task) || taskSchedulePending(id), refresh: () => planning.refreshWorkspace("backlog"), accept(updates, started, basis) {
    const patches = new Map(updates.map(update => [update.id,update])); let unresolved = false;
    for (const update of updates) if (!confirmed.tasks.some(task => task.id === update.id)) { unresolved = true; confirmTaskRevision(update.id,++sequence); }
    confirmed = { ...confirmed, tasks: confirmed.tasks.map(task => {
      const update = patches.get(task.id); if (!update || lifecycle.isRemoved(task)) return task;
      const original = basis.find(item => item.id === task.id);
      if (Math.max(taskConfirmedAt.get(task.id) || 0, taskReadAt.get(task.id) || 0) > started && task.updatedAt !== original?.updatedAt && task.updatedAt !== update.updatedAt) return task;
      confirmTaskRevision(task.id,++sequence); return { ...task, order: update.sortOrder, updatedAt: update.updatedAt };
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
  function taskEffectsPending(id: string) { return githubSync.blocksTask(id) || taskReviews.blocksTask(id) || blockerReports.blocksTask(id) || githubImports.blocksTask(id) || attachmentUploads.blocksTask(id) || relationshipChanges.blocksTask(id); }
  function blockerBlocksSprint(id: string) { return confirmed.tasks.some(task => task.sprintId === id && taskEffectsPending(task.id)); }
  async function checkSprintBlocker(id?: string): Promise<import("../planning-state").PlanningTaskSaveCheck> { const task = confirmed.tasks.find(task => (id ? task.sprintId === id : Boolean(task.sprintId)) && taskEffectsPending(task.id)); return task ? githubSync.blocksTask(task.id) ? githubSync.check(task.id) : taskReviews.blocksTask(task.id) ? taskReviews.check(taskReviews.blockingOperation(task.id)!.id) : relationshipChanges.blocksTask(task.id) ? relationshipChanges.checkTask(task.id) : attachmentUploads.blocksTask(task.id) ? attachmentUploads.checkTask(task.id) : githubImports.blocksTask(task.id) ? githubImports.check(task.id) : blockerReports.checkTask(task.id) : { outcome: "not-pending", readStatus: "not-needed" }; }
  function taskSchedulePending(id: string) { const sprintId = confirmed.tasks.find(task => task.id === id)?.sprintId; return Boolean(sprintId && (sprintLock.blocksSprint(sprintId) || sprintState.pending(sprintId) || sprintPlan.blocksSprint(sprintId) || reviewWindow.blocksSprints())); }
  function orderingBlocksSprint(id: string) { return confirmed.tasks.some(task => task.sprintId === id && backlogOrdering.blocksTask(task.id)); }
  async function checkOrdering(): Promise<import("../planning-state").PlanningTaskSaveCheck> { const task = confirmed.tasks.find(task => backlogOrdering.blocksTask(task.id)); if (task) await backlogOrdering.checkTask(task.id); return { outcome: isActive() ? "unconfirmed" : "session-ended", readStatus: workspaceStatuses.get("backlog") || "unavailable" }; }
  function protectedPublication(data: PlanningShellState): PlanningShellState {
    const permitted = (id: string) => !deniedTaskReads.has(id);
    const permittedArea = (id: string, area: "discussion" | "timeline") => permitted(id) && !(scopedDetailIds.has(id) && detailAreaStatuses.get(id+":"+area) === "stale" && !detailReceipts.has(id+":"+area));
    return { ...data,
      profiles: data.profiles.filter(profile => canPresentProfile(profile.id)),
      tasks: data.tasks.filter(task => permitted(task.id)),
      taskComments: data.taskComments.filter(row => permittedArea(row.taskId, "discussion")),
      taskExternalComments: data.taskExternalComments.filter(row => permittedArea(row.taskId, "discussion")),
      taskBlockers: data.taskBlockers.filter(row => permitted(row.taskId)),
      taskRelations: data.taskRelations.filter(row => permitted(row.taskId) && permitted(row.relatedTaskId)),
      taskActivity: data.taskActivity.filter(row => permittedArea(row.taskId, "timeline")),
      taskReviews: data.taskReviews.filter(row => permittedArea(row.taskId, "timeline")),
    };
  }
  function publish() {
    isActive();
    confirmed = attendanceState.projectConfirmed(tools.projectConfirmed(events.projectConfirmed(notifications.projectConfirmed(lifecycle.projectConfirmed(relationshipChanges.projectConfirmed(attachmentUploads.projectConfirmed(githubImports.projectConfirmed(commentCreations.projectConfirmed(blockerReports.projectConfirmed(confirmed))))))))));
    if (boardResult && boardQuery && workspaceStatuses.get("planning") === "stale") {
      const byId = new Map(confirmed.tasks.map(task => [task.id, task]));
      const cards = boardResult.cardIds.flatMap(id => {
        const task = byId.get(id);
        if (!task || deniedTaskReads.has(id) || task.taskType !== boardQuery!.level) return [];
        if (boardQuery!.parentId !== "all" && task.parentTaskId !== boardQuery!.parentId) return [];
        if (boardQuery!.filters.status !== "Alle" && normalizeStatus(task.status) !== boardQuery!.filters.status) return [];
        return [task];
      });
      boardResult = { ...boardResult, cardIds: cards.map(task => task.id), columns: Object.fromEntries(Object.entries(boardResult.columns).map(([status, column]) => [status, { ...column, loaded: cards.filter(task => normalizeStatus(task.status) === status).length }])) as PlanningBoardResult["columns"] };
    }
    const taskView = { ...confirmed, tasks: confirmed.tasks.map(task => {
      let result = task;
      for (const operation of pending.values()) {
        if (operation.taskId === task.id) result = { ...result, ...operation.patch };
      }
      return result;
    }) };
    visible = sprintLock.project(backlogOrdering.project(backlogAssignments.project(sprintPlan.project(reviewWindow.project(sprintState.project(profileSettings.project(lifecycle.projectVisible(taskView))))))));
    visible = attendanceState.projectVisible(githubSync.protect(githubSync.projectVisible(taskReviews.projectVisible(visible))));
    visible = relationshipChanges.protect(relationshipChanges.projectVisible(attachmentUploads.protect(githubImports.protect(blockerReports.protect(blockerReports.projectVisible(visible))))));
    visible = commitments.project(visible);
    visible = administration.projectVisible(tools.projectVisible(events.projectVisible(notifications.projectVisible(visible))));

    visible = protectedPublication(visible);
    if (!isActive()) publishCache?.(null);
    else for (const [workspace, members] of memberships) {
      if (workspaceStatuses.get(workspace) === "forbidden") publishCache?.(null, workspace);
      else { const protectedData = protectedPublication(profileSettings.protect(githubSync.protect(relationshipChanges.protect(attachmentUploads.protect(githubImports.protect(blockerReports.protect(confirmed))))))); publishCache?.({ ...protectedData, tasks: protectedData.tasks.filter(task => members.has(task.id)) }, workspace); }
    }
    if (deferNotifications) queueMicrotask(() => listeners.forEach(listener => listener()));
    else listeners.forEach(listener => listener());
  }
  function saveTaskWithContext(task: Task, patch: Partial<Task>, context: symbol): Promise<TaskUpdateResult> {
    if ([...retainedTaskFields.get(task.id) || []].some(field => Object.prototype.hasOwnProperty.call(patch, field))) return Promise.resolve({ ok: false, kind: "versionConflict", status: 409, error: "Diese Detailfelder stammen aus einem älteren Stand. Bitte zuerst den vollständigen Stand vergleichen." });
    if (!isActive()) return Promise.resolve({ ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt.", status: 409 });
    if (patch.status === "Review" || patch.reviewStatus === "requested") return taskReviews.publicState.requestTaskReview(task, patch);
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
        acceptTaskFieldCoverage({ ...result.task, id: task.id }, [...retainedTaskFields.get(task.id) || []].filter(field => !Object.prototype.hasOwnProperty.call(result.task, field)));
        confirmTaskRevision(task.id, ++sequence, result.task.parentTaskId);
        notifications.invalidateHeader(["notifications"]);
        const currentAfterWrite = confirmed.tasks.find(item => item.id === task.id);
        const foreignConfirmed = currentAfterWrite?.updatedAt !== task.updatedAt && currentAfterWrite?.updatedAt !== result.task.updatedAt;
        const saved = foreignConfirmed ? currentAfterWrite! : { ...result.task, id: task.id };
        confirmed = (task.taskType === "deliverable" || task.taskType === "initiative") && saved.approvalStatus !== undefined
          ? applyPlanningItemApprovalPatch(confirmed, { ...saved, approvalStatus: saved.approvalStatus })
          : { ...confirmed, tasks: confirmed.tasks.map(item => item.id === task.id ? { ...item, ...saved } : item) };
        if (saved.approvalStatus !== undefined && (task.taskType === "initiative" || task.taskType === "deliverable")) {
          for (const child of confirmed.tasks) if (child.parentTaskId === task.id && child.taskType === (task.taskType === "initiative" ? "deliverable" : "sub_issue")) confirmTaskRevision(child.id, ++sequence);
        }

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
          notifications.invalidateHeader(["notifications"]);
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
      for (const id of ids) confirmTaskRevision(id, ++sequence);
      for (const members of memberships.values()) for (const id of ids) members.delete(id);
      confirmed = lifecycle.projectConfirmed(relationshipChanges.projectConfirmed(attachmentUploads.projectConfirmed(githubImports.projectConfirmed(commentCreations.projectConfirmed(blockerReports.projectConfirmed(confirmed))))));
      notifications.invalidateHeader(["notifications"]);
      if (action === "reject") { freshness = "stale"; void planning.loadTaskDetail(rootId); }
    },
    current: () => confirmed,
    capture: () => ++sequence,
    acceptCreation(result, started, relatedBasis) {
      const parent = confirmed.tasks.find(task => task.id === result.task.parentTaskId);
      const childType = parent?.taskType === "initiative" ? "deliverable" : parent?.taskType === "deliverable" ? "sub_issue" : null;
      const created = parent && result.task.taskType === childType && (taskConfirmedAt.get(parent.id) || 0) > started
        ? { ...result.task, parentApprovalStatus: parent.approvalStatus } : result.task;
      const incoming = [created, ...(result.relatedTask?.updatedAt ? [result.relatedTask] : [])];
      for (const task of incoming) {
        const current = confirmed.tasks.find(item => item.id === task.id);
        const unchangedRelatedBasis = relatedBasis?.id === task.id && current?.updatedAt === relatedBasis.updatedAt;
        if (((taskConfirmedAt.get(task.id) || 0) > started || (taskReadAt.get(task.id) || 0) > started) && !unchangedRelatedBasis) { freshness = "stale"; continue; }
        const known = confirmed.tasks.some(item => item.id === task.id);
        if (known) confirmed = { ...confirmed, tasks: confirmed.tasks.map(item => item.id === task.id ? { ...item, ...task } : item) };
        else if (task.id === result.task.id) confirmed = { ...confirmed, tasks: [...confirmed.tasks, created] };
        else { void planning.loadTaskDetail(task.id); continue; }
        confirmTaskRevision(task.id, ++sequence);
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
    uncoveredFields: task => [...retainedTaskFields.get(task.id) || []],
    currentTask: taskId => confirmed.tasks.find(task => task.id === taskId) || null,
    saveTask: saveTaskWithContext,
    reload: taskId => planning.loadTaskDetail(taskId),
    checkOutcome: taskId => planning.checkTaskSave(taskId),
    generation: () => sessionGeneration,
    isActive,
    canReadTask: taskId => !deniedTaskReads.has(taskId),
    changed: publish,
  });
  const hierarchy = createHierarchyCommands({planning:()=>planning,currentTask:id=>confirmed.tasks.find(task=>task.id===id),active:isActive,generation:()=>sessionGeneration,changed:publish});
  const decisionLog = createDecisionLogState({initial:active ? initialDecisionLogResult : undefined,active:isActive,generation:()=>sessionGeneration,changed:publish,read:adapter.readDecisionLog});
  const planning: PlanningState = {
    candidates: candidateReads.candidates,
    candidate: candidateReads.candidate,
    loadCandidates: candidateReads.loadCandidates,
    planningInteraction() { isActive(); return planningInteraction; },
    rememberPlanningInteraction(patch) {
      if (!isActive()) return;
      const changedSelection = "selectedTaskId" in patch && patch.selectedTaskId !== planningInteraction.selectedTaskId;
      planningInteraction = { ...planningInteraction, ...patch };
      if (changedSelection) publish();
    },
    beginBoardInteraction() {
      const interaction = Symbol("board-interaction");
      boardInteractions.add(interaction);
      return () => {
        boardInteractions.delete(interaction);
        if (!boardInteractions.size) releaseHeldReads();
      };
    },
    activatePlanningView() {
      const consumer = Symbol("planning-view");
      planningConsumers.add(consumer);
      return () => {
        planningConsumers.delete(consumer);
        if (!planningConsumers.size) {
          clearAutomaticRefresh(); discardQueuedQuery();
          sourceTransport?.abort();
          sourceObservation = undefined;
          if (sourceStatus === "checking") sourceStatus = "unverified";
          if (heldReads.size || [...readTransports.values()].some(read => read.workspace === "planning")) {
            acceptedRead.set("planning", ++sequence);
            releaseHeldReads();
            cancelPlanningReads();
            if (workspaceStatuses.get("planning") === "loading") workspaceStatuses.set("planning", "stale");
          }
        }
      };
    },
    decisionLog: decisionLog.view,
    loadDecisionLog: decisionLog.load,
    checkPlanningSource() {
      if (!isActive()) return Promise.resolve("session-ended");
      const status = workspaceStatuses.get("planning");
      const workspaceRead = workspaceReads.get("planning");
      const pendingContent = workspaceRead?.generation === sessionGeneration && workspaceRead.sessionRevision === sessionRevision
        && workspaceRead.sourceEpoch === planningSourceEpoch && workspaceRead.started === acceptedRead.get("planning") ? workspaceRead.result
        : boardRead && boardRead.sequence === acceptedRead.get("planning") && boardRead.sourceEpoch === planningSourceEpoch ? boardRead.result : undefined;
      if (pendingContent) return pendingContent.then(accepted => accepted ? "content-read" as const : "unverified" as const);
      if (status === "forbidden") return Promise.resolve("session-ended");
      if (!memberships.has("planning") || completeness.get("planning") === "none" || status === "stale" || status === "not-loaded" || status === "unavailable") {
        return planning.refreshWorkspace("planning").then(accepted => accepted ? "content-read" as const : "unverified" as const);
      }
      if (!planningWeekIsCurrent(boardQuery, weekBasis, adapter.now?.() ?? Date.now())) {
        invalidatePlanningSource();
        return planning.refreshWorkspace("planning").then(accepted => accepted ? "content-read" as const : "unverified" as const);
      }
      if (sourceObservation) return sourceObservation;
      const generation = sessionGeneration, revision = sessionRevision, epoch = planningSourceEpoch, source = scopeRevision;
      const controller = new AbortController();
      sourceTransport = controller;
      sourceStatus = "checking";
      const current = () => !controller.signal.aborted && isActive() && memberships.has("planning") && generation === sessionGeneration && revision === sessionRevision && epoch === planningSourceEpoch && source === scopeRevision;
      const observed = (async (): Promise<import("../planning-state").PlanningSourceObservation> => {
        try {
          if (!adapter.readPlanningSourceVersion || !source) { sourceStatus = "unverified"; return "unverified"; }
          const remote = await adapter.readPlanningSourceVersion({ signal: controller.signal });
          if (!current()) return "session-ended";
          if (remote !== source) { invalidatePlanningSource(); sourceStatus = "changed"; return "changed"; }
          sourceStatus = "current";
          return "unchanged";
        } catch (error) {
          if (!isActive() || generation !== sessionGeneration || revision !== sessionRevision) return "session-ended";
          if (readErrorStatus(error) === "forbidden") denyPlanningScope();
          else if (!current()) return "session-ended";
          sourceStatus = "unverified";
          return "unverified";
        } finally { publish(); }
      })();
      sourceObservation = observed;
      void observed.finally(() => { if (sourceObservation === observed) sourceObservation = undefined; });
      return observed;
    },
    currentProfile() { if (!isActive()) return null; const row = confirmed.profiles.find(profile => profile.id === actorIdentity?.id && canPresentProfile(profile.id)); return row ? { id: row.id, name: row.name, platformRole: row.platformRole, githubLogin: row.githubLogin } : actorIdentity; },
    hierarchy: () => planning.workspace("projects"),
    hierarchyEdits: hierarchy.views,
    checkHierarchyEdit: hierarchy.check,
    beginEpicEdit: hierarchy.beginEpic,
    beginInitiativeEdit: hierarchy.beginInitiative,
    deleteEmptyEpic: task => lifecycle.removeTask(task,"delete_epic",""),
    decideInitiativeApproval: (task,action,note="") => action === "reject" ? lifecycle.removeTask(task,"reject",note).then(result=>result.ok?{ok:true as const,task:{id:task.id}}:result) : taskReviews.publicState.decideTaskApproval(task,action,note),
    syncTaskToGitHub:githubSync.sync,
    syncGitHubTasks:githubSync.syncBatch,
    taskGitHubSync:githubSync.view,
    taskGitHubSyncs:githubSync.views,
    githubSyncBatch:githubSync.batch,
    githubSyncNotice:githubSync.notice,
    checkTaskGitHubSync:githubSync.check,
    githubConnection:githubConnection.view,
    loadGitHubConnection:githubConnection.load,
    runAdministrationDelivery: administration.delivery.run,
    administrationDeliveries: administration.delivery.views,
    checkAdministrationDelivery: administration.delivery.check,
    administrationDeliveryAvailability: administration.delivery.availability,
    beginMeetingAttendance: attendanceState.begin,
    meetingAttendance: attendanceState.pair,
    meetingAttendanceEdits: attendanceState.views,
    resumeMeetingAttendance: attendanceState.resume,
    ...taskReviews.publicState,
    taskReviewOperations: taskReviews.views,
    checkTaskReview: taskReviews.check,
    beginAdministrationProjectEdit: administration.beginProject,
    administrationProjectEdits: administration.projectViews,
    resumeAdministrationProjectEdit: administration.resumeProject,
    administration: administration.view,
    loadAdministration: administration.load,
    beginAdministrationPersonEdit: administration.begin,
    administrationPersonEdits: administration.views,
    resumeAdministrationPersonEdit: administration.resume,
    addTaskRelationship: relationshipChanges.add,
    removeTaskRelationship: relationshipChanges.remove,
    taskRelationships: id => relationshipChanges.view(id, visible),
    taskRelationshipChanges: relationshipChanges.views,
    checkTaskRelationshipChange: relationshipChanges.check,
    uploadTaskAttachment: attachmentUploads.upload,
    taskAttachmentUploads: attachmentUploads.views,
    checkTaskAttachmentUpload: attachmentUploads.check,
    importTaskGitHubComments: githubImports.importComments,
    taskGitHubImport: githubImports.view,
    taskGitHubComments: taskId => githubImports.comments(taskId, visible),
    checkTaskGitHubImport: githubImports.check,
    taskCommentDraft(taskId) {
      const generation = sessionGeneration;
      const canWrite = () => isActive() && generation === sessionGeneration && !deniedTaskReads.has(taskId) && confirmed.tasks.some(task => task.id === taskId && !lifecycle.isRemoved(task));
      const captured = canWrite() ? commentDrafts.get(taskId) : undefined;
      return {
        text: captured?.text || "",
        update(value) {
          if (!canWrite()) return;
          const current = commentDrafts.get(taskId)?.text || "";
          commentDrafts.set(taskId, { text: typeof value === "function" ? value(current) : value });
          publish();
        },
        clear() {
          if (!canWrite() || commentDrafts.get(taskId) !== captured) return;
          commentDrafts.delete(taskId);
          publish();
        },
      };
    },
    createTaskComment: commentCreations.create,
    retryTaskCommentCreation: commentCreations.retry,
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
    loadBacklogSupport,
    loadBacklogSelection,
    backlog: () => { const controls = currentBacklogSupport("controls") as BacklogControls | undefined; const sprintBasis = currentBacklogSupport("sprints") as BacklogSprintBasis | undefined; const selection = currentBacklogSelection(); const view = planning.workspace("backlog"); return { supportReadStatus: { controls: backlogSupportStatuses.get("controls") || "not-loaded", sprints: backlogSupportStatuses.get("sprints") || "not-loaded" }, model: { ...(controls ? { controls } : {}), ...(sprintBasis ? { sprintBasis } : {}), ...(selection ? { selection } : {}), revision: selectedBacklog?.selection.sourceRevision || "", coverage: { ...(view.tasks.some(task => taskEffectsPending(task.id)) || backlogOrdering.pending() || backlogAssignments.pending() || pending.size ? { ...backlogCoverage, items: "partial" as const } : backlogCoverage), ...(commitments.pending() ? { commitments: "partial" as const } : {}), ...(scoreObjections.scoresUnconfirmed()?{scores:"partial" as const}:{} ) }, items: view.tasks, people: view.readStatus === "forbidden" || !isActive() ? [] : visible.profiles, sprints: view.readStatus === "forbidden" || !isActive() ? [] : visible.sprints, commitments: view.readStatus === "forbidden" || !isActive() ? [] : visible.sprintCommitments }, readStatus: view.readStatus }; },

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
    resumeSprintCommitmentEdit: commitments.resume,
    sprintCommitmentEdits: commitments.views,
    scoreObjectionScore:(sprintId,profileId)=>{
      if(!isActive()||sprintState.denied())return {score:null,complete:false};
      const score=confirmed.founderSprintScores.find(row=>row.sprintId===sprintId&&row.profileId===profileId)||null;
      return {score,complete:scoreObjections.scoreCurrent(sprintId,profileId)&&Boolean(score||sprintState.coverage().founderSprintScores==="complete")};
    },
    beginScoreObjectionCreation:scoreObjections.beginCreation,
    resumeScoreObjectionCreation:scoreObjections.resumeCreation,
    resumeScoreObjectionReview:scoreObjections.resume,
    scoreObjectionOperations:scoreObjections.views,
    beginScoreObjectionReview:scoreObjections.begin,
    beginSprintCommitmentEdit: shown => commitments.begin(shown),
    sprintWorkspace: () => {
      isActive();
      const data = sprintState.denied() ? emptyPlanningShellState : visible;
      return { readStatus: workspaceStatuses.get("sprint") || "not-loaded", model: { coverage: { ...sprintViewCoverage(sprintState.coverage()), attendance: attendanceState.coverage(), ...(commitments.pending() ? { commitments: "partial" as const } : {}), ...(scoreObjections.scoresUnconfirmed()?{scores:"partial" as const}:{} ) }, revision: "", project: data.project, people: data.profiles, items: sprintState.denied() ? [] : planning.workspace("sprint").tasks, sprints: data.sprints, commitments: data.sprintCommitments, scores: data.founderSprintScores.filter(row=>scoreObjections.scoreCurrent(row.sprintId,row.profileId)), strikeStates: data.founderStrikeStates, strikeEvents: data.strikeEvents, objections: data.scoreObjections, meetings: data.meetings, attendance: data.meetingAttendance } };
    },
    ...workweekCalendars.publicState,
    ...privateWorkweek.publicState,
    ...googleWorkspace.publicState,
    ...notifications.publicState,
    ...events.publicState,
    ...tools.publicState,
    createTask: input => relationshipChanges.blocksTask(input.parentTaskId)||relationshipChanges.blocksTask(input.relatedTaskId||"") ? Promise.resolve({ok:false,kind:"unconfirmed",error:"Eine betroffene Beziehungsänderung ist noch nicht bestätigt. Die Erstellung wurde nicht gesendet."}) : taskReviews.blocksTask(input.parentTaskId)||taskReviews.blocksTask(input.relatedTaskId||"") ? Promise.resolve({ok:false,kind:"unconfirmed",error:"Die Freigabe einer betroffenen Aufgabe ist noch nicht bestätigt. Die Erstellung wurde nicht gesendet."}) : (backlogOrdering.pending() && input.taskType === "deliverable") || backlogOrdering.blocksTask(input.relatedTaskId || input.parentTaskId) ? Promise.resolve({ ok: false, kind: "unconfirmed", error: "Eine betroffene Rangänderung ist noch nicht bestätigt. Die Aufgabe wurde noch nicht erstellt." }) : lifecycle.createTask(input),
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
    board: () => {
      isActive();
      const tasks = planning.workspace("planning").tasks;
      const byId = new Map(tasks.map(task => [task.id, task]));
      const selectedIds = tableResult?.rowIds || boardResult?.cardIds;
      const boardTasks = selectedIds ? [...selectedIds.flatMap(id => byId.get(id) ? [byId.get(id)!] : []), ...tasks.filter(task => lifecycle.isTemporary(task.id))] : tasks;
      return { query: active ? displayedQuery : undefined, sourceStatus, requiresQueryRead: Boolean(boardQuery && !boardQueryKey), deniedChildListIds: [...childLists].filter(([id, list]) => list.readStatus === "forbidden" || (deniedTaskReads.has(id) && list.readStatus === "loading")).map(([id]) => id), tasks: boardTasks, freshness, scopeRevision: active ? scopeRevision : undefined, result: active ? boardResult : undefined, table: active ? tableResult : undefined, queryKey: active ? boardQueryKey : undefined, pageStatus: tableResult ? pageStatus : columnReadStatus.Erledigt || pageStatus, columnReadStatus: { ...columnReadStatus }, readStatus: workspaceStatuses.get("planning") || "not-loaded" };
    },
    scheduleBoardQuery(query, options) {
      if (!isActive()) return Promise.resolve(false);
      if (!options?.immediate && workspaceStatuses.get("planning") === "forbidden") return Promise.resolve(false);
      const normalized = normalizePlanningBoardQuery(query);
      const signature = JSON.stringify(normalized);
      if (!options?.immediate && queuedQuery && JSON.stringify(queuedQuery.query) === signature) return queuedQuery.result;
      if (!options?.immediate && failedQueryDemand?.query === signature && failedQueryDemand.generation === sessionGeneration && failedQueryDemand.sourceEpoch === planningSourceEpoch) return Promise.resolve(false);
      failedQueryDemand = undefined;
      discardQueuedQuery();
      if ((boardRead || workspaceReads.has("planning") || columnReads.size || summaryReads.size || heldReads.size) && (!boardQuery || planningBoardQueryKey(boardQuery) !== planningBoardQueryKey(normalized))) {
        acceptedRead.set("planning", ++sequence);
        releaseHeldReads();
        cancelPlanningReads();
      }
      const generation = sessionGeneration, sourceEpoch = planningSourceEpoch;
      const rememberFailure = (result: Promise<boolean>) => {
        void result.then(accepted => {
          if (!accepted && generation === sessionGeneration && sourceEpoch === planningSourceEpoch && JSON.stringify(boardQuery) === signature && ["unavailable", "forbidden"].includes(workspaceStatuses.get("planning") || "")) failedQueryDemand = { query: signature, generation, sourceEpoch };
        });
        return result;
      };
      if (options?.immediate || (JSON.stringify(boardQuery) === signature && (boardRead || workspaceReads.has("planning")))) return rememberFailure(planning.ensureBoardQuery(normalized));
      const delay = normalized.filters.query !== (boardQuery?.filters.query || "") ? 250 : 0;
      let resolve!: (accepted: boolean) => void;
      const result = new Promise<boolean>(done => { resolve = done; });
      const timer = setTimeout(() => {
        queuedQuery = undefined;
        void planning.ensureBoardQuery(normalized).then(resolve);
      }, delay);
      queuedQuery = { query: normalized, result, resolve, timer };
      return rememberFailure(result);
    },
    ensureBoardQuery(query) {
      discardQueuedQuery();
      if (!isActive()) return Promise.resolve(false);
      if (!planningWeekIsCurrent(boardQuery, weekBasis, adapter.now?.() ?? Date.now())) invalidatePlanningSource();
      const key = planningBoardQueryKey(query);
      if (boardRead?.key === key && boardRead.sequence === acceptedRead.get("planning") && boardRead.sourceEpoch === planningSourceEpoch) return boardRead.result;
      const workspaceRead = workspaceReads.get("planning");
      if (workspaceRead && workspaceRead.generation === sessionGeneration && workspaceRead.sessionRevision === sessionRevision && workspaceRead.sourceEpoch === planningSourceEpoch && workspaceRead.started === acceptedRead.get("planning") && boardQuery && planningBoardQueryKey(boardQuery) === key) return workspaceRead.result;
      if (boardQueryKey === key && workspaceStatuses.get("planning") === "current") {
        const normalized = normalizePlanningBoardQuery(query);
        if (JSON.stringify(displayedQuery) !== JSON.stringify(normalized)) { displayedQuery = normalized; boardQuery = normalized; publish(); }
        return Promise.resolve(true);
      }
      if (boardQuery && boardQueryKey === planningBoardQueryKey(boardQuery)) rememberPlanningQuery();
      const exact = planningQueries.get(key);
      const complete = planningQueries.get(planningBoardQueryKey({ view: "complete" }));
      const retained = exact || (complete?.completeness === "complete" ? complete : undefined);
      if (retained && retained.revision === queryRevision && retained.sourceEpoch === planningSourceEpoch && workspaceStatuses.get("planning") !== "forbidden"
        && (!retained.readAuthority || retained.readAuthority.deadline > (adapter.now?.() ?? Date.now()))
        && planningWeekIsCurrent(retained.query, retained.weekBasis, adapter.now?.() ?? Date.now())) {
        acceptedRead.set("planning", ++sequence);
        boardQuery = exact ? retained.query : normalizePlanningBoardQuery(query);
        boardQueryKey = key;
        displayedQuery = normalizePlanningBoardQuery(query);
        boardResult = retained.result;
        tableResult = retained.table;
        tableRead = undefined; tableRequest = undefined;
        weekBasis = retained.weekBasis;
        planningAuthority = retained.readAuthority;
        pageStatus = retained.pageStatus === "loading" ? "stale" : retained.pageStatus;
        cancelPlanningReads();
        summaryReads.clear(); summarySequences.clear();
        columnReads.clear(); columnRequests.clear();
        for (const column of Object.keys(columnReadStatus) as TaskStatus[]) delete columnReadStatus[column];
        for (const [column, status] of Object.entries(retained.columnReadStatus)) columnReadStatus[column as TaskStatus] = status === "loading" ? "stale" : status;
        memberships.set("planning", new Set(retained.taskIds));
        completeness.set("planning", retained.completeness);
        workspaceStatuses.set("planning", "current");
        publish();
        if (tableResult) queueMicrotask(loadPendingTableRisks);
        return Promise.resolve(true);
      }
      boardQuery = normalizePlanningBoardQuery(query);
      const result = readWorkspace("planning", boardQuery);
      boardRead = { key, result, sequence: acceptedRead.get("planning")!, sourceEpoch: planningSourceEpoch };
      void result.finally(() => { if (boardRead?.result === result) boardRead = undefined; }).catch(() => undefined);
      return result;
    },
    acceptServerBoardColumn(readId, outcome) { return acceptServerColumn(readId, outcome); },
    loadTablePage() { return readTablePage(false); },
    refreshTablePage() { return readTablePage(true); },
    loadCompletedHistory() { return planning.loadBoardColumn("Erledigt"); },
    loadBoardColumn(status) { return readBoardColumn(status, false); },
    refreshBoardColumn(status) { return readBoardColumn(status, true); },
    acceptServerBoardSummary: (readId, outcome) => acceptServerSummary(readId, outcome),
    refreshTableRisks() {
      if (!isActive() || !tableResult || freshness === "stale") return Promise.resolve(false);
      return Promise.all((tableResult.summaryRequests || []).filter(request => request.status !== "current").map(readTableRisk)).then(results => results.every(Boolean));
    },
    refreshBoardSummaries() {
      if (!isActive() || !boardResult || freshness === "stale") return Promise.resolve(false);
      return Promise.all((boardResult.summaryRequests || []).filter(request => request.status !== "current").map(readBoardSummary)).then(results => results.every(Boolean));
    },
    workspace: workspace => { isActive(); return ({ tasks: workspaceStatuses.get(workspace) === "forbidden" ? [] : visible.tasks.filter(task => memberships.get(workspace)?.has(task.id) || ((workspace === "planning" || workspace === "projects") && lifecycle.isTemporary(task.id))), readStatus: workspaceStatuses.get(workspace) || "not-loaded", completeness: completeness.get(workspace) || "none" }); },
    taskDetail: taskId => { isActive(); const childList = childLists.get(taskId); return ({
      removed: lifecycle.isRemoved({ id: taskId } as Task),
      children: deniedTaskReads.has(taskId) || childList?.readStatus === "forbidden" ? [] : visible.tasks.filter(task => task.parentTaskId === taskId && (childList?.ids.has(task.id) || (childList && (taskConfirmedAt.get(task.id) || 0) > childList.started))),
      childrenReadStatus: childList?.readStatus || "not-loaded",
      childrenCoverage: !childList ? "not-loaded" : childList.readStatus === "unavailable" ? "failed" : childList.readStatus === "current" ? childList.coverage === "complete" ? childList.ids.size ? "complete" : "complete-empty" : "partial" : childList.readStatus,
      childProgress: !deniedTaskReads.has(taskId) && childList?.readStatus === "current" ? childList.progress || null : null,
      scopedRead: scopedDetailIds.has(taskId),
      areaReadStatus: { discussion: detailAreaStatuses.get(taskId+":discussion") || "not-loaded", timeline: detailAreaStatuses.get(taskId+":timeline") || "not-loaded", relationships: detailAreaStatuses.get(taskId+":relationships") || "not-loaded" },
      task: deniedTaskReads.has(taskId) ? null : visible.tasks.find(task => task.id === taskId) || null,
      saveStatus: githubSync.blocksTask(taskId) ? githubSync.view(taskId)?.phase === "syncing" ? "saving" : "unconfirmed" : taskReviews.blocksTask(taskId) ? taskReviews.blockingOperation(taskId)?.phase === "saving" ? "saving" : "unconfirmed" : relationshipChanges.blocksTask(taskId) ? relationshipChanges.pendingViews(taskId).some(view => view.phase === "saving") ? "saving" : "unconfirmed" : attachmentUploads.blocksTask(taskId) ? attachmentUploads.views(taskId).some(view => view.phase === "uploading") ? "saving" : "unconfirmed" : githubImports.blocksTask(taskId) ? githubImports.view(taskId)?.phase === "saving" ? "saving" : "unconfirmed" : blockerReports.saveStatus(taskId) || backlogOrdering.saveStatus(taskId) || backlogAssignments.saveStatus(taskId) || status.get(taskId) || "saved", unavailable: detailUnavailable.get(taskId) || [], readStatus: detailStatuses.get(taskId) || "not-loaded",
      comments: deniedTaskReads.has(taskId) ? [] : visible.taskComments.filter(item => item.taskId === taskId),
      externalComments: deniedTaskReads.has(taskId) ? [] : visible.taskExternalComments.filter(item => item.taskId === taskId),
      blockers: deniedTaskReads.has(taskId) ? [] : visible.taskBlockers.filter(item => item.taskId === taskId),
      relationships: deniedTaskReads.has(taskId) ? [] : visible.taskRelations.filter(item => item.taskId === taskId || item.relatedTaskId === taskId),
      activities: deniedTaskReads.has(taskId) ? [] : visible.taskActivity.filter(item => item.taskId === taskId),
      reviews: deniedTaskReads.has(taskId) ? [] : visible.taskReviews.filter(item => item.taskId === taskId),
    }); },
    protectedCache(workspace) {
      if (!isActive() || (workspace && (!memberships.has(workspace) || workspaceStatuses.get(workspace) === "forbidden"))) return null;
      const data = protectedPublication(profileSettings.protect(githubSync.protect(relationshipChanges.protect(attachmentUploads.protect(githubImports.protect(blockerReports.protect(confirmed)))))));
      return { tasks: data.tasks.filter(task => !deniedTaskReads.has(task.id) && (!workspace || memberships.get(workspace)?.has(task.id))), profiles: data.profiles, sprints: data.sprints, notificationPreferences: data.notificationPreferences, profileUiPreferences: data.profileUiPreferences, profileFeatureTourAcknowledgements: data.profileFeatureTourAcknowledgements };
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    taskSaves: taskId => {
      if (!isActive()) return [];
      const forbidden = deniedTaskReads.has(taskId);
      const imported = githubImports.view(taskId);
      return [...relationshipChanges.pendingViews(taskId).map(view => ({ phase: view.phase === "saving" ? "saving" as const : "unconfirmed" as const, submitted: null, checkStatus: view.checking ? "checking" as const : view.readStatus === "current" ? "checked" as const : "not-checked" as const, serverTask: null })), ...attachmentUploads.views(taskId).filter(view => view.phase === "uploading" || view.phase === "unconfirmed" || view.phase === "uploaded" && view.taskReadStatus !== "current").map(view => ({ phase: view.phase === "uploading" ? "saving" as const : "unconfirmed" as const, submitted: null, checkStatus: view.checking ? "checking" as const : view.taskReadStatus === "current" ? "checked" as const : "not-checked" as const, serverTask: null })), ...(imported && githubImports.blocksTask(taskId) ? [{ phase: imported.phase === "saving" ? "saving" as const : "unconfirmed" as const, submitted: null, checkStatus: imported.checking ? "checking" as const : imported.taskReadStatus === "current" ? "checked" as const : "not-checked" as const, serverTask: null }] : []), ...blockerReports.views(taskId).filter(view => view.phase === "saving" || view.phase === "unconfirmed" || view.phase === "confirmed" && view.taskReadStatus !== "current").map(view => ({ phase: view.phase === "saving" ? "saving" as const : "unconfirmed" as const, submitted: forbidden ? null : { status: "Blockiert" }, checkStatus: view.checking ? "checking" as const : view.taskReadStatus === "current" ? "checked" as const : view.taskReadStatus === "unavailable" ? "unavailable" as const : "not-checked" as const, serverTask: forbidden ? null : view.serverTask })), ...backlogOrdering.views().filter(view => ["saving", "unconfirmed"].includes(view.phase) && backlogOrdering.blocksTask(taskId)).map(view => ({ phase: view.phase as "saving" | "unconfirmed", submitted: forbidden ? null : { order: visible.tasks.find(task => task.id === taskId)?.order }, checkStatus: view.checking ? "checking" as const : "not-checked" as const, serverTask: null })), ...backlogAssignments.views().filter(view => ["saving", "unconfirmed"].includes(view.phase) && view.tasks.some(task => task.id === taskId)).map(view => ({ phase: view.phase as "saving" | "unconfirmed", submitted: forbidden ? null : { sprintId: view.targetSprint?.id || "", scoreRelevant: Boolean(view.targetSprint) }, checkStatus: view.checking ? "checking" as const : "not-checked" as const, serverTask: null })), ...[...pending.values()].filter(operation => operation.taskId === taskId).map(operation => ({
        phase: operation.phase, submitted: forbidden ? null : operation.submitted,
        checkStatus: outcomeCheckStatus.get(taskId) || "not-checked",
        serverTask: forbidden || outcomeCheckStatus.get(taskId) !== "checked" ? null : confirmed.tasks.find(task => task.id === taskId) || null,
      }))];
    },
    checkTaskSave(taskId) {
      if (!isActive()) return Promise.resolve({ outcome: "session-ended", readStatus: "not-needed" });
      if(githubSync.blocksTask(taskId))return githubSync.check(taskId);
      const reviewOperation=taskReviews.blockingOperation(taskId)||taskReviews.views(taskId).find(op=>op.phase==="blocked");
      if(reviewOperation)return taskReviews.check(reviewOperation.id);
      const lockTask=confirmed.tasks.find(task=>task.id===taskId);
      if(lockTask&&sprintLock.blocksTask(lockTask)) return (async():Promise<import("../planning-state").PlanningTaskSaveCheck>=>{
        const checked=await sprintLock.check();
        if(!isActive())return{outcome:"session-ended",readStatus:"not-needed"};
        const current=confirmed.tasks.find(task=>task.id===taskId);
        if(checked.outcome==="not-pending"&&current&&sprintLock.blocksTask(current)&&adapter.readTaskDetail)await planning.loadTaskDetail(taskId);
        const after=confirmed.tasks.find(task=>task.id===taskId);
        return after&&sprintLock.blocksTask(after)?{outcome:"unconfirmed",readStatus:checked.readStatus}:checked;
      })();
      if (relationshipChanges.blocksTask(taskId)) return relationshipChanges.checkTask(taskId);
      if (attachmentUploads.blocksTask(taskId)) return attachmentUploads.checkTask(taskId);
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
    loadTaskDetail(taskId, options) {
      if (options?.signal?.aborted || !isActive() || !adapter.readTaskDetail) return Promise.resolve({ ok: false });
      const area = options?.area;
      const key = area ? taskId+":"+area : taskId;
      const acceptedChildren = childLists.get(taskId);
      if (area === "children" && !options?.refresh && acceptedChildren?.readStatus === "current" && acceptedChildren.coverage === "complete" && detailReceipts.has(key)) return Promise.resolve({ ok: true });
      const includesDiscussion = !area || area === "discussion";
      const includesTimeline = !area || area === "timeline";
      const includesRelationships = !area;
      const includesChildren = !area || area === "children";
      const existing = detailReads.get(key);
      if (existing) return area ? retainDetailRead(key, taskId, area, existing, options?.signal) : existing;
      const demand = area ? { controller: new AbortController(), consumers: new Set<symbol>(), settled: false, previous: (area === "target" ? detailStatuses.get(taskId) : area === "children" ? childLists.get(taskId)?.readStatus : detailAreaStatuses.get(key)) || "not-loaded" as PlanningReadStatus } : undefined;
      if (demand) detailDemands.set(key, demand);
      const readTaskDetail = adapter.readTaskDetail;
      if (!area || area === "target") detailStatuses.set(taskId, "loading");
      if (area && area !== "target") detailAreaStatuses.set(key, "loading");
      if (includesChildren) childLists.set(taskId, { ...childLists.get(taskId), ids: childLists.get(taskId)?.ids || new Set(visible.tasks.filter(task => task.parentTaskId === taskId).map(task => task.id)), started: childLists.get(taskId)?.started || 0, readStatus: "loading" });
      if (includesRelationships) detailAreaStatuses.set(taskId+":relationships", "loading");
      if (includesDiscussion) commentCreations.beginRead(taskId);
      publish();
      const loaded = (async () => {
        const generation = sessionGeneration;
        const sourceEpoch = planningSourceEpoch;
        const binding: DetailReadBinding = { generation, sourceEpoch, sessionRevision, userId,
          actor: actorIdentity ? { profileId: actorIdentity.id, platformRole: actorIdentity.platformRole } : undefined };
        const started = ++sequence;
        let result: Awaited<ReturnType<typeof readTaskDetail>>;
        try {
          result = await readTaskDetail(taskId, area ? { area, signal: demand!.controller.signal } : options);
          if (demand?.controller.signal.aborted) return { ok: false };
          if (area && (result.model.readArea !== area || !validDetailReceipt(result.model, result.readAuthority, actorIdentity))) {
            throw Object.assign(new Error("Die ursprüngliche Detailberechtigung ist nicht mehr gültig."), { status: 403 });
          }
          if (result.model.item.id !== taskId) throw new Error("Die Detailantwort gehört zu einer anderen Aufgabe.");
        } catch (error) {
          if (demand?.controller.signal.aborted || !isActive() || generation !== sessionGeneration) return { ok: false };
          const failedStatus = readErrorStatus(error);
          if (includesDiscussion) { commentCreations.failed(taskId, failedStatus); githubImports.failed(taskId, failedStatus); }
          if (failedStatus === "forbidden") {
            candidateReads.deny();
            deniedTaskReads.add(taskId);
            const deniedAt = ++sequence;
            taskDeniedAt.set(taskId, deniedAt);
            for (const id of childLists.get(taskId)?.ids || []) { deniedTaskReads.add(id); taskDeniedAt.set(id, deniedAt); }
            detachPlanningMetadata();
            if (workspaceStatuses.get("planning") !== "forbidden") workspaceStatuses.set("planning", "stale");
            taskReviews.deny(taskId); githubSync.deny(taskId); blockerReports.denied(taskId); attachmentUploads.failed(taskId); relationshipChanges.denied(taskId);
          }
          if (!area || area === "target" || failedStatus === "forbidden") detailStatuses.set(taskId, failedStatus);
          if (area && area !== "target") detailAreaStatuses.set(key, failedStatus);
          if (includesRelationships) detailAreaStatuses.set(taskId+":relationships", failedStatus);
          if (includesChildren) childLists.set(taskId, { ...childLists.get(taskId)!, readStatus: failedStatus });
          publish();
          return { ok: false, error: error instanceof Error ? error.message : "Aufgabendetails konnten nicht geladen werden." };
        }
        if (demand?.controller.signal.aborted || !isActive() || generation !== sessionGeneration) return { ok: false };
        if (area === "children" && sourceEpoch !== planningSourceEpoch) {
          const list = childLists.get(taskId);
          if (list) childLists.set(taskId, { ...list, readStatus: "stale" });
          publish();
          return { ok: false };
        }
        if ((taskDeniedAt.get(taskId) || 0) > started) return { ok: false };
        if (area) { scopedDetailIds.add(taskId); rememberDetailReceipt(taskId, area, result.model, result.readAuthority!, started, binding); }
        const returnedTasks = [result.model.item, ...result.model.ancestors, ...result.model.children, ...result.model.relatedItems];
        // A changed known record disproves retained aggregate freshness. New detail coverage alone does not.
        if (returnedTasks.some(task => {
          const previous = confirmed.tasks.find(row => row.id === task.id);
          return previous && previous.updatedAt !== task.updatedAt && (taskConfirmedAt.get(task.id) || 0) <= started && (taskReadAt.get(task.id) || 0) <= started;
        })) invalidatePlanningSource();
        const detailProjection = applyTaskDetailModel(confirmed, result.model, result.unavailable, result.model.coverage || {});
        const profileRead = result.model.supportingData === "omitted" ? { data: detailProjection, stale: false } : profileSettings.acceptRead(detailProjection, { profiles: "partial" }, started, "planning", { ...detailProjection, profiles: [...result.model.people] }, ["notificationsEnabled", "googleChatUserId", "googleChatDmSpace"]);
        const sprintRead = result.model.supportingData === "omitted" ? { data: profileRead.data, stale: false } : sprintState.acceptRead(profileRead.data, { sprints: "partial" }, started, { ...detailProjection, sprints: [...result.model.sprints] });
        const next = sprintRead.data;
        if (includesRelationships && !result.unavailable?.includes("relationships")) lifecycle.acceptRelationshipRead(next, started, result.model.coverage?.relationships === "complete", taskId);
        deniedTaskReads.delete(taskId);
        if (result.model.supportingData !== "omitted") acceptProfileScope(`task:${taskId}`, result.model.people);
        detailUnavailable.set(taskId, area ? [...(detailUnavailable.get(taskId) || []).filter(value => value !== area), ...(result.unavailable || [])] : result.unavailable || []);
        if (!area || area === "target") detailStatuses.set(taskId, result.unavailable?.length ? "unavailable" : "current");
        for (const scope of ["discussion", "timeline", "relationships"] as const) if (!area || area === scope) detailAreaStatuses.set(taskId+":"+scope, result.unavailable?.includes(scope) ? "unavailable" : "current");
        const previousTasksById = new Map<string, Task>();
        // Preserve the previous first-match selection even for duplicate IDs.
        for (const task of confirmed.tasks) if (!previousTasksById.has(task.id)) previousTasksById.set(task.id, task);
        const protectedIds = new Set(confirmed.tasks.filter(task => (taskConfirmedAt.get(task.id) || 0) > started || (taskReadAt.get(task.id) || 0) > started || (taskDeniedAt.get(task.id) || 0) > started).map(task => task.id));
        const compatibleContext = new Map<string, readonly (keyof Task)[]>();
        const receipt = area ? detailReceipts.get(key) : undefined;
        const peer = area === "target" ? detailReceipts.get(taskId+":children") : area === "children" ? detailReceipts.get(taskId+":target") : undefined;
        const now = adapter.now?.() ?? Date.now();
        const currentBinding = (read: DetailReceipt) => Boolean(actorIdentity && sessionRevision
          && read.generation === sessionGeneration && read.sourceEpoch === planningSourceEpoch
          && read.sessionRevision === sessionRevision && read.userId === userId
          && read.actor?.profileId === actorIdentity.id && read.actor.platformRole === actorIdentity.platformRole
          && read.deadline > now && (read.validUntil === null || Date.parse(read.validUntil) > now));
        // Only shared context from the same two area scopes may cooperate.
        // Actual child rows, commands, denials and unrelated reads stay protected.
        if (receipt && peer && peer.taskId === taskId && peer.started > started
          && currentBinding(receipt) && currentBinding(peer)
          && receipt.sourceRevision.length > 0 && receipt.sourceRevision === peer.sourceRevision) {
          for (const task of [result.model.item, ...result.model.ancestors]) {
            const previous = previousTasksById.get(task.id);
            if (!protectedIds.has(task.id) || !previous || !receipt.contextIds.includes(task.id) || !peer.contextIds.includes(task.id)
              || taskReadAt.get(task.id) !== peer.started || (taskConfirmedAt.get(task.id) || 0) > started || (taskDeniedAt.get(task.id) || 0) > started
              || typeof task.updatedAt !== "string" || !task.updatedAt.length || task.updatedAt !== previous.updatedAt) continue;
            if (area === "children") compatibleContext.set(task.id, []);
            else if (previous.detailAvailability === "summary") {
              const unknown = retainedTaskFields.get(task.id);
              const fields = peer.omittedFields.filter(field => !receipt.omittedFields.includes(field)
                && (unknown?.has(field) || previous[field] === undefined));
              if (fields.length) compatibleContext.set(task.id, fields);
            }
          }
        }
        const unresolvedIds = new Set(next.tasks.filter(task => !confirmed.tasks.some(current => current.id === task.id) && Math.max(taskConfirmedAt.get(task.id) || 0, taskDeniedAt.get(task.id) || 0) > started).map(task => task.id));
        const omittedFields = result.model.taskOmittedFields || [];
        const returnedIds = new Set(returnedTasks.map(task => task.id));
        const supportingNames = ["assignee", "owner", "createdBy"] as const;
        const supportingNamesUnknown = (id: string) => result.model.supportingData === "omitted"
          && detailReceipts.get(id+":target")?.sourceRevision !== result.model.sourceRevision;
        for (const task of returnedTasks) if (!protectedIds.has(task.id) && !unresolvedIds.has(task.id)) {
          acceptTaskFieldCoverage(task, omittedFields);
          if (supportingNamesUnknown(task.id)) {
            const retained = new Set(retainedTaskFields.get(task.id));
            supportingNames.forEach(field => retained.add(field));
            retainedTaskFields.set(task.id, retained);
          }
        }
        for (const [id, fields] of compatibleContext) if (fields.length) {
          const retained = new Set(retainedTaskFields.get(id));
          fields.forEach(field => retained.delete(field));
          if (retained.size) retainedTaskFields.set(id, retained); else retainedTaskFields.delete(id);
        }
        const acceptedDetailTask = (task: Task) => {
          const previous = previousTasksById.get(task.id);
          if (protectedIds.has(task.id)) {
            const fields = compatibleContext.get(task.id);
            if (!fields?.length) return previous!;
            const merged = { ...previous! };
            fields.forEach(field => Object.assign(merged, { [field]: task[field] }));
            merged.detailAvailability = task.detailAvailability;
            return merged;
          }
          if (!previous || !returnedIds.has(task.id) || !omittedFields.length) return task;
          const merged = { ...previous, ...task };
          for (const field of omittedFields) Object.assign(merged, { [field]: previous[field] });
          if (previous.detailAvailability !== "summary") {
            merged.detailAvailability = previous.updatedAt === task.updatedAt && !supportingNamesUnknown(task.id) ? previous.detailAvailability : "stale";
            if (merged.detailAvailability === "stale") detailStatuses.set(task.id, "stale");
          }
          return merged;
        };
        confirmed = {
          ...next,
          tasks: next.tasks.filter(task => !unresolvedIds.has(task.id)).map(acceptedDetailTask),
          ...((taskConfirmedAt.get(taskId) || 0) > started ? { taskActivity: confirmed.taskActivity, taskReviews: confirmed.taskReviews } : {}),
        };
        if (includesDiscussion) {
          if (result.unavailable?.includes("discussion")) commentCreations.failed(taskId, "unavailable");
          else commentCreations.acceptRead(result.model.discussion.comments, started, result.model.coverage?.discussion === "complete", taskId);
          commentCreations.restore();
          if (result.unavailable?.includes("discussion")) githubImports.failed(taskId, "unavailable");
          else githubImports.acceptRead(result.model.discussion.externalComments, started, result.model.coverage?.discussion === "complete", taskId);
        }
        if (includesTimeline && !result.unavailable?.includes("timeline")) attachmentUploads.acceptRead(result.model.activity, started, result.model.coverage?.timeline === "complete", taskId);
        if (includesRelationships && !result.unavailable?.includes("relationships")) relationshipChanges.acceptRead(result.model.relationships, started, result.model.coverage?.relationships === "complete", taskId);
        relationshipChanges.acceptTaskRead(taskId, started, !protectedIds.has(taskId) && !unresolvedIds.has(taskId), result.model.item.updatedAt);
        attachmentUploads.acceptTaskRead(taskId, started, !protectedIds.has(taskId) && !unresolvedIds.has(taskId), result.model.item.updatedAt);
        githubSync.acceptTaskRead(taskId,started,!protectedIds.has(taskId)&&!unresolvedIds.has(taskId),result.model.item.updatedAt);
        githubImports.acceptTaskRead(taskId, started, !protectedIds.has(taskId) && !unresolvedIds.has(taskId), result.model.item.updatedAt);
        if (includesRelationships) blockerReports.acceptDetailRead(result.model, started, !protectedIds.has(taskId) && !unresolvedIds.has(taskId), !result.unavailable?.includes("relationships"));
        if (includesChildren) {
          const validStatuses = result.model.children.every(child => typeof child.status === "string" && Boolean(child.status.trim()));
          childLists.set(taskId, { ids: new Set(result.model.children.map(child => child.id)), started, readStatus: "current",
            coverage: validStatuses ? result.model.coverage?.children || (!area ? "complete" : "partial") : "partial",
            progress: validStatuses ? result.model.childProgress || (!area ? taskChildProgress(result.model.children) : undefined) : undefined });
        }
        for (const task of returnedTasks) if (!lifecycle.isRemoved(task) && (taskDeniedAt.get(task.id) || 0) <= started) deniedTaskReads.delete(task.id);
        for (const task of returnedTasks) {
          if (!protectedIds.has(task.id) && !unresolvedIds.has(task.id)) taskReadAt.set(task.id, started);
        }
        if (profileRead.stale || sprintRead.stale || unresolvedIds.size || returnedTasks.some(task => protectedIds.has(task.id) && !compatibleContext.has(task.id))) {
          freshness = "stale";
          if (!result.unavailable?.length) detailStatuses.set(taskId, "stale");
          if (includesChildren) childLists.set(taskId, { ...childLists.get(taskId)!, readStatus: "stale" });
        }
        if (demand) demand.settled = true;
        publish();
        return { ok: true, unavailable: result.unavailable };
      })();
      detailReads.set(key, loaded);
      void loaded.finally(() => {
        if (demand) demand.settled = true;
        if (detailReads.get(key) === loaded) detailReads.delete(key);
        if (detailDemands.get(key) === demand) detailDemands.delete(key);
      }).catch(() => undefined);
      return area ? retainDetailRead(key, taskId, area, loaded, options?.signal) : loaded;
    },
    prepareWorkspaceHydration(workspace) {
      if (isActive() && sessionRevision && (workspace === "planning" || workspace === "projects")) hydrationRequests.set(workspace, beginWorkspaceRead(workspace));
    },
    refreshWorkspace(workspace) {
      if (!isActive()) return Promise.resolve(false);
      if (workspace === "planning") clearAutomaticRefresh();
      if (workspace === "planning" && queuedQuery) return planning.ensureBoardQuery(queuedQuery.query);
      if (workspace === "planning" && boardRead && boardRead.sequence === acceptedRead.get("planning") && boardRead.sourceEpoch === planningSourceEpoch) return boardRead.result;
      const existing = workspaceReads.get(workspace);
      if (existing && existing.generation === sessionGeneration && existing.sessionRevision === sessionRevision && (workspace === "planning" ? existing.sourceEpoch === planningSourceEpoch : existing.started === sequence) && existing.started === acceptedRead.get(workspace)) return existing.result;
      if (workspace === "planning") planningQueries.clear();
      const result = readWorkspace(workspace, workspace === "planning" ? boardQuery : undefined);
      workspaceReads.set(workspace, { result, generation: sessionGeneration, started: acceptedRead.get(workspace) || 0, sourceEpoch: planningSourceEpoch, sessionRevision });
      void result.finally(() => { if (workspaceReads.get(workspace)?.result === result) workspaceReads.delete(workspace); }).catch(() => undefined);
      return result;
    },
  };
  function readTablePage(refresh: boolean) {
    if (!isActive() || !tableResult || boardQuery?.view !== "table") return Promise.resolve(false);
    if (!planningWeekIsCurrent(boardQuery, weekBasis, adapter.now?.() ?? Date.now())) {
      invalidatePlanningSource();
      return planning.refreshWorkspace("planning");
    }
    if (refresh) return planning.refreshWorkspace("planning");
    const continuation = tableResult.page.continuation;
    if (!continuation) return Promise.resolve(true);
    const key = JSON.stringify([tableResult.queryKey, tableResult.revision, continuation]);
    if (tableRead?.key === key) return tableRead.result;
    const result = readWorkspace("planning", { ...boardQuery, continuation }, true);
    tableRead = { key, result };
    void result.finally(() => { if (tableRead?.result === result) tableRead = undefined; }).catch(() => undefined);
    return result;
  }
  function readBoardColumn(column: TaskStatus, refresh: boolean) {
    if (!isActive() || !boardResult || !boardQuery) return Promise.resolve(false);
    if (!planningWeekIsCurrent(boardQuery, weekBasis, adapter.now?.() ?? Date.now())) {
      invalidatePlanningSource();
      return planning.refreshWorkspace("planning");
    }
    refresh ||= boardResult.columns[column]?.availability === "not-loaded" || (columnReadStatus[column] === "stale" || columnReadStatus[column] === "unavailable") && !boardResult.columns[column]?.continuation;
    const continuation = refresh ? undefined : boardResult.columns[column]?.continuation || undefined;
    if (!refresh && !continuation) return Promise.resolve(true);
    const key = JSON.stringify([boardResult.queryKey, boardResult.revision, continuation, refresh]);
    const existing = columnReads.get(column);
    if (existing?.key === key) return existing.result;
    const result = readWorkspace("planning", { ...boardQuery, column, continuation }, true);
    columnReads.set(column, { key, result });
    void result.finally(() => { if (columnReads.get(column)?.result === result) columnReads.delete(column); }).catch(() => undefined);
    return result;
  }
  function acceptBacklogSource(revision: string, token: ReturnType<typeof beginWorkspaceRead>, deadline: number) {
    if (!actorIdentity) return false;
    const previous = backlogSourceReceipt;
    const compatible = previous && previous.generation === token.generation && previous.session === token.sessionRevision
      && previous.epoch === token.sourceEpoch && previous.actorId === actorIdentity.id && previous.actorRole === actorIdentity.platformRole
      && previous.deadline > (adapter.now?.() ?? Date.now());
    if (compatible && previous.revision !== revision) {
      if (previous.started > token.started) return false;
      if (selectedBacklog && selectedBacklog.selection.sourceRevision !== revision) {
        selectedBacklog = undefined;
        if (workspaceStatuses.get("backlog") !== "forbidden") workspaceStatuses.set("backlog", "stale");
      }
      for (const [area, entry] of backlogSupport) if (entry.value.sourceRevision !== revision) backlogSupportStatuses.set(area, "stale");
    }
    if (!compatible || previous.started <= token.started) backlogSourceReceipt = { revision, started: token.started,
      generation: token.generation, session: token.sessionRevision, epoch: token.sourceEpoch,
      actorId: actorIdentity.id, actorRole: actorIdentity.platformRole, deadline };
    return true;
  }
  function currentBacklogSupport(area: BacklogSupportQuery["area"]) {
    const entry = backlogSupport.get(area);
    if (!entry) return undefined;
    if (!isActive() || entry.generation !== sessionGeneration || entry.session !== sessionRevision || entry.epoch !== planningSourceEpoch
      || !actorIdentity || entry.actorId !== actorIdentity.id || entry.actorRole !== actorIdentity.platformRole || entry.deadline <= (adapter.now?.() ?? Date.now())
      || backlogSupportStatuses.get(area) !== "current") {
      if (backlogSupportStatuses.get(area) === "current") backlogSupportStatuses.set(area, "stale");
      return undefined;
    }
    return entry.value;
  }
  function loadBacklogSupport(input: BacklogSupportQuery, options: { signal?: AbortSignal } = {}): Promise<boolean> {
    const query = normalizeBacklogSupport(input);
    if (!query || !isActive() || !sessionRevision || !actorIdentity || !adapter.readBacklogSupport || options.signal?.aborted) return Promise.resolve(false);
    const current = currentBacklogSupport(query.area);
    if (current && (query.area === "controls" || "day" in current && current.day === query.day)) return Promise.resolve(true);
    const key = JSON.stringify(query);
    let pending = backlogSupportReads.get(query.area);
    if (!pending || pending.key !== key || pending.controller.signal.aborted) {
      pending?.controller.abort();
      const token = beginWorkspaceRead("backlog", undefined, query.area), controller = new AbortController();
      const actor = { id: actorIdentity.id, role: actorIdentity.platformRole };
      const bindingCurrent = () => readIsCurrent("backlog", token) && actorIdentity?.id === actor.id && actorIdentity.platformRole === actor.role && !controller.signal.aborted;
      backlogSupportStatuses.set(query.area, "loading");
      const dispatched = adapter.readBacklogSupport(query, { signal: controller.signal });
      let onAbort!: () => void;
      const aborted = new Promise<null>(resolve => { onAbort = () => resolve(null); controller.signal.addEventListener("abort", onAbort, { once: true }); });
      const result = Promise.race([dispatched, aborted]).then(read => {
        if (!bindingCurrent()) return false;
        const value = query.area === "controls" ? read?.backlogControls : read?.backlogSprintBasis;
        const now = adapter.now?.() ?? Date.now();
        if (!read || !value || value.coverage !== "complete" || !value.sourceRevision || !value.scopeRevision
          || !Number.isFinite(Date.parse(value.observedAt)) || !Number.isFinite(Date.parse(value.validUntil)) || Date.parse(value.validUntil) <= now
          || read.readAuthority?.userId !== userId || !Number.isFinite(read.readAuthority.deadline) || read.readAuthority.deadline <= now
          || read.readActor?.profileId !== actor.id || read.readActor.platformRole !== actor.role
          || query.area === "controls" && !("levelTotals" in value && validBacklogControls(value))
          || query.area === "sprints" && (!("day" in value) || value.day !== query.day || !validBacklogBuckets(value.buckets))) {
          backlogSupportStatuses.set(query.area, "unavailable"); publish(); return false;
        }
        if (!acceptBacklogSource(value.sourceRevision, token, Math.min(read.readAuthority.deadline, Date.parse(value.validUntil)))) {
          backlogSupportStatuses.set(query.area, "stale"); publish(); return false;
        }
        if (!acceptWorkspaceRead("backlog", read, token) || backlogSupportStatuses.get(query.area) !== "current") return false;
        backlogSupport.set(query.area, { value, generation: token.generation, session: token.sessionRevision, epoch: token.sourceEpoch,
          actorId: actor.id, actorRole: actor.role, deadline: Math.min(read.readAuthority.deadline, Date.parse(value.validUntil)) });
        publish(); return true;
      }).catch(error => {
        if (!bindingCurrent()) return false;
        backlogSupport.delete(query.area); backlogSupportStatuses.set(query.area, readErrorStatus(error)); publish(); return false;
      }).finally(() => {
        controller.signal.removeEventListener("abort", onAbort);
        if (backlogSupportReads.get(query.area)?.result === result) backlogSupportReads.delete(query.area);
      });
      pending = { key, result, controller, consumers: new Set() }; backlogSupportReads.set(query.area, pending); publish();
    }
    const lease = pending, consumer = Symbol(); lease.consumers.add(consumer);
    let aborted = false;
    const release = () => {
      aborted = true; lease.consumers.delete(consumer);
      if (!lease.consumers.size && backlogSupportReads.get(query.area) === lease) {
        lease.controller.abort(); backlogSupportReads.delete(query.area); backlogSupportStatuses.set(query.area, "stale"); publish();
      }
    };
    options.signal?.addEventListener("abort", release, { once: true });
    return lease.result.then(ok => !aborted && ok).finally(() => { options.signal?.removeEventListener("abort", release); lease.consumers.delete(consumer); });
  }
  function currentBacklogSelection() {
    if (!selectedBacklog) return undefined;
    if (!isActive() || selectedBacklog.generation !== sessionGeneration
      || selectedBacklog.session !== sessionRevision || selectedBacklog.epoch !== planningSourceEpoch
      || selectedBacklog.deadline <= (adapter.now?.() ?? Date.now())
      || workspaceStatuses.get("backlog") !== "current") {
      if (workspaceStatuses.get("backlog") === "current") workspaceStatuses.set("backlog", "stale");
      return undefined;
    }
    return selectedBacklog.selection;
  }
  function loadBacklogSelection(input: BacklogSelectionQuery, options: { immediate?: boolean; signal?: AbortSignal } = {}): Promise<boolean> {
    const query = normalizeBacklogSelection(input);
    if (!query || !isActive() || !sessionRevision || !actorIdentity || !adapter.readBacklogSelection || options.signal?.aborted) return Promise.resolve(false);
    const key = JSON.stringify(query), current = currentBacklogSelection();
    if (current && JSON.stringify(current.query) === key) return Promise.resolve(true);
    let pending = selectedBacklogRead;
    if (!pending || pending.key !== key || pending.controller.signal.aborted) {
      pending?.controller.abort();
      const token = beginWorkspaceRead("backlog"), controller = new AbortController();
      const actor = { id: actorIdentity.id, role: actorIdentity.platformRole };
      const consumers = new Set<symbol>();
      workspaceStatuses.set("backlog", "loading");
      const bindingCurrent = () => readIsCurrent("backlog", token) && token.sourceEpoch === planningSourceEpoch
        && actorIdentity?.id === actor.id && actorIdentity.platformRole === actor.role && !controller.signal.aborted;
      // Dispatch synchronously: an explicit view action must not wait for a debounce or another area.
      const dispatched = adapter.readBacklogSelection(query, { signal: controller.signal });
      let onAbort!: () => void;
      const aborted = new Promise<null>(resolve => { onAbort = () => resolve(null); controller.signal.addEventListener("abort", onAbort, { once: true }); });
      const result = Promise.race([dispatched, aborted]).then(read => {
        if (!bindingCurrent()) return false;
        const selection = read?.backlogSelection, now = adapter.now?.() ?? Date.now();
        const ids = new Set(read?.data.tasks.map(task => task.id));
        if (!read || !selection || JSON.stringify(normalizeBacklogSelection(selection.query)) !== key
          || read.readAuthority?.userId !== userId || !Number.isFinite(read.readAuthority.deadline) || read.readAuthority.deadline <= now
          || read.readActor?.profileId !== actor.id || read.readActor.platformRole !== actor.role
          || !selection.sourceRevision || !selection.scopeRevision || !Number.isFinite(Date.parse(selection.observedAt))
          || !Number.isFinite(Date.parse(selection.validUntil)) || Date.parse(selection.validUntil) <= now
          || !Number.isSafeInteger(selection.total) || selection.total < selection.itemIds.length
          || !["complete", "partial"].includes(selection.coverage)
          || new Set([...selection.itemIds, ...selection.contextIds]).size !== selection.itemIds.length + selection.contextIds.length
          || [...selection.itemIds, ...selection.contextIds].some(id => !ids.has(id))
          || selection.itemIds.some(id => !Number.isSafeInteger(selection.rankById[id]) || selection.rankById[id] < 1)) {
          workspaceStatuses.set("backlog", "unavailable"); publish(); return false;
        }
        if (!acceptBacklogSource(selection.sourceRevision, token, Math.min(read.readAuthority.deadline, Date.parse(selection.validUntil)))) {
          workspaceStatuses.set("backlog", "stale"); publish(); return false;
        }
        if (!acceptWorkspaceRead("backlog", read, token)) return false;
        selectedBacklog = { selection, generation: token.generation, session: token.sessionRevision, epoch: token.sourceEpoch,
          deadline: Math.min(read.readAuthority.deadline, Date.parse(selection.validUntil)) };
        memberships.set("backlog", new Set([...selection.itemIds, ...selection.contextIds]));
        publish(); return true;
      }).catch(error => {
        if (!bindingCurrent()) return false;
        selectedBacklog = undefined;
        workspaceStatuses.set("backlog", readErrorStatus(error)); publish(); return false;
      }).finally(() => { controller.signal.removeEventListener("abort", onAbort); if (selectedBacklogRead?.result === result) selectedBacklogRead = undefined; });
      pending = { key, result, controller, consumers };
      selectedBacklogRead = pending;
      publish();
    }
    const consumer = Symbol(); pending.consumers.add(consumer);
    const lease = pending;
    let aborted = false;
    const release = () => {
      aborted = true; lease.consumers.delete(consumer);
      if (!lease.consumers.size && selectedBacklogRead === lease) {
        lease.controller.abort(); selectedBacklogRead = undefined;
        workspaceStatuses.set("backlog", "stale"); publish();
      }
    };
    options.signal?.addEventListener("abort", release, { once: true });
    return lease.result.then(ok => !aborted && ok).finally(() => {
      options.signal?.removeEventListener("abort", release); lease.consumers.delete(consumer);
    });
  }
  function readIsCurrent(workspace: AppWorkspace, token: ReturnType<typeof beginWorkspaceRead>) {
    if (!isActive() || token.generation !== sessionGeneration || token.sessionRevision !== sessionRevision || (workspace === "planning" && token.sourceEpoch !== planningSourceEpoch)) return false;
    if (token.backlogArea) return token.sourceEpoch === planningSourceEpoch && backlogSupportSequences.get(token.backlogArea) === token.started;
    if (token.tablePage) return acceptedRead.get(workspace) === token.tablePage.baseRead && tableRequest === token.started
      && boardQueryKey === token.tablePage.queryKey && tableResult?.queryKey === token.tablePage.queryKey && tableResult.revision === token.tablePage.revision;
    if (!token.page) return acceptedRead.get(workspace) === token.started;
    return acceptedRead.get(workspace) === token.page.baseRead && columnRequests.get(token.page.column) === token.started
      && boardQueryKey === token.page.queryKey && boardResult?.queryKey === token.page.queryKey && boardResult?.revision === token.page.revision;
  }
  async function readWorkspace(workspace: AppWorkspace, query?: PlanningBoardQueryInput, append = false) {
    if (!isActive()) return false;
    if (workspace === "planning" && !append) { releaseHeldReads(); cancelPlanningReads(); columnReads.clear(); columnRequests.clear(); tableRead = undefined; tableRequest = undefined; summaryReads.clear(); summarySequences.clear(); }
    const token = beginWorkspaceRead(workspace, append ? query : undefined);
    const { eventRead, toolRead } = token;
    const setPageStatus = (status: PlanningReadStatus) => { if (!token.page || token.page.column === "Erledigt") pageStatus = status; if (token.page) columnReadStatus[token.page.column] = status; };
    if (append) setPageStatus("loading"); else workspaceStatuses.set(workspace, "loading");
    publish();
    let result: PlanningWorkspaceRead | null;
    const controller = new AbortController();
    readTransports.set(token.started, { workspace, controller });
    let streamAccepted = false, streamId = "";
    let heldBasis: Promise<boolean> | undefined;
    const progressReads: Promise<boolean>[] = [];
    const finishStream = async () => {
      const accepted = heldBasis ? await heldBasis : streamAccepted;
      await Promise.allSettled(progressReads);
      if (accepted) finishBoardDelivery(streamId);
      return accepted;
    };
    const onBoardStream = workspace === "planning" && !append ? (event: PlanningWorkspaceProgress) => {
      const denied = event.kind === "failure" ? event.error : event.kind === "outcome" && event.outcome.kind === "failure" ? event.outcome : undefined;
      if (denied && readErrorStatus(denied) === "forbidden" && isActive() && token.generation === sessionGeneration && token.sessionRevision === sessionRevision) {
        denyPlanningScope(); cancelPlanningReads(); publish(); return;
      }
      if (heldBasis && denied?.status === 409 && readIsCurrent(workspace, token)) {
        invalidatePlanningSource(); cancelPlanningReads(); boardDeliveries.clear(); publish(); return;
      }
      if (event.kind === "basis") {
        if (!readIsCurrent(workspace, token) || streamAccepted || heldBasis || !event.read.board || !event.read.query
          || query && planningBoardQueryKey(event.read.query) !== planningBoardQueryKey(query)) return;
        const visibleStatuses = allowedPlanningItemStatuses(event.read.query.level || "deliverable");
        const pending = visibleStatuses.filter(column => event.read.board!.columns[column].availability === "not-loaded" && (event.read.board!.columns[column].total || 0) > 0);
        const basis = { ...event.read, board: { ...event.read.board, delivery: { id: event.readId, columns: pending } } };
        streamId = event.readId;
        if (boardInteractions.size && (!boardQueryKey || !query || boardQueryKey === planningBoardQueryKey(query))) {
          heldBasis = receiveWorkspaceRead("planning", basis, token, query).then(accepted => {
            streamAccepted = accepted;
            if (!accepted) controller.abort();
            return accepted;
          });
        } else {
          streamAccepted = acceptWorkspaceRead("planning", basis, token);
          if (!streamAccepted) controller.abort();
        }
      } else {
        const readId = event.kind === "outcome" ? event.outcome.readId : event.readId;
        if (readId !== streamId) return;
        const accept = () => event.kind === "outcome"
          ? event.outcome.kind === "summaries" || event.outcome.kind === "failure" && event.outcome.area === "summaries"
            ? acceptServerSummary(streamId, event.outcome) : acceptServerColumn(streamId, event.outcome)
          : acceptBoardProgress(event);
        if (heldBasis) progressReads.push(heldBasis.then(accepted => accepted ? accept() : false));
        else if (streamAccepted) progressReads.push(accept());
      }
    } : undefined;
    try { result = await adapter.readWorkspace(workspace, query, { signal: controller.signal, onBoardStream }); }
    catch (error) {
      if (workspace === "planning" && readErrorStatus(error) === "forbidden" && isActive() && token.generation === sessionGeneration && token.sessionRevision === sessionRevision) {
        denyPlanningScope();
        publish();
        return false;
      }
      if (!readIsCurrent(workspace, token)) return false;
      if (streamAccepted || heldBasis) return finishStream();
      if (append) {
        const staleContinuation = typeof error === "object" && error !== null && "code" in error && error.code === "stale_continuation";
        setPageStatus(staleContinuation ? "stale" : readErrorStatus(error));
        if (staleContinuation && tableResult && token.tablePage) tableResult = { ...tableResult, page: { ...tableResult.page, continuation: null } };
        if (staleContinuation && boardResult && token.page) {
          const column = token.page.column;
          boardResult = { ...boardResult, columns: { ...boardResult.columns, [column]: { ...boardResult.columns[column], continuation: null } } };
        }
        if (readErrorStatus(error) === "forbidden") denyPlanningScope();
        publish();
        return false;
      }
      notifications.workspaceFailed(workspace, error);
      if (workspace === "backlog" && readErrorStatus(error) === "forbidden") { backlogAssignments.denied(); backlogOrdering.denied(); }
      if (toolRead !== null) tools.failed(error, toolRead);
      if (workspace === "events" && eventRead !== null) events.failed(error, eventRead);
      workspaceStatuses.set(workspace, readErrorStatus(error));
      if (workspace === "planning" && readErrorStatus(error) === "forbidden") denyPlanningScope();
      if (workspace === "sprint") { sprintState.readStatus(readErrorStatus(error)); if (readErrorStatus(error) === "forbidden") {attendanceState.denyWorkspace();scoreObjections.deny();} }
      profileSettings.readStatus(readErrorStatus(error), workspace);
      publish();
      return false;
    } finally { readTransports.delete(token.started); }
    if (streamAccepted || heldBasis) {
      const accepted = await finishStream();
      return accepted && readIsCurrent(workspace, token);
    }
    return receiveWorkspaceRead(workspace, result, token, query, append);
  }
  async function receiveWorkspaceRead(workspace: AppWorkspace, result: PlanningWorkspaceRead | null, token: ReturnType<typeof beginWorkspaceRead>, query?: PlanningBoardQueryInput, append = false) {
    const { eventRead, toolRead } = token;
    const setPageStatus = (status: PlanningReadStatus) => { if (!token.page || token.page.column === "Erledigt") pageStatus = status; if (token.page) columnReadStatus[token.page.column] = status; };
    if (!readIsCurrent(workspace, token)) return false;
    if (!result) {
      if (toolRead !== null) tools.failed(new Error("Links konnten nicht geladen werden."), toolRead);
      if (eventRead !== null) events.failed(new Error("Events konnten nicht geladen werden."), eventRead);
      if (append) setPageStatus("unavailable"); else workspaceStatuses.set(workspace, "unavailable");
      publish();
      return false;
    }
    if (query && result.query && planningBoardQueryKey(query) !== planningBoardQueryKey(result.query)) {
      if (append) setPageStatus("unavailable"); else workspaceStatuses.set(workspace, "unavailable");
      publish();
      return false;
    }
    if (append && (token.tablePage ? !result.table : !result.board || result.board.column !== token.page?.column)) { setPageStatus("unavailable"); publish(); return false; }
    const collapsesColumn = append && token.page && result.board?.columns[token.page.column].total === 0 && boardResult?.columns[token.page.column].total !== 0;
    if (workspace === "planning" && boardInteractions.size && (!append || collapsesColumn) && (!boardQueryKey || !query || boardQueryKey === planningBoardQueryKey(query))) {
      if (append) setPageStatus("stale");
      else { workspaceStatuses.set("planning", "stale"); freshness = "stale"; }
      publish();
      await new Promise<void>(resolve => heldReads.add(resolve));
    }
    return acceptWorkspaceRead(workspace, { ...result, query: result.query || query, append }, token);
  }
  function reserveBoardDelivery(id: string, basis: PlanningWorkspaceRead) {
    if (!basis.board || !basis.query || boardDeliveries.has(id)) return;
    const pending = new Set(basis.board.delivery?.columns || []);
    const visibleStatuses = allowedPlanningItemStatuses(basis.query.level || "deliverable");
    const tokens = new Map<TaskStatus, ReturnType<typeof beginWorkspaceRead>>();
    for (const column of pending) {
      if (!visibleStatuses.includes(column) || basis.board.columns[column].availability !== "not-loaded" || !(basis.board.columns[column].total! > 0)) continue;
      tokens.set(column, beginWorkspaceRead("planning", { ...basis.query, column }));
      columnReadStatus[column] = "loading";
    }
    const summaries = new Map((basis.board.summaryRequests || []).filter(request => request.status === "loading")
      .map(request => [request.token, beginBoardSummaryRead(request, basis)]));
    boardDeliveries.set(id, { basis, tokens, pending: new Set(tokens.keys()), summaries });
  }
  function finishBoardDelivery(id: string) {
    const delivery = boardDeliveries.get(id);
    if (!delivery) return;
    for (const column of delivery.pending) {
      const token = delivery.tokens.get(column);
      if (token && readIsCurrent("planning", token)) columnReadStatus[column] = "unavailable";
      delivery.tokens.delete(column);
    }
    delivery.pending.clear();
    for (const [key, token] of delivery.summaries) if (boardSummaryIsCurrent(key, token)) setSummaryStatus(key, "unavailable");
    delivery.summaries.clear();
    if (!delivery.tokens.size) boardDeliveries.delete(id);
    publish();
  }
  async function acceptBoardProgress(event: Extract<PlanningWorkspaceProgress, { kind: "column" | "failure" }>) {
    const delivery = boardDeliveries.get(event.readId);
    if (!delivery) return false;
    const token = event.column ? delivery.tokens.get(event.column) : delivery.tokens.values().next().value;
    if (!token) return false;
    if (event.kind === "failure" && readErrorStatus(event.error) === "forbidden" && isActive()
      && token.generation === sessionGeneration && token.sessionRevision === sessionRevision) {
      denyPlanningScope(); cancelPlanningReads(); boardDeliveries.clear(); publish(); return false;
    }
    if (!event.column || !delivery.pending.has(event.column) || !readIsCurrent("planning", token)) return false;
    const column = event.column;
    delivery.pending.delete(column);
    try {
      if (event.kind === "failure") {
        if (event.error.status === 409) { invalidatePlanningSource(); cancelPlanningReads(); }
        else columnReadStatus[column] = "unavailable";
        publish(); return false;
      }
      // Frames share the original basis authority, never a later receipt deadline.
      return await receiveWorkspaceRead("planning", { ...event.read, readAuthority: delivery.basis.readAuthority, append: true }, token, { ...delivery.basis.query, column }, true);
    } finally {
      delivery.tokens.delete(column);
      if (!delivery.tokens.size && !delivery.summaries.size) boardDeliveries.delete(event.readId);
    }
  }
  function acceptServerColumn(readId: string, outcome: PlanningBoardColumnOutcome): Promise<boolean> {
    const delivery = boardDeliveries.get(readId);
    if (!delivery || outcome.readId !== readId) return Promise.resolve(false);
    if (outcome.kind === "failure") return acceptBoardProgress({ kind: "failure", readId, column: outcome.column, error: { status: outcome.status, code: outcome.code } });
    const basis = delivery.basis;
    if (!basis.board || outcome.scopeRevision !== basis.scopeRevision || outcome.queryRevision !== basis.board.revision
      || outcome.observedAt !== basis.board.observedAt || outcome.validUntil !== (basis.board.validUntil ?? null)) return Promise.resolve(false);
    if (outcome.validUntil && Date.parse(outcome.validUntil) <= (adapter.now?.() ?? Date.now())) return acceptBoardProgress({ kind: "failure", readId, column: outcome.column, error: { status: 409, code: "stale_continuation" } });
    const read: PlanningWorkspaceRead = {
      ...basis, taskOmittedFields: outcome.taskOmittedFields, taskCoverage: "partial", coverage: { tasks: "partial", taskRelations: "partial", taskBlockers: "partial" },
      data: { ...basis.data, tasks: [...outcome.items], taskRelations: [...outcome.relationships], taskBlockers: [] },
      board: { ...basis.board, delivery: undefined, column: outcome.column, cardIds: outcome.cardIds,
        summaryRequests: undefined,
        columns: { ...basis.board.columns, [outcome.column]: outcome.columnState },
        childProgressById: Object.fromEntries(outcome.cardIds.map(id => [id, null])), attentionById: Object.fromEntries(outcome.cardIds.map(id => [id, null])),
        viewerOpenSubIssueIdsByDeliverableId: outcome.personalChildren },
    };
    return acceptBoardProgress({ kind: "column", readId, column: outcome.column, read });
  }
  function beginBoardSummaryRead(request: PlanningBoardSummaryRequest, basis?: PlanningWorkspaceRead) {
    const board = basis?.board || boardResult!;
    const started = ++sequence;
    summarySequences.set(request.token, started);
    return { started, request, generation: sessionGeneration, sessionRevision, sourceEpoch: planningSourceEpoch,
      baseRead: acceptedRead.get("planning"), queryKey: board.queryKey, revision: board.revision,
      scopeRevision: basis?.scopeRevision || scopeRevision, observedAt: board.observedAt, validUntil: board.validUntil ?? null,
      authority: basis?.readAuthority || planningAuthority };
  }
  function boardSummaryIsCurrent(key: string, token: ReturnType<typeof beginBoardSummaryRead>) {
    const now = adapter.now?.() ?? Date.now();
    return isActive() && token.generation === sessionGeneration && token.sessionRevision === sessionRevision
      && token.sourceEpoch === planningSourceEpoch && token.baseRead === acceptedRead.get("planning")
      && summarySequences.get(key) === token.started && boardResult?.queryKey === token.queryKey
      && boardResult.revision === token.revision && scopeRevision === token.scopeRevision
      && (!token.authority || token.authority.userId === userId && token.authority.deadline > now)
      && (!token.validUntil || Date.parse(token.validUntil) > now);
  }
  function setSummaryStatus(key: string, status: PlanningBoardSummaryRequest["status"]) {
    if (boardResult) boardResult = { ...boardResult, summaryRequests: boardResult.summaryRequests?.map(request => request.token === key ? { ...request, status } : request) };
  }
  async function applyBoardSummary(outcome: PlanningBoardSummaryOutcome, token: ReturnType<typeof beginBoardSummaryRead>) {
    if (outcome.kind === "failure" && outcome.status === 403 && isActive()
      && token.generation === sessionGeneration && token.sessionRevision === sessionRevision) {
      denyPlanningScope(); cancelPlanningReads(); boardDeliveries.clear(); publish(); return false;
    }
    if (!boardSummaryIsCurrent(token.request.token, token)) return false;
    if (outcome.kind === "failure") {
      if (outcome.status === 409) { invalidatePlanningSource(); cancelPlanningReads(); }
      else setSummaryStatus(token.request.token, "unavailable");
      publish(); return false;
    }
    const complete = outcome.token === token.request.token && outcome.scopeRevision === token.scopeRevision
      && outcome.queryRevision === token.revision && outcome.observedAt === token.observedAt && outcome.validUntil === token.validUntil
      && JSON.stringify(outcome.cardIds) === JSON.stringify(token.request.cardIds)
      && token.request.cardIds.every(id => {
        const value = outcome.childProgressById[id];
        return value && [value.completed, value.total, value.unfinished, value.percentage].every(Number.isSafeInteger)
          && value.completed >= 0 && value.unfinished >= 0 && value.total === value.completed + value.unfinished
          && value.percentage === (value.total ? Math.round((value.completed / value.total) * 100) : 0)
          && (!outcome.attentionById || Array.isArray(outcome.attentionById[id]) && outcome.attentionById[id]!.every(signal =>
            typeof signal.id === "string" && typeof signal.label === "string" && (signal.kind === "critical" || signal.kind === "quality")));
      });
    if (!complete) { setSummaryStatus(token.request.token, "unavailable"); publish(); return false; }
    if (boardInteractions.size) await new Promise<void>(resolve => heldReads.add(resolve));
    if (!boardSummaryIsCurrent(token.request.token, token) || !boardResult) return false;
    boardResult = { ...boardResult, childProgressById: { ...boardResult.childProgressById,
      ...Object.fromEntries(token.request.cardIds.map(id => [id, outcome.childProgressById[id]])) },
      ...(outcome.attentionById ? { attentionById: { ...boardResult.attentionById,
        ...Object.fromEntries(token.request.cardIds.map(id => [id, outcome.attentionById![id]])) } } : {}) };
    setSummaryStatus(token.request.token, "current");
    rememberPlanningQuery(); publish(); return true;
  }
  async function acceptServerSummary(readId: string, outcome: PlanningBoardSummaryOutcome) {
    const delivery = boardDeliveries.get(readId);
    if (!delivery || outcome.readId !== readId) return false;
    const key = outcome.token || (outcome.kind === "failure" && delivery.summaries.size === 1 ? delivery.summaries.keys().next().value : undefined);
    if (!key) return false;
    const token = delivery.summaries.get(key);
    if (!token) return false;
    delivery.summaries.delete(key);
    try { return await applyBoardSummary(outcome, token); }
    finally { if (!delivery.tokens.size && !delivery.summaries.size) boardDeliveries.delete(readId); }
  }
  function readBoardSummary(request: PlanningBoardSummaryRequest): Promise<boolean> {
    const existing = summaryReads.get(request.token);
    if (existing) return existing.result;
    if (!adapter.readBoardSummaries) return Promise.resolve(false);
    const token = beginBoardSummaryRead(request), controller = new AbortController();
    setSummaryStatus(request.token, "loading"); publish();
    const result = Promise.resolve().then(async () => {
      try {
        const read = await adapter.readBoardSummaries!(request.token, { signal: controller.signal });
        if (read.readAuthority.userId !== userId || read.readAuthority.deadline <= (adapter.now?.() ?? Date.now())) {
          return applyBoardSummary({ kind: "failure", readId: "", area: "summaries", token: request.token, status: 403, error: "Planung darf nicht geladen werden." }, token);
        }
        return await applyBoardSummary(read.summaries, token);
      } catch (error) {
        const status = readErrorStatus(error) === "forbidden" ? 403 : typeof error === "object" && error !== null && "status" in error && error.status === 409 ? 409 : 503;
        return applyBoardSummary({ kind: "failure", readId: "", area: "summaries", token: request.token, status, error: "Fortschritt und Signale konnten nicht geladen werden." }, token);
      }
    }).finally(() => { if (summaryReads.get(request.token)?.result === result) summaryReads.delete(request.token); });
    summaryReads.set(request.token, { result, controller });
    return result;
  }
  function loadPendingTableRisks() {
    if (!isActive() || freshness === "stale") return;
    for (const request of tableResult?.summaryRequests || []) if (request.status === "loading") void readTableRisk(request);
  }
  function beginTableRiskRead(request: PlanningBoardSummaryRequest) {
    const table = tableResult!, started = ++sequence;
    summarySequences.set(request.token, started);
    return { started, request, generation: sessionGeneration, sessionRevision, sourceEpoch: planningSourceEpoch,
      baseRead: acceptedRead.get("planning"), queryKey: table.queryKey, revision: table.revision,
      scopeRevision, observedAt: table.observedAt, validUntil: table.validUntil ?? null, authority: planningAuthority };
  }
  function tableRiskIsCurrent(token: ReturnType<typeof beginTableRiskRead>) {
    const now = adapter.now?.() ?? Date.now();
    return isActive() && token.generation === sessionGeneration && token.sessionRevision === sessionRevision
      && token.sourceEpoch === planningSourceEpoch && token.baseRead === acceptedRead.get("planning")
      && summarySequences.get(token.request.token) === token.started && tableResult?.queryKey === token.queryKey
      && tableResult.revision === token.revision && scopeRevision === token.scopeRevision
      && tableResult.observedAt === token.observedAt && (tableResult.validUntil ?? null) === token.validUntil
      && (!token.authority || token.authority.userId === userId && token.authority.deadline > now)
      && (!token.validUntil || Date.parse(token.validUntil) > now);
  }
  function setTableRiskStatus(key: string, status: PlanningBoardSummaryRequest["status"]) {
    if (tableResult) tableResult = { ...tableResult, summaryRequests: tableResult.summaryRequests?.map(request => request.token === key ? { ...request, status } : request) };
  }
  function applyTableRisk(token: ReturnType<typeof beginTableRiskRead>, outcome: import("../planning-table-result").PlanningTableRiskFrame | 403 | 409 | 503) {
    if (outcome === 403 && isActive() && token.generation === sessionGeneration && token.sessionRevision === sessionRevision) {
      denyPlanningScope(); cancelPlanningReads(); publish(); return false;
    }
    if (!tableRiskIsCurrent(token)) return false;
    if (typeof outcome === "number") {
      if (outcome === 409) { invalidatePlanningSource(); cancelPlanningReads(); }
      else setTableRiskStatus(token.request.token, "unavailable");
      publish(); return false;
    }
    const valid = outcome.kind === "table-risks" && outcome.token === token.request.token && outcome.scopeRevision === token.scopeRevision
      && outcome.queryRevision === token.revision && outcome.observedAt === token.observedAt && outcome.validUntil === token.validUntil
      && JSON.stringify(outcome.cardIds) === JSON.stringify(token.request.cardIds) && token.request.cardIds.every(id => {
        const risk = outcome.risksById?.[id];
        return tableResult?.rowIds.includes(id) && risk && [risk.waitsOn, risk.blocks].every(count => Number.isSafeInteger(count) && count >= 0)
          && typeof risk.hasOpenWait === "boolean" && (!risk.hasOpenWait || risk.waitsOn > 0) && Array.isArray(risk.attention)
          && risk.attention.every(signal => typeof signal.id === "string" && typeof signal.label === "string" && (signal.kind === "critical" || signal.kind === "quality"))
          && risk.attention.some(signal => signal.id === "waiting") === risk.hasOpenWait;
      });
    if (!valid || !tableResult) { setTableRiskStatus(token.request.token, "unavailable"); publish(); return false; }
    tableResult = { ...tableResult, risksById: { ...tableResult.risksById, ...Object.fromEntries(token.request.cardIds.map(id => [id, outcome.risksById[id]])) } };
    setTableRiskStatus(token.request.token, "current");
    rememberPlanningQuery(); publish(); return true;
  }
  function readTableRisk(request: PlanningBoardSummaryRequest): Promise<boolean> {
    const existing = summaryReads.get(request.token);
    if (existing) return existing.result;
    if (!adapter.readTableRisks || !tableResult) return Promise.resolve(false);
    const token = beginTableRiskRead(request), controller = new AbortController();
    setTableRiskStatus(request.token, "loading"); publish();
    const result = Promise.resolve().then(async () => {
      try {
        const read = await adapter.readTableRisks!(request.token, { signal: controller.signal });
        if (read.readAuthority.userId !== userId || read.readAuthority.deadline <= (adapter.now?.() ?? Date.now())) return applyTableRisk(token, 403);
        return applyTableRisk(token, read.summaries);
      } catch (error) {
        return applyTableRisk(token, readErrorStatus(error) === "forbidden" ? 403 : typeof error === "object" && error !== null && "status" in error && error.status === 409 ? 409 : 503);
      }
    }).finally(() => { if (summaryReads.get(request.token)?.result === result) summaryReads.delete(request.token); });
    summaryReads.set(request.token, { result, controller });
    return result;
  }
  function beginWorkspaceRead(workspace: AppWorkspace, query?: PlanningBoardQueryInput, backlogArea?: BacklogSupportQuery["area"]) {
    const tablePage = query?.view === "table" && tableResult ? { queryKey: tableResult.queryKey, revision: tableResult.revision, baseRead: acceptedRead.get(workspace) } : undefined;
    const page = query?.column && boardResult ? { column: query.column, queryKey: boardResult.queryKey, revision: boardResult.revision, baseRead: acceptedRead.get(workspace), continuation: query.continuation } : undefined;
    const token = {
      page, tablePage, backlogArea,
      generation: sessionGeneration,
      sessionRevision,
      sourceEpoch: planningSourceEpoch,
      started: ++sequence,
      notificationRead: notifications.beginWorkspaceRead(workspace),
      eventRead: workspace === "events" ? events.beginRead() : null,
      toolRead: workspace === "tools" ? tools.beginRead() : null,
    };
    if (backlogArea) backlogSupportSequences.set(backlogArea, token.started);
    else if (tablePage) tableRequest = token.started;
    else if (page) columnRequests.set(page.column, token.started);
    else acceptedRead.set(workspace, token.started);
    return token;
  }
  function acceptWorkspaceRead(workspace: AppWorkspace, result: PlanningWorkspaceRead, token: ReturnType<typeof beginWorkspaceRead>) {
    const { started, notificationRead, eventRead, toolRead } = token;
    if (!readIsCurrent(workspace, token)) return false;
    if (workspace === "planning" && result.readAuthority && (result.readAuthority.userId !== userId || !Number.isFinite(result.readAuthority.deadline) || result.readAuthority.deadline <= (adapter.now?.() ?? Date.now()))) {
      if (token.page) columnReadStatus[token.page.column] = "unavailable";
      else workspaceStatuses.set(workspace, "unavailable");
      publish();
      return false;
    }
    if (workspace === "planning" && result.query?.view === "complete") {
      const coverage = result.coverage || {};
      const complete = (result.taskCoverage || coverage.tasks) === "complete"
        && ["profiles", "sprints", "taskRelations", "taskBlockers"].every(field => coverage[field as keyof PlanningReadCoverage] === "complete");
      if (result.board || !complete) {
        workspaceStatuses.set("planning", "unavailable");
        publish();
        return false;
      }
    }
    if (workspace === "planning" && result.query?.view === "table") {
      const next = result.table, previous = result.append ? tableResult : undefined;
      const ids = next?.rowIds || [];
      const rowIds = [...new Set([...(previous?.rowIds || []), ...ids])];
      const valid = next && !result.board && next.query.view === "table" && next.queryKey === planningBoardQueryKey(result.query)
        && next.queryKey === planningBoardQueryKey(next.query) && next.revision === result.queryRevision
        && Number.isFinite(Date.parse(next.observedAt)) && (!next.validUntil || Date.parse(next.validUntil) > (adapter.now?.() ?? Date.now()))
        && Array.isArray(next.statusOptions) && new Set(next.statusOptions).size === next.statusOptions.length
        && next.statusOptions.every(status => [...taskStatuses, "Pausiert"].includes(status))
        && Number.isSafeInteger(next.page.total) && next.page.total >= 0 && next.page.loaded === ids.length
        && new Set(ids).size === ids.length && rowIds.length <= next.page.total
        && ids.every(id => result.data.tasks.some(task => task.id === id && task.taskType === "deliverable"))
        && (next.page.completeness === "complete" ? next.page.continuation === null && rowIds.length === next.page.total : typeof next.page.continuation === "string" && next.page.continuation.length > 0)
        && (!result.append || token.tablePage && previous && previous.queryKey === next.queryKey && previous.revision === next.revision
          && previous.observedAt === next.observedAt && previous.validUntil === next.validUntil && previous.page.total === next.page.total && scopeRevision === result.scopeRevision);
      if (!valid) {
        if (result.append) pageStatus = "unavailable"; else workspaceStatuses.set("planning", "unavailable");
        publish(); return false;
      }
      const risksById = { ...previous?.risksById };
      for (const [id, value] of Object.entries(next.risksById || {})) if (value !== null || risksById[id] == null) risksById[id] = value;
      tableResult = { ...next, rowIds, risksById, page: { ...next.page, loaded: rowIds.length },
        attentionById: { ...previous?.attentionById, ...next.attentionById },
        summaryRequests: [...new Map([...(previous?.summaryRequests || []), ...(next.summaryRequests || [])].map(request => [request.token, request])).values()] };
      boardResult = undefined;
      if (!result.append) weekBasis = planningWeekBasis(next, result.coverage, result.data.sprints);
      boardQuery = next.query; displayedQuery = boardQuery; boardQueryKey = next.queryKey; pageStatus = "current";
    } else if (workspace === "planning" && result.board) {
      tableResult = undefined;
      if (result.query && result.board.queryKey !== planningBoardQueryKey(result.query)) {
        if (token.page) columnReadStatus[token.page.column] = "unavailable";
        else workspaceStatuses.set("planning", "unavailable");
        publish();
        return false;
      }
      if (result.append && (!token.page || result.board.column !== token.page.column || !boardResult || boardResult.queryKey !== result.board.queryKey || (token.page.continuation && boardResult.revision !== result.board.revision))) {
        if (token.page) columnReadStatus[token.page.column] = "stale";
        pageStatus = "stale"; publish(); return false;
      }
      const previous = result.append ? boardResult : undefined;
      const retainedIds = previous && token.page && !token.page.continuation ? previous.cardIds.filter(id => normalizeStatus(confirmed.tasks.find(task => task.id === id)?.status || "") !== token.page!.column) : previous?.cardIds || [];
      const cardIds = [...new Set([...retainedIds, ...result.board.cardIds])];
      const columns = previous ? { ...previous.columns } : { ...result.board.columns };
      if (previous && token.page) {
        const column = token.page.column;
        const added = result.board.cardIds.filter(id => !retainedIds.includes(id)).length;
        columns[column] = { ...result.board.columns[column], loaded: (token.page.continuation ? previous.columns[column].loaded : 0) + added };
        if (previous.revision !== result.board.revision) {
          for (const other of Object.keys(columns) as TaskStatus[]) if (other !== column) {
            columnReadStatus[other] = "stale";
            columns[other] = { ...columns[other], continuation: null };
          }
        }
        columnReadStatus[column] = "current";
      } else {
        for (const column of Object.keys(columnReadStatus) as TaskStatus[]) delete columnReadStatus[column];
        for (const [column, coverage] of Object.entries(columns)) if (coverage.availability === "not-loaded") columnReadStatus[column as TaskStatus] = "not-loaded";
      }
      if (!result.append) weekBasis = planningWeekBasis(result.board, result.coverage, result.data.sprints);
      const compatible = previous?.revision === result.board.revision && scopeRevision === result.scopeRevision;
      function mergeSummaries<T>(oldValues: Record<string, T | null> | undefined, nextValues: Record<string, T | null> | undefined) {
        const merged: Record<string, T | null> = compatible ? { ...oldValues } : Object.fromEntries((previous?.cardIds || []).map(id => [id, null]));
        for (const [id, value] of Object.entries(nextValues || {})) if (value !== null || merged[id] == null) merged[id] = value;
        return merged;
      }
      const requests = new Map((compatible ? previous?.summaryRequests || [] : []).map(request => [request.token, request]));
      for (const request of result.board.summaryRequests || []) requests.set(request.token, request);
      boardResult = {
        ...result.board, column: undefined, cardIds, columns,
        ...(result.board.summaryRequests || previous?.summaryRequests ? { summaryRequests: [...requests.values()] } : {}),
        attentionById: mergeSummaries(previous?.attentionById, result.board.attentionById),
        childProgressById: mergeSummaries(previous?.childProgressById, result.board.childProgressById),
        viewerOpenSubIssueIdsByDeliverableId: { ...previous?.viewerOpenSubIssueIdsByDeliverableId, ...result.board.viewerOpenSubIssueIdsByDeliverableId },
      };
      boardQuery = result.board.query;
      displayedQuery = boardQuery;
      boardQueryKey = result.board.queryKey;
      pageStatus = "current";
    } else if (workspace === "planning" && result.query) {
      boardResult = undefined;
      tableResult = undefined;
      weekBasis = undefined;
      boardQuery = normalizePlanningBoardQuery(result.query);
      displayedQuery = boardQuery;
      boardQueryKey = planningBoardQueryKey(boardQuery);
      pageStatus = "current";
      for (const column of Object.keys(columnReadStatus) as TaskStatus[]) delete columnReadStatus[column];
    }
    if (workspace === "planning") {
      if (started >= scopeRevisionReadAt) { scopeRevision = result.scopeRevision; scopeRevisionReadAt = started; sourceStatus = "current"; }
      const revision = result.queryRevision || result.board?.revision || result.table?.revision;
      if (!revision || revision !== queryRevision) planningQueries.clear();
      queryRevision = revision;
    }
    if (workspace === "backlog" && !token.backlogArea) { backlogCoverage = result.backlogCoverage || {}; if (!result.backlogSelection) selectedBacklog = undefined; }
    const coverage = result.coverage || workspaceReadCoverage(workspace);
    if (coverage.profiles) acceptProfileScope(workspace, result.data.profiles, coverage.profiles === "complete");
    if (coverage.taskRelations) relationshipChanges.acceptRead(result.data.taskRelations, started, coverage.taskRelations === "complete");
    if (coverage.taskActivity) for (const taskId of new Set([...result.data.tasks.map(task => task.id), ...result.data.taskActivity.map(row => row.taskId)])) attachmentUploads.acceptRead(result.data.taskActivity, started, coverage.taskActivity === "complete", taskId);
    if (coverage.taskExternalComments) githubImports.acceptRead(result.data.taskExternalComments, started, coverage.taskExternalComments === "complete");
    if (coverage.taskComments) commentCreations.acceptRead(result.data.taskComments, started, coverage.taskComments === "complete");
    if (coverage.taskBlockers) blockerReports.acceptBlockerRead(result.data.taskBlockers, started, coverage.taskBlockers === "complete");
    const taskCoverage = result.taskCoverage === "none" ? undefined : result.taskCoverage || coverage.tasks;
    const rawIncoming = taskCoverage ? result.data.tasks : [];
    const currentIds = new Set(confirmed.tasks.map(task => task.id));
    // A late full row cannot precede a confirmed partial receipt for a still-unresolved identity.
    const incoming = rawIncoming.filter(task => !lifecycle.isRemoved(task) && (taskDeniedAt.get(task.id) || 0) <= started && (currentIds.has(task.id) || (taskConfirmedAt.get(task.id) || 0) <= started));
    for (const task of incoming) deniedTaskReads.delete(task.id);
    const protectedIds = new Set(confirmed.tasks.filter(task => (taskConfirmedAt.get(task.id) || 0) > started || (taskReadAt.get(task.id) || 0) > started).map(task => task.id));
    const acceptedTask = (task: Task) => {
      const previous = confirmed.tasks.find(item => item.id === task.id);
      const omittedFields = result.taskOmittedFields || (task.detailAvailability === "summary" ? summaryDetailFields : []);
      acceptTaskFieldCoverage(task, omittedFields);
      if (!previous || !omittedFields.length) return task;
      const next = { ...previous, ...task };
      for (const field of omittedFields) Object.assign(next, { [field]: previous[field] });
      if (previous.detailAvailability !== "summary") {
        next.detailAvailability = "stale";
        detailStatuses.set(task.id, "stale");
        const childList = childLists.get(task.id);
        if (childList?.readStatus === "current") childLists.set(task.id, { ...childList, readStatus: "stale" });
      }
      return next;
    };
    const replacements = new Map(incoming.filter(task => !protectedIds.has(task.id)).map(task => [task.id, acceptedTask(task)]));
    const known = new Set(confirmed.tasks.map(task => task.id));
    for (const task of replacements.values()) taskReadAt.set(task.id, started);
    const covered = projectCoveredRead(confirmed, result.data, coverage);
    for (const field of result.projectOmittedFields || []) Object.assign(covered.project, { [field]: confirmed.project[field] });
    const projectRead = coverage.project ? administration.acceptProjectRead(covered.project, started) : {project:covered.project,stale:false};
    covered.project=projectRead.project;
    if (coverage.taskRelations) lifecycle.acceptRelationshipRead(covered, started, coverage.taskRelations === "complete");
    for (const field of ["taskActivity","taskReviews"] as const) {
      const retained = confirmed[field].filter(item=>protectedIds.has(item.taskId));
      const incoming = covered[field].filter(item=>!protectedIds.has(item.taskId));
      Object.assign(covered,{[field]:[...incoming,...retained]});
    }
    const profileRead = profileSettings.acceptRead(covered, coverage, started, workspace, result.data, result.profileOmittedFields);
    const sprintCoverage = { ...coverage }; delete sprintCoverage.meetingAttendance;
    const sprintRead = sprintState.acceptRead(profileRead.data, sprintCoverage, started, result.data);
    if (coverage.meetingAttendance) attendanceState.acceptRead(result.data.meetingAttendance, started, coverage.meetingAttendance === "complete");
    const scoreRead=scoreObjections.acceptRead(sprintRead.data,coverage,started,result.data);
    sprintRead.data=scoreRead.data;
    const commitmentRead=commitments.acceptRead(result.data.sprintCommitments,coverage.sprintCommitments,started);
    sprintRead.data.sprintCommitments=commitmentRead.rows;
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
    if (!token.backlogArea) completeness.set(workspace, taskCoverage || "none");
    const stale = scoreRead.stale || commitmentRead.stale || projectRead.stale || rawIncoming.length !== incoming.length || sprintRead.stale || profileRead.stale || incoming.some(task => protectedIds.has(task.id) && (!token.page || (taskConfirmedAt.get(task.id) || 0) > started)) || (taskCoverage === "complete" && [...protectedIds].some(id => memberships.get(workspace)?.has(id)));
    if (token.backlogArea) backlogSupportStatuses.set(token.backlogArea, stale ? "stale" : "current");
    else workspaceStatuses.set(workspace, stale ? "stale" : "current");
    if (workspace === "planning" && (boardResult || tableResult) && stale) { pageStatus = "stale"; if (token.page) columnReadStatus[token.page.column] = "stale"; }
    if (toolRead !== null) tools.acceptRead({ tools: result.data.fmdTools, completeness: result.toolCoverage || "partial" }, toolRead, Boolean(result.headerData && result.headerData.quickLinks.state === "ready"));
    if (eventRead !== null) events.acceptRead({ events: result.data.events, coverage: result.eventCoverage || { range: null, completeness: "partial" } }, eventRead, Boolean(result.headerData && result.headerData.calendarEvents.state !== "idle"));
    notifications.acceptWorkspaceRead(workspace, result.data, result.headerData, notificationRead, result.notificationCoverage);
    if (!token.backlogArea) profileSettings.readStatus(stale ? "stale" : "current", workspace);
    if (workspace === "sprint") sprintState.readStatus(stale ? "stale" : "current");
    if (result.currentProfile) actorIdentity = { ...result.currentProfile };
    acceptWorkspaceContext?.(result);
    freshness = stale ? "stale" : "current";
    if (workspace === "planning") {
      planningAuthority = result.append && planningAuthority && result.readAuthority
        ? { ...result.readAuthority, deadline: Math.min(planningAuthority.deadline, result.readAuthority.deadline) }
        : result.readAuthority;
      rememberPlanningQuery();
    }
    if (workspace === "planning" && !result.append && result.board?.delivery) reserveBoardDelivery(result.board.delivery.id, result);
    publish();
    if (workspace === "planning" && result.table) queueMicrotask(loadPendingTableRisks);
    return true;
  }
  function suspendProtected() {
    candidateReads.clear();
    selectedBacklog = undefined; selectedBacklogRead?.controller.abort(); clearBacklogSupport();
    failedQueryDemand = undefined;
    planningInteraction = { selectedTaskId: null };
    boardInteractions.clear();
    releaseHeldReads();
    sourceTransport?.abort();
    for (const read of readTransports.values()) read.controller.abort();
    for (const read of summaryReads.values()) read.controller.abort();
    discardQueuedQuery();
    clearAutomaticRefresh();
    planningAuthority = undefined;
    sessionGeneration++;
    active = false;
    initialized = false;
    tails.clear();
    for (const demand of detailDemands.values()) demand.controller.abort();
    detailDemands.clear();
    detailReads.clear();
    outcomeChecks.clear();
    outcomeCheckStatus.clear();
    editing.clear();
    hierarchy.clear();
    decisionLog.clear();
    attendanceState.clear();
    relationshipChanges.clear();
    attachmentUploads.clear();
    taskReviews.clear();
    githubSync.clear();
    githubConnection.clear();
    githubImports.clear();
    commentCreations.clear();
    commentDrafts.clear();
    blockerReports.clear();
    lifecycle.clear();
    administration.clear();
    backlogOrdering.clear();
    backlogAssignments.clear();
    sprintState.clear();
    commitments.clear();
    scoreObjections.clear();
    reviewWindow.clear();
    sprintPlan.clear();
    sprintLock.clear();
    profileSettings.clear();
    profileTokens.clear();
    pending.clear();
    taskConfirmedAt.clear();
    taskReadAt.clear();
    status.clear();
    memberships.clear();
    workspaceStatuses.clear();
    completeness.clear();
    acceptedRead.clear();
    hydrationReads.clear();
    boardResult = undefined; tableResult = undefined; tableRead = undefined; tableRequest = undefined; weekBasis = undefined; boardQuery = undefined; displayedQuery = undefined; boardQueryKey = undefined; boardRead = undefined; pageStatus = "not-loaded";
    planningQueries.clear(); queryRevision = undefined; scopeRevision = undefined; sourceObservation = undefined; sourceStatus = "unverified";
    columnReads.clear(); columnRequests.clear(); boardDeliveries.clear();
    summaryReads.clear(); summarySequences.clear();
    for (const column of Object.keys(columnReadStatus) as TaskStatus[]) delete columnReadStatus[column];
    workspaceReads.clear();
    hydrationRequests.clear();
    backlogCoverage = {};
    detailStatuses.clear();
    detailAreaStatuses.clear();
    detailReceipts.clear();
    scopedDetailIds.clear();
    childLists.clear();
    deniedTaskReads.clear();
    taskDeniedAt.clear();
    retainedTaskFields.clear();
    profileScopes.clear();
    actorIdentity = null;
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
    let authorityChanged = false;
    sessionChanged(session?.userId || null);
    if (session?.userId === userId && !ended) {
      if (sessionRevision && sessionRevision !== session.revision) {
        const selectedQuery = boardQuery;
        suspendProtected();
        active = true;
        boardQuery = selectedQuery;
        requiresBoundHydration = true;
        authorityChanged = true;
      }
      sessionRevision = session.revision;
      sessionExpiresAt = session.expiresAt;
    }
    return isActive() && authorityChanged;
  }
  const unsubscribeSession = adapter.subscribeSession?.(sessionChanged);
  function acceptHydration(data: PlanningShellState, account: string, workspace: AppWorkspace = initialWorkspace, read?: import("../planning-workspace-hydration").PlanningWorkspaceHydration) {
    if (ended || (userId && userId !== account)) return;
    userId = account;
    active = Boolean(account);
    if (!isActive()) return;
    const boundRead = read && read.workspace === workspace && (read.queryKey === "workspace" || (read.query && planningBoardQueryKey(read.query) === read.queryKey) || read.board?.queryKey === read.queryKey) && read.session.userId === userId
      && read.session.revision === sessionRevision && read.session.expiresAt === sessionExpiresAt
      && read.session.expiresAt * 1000 > (adapter.now?.() ?? Date.now())
      && (!read.readAuthority || read.readAuthority.userId === userId && read.readAuthority.deadline > (adapter.now?.() ?? Date.now()));
    if (read?.readAuthority && !boundRead) return;
    const requested = hydrationRequests.get(workspace);
    hydrationRequests.delete(workspace);
    if (requiresBoundHydration && !boundRead) {
      // Reject the page payload, but recover its target through the current authority.
      void planning.refreshWorkspace(workspace);
      return;
    }
    if (boundRead && read) {
      const identity = read;
      if (workspaceStatuses.get(workspace) === "current" && hydrationReads.get(workspace) === identity) return;
      if (requested && acceptWorkspaceRead(workspace, {
        data, readAuthority: read.readAuthority, scopeRevision: read.scopeRevision, board: read.board, table: read.table, query: read.query || read.board?.query || read.table?.query, queryRevision: read.queryRevision, coverage: read.coverage, taskCoverage: read.coverage.tasks,
        taskOmittedFields: read.taskOmittedFields,
        profileOmittedFields: ["notificationsEnabled", "googleChatUserId", "googleChatDmSpace"],
        projectOmittedFields: ["githubProjectOwner", "githubProjectNumber"],
      }, requested)) {
        hydrationReads.set(workspace, identity);
        return;
      }
    }
    // A returned page cannot replace a result without its original request token.
    // Reuse its compatible authorized scope and observe only the uncertain source.
    if (initialized && boundRead && read && workspace === "planning" && memberships.has(workspace)
      && (read.queryKey === "workspace" ? !boardQueryKey : read.queryKey === boardQueryKey)) {
      void planning.checkPlanningSource();
      return;
    }
    if (initialized && boundRead && read?.query && workspace === "planning") {
      void planning.ensureBoardQuery(read.query);
      return;
    }
    // Page/cache snapshots carry no request token. They cannot prove that any existing scope is newer.
    if (initialized) {
      workspaceStatuses.set(workspace, "stale");
      freshness = "stale";
      publish();
      void planning.refreshWorkspace(workspace);
      return;
    }
    initialized = true;
    restoreTaskFieldCoverage(data.tasks);
    for(const task of data.tasks)if(task.detailAvailability === "stale")detailStatuses.set(task.id,"stale");
    githubImports.acceptRead(data.taskExternalComments, ++sequence, false);
    attendanceState.acceptRead(data.meetingAttendance, ++sequence, false);
    relationshipChanges.acceptRead(data.taskRelations, ++sequence, false);
    for (const taskId of new Set(data.taskActivity.map(row => row.taskId))) attachmentUploads.acceptRead(data.taskActivity, ++sequence, false, taskId);
    if (workspace === "tools") tools.acceptRead({ tools: data.fmdTools, completeness: "partial" }, tools.beginRead());
    if (workspace === "events") events.acceptRead({ events: data.events, coverage: { range: null, completeness: "partial" } }, events.beginRead());
    const coverage = workspaceReadCoverage(workspace);
    const known = new Set(confirmed.tasks.map(task => task.id));
    confirmed = { ...projectCoveredRead(confirmed, data, coverage), tasks: [...confirmed.tasks, ...data.tasks.filter(task => !known.has(task.id))] };
    memberships.set(workspace, new Set(data.tasks.map(task => task.id)));
    acceptProfileScope(workspace, data.profiles);
    profileSettings.hydrate(data, workspace);
    workspaceStatuses.set(workspace, "current");
    completeness.set(workspace, coverage.tasks || "none");
    publish();
  }
  function acceptTaskDetailHydration(read: import("@/features/tasks/model/task-detail-read-model").TaskDetailHydration, notify = true) {
    if (!isActive() || read.itemId !== read.model.item.id || read.session.userId !== userId || read.session.revision !== sessionRevision
      || read.model.readArea !== "target" || !validDetailReceipt(read.model, read.readAuthority, actorIdentity)) return false;
    const tasks = [read.model.item, ...read.model.ancestors];
    if (tasks.some(task => {
      const known = confirmed.tasks.find(row => row.id === task.id);
      return (taskConfirmedAt.get(task.id) || 0) > 0 || Boolean(known && known.updatedAt !== task.updatedAt);
    })) return false;
    confirmed = applyTaskDetailModel(confirmed, read.model, [], {});
    for (const task of tasks) { deniedTaskReads.delete(task.id); acceptTaskFieldCoverage(task); }
    scopedDetailIds.add(read.model.item.id);
    rememberDetailReceipt(read.model.item.id, "target", read.model, read.readAuthority);
    detailStatuses.set(read.model.item.id, "current");
    if (read.model.supportingData !== "omitted") acceptProfileScope("task:"+read.model.item.id, read.model.people);
    if (notify) publish();
    else visible = confirmed;
    return true;
  }
  if (initialTaskDetailRead) acceptTaskDetailHydration(initialTaskDetailRead, false);
  if (initialWorkspaceRead?.workspace === "planning" && initialWorkspaceRead.board?.delivery && initialWorkspaceRead.readAuthority
    && initialWorkspaceRead.session.userId === userId && initialWorkspaceRead.readAuthority.userId === userId
    && initialWorkspaceRead.readAuthority.deadline > (adapter.now?.() ?? Date.now())) {
    reserveBoardDelivery(initialWorkspaceRead.board.delivery.id, {
      data: initialData, board: initialWorkspaceRead.board, query: initialWorkspaceRead.query, queryRevision: initialWorkspaceRead.queryRevision,
      scopeRevision: initialWorkspaceRead.scopeRevision, readAuthority: initialWorkspaceRead.readAuthority,
      coverage: initialWorkspaceRead.coverage, taskOmittedFields: initialWorkspaceRead.taskOmittedFields, taskCoverage: "partial",
    });
  }
  rememberPlanningQuery();
  queueMicrotask(loadPendingTableRisks);
  queueMicrotask(() => commentCreations.restore());
  return { planning, internal: {
    getSnapshot: () => visible,
    isActive,
    planningReadAuthority: () => planningAuthority,
    watchServerHeaderRead: notifications.watchServerRead,
    bindAdministrationAuthority: administration.bindAuthority,
    captureAdministrationDispatchGuard: administration.captureDispatchGuard,
    confirmedHeader: notifications.confirmedHeader,
    acceptHeaderHydration: notifications.hydrateHeader,
    invalidateHeader: notifications.invalidateHeader,
    invalidatePublishedWorkweeks: workweekCalendars.invalidatePublishedWorkweeks,
    invalidateWorkweekCalendarAuthority: workweekCalendars.invalidateAuthority,
    invalidateNotificationAuthority: notifications.invalidateNotificationAuthority,
    acceptHydration,
    acceptTaskDetailHydration,
    sessionChanged,
    bindSession,
    acceptDecisionLogHydration: decisionLog.hydrate,
    suspendProtected,
    endSession,
    retire: () => {
      deferNotifications = true;
      try { endSession(); } finally { deferNotifications = false; }
    },
    dispose: () => { clearBacklogSupport(); selectedBacklogRead?.controller.abort(); candidateReads.clear(); administration.clear(); unsubscribeSession?.(); },
  } };
}
