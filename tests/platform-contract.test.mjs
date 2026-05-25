import { readFile } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

async function listFiles(dir, extension) {
  const entries = await readdir(dir);
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = `${dir}/${entry}`;
    const info = await stat(fullPath);
    if (info.isDirectory()) return listFiles(fullPath, extension);
    return fullPath.endsWith(extension) ? [fullPath] : [];
  }));

  return nested.flat();
}

test("platform migration contains the role, decision, score and sync contracts", async () => {
  const sql = await readFile("supabase/0002_founder_platform.sql", "utf8");

  assert.match(sql, /platform_role text/);
  assert.match(sql, /github_login text unique/);
  assert.match(sql, /decision_log/);
  assert.match(sql, /decision_confirmations/);
  assert.match(sql, /audit_log/);
  assert.match(sql, /review_status/);
  assert.match(sql, /github_sync_status/);
  assert.match(sql, /current_platform_role/);
});

test("github sync route keeps the app as source of truth", async () => {
  const route = await readFile("src/app/api/tasks/[id]/sync-github/route.ts", "utf8");

  assert.match(route, /requireOperationalLead/);
  assert.match(route, /buildSyncContext/);
  assert.match(route, /task_comments/);
  assert.match(route, /task_blockers/);
  assert.match(route, /parent_task_id/);
  assert.match(route, /github_sync_status: "pending"/);
  assert.match(route, /github_sync_status: "synced"/);
  assert.match(route, /github_sync_status: "failed"/);
});

test("github issue export includes structure review blockers and comments", async () => {
  const github = await readFile("src/lib/github.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");

  assert.match(github, /taskIssueTitle/);
  assert.match(github, /taskIssueLabels/);
  assert.match(github, /task\.taskType === "deliverable" \? "deliverable"/);
  assert.match(github, /review:ready/);
  assert.match(github, /Problem Statement/);
  assert.match(github, /Intended Outcome/);
  assert.match(github, /Acceptance Criteria/);
  assert.match(github, /Score-relevant/);
  assert.match(github, /Offene Blocker/);
  assert.match(github, /Letzte Kommentare/);
  assert.match(github, /Parent Deliverable/);
  assert.match(ui, /syncTaskToGitHub/);
  assert.match(ui, /Jetzt spiegeln/);
});

test("task template v2 separates outcome criteria evidence and DoD", async () => {
  const migration = await readFile("supabase/0012_task_template_v2.sql", "utf8");
  const createRoute = await readFile("src/app/api/tasks/route.ts", "utf8");
  const updateRoute = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const types = await readFile("src/lib/types.ts", "utf8");
  const data = await readFile("src/lib/planning-data.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const detail = await readFile("src/components/task-detail-page.tsx", "utf8");
  const docs = await readFile("docs/task-template-v2.md", "utf8");

  assert.match(migration, /problem_statement/);
  assert.match(migration, /intended_outcome/);
  assert.match(migration, /acceptance_criteria/);
  assert.match(migration, /evidence_required/);
  assert.match(createRoute, /problemStatement/);
  assert.match(updateRoute, /acceptanceCriteria/);
  assert.match(types, /problemStatement/);
  assert.match(data, /problem_statement/);
  assert.match(ui, /Template v2/);
  assert.match(detail, /Aufgabenbrief/);
  assert.match(docs, /Nicht mit Acceptance Criteria vermischen/);
});

test("github oauth prepares user-based sync without storing provider tokens", async () => {
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const rules = await readFile("AGENTS.md", "utf8");

  assert.match(ui, /signInWithOAuth/);
  assert.match(ui, /scopes: "repo read:user user:email"/);
  assert.match(ui, /provider_token/);
  assert.match(ui, /GitHub User-Token/);
  assert.match(rules, /provider_token/);
  assert.match(rules, /Never persist or log provider tokens/);
});

test("strict auth gates planning data until a valid session is present", async () => {
  const page = await readFile("src/app/page.tsx", "utf8");
  const api = await readFile("src/app/api/planning-data/route.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");

  assert.match(page, /requiresSupabaseAuth\(\)/);
  assert.match(page, /emptyPlanningData/);
  assert.match(api, /requirePlatformRole\(request, \["ceo", "founder", "deputy", "viewer"\]\)/);
  assert.match(ui, /Du bist abgemeldet/);
  assert.match(ui, /supabase\.auth\.signOut\(\{ scope: "global" \}\)/);
  assert.match(ui, /\/api\/planning-data/);
});

test("task review uses operational lead route and keeps rework non-final", async () => {
  const route = await readFile("src/app/api/tasks/[id]/review/route.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");

  assert.match(route, /requireOperationalLead/);
  assert.match(route, /task_reviews/);
  assert.match(route, /scoreFinal = decision !== "changes_requested"/);
  assert.match(route, /Nacharbeit/);
  assert.match(route, /checklist/);
  assert.match(route, /acceptanceCriteriaMet/);
  assert.match(ui, /Acceptance Criteria erfüllt/);
  assert.match(ui, /Evidence Required/);
  assert.match(ui, /Definition of Done Snapshot/);
  assert.match(route, /Sprint-Score ist bereits gelockt/);
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
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const types = await readFile("src/lib/types.ts", "utf8");

  assert.match(migration, /original_sprint_id/);
  assert.match(migration, /carried_from_task_id/);
  assert.match(migration, /sprint_outcome/);
  assert.match(route, /communicated_blocker/);
  assert.match(route, /missed_uncommunicated/);
  assert.match(route, /accepted_carryover/);
  assert.match(route, /sprint\.task_carried_over/);
  assert.match(ui, /Sprint-Verlauf/);
  assert.match(ui, /Carry-over/);
  assert.match(types, /carryoverReason/);
});

test("sprint configuration is operational-lead only and audited", async () => {
  const route = await readFile("src/app/api/sprints/[id]/route.ts", "utf8");

  assert.match(route, /requireOperationalLead/);
  assert.match(route, /score_locked/);
  assert.match(route, /Gelockte Sprints können nicht mehr geändert werden/);
  assert.match(route, /Sprint-Start darf nicht nach dem Sprint-Ende liegen/);
  assert.match(route, /sprint.update/);
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
  const ui = await readFile("src/components/planning-app.tsx", "utf8");

  assert.match(route, /requireCEO/);
  assert.match(route, /platformRoles/);
  assert.match(route, /Mindestens ein CEO muss gesetzt bleiben/);
  assert.match(route, /profile.update/);
  assert.match(route, /profile_color/);
  assert.match(migration, /profile_color/);
  assert.match(migration, /profiles_profile_color_hex/);
  assert.match(data, /profile_color/);
  assert.match(ui, /profileColorOptions/);
  assert.match(ui, /Post-it-Farbe/);
});

test("decision audit loads before and after data for collapsible diffs", async () => {
  const data = await readFile("src/lib/planning-data.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");

  assert.match(data, /before_data,after_data/);
  assert.match(data, /beforeData: row.before_data/);
  assert.match(ui, /auditChanges/);
  assert.match(ui, /Audit Trail/);
  assert.match(ui, /Vorher/);
  assert.match(ui, /Nachher/);
});

test("board tasks can be dragged between status columns", async () => {
  const ui = await readFile("src/components/planning-app.tsx", "utf8");

  assert.match(ui, /draggable=\{Boolean\(onDragStart\)\}/);
  assert.match(ui, /onDrop=\{\(event\) => dropTaskOnStatus\(status, event\)\}/);
  assert.match(ui, /event\.dataTransfer\.setData\("text\/plain", task\.id\)/);
  assert.match(ui, /updateTask\(task, \{ status \}\)/);
});

test("review workflow supports rework, suggestions, and sprint commitments", async () => {
  const status = await readFile("src/lib/status.ts", "utf8");
  const migration = await readFile("supabase/0004_review_commitments.sql", "utf8");
  const route = await readFile("src/app/api/sprint-commitments/route.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");

  assert.match(status, /Nacharbeit/);
  assert.match(status, /Vorschlag/);
  assert.match(migration, /create table if not exists sprint_commitments/);
  assert.match(route, /Founder können nur ihr eigenes Commitment ändern/);
  assert.match(ui, /CEO Review-Blatt/);
  assert.match(ui, /Review anfragen/);
});

test("founder self checklist is separate from CEO scoring", async () => {
  const migration = await readFile("supabase/0010_task_self_checklist.sql", "utf8");
  const reviewRoute = await readFile("src/app/api/tasks/[id]/review/route.ts", "utf8");
  const taskRoute = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");

  assert.match(migration, /self_dod_checked/);
  assert.match(taskRoute, /self_dod_checked/);
  assert.match(reviewRoute, /payload\.points === undefined \? defaultPoints/);
  assert.doesNotMatch(ui, /Founder-Arbeitsstand/);
  assert.doesNotMatch(ui, /Selbstkontrolle ohne Punkte/);
  assert.match(ui, /Review-Blatt/);
  assert.match(ui, /CEO Review-Blatt/);
  assert.match(ui, /reviewChecklistScore/);
  assert.match(ui, /Automatische CEO-Punkte/);
  assert.match(reviewRoute, /checklistPoints/);
  assert.match(reviewRoute, /acceptanceCriteriaMet/);
});

test("comments blockers and notification outbox are modeled before Google Chat delivery", async () => {
  const migration = await readFile("supabase/0005_comments_blockers_notifications.sql", "utf8");
  const data = await readFile("src/lib/planning-data.ts", "utf8");
  const commentsRoute = await readFile("src/app/api/tasks/[id]/comments/route.ts", "utf8");
  const blockersRoute = await readFile("src/app/api/tasks/[id]/blockers/route.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const thread = await readFile("src/components/task-comment-thread.tsx", "utf8");

  assert.match(migration, /create table if not exists task_comments/);
  assert.match(migration, /create table if not exists task_blockers/);
  assert.match(migration, /create table if not exists notification_events/);
  assert.match(migration, /review_due_at/);
  assert.match(data, /taskComments/);
  assert.match(data, /taskBlockers/);
  assert.match(data, /notificationEvents/);
  assert.match(commentsRoute, /task.comment/);
  assert.match(blockersRoute, /task.blocker_reported/);
  assert.match(ui, /Blocker melden/);
  assert.match(ui, /TaskCommentThread/);
  assert.match(thread, /Kommunikation/);
  assert.match(thread, /Nachfragen/);
  assert.match(thread, /Kommentieren/);
  assert.match(ui, /Review bis/);
});

test("tasks have a full detail page with communication thread", async () => {
  const route = await readFile("src/app/tasks/[id]/page.tsx", "utf8");
  const page = await readFile("src/components/task-detail-page.tsx", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");

  assert.match(route, /getPlanningData/);
  assert.match(route, /TaskDetailPage/);
  assert.match(route, /taskComments\.filter/);
  assert.match(page, /title="Kommentare"/);
  assert.match(page, /api\/tasks\/\$\{task\.id\}\/comments/);
  assert.match(page, /Relationships/);
  assert.match(page, /Sub-Issues/);
  assert.ok(page.indexOf("Sub-Issues") < page.indexOf("title=\"Kommentare\""));
  assert.match(ui, /Große Detailseite öffnen/);
  assert.match(ui, /href=\{`\/tasks\/\$\{task\.id\}`\}/);
});

test("task detail page supports github-like sidebar metadata and milestones", async () => {
  const migration = await readFile("supabase/0011_milestones_task_detail.sql", "utf8");
  const route = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const data = await readFile("src/lib/planning-data.ts", "utf8");
  const page = await readFile("src/components/task-detail-page.tsx", "utf8");
  const types = await readFile("src/lib/types.ts", "utf8");

  assert.match(migration, /create table if not exists milestones/);
  assert.match(migration, /milestone_id/);
  assert.match(route, /milestoneId/);
  assert.match(route, /dependsOn/);
  assert.match(route, /evidenceLink/);
  assert.match(data, /milestones/);
  assert.match(types, /export type Milestone/);
  assert.match(page, /Priorität/);
  assert.match(page, /Meilenstein/);
  assert.match(page, /Relationships/);
  assert.match(page, /updateTask/);
  assert.match(await readFile("AGENTS.md", "utf8"), /Milestone management is a core workflow/);
});

test("planning hierarchy treats sprint as time container and packages as group commitments", async () => {
  const migration = await readFile("supabase/0013_epic_group_commitment_hierarchy.sql", "utf8");
  const docs = await readFile("docs/planning-hierarchy.md", "utf8");
  const skill = await readFile("skills/fmd-planning-structure/SKILL.md", "utf8");
  const github = await readFile("src/lib/github.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const pkg = await readFile("package.json", "utf8");

  assert.match(migration, /packages add column if not exists milestone_id/);
  assert.match(docs, /Epic \/ Meilenstein[\s\S]*Group Commitment[\s\S]*Deliverable[\s\S]*Sub-Issue/);
  assert.match(docs, /Sprint ist ein Zeitcontainer/);
  assert.match(skill, /Sprint is a time container/);
  assert.match(github, /Epic \/ Milestone/);
  assert.match(github, /Group Commitment/);
  assert.match(ui, /Epic \/ Meilenstein/);
  assert.match(ui, /Group Commitment/);
  assert.match(pkg, /verify:hierarchy/);
});

test("management repo cleanup plan protects legacy templates from deletion without approval", async () => {
  const plan = await readFile("docs/management-repo-v2-plan.md", "utf8");
  const deliverableTemplate = await readFile("docs/management-templates-v2/deliverable.yml", "utf8");
  const groupTemplate = await readFile("docs/management-templates-v2/group-commitment.yml", "utf8");
  const subIssueTemplate = await readFile("docs/management-templates-v2/sub-issue.yml", "utf8");

  assert.match(plan, /Keine Datei im Management-Repo löschen/);
  assert.match(plan, /Erst archivieren statt endgültig löschen/);
  assert.match(plan, /auto-triage\.yml/);
  assert.match(plan, /sprint-title-sync\.yml/);
  assert.match(deliverableTemplate, /GitHub ist Backup, nicht Quelle der Wahrheit/);
  assert.match(deliverableTemplate, /Acceptance Criteria/);
  assert.match(groupTemplate, /Epic \/ Meilenstein/);
  assert.match(subIssueTemplate, /nicht score-relevant/);
});

test("google chat delivery is outbox based and webhook gated", async () => {
  const migration = await readFile("supabase/0008_google_chat_delivery.sql", "utf8");
  const route = await readFile("src/app/api/notifications/deliver/route.ts", "utf8");
  const chat = await readFile("src/lib/google-chat.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");

  assert.match(migration, /google_chat_user_id/);
  assert.match(migration, /google_chat_dm_space/);
  assert.match(migration, /notification_preferences/);
  assert.match(route, /requireOperationalLead/);
  assert.match(route, /notification_events/);
  assert.match(route, /notification_deliveries/);
  assert.match(chat, /GOOGLE_CHAT_WEBHOOK_URL/);
  assert.match(chat, /formatGoogleChatMessage/);
  assert.match(ui, /Google Chat Outbox/);
  assert.match(ui, /Pending senden/);
});

test("health and supabase verification detect operational migrations", async () => {
  const health = await readFile("src/app/api/health/route.ts", "utf8");
  const verify = await readFile("scripts/verify-supabase.mjs", "utf8");
  const operational = await readFile("scripts/verify-operational.mjs", "utf8");
  const pkg = await readFile("package.json", "utf8");

  assert.match(health, /profiles\.google_chat/);
  assert.match(health, /notification_preferences/);
  assert.match(health, /tasks\.carryover/);
  assert.match(health, /schemaReady/);
  assert.match(verify, /0008_google_chat_delivery\.sql/);
  assert.match(verify, /0009_sprint_carryover\.sql/);
  assert.match(verify, /notificationDeliveries/);
  assert.match(operational, /Founder Planning/);
  assert.match(operational, /githubMappedProfiles/);
  assert.match(operational, /googleChatConfigured/);
  assert.match(pkg, /verify:operational/);
});

test("task creation supports deliverables proposals and non scoring sub issues", async () => {
  const migration = await readFile("supabase/0006_task_creation_hierarchy.sql", "utf8");
  const route = await readFile("src/app/api/tasks/route.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const types = await readFile("src/lib/types.ts", "utf8");

  assert.match(migration, /task_type/);
  assert.match(migration, /parent_task_id/);
  assert.match(migration, /score_relevant/);
  assert.match(route, /task\.proposed/);
  assert.match(route, /Founder können nur eigene Deliverables verfeinern/);
  assert.match(route, /taskType === "deliverable"/);
  assert.match(ui, /NewTaskDialog/);
  assert.match(ui, /Sub-Issues/);
  assert.match(ui, /nicht score-relevant/);
  assert.match(types, /TaskType = "deliverable" \| "proposal" \| "sub_issue"/);
});

test("biweekly meeting attendance has scoring, absence reasons and updates", async () => {
  const migration = await readFile("supabase/0007_meeting_attendance_scoring.sql", "utf8");
  const route = await readFile("src/app/api/meetings/[id]/attendance/route.ts", "utf8");
  const data = await readFile("src/lib/planning-data.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const types = await readFile("src/lib/types.ts", "utf8");

  assert.match(migration, /create table if not exists meetings/);
  assert.match(migration, /create table if not exists meeting_attendance/);
  assert.match(migration, /reason_accepted/);
  assert.match(migration, /written_update/);
  assert.match(route, /meeting\.attendance_updated/);
  assert.match(route, /Founder können nur ihre eigene Meeting-Rückmeldung ändern/);
  assert.match(data, /meetingAttendance/);
  assert.match(ui, /Biweekly Meeting & Updates/);
  assert.match(ui, /Triftiger Grund/);
  assert.match(ui, /max\. 4 Punkte/);
  assert.match(types, /MeetingAttendanceStatus/);
});

test("app choice controls use custom components instead of browser-native pickers", async () => {
  const files = (await listFiles("src", ".tsx")).filter((file) => ![
    "src/components/custom-select.tsx",
    "src/components/custom-date-picker.tsx",
  ].includes(file));
  const violations = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (
      source.includes("<select")
      || source.includes("<option")
      || source.includes('type="date"')
      || source.includes('type="datetime-local"')
    ) {
      violations.push(file);
    }
  }

  assert.deepEqual(violations, []);
});


