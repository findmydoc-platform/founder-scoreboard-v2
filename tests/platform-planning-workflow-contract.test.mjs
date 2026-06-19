import { readFile } from "node:fs/promises";
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
  const taskPage = await readFile("src/features/tasks/templates/task-detail-page.tsx", "utf8");
  const taskWorkflow = await readFile("src/features/tasks/hooks/use-task-detail-workflow.ts", "utf8");
  const meetingUi = await readFile("src/features/meetings/organisms/meeting-finder-overview.tsx", "utf8");
  const meetingControls = await readFile("src/features/meetings/hooks/use-meeting-finder-controls.ts", "utf8");
  const meetingAvailabilityHook = await readFile("src/features/meetings/hooks/use-meeting-availability-editor.ts", "utf8");
  const teamUi = await readFile("src/features/team/organisms/team-overview.tsx", "utf8");
  const teamDraftHook = await readFile("src/features/team/hooks/use-team-profile-drafts.ts", "utf8");
  const teamModel = await readFile("src/features/team/model/team-profile-view-model.ts", "utf8");
  const decisionUi = await readFile("src/features/decisions/organisms/decision-log-overview.tsx", "utf8");
  const decisionHook = await readFile("src/features/decisions/hooks/use-decision-log-workflow.ts", "utf8");

  assert.match(taskPage, /useTaskDetailWorkflow/);
  assert.doesNotMatch(taskPage, /createBrowserApiClient|updateTaskRequest|syncTaskToGitHubRequest|useTaskComments|useTaskRelationships|useTransition/);
  assert.match(taskWorkflow, /createBrowserApiClient/);
  assert.match(taskWorkflow, /updateTaskRequest/);
  assert.match(taskWorkflow, /syncTaskToGitHubRequest/);
  assert.match(taskWorkflow, /useTaskComments/);
  assert.match(taskWorkflow, /useTaskRelationships/);
  assert.match(taskWorkflow, /detailsEditSnapshot/);

  assert.match(meetingUi, /useMeetingFinderControls/);
  assert.match(meetingUi, /useMeetingAvailabilityEditor/);
  assert.doesNotMatch(meetingUi, /buildMeetingFinderViewModel|useState|useRef|useCallback|useEffect/);
  assert.match(meetingControls, /buildMeetingFinderViewModel/);
  assert.match(meetingControls, /calendarDrag/);
  assert.match(meetingControls, /reserveSlot/);
  assert.match(meetingControls, /openAvailabilityBlock/);
  assert.match(meetingAvailabilityHook, /saveAvailabilityDialog/);

  assert.match(teamUi, /useTeamProfileDrafts/);
  assert.doesNotMatch(teamUi, /useState|setDrafts|profileDraftFields|sameProfileValue/);
  assert.match(teamDraftHook, /onSaveProfileSettings/);
  assert.match(teamDraftHook, /setNotificationDraft/);
  assert.match(teamModel, /profileHasDraftChanges/);
  assert.match(teamModel, /activeDeputyProfiles/);

  assert.match(decisionUi, /useDecisionLogWorkflow/);
  assert.doesNotMatch(decisionUi, /useState|setObjectionDrafts|setOpenDecisions|setOpenAudits/);
  assert.match(decisionHook, /requiredProfileIds/);
  assert.match(decisionHook, /submitCreate/);
  assert.match(decisionHook, /toggleEdit/);
});

test("task template v2 separates outcome criteria evidence and DoD", async () => {
  const migration = await readFile("supabase/0012_task_template_v2.sql", "utf8");
  const createRoute = await readFile("src/app/api/tasks/route.ts", "utf8");
  const updateRoute = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const types = await readFile("src/lib/types.ts", "utf8");
  const data = await readFile("src/lib/planning-data.ts", "utf8");
  const dataRowTypes = await readFile("src/lib/planning-data-row-types.ts", "utf8");
  const newTaskUi = await readFile("src/features/tasks/organisms/new-task-dialog.tsx", "utf8");
  const detail = await readFile("src/features/tasks/templates/task-detail-page.tsx", "utf8");
  const briefSection = await readFile("src/features/tasks/molecules/task-brief-section.tsx", "utf8");
  const docs = await readFile("docs/task-template-v2.md", "utf8");

  assert.match(migration, /problem_statement/);
  assert.match(migration, /intended_outcome/);
  assert.match(migration, /acceptance_criteria/);
  assert.match(migration, /evidence_required/);
  assert.match(createRoute, /problemStatement/);
  assert.match(updateRoute, /acceptanceCriteria/);
  assert.match(types, /problemStatement/);
  assert.match(data, /task_dependencies\(note\), task_notes\(note\)/);
  assert.match(dataRowTypes, /problem_statement/);
  assert.match(newTaskUi, /Template v2/);
  assert.match(detail, /TaskBriefSection/);
  assert.match(briefSection, /Aufgabenbrief/);
  assert.match(briefSection, /Acceptance Criteria/);
  assert.match(briefSection, /Evidence Required/);
  assert.match(briefSection, /Definition of Done/);
  assert.match(docs, /Nicht mit Acceptance Criteria vermischen/);
});

test("story writing skill protects approved stories and enforces template guardrails", async () => {
  const skill = await readFile(".agents/skills/fmd-story-writing/SKILL.md", "utf8");
  const examples = await readFile(".agents/skills/fmd-story-writing/references/examples.md", "utf8");
  const agent = await readFile(".agents/skills/fmd-story-writing/agents/openai.yaml", "utf8");
  const rules = await readFile("AGENTS.md", "utf8");
  const docs = await readFile("docs/task-template-v2.md", "utf8");

  assert.match(skill, /fmd-story-writing/);
  assert.match(skill, /Approved, released, reviewed, or GitHub-synced story/);
  assert.match(skill, /Never change Acceptance Criteria/);
  assert.match(skill, /Problem Statement/);
  assert.match(skill, /current state/);
  assert.match(skill, /pain point/);
  assert.match(skill, /Do not describe the solution/);
  assert.match(skill, /Scope & Constraints/);
  assert.match(skill, /Acceptance Criteria/);
  assert.match(skill, /objective and testable/);
  assert.match(skill, /controlled by the owner/);
  assert.match(skill, /Definition of Done/);
  assert.match(examples, /Good:/);
  assert.match(examples, /Bad:/);
  assert.match(examples, /Protected Existing Story/);
  assert.match(agent, /FMD Story Writing/);
  assert.match(rules, /\.agents\/skills\/fmd-story-writing/);
  assert.match(rules, /Do not silently rewrite/);
  assert.match(docs, /Keine Lösung, Umsetzungsschritte oder technische Vorgaben/);
  assert.match(docs, /Harte Vorgaben wie Recht, Compliance, Datenschutz, Security/);
});

test("strict auth gates planning data until a valid session is present", async () => {
  const page = await readFile("src/app/page.tsx", "utf8");
  const api = await readFile("src/app/api/planning-data/route.ts", "utf8");
  const authz = await readFile("src/lib/authz.ts", "utf8");
  const serverAuth = await readFile("src/lib/planning-auth-server.ts", "utf8");
  const ui = await readPlanningSurface();
  const authHook = await readFile("src/features/planning/hooks/use-planning-auth.ts", "utf8");
  const authControl = await readFile("src/features/settings/organisms/auth-control.tsx", "utf8");

  assert.match(page, /requiresSupabaseAuth\(\)/);
  assert.match(page, /getServerPlanningAuth/);
  assert.match(page, /emptyPlanningData/);
  assert.match(page, /initialProtectedDataLoaded/);
  assert.match(api, /requirePlatformRole\(request, \["ceo", "founder", "deputy", "viewer"\]\)/);
  assert.match(api, /currentProfile: auth\.profile/);
  assert.match(authz, /auth_user_id/);
  assert.match(authz, /ilike\("github_login", githubLogin\)/);
  assert.match(serverAuth, /requirePlatformRoleForUser/);
  assert.match(authz, /unterschiedliche Teamprofile/);
  assert.doesNotMatch(authz, /\.or\(`auth_user_id/);
  assert.match(authHook, /Du bist abgemeldet/);
  assert.match(authHook, /serverCurrentProfile/);
  assert.match(authHook, /initialAuthUser/);
  assert.match(authHook, /authUserId/);
  assert.match(ui, /<AppBrand \/>/);
  assert.match(ui, /PlanningBootShell/);
  assert.doesNotMatch(ui, /ShieldCheck/);
  assert.match(ui, /variant="gate"/);
  assert.match(authControl, /Rollen und Zugriff werden nach dem Login/);
  assert.match(authControl, /Mit GitHub anmelden/);
  assert.doesNotMatch(authControl, /GitHub-Rechte fehlen/);
  assert.doesNotMatch(authControl, /Login öffnen/);
  assert.match(authHook, /supabase\.auth\.signOut\(\{ scope: "global" \}\)/);
  assert.match(authHook, /\/api\/planning-data/);
});

test("task review uses accountable reviewer route and keeps rework non-final", async () => {
  const route = await readFile("src/app/api/tasks/[id]/review/route.ts", "utf8");
  const taskRoute = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const createTaskRoute = await readFile("src/app/api/tasks/route.ts", "utf8");
  const authz = await readFile("src/lib/authz.ts", "utf8");
  const migration = await readFile("supabase/0031_accountable_review_workflow.sql", "utf8");
  const backfillMigration = await readFile("supabase/0032_backfill_review_owner.sql", "utf8");
  const plannedOwnerBackfillMigration = await readFile("supabase/0033_backfill_planned_review_owners.sql", "utf8");
  const sprintUi = await readFeatureSurface("src/features/sprint");
  const reviewSheet = await readFile("src/features/reviews/organisms/task-review-sheet.tsx", "utf8");
  const appUi = await readPlanningSurface();
  const sprintViewModel = await readFile("src/features/sprint/model/sprint-score-view-model.ts", "utf8");

  assert.match(migration, /review_owner_profile_id/);
  assert.match(migration, /review_requested_at/);
  assert.match(backfillMigration, /review_owner_profile_id is null/);
  assert.match(backfillMigration, /accountable_profile_id/);
  assert.match(backfillMigration, /review_status = 'requested' or task\.status = 'Review'/);
  assert.match(plannedOwnerBackfillMigration, /review_owner_profile_id is null/);
  assert.match(plannedOwnerBackfillMigration, /coalesce\(package\.accountable_profile_id, package\.owner_id\)/);
  assert.match(authz, /requireTaskReviewer/);
  assert.match(authz, /review_owner_profile_id/);
  assert.match(createTaskRoute, /review_owner_profile_id: reviewOwnerProfileId/);
  assert.match(createTaskRoute, /accountable_profile_id/);
  assert.match(taskRoute, /accountable_profile_id/);
  assert.match(taskRoute, /update\.review_owner_profile_id/);
  assert.match(taskRoute, /Nur der CEO kann den Review Owner ändern/);
  assert.match(taskRoute, /payload\.reviewOwnerProfileId !== undefined && permission\.profile\?\.platformRole !== "ceo"/);
  assert.match(taskRoute, /task\.review_requested/);
  assert.match(taskRoute, /recipient_profile_id: recipient\.id/);
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
  assert.match(route, /requireFounder/);
  assert.match(route, /task_reviews/);
  assert.match(route, /scoreFinal = decision !== "changes_requested"/);
  assert.match(route, /const points = reviewDecisionPoints\(decision, checklist\)/);
  assert.match(route, /github_sync_status: "not_synced"/);
  assert.match(route, /Nacharbeit/);
  assert.match(route, /checklist/);
  assert.match(route, /acceptanceCriteriaMet/);
  assert.match(sprintViewModel, /Acceptance Criteria erfüllt/);
  assert.match(sprintUi, /CEO-Score/);
  assert.match(appUi, /Nächster Schritt/);
  assert.match(reviewSheet, /Evidence Required/);
  assert.match(reviewSheet, /Definition of Done Snapshot/);
  assert.match(route, /Sprint-Score ist bereits gelockt/);
});

test("review workspace has direct review detail routes filters and reopen guard", async () => {
  const sidebar = await readFile("src/features/planning/organisms/app-sidebar.tsx", "utf8");
  const app = await readPlanningSurface();
  const workspace = await readFile("src/features/reviews/organisms/review-workspace-overview.tsx", "utf8");
  const detail = await readFile("src/features/reviews/templates/review-detail-page.tsx", "utf8");
  const sheet = await readFile("src/features/reviews/organisms/task-review-sheet.tsx", "utf8");
  const model = await readFile("src/features/reviews/model/review-workspace-view-model.ts", "utf8");
  const reviewRoute = await readFile("src/app/reviews/[id]/page.tsx", "utf8");
  const reopenRoute = await readFile("src/app/api/tasks/[id]/review/reopen/route.ts", "utf8");
  const taskApiClient = await readFile("src/features/tasks/model/task-api-client.ts", "utf8");

  assert.match(sidebar, /reviews/);
  assert.match(sidebar, /Reviews/);
  assert.match(app, /workspace === "reviews"/);
  assert.match(app, /ReviewWorkspaceOverview/);
  assert.match(app, /reviewStatusFilter/);
  assert.match(app, /reviewOwnerFilter/);
  assert.match(app, /useState<ReviewOwnerFilter>\("all"\)/);
  assert.match(app, /initialReviewTaskId/);
  assert.match(app, /ReviewDetailPage/);
  assert.match(app, /reopenReviewTask/);
  assert.match(taskApiClient, /\/api\/tasks\/\$\{taskId\}\/review\/reopen/);
  assert.match(model, /label: "Meine"/);
  assert.match(workspace, /Offen/);
  assert.match(workspace, /Abgeschlossen/);
  assert.match(workspace, /Nacharbeit/);
  assert.match(workspace, /Geblockt/);
  assert.match(workspace, /\/reviews\/\$\{encodeURIComponent\(task\.id\)\}/);
  assert.match(detail, /TaskReviewSheet/);
  assert.match(detail, /Review nicht gefunden/);
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
  const migration = await readFile("supabase/0029_founderops_score_strikes.sql", "utf8");
  const route = await readFile("src/app/api/sprints/[id]/lock/route.ts", "utf8");
  const objectionRoute = await readFile("src/app/api/sprints/[id]/score-objections/route.ts", "utf8");
  const ui = await readFeatureSurface("src/features/sprint");
  const meetingUi = await readFile("src/features/sprint/molecules/sprint-meeting-attendance-section.tsx", "utf8");
  const data = await readFile("src/lib/planning-data.ts", "utf8");
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
  assert.match(migration, /Weekly 1/);
  assert.match(migration, /Weekly 2/);
  assert.match(route, /computeFounderSprintScore/);
  assert.match(route, /computeStrikeTransition/);
  assert.match(route, /Offene Score-Einwände/);
  assert.match(route, /Reviewfrist läuft noch/);
  assert.match(route, /founder_sprint_scores/);
  assert.match(route, /founder_strike_state/);
  assert.match(route, /strike_events/);
  assert.match(objectionRoute, /score_objections/);
  assert.match(objectionRoute, /second_reviewer_profile_id/);
  assert.match(ui, /FounderOps Score v2\.1/);
  assert.match(ui, /20 Punkte/);
  assert.match(ui, /Delivery/);
  assert.match(ui, /Form \/ Review-Reife/);
  assert.match(ui, /Weekly/);
  assert.match(ui, /Strike/);
  assert.match(ui, /Score-Einwände/);
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

  assert.match(route, /requireOperationalLead/);
  assert.match(route, /score_points: 0/);
  assert.match(route, /score_final: true/);
  assert.match(route, /sprint.lock_score/);
});

test("sprint lock creates carryover for unfinished deliverables", async () => {
  const migration = await readFile("supabase/0009_sprint_carryover.sql", "utf8");
  const route = await readFile("src/app/api/sprints/[id]/lock/route.ts", "utf8");
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
  assert.match(route, /github_issue_number: null/);
  assert.match(route, /missed_uncommunicated/);
  assert.match(route, /accepted_carryover/);
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
  const settingsOverviewUi = await readFile("src/features/settings/organisms/settings-overview.tsx", "utf8");
  const sprintPlanningUi = await readFile("src/features/settings/molecules/settings-sprint-planning.tsx", "utf8");

  assert.match(route, /requireOperationalLead/);
  assert.match(route, /score_locked/);
  assert.match(route, /Gelockte Sprints können nicht mehr geändert werden/);
  assert.match(route, /Sprint-Start darf nicht nach dem Sprint-Ende liegen/);
  assert.match(route, /Zeitraum, Name und Review-Datum dürfen nur bei leeren Sprints geändert werden/);
  assert.match(route, /sprint.update/);
  assert.match(planRoute, /protectedSprintIds/);
  assert.match(sprintUi, /findCurrentSprint/);
  assert.match(sprintUi, /Aktueller Sprint/);
  assert.match(sprintUi, /Zeitraum geschützt/);
  assert.match(sprintUi, /current: currentSprint\?\.id === item\.id/);
  assert.match(sprintUi, /locked: data\.tasks\.some/);
  assert.match(ui, /SettingsOverview/);
  assert.match(settingsOverviewUi, /SprintPlanningSection/);
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
  assert.match(route, /Gelockte Sprints können nicht mehr zugewiesen werden/);
});

test("decision confirmation can lock decisions after required confirmations", async () => {
  const route = await readFile("src/app/api/decisions/[id]/confirm/route.ts", "utf8");

  assert.match(route, /requireFounder/);
  assert.match(route, /open_for_confirmation/);
  assert.match(route, /status: "locked"/);
  assert.match(route, /confirm_and_lock/);
});

test("decision creation opens CEO decisions for confirmation", async () => {
  const route = await readFile("src/app/api/decisions/route.ts", "utf8");

  assert.match(route, /requireCEO/);
  assert.match(route, /open_for_confirmation/);
  assert.match(route, /requiredProfileIds/);
  assert.match(route, /Entscheidungstext ist erforderlich/);
});

test("decision edit is CEO-only, audited, and resets confirmations", async () => {
  const route = await readFile("src/app/api/decisions/[id]/route.ts", "utf8");

  assert.match(route, /requireCEO/);
  assert.match(route, /Gelockte Decisions sind unveränderlich/);
  assert.match(route, /decision_confirmations"\)\.delete/);
  assert.match(route, /decision.update/);
  assert.match(route, /before_data/);
  assert.match(route, /after_data/);
});

test("decision objections are founder comments with audit trail", async () => {
  const route = await readFile("src/app/api/decisions/[id]/objections/route.ts", "utf8");
  const sql = await readFile("supabase/0003_decision_comments.sql", "utf8");

  assert.match(sql, /create table if not exists decision_comments/);
  assert.match(route, /requireFounder/);
  assert.match(route, /decision_comments/);
  assert.match(route, /decision.objection/);
  assert.match(route, /Gelockte Decisions können nicht mehr beanstandet werden/);
});

test("profile role management is CEO-only and keeps one CEO", async () => {
  const route = await readFile("src/app/api/profiles/[id]/route.ts", "utf8");
  const migration = await readFile("supabase/0014_profile_colors.sql", "utf8");
  const data = await readFile("src/lib/planning-data.ts", "utf8");
  const ui = await readPlanningSurface();
  const teamUi = await readFile("src/features/team/organisms/team-overview.tsx", "utf8");
  const teamModel = await readFile("src/features/team/model/team-profile-view-model.ts", "utf8");

  assert.match(route, /requireCEO/);
  assert.match(route, /platformRoles/);
  assert.match(route, /Mindestens ein CEO muss gesetzt bleiben/);
  assert.match(route, /profile.update/);
  assert.match(route, /profile_color/);
  assert.match(route, /google_chat_user_id/);
  assert.match(route, /google_chat_dm_space/);
  assert.match(route, /notifications_enabled/);
  assert.match(route, /google_calendar_email/);
  assert.match(route, /google_calendar_sync_enabled/);
  assert.match(migration, /profile_color/);
  assert.match(migration, /profiles_profile_color_hex/);
  assert.match(data, /profile_color/);
  assert.match(data, /google_calendar_last_synced_at/);
  assert.match(ui, /TeamOverview/);
  assert.match(teamUi, /useTeamProfileDrafts/);
  assert.match(teamModel, /profileColorOptions/);
  assert.match(teamUi, /Post-it-Farbe/);
  assert.match(teamUi, /Google Chat User-ID/);
  assert.match(teamUi, /Google Chat DM-Space/);
  assert.match(teamUi, /Google-Chat-Benachrichtigungen/);
  assert.match(teamUi, /Kalender-E-Mail/);
  assert.match(teamUi, /CEO-Bearbeitung aktiv/);
  assert.match(teamUi, /Nur Ansicht/);
  assert.match(teamUi, /canManageTeam/);
  assert.match(teamUi, /Aktuell ist keine aktive Deputy-Vertretung gesetzt/);
  assert.match(teamUi, /Rollen, Stammdaten und der zentrale Benachrichtigungsschalter sind CEO-geschützt/);
});

test("notification preferences are editable per profile and event type", async () => {
  const route = await readFile("src/app/api/notification-preferences/route.ts", "utf8");
  const data = await readFile("src/lib/planning-data.ts", "utf8");
  const dataMappers = await readFile("src/lib/planning-data-mappers.ts", "utf8");
  const types = await readFile("src/lib/types.ts", "utf8");
  const teamUi = await readFile("src/features/team/organisms/team-overview.tsx", "utf8");
  const teamDraftHook = await readFile("src/features/team/hooks/use-team-profile-drafts.ts", "utf8");
  const policy = await readFile("src/lib/notification-policy.ts", "utf8");

  assert.match(route, /requireFounder/);
  assert.match(route, /notification_preferences/);
  assert.match(route, /allowedEventTypes/);
  assert.match(route, /Keine Berechtigung für diese Benachrichtigungseinstellung/);
  assert.match(route, /notification_preference\.update/);
  assert.match(data, /notificationPreferenceResult/);
  assert.match(dataMappers, /mapNotificationPreference/);
  assert.match(types, /export type NotificationPreference/);
  assert.match(teamUi, /Google-Chat-Events/);
  assert.match(teamUi, /onSaveProfileSettings/);
  assert.match(teamUi, /Ungespeicherte Änderungen/);
  assert.match(teamUi, /Speichern/);
  assert.match(teamUi, /notificationEventLabel/);
  assert.match(teamDraftHook, /setNotificationDraft/);
  assert.match(teamDraftHook, /Profil konnte nicht gespeichert werden/);
  assert.match(policy, /GoogleChatDigestEventType/);
  assert.match(policy, /Review angefragt/);
});

test("decision audit loads before and after data for collapsible diffs", async () => {
  const data = await readFile("src/lib/planning-data.ts", "utf8");
  const dataMappers = await readFile("src/lib/planning-data-mappers.ts", "utf8");
  const decisionUi = await readFeatureSurface("src/features/decisions");

  assert.match(data, /before_data,after_data/);
  assert.match(dataMappers, /beforeData: row.before_data/);
  assert.match(decisionUi, /auditChanges/);
  assert.match(decisionUi, /Audit Trail/);
  assert.match(decisionUi, /Vorher/);
  assert.match(decisionUi, /Nachher/);
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
  assert.match(ui, /Founder können Aufgaben nicht direkt auf Erledigt setzen/);
  assert.match(ui, /In Review verschieben/);
  assert.match(ui, /Als blockiert markieren/);
  assert.match(ui, /statusOptionsForRole/);
});

test("review workflow supports rework, suggestions, and sprint commitments", async () => {
  const status = await readFile("src/lib/status.ts", "utf8");
  const migration = await readFile("supabase/0004_review_commitments.sql", "utf8");
  const route = await readFile("src/app/api/sprint-commitments/route.ts", "utf8");
  const sprintUi = await readFeatureSurface("src/features/sprint");
  const reviewSheet = await readFile("src/features/reviews/organisms/task-review-sheet.tsx", "utf8");

  assert.match(status, /Nacharbeit/);
  assert.match(status, /Vorschlag/);
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
  const migration = await readFile("supabase/0010_task_self_checklist.sql", "utf8");
  const reviewRoute = await readFile("src/app/api/tasks/[id]/review/route.ts", "utf8");
  const taskRoute = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const sprintUi = await readFeatureSurface("src/features/sprint");
  const reviewSheet = await readFile("src/features/reviews/organisms/task-review-sheet.tsx", "utf8");

  assert.match(migration, /self_dod_checked/);
  assert.match(taskRoute, /self_dod_checked/);
  assert.match(reviewRoute, /reviewDecisionPoints/);
  assert.match(reviewRoute, /const points = reviewDecisionPoints\(decision, checklist\)/);
  assert.doesNotMatch(sprintUi, /Founder-Arbeitsstand/);
  assert.doesNotMatch(sprintUi, /Selbstkontrolle ohne Punkte/);
  assert.match(reviewSheet, /Review-Blatt/);
  assert.match(reviewSheet, /Accountable Review-Blatt/);
  assert.match(reviewSheet, /Review-Rohpunkte/);
  assert.match(reviewSheet, /reviewChecklistScore/);
  assert.match(sprintUi, /20 Punkte/);
  assert.match(sprintUi, /Form \/ Review-Reife/);
  assert.match(reviewRoute, /checklistPoints/);
  assert.match(reviewRoute, /acceptanceCriteriaMet/);
});
