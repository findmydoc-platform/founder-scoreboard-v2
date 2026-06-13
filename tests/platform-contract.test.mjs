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

test("app UI uses custom dropdown and calendar controls", async () => {
  const files = await listFiles("src", ".tsx");
  const approved = new Set([
    "src/components/custom-select.tsx",
    "src/components/custom-date-picker.tsx",
  ]);

  for (const file of files) {
    if (approved.has(file)) continue;
    const source = await readFile(file, "utf8");

    assert.doesNotMatch(source, /<select\b/);
    assert.doesNotMatch(source, /<\/select>/);
    assert.doesNotMatch(source, /<option\b/);
    assert.doesNotMatch(source, /type=["']date["']/);
    assert.doesNotMatch(source, /type=["']datetime-local["']/);
  }
});

test("visible German app copy keeps real UTF-8 umlauts", async () => {
  const files = [
    ...(await listFiles("src", ".tsx")),
    ...(await listFiles("docs", ".md")),
    "README.md",
    "AGENTS.md",
  ];
  const suspiciousFallbacks = /\b(fuer|zurueck|waehlen|loeschen|naechst|koennen|moech|groess|schliess|Ueber|Aender|Oeff)\b/;

  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, suspiciousFallbacks, `${file} contains likely ASCII umlaut fallback in visible copy`);
  }
});

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
  assert.match(route, /x-github-provider-token/);
  assert.match(route, /githubUserForToken/);
  assert.match(route, /GitHub User-Token passt nicht zum angemeldeten Teamprofil/);
  assert.match(route, /buildSyncContext/);
  assert.match(route, /task_comments/);
  assert.match(route, /task_blockers/);
  assert.match(route, /task_activity/);
  assert.match(route, /parent_task_id/);
  assert.match(route, /createIfMissing/);
  assert.match(route, /Diese Aufgabe ist App-only/);
  assert.match(route, /Nur Deliverables werden als eigenständige GitHub-Issues gespiegelt/);
  assert.match(route, /github_sync_status: "pending"/);
  assert.match(route, /github_sync_status: "synced"/);
  assert.match(route, /github_sync_status: "failed"/);
});

test("github issue export includes structure review blockers and comments", async () => {
  const github = await readFile("src/lib/github.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const platform = await readFile("src/lib/platform.ts", "utf8");

  assert.match(github, /taskIssueTitle/);
  assert.match(github, /taskIssueLabels/);
  assert.match(github, /task\.taskType === "deliverable" \? "deliverable"/);
  assert.match(github, /review:ready/);
  assert.match(github, /Problem Statement/);
  assert.match(github, /Intended Outcome/);
  assert.match(github, /Acceptance Criteria/);
  assert.match(github, /Score-relevant/);
  assert.match(github, /Offene Blocker/);
  assert.match(github, /Relationships/);
  assert.match(github, /Wartet auf/);
  assert.match(github, /Blockiert/);
  assert.match(github, /Letzte Kommentare/);
  assert.match(github, /Aktivitätsprotokoll/);
  assert.match(github, /Parent Deliverable/);
  assert.match(github, /Source of Truth/);
  assert.match(github, /linkedIssueNumber/);
  assert.match(github, /task\.issueNumber/);
  assert.match(platform, /hasGitHubIssue/);
  assert.match(ui, /syncTaskToGitHub/);
  assert.match(ui, /Jetzt spiegeln/);
  assert.match(ui, /GitHub Sync Queue/);
  assert.match(ui, /Verknüpfte Issues synchronisieren/);
  assert.match(ui, /createIfMissing: false/);
});

test("task relationships use github-like blocked by and blocking semantics", async () => {
  const migration = await readFile("supabase/0016_task_relationship_edges.sql", "utf8");
  const route = await readFile("src/app/api/tasks/[id]/relationships/route.ts", "utf8");
  const data = await readFile("src/lib/planning-data.ts", "utf8");
  const types = await readFile("src/lib/types.ts", "utf8");
  const platform = await readFile("src/lib/platform.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const section = await readFile("src/components/task-relationships-section.tsx", "utf8");
  const detail = await readFile("src/components/task-detail-page.tsx", "utf8");
  const script = await readFile("scripts/migrate-task-relationships.mjs", "utf8");

  assert.match(migration, /create table if not exists task_relationship_edges/);
  assert.match(migration, /blocked_by/);
  assert.match(migration, /blocks/);
  assert.match(migration, /relates_to/);
  assert.match(route, /requireOperationalLead/);
  assert.match(route, /task.relationship_created/);
  assert.match(route, /task.relationship_deleted/);
  assert.match(route, /github_sync_status: "not_synced"/);
  assert.match(types, /TaskRelationType/);
  assert.match(data, /task_relationship_edges/);
  assert.match(platform, /taskRelationsFor/);
  assert.match(platform, /hasOpenWaitingRelation/);
  assert.match(ui, /Relationship hinzufügen/);
  assert.match(ui, /Relationship konnte nicht gespeichert werden/);
  assert.match(ui, /Wartet auf/);
  assert.match(ui, /Verknüpft mit/);
  assert.match(detail, /TaskRelationshipsSection/);
  assert.match(section, /RelationshipPanelList/);
  assert.match(section, /Relationship hinzufügen/);
  assert.match(section, /Wartet auf/);
  assert.match(section, /Verknüpft mit/);
  assert.match(script, /task_dependencies/);
  assert.match(script, /relation_type: "blocked_by"/);
});

test("github sync queue is reopened by task comments blockers and relationship changes", async () => {
  const taskRoute = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const commentsRoute = await readFile("src/app/api/tasks/[id]/comments/route.ts", "utf8");
  const blockersRoute = await readFile("src/app/api/tasks/[id]/blockers/route.ts", "utf8");
  const relationshipsRoute = await readFile("src/app/api/tasks/[id]/relationships/route.ts", "utf8");
  const syncRoute = await readFile("src/app/api/tasks/[id]/sync-github/route.ts", "utf8");
  const github = await readFile("src/lib/github.ts", "utf8");

  assert.match(taskRoute, /payload\.githubSyncStatus === undefined/);
  assert.match(taskRoute, /github_sync_status = "not_synced"/);
  assert.match(commentsRoute, /github_sync_status: githubSyncError \? "failed" : "not_synced"/);
  assert.match(commentsRoute, /github_sync_error: githubSyncError \|\| null/);
  assert.match(blockersRoute, /github_sync_status: "not_synced"/);
  assert.match(relationshipsRoute, /github_sync_status: "not_synced"/);
  assert.match(syncRoute, /task_relationship_edges/);
  assert.match(syncRoute, /activitiesResult/);
  assert.match(syncRoute, /profileNameById\.get\(relation\.task\?\.owner/);
  assert.match(github, /Problem Statement/);
  assert.match(github, /Review fällig bis/);
  assert.match(github, /Priorität/);
  assert.match(github, /Verknüpft mit/);
});

test("github sync verification is read-only and checks the management repo", async () => {
  const script = await readFile("scripts/verify-github-sync.mjs", "utf8");
  const pkg = await readFile("package.json", "utf8");

  assert.match(pkg, /verify:github-sync/);
  assert.match(script, /logged_in_github_user_provider_token/);
  assert.match(script, /GITHUB_SYNC_OWNER/);
  assert.match(script, /GITHUB_SYNC_REPO/);
  assert.match(script, /linkedDeliverables\.filter/);
  assert.match(script, /automaticSyncScope/);
  assert.match(script, /syncQueuePreview/);
  assert.match(script, /appOnlyPreview/);
  assert.doesNotMatch(script, /method: "POST"/);
  assert.doesNotMatch(script, /method: "PATCH"/);
  assert.doesNotMatch(script, /method: "DELETE"/);
});

test("app-only tasks are visibly marked without creating github issues", async () => {
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const detail = await readFile("src/components/task-detail-page.tsx", "utf8");
  const taskCard = await readFile("src/components/task-card.tsx", "utf8");
  const githubSyncCard = await readFile("src/components/task-github-sync-card.tsx", "utf8");

  assert.match(ui, /GitHubMissingBadge/);
  assert.match(taskCard, /App-only/);
  assert.match(ui, /App-only-Aufgaben bleiben dauerhaft sichtbar/);
  assert.match(ui, /Diese Liste bleibt dauerhaft erhalten/);
  assert.match(ui, /Vorschläge und Deliverables bleiben App-only/);
  assert.match(ui, /GitHub anlegen/);
  assert.match(ui, /Keine App-only Aufgaben ohne GitHub-Issue/);
  assert.match(taskCard, /Nur in der App: noch kein GitHub-Issue verknüpft/);
  assert.match(githubSyncCard, /Nur in der App: noch kein GitHub-Issue verknüpft/);
  assert.match(githubSyncCard, /GitHub-Issue anlegen/);
  assert.match(ui, /createIfMissing: true/);
  assert.match(ui, /onCreateGitHubIssue/);
  assert.match(detail, /TaskGitHubSyncCard/);
  assert.match(detail, /createIfMissing: true/);
  assert.match(detail, /githubState/);
  assert.match(ui, /nicht automatisch dupliziert/);
  assert.match(githubSyncCard, /nicht automatisch dupliziert/);
});

test("existing management issues are linked before creating duplicates", async () => {
  const script = await readFile("scripts/plan-github-issue-linking.mjs", "utf8");
  const docs = await readFile("docs/planning-hierarchy.md", "utf8");

  assert.match(script, /normalizeTitle/);
  assert.match(script, /exactMatches/);
  assert.match(script, /ambiguousMatches/);
  assert.match(script, /github_issue_number/);
  assert.match(script, /--apply/);
  assert.match(docs, /Bestehende GitHub-Issues/);
  assert.match(docs, /nicht gelöscht und nicht dupliziert/);
});

test("task template v2 separates outcome criteria evidence and DoD", async () => {
  const migration = await readFile("supabase/0012_task_template_v2.sql", "utf8");
  const createRoute = await readFile("src/app/api/tasks/route.ts", "utf8");
  const updateRoute = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const types = await readFile("src/lib/types.ts", "utf8");
  const data = await readFile("src/lib/planning-data.ts", "utf8");
  const dataMappers = await readFile("src/lib/planning-data-mappers.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const detail = await readFile("src/components/task-detail-page.tsx", "utf8");
  const briefSection = await readFile("src/components/task-brief-section.tsx", "utf8");
  const docs = await readFile("docs/task-template-v2.md", "utf8");

  assert.match(migration, /problem_statement/);
  assert.match(migration, /intended_outcome/);
  assert.match(migration, /acceptance_criteria/);
  assert.match(migration, /evidence_required/);
  assert.match(createRoute, /problemStatement/);
  assert.match(updateRoute, /acceptanceCriteria/);
  assert.match(types, /problemStatement/);
  assert.match(data, /mapTask/);
  assert.match(dataMappers, /problem_statement/);
  assert.match(ui, /Template v2/);
  assert.match(detail, /TaskBriefSection/);
  assert.match(briefSection, /Aufgabenbrief/);
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

test("github oauth prepares user-based sync without storing provider tokens", async () => {
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const requestContext = await readFile("src/hooks/use-planning-request-context.ts", "utf8");
  const detail = await readFile("src/components/task-detail-page.tsx", "utf8");
  const thread = await readFile("src/components/task-comment-thread.tsx", "utf8");
  const githubSyncCard = await readFile("src/components/task-github-sync-card.tsx", "utf8");
  const authHook = await readFile("src/hooks/use-planning-auth.ts", "utf8");
  const providerTokenMemory = await readFile("src/lib/github-provider-token.ts", "utf8");
  const supabase = await readFile("src/lib/supabase.ts", "utf8");
  const syncRoute = await readFile("src/app/api/tasks/[id]/sync-github/route.ts", "utf8");
  const commentsRoute = await readFile("src/app/api/tasks/[id]/comments/route.ts", "utf8");
  const attachmentRoute = await readFile("src/app/api/tasks/[id]/attachments/route.ts", "utf8");
  const github = await readFile("src/lib/github.ts", "utf8");
  const rules = await readFile("AGENTS.md", "utf8");

  assert.match(authHook, /signInWithOAuth/);
  assert.match(authHook, /scopes: "repo read:user user:email"/);
  assert.match(authHook, /provider_token/);
  assert.match(ui, /usePlanningRequestContext/);
  assert.match(requestContext, /x-github-provider-token/);
  assert.match(detail, /x-github-provider-token/);
  assert.match(supabase, /persistSession: true/);
  assert.match(supabase, /autoRefreshToken: true/);
  assert.match(authHook, /refreshSessionState/);
  assert.match(authHook, /supabase\.auth\.refreshSession\(\)/);
  assert.match(authHook, /visibilitychange/);
  assert.match(authHook, /5 \* 60 \* 1000/);
  assert.match(requestContext, /getRememberedGitHubProviderToken/);
  assert.match(authHook, /clearRememberedGitHubProviderToken/);
  assert.match(detail, /getRememberedGitHubProviderToken/);
  assert.match(ui, /GitHub-Rechte erneuern/);
  assert.match(githubSyncCard, /GitHub-Rechte erneuern/);
  assert.match(ui, /Sync, Kommentare und Anhänge/);
  assert.match(githubSyncCard, /Sync, Kommentare und Anhänge/);
  assert.match(thread, /onUploadAttachment/);
  assert.match(providerTokenMemory, /rememberedGitHubProviderToken/);
  assert.match(providerTokenMemory, /clearRememberedGitHubProviderToken/);
  assert.doesNotMatch(providerTokenMemory, /localStorage|sessionStorage|indexedDB/i);
  assert.match(ui, /GitHub User-Token/);
  assert.match(syncRoute, /x-github-provider-token/);
  assert.match(syncRoute, /githubUser\.login\.toLowerCase\(\) !== expectedLogin/);
  assert.match(commentsRoute, /createGitHubIssueComment/);
  assert.match(commentsRoute, /githubSyncError/);
  assert.match(attachmentRoute, /githubUserForToken/);
  assert.match(attachmentRoute, /GitHub User-Token passt nicht zum angemeldeten Teamprofil/);
  assert.match(attachmentRoute, /x-github-provider-token/);
  assert.doesNotMatch(commentsRoute, /task_comments"\)\.delete/);
  assert.match(github, /createGitHubIssueComment/);
  assert.match(github, /uploadGitHubAttachment/);
  assert.match(github, /getGitHubIssue/);
  assert.match(github, /api\.github\.com\/repos\/\$\{owner\}\/\$\{repo\}\/contents/);
  assert.match(github, /https:\/\/api\.github\.com\/user/);
  assert.match(rules, /provider_token/);
  assert.match(rules, /Never persist or log provider tokens/);
  assert.doesNotMatch(syncRoute, /GITHUB_SYNC_TOKEN/);
  assert.doesNotMatch(commentsRoute, /GITHUB_SYNC_TOKEN/);
});

test("strict auth gates planning data until a valid session is present", async () => {
  const page = await readFile("src/app/page.tsx", "utf8");
  const api = await readFile("src/app/api/planning-data/route.ts", "utf8");
  const authz = await readFile("src/lib/authz.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const authControl = await readFile("src/components/auth-control.tsx", "utf8");
  const authHook = await readFile("src/hooks/use-planning-auth.ts", "utf8");

  assert.match(page, /requiresSupabaseAuth\(\)/);
  assert.match(page, /emptyPlanningData/);
  assert.match(api, /requirePlatformRole\(request, \["ceo", "founder", "deputy", "viewer"\]\)/);
  assert.match(api, /currentProfile: auth\.profile/);
  assert.match(authz, /auth_user_id/);
  assert.match(authz, /ilike\("github_login", githubLogin\)/);
  assert.match(authz, /unterschiedliche Teamprofile/);
  assert.doesNotMatch(authz, /\.or\(`auth_user_id/);
  assert.match(authHook, /Du bist abgemeldet/);
  assert.match(authHook, /serverCurrentProfile/);
  assert.match(authHook, /authUserId/);
  assert.match(ui, /<AppBrand \/>/);
  assert.doesNotMatch(ui, /ShieldCheck/);
  assert.match(ui, /variant="gate"/);
  assert.match(authControl, /Rollen und Zugriff werden nach dem Login/);
  assert.match(authControl, /Mit GitHub anmelden/);
  assert.doesNotMatch(authControl, /Login öffnen/);
  assert.match(authHook, /supabase\.auth\.signOut\(\{ scope: "global" \}\)/);
  assert.match(ui, /\/api\/planning-data/);
});

test("task review uses operational lead route and keeps rework non-final", async () => {
  const route = await readFile("src/app/api/tasks/[id]/review/route.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const sprintViewModel = await readFile("src/lib/sprint-score-view-model.ts", "utf8");

  assert.match(route, /requireOperationalLead/);
  assert.match(route, /task_reviews/);
  assert.match(route, /scoreFinal = decision !== "changes_requested"/);
  assert.match(route, /const points = reviewDecisionPoints\(decision, checklist\)/);
  assert.match(route, /github_sync_status: "not_synced"/);
  assert.match(route, /Nacharbeit/);
  assert.match(route, /checklist/);
  assert.match(route, /acceptanceCriteriaMet/);
  assert.match(sprintViewModel, /Acceptance Criteria erfüllt/);
  assert.match(ui, /CEO-Score/);
  assert.match(ui, /Nächster Schritt/);
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
  assert.match(route, /review_status === "partial"/);
  assert.match(route, /preserveScore/);
  assert.match(route, /deadline: nextSprint\.end_date \|\| null/);
  assert.match(route, /github_issue_number: null/);
  assert.match(route, /missed_uncommunicated/);
  assert.match(route, /accepted_carryover/);
  assert.match(route, /sprint\.task_carried_over/);
  assert.match(ui, /Sprint-Verlauf/);
  assert.match(ui, /Carry-over/);
  assert.match(types, /carryoverReason/);
});

test("sprint configuration is operational-lead only and audited", async () => {
  const route = await readFile("src/app/api/sprints/[id]/route.ts", "utf8");
  const planRoute = await readFile("src/app/api/sprints/route.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");

  assert.match(route, /requireOperationalLead/);
  assert.match(route, /score_locked/);
  assert.match(route, /Gelockte Sprints können nicht mehr geändert werden/);
  assert.match(route, /Sprint-Start darf nicht nach dem Sprint-Ende liegen/);
  assert.match(route, /Zeitraum, Name und Review-Datum dürfen nur bei leeren Sprints geändert werden/);
  assert.match(route, /sprint.update/);
  assert.match(planRoute, /protectedSprintIds/);
  assert.match(ui, /findCurrentSprint/);
  assert.match(ui, /Aktueller Sprint/);
  assert.match(ui, /Zeitraum geschützt/);
  assert.match(ui, /current: currentSprint\?\.id === item\.id/);
  assert.match(ui, /locked: data\.tasks\.some/);
  assert.doesNotMatch(ui, /· aktuell|· geschützt/);
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
  assert.match(route, /google_chat_user_id/);
  assert.match(route, /google_chat_dm_space/);
  assert.match(route, /notifications_enabled/);
  assert.match(route, /google_calendar_email/);
  assert.match(route, /google_calendar_sync_enabled/);
  assert.match(migration, /profile_color/);
  assert.match(migration, /profiles_profile_color_hex/);
  assert.match(data, /profile_color/);
  assert.match(data, /google_calendar_last_synced_at/);
  assert.match(ui, /profileColorOptions/);
  assert.match(ui, /Post-it-Farbe/);
  assert.match(ui, /Google Chat User-ID/);
  assert.match(ui, /Google Chat DM-Space/);
  assert.match(ui, /Google-Chat-Benachrichtigungen/);
  assert.match(ui, /Kalender-E-Mail/);
  assert.match(ui, /CEO-Bearbeitung aktiv/);
  assert.match(ui, /Nur Ansicht/);
  assert.match(ui, /canManageTeam/);
  assert.match(ui, /Aktuell ist keine aktive Deputy-Vertretung gesetzt/);
  assert.match(ui, /Rollen, Stammdaten und der zentrale Benachrichtigungsschalter sind CEO-geschützt/);
});

test("notification preferences are editable per profile and event type", async () => {
  const route = await readFile("src/app/api/notification-preferences/route.ts", "utf8");
  const data = await readFile("src/lib/planning-data.ts", "utf8");
  const types = await readFile("src/lib/types.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const policy = await readFile("src/lib/notification-policy.ts", "utf8");

  assert.match(route, /requireFounder/);
  assert.match(route, /notification_preferences/);
  assert.match(route, /allowedEventTypes/);
  assert.match(route, /Keine Berechtigung für diese Benachrichtigungseinstellung/);
  assert.match(route, /notification_preference\.update/);
  assert.match(data, /notificationPreferenceResult/);
  assert.match(data, /mapNotificationPreference/);
  assert.match(types, /export type NotificationPreference/);
  assert.match(ui, /Google-Chat-Events/);
  assert.match(ui, /onUpdateNotificationPreference/);
  assert.match(ui, /notificationEventLabel/);
  assert.match(policy, /GoogleChatDigestEventType/);
  assert.match(policy, /Review angefragt/);
});

test("decision audit loads before and after data for collapsible diffs", async () => {
  const data = await readFile("src/lib/planning-data.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");

  assert.match(data, /before_data,after_data/);
  assert.match(ui, /auditChanges/);
  assert.match(ui, /Audit Trail/);
  assert.match(ui, /Vorher/);
  assert.match(ui, /Nachher/);
});

test("board tasks can be dragged between status columns", async () => {
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const taskCard = await readFile("src/components/task-card.tsx", "utf8");

  assert.match(taskCard, /draggable=\{Boolean\(onDragStart\)\}/);
  assert.match(ui, /onDrop=\{\(event\) => dropTaskOnStatus\(status, event\)\}/);
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
  assert.match(reviewRoute, /reviewDecisionPoints/);
  assert.match(reviewRoute, /const points = reviewDecisionPoints\(decision, checklist\)/);
  assert.doesNotMatch(ui, /Founder-Arbeitsstand/);
  assert.doesNotMatch(ui, /Selbstkontrolle ohne Punkte/);
  assert.match(ui, /Review-Blatt/);
  assert.match(ui, /CEO Review-Blatt/);
  assert.match(ui, /Founder-Arbeitsblatt bleibt Arbeitsstand ohne Score/);
  assert.match(ui, /reviewChecklistScore/);
  assert.match(ui, /Automatische CEO-Punkte/);
  assert.match(ui, /Punkteformel: vier CEO-Kriterien ergeben je 2,5 Punkte/);
  assert.match(reviewRoute, /checklistPoints/);
  assert.match(reviewRoute, /acceptanceCriteriaMet/);
});

test("comments blockers and notification outbox are modeled before Google Chat delivery", async () => {
  const migration = await readFile("supabase/0005_comments_blockers_notifications.sql", "utf8");
  const externalMigration = await readFile("supabase/0018_task_external_comments.sql", "utf8");
  const data = await readFile("src/lib/planning-data.ts", "utf8");
  const commentsRoute = await readFile("src/app/api/tasks/[id]/comments/route.ts", "utf8");
  const githubCommentsRoute = await readFile("src/app/api/tasks/[id]/github-comments/route.ts", "utf8");
  const githubAssetsRoute = await readFile("src/app/api/github-assets/route.ts", "utf8");
  const attachmentRoute = await readFile("src/app/api/tasks/[id]/attachments/route.ts", "utf8");
  const blockersRoute = await readFile("src/app/api/tasks/[id]/blockers/route.ts", "utf8");
  const taskRoute = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const syncRoute = await readFile("src/app/api/tasks/[id]/sync-github/route.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const thread = await readFile("src/components/task-comment-thread.tsx", "utf8");
  const timeline = await readFile("src/components/task-comment-timeline.tsx", "utf8");
  const commentBody = await readFile("src/components/task-comment-body.tsx", "utf8");
  const githubCommentImage = await readFile("src/components/github-comment-image.tsx", "utf8");
  const composer = await readFile("src/components/task-comment-composer.tsx", "utf8");
  const types = await readFile("src/lib/types.ts", "utf8");

  assert.match(migration, /create table if not exists task_comments/);
  assert.match(externalMigration, /create table if not exists task_external_comments/);
  assert.match(externalMigration, /unique \(source, external_id\)/);
  assert.match(migration, /create table if not exists task_blockers/);
  assert.match(migration, /create table if not exists notification_events/);
  assert.match(migration, /review_due_at/);
  assert.match(data, /taskComments/);
  assert.match(data, /taskExternalComments/);
  assert.match(data, /task_external_comments/);
  assert.match(data, /taskBlockers/);
  assert.match(data, /taskActivity/);
  assert.match(data, /task_activity/);
  assert.match(data, /notificationEvents/);
  assert.match(commentsRoute, /task.comment/);
  assert.match(commentsRoute, /Kommentar hinzugefügt/);
  assert.match(attachmentRoute, /requireFounder/);
  assert.match(attachmentRoute, /uploadGitHubAttachment/);
  assert.match(attachmentRoute, /\.fmd-attachments\/tasks/);
  assert.match(attachmentRoute, /10 MB/);
  assert.match(attachmentRoute, /markdown/);
  assert.match(githubCommentsRoute, /listGitHubIssueComments/);
  assert.match(githubCommentsRoute, /getGitHubIssue/);
  assert.match(githubCommentsRoute, /extractEvidenceFromIssueBody/);
  assert.match(githubCommentsRoute, /Evidence aus GitHub-Issue importiert/);
  assert.match(githubCommentsRoute, /evidenceLink/);
  assert.match(githubCommentsRoute, /isAppMirroredComment/);
  assert.match(githubCommentsRoute, /task_external_comments/);
  assert.match(githubCommentsRoute, /source,external_id/);
  assert.doesNotMatch(githubCommentsRoute, /events/);
  assert.match(blockersRoute, /task.blocker_reported/);
  assert.match(taskRoute, /Status geändert/);
  assert.match(taskRoute, /activityMessages/);
  assert.match(syncRoute, /GitHub Sync ausgeführt/);
  assert.match(ui, /Blocker melden/);
  assert.match(ui, /TaskCommentThread/);
  assert.match(ui, /selectedTaskActivity/);
  assert.match(thread, /Kommunikation/);
  assert.match(thread, /activities/);
  assert.match(thread, /externalComments/);
  assert.match(thread, /GitHub aktualisieren/);
  assert.match(thread, /github-comment/);
  assert.match(thread, /timeline/);
  assert.match(timeline, /describeActivity/);
  assert.match(timeline, /repairGermanText/);
  assert.match(timeline, /activityToneClass/);
  assert.match(timeline, /Status geändert/);
  assert.match(timeline, /Review finalisiert/);
  assert.match(timeline, /Relationship/);
  assert.match(thread, /CommentBody/);
  assert.match(githubCommentImage, /<img\b/);
  assert.match(commentBody, /react-markdown/);
  assert.match(commentBody, /remark-gfm/);
  assert.match(commentBody, /remark-breaks/);
  assert.match(commentBody, /GitHubCommentImage/);
  assert.match(commentBody, /overflow-x-auto/);
  assert.match(commentBody, /\[overflow-wrap:anywhere\]/);
  assert.match(commentBody, /skipHtml/);
  assert.match(githubCommentImage, /\/api\/github-assets\?url=/);
  assert.match(githubCommentImage, /URL\.createObjectURL/);
  assert.match(commentBody, /safeHref/);
  assert.match(githubCommentImage, /useState\(false\)/);
  assert.match(githubCommentImage, /loadViaProxy/);
  assert.match(githubCommentImage, /if \(!isGitHubAsset \|\| proxyAttempted\)/);
  assert.match(composer, /showCommentPreview/);
  assert.match(composer, /Vorschau/);
  assert.match(githubCommentImage, /getBrowserSupabase/);
  assert.match(composer, /onUploadAttachment/);
  assert.match(composer, /type="file"/);
  assert.match(composer, /Paperclip/);
  assert.match(composer, /Anhang/);
  assert.match(githubAssetsRoute, /requireFounder/);
  assert.match(githubAssetsRoute, /x-github-provider-token/);
  assert.match(githubAssetsRoute, /githubUserForToken/);
  assert.match(githubAssetsRoute, /user-attachments\/assets/);
  assert.match(githubAssetsRoute, /content-type/);
  assert.match(githubAssetsRoute, /image\//);
  assert.match(githubCommentImage, /Anhang in GitHub öffnen/);
  assert.match(thread, /new Date\(left\.createdAt\)/);
  assert.match(timeline, /Nachfragen/);
  assert.match(composer, /Kommentieren/);
  assert.match(types, /TaskActivity/);
  assert.match(types, /TaskExternalComment/);
  assert.match(ui, /Review bis/);
});

test("task route opens the detail panel inside the planning shell", async () => {
  const route = await readFile("src/app/tasks/[id]/page.tsx", "utf8");
  const page = await readFile("src/components/task-detail-page.tsx", "utf8");
  const detailsCard = await readFile("src/components/task-details-card.tsx", "utf8");
  const commentsHook = await readFile("src/hooks/use-task-comments.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const brand = await readFile("src/components/app-brand.tsx", "utf8");
  const sidebar = await readFile("src/components/app-sidebar.tsx", "utf8");

  assert.match(route, /getPlanningData/);
  assert.match(route, /PlanningApp/);
  assert.match(route, /TaskDetailPage/);
  assert.match(route, /view === "full"/);
  assert.match(route, /initialTaskId=\{id\}/);
  assert.match(ui, /initialTaskId/);
  assert.match(ui, /useSearchParams/);
  assert.match(ui, /fullTaskView/);
  assert.match(ui, /searchParams\.get\("view"\) === "full"/);
  assert.match(ui, /openTaskPanel/);
  assert.match(ui, /router\.push\(`\/tasks\/\$\{encodeURIComponent\(taskId\)\}`\)/);
  assert.match(ui, /router\.back\(\)/);
  assert.match(ui, /event\.key !== "Backspace"/);
  assert.match(ui, /TaskDetailPanel/);
  assert.match(ui, /<TaskDetailPage/);
  assert.match(ui, /bg-slate-950\/\[0\.03\]/);
  assert.match(ui, /aria-label="Detailpanel schließen"/);
  assert.match(ui, /Große Ansicht/);
  assert.match(ui, /view=full/);
  assert.match(page, /AppSidebar/);
  assert.match(page, /TaskBriefSection/);
  assert.match(page, /TaskRelationshipsSection/);
  assert.match(page, /TaskSubIssuesSection/);
  assert.match(page, /TaskContextSection/);
  assert.match(page, /TaskCommentThread/);
  assert.match(page, /TaskDetailsCard/);
  assert.match(page, /briefEditing/);
  assert.match(page, /detailsEditing/);
  assert.match(page, /detailsEditSnapshot/);
  assert.match(page, /canManageTaskMeta/);
  assert.match(page, /title="Kommentare"/);
  assert.match(commentsHook, /api\/tasks\/\$\{task\.id\}\/comments/);
  assert.match(detailsCard, /Priorität/);
  assert.match(detailsCard, /Initiative/);
  assert.match(detailsCard, /Epic \/ Meilenstein/);
  assert.match(detailsCard, /CustomDatePicker/);
  assert.match(detailsCard, /Bearbeiten/);
  assert.match(detailsCard, /availableStatusOptions/);
  assert.match(detailsCard, /canManageTaskMeta/);
  assert.match(ui, /AppSidebar/);
  assert.match(sidebar, /appNavItems/);
  assert.match(sidebar, /Hauptnavigation/);
  assert.match(sidebar, /Meeting Finder/);
  assert.match(sidebar, /FMD-Tools/);
  assert.match(sidebar, /Sprint & Score/);
  assert.match(sidebar, /Decision Log/);
  assert.match(sidebar, /AppBrand/);
  assert.match(ui, /AppBrand/);
  assert.match(brand, /cross-mark\.svg/);
  assert.match(brand, /FounderOps/);
  assert.doesNotMatch(route, /detailNavItems/);
});

test("task detail page supports github-like sidebar metadata and milestones", async () => {
  const migration = await readFile("supabase/0011_milestones_task_detail.sql", "utf8");
  const creatorMigration = await readFile("supabase/0017_task_created_by.sql", "utf8");
  const route = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const data = await readFile("src/lib/planning-data.ts", "utf8");
  const dataMappers = await readFile("src/lib/planning-data-mappers.ts", "utf8");
  const page = await readFile("src/components/task-detail-page.tsx", "utf8");
  const detailsCard = await readFile("src/components/task-details-card.tsx", "utf8");
  const contextSection = await readFile("src/components/task-context-section.tsx", "utf8");
  const commentsHook = await readFile("src/hooks/use-task-comments.ts", "utf8");
  const comments = await readFile("src/components/task-comment-thread.tsx", "utf8");
  const app = await readFile("src/components/planning-app.tsx", "utf8");
  const types = await readFile("src/lib/types.ts", "utf8");

  assert.match(migration, /create table if not exists milestones/);
  assert.match(migration, /milestone_id/);
  assert.match(creatorMigration, /created_by text references profiles/);
  assert.match(route, /milestoneId/);
  assert.match(route, /packageId/);
  assert.match(route, /deadline/);
  assert.match(route, /dependsOn/);
  assert.match(route, /evidenceLink/);
  assert.match(route, /Diese Felder sind geschützt/);
  assert.match(route, /Founder können Aufgaben nur in Review geben/);
  assert.match(data, /milestones/);
  assert.match(data, /mapTask/);
  assert.match(dataMappers, /createdBy/);
  assert.match(types, /export type Milestone/);
  assert.match(types, /createdBy\?: string/);
  assert.match(page, /AppSidebar/);
  assert.match(page, /TaskBriefSection/);
  assert.match(page, /TaskRelationshipsSection/);
  assert.match(page, /TaskSubIssuesSection/);
  assert.match(page, /TaskCommentThread/);
  assert.match(page, /TaskDetailsCard/);
  assert.match(page, /briefEditing/);
  assert.match(page, /detailsEditing/);
  assert.match(page, /detailsEditSnapshot/);
  assert.match(page, /canManageTaskMeta/);
  assert.match(page, /title="Kommentare"/);
  assert.match(detailsCard, /Priorität/);
  assert.match(detailsCard, /Initiative/);
  assert.match(detailsCard, /Epic \/ Meilenstein/);
  assert.match(detailsCard, /Erstellt von/);
  assert.match(detailsCard, /Assignee/);
  assert.match(detailsCard, /availableStatusOptions/);
  assert.match(detailsCard, /CustomDatePicker/);
  assert.match(detailsCard, /Bearbeiten/);
  assert.match(contextSection, /Begründende Decisions/);
  assert.match(contextSection, /Fokus-Kontext/);
  assert.match(comments, /TaskCommentThread/);
  assert.match(commentsHook, /api\/tasks\/\$\{task\.id\}\/comments/);
  assert.match(app, /TaskChecklist/);
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
  assert.match(docs, /Epic \/ Meilenstein[\s\S]*Initiative[\s\S]*Deliverable[\s\S]*Sub-Issue/);
  assert.match(docs, /Sprint ist ein Zeitcontainer/);
  assert.match(skill, /Sprint is a time container/);
  assert.match(github, /Epic \/ Milestone/);
  assert.match(github, /Initiative/);
  assert.match(ui, /Epic \/ Meilenstein/);
  assert.match(ui, /Group Commitment/);
  assert.match(ui, /expandedPackages/);
  assert.match(ui, /Alle einklappen/);
  assert.match(ui, /Alle ausklappen/);
  assert.match(ui, /aria-expanded=\{expanded\}/);
  assert.match(pkg, /verify:hierarchy/);
});

test("management repo cleanup plan protects legacy templates from deletion without approval", async () => {
  const plan = await readFile("docs/management-repo-v2-plan.md", "utf8");
  const deliverableTemplate = await readFile("docs/management-templates-v2/deliverable.yml", "utf8");
  const initiativeTemplate = await readFile("docs/management-templates-v2/initiative.yml", "utf8");
  const subIssueTemplate = await readFile("docs/management-templates-v2/sub-issue.yml", "utf8");

  assert.match(plan, /Keine Datei im Management-Repo löschen/);
  assert.match(plan, /Erst archivieren statt endgültig löschen/);
  assert.match(plan, /auto-triage\.yml/);
  assert.match(plan, /sprint-title-sync\.yml/);
  assert.match(deliverableTemplate, /GitHub ist Backup, nicht Quelle der Wahrheit/);
  assert.match(deliverableTemplate, /Acceptance Criteria/);
  assert.match(initiativeTemplate, /type:initiative/);
  assert.match(initiativeTemplate, /Epic \/ Meilenstein/);
  assert.match(subIssueTemplate, /nicht score-relevant/);
});

test("google chat delivery is outbox based and webhook gated", async () => {
  const migration = await readFile("supabase/0008_google_chat_delivery.sql", "utf8");
  const route = await readFile("src/app/api/notifications/deliver/route.ts", "utf8");
  const chat = await readFile("src/lib/google-chat.ts", "utf8");
  const policy = await readFile("src/lib/notification-policy.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");

  assert.match(migration, /google_chat_user_id/);
  assert.match(migration, /google_chat_dm_space/);
  assert.match(migration, /notification_preferences/);
  assert.match(route, /requireOperationalLead/);
  assert.match(route, /notification_events/);
  assert.match(route, /notification_deliveries/);
  assert.match(chat, /GOOGLE_CHAT_WEBHOOK_URL/);
  assert.match(chat, /GOOGLE_CHAT_DELIVERY_ENABLED/);
  assert.match(chat, /googleChatDeliveryStatus/);
  assert.match(chat, /formatGoogleChatMessage/);
  assert.match(chat, /formatGoogleChatDigestCard/);
  assert.match(route, /shouldSendToGoogleChatDigest/);
  assert.match(route, /shouldSendToGoogleChatDm/);
  assert.match(route, /Kein gültiger Google-Chat-DM-Space/);
  assert.match(route, /googleChatDeliveryStatus/);
  assert.match(route, /notification_preferences/);
  assert.match(route, /Google-Chat-Präferenz/);
  assert.match(route, /notification_deliveries/);
  assert.match(policy, /task\.review_rework/);
  assert.match(policy, /task\.review_completed/);
  assert.match(policy, /googleChatDirectDmEventTypes/);
  assert.match(policy, /shouldSendToGoogleChatDm/);
  assert.match(policy, /meeting\.attendance_updated/);
  assert.match(policy, /feedback\.bug_reported/);
  assert.match(policy, /feedback\.feature_requested/);
  assert.match(ui, /NotificationInbox/);
  assert.match(ui, /openTaskPanel\(task\.id\)/);
  assert.match(ui, /Die verknüpfte Aufgabe wurde nicht gefunden/);
  assert.match(ui, /Notification-Ausgang/);
  assert.match(ui, /googleChatDigestNotifications/);
  assert.match(ui, /googleChatReady/);
  assert.match(ui, /nur gesammelt/);
  assert.match(ui, /GOOGLE_CHAT_DELIVERY_ENABLED=true/);
  assert.match(ui, /notificationChannelLabel/);
  assert.match(ui, /Keine Benachrichtigung wartet auf den Google-Chat-Digest/);
  assert.match(ui, /Operative Event Messages bleiben in der App/);
  assert.match(ui, /Release-Details/);
  assert.match(ui, /Digest senden/);
});

test("google chat rollout is documented and verified before delivery activation", async () => {
  const envExample = await readFile(".env.example", "utf8");
  const rollout = await readFile("docs/google-chat-rollout.md", "utf8");
  const nextStep = await readFile("docs/google-chat-next-step.md", "utf8");
  const script = await readFile("scripts/verify-google-chat-rollout.mjs", "utf8");
  const eventRoute = await readFile("src/app/api/google-chat/events/route.ts", "utf8");
  const pkg = await readFile("package.json", "utf8");

  assert.match(envExample, /GOOGLE_CHAT_WEBHOOK_URL=/);
  assert.match(envExample, /GOOGLE_CHAT_DELIVERY_ENABLED=false/);
  assert.match(rollout, /GOOGLE_CHAT_DELIVERY_ENABLED=false/);
  assert.match(rollout, /GOOGLE_CHAT_DELIVERY_ENABLED=true/);
  assert.match(rollout, /notification_preferences/);
  assert.match(rollout, /Phase 4: Persönliche FounderOps-DMs/);
  assert.match(rollout, /https:\/\/founder-ops\.findmydoc\.eu\/api\/google-chat\/events/);
  assert.match(rollout, /keinen Gruppenchat-Fallback/);
  assert.match(rollout, /Rollback/);
  assert.match(rollout, /Operative Event Messages bleiben in der Applikation/);
  assert.match(rollout, /Release-Details oder Deployment-Zusammenfassungen/);
  assert.match(rollout, /\/api\/google-chat\/events/);
  assert.match(nextStep, /docs\/google-chat-rollout\.md/);
  assert.match(nextStep, /keinen Gruppenchat-Fallback/);
  assert.match(nextStep, /Release-Kanal/);
  assert.match(nextStep, /Operative Event Messages bleiben in der Applikation/);
  assert.match(nextStep, /\/api\/google-chat\/events/);
  assert.match(script, /googleChatDeliveryStatus/);
  assert.match(script, /GOOGLE_CHAT_DELIVERY_ENABLED=false/);
  assert.match(script, /chat event route exists/);
  assert.match(eventRoute, /FounderOps Google Chat Events/);
  assert.match(eventRoute, /googleChatDeliveryStatus/);
  assert.match(eventRoute, /MESSAGE/);
  assert.doesNotMatch(eventRoute, /sendGoogleChatWebhook/);
  assert.match(pkg, /verify:google-chat/);
});

test("repo readiness includes the GitHub Actions deployment pipeline gates", async () => {
  const verify = await readFile("scripts/verify-vercel-ready.mjs", "utf8");
  const vercelJson = await readFile("vercel.json", "utf8");
  const previewWorkflow = await readFile(".github/workflows/deploy-preview.yml", "utf8");
  const productionWorkflow = await readFile(".github/workflows/deploy-production.yml", "utf8");
  const deployScript = await readFile(".github/scripts/deploy/vercel-deploy-prebuilt.sh", "utf8");
  const dependabot = await readFile(".github/dependabot.yml", "utf8");
  const gitignore = await readFile(".gitignore", "utf8");
  const deployment = await readFile("docs/vercel-deployment.md", "utf8");
  const skill = await readFile("skills/fmd-vercel-readiness/SKILL.md", "utf8");
  const pkg = await readFile("package.json", "utf8");
  const layout = await readFile("src/app/layout.tsx", "utf8");
  const css = await readFile("src/app/globals.css", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");

  assert.match(verify, /ready-for-github-actions-deployment/);
  assert.match(verify, /deploy-preview\.yml/);
  assert.match(verify, /deploy-production\.yml/);
  assert.match(verify, /vercel\.json/);
  assert.match(verify, /githubEnvironments/);
  assert.match(verify, /founder-ops\.findmydoc\.eu/);
  assert.match(verify, /\.github\/dependabot\.yml/);
  assert.match(verify, /GOOGLE_CHAT_DELIVERY_ENABLED/);
  assert.match(verify, /verify:google-chat/);
  assert.match(verify, /GITHUB_SYNC_TOKEN/);
  assert.doesNotMatch(verify, /manualNextSteps/);
  assert.match(vercelJson, /"installCommand": "npm ci"/);
  assert.match(vercelJson, /"buildCommand": "npm run vercel:build"/);
  assert.match(previewWorkflow, /environment:[\s\S]*name: preview/);
  assert.match(previewWorkflow, /url: \$\{\{ steps\.vercel_preview\.outputs\.deploymentUrl \}\}/);
  assert.match(previewWorkflow, /github\.event_name == 'push'/);
  assert.match(previewWorkflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(previewWorkflow, /Validate preview secrets/);
  assert.match(previewWorkflow, /preview_guard/);
  assert.match(previewWorkflow, /pull --yes --environment=preview/);
  assert.match(previewWorkflow, /Build Vercel Output/);
  assert.match(previewWorkflow, /build --target=preview/);
  assert.match(previewWorkflow, /vercel-deploy-prebuilt\.sh preview/);
  assert.match(productionWorkflow, /environment:[\s\S]*name: production/);
  assert.match(productionWorkflow, /url: \$\{\{ steps\.vercel_production\.outputs\.deploymentUrl \}\}/);
  assert.match(productionWorkflow, /refs\/heads\/main/);
  assert.match(productionWorkflow, /pull --yes --environment=production/);
  assert.match(productionWorkflow, /Build Vercel Output[\s\S]*NEXT_PUBLIC_SUPABASE_URL: \$\{\{ secrets\.NEXT_PUBLIC_SUPABASE_URL \}\}/);
  assert.match(productionWorkflow, /Build Vercel Output[\s\S]*NEXT_PUBLIC_SUPABASE_ANON_KEY: \$\{\{ secrets\.NEXT_PUBLIC_SUPABASE_ANON_KEY \}\}/);
  assert.match(productionWorkflow, /build --prod/);
  assert.match(productionWorkflow, /vercel-deploy-prebuilt\.sh production/);
  assert.match(productionWorkflow, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(productionWorkflow, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(productionWorkflow, /APP_URL/);
  assert.match(productionWorkflow, /GITHUB_SYNC_OWNER: findmydoc-platform/);
  assert.match(deployScript, /RUNNER_TEMP/);
  assert.match(deployScript, /git archive HEAD/);
  assert.match(deployScript, /\.vercel\/output/);
  assert.match(deployScript, /\.vercel\/project\.json/);
  assert.match(deployScript, /node_modules is missing/);
  assert.match(deployScript, /package-lock\.json/);
  assert.match(deployScript, /node_modules/);
  assert.match(deployScript, /\.next\/package\.json is missing/);
  assert.match(deployScript, /\.next/);
  assert.match(deployScript, /Refusing to deploy: staging directory contains Git metadata\./);
  assert.match(deployScript, /--prebuilt/);
  assert.match(deployScript, /--no-wait/);
  assert.match(deployScript, /--target=preview/);
  assert.match(deployScript, /--prod/);
  assert.match(deployScript, /inspect/);
  assert.match(deployScript, /readyStateReason/);
  assert.match(deployScript, /seatBlock/);
  assert.match(deployScript, /TEAM_ACCESS_REQUIRED/);
  assert.match(deployScript, /deploymentUrl=/);
  assert.doesNotMatch(previewWorkflow, /VERCEL_TOKEN is required/);
  assert.doesNotMatch(productionWorkflow, /VERCEL_TOKEN is required/);
  assert.match(pkg, /verify:release/);
  assert.match(pkg, /verify:deploy/);
  assert.match(pkg, /vercel:build/);
  assert.match(pkg, /npm test && npm run verify:vercel-ready/);
  assert.match(pkg, /node --test tests\/\*\.test\.mjs/);
  assert.match(pkg, /eslint/);
  assert.match(pkg, /node scripts\/verify-vercel-ready\.mjs/);
  assert.match(pkg, /node scripts\/verify-google-chat-rollout\.mjs/);
  assert.match(pkg, /npm audit --audit-level=moderate/);
  assert.doesNotMatch(pkg, /"verify:release": ".*next build/);
  assert.match(gitignore, /\.github\/workflows\/ci\.yml/);
  assert.match(dependabot, /package-ecosystem: npm/);
  assert.match(dependabot, /package-ecosystem: github-actions/);
  assert.match(dependabot, /timezone: Europe\/Berlin/);
  assert.match(dependabot, /nextjs-stack/);
  assert.match(deployment, /GitHub Actions/);
  assert.match(deployment, /GitHub Actions Deployment Workflow/);
  assert.match(deployment, /GitHub Environments/);
  assert.match(deployment, /VERCEL_TOKEN/);
  assert.match(deployment, /VERCEL_ORG_ID/);
  assert.match(deployment, /VERCEL_PROJECT_ID/);
  assert.match(deployment, /founder-ops\.findmydoc\.eu/);
  assert.match(deployment, /npm run vercel:build/);
  assert.match(deployment, /GOOGLE_CHAT_DELIVERY_ENABLED=false/);
  assert.match(deployment, /Operational event messages stay inside the application/);
  assert.match(deployment, /preview secrets are missing/);
  assert.match(deployment, /Do not configure a shared `GITHUB_SYNC_TOKEN`/);
  assert.match(deployment, /npm run verify:deploy/);
  assert.match(deployment, /GitHub Actions job logs/);
  assert.match(deployment, /Git-metadata-free runner directory/);
  assert.match(deployment, /Vercel Hobby Private Repository Author Block/);
  assert.match(deployment, /readyStateReason/);
  assert.match(deployment, /seatBlock/);
  assert.doesNotMatch(deployment, /vercel link --yes --project founder-ops/);
  assert.doesNotMatch(deployment, /vercel login/);
  assert.doesNotMatch(deployment, /vercel deploy/);
  assert.doesNotMatch(deployment, /vercel build --prod/);
  assert.doesNotMatch(deployment, /vercel inspect/);
  assert.doesNotMatch(deployment, /vercel logs/);
  assert.match(skill, /GitHub Actions/);
  assert.match(skill, /GitHub Actions job logs/);
  assert.match(skill, /preview/);
  assert.match(skill, /production/);
  assert.match(skill, /GOOGLE_CHAT_DELIVERY_ENABLED=false/);
  assert.match(skill, /founder-ops\.findmydoc\.eu/);
  assert.match(skill, /Git-metadata-free temporary directory/);
  assert.match(skill, /AI Guidance: Vercel Hobby Private Author Block/);
  assert.match(skill, /TEAM_ACCESS_REQUIRED/);
  assert.match(skill, /readyStateReason/);
  assert.match(skill, /seatBlock/);
  assert.doesNotMatch(skill, /Vercel CLI/);
  assert.doesNotMatch(skill, /vercel link --yes --project founder-ops/);
  assert.doesNotMatch(skill, /vercel login/);
  assert.doesNotMatch(skill, /vercel deploy/);
  assert.doesNotMatch(skill, /vercel build --prod/);
  assert.doesNotMatch(skill, /vercel inspect/);
  assert.doesNotMatch(skill, /vercel logs/);
  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(css, /--font-sans: Inter, ui-sans-serif/);
  assert.match(ui, /Production Readiness/);
  assert.match(ui, /manuell offen/);
  assert.match(ui, /GitHub Actions/);
  assert.doesNotMatch(ui, /vercel login/);
  assert.match(ui, /GitHub OAuth/);
  assert.match(ui, /Supabase Auth Redirects/);
});

test("health and supabase verification detect operational migrations", async () => {
  const health = await readFile("src/app/api/health/route.ts", "utf8");
  const verify = await readFile("scripts/verify-supabase.mjs", "utf8");
  const operational = await readFile("scripts/verify-operational.mjs", "utf8");
  const pkg = await readFile("package.json", "utf8");

  assert.match(health, /profiles\.google_chat/);
  assert.match(health, /notification_preferences/);
  assert.match(health, /tasks\.carryover/);
  assert.match(health, /sprint_commitments/);
  assert.match(health, /packages\.initiative/);
  assert.match(health, /tasks\.template_v2/);
  assert.match(health, /task_relationship_edges/);
  assert.match(health, /task_external_comments/);
  assert.match(health, /githubSyncMode/);
  assert.match(health, /googleChatDeliveryStatus/);
  assert.match(health, /tasksMin/);
  assert.match(health, /counts\.tasks >= expected\.tasksMin/);
  assert.match(health, /schemaReady/);
  assert.match(verify, /0008_google_chat_delivery\.sql/);
  assert.match(verify, /0009_sprint_carryover\.sql/);
  assert.match(verify, /notificationDeliveries/);
  assert.match(operational, /Founder Planning/);
  assert.match(operational, /githubMappedProfiles/);
  assert.match(operational, /googleChatConfigured/);
  assert.match(operational, /googleChatDeliveryEnabled/);
  assert.match(operational, /googleChatReady/);
  assert.match(pkg, /verify:operational/);
});

test("founder feedback creates bug and feature notifications with details", async () => {
  const migration = await readFile("supabase/0014_founder_feedback.sql", "utf8");
  const route = await readFile("src/app/api/feedback/route.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const data = await readFile("src/lib/planning-data.ts", "utf8");

  assert.match(migration, /create table if not exists feedback_items/);
  assert.match(migration, /type text not null check \(type in \('bug', 'feature'\)\)/);
  assert.match(route, /requireFounder/);
  assert.match(route, /feedback\.bug_reported/);
  assert.match(route, /feedback\.feature_requested/);
  assert.match(route, /notification_events/);
  assert.match(ui, /Benachrichtigungscenter/);
  assert.match(ui, /Feedback-Eingang/);
  assert.match(ui, /Notification-Ausgang/);
  assert.match(ui, /xl:col-span-2/);
  assert.match(ui, /FeedbackDialog/);
  assert.match(ui, /\/api\/feedback/);
  assert.match(data, /feedbackItems/);
});

test("workspace selection survives page refreshes", async () => {
  const workspaceHook = await readFile("src/hooks/use-planning-workspace.ts", "utf8");

  assert.match(workspaceHook, /workspaceStateKey/);
  assert.match(workspaceHook, /URLSearchParams\(window\.location\.search\)/);
  assert.match(workspaceHook, /window\.localStorage\.setItem\(workspaceStateKey, workspace\)/);
  assert.match(workspaceHook, /url\.searchParams\.set\("workspace", workspace\)/);
});

test("header actions are workspace aware", async () => {
  const ui = await readFile("src/components/planning-app.tsx", "utf8");

  assert.match(ui, /type HeaderPrimaryAction/);
  assert.match(ui, /filtersAvailable = planningWorkspaces\.includes\(workspace\)/);
  assert.match(ui, /label: "Neue Aufgabe"/);
  assert.match(ui, /label: "Vorschlag erstellen"/);
  assert.match(ui, /label: "Aufgabe hinzufügen"/);
  assert.match(ui, /label: "Neue Decision"/);
  assert.match(ui, /id="decision-create"/);
  assert.doesNotMatch(ui, /planningWorkspaces\.includes\(workspace\) \? "" : "hidden"/);
});

test("gantt uses sprint dates for scheduled tasks", async () => {
  const ui = await readFile("src/components/planning-app.tsx", "utf8");

  assert.match(ui, /<CurrentGanttView tasks=\{visibleTasks\} packages=\{data\.packages\} sprints=\{data\.sprints\}/);
  assert.match(ui, /function GanttView\(\{ tasks, packages, sprints, relations, onOpen \}/);
  assert.match(ui, /parseIsoDate\(sprint\?\.startDate \|\| ""\) \|\| parseIsoDate\(task\.startDate\)/);
  assert.match(ui, /parseIsoDate\(sprint\?\.endDate \|\| ""\) \|\| parseIsoDate\(task\.endDate\)/);
});

test("fmd tools hub keeps internal tools repos notion and drive visible", async () => {
  const migration = await readFile("supabase/0015_fmd_tools_hub.sql", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const data = await readFile("src/lib/planning-data.ts", "utf8");
  const seed = await readFile("src/lib/generated/seed-data.ts", "utf8");
  const types = await readFile("src/lib/types.ts", "utf8");

  assert.match(migration, /create table if not exists fmd_tools/);
  assert.match(migration, /email-signature-tool/);
  assert.match(migration, /https:\/\/mailsig\.findmydoc\.eu\//);
  assert.match(migration, /'email-signature-tool'.*'active'/s);
  assert.match(migration, /investor-calculator/);
  assert.match(migration, /notion-docs-source/);
  assert.match(migration, /https:\/\/www\.notion\.so\/Team-Workspace-31c283c73e6180cf9eedc8e0694cf2db/);
  assert.match(migration, /google-drive-assets/);
  assert.match(migration, /https:\/\/drive\.google\.com\/drive\/shared-drives/);
  const pitchdeckMigration = await readFile("supabase/0021_pitchdeck_tool.sql", "utf8");
  assert.match(pitchdeckMigration, /pitchdeck-site/);
  assert.match(pitchdeckMigration, /https:\/\/pitchdeck\.findmydoc\.eu\//);
  assert.match(ui, /FMD-Tools Hub/);
  assert.match(ui, /FmdToolsOverview/);
  assert.match(ui, /Interne Tools/);
  assert.match(data, /fmdTools/);
  assert.match(seed, /https:\/\/mailsig\.findmydoc\.eu\//);
  assert.match(seed, /https:\/\/www\.notion\.so\/Team-Workspace-31c283c73e6180cf9eedc8e0694cf2db/);
  assert.match(seed, /https:\/\/pitchdeck\.findmydoc\.eu\//);
  assert.match(seed, /https:\/\/drive\.google\.com\/drive\/shared-drives/);
  assert.match(types, /export type FmdTool/);
});

test("execution layer adds focus board hygiene alerts and decision task links", async () => {
  const migration = await readFile("supabase/0020_execution_layer.sql", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const sidebar = await readFile("src/components/app-sidebar.tsx", "utf8");
  const data = await readFile("src/lib/planning-data.ts", "utf8");
  const types = await readFile("src/lib/types.ts", "utf8");
  const focusRoute = await readFile("src/app/api/focus/route.ts", "utf8");
  const decisionTaskRoute = await readFile("src/app/api/decisions/[id]/tasks/route.ts", "utf8");
  const verify = await readFile("scripts/verify-supabase.mjs", "utf8");
  const health = await readFile("src/app/api/health/route.ts", "utf8");
  const schema = await readFile("supabase/schema.sql", "utf8");
  const detail = await readFile("src/components/task-detail-page.tsx", "utf8");
  const contextSection = await readFile("src/components/task-context-section.tsx", "utf8");
  const taskPage = await readFile("src/app/tasks/[id]/page.tsx", "utf8");
  const agents = await readFile("AGENTS.md", "utf8");
  const plan = await readFile("docs/execution-layer-plan.md", "utf8");

  assert.match(migration, /create table if not exists task_focus_items/);
  assert.match(migration, /create table if not exists decision_task_links/);
  assert.match(migration, /unique \(profile_id, task_id, focus_date\)/);
  assert.match(migration, /unique \(decision_id, task_id\)/);
  assert.match(sidebar, /Execution/);
  assert.match(ui, /ExecutionLayerOverview/);
  assert.match(ui, /Heute-Fokus/);
  assert.match(ui, /Hygiene Alerts/);
  assert.match(ui, /Decision-Folgearbeit/);
  assert.match(ui, /followUpCounts/);
  assert.match(ui, /Folgearbeit offen/);
  assert.match(ui, /Folgeaufgabe aus Decision/);
  assert.match(ui, /Folgeaufgabe aus Decision Log/);
  assert.match(ui, /Folgeaufgaben/);
  assert.match(ui, /onCreateFollowUp/);
  assert.match(ui, /In Fokus/);
  assert.match(ui, /onRemoveFocus/);
  assert.match(ui, /onRemoveDecisionTaskLink/);
  assert.match(ui, /Alle Schweregrade/);
  assert.match(ui, /Alle Bereiche/);
  assert.match(ui, /Kritische Alerts/);
  assert.match(ui, /Team-Fokus gesetzt/);
  assert.match(ui, /Team-Fokus heute/);
  assert.match(ui, /Fokus-Verlauf/);
  assert.match(ui, /Tagesabschluss/);
  assert.match(ui, /Abschlussquote/);
  assert.match(ui, /Als erledigt markieren/);
  assert.match(ui, /endOfDayCompletion/);
  assert.match(ui, /teamFocusCoverage/);
  assert.match(ui, /focusHistoryByDate/);
  assert.match(ui, /Offene verschieben/);
  assert.match(ui, /executionMetrics/);
  assert.match(ui, /Decision-Link entfernen/);
  assert.match(ui, /decisionId/);
  assert.match(ui, /decisionLinkNote/);
  assert.match(ui, /api\/decisions\/\$\{draft\.decisionId\}\/tasks/);
  assert.match(ui, /buildHygieneAlerts/);
  assert.match(ui, /recommendedAction/);
  assert.match(ui, /Nächste Aktion/);
  assert.match(ui, /Aktion in Fokus/);
  assert.match(ui, /Acceptance Criteria fehlen/);
  assert.match(ui, /Decision ohne Folgeaufgabe/);
  assert.match(ui, /Begründende Decisions/);
  assert.match(ui, /Fokus-Kontext/);
  assert.match(detail, /TaskContextSection/);
  assert.match(contextSection, /Begründende Decisions/);
  assert.match(contextSection, /Fokus-Kontext/);
  assert.match(detail, /focusItems/);
  assert.match(detail, /decisionTaskLinks/);
  assert.match(taskPage, /focusItems=\{data\.taskFocusItems\}/);
  assert.match(taskPage, /decisionTaskLinks=\{data\.decisionTaskLinks\}/);
  assert.match(data, /taskFocusItems/);
  assert.match(data, /decisionTaskLinks/);
  assert.match(types, /export type TaskFocusItem/);
  assert.match(types, /export type DecisionTaskLink/);
  assert.match(focusRoute, /task_focus_items/);
  assert.match(focusRoute, /Heute-Fokus ist auf drei Aufgaben begrenzt/);
  assert.match(focusRoute, /export async function DELETE/);
  assert.match(focusRoute, /Fokus entfernt/);
  assert.match(focusRoute, /Fokus aktualisiert/);
  assert.match(decisionTaskRoute, /decision_task_links/);
  assert.match(decisionTaskRoute, /export async function DELETE/);
  assert.match(decisionTaskRoute, /Decision-Verknüpfung entfernt/);
  assert.match(decisionTaskRoute, /Mit Decision verknüpft/);
  assert.match(verify, /task_focus_items/);
  assert.match(verify, /decision_task_links/);
  assert.match(health, /task_focus_items/);
  assert.match(health, /decision_task_links/);
  assert.match(schema, /create table if not exists task_focus_items/);
  assert.match(schema, /create table if not exists decision_task_links/);
  assert.match(agents, /docs\/execution-layer-plan\.md/);
  assert.match(plan, /Focus Board \/ Heute-Modus/);
  assert.match(plan, /Aging & Hygiene Alerts/);
  assert.match(plan, /Decision-to-Task Links/);
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
  assert.match(route, /Deliverables brauchen Initiative und Sprint/);
  assert.match(route, /deadline: payload\.deadline/);
  assert.match(route, /Das Startdatum darf nicht nach dem Enddatum liegen/);
  assert.match(ui, /NewTaskDialog/);
  assert.match(ui, /Sub-Issues/);
  assert.match(ui, /nicht score-relevant/);
  assert.match(ui, /Direkt als GitHub-Issue anlegen/);
  assert.match(ui, /createGitHubIssue/);
  assert.match(ui, /relationType/);
  assert.match(ui, /relatedTaskId/);
  assert.match(ui, /Zieltermin/);
  assert.match(ui, /createIfMissing: true/);
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
  assert.match(route, /Nur CEO oder Deputy können Anwesenheit final bewerten/);
  assert.match(route, /founderSelfReportStatuses/);
  assert.match(route, /founder_self_report/);
  assert.match(route, /lead_review/);
  assert.match(data, /meetingAttendance/);
  assert.match(ui, /Biweekly Meeting & Updates/);
  assert.match(ui, /Triftiger Grund/);
  assert.match(ui, /eigene Rückmeldung/);
  assert.match(ui, /canScoreAttendance/);
  assert.match(ui, /max\. 4 Punkte/);
  assert.match(types, /MeetingAttendanceStatus/);
});

test("meeting finder manages working hours blockers and guarded availability", async () => {
  const route = await readFile("src/app/api/availability/route.ts", "utf8");
  const meetingRoute = await readFile("src/app/api/meetings/route.ts", "utf8");
  const calendarRoute = await readFile("src/app/api/calendar-sync/route.ts", "utf8");
  const calendarLib = await readFile("src/lib/google-calendar.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const migration = await readFile("supabase/0002_founder_platform.sql", "utf8");
  const calendarMigration = await readFile("supabase/0022_meeting_finder_calendar_sync.sql", "utf8");
  const profileCalendarMigration = await readFile("supabase/0023_google_calendar_profile_sync.sql", "utf8");
  const verify = await readFile("scripts/verify-supabase.mjs", "utf8");

  assert.match(migration, /create table if not exists availability/);
  assert.match(calendarMigration, /source in \('manual', 'google_calendar'\)/);
  assert.match(calendarMigration, /availability_google_external_idx/);
  assert.match(profileCalendarMigration, /google_calendar_email/);
  assert.match(profileCalendarMigration, /google_calendar_sync_enabled/);
  assert.match(verify, /availability\.calendar_sync/);
  assert.match(verify, /profiles\.google_calendar/);
  assert.match(route, /requireFounder/);
  assert.match(route, /Founder können nur eigene Verfügbarkeiten pflegen/);
  assert.match(route, /source: "manual"/);
  assert.match(route, /external_calendar_id/);
  assert.match(route, /availability\.create/);
  assert.match(route, /availability\.delete/);
  assert.match(meetingRoute, /requireOperationalLead/);
  assert.match(meetingRoute, /export async function PATCH/);
  assert.match(meetingRoute, /meeting_attendance/);
  assert.match(meetingRoute, /meeting\.create/);
  assert.match(meetingRoute, /meeting\.update/);
  assert.match(meetingRoute, /meeting\.created/);
  assert.match(meetingRoute, /profileIds/);
  assert.match(calendarRoute, /requireOperationalLead/);
  assert.match(calendarRoute, /availability\.google_calendar_sync/);
  assert.match(calendarRoute, /google_calendar_sync_enabled/);
  assert.match(calendarRoute, /source: "google_calendar"/);
  assert.match(calendarRoute, /activeEventIds/);
  assert.match(calendarRoute, /staleIds/);
  assert.match(calendarRoute, /removed/);
  assert.match(calendarLib, /GOOGLE_SERVICE_ACCOUNT_EMAIL/);
  assert.match(calendarLib, /GOOGLE_SERVICE_ACCOUNT_KEY/);
  assert.match(calendarLib, /calendar\.events/);
  assert.doesNotMatch(calendarRoute, /console\.log/);
  assert.match(ui, /findMeetingSlots/);
  assert.match(ui, /meetingOverlapsSlot/);
  assert.match(ui, /Arbeitszeiten pflegen/);
  assert.match(ui, /Mo-Fr auswählen/);
  assert.match(ui, /toggleWorkWeekday/);
  assert.match(ui, /Arbeitszeiten für/);
  assert.match(ui, /Blocker eintragen/);
  assert.match(ui, /Ganztägig blockieren/);
  assert.match(ui, /Google Workspace Sync/);
  assert.match(ui, /Google-Kalender synchronisieren/);
  assert.match(ui, /Google-Termin öffnen/);
  assert.match(ui, /Meeting vormerken/);
  assert.match(ui, /Intern vormerken/);
  assert.match(ui, /Kalenderansicht/);
  assert.match(ui, /calendarCellFor/);
  assert.match(ui, /calendarDaySummary/);
  assert.match(ui, /moveCalendar/);
  assert.match(ui, /availabilitySummaryTone/);
  assert.match(ui, /Wochenraster wie im Kalender/);
  assert.match(ui, /Monatsübersicht/);
  assert.match(ui, /Kalenderansicht wählen/);
  assert.match(ui, /Schraffierte Flächen/);
  assert.doesNotMatch(ui, /Alle frei/);
  assert.doesNotMatch(ui, /Teilweise frei/);
  assert.match(ui, /calendarWeekStart/);
  assert.match(ui, /startOfWeekKey/);
  assert.match(ui, /calendarMonthLabel/);
  assert.match(ui, /Mein Kalender/);
  assert.match(ui, /Alle anzeigen/);
  assert.match(ui, /Vorgemerkte Meetings/);
  assert.match(ui, /Meeting absagen/);
  assert.match(ui, /attendanceForMeeting/);
  assert.match(ui, /meetingSlotIso/);
  assert.match(ui, /googleCalendarEmail/);
  assert.match(ui, /Kalenderwoche & Blocker/);
  assert.match(ui, /Keine passenden Slots/);
  assert.match(ui, /CustomDatePicker/);
  assert.match(ui, /CustomSelect/);
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
