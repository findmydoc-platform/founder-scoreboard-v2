import { readSupabaseSchemaContract } from "../scripts/lib/supabase-migrations.mjs";
import { readFile } from "node:fs/promises";
import { assertFileContracts } from "./helpers/contract-assertions.mjs";
import { readFeatureSurface, readPlanningSurface } from "./helpers/planning-surface.mjs";
import test from "node:test";
import assert from "node:assert/strict";

test("dev role switch is local-only and flows through API authorization", async () => {
  const authz = await readFile("src/lib/authz.ts", "utf8");
  const ui = await readPlanningSurface();
  const requestContext = await readFile("src/features/planning/hooks/use-planning-request-context.ts", "utf8");
  const browserApiClient = await readFile("src/lib/browser-api-client.ts", "utf8");
  const devSwitch = await readFile("src/features/planning/molecules/dev-role-switch.tsx", "utf8");

  assert.match(authz, /x-fmd-dev-profile-id/);
  assert.match(authz, /process\.env\.NODE_ENV === "production"/);
  assert.match(authz, /localhost\|127\\\.0\\\.0\\\.1\|\\\[::1\\\]/);
  assert.match(authz, /isOperationalLeadRole\(profile\.platform_role\)/);
  assert.match(ui, /DevRoleSwitch/);
  assert.match(ui, /usePlanningRequestContext/);
  assert.match(devSwitch, /Dev-Ansicht/);
  assert.match(devSwitch, /roleLabel\(effectiveProfile\)/);
  assert.match(requestContext, /createBrowserApiClient/);
  assert.match(browserApiClient, /x-fmd-dev-profile-id/);
  assert.match(requestContext, /devProfileStateKey/);
  assert.match(requestContext, /process\.env\.NODE_ENV !== "production"/);
  assert.match(requestContext, /isLocalDevHost\(\)/);
});

test("workflow logic hot spots are delegated to feature-local hooks", async () => {
  await assertFileContracts([
    {
      label: "task detail page shell",
      path: "src/features/tasks/templates/task-detail-page.tsx",
      matches: [/usePlanningAppController/, /PlanningOverlayLayer/, /TaskDetailSurface/],
      excludes: [/createBrowserApiClient|updateTaskRequest|syncTaskToGitHubRequest|useTaskComments|useTaskRelationships|useTransition/],
    },
    {
      label: "task detail workflow hook",
      path: "src/features/tasks/hooks/use-task-detail-workflow.ts",
      matches: [/createBrowserApiClient/, /updateTaskRequest/, /syncTaskToGitHubRequest/, /useTaskComments/, /useTaskRelationships/, /taskUpdateRequestPayload/],
    },
    {
      label: "team overview shell",
      path: "src/features/team/organisms/team-overview.tsx",
      matches: [/useTeamProfileDrafts/, /useTeamProfileDialog/, /TeamMemberCard/, /TeamProfileEditDialog/],
      excludes: [/useState|setDrafts|profileDraftFields|sameProfileValue/],
    },
    {
      label: "team profile draft hook",
      path: "src/features/team/hooks/use-team-profile-drafts.ts",
      matches: [/onSaveProfileSettings/, /saveProfileDraft/],
      excludes: [/setNotificationDraft|draftEventEnabled|notificationEvents/],
    },
    {
      label: "team profile view model",
      path: "src/features/team/model/team-profile-view-model.ts",
      matches: [/profileHasDraftChanges/, /activeDeputyProfiles/],
    },
  ]);
});

test("planning app controller delegates command domains and stays a thin composer", async () => {
  const controller = await readFile("src/features/planning/hooks/use-planning-app-controller.ts", "utf8");
  const bootstrapState = await readFile("src/features/planning/hooks/use-planning-bootstrap-state.ts", "utf8");
  const headerDataHook = await readFile("src/features/planning/hooks/use-planning-header-data.ts", "utf8");
  const derivedState = await readFile("src/features/planning/hooks/use-planning-derived-state.ts", "utf8");
  const commandRegistry = await readFile("src/features/planning/hooks/use-planning-command-registry.ts", "utf8");

  assert.ok(controller.split(/\r?\n/).length < 500);
  assert.match(bootstrapState, /usePlanningHeaderData/);
  assert.match(headerDataHook, /projectPlanningHeaderData\(data, baseHeaderData/);
  assert.match(headerDataHook, /fmdToolsLoaded: source === "seed" \|\| workspace === "tools"/);
  assert.match(headerDataHook, /eventsLoaded: source === "seed" \|\| workspace === "events"/);
  assert.match(headerDataHook, /notificationEventsLoaded: source === "seed" \|\| workspace === "notifications"/);
  assert.match(headerDataHook, /idlePlanningHeaderSlots/);
  assert.match(headerDataHook, /requestPlanningHeaderData/);
  await assertFileContracts([
    {
      label: "planning app controller",
      source: controller,
      matches: [
        /usePlanningBootstrapState/,
        /usePlanningCommandRegistry/,
        /usePlanningDerivedState/,
        /usePlanningTaskSelection/,
        /useTaskDetailDataLoader/,
      ],
      excludes: [
        /planningApi\.|taskApi\./,
        /updateTaskRequest|createTaskRequest|withdrawTaskRequest|syncTaskToGitHubRequest/,
        /updateMeetingAttendanceRequest|lockSprintRequest/,
        /runNotificationDeliveryRequest|setProtectedPlanningDataCache/,
        /persistLocalPlanningTasks|window\.confirm|event\.dataTransfer\.setData/,
        /window\.history\.length|addEventListener\("keydown"/,
      ],
    },
    {
      label: "planning bootstrap state",
      source: bootstrapState,
      matches: [
        /usePlanningAuth/,
        /usePlanningDataRefresh/,
        /usePlanningRequestContext/,
        /usePlanningViewState/,
        /usePlanningWorkspace/,
      ],
    },
    {
      label: "planning derived state",
      source: derivedState,
      matches: [/usePlanningHeaderActions/, /usePlanningTaskViewModel/],
    },
    {
      label: "planning command registry",
      source: commandRegistry,
      matches: [
        /useTaskMutationCommands/,
        /useTaskCollaborationCommands/,
        /useMilestoneCommands/,
        /useWeeklyAttendanceCommands/,
        /useSprintCommands/,
        /useNotificationCommands/,
        /useDemoSeedImport/,
      ],
      excludes: [
        /planningApi\.|taskApi\./,
        /updateTaskRequest|createTaskRequest|withdrawTaskRequest|syncTaskToGitHubRequest/,
        /updateMeetingAttendanceRequest|lockSprintRequest/,
        /runNotificationDeliveryRequest|setProtectedPlanningDataCache/,
        /persistLocalPlanningTasks|window\.confirm|event\.dataTransfer\.setData/,
        /window\.history\.length|addEventListener\("keydown"/,
      ],
    },
    {
      label: "task mutation commands",
      path: "src/features/tasks/hooks/use-task-mutation-commands.ts",
      matches: [/useTaskGitHubSyncCommand/, /useTaskUpdateCommand/, /useTaskCreateCommand/, /useTaskWithdrawCommand/],
      excludes: [/updateTaskRequest|createTaskRequest|syncTaskToGitHubRequest|withdrawTaskRequest|persistLocalPlanningTasks|window\.confirm/],
    },
    {
      label: "task github sync command",
      path: "src/features/tasks/hooks/use-task-github-sync-command.ts",
      matches: [/syncTaskToGitHubRequest/, /syncLinkedGitHubTasks/, /syncTaskToGitHub/],
    },
    {
      label: "task update command",
      path: "src/features/tasks/hooks/use-task-update-command.ts",
      matches: [/updateTaskRequest/, /persistLocalPlanningTasks/, /buildClientTaskUpdatePatch/],
    },
    {
      label: "task create command",
      path: "src/features/tasks/hooks/use-task-create-command.ts",
      matches: [/createTaskRequest/, /applyPlanningDataUpdate/, /setTaskDialogDefaults/, /syncTaskToGitHubRequest/],
    },
    {
      label: "task withdraw command",
      path: "src/features/tasks/hooks/use-task-withdraw-command.ts",
      matches: [/withdrawTaskRequest/, /removePlanningRootFromData/, /restorePlanningRootToData/],
      excludes: [/window\.confirm|deleteTaskRequest/],
    },
    {
      label: "task collaboration commands",
      path: "src/features/tasks/hooks/use-task-collaboration-commands.ts",
      matches: [
        /createTaskCommentRequest/,
        /uploadTaskAttachmentRequest/,
        /importGitHubCommentsRequest/,
        /reportTaskBlockerRequest/,
        /addTaskRelationshipRequest/,
        /removeTaskRelationshipRequest/,
      ],
    },
    {
      label: "planning board state hook",
      path: "src/features/planning/hooks/use-planning-board-state.ts",
      matches: [/event\.dataTransfer\.setData/, /founderTaskAssignmentGuardMessage/],
    },
    {
      label: "planning task selection hook",
      path: "src/features/planning/hooks/use-planning-task-selection.ts",
      matches: [/selectedTaskSubIssues/, /openTaskPanel/, /openReviewSheet/, /setSelectedTaskId\(nextTaskId\)/, /addEventListener\("keydown"/, /pushTaskPanelHistory/, /backTaskPanelHistory/],
      excludes: [/window\.history\.length|router\.back\(\)|router\.push\(`\/tasks/],
    },
    {
      label: "planning data refresh hook",
      path: "src/features/planning/hooks/use-planning-data-refresh.ts",
      matches: [/setProtectedPlanningDataCache/, /requestPlanningData\(apiClient, workspace\)/],
    },
    {
      label: "planning task table view model",
      path: "src/features/planning/model/planning-task-table-view-model.ts",
      matches: [/hasOpenWaitingRelation/],
    },
    { label: "initiative commands", path: "src/features/projects/hooks/use-initiative-commands.ts", matches: [/saveInitiativeRequest/] },
    { label: "sprint commands", path: "src/features/sprint/hooks/use-sprint-commands.ts", matches: [/lockSprintRequest/, /createScoreObjectionRequest/] },
    { label: "profile commands", path: "src/features/team/hooks/use-profile-settings-commands.ts", matches: [/updateProfileRequest/] },
    { label: "weekly attendance commands", path: "src/features/sprint/hooks/use-weekly-attendance-commands.ts", matches: [/updateMeetingAttendanceRequest/] },
    { label: "event commands", path: "src/features/events/hooks/use-founder-event-commands.ts", matches: [/createFounderEventRequest/] },
    { label: "review commands", path: "src/features/reviews/hooks/use-review-commands.ts", matches: [/reviewTaskRequest/] },
    { label: "notification commands", path: "src/features/planning/hooks/use-notification-commands.ts", matches: [/runNotificationDeliveryRequest/] },
  ]);
});

test("task mutation contract centralizes update normalization and route patches", async () => {
  const contract = await readFile("src/features/tasks/model/task-mutation-contract.ts", "utf8");
  const taskUpdateCommand = await readFile("src/features/tasks/hooks/use-task-update-command.ts", "utf8");
  const route = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const migration = await readSupabaseSchemaContract();
  const verifySupabase = await readFile("scripts/verify-supabase.mjs", "utf8");
  const updateRoute = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const updateRouteHelpers = await readFile("src/features/tasks/model/task-route-update-helpers.ts", "utf8");
  const updateRoutePolicy = `${updateRoute}\n${updateRouteHelpers}`;

  assert.match(contract, /export function buildClientTaskUpdatePatch/);
  assert.match(contract, /export function taskUpdateRequestPayload/);
  assert.match(contract, /export function buildTaskUpdateResponsePatch/);
  assert.match(contract, /export function activityMessages/);
  assert.match(contract, /export function taskAssignedToProfile/);
  assert.match(contract, /Final bewertete Aufgaben können nicht erneut in Review gegeben werden/);

  assert.match(taskUpdateCommand, /buildClientTaskUpdatePatch/);
  assert.match(taskUpdateCommand, /taskUpdateRequestPayload/);
  assert.match(taskUpdateCommand, /latestMutationByTask/);
  assert.match(taskUpdateCommand, /refreshPlanningData/);
  assert.match(route, /update_planning_task_transaction/);
  assert.match(route, /p_expected_updated_at: payload\.expectedUpdatedAt/);
  assert.doesNotMatch(route, /\.from\("task_notes"\)[\s\S]*\.upsert/);
  assert.doesNotMatch(route, /\.from\("task_dependencies"\)\.delete/);
  assert.match(migration, /task\.updated_at = \$3/);
  assert.match(migration, /task_notes/);
  assert.match(migration, /task_dependencies/);
  assert.match(migration, /task_activity/);
  assert.match(migration, /notification_events/);
  assert.match(migration, /grant all on function public\.update_task_transaction[^]*to service_role/);
  assert.match(verifySupabase, /verifyTaskUpdateRpc/);
  assert.doesNotMatch(taskUpdateCommand, /taskAssigneePatch/);

  assert.match(updateRoute, /buildTaskUpdateResponsePatch/);
  assert.match(updateRoute, /activityMessages/);
  assert.match(updateRoutePolicy, /taskAssignedToProfile/);
  assert.doesNotMatch(updateRoute, /function activityMessages/);
  assert.doesNotMatch(updateRoute, /function taskAssignedToProfile/);
  assert.doesNotMatch(updateRoute, /function profileId/);
});

test("planning data loader separates query loading from public orchestration", async () => {
  const data = await readFile("src/lib/planning-data.ts", "utf8");
  const headerData = await readFile("src/lib/planning-header-data.ts", "utf8");
  const loader = await readFile("src/lib/planning-data-loader.ts", "utf8");
  const headerRoute = await readFile("src/app/api/planning-header-data/route.ts", "utf8");
  const rowTypes = await readFile("src/lib/planning-data-row-types.ts", "utf8");

  assert.match(data, /loadPlanningDataRows/);
  assert.match(data, /loadPlanningHeaderData/);
  assert.match(data, /hasCorePlanningDataError/);
  assert.match(data, /mapPlanningDataRows/);
  assert.doesNotMatch(data, /Promise\.all/);
  assert.doesNotMatch(data, /task_dependencies\(note\), task_notes\(note\)/);

  assert.match(loader, /Promise\.all/);
  assert.match(loader, /founderProjectId/);
  assert.match(loader, /taskRowSelect/);
  assert.doesNotMatch(loader, /select\("\*, task_dependencies\(note\), task_notes\(note\)"\)/);
  assert.match(rowTypes, /export const taskRowColumns/);
  assert.match(rowTypes, /task_dependencies\(note\), task_notes\(note\)/);
  assert.match(loader, /export function hasCorePlanningDataError/);
  assert.match(loader, /export function mapPlanningDataRows/);
  assert.match(loader, /scoreObjections/);
  assert.match(loader, /notificationPreferenceResult/);
  assert.match(headerData, /HeaderDataSlot/);
  assert.match(headerData, /HeaderNotification/);
  assert.match(headerData, /headerQuickLinkSelect = "id,name,category,url,preview_image_url"/);
  assert.match(headerData, /headerCalendarEventSelect = "id,title,category,starts_at,ends_at,location,status"/);
  assert.match(headerData, /headerNotificationSelect = "id,type,actor_profile_id,recipient_profile_id,entity_type,entity_id,title,body,created_at"/);
  assert.match(headerData, /loadPlanningHeaderData/);
  assert.match(headerRoute, /requirePlatformRole\(request, \["ceo", "founder", "deputy", "viewer"\]\)/);
  assert.match(headerRoute, /parsePlanningHeaderSlots/);
  assert.match(headerRoute, /return NextResponse\.json\(\{ headerData \}\)/);
  assert.doesNotMatch(headerData, /description|owner|audience_mode|participant_profile_ids|reminder_days_before/);
});

test("authenticated workspace SSR defers header data to the protected client loader", async () => {
  const page = await readFile("src/app/(workspaces)/workspace-page.tsx", "utf8");
  const data = await readFile("src/lib/planning-data.ts", "utf8");
  const api = await readFile("src/app/api/planning-data/route.ts", "utf8");
  const headerDataHook = await readFile("src/features/planning/hooks/use-planning-header-data.ts", "utf8");

  assert.match(data, /headerData\?: "eager" \| "deferred"/);
  assert.match(data, /options\.headerData === "deferred"[\s\S]*emptyPlanningHeaderData[\s\S]*await loadPlanningHeaderData/);
  assert.match(page, /loadWorkspacePlanningData\(initialWorkspace, auth\.profile, \{[\s\S]*headerData: "deferred"/);
  assert.match(page, /initialHeaderData=\{headerData\}[\s\S]*initialProtectedDataLoaded/);
  assert.doesNotMatch(api, /headerData: "deferred"/);

  assert.match(headerDataHook, /if \(authRequired && !protectedDataLoaded\) return;[\s\S]*if \(!idleSlotKey\) return;/);
  assert.match(headerDataHook, /const requestedSlots = idleSlotKey\.split\(","\) as PlanningHeaderSlotKey\[\]/);
  assert.doesNotMatch(headerDataHook, /idleSlotKey, idleSlots,/);
});

test("task row descriptor covers planning UI mapping fields", async () => {
  const loader = await readFile("src/lib/planning-data-loader.ts", "utf8");
  const rowTypes = await readFile("src/lib/planning-data-row-types.ts", "utf8");
  const profileMappers = await readFile("src/lib/planning-profile-mappers.ts", "utf8");
  const taskMappers = await readFile("src/lib/planning-task-mappers.ts", "utf8");
  const mappers = `${profileMappers}\n${taskMappers}`;

  assert.match(loader, /select\(taskRowSelect\)/);
  assert.match(mappers, /profileNameById/);

  for (const [field, property] of [
    ["owner", "ownerId"],
    ["assignee", "assigneeId"],
    ["created_by", "createdById"],
    ["review_status", "reviewStatus"],
    ["review_owner_profile_id", "reviewOwnerProfileId"],
    ["review_requested_at", "reviewRequestedAt"],
    ["github_repo", "githubRepo"],
    ["github_issue_number", "githubIssueNumber"],
    ["github_issue_url", "githubIssueUrl"],
    ["github_issue_sync_status", "githubIssueSyncStatus"],
    ["github_issue_last_synced_at", "githubIssueLastSyncedAt"],
    ["github_issue_sync_error", "githubIssueSyncError"],
    ["problem_statement", "problemStatement"],
    ["intended_outcome", "intendedOutcome"],
    ["scope_constraints", "scopeConstraints"],
    ["acceptance_criteria", "acceptanceCriteria"],
    ["evidence_required", "evidenceRequired"],
    ["dod_template_version", "dodTemplateVersion"],
    ["original_sprint_id", "originalSprintId"],
    ["carried_from_task_id", "carriedFromTaskId"],
    ["carried_from_sprint_id", "carriedFromSprintId"],
    ["carryover_reason", "carryoverReason"],
    ["carryover_count", "carryoverCount"],
    ["sprint_outcome", "sprintOutcome"],
    ["self_dod_checked", "selfDodChecked"],
    ["self_evidence_checked", "selfEvidenceChecked"],
    ["self_documented_checked", "selfDocumentedChecked"],
    ["self_blockers_checked", "selfBlockersChecked"],
  ]) {
    assert.match(rowTypes, new RegExp(`"${field}"`));
    assert.match(mappers, new RegExp(`\\b${property}\\b`));
  }
});

test("task template v2 separates outcome criteria evidence and DoD", async () => {
  const migration = await readSupabaseSchemaContract();
  const createRoute = await readFile("src/app/api/tasks/route.ts", "utf8");
  const updateRoute = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const updateRouteHelpers = await readFile("src/features/tasks/model/task-route-update-helpers.ts", "utf8");
  const updateRoutePolicy = `${updateRoute}\n${updateRouteHelpers}`;
  const types = await readFile("src/lib/types.ts", "utf8");
  const dataRowTypes = await readFile("src/lib/planning-data-row-types.ts", "utf8");
  const newTaskUi = await readFile("src/features/tasks/organisms/new-task-dialog.tsx", "utf8");
  const detail = await readFile("src/features/tasks/templates/task-detail-page.tsx", "utf8");
  const detailSurface = await readFile("src/features/tasks/organisms/task-detail-surface.tsx", "utf8");
  const overviewPanel = await readFile("src/features/tasks/organisms/task-overview-panel.tsx", "utf8");
  const docs = await readFile("docs/task-template-v2.md", "utf8");

  assert.match(migration, /problem_statement/);
  assert.match(migration, /intended_outcome/);
  assert.match(migration, /acceptance_criteria/);
  assert.match(migration, /evidence_required/);
  assert.match(createRoute, /problemStatement/);
  assert.match(updateRoutePolicy, /acceptanceCriteria/);
  assert.match(types, /problemStatement/);
  assert.match(dataRowTypes, /task_dependencies\(note\), task_notes\(note\)/);
  assert.match(dataRowTypes, /problem_statement/);
  assert.match(newTaskUi, /Aufgabenbrief/);
  assert.match(detail, /TaskDetailSurface/);
  assert.match(detailSurface, /TaskOverviewPanel/);
  assert.match(overviewPanel, /Problem/);
  assert.match(overviewPanel, /Zielbild/);
  assert.match(overviewPanel, /Abnahmekriterien/);
  assert.match(overviewPanel, /Erforderlicher Nachweis/);
  assert.match(overviewPanel, /Nachweis/);
  assert.match(overviewPanel, /Qualitätsstandard/);
  assert.match(docs, /Nicht mit Acceptance Criteria vermischen/);
});

test("strict auth gates planning data until a valid session is present", async () => {
  const page = await readFile("src/app/(workspaces)/workspace-page.tsx", "utf8");
  const api = await readFile("src/app/api/planning-data/route.ts", "utf8");
  const authz = await readFile("src/lib/authz.ts", "utf8");
  const serverAuth = await readFile("src/lib/planning-auth-server.ts", "utf8");
  const ui = await readPlanningSurface();
  const authHook = await readFile("src/features/planning/hooks/use-planning-auth.ts", "utf8");
  const authControl = await readFile("src/features/settings/organisms/auth-control.tsx", "utf8");

  assert.match(page, /requiresSupabaseAuth\(\)/);
  assert.match(page, /getServerPlanningAuth/);
  assert.match(page, /emptyPlanningData/);
  assert.match(page, /emptyPlanningHeaderData/);
  assert.match(page, /initialHeaderData/);
  assert.match(page, /initialProtectedDataLoaded/);
  assert.match(api, /requirePlatformRole\(request, \["ceo", "founder", "deputy", "viewer"\]\)/);
  assert.match(api, /currentProfile: auth\.profile/);
  assert.match(api, /result\.availability === "unavailable"/);
  assert.match(api, /planningDataUnavailableMessage, 503/);
  assert.match(page, /PlanningDataUnavailablePage/);
  assert.match(authz, /auth_user_id/);
  assert.match(authz, /ilike\("github_login", githubLogin\)/);
  assert.match(serverAuth, /requirePlatformRoleForUser/);
  assert.match(authz, /unterschiedliche Teamprofile/);
  assert.doesNotMatch(authz, /\.or\(`auth_user_id/);
  assert.match(authHook, /Du bist abgemeldet/);
  assert.match(authHook, /serverCurrentProfile/);
  assert.match(authHook, /initialAuthUser/);
  assert.match(authHook, /authUserId/);
  assert.match(authHook, /setHeaderData/);
  assert.match(authHook, /safeInitialHeaderData/);
  assert.match(ui, /<AppBrand \/>/);
  assert.match(ui, /PlanningBootShell/);
  assert.doesNotMatch(ui, /ShieldCheck/);
  assert.match(ui, /variant="gate"/);
  assert.match(authControl, /Rollen und Zugriff werden nach dem Login/);
  assert.match(authControl, /Mit GitHub anmelden/);
  assert.doesNotMatch(authControl, /GitHub-Rechte fehlen/);
  assert.doesNotMatch(authControl, /Login öffnen/);
  assert.match(authHook, /supabase\.auth\.signOut\(\{ scope: "global" \}\)/);
  assert.match(authHook, /\/api\/planning-data\?workspace=\$\{encodeURIComponent\(workspace\)\}/);
});

test("workspace loading shells are route-specific and data-free", async () => {
  const shell = await readFile("src/features/planning/templates/workspace-loading-shell.tsx", "utf8");
  const backlogSkeleton = await readFile("src/features/backlog/organisms/backlog-content-skeleton.tsx", "utf8");
  const renderer = await readFile("src/features/planning/organisms/planning-workspace-renderer.tsx", "utf8");
  const groupLoading = await readFile("src/app/(workspaces)/loading.tsx", "utf8");
  const backlogLoading = await readFile("src/app/(workspaces)/backlog/loading.tsx", "utf8");
  const planningLoading = await readFile("src/app/(workspaces)/planning/loading.tsx", "utf8");
  const reviewsLoading = await readFile("src/app/(workspaces)/reviews/loading.tsx", "utf8");
  const eventsLoading = await readFile("src/app/(workspaces)/events/loading.tsx", "utf8");
  const sprintLoading = await readFile("src/app/(workspaces)/sprint/loading.tsx", "utf8");
  const projectsLoading = await readFile("src/app/(workspaces)/projects/loading.tsx", "utf8");
  const toolsLoading = await readFile("src/app/(workspaces)/tools/loading.tsx", "utf8");
  const teamLoading = await readFile("src/app/(workspaces)/team/loading.tsx", "utf8");
  const notificationsLoading = await readFile("src/app/(workspaces)/notifications/loading.tsx", "utf8");
  const ceoIntakeLoading = await readFile("src/app/(workspaces)/ceo-intake/loading.tsx", "utf8");
  const profileLoading = await readFile("src/app/(workspaces)/profile/loading.tsx", "utf8");
  const reviewDetailLoading = await readFile("src/app/reviews/[id]/loading.tsx", "utf8");
  const taskDetailLoading = await readFile("src/app/tasks/[id]/loading.tsx", "utf8");

  assert.match(shell, /export function WorkspaceLoadingShell/);
  assert.match(shell, /export function WorkspaceContentSkeleton/);
  assert.match(shell, /function PlanningContentSkeleton/);
  assert.match(shell, /BacklogContentSkeleton/);
  assert.match(backlogSkeleton, /export function BacklogContentSkeleton/);
  assert.match(backlogSkeleton, /overflow-x-auto/);
  assert.doesNotMatch(backlogSkeleton, /overflow-x-scroll/);
  assert.match(shell, /function ReviewContentSkeleton/);
  assert.match(shell, /function EventsContentSkeleton/);
  assert.match(shell, /function GenericWorkspaceSkeleton/);
  assert.match(shell, /function DetailContentSkeleton/);
  assert.match(shell, /variant === "review-detail" \|\| variant === "task-detail"/);
  assert.doesNotMatch(shell, /PlanningData|getPlanningData|emptyPlanningData|data\.tasks|authUser|provider_token/);

  assert.match(groupLoading, /WorkspaceLoadingShell workspace="planning" variant="planning"/);
  assert.match(backlogLoading, /WorkspaceLoadingShell workspace="backlog" variant="backlog"/);
  assert.match(planningLoading, /WorkspaceLoadingShell workspace="planning" variant="planning"/);
  assert.match(reviewsLoading, /WorkspaceLoadingShell workspace="reviews" variant="reviews"/);
  assert.match(eventsLoading, /WorkspaceLoadingShell workspace="events" variant="events"/);
  assert.match(sprintLoading, /WorkspaceLoadingShell workspace="sprint" variant="sprint"/);
  assert.match(projectsLoading, /WorkspaceLoadingShell workspace="projects" variant="projects"/);
  assert.match(toolsLoading, /WorkspaceLoadingShell workspace="tools" variant="tools"/);
  assert.match(teamLoading, /WorkspaceLoadingShell workspace="team" variant="team"/);
  assert.match(notificationsLoading, /WorkspaceLoadingShell workspace="notifications" variant="notifications"/);
  assert.match(ceoIntakeLoading, /WorkspaceLoadingShell workspace="ceo-intake" variant="ceo-intake"/);
  assert.match(profileLoading, /WorkspaceLoadingShell workspace="profile" variant="profile"/);
  assert.match(reviewDetailLoading, /WorkspaceLoadingShell workspace="reviews" variant="review-detail"/);
  assert.match(taskDetailLoading, /WorkspaceLoadingShell workspace="planning" variant="task-detail"/);

  assert.match(renderer, /WorkspaceContentSkeleton/);
  assert.match(renderer, /BacklogWorkspacePanelLoading/);
  assert.match(renderer, /EventsWorkspacePanelLoading/);
  assert.match(renderer, /ReviewsWorkspacePanelLoading/);
  assert.match(renderer, /GenericWorkspacePanelLoading/);
  assert.doesNotMatch(renderer, /function WorkspacePanelLoading|const WorkspacePanelLoading/);
});

test("task review uses accountable reviewer route and keeps rework non-final", async () => {
  const route = await readFile("src/app/api/tasks/[id]/review/route.ts", "utf8");
  const taskRoute = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const createTaskRoute = await readFile("src/app/api/tasks/route.ts", "utf8");
  const taskInsertRow = await readFile("src/lib/task-insert-row.ts", "utf8");
  const createTaskContract = `${createTaskRoute}\n${taskInsertRow}`;
  const authz = await readFile("src/lib/authz.ts", "utf8");
  const migration = await readSupabaseSchemaContract();
  const backfillMigration = await readSupabaseSchemaContract();
  const plannedOwnerBackfillMigration = await readSupabaseSchemaContract();
  const reviewTransactionMigration = await readSupabaseSchemaContract();
  const sprintUi = await readFeatureSurface("src/features/sprint");
  const reviewSheet = await readFile("src/features/reviews/organisms/task-review-sheet.tsx", "utf8");
  const appUi = await readPlanningSurface();
  const sprintViewModel = await readFile("src/features/sprint/model/sprint-score-view-model.ts", "utf8");

  assert.match(migration, /review_owner_profile_id/);
  assert.match(migration, /review_requested_at/);
  assert.match(backfillMigration, /review_owner_profile_id/);
  assert.match(plannedOwnerBackfillMigration, /review_owner_profile_id/);
  assert.match(authz, /requireTaskReviewer/);
  assert.match(authz, /review_owner_profile_id/);
  assert.match(createTaskRoute, /reviewOwnerProfileId/);
  assert.match(createTaskContract, /review_owner_profile_id: input\.reviewOwnerProfileId \|\| null/);
  assert.match(createTaskRoute, /accountable_profile_id/);
  assert.match(taskRoute, /accountable_profile_id/);
  assert.match(taskRoute, /update\.review_owner_profile_id/);
  assert.match(taskRoute, /Nur der CEO kann den Review Owner ändern/);
  assert.match(taskRoute, /payload\.reviewOwnerProfileId !== undefined && !canSetReviewOwner && !startsReviewRequest/);
  assert.match(taskRoute, /requestedReviewOwnerProfileId = canSetReviewOwner/);
  assert.match(taskRoute, /task\.review_requested/);
  assert.match(taskRoute, /recipientProfileId: recipient\.id/);
  assert.match(taskRoute, /deine Accountable-Review/);
  assert.match(appUi, /openReviewSheet/);
  assert.match(sprintUi, /focusedReviewTaskId/);
  assert.match(sprintUi, /selectReviewTask\(focusedReviewTaskId\)/);
  assert.match(sprintUi, /accountable-review-sheet/);
  assert.match(sprintUi, /scrollIntoView/);
  assert.match(sprintUi, /TaskReviewSheet/);
  assert.match(sprintUi, /onReopenReview/);
  assert.match(route, /review_owner_profile_id/);
  assert.doesNotMatch(route, /review_owner_profile_id: null/);
  assert.doesNotMatch(route, /reviewOwnerProfileId: ""/);
  assert.match(route, /requireTaskReviewer/);
  assert.match(route, /requirePlanningContributor/);
  assert.match(route, /review_task_transaction/);
  assert.match(reviewTransactionMigration, /insert into public\.task_reviews/);
  assert.match(reviewTransactionMigration, /public\.update_task_transaction/);
  assert.match(reviewTransactionMigration, /insert into public\.audit_log/);
  assert.match(reviewTransactionMigration, /for update/);
  assert.match(reviewTransactionMigration, /revoke all on function public\.review_task_transaction[^]*from public/);
  assert.match(reviewTransactionMigration, /grant all on function public\.review_task_transaction[^]*to service_role/);
  assert.doesNotMatch(route, /from\("task_reviews"\)\.insert/);
  assert.match(route, /scoreFinal = decision !== "changes_requested"/);
  assert.match(route, /const points = reviewDecisionPoints\(decision, checklist\)/);
  assert.match(route, /github_issue_sync_status: "not_synced"/);
  assert.match(route, /Nacharbeit/);
  assert.match(route, /checklist/);
  assert.match(route, /acceptanceCriteriaMet/);
  assert.match(sprintViewModel, /Abnahmekriterien erfüllt/);
  assert.match(sprintUi, /Status \/ Review/);
  assert.match(sprintUi, /Score/);
  assert.match(sprintUi, /Risiko/);
  assert.match(appUi, /Nächster Schritt/);
  assert.match(reviewSheet, /Nachweis \/ Abhängigkeiten/);
  assert.match(reviewSheet, /Qualitätsstandard/);
  assert.match(route, /Sprint-Score ist bereits gelockt/);
});

test("review workspace has direct review detail routes filters and reopen guard", async () => {
  const routes = await readFile("src/features/planning/model/workspace-routes.ts", "utf8");
  const app = await readPlanningSurface();
  const workspace = await readFile("src/features/reviews/organisms/review-workspace-overview.tsx", "utf8");
  const detail = await readFile("src/features/reviews/templates/review-detail-page.tsx", "utf8");
  const sheet = await readFile("src/features/reviews/organisms/task-review-sheet.tsx", "utf8");
  const model = await readFile("src/features/reviews/model/review-workspace-view-model.ts", "utf8");
  const reviewRoute = await readFile("src/app/reviews/[id]/page.tsx", "utf8");
  const reopenRoute = await readFile("src/app/api/tasks/[id]/review/reopen/route.ts", "utf8");
  const taskApiClient = await readFile("src/features/tasks/model/task-api-client.ts", "utf8");

  assert.match(routes, /id: "reviews"/);
  assert.match(routes, /label: "Reviews"/);
  assert.match(routes, /href: "\/reviews"/);
  assert.match(app, /workspace === "reviews"/);
  assert.match(app, /ReviewWorkspaceOverview/);
  assert.match(workspace, /namespace: "reviews"/);
  assert.match(workspace, /DEFAULT_REVIEW_FILTERS/);
  assert.match(workspace, /FilterToolbar/);
  assert.match(workspace, /DataTableFrame/);
  assert.match(app, /initialReviewTaskId/);
  assert.match(app, /ReviewDetailPage/);
  assert.match(app, /reopenReviewTask/);
  assert.match(taskApiClient, /\/api\/tasks\/\$\{taskId\}\/review\/reopen/);
  assert.match(model, /label: "Meine"/);
  assert.match(model, /label: "Offen"/);
  assert.match(model, /label: "Abgeschlossen"/);
  assert.match(model, /label: "Nacharbeit"/);
  assert.match(model, /label: "Geblockt"/);
  assert.match(workspace, /metrics\.total \? "Keine Reviews für diese Filter\."/);
  assert.match(workspace, /Noch keine Reviews/);
  assert.match(workspace, /href="\/sprint"/);
  assert.match(workspace, /\/reviews\/\$\{encodeURIComponent\(task\.id\)\}/);
  assert.match(detail, /TaskReviewSheet/);
  assert.match(detail, /PlanningHeaderDataActions/);
  assert.match(detail, /Review nicht gefunden/);
  assert.match(detail, /href="\/reviews"/);
  assert.doesNotMatch(detail, /\/\?workspace=reviews/);
  assert.match(sheet, /Review wieder öffnen/);
  assert.match(model, /isOpenReviewTask/);
  assert.match(model, /isCompletedReviewTask/);
  assert.match(model, /isReworkReviewTask/);
  assert.match(model, /isBlockedReviewTask/);
  assert.match(model, /hasOpenWaitingRelation/);
  assert.match(model, /owner === "mine"/);
  assert.match(reviewRoute, /initialReviewTaskId=\{id\}/);
  assert.match(reviewRoute, /requiresSupabaseAuth/);
  assert.match(reopenRoute, /requireTaskReviewer/);
  assert.match(reopenRoute, /review_status: "requested"/);
  assert.match(reopenRoute, /score_final: false/);
  assert.match(reopenRoute, /status: "Review"/);
  assert.match(reopenRoute, /task\.review_owner_profile_id/);
  assert.match(reopenRoute, /task\.review\.reopen/);
});

test("founderops v2.1 computes 20 point sprint scores strikes and objections", async () => {
  const scoring = await readFile("src/lib/founderops-scoring.ts", "utf8");
  const migration = await readSupabaseSchemaContract();
  const route = await readFile("src/app/api/sprints/[id]/lock/route.ts", "utf8");
  const finalizationMigration = await readSupabaseSchemaContract();
  const objectionResolutionMigration = await readSupabaseSchemaContract();
  const objectionRoute = await readFile("src/app/api/sprints/[id]/score-objections/route.ts", "utf8");
  const ui = await readFeatureSurface("src/features/sprint");
  const meetingUi = await readFile("src/features/sprint/molecules/sprint-meeting-attendance-section.tsx", "utf8");
  const data = await readFile("src/lib/planning-data-loader.ts", "utf8");
  const verify = await readFile("scripts/verify-supabase.mjs", "utf8");

  assert.match(scoring, /deliveryPoints/);
  assert.match(scoring, /formPoints/);
  assert.match(scoring, /weeklyPoints/);
  assert.match(scoring, /total >= 12/);
  assert.match(scoring, /commitment\?\.commitmentLevel === "Away"/);
  assert.match(scoring, /task\.taskType === "deliverable"/);
  assert.match(scoring, /governance_review_required/);
  assert.match(migration, /create table if not exists founder_sprint_scores/);
  assert.match(migration, /create table if not exists founder_strike_state/);
  assert.match(migration, /create table if not exists strike_events/);
  assert.match(migration, /create table if not exists score_objections/);
  assert.match(route, /computeFounderSprintScore/);
  assert.match(route, /computeStrikeTransition/);
  assert.match(route, /Offene Score-Einwände/);
  assert.match(route, /Reviewfrist läuft noch/);
  assert.match(route, /lock_sprint_transaction/);
  assert.match(finalizationMigration, /founder_sprint_scores/);
  assert.match(finalizationMigration, /founder_strike_state/);
  assert.match(finalizationMigration, /strike_events/);
  assert.match(objectionRoute, /resolve_score_objection_transaction/);
  assert.match(objectionResolutionMigration, /insert into public\.founder_sprint_scores/);
  assert.match(objectionResolutionMigration, /on conflict \(sprint_id, profile_id\) do update/);
  assert.match(objectionResolutionMigration, /second reviewer must differ from first reviewer/);
  assert.match(objectionResolutionMigration, /second review is already complete/);
  assert.match(objectionResolutionMigration, /revoke all on function public\.resolve_score_objection_transaction[^]*from public/);
  assert.match(route, /acceptedAdjustmentByProfile/);
  assert.match(route, /Korrigiert nach angenommenem Score-Einwand/);
  assert.match(ui, /FounderOps Score v2\.1/);
  assert.match(ui, /20 Punkte/);
  assert.match(ui, /Delivery/);
  assert.match(ui, /Form \/ Review-Reife/);
  assert.match(ui, /Weekly/);
  assert.match(ui, /Strike/);
  assert.match(ui, /Score-Einwände/);
  assert.match(ui, /Annehmen & Score aktualisieren/);
  assert.match(ui, /Zweitreview speichern/);
  assert.match(ui, /anderen CEO oder Deputy/);
  assert.match(meetingUi, /Weekly Updates/);
  assert.match(meetingUi, /max\. 2 je Weekly, 4 je Sprint/);
  assert.doesNotMatch(meetingUi, /Biweekly/);
  assert.match(data, /founderSprintScores/);
  assert.match(data, /founderStrikeStates/);
  assert.match(data, /scoreObjections/);
  assert.match(verify, /founder_sprint_scores/);
  assert.match(verify, /strike_events/);
});

test("sprint lock freezes open scores and closes the sprint", async () => {
  const route = await readFile("src/app/api/sprints/[id]/lock/route.ts", "utf8");
  const migration = await readSupabaseSchemaContract();
  const apiClient = await readFile("src/features/planning/model/planning-api-client.ts", "utf8");
  const commands = await readFile("src/features/sprint/hooks/use-sprint-commands.ts", "utf8");

  assert.match(route, /requireOperationalLead/);
  assert.match(route, /score_points: preserveScore \? Number\(task\.score_points \|\| 0\) : 0/);
  assert.match(route, /score_final: true/);
  assert.match(route, /lock_sprint_transaction/);
  assert.match(migration, /sprint\.lock_score/);
  assert.match(migration, /lock_result/);
  assert.match(migration, /'replayed', true/);
  assert.match(migration, /revoke all on function public\.lock_sprint_transaction[^]*from public/);
  assert.match(migration, /grant all on function public\.lock_sprint_transaction[^]*to service_role/);
  assert.match(apiClient, /json: \{ finalizeNow \}/);
  assert.doesNotMatch(apiClient, /json: \{ finalizeNow: true \}/);
  assert.match(commands, /Reviewfrist läuft noch\. Sprint trotzdem jetzt finalisieren/);
  assert.match(commands, /lockSprintRequest\(apiClient, sprintId, finalizeNow\)/);
});

test("sprint lock creates carryover for unfinished deliverables", async () => {
  const migration = await readSupabaseSchemaContract();
  const finalizationMigration = await readSupabaseSchemaContract();
  const route = await readFile("src/app/api/sprints/[id]/lock/route.ts", "utf8");
  const taskInsertRow = await readFile("src/lib/task-insert-row.ts", "utf8");
  const routeContract = `${route}\n${taskInsertRow}`;
  const ui = await readPlanningSurface();
  const panelSidebar = await readFile("src/features/tasks/organisms/task-detail-panel-sidebar.tsx", "utf8");
  const types = await readFile("src/lib/types.ts", "utf8");

  assert.match(migration, /original_sprint_id/);
  assert.match(migration, /carried_from_task_id/);
  assert.match(migration, /sprint_outcome/);
  assert.match(route, /communicated_blocker/);
  assert.match(route, /review_status === "partial"/);
  assert.match(route, /preserveScore/);
  assert.match(route, /deadline: nextSprint\.end_date \|\| null/);
  assert.match(routeContract, /github_issue_number: input\.githubIssueNumber \|\| null/);
  assert.match(route, /missed_uncommunicated/);
  assert.match(finalizationMigration, /accepted_carryover/);
  assert.match(finalizationMigration, /insert into public\.tasks/);
  assert.match(route, /sprint\.task_carried_over/);
  assert.match(panelSidebar, /Sprint-Verlauf/);
  assert.match(ui, /Carry-over/);
  assert.match(types, /carryoverReason/);
});

test("sprint configuration is operational-lead only and audited", async () => {
  const route = await readFile("src/app/api/sprints/[id]/route.ts", "utf8");
  const planRoute = await readFile("src/app/api/sprints/route.ts", "utf8");
  const ui = await readPlanningSurface();
  const sprintUi = await readFeatureSurface("src/features/sprint");
  const notificationsOverviewUi = await readFile("src/features/notifications/organisms/notifications-overview.tsx", "utf8");
  const sprintPlanningUi = await readFile("src/features/sprint/molecules/sprint-planning-section.tsx", "utf8");
  const batchMigration = await readSupabaseSchemaContract();

  assert.match(route, /requireOperationalLead/);
  assert.match(route, /score_locked/);
  assert.match(route, /Gelockte Sprints können nicht mehr geändert werden/);
  assert.match(route, /Sprint-Start darf nicht nach dem Sprint-Ende liegen/);
  assert.match(route, /Zeitraum, Name und Review-Datum dürfen nur bei leeren Sprints geändert werden/);
  assert.match(route, /sprint.update/);
  assert.match(planRoute, /protectedSprintIds/);
  assert.match(planRoute, /create_sprint_plan_transaction/);
  assert.match(planRoute, /expected_updated_at/);
  assert.doesNotMatch(planRoute, /from\("sprints"\)\.upsert/);
  assert.match(batchMigration, /create or replace function public\.create_sprint_plan_transaction/);
  assert.match(batchMigration, /insert into public\.meetings/);
  assert.match(batchMigration, /sprint\.plan_create/);
  assert.match(sprintUi, /findCurrentSprint/);
  assert.match(sprintUi, /Aktueller Sprint/);
  assert.match(sprintUi, /Zeitraum geschützt/);
  assert.match(sprintUi, /current: currentSprint\?\.id === item\.id/);
  assert.match(sprintUi, /locked: data\.tasks\.some/);
  assert.match(ui, /NotificationsOverview/);
  assert.doesNotMatch(notificationsOverviewUi, /SprintPlanningSection|Sprint-Planung/);
  assert.match(sprintUi, /SprintPlanningSection/);
  assert.match(sprintPlanningUi, /Sprint-Planung/);
  assert.match(sprintPlanningUi, /CustomDatePicker/);
  assert.match(sprintPlanningUi, /onCreateSprintPlan\(sprintPlanningOptions\)/);
  assert.match(sprintPlanningUi, /plannedSprintCount/);
  assert.doesNotMatch(sprintUi, /· aktuell|· geschützt/);
});

test("tasks can be assigned to an unlocked sprint", async () => {
  const route = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");

  assert.match(route, /sprintId/);
  assert.match(route, /sprint_id/);
  assert.match(route, /getBacklogSprintAssignmentEligibility/);
  assert.match(route, /backlogSprintAssignmentMessage/);
});

test("decision log routes and data slices stay removed while legacy storage remains in the production baseline", async () => {
  const schema = await readSupabaseSchemaContract();
  const apiClient = await readFile("src/features/planning/model/planning-api-client.ts", "utf8");
  const dataLoader = await readFile("src/lib/planning-data-loader.ts", "utf8");
  const types = await readFile("src/lib/types.ts", "utf8");

  assert.match(schema, /create table if not exists decision_task_links/);
  assert.match(schema, /create table if not exists decision_comments/);
  assert.match(schema, /create table if not exists decision_confirmations/);
  assert.match(schema, /create table if not exists decision_log/);
  assert.doesNotMatch(apiClient, /createDecisionRequest|confirmDecisionRequest|objectDecisionRequest|linkDecisionTaskRequest/);
  assert.doesNotMatch(dataLoader, /decision_log|decision_comments|decision_task_links/);
  assert.doesNotMatch(types, /export type Decision|DecisionTaskLink|decisionTaskLinks/);
});

test("profile role management is CEO-only and keeps one CEO", async () => {
  const route = await readFile("src/app/api/profiles/[id]/route.ts", "utf8");
  const migration = await readSupabaseSchemaContract();
  const transactionMigration = await readSupabaseSchemaContract();
  const data = await readFile("src/lib/planning-data-loader.ts", "utf8");
  const ui = await readPlanningSurface();
  const teamUi = await readFile("src/features/team/organisms/team-overview.tsx", "utf8");
  const teamCard = await readFile("src/features/team/molecules/team-member-card.tsx", "utf8");
  const teamSummary = await readFile("src/features/team/molecules/team-role-summary.tsx", "utf8");
  const teamDialog = await readFile("src/features/team/organisms/team-profile-edit-dialog.tsx", "utf8");
  const teamModel = await readFile("src/features/team/model/team-profile-view-model.ts", "utf8");

  assert.match(route, /requireCEO/);
  assert.match(route, /platformRoles/);
  assert.match(route, /Genau ein CEO muss gesetzt bleiben/);
  assert.match(route, /update_profile_admin_transaction/);
  assert.match(transactionMigration, /'profile\.update'/);
  assert.match(transactionMigration, /exactly one CEO is required/);
  assert.match(route, /profile_color/);
  assert.match(route, /google_chat_user_id/);
  assert.match(route, /google_chat_dm_space/);
  assert.match(route, /notifications_enabled/);
  assert.match(migration, /profile_color/);
  assert.match(migration, /profiles_profile_color_hex/);
  assert.match(data, /profile_color/);
  assert.doesNotMatch(data, /google_calendar_last_synced_at/);
  assert.match(ui, /TeamOverview/);
  assert.match(teamUi, /useTeamProfileDrafts/);
  assert.match(teamUi, /TeamProfileEditDialog/);
  assert.match(teamUi, /TeamMemberCard/);
  assert.doesNotMatch(teamUi, /lg:grid-cols-2/);
  assert.doesNotMatch(teamUi, /xl:grid-cols-3/);
  assert.match(teamModel, /profileDraftFields/);
  assert.match(teamModel, /teamMemberStats/);
  assert.doesNotMatch(teamCard, /Post-it-Farbe/);
  assert.doesNotMatch(teamCard, /profileColor/);
  assert.doesNotMatch(teamCard, /GitHub-Login/);
  assert.doesNotMatch(teamCard, /Chat-Konto/);
  assert.doesNotMatch(teamCard, /Persönliche Chat-Zustellung/);
  assert.doesNotMatch(teamCard, /Google-Chat-Benachrichtigungen/);
  assert.doesNotMatch(teamCard, /Kalender-E-Mail/);
  assert.match(teamCard, /Bearbeiten/);
  assert.match(teamCard, /Offene Aufgaben/);
  assert.match(teamCard, /P0\/P1 offen/);
  assert.match(teamCard, /Geplante Last/);
  assert.match(teamCard, /Wochenkapazität/);
  assert.match(teamCard, /Info/);
  assert.match(teamCard, /title=\{definition\.description\}/);
  assert.match(teamCard, /aria-label=\{definition\.description\}/);
  assert.doesNotMatch(teamCard, /role="tooltip"/);
  assert.match(teamCard, /lg:flex-nowrap/);
  assert.match(teamCard, /gap-x-6/);
  assert.match(teamCard, /lg:grid-cols-\[minmax\(220px,0\.8fr\)_minmax\(520px,2fr\)_auto\]/);
  assert.match(teamSummary, /CEO · \{profile\.name\}/);
  assert.doesNotMatch(teamSummary, /CEO-Bearbeitung aktiv/);
  assert.doesNotMatch(teamSummary, /Nur Ansicht/);
  assert.match(teamUi, /canManageTeam/);
  assert.match(teamSummary, /Aktuell ist keine aktive Deputy-Vertretung gesetzt/);
  assert.match(teamDialog, /if \(!canManageTeam\) return null/);
  assert.match(teamDialog, /Plattformrolle/);
  assert.match(teamDialog, /Org-Rolle/);
  assert.match(teamDialog, /GitHub-Login/);
  assert.match(teamDialog, /Kapazität/);
  assert.match(teamDialog, /Vertreter für/);
  assert.match(teamDialog, /Von/);
  assert.match(teamDialog, /Bis/);
  assert.match(teamDialog, /draftProfile\.platformRole === "deputy"/);
  assert.match(teamDialog, /CEO-Verwaltung für Rolle, Kapazität, GitHub-Zuordnung und Vertretung/);
});

test("notification preferences are editable per profile and event type", async () => {
  const route = await readFile("src/app/api/notification-preferences/route.ts", "utf8");
  const selfRoute = await readFile("src/app/api/profile-settings/route.ts", "utf8");
  const data = await readFile("src/lib/planning-data-loader.ts", "utf8");
  const dataMappers = await readFile("src/lib/planning-notification-mappers.ts", "utf8");
  const types = await readFile("src/lib/types.ts", "utf8");
  const profileUi = await readFile("src/features/profile/organisms/profile-settings-overview.tsx", "utf8");
  const profileNotifications = await readFile("src/features/profile/molecules/profile-notification-section.tsx", "utf8");
  const ownProfileCommands = await readFile("src/features/profile/hooks/use-own-profile-settings-commands.ts", "utf8");
  const policy = await readFile("src/lib/notification-catalog.ts", "utf8");

  assert.match(route, /requirePlanningContributor/);
  assert.match(selfRoute, /requireTeamMember/);
  assert.match(route, /notification_preferences/);
  assert.match(selfRoute, /notification_preferences/);
  assert.match(route, /allowedEventTypes/);
  assert.match(selfRoute, /allowedEventTypes/);
  assert.match(route, /Keine Berechtigung für diese Benachrichtigungseinstellung/);
  assert.match(route, /notification_preference\.update/);
  assert.match(data, /notificationPreferenceResult/);
  assert.match(dataMappers, /mapNotificationPreference/);
  assert.match(types, /export type NotificationPreference/);
  assert.match(profileNotifications, /Benachrichtigungen/);
  assert.match(profileUi, /onSaveOwnProfileSettings/);
  assert.match(profileUi, /Ungespeicherte Änderungen/);
  assert.match(profileUi, /data-profile-save-bar/);
  assert.match(profileNotifications, /notificationEventLabel/);
  assert.match(ownProfileCommands, /notificationEvents/);
  assert.match(ownProfileCommands, /Profil konnte nicht gespeichert werden/);
  assert.match(policy, /googleChatDigestEventTypes/);
  assert.match(policy, /Review angefragt/);
});

test("board tasks can be dragged between status columns", async () => {
  const ui = await readPlanningSurface();
  const taskCard = await readFile("src/features/tasks/molecules/task-card.tsx", "utf8");

  assert.match(taskCard, /draggable=\{Boolean\(onDragStart\)\}/);
  assert.match(ui, /onDrop=\{\(event\) => onDropTask\(status, event\)\}/);
  assert.match(ui, /onDropTask=\{dropTaskOnStatus\}/);
  assert.match(ui, /event\.dataTransfer\.setData\("text\/plain", task\.id\)/);
  assert.match(ui, /updateTask\(task, \{ status \}\)/);
  assert.match(ui, /founderStatusGuardMessage/);
  assert.match(ui, /founderCompletedTaskGuardMessage/);
  assert.match(ui, /Founder können Aufgaben nicht direkt auf Erledigt setzen/);
  assert.match(ui, /Diese Aufgabe ist final erledigt/);
  assert.match(ui, /In Review verschieben/);
  assert.match(ui, /Als blockiert markieren/);
  assert.match(ui, /statusOptionsForRole/);
  assert.match(ui, /canManageFinalTaskStatus/);
});

test("event form closes only after a successful validated save", async () => {
  const overview = await readFile("src/features/events/organisms/events-overview.tsx", "utf8");
  const commands = await readFile("src/features/events/hooks/use-founder-event-commands.ts", "utf8");

  assert.match(overview, /const \[formPending, setFormPending\]/);
  assert.match(overview, /await onUpdateEvent\(editingEvent, draft\)/);
  assert.match(overview, /await onCreateEvent\(draft\)/);
  assert.match(overview, /closeForm\(\);/);
  assert.match(overview, /keep the form and draft open for correction/);
  assert.match(commands, /const createFounderEvent = async/);
  assert.match(commands, /const updateFounderEvent = async/);
  assert.match(commands, /validIsoDateTime/);
  assert.match(commands, /Number\.isNaN\(parsed\.getTime\(\)\)/);
  assert.match(commands, /Die Endzeit darf nicht vor der Startzeit liegen/);
});

test("review workflow supports rework, suggestions, and sprint commitments", async () => {
  const status = await readFile("src/lib/status.ts", "utf8");
  const migration = await readSupabaseSchemaContract();
  const route = await readFile("src/app/api/sprint-commitments/route.ts", "utf8");
  const sprintUi = await readFeatureSurface("src/features/sprint");
  const reviewSheet = await readFile("src/features/reviews/organisms/task-review-sheet.tsx", "utf8");

  assert.match(status, /Nacharbeit/);
  assert.doesNotMatch(status, /Vorschlag/);
  assert.match(migration, /create table if not exists sprint_commitments/);
  assert.match(route, /Founder können nur ihr eigenes Commitment ändern/);
  assert.match(reviewSheet, /Accountable Review-Blatt/);
  assert.match(sprintUi, /Review anfragen/);
  assert.match(sprintUi, /focusedReviewTaskId/);
  assert.match(sprintUi, /selectReviewTask\(focusedReviewTaskId\)/);
  assert.match(sprintUi, /accountable-review-sheet/);
  assert.match(sprintUi, /scrollIntoView/);
});

test("founder self checklist is separate from CEO scoring", async () => {
  const migration = await readSupabaseSchemaContract();
  const reviewRoute = await readFile("src/app/api/tasks/[id]/review/route.ts", "utf8");
  const taskRoute = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const taskRouteHelpers = await readFile("src/features/tasks/model/task-route-update-helpers.ts", "utf8");
  const taskRoutePolicy = `${taskRoute}\n${taskRouteHelpers}`;
  const sprintUi = await readFeatureSurface("src/features/sprint");
  const reviewSheet = await readFile("src/features/reviews/organisms/task-review-sheet.tsx", "utf8");

  assert.match(migration, /self_dod_checked/);
  assert.match(taskRoutePolicy, /self_dod_checked/);
  assert.match(reviewRoute, /reviewDecisionPoints/);
  assert.match(reviewRoute, /const points = reviewDecisionPoints\(decision, checklist\)/);
  assert.doesNotMatch(sprintUi, /Founder-Arbeitsstand/);
  assert.doesNotMatch(sprintUi, /Selbstkontrolle ohne Punkte/);
  assert.match(reviewSheet, /Review-Blatt/);
  assert.match(reviewSheet, /Accountable Review-Blatt/);
  assert.match(reviewSheet, /Aus erfüllten Kriterien berechnet/);
  assert.match(reviewSheet, /reviewChecklistScore/);
  assert.match(sprintUi, /20 Punkte/);
  assert.match(sprintUi, /Form \/ Review-Reife/);
  assert.match(reviewRoute, /checklistPoints/);
  assert.match(reviewRoute, /acceptanceCriteriaMet/);
});
