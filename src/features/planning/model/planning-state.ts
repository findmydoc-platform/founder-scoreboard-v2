import type { PrivateWorkweekPlanningState } from "@/features/team-workweek/model/private-workweek-planning-state";
import type { PublishedWorkweekCalendars } from "@/features/team-workweek/model/published-workweek-calendar-state";
import type { Task, TaskComment, TaskExternalComment, TaskBlocker, TaskRelation, TaskActivity, TaskReview } from "@/lib/types";
import type { AppWorkspace } from "./workspace-routes";
import type { TaskUpdateResult } from "@/features/tasks/hooks/task-mutation-command-types";

export type PlanningTaskEditorView = {
  phase: "editing" | "saving" | "saved" | "conflict" | "rejected" | "unconfirmed" | "blocked" | "ended";
  submitted: Readonly<Partial<Task>> | null;
  serverTask: Task | null;
  error: string;
  canResave: boolean;
};
export interface PlanningTaskEditor {
  view(): PlanningTaskEditorView;
  save(patch: Partial<Task>): Promise<TaskUpdateResult>;
  refreshConflict(): Promise<boolean>;
  resave(patch: Partial<Task>): Promise<TaskUpdateResult>;
  checkOutcome(): Promise<PlanningTaskSaveCheck>;
  close(): void;
}

export type PlanningTaskSaveView = {
  phase: "saving" | "queued" | "unconfirmed" | "blocked";
  submitted: Readonly<Partial<Task>> | null;
  checkStatus: "not-checked" | "checking" | "checked" | "unavailable" | "forbidden";
  serverTask: Task | null;
};
export type PlanningTaskSaveCheck = {
  outcome: "unconfirmed" | "not-pending" | "session-ended";
  readStatus: PlanningReadStatus | "not-needed";
};
export type PlanningTaskSaveStatus = "saved" | "saving" | "rejected" | "unconfirmed";
export type PlanningBoardView = { tasks: readonly Task[]; freshness: "current" | "stale" };
export type PlanningReadStatus = "not-loaded" | "loading" | "current" | "stale" | "unavailable" | "forbidden";
export type PlanningTaskDetailView = {
  task: Task | null;
  saveStatus: PlanningTaskSaveStatus;
  readStatus: PlanningReadStatus;
  unavailable: readonly import("@/features/tasks/model/task-detail-read-model").TaskDetailUnavailableArea[];
  comments: readonly TaskComment[];
  externalComments: readonly TaskExternalComment[];
  blockers: readonly TaskBlocker[];
  relationships: readonly TaskRelation[];
  activities: readonly TaskActivity[];
  reviews: readonly TaskReview[];
};

export type PlanningWorkspaceView = {
  tasks: readonly Task[];
  readStatus: PlanningReadStatus;
  completeness: "complete" | "partial" | "none";
};
import type { PlanningToolsState } from "@/features/tools/model/tool-state";
import type { PlanningEventsState } from "@/features/events/model/event-state";
import type { PlanningNotificationsState } from "./planning-notifications-state";

export type PlanningConfirmedSnapshot = { readonly [Key in "tasks" | "profiles" | "sprints" | "notificationPreferences" | "profileUiPreferences" | "profileFeatureTourAcknowledgements"]: import("@/lib/types").PlanningShellState[Key] extends readonly (infer Item)[] ? readonly Readonly<Item>[] : Readonly<import("@/lib/types").PlanningShellState[Key]> };

export interface PlanningState extends PrivateWorkweekPlanningState, PublishedWorkweekCalendars, PlanningNotificationsState, PlanningEventsState, PlanningToolsState {
  beginBacklogOrder(tasks: readonly Task[]): import("@/features/backlog/model/backlog-ordering").BacklogOrderEditor;
  backlogOrders(): readonly import("@/features/backlog/model/backlog-ordering").BacklogOrderView[];
  resumeBacklogOrder(id: string): import("@/features/backlog/model/backlog-ordering").BacklogOrderEditor | null;
  beginBacklogAssignment(tasks: readonly Task[], sprints: readonly import("@/lib/types").Sprint[], bulk: boolean): import("@/features/backlog/model/backlog-assignment").BacklogAssignmentEditor;
  backlogAssignments(): readonly import("@/features/backlog/model/backlog-assignment").BacklogAssignmentView[];
  resumeBacklogAssignment(id: string): import("@/features/backlog/model/backlog-assignment").BacklogAssignmentEditor | null;
  backlog(): { model: import("@/features/backlog/model/backlog-read-model").BacklogModel; readStatus: PlanningReadStatus };
  beginSprintLock(sprint: import("@/lib/types").Sprint, tasks: readonly Task[]): import("@/features/sprint/model/sprint-lock").SprintLockEditor;
  sprintLocks(sprintId: string): readonly import("@/features/sprint/model/sprint-lock").SprintLockView[];
  resumeSprintLock(sprintId: string): import("@/features/sprint/model/sprint-lock").SprintLockEditor | null;

  sprintPlan(): import("@/features/sprint/model/sprint-plan").SprintPlanView;
  checkSprintPlan(): Promise<PlanningTaskSaveCheck>;
  resumeSprintPlan(): import("@/features/sprint/model/sprint-plan").SprintPlanEditor | null;
  beginSprintPlan(): import("@/features/sprint/model/sprint-plan").SprintPlanEditor;
  checkReviewWindowSave(): Promise<PlanningTaskSaveCheck>;
  reviewWindow(): import("@/features/sprint/model/review-window-editing").ReviewWindowView;
  resumeReviewWindowEdit(): import("@/features/sprint/model/review-window-editing").ReviewWindowEditor | null;
  beginReviewWindowEdit(displayedHours: number): import("@/features/sprint/model/review-window-editing").ReviewWindowEditor;
  sprintWorkspace(): { model: import("@/features/sprint/model/sprint-read-model").SprintWorkspaceModel & { coverage: import("@/features/sprint/model/sprint-read-model").SprintReadCoverage }; readStatus: PlanningReadStatus };
  checkSprintSave(sprintId: string): Promise<PlanningTaskSaveCheck>;
  sprintEdits(sprintId: string): readonly import("@/features/sprint/model/sprint-editing").SprintEditorView[];
  beginSprintEdit(sprint: import("@/lib/types").Sprint): import("@/features/sprint/model/sprint-editing").SprintEditor;
  createTask(input: import("./planning-task-lifecycle").PlanningTaskCreationInput): Promise<import("./planning-task-lifecycle").PlanningTaskCreationResult>;
  withdrawTask(task: Task, reason: string): Promise<import("./planning-task-lifecycle").PlanningTaskRemovalResult>;
  rejectTask(task: Task, reason: string): Promise<import("./planning-task-lifecycle").PlanningTaskRemovalResult>;
  checkTaskLifecycle(id: string): Promise<PlanningTaskSaveCheck>;
  taskLifecycle(): readonly import("./planning-task-lifecycle").PlanningTaskLifecycleView[];
  beginOwnProfileEdit(shown: import("@/features/profile/model/profile-settings-contract").OwnProfileEditingSnapshot): import("@/features/profile/model/profile-settings-contract").OwnProfileEditor;
  beginTeamProfileEdit(shown: import("@/lib/types").Profile): import("./planning-team-state").TeamProfileEditor;
  team(): import("./planning-team-state").PlanningTeamView;
  saveTeamProfile(profileId: string, patch: import("./planning-team-state").TeamProfilePatch): Promise<import("./planning-team-state").TeamProfileResult>;
  checkTeamProfile(profileId: string): Promise<boolean>;
  profileApiTokens(): import("@/features/profile/model/profile-api-token-state").ProfileApiTokensView;
  loadProfileApiTokens(): Promise<boolean>;
  issueProfileApiToken(draft: import("@/features/profile/model/profile-api-token-state").ProfileApiTokenDraft): Promise<import("@/features/profile/model/profile-api-token-state").ProfileApiTokenIssueResult>;
  revokeProfileApiToken(tokenId: string): Promise<import("@/features/profile/model/profile-settings-contract").ProfileSettingsResult>;
  acknowledgeFeatureTour(profileId: string, tourId: string): Promise<import("@/features/profile/model/profile-settings-contract").ProfileSettingsResult>;
  checkOwnProfileSettings(profileId: string): Promise<boolean>;
  profileSettings(profileId: string): import("@/features/profile/model/profile-settings-contract").ProfileSettingsView;
  saveOwnProfileSettings(profileId: string, patch: import("@/features/profile/model/profile-settings-contract").OwnProfileSettingsPatch): Promise<import("@/features/profile/model/profile-settings-contract").ProfileSettingsResult>;
  board(): PlanningBoardView;
  workspace(workspace: AppWorkspace): PlanningWorkspaceView;
  taskDetail(taskId: string): PlanningTaskDetailView;
  protectedCache(workspace?: AppWorkspace): PlanningConfirmedSnapshot | null;
  subscribe(listener: () => void): () => void;
  taskSaves(taskId: string): readonly PlanningTaskSaveView[];
  checkTaskSave(taskId: string): Promise<PlanningTaskSaveCheck>;
  taskEdits(taskId: string): readonly PlanningTaskEditorView[];
  beginTaskEdit(task: Task | string): PlanningTaskEditor;
  saveTask(task: Task, patch: Partial<Task>): Promise<TaskUpdateResult>;
  loadTaskDetail(taskId: string): Promise<{ ok: boolean; error?: string; unavailable?: import("@/features/tasks/model/task-detail-read-model").TaskDetailUnavailableArea[] }>;
  refreshWorkspace(workspace: AppWorkspace): Promise<boolean>;
}
