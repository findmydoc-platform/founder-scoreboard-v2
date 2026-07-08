import { readFile } from "node:fs/promises";
import { readFeatureSurface, readPlanningSurface } from "./helpers/planning-surface.mjs";
import test from "node:test";
import assert from "node:assert/strict";

test("google chat delivery is outbox based and webhook gated", async () => {
  const migration = await readFile("supabase/0008_google_chat_delivery.sql", "utf8");
  const dedupeMigration = await readFile("supabase/0030_notification_digest_dedupe.sql", "utf8");
  const route = await readFile("src/app/api/notifications/deliver/route.ts", "utf8");
  const generatorRoute = await readFile("src/app/api/notifications/generate-digest/route.ts", "utf8");
  const chat = await readFile("src/lib/google-chat.ts", "utf8");
  const policy = await readFile("src/lib/notification-policy.ts", "utf8");
  const ui = await readPlanningSurface();
  const settingsOverviewUi = await readFile("src/features/settings/organisms/settings-overview.tsx", "utf8");
  const readinessUi = await readFile("src/features/settings/organisms/settings-readiness.tsx", "utf8");
  const settingsNotificationsUi = await readFile("src/features/settings/organisms/settings-notifications.tsx", "utf8");
  const inboxUi = await readFile("src/features/notifications/organisms/notification-inbox.tsx", "utf8");

  assert.match(migration, /google_chat_user_id/);
  assert.match(migration, /google_chat_dm_space/);
  assert.match(migration, /notification_preferences/);
  assert.match(dedupeMigration, /add column if not exists dedupe_key/);
  assert.match(dedupeMigration, /notification_events_dedupe_key_uidx/);
  assert.match(dedupeMigration, /where dedupe_key is not null/);
  assert.match(route, /requireOperationalLead/);
  assert.match(route, /x-founderops-delivery-secret/);
  assert.match(route, /FOUNDEROPS_DELIVERY_SECRET/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /Ungültiger Delivery-Secret/);
  assert.match(route, /notification_events/);
  assert.match(route, /notification_deliveries/);
  assert.match(route, /eventIds/);
  assert.match(route, /maxExplicitEventIds/);
  assert.match(route, /testDelivery/);
  assert.match(route, /payload\.testDelivery === "direct_dm"/);
  assert.match(generatorRoute, /requireOperationalLead/);
  assert.match(generatorRoute, /x-founderops-delivery-secret/);
  assert.match(generatorRoute, /FOUNDEROPS_DELIVERY_SECRET/);
  assert.match(generatorRoute, /timingSafeEqual/);
  assert.match(generatorRoute, /Ungültiger Delivery-Secret/);
  assert.match(generatorRoute, /dryRun/);
  assert.match(generatorRoute, /dedupeKey/);
  assert.match(generatorRoute, /Europe\/Berlin/);
  assert.match(generatorRoute, /task\.deadline_overdue/);
  assert.match(generatorRoute, /sprint\.review_due/);
  assert.doesNotMatch(generatorRoute, /decision\.confirmation_requested/);
  assert.match(generatorRoute, /review_owner_profile_id/);
  assert.match(generatorRoute, /recipientProfileId: reviewOwnerProfileId/);
  assert.match(generatorRoute, /deine Accountable-Review/);
  assert.match(generatorRoute, /const assignee = task\.assignee \|\| task\.owner/);
  assert.match(generatorRoute, /recipientProfileId: assignee/);
  assert.match(generatorRoute, /recipientProfileId: profileId/);
  assert.doesNotMatch(generatorRoute, /task\.comment/);
  assert.match(chat, /GOOGLE_CHAT_WEBHOOK_URL/);
  assert.match(chat, /GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL/);
  assert.match(chat, /GOOGLE_CHAT_PRIVATE_KEY/);
  assert.match(chat, /GOOGLE_CHAT_DELIVERY_ENABLED/);
  assert.match(chat, /googleChatDeliveryStatus/);
  assert.match(chat, /formatGoogleChatMessage/);
  assert.match(chat, /formatGoogleChatDigestCard/);
  assert.match(chat, /cardsV2/);
  assert.match(chat, /buttonList/);
  assert.match(chat, /openLink/);
  assert.match(chat, /sendGoogleChatSpaceDigest/);
  assert.match(chat, /https:\/\/www\.googleapis\.com\/auth\/chat\.bot/);
  assert.match(route, /shouldSendToGoogleChatDigest/);
  assert.match(route, /googleChatDeliveryStatus/);
  assert.match(route, /isGoogleChatDmSpace/);
  assert.match(route, /deliveryMode: "direct_dm"/);
  assert.match(route, /shouldSendToGoogleChatDm/);
  assert.match(route, /Kein gültiger Google-Chat-DM-Space/);
  assert.match(route, /nicht in den Gruppenchat/);
  assert.match(route, /notification_preferences/);
  assert.match(route, /Google-Chat-Präferenz/);
  assert.match(route, /notification_deliveries/);
  assert.match(policy, /task\.review_rework/);
  assert.match(policy, /task\.review_completed/);
  assert.match(policy, /task\.deadline_overdue/);
  assert.match(policy, /googleChatDirectDmEventTypes/);
  assert.match(policy, /shouldSendToGoogleChatDm/);
  assert.match(policy, /sprint\.review_due/);
  assert.match(policy, /meeting\.attendance_updated/);
  assert.match(policy, /feedback\.bug_reported/);
  assert.match(policy, /feedback\.feature_requested/);
  assert.match(ui, /NotificationInbox/);
  assert.match(inboxUi, /notificationTypeLabel/);
  assert.match(inboxUi, /notifications\.slice\(0, 12\)/);
  assert.match(inboxUi, /onDismiss\(event\.id\)/);
  assert.match(ui, /openTaskPanel\(task\.id\)/);
  assert.match(ui, /Die verknüpfte Aufgabe wurde nicht gefunden/);
  assert.match(ui, /SettingsOverview/);
  assert.match(settingsOverviewUi, /SettingsNotificationsSection/);
  assert.match(settingsNotificationsUi, /googleChatDigestNotifications/);
  assert.match(settingsNotificationsUi, /googleChatReady/);
  assert.match(settingsNotificationsUi, /googleChatDeliveryEnabled/);
  assert.match(readinessUi, /googleChatReady/);
  assert.match(readinessUi, /text-emerald-700/);
  assert.match(readinessUi, /text-amber-700/);
  assert.doesNotMatch(settingsNotificationsUi, /GOOGLE_CHAT_DELIVERY_ENABLED/);
  assert.match(settingsNotificationsUi, /notificationChannelLabel/);
  assert.match(settingsNotificationsUi, /onSendGoogleChatTest/);
  assert.match(settingsNotificationsUi, /onRetryNotificationDelivery/);
  assert.match(settingsNotificationsUi, /webhook_digest/);
  assert.match(settingsNotificationsUi, /direct_dm/);
});

test("google chat rollout is documented and verified before delivery activation", async () => {
  const envExample = await readFile(".env.example", "utf8");
  const rollout = await readFile("docs/google-chat-rollout.md", "utf8");
  const script = await readFile("scripts/verify-google-chat-rollout.mjs", "utf8");
  const deliverRoute = await readFile("src/app/api/notifications/deliver/route.ts", "utf8");
  const eventRoute = await readFile("src/app/api/google-chat/events/route.ts", "utf8");
  const digestWorkflow = await readFile(".github/workflows/google-chat-digest.yml", "utf8");
  const pkg = await readFile("package.json", "utf8");

  assert.match(envExample, /GOOGLE_CHAT_WEBHOOK_URL=/);
  assert.match(envExample, /GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL=/);
  assert.match(envExample, /GOOGLE_CHAT_PRIVATE_KEY=/);
  assert.match(envExample, /GOOGLE_CHAT_DELIVERY_ENABLED=false/);
  assert.match(envExample, /FOUNDEROPS_DELIVERY_SECRET=/);
  assert.match(envExample, /x-founderops-delivery-secret/);
  assert.match(envExample, /APP_URL=https:\/\/founder-ops\.findmydoc\.eu/);
  assert.match(rollout, /GOOGLE_CHAT_DELIVERY_ENABLED=false/);
  assert.match(rollout, /GOOGLE_CHAT_DELIVERY_ENABLED=true/);
  assert.match(rollout, /09:00 Europe\/Berlin/);
  assert.match(rollout, /x-founderops-delivery-secret/);
  assert.match(rollout, /FOUNDEROPS_DELIVERY_SECRET/);
  assert.match(rollout, /APP_URL=https:\/\/founder-ops\.findmydoc\.eu/);
  assert.match(rollout, /Rollback/);
  assert.match(rollout, /\/api\/google-chat\/events/);
  assert.match(rollout, /https:\/\/founder-ops\.findmydoc\.eu\/api\/google-chat\/events/);
  assert.match(rollout, /keinen Gruppenchat-Fallback/);
  assert.match(script, /googleChatDeliveryStatus/);
  assert.match(script, /GOOGLE_CHAT_DELIVERY_ENABLED=false/);
  assert.match(script, /FOUNDEROPS_DELIVERY_SECRET/);
  assert.match(script, /x-founderops-delivery-secret/);
  assert.doesNotMatch(script, /settings-notifications\.tsx/);
  assert.doesNotMatch(script, /Test-Sammelmeldung|Direktnachricht|Zustelldetails anzeigen/);
  assert.match(digestWorkflow, /name: Google Chat Digest/);
  assert.match(digestWorkflow, /cron: "0 7 \* \* 1-5"/);
  assert.match(digestWorkflow, /workflow_dispatch/);
  assert.match(digestWorkflow, /name: production/);
  assert.match(digestWorkflow, /FOUNDEROPS_DELIVERY_SECRET/);
  assert.match(digestWorkflow, /x-founderops-delivery-secret/);
  assert.match(digestWorkflow, /Generate focus reminders/);
  assert.match(digestWorkflow, /founder-ops\.findmydoc\.eu\/api\/notifications\/generate-digest/);
  assert.match(digestWorkflow, /founder-ops\.findmydoc\.eu\/api\/notifications\/deliver/);
  assert.ok(
    digestWorkflow.indexOf("/api/notifications/generate-digest") < digestWorkflow.indexOf("/api/notifications/deliver"),
    "workflow must generate reminders before delivery",
  );
  assert.match(script, /chat event route exists/);
  assert.match(deliverRoute, /googleChatDeliveryStatus/);
  assert.match(deliverRoute, /x-founderops-delivery-secret/);
  assert.match(deliverRoute, /FOUNDEROPS_DELIVERY_SECRET/);
  assert.match(deliverRoute, /eventIds/);
  assert.match(deliverRoute, /testDelivery/);
  assert.match(deliverRoute, /sendGoogleChatSpaceDigest/);
  assert.match(deliverRoute, /isGoogleChatDmSpace/);
  assert.match(eventRoute, /FounderOps Google Chat Events/);
  assert.match(eventRoute, /googleChatDeliveryStatus/);
  assert.match(eventRoute, /MESSAGE/);
  assert.doesNotMatch(eventRoute, /sendGoogleChatWebhook/);
  assert.match(pkg, /verify:google-chat/);
});

test("repo readiness includes optional ci and deployment gates", async () => {
  const verify = await readFile("scripts/verify-vercel-ready.mjs", "utf8");
  const dependabot = await readFile(".github/dependabot.yml", "utf8");
  const gitignore = await readFile(".gitignore", "utf8");
  const deployment = await readFile("docs/vercel-deployment.md", "utf8");
  const skill = await readFile("skills/fmd-vercel-readiness/SKILL.md", "utf8");
  const pkg = await readFile("package.json", "utf8");
  const layout = await readFile("src/app/layout.tsx", "utf8");
  const css = await readFile("src/app/globals.css", "utf8");
  const ui = await readPlanningSurface();
  const settingsOverviewUi = await readFile("src/features/settings/organisms/settings-overview.tsx", "utf8");
  const readinessUi = await readFile("src/features/settings/organisms/settings-readiness.tsx", "utf8");

  assert.match(verify, /ciWorkflowPresent/);
  assert.match(verify, /node --test tests\/\*\.test\.mjs/);
  assert.match(verify, /pnpm run verify:release/);
  assert.match(verify, /ready-for-github-actions-deployment/);
  assert.match(verify, /GitHub Actions Deployment Workflow/);
  assert.match(verify, /GitHub Actions job logs/);
  assert.match(verify, /vercel-deploy-prebuilt\.sh/);
  assert.match(verify, /Git-metadata-free/);
  assert.match(verify, /git archive HEAD/);
  assert.match(verify, /node_modules/);
  assert.match(verify, /\.next\/package\.json/);
  assert.match(verify, /TEAM_ACCESS_REQUIRED/);
  assert.match(verify, /github\.event_name == 'push'/);
  assert.match(verify, /Validate preview secrets/);
  assert.doesNotMatch(verify, /localProjectLinked/);
  assert.doesNotMatch(verify, /manualNextSteps/);
  assert.doesNotMatch(verify, /vercel link --yes --project founder-ops/);
  assert.match(verify, /\.github\/dependabot\.yml/);
  assert.match(verify, /GOOGLE_CHAT_DELIVERY_ENABLED/);
  assert.match(verify, /FOUNDEROPS_DELIVERY_SECRET/);
  assert.match(verify, /verify:google-chat/);
  assert.match(verify, /GITHUB_SYNC_TOKEN/);
  assert.match(verify, /founder-ops\.findmydoc\.eu/);
  assert.match(pkg, /verify:release/);
  assert.match(pkg, /verify:deploy/);
  assert.match(pkg, /node --test tests\/\*\.test\.mjs/);
  assert.match(pkg, /eslint/);
  assert.match(pkg, /node scripts\/verify-vercel-ready\.mjs/);
  assert.match(pkg, /node scripts\/verify-google-chat-rollout\.mjs/);
  assert.match(pkg, /pnpm audit --audit-level=moderate/);
  assert.doesNotMatch(pkg, /"verify:release": ".*next build/);
  assert.match(gitignore, /\.github\/workflows\/ci\.yml/);
  assert.match(dependabot, /package-ecosystem: npm/);
  assert.match(dependabot, /package-ecosystem: github-actions/);
  assert.match(dependabot, /timezone: Europe\/Berlin/);
  assert.match(dependabot, /nextjs-stack/);
  assert.match(deployment, /pnpm run build[\s\S]*pnpm run verify:release/);
  assert.match(deployment, /pnpm run verify:release/);
  assert.match(deployment, /pnpm audit --audit-level=moderate/);
  assert.match(deployment, /Run `pnpm run build` as its own command/);
  assert.match(deployment, /GOOGLE_CHAT_DELIVERY_ENABLED=false/);
  assert.match(deployment, /FOUNDEROPS_DELIVERY_SECRET/);
  assert.match(deployment, /09:00 Europe\/Berlin/);
  assert.match(deployment, /x-founderops-delivery-secret/);
  assert.match(deployment, /founder-ops\.findmydoc\.eu/);
  assert.match(deployment, /Do not configure a shared `GITHUB_SYNC_TOKEN`/);
  assert.match(deployment, /pnpm run verify:deploy/);
  assert.match(deployment, /GitHub Actions job logs/);
  assert.match(deployment, /Git-metadata-free runner directory/);
  assert.match(deployment, /Vercel Hobby Private Repository Author Block/);
  assert.match(deployment, /readyStateReason/);
  assert.match(deployment, /preview secrets are missing/);
  assert.doesNotMatch(deployment, /vercel link --yes --project founder-ops/);
  assert.doesNotMatch(deployment, /vercel login/);
  assert.doesNotMatch(deployment, /vercel inspect/);
  assert.doesNotMatch(deployment, /vercel logs/);
  assert.match(skill, /GitHub Actions/);
  assert.match(skill, /GitHub Actions job logs/);
  assert.match(skill, /GOOGLE_CHAT_DELIVERY_ENABLED=false/);
  assert.match(skill, /founder-ops\.findmydoc\.eu/);
  assert.match(skill, /AI Guidance: Vercel Hobby Private Author Block/);
  assert.match(skill, /TEAM_ACCESS_REQUIRED/);
  assert.match(skill, /Git-metadata-free temporary directory/);
  assert.match(skill, /Pull request jobs stay skipped when preview GitHub Environment secrets are not configured/);
  assert.doesNotMatch(skill, /Vercel CLI/);
  assert.doesNotMatch(skill, /vercel link --yes --project founder-ops/);
  assert.doesNotMatch(skill, /vercel login/);
  assert.doesNotMatch(skill, /vercel inspect/);
  assert.doesNotMatch(skill, /vercel logs/);
  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(css, /--font-sans: Inter, ui-sans-serif/);
  assert.match(ui, /SettingsOverview/);
  assert.doesNotMatch(settingsOverviewUi, /ProductionReadinessSection|SetupChecklistSection/);
  assert.doesNotMatch(readinessUi, /Betriebsdetails|manuell offen/);
  assert.doesNotMatch(readinessUi, /vercel login/);
  assert.doesNotMatch(readinessUi, /GitHub-Zugriff|Anmelde-Weiterleitungen|Deployment-Automation/);
});

test("founder events are modeled as team-visible operational reminders", async () => {
  const routes = await readFile("src/features/planning/model/workspace-routes.ts", "utf8");
  const app = await readPlanningSurface();
  const ui = await readFeatureSurface("src/features/events");
  const types = await readFile("src/lib/types.ts", "utf8");
  const data = await readFile("src/lib/planning-data-loader.ts", "utf8");
  const mappers = await readFile("src/lib/planning-notification-mappers.ts", "utf8");
  const migration = await readFile("supabase/0035_founder_events.sql", "utf8");
  const verify = await readFile("scripts/verify-supabase.mjs", "utf8");

  assert.match(routes, /id: "events"/);
  assert.match(routes, /label: "Events"/);
  assert.match(routes, /href: "\/events"/);
  assert.match(app, /workspace === "events"/);
  assert.match(app, /EventsOverview/);
  assert.match(app, /canManageEvents=\{canManageTaskMeta\}/);
  assert.match(ui, /Event-Zentrale/);
  assert.match(ui, /Alle aktiven Profile/);
  assert.match(ui, /Ausgewählte Profile/);
  assert.match(types, /export type FounderEvent/);
  assert.match(types, /events: FounderEvent\[\]/);
  assert.match(data, /founder_events/);
  assert.match(data, /mapFounderEvent/);
  assert.match(mappers, /mapFounderEvent/);
  assert.match(migration, /create table if not exists founder_events/);
  assert.match(migration, /participant_profile_ids/);
  assert.match(migration, /reminder_generated_at/);
  assert.match(migration, /founder_events_select_team/);
  assert.match(verify, /founder_events/);
});

test("founder event writes are operational-lead guarded and audited", async () => {
  const createRoute = await readFile("src/app/api/events/route.ts", "utf8");
  const updateRoute = await readFile("src/app/api/events/[id]/route.ts", "utf8");
  const eventApi = await readFile("src/features/events/model/event-api.ts", "utf8");

  assert.match(createRoute, /requireOperationalLead/);
  assert.match(createRoute, /founder_event\.create/);
  assert.match(createRoute, /audit_log/);
  assert.match(createRoute, /buildFounderEventCreateRow/);
  assert.match(eventApi, /audienceMode === "selected"/);
  assert.match(updateRoute, /requireOperationalLead/);
  assert.match(updateRoute, /founder_event\.update/);
  assert.match(updateRoute, /before_data/);
  assert.match(updateRoute, /buildFounderEventUpdatePatch/);
  assert.match(eventApi, /reminder_generated_at: reminderRelevantChange \? null/);
});

test("event reminders use the existing notification pipeline", async () => {
  const policy = await readFile("src/lib/notification-policy.ts", "utf8");
  const digestRoute = await readFile("src/app/api/notifications/generate-digest/route.ts", "utf8");
  const deliveryRoute = await readFile("src/app/api/notifications/deliver/route.ts", "utf8");

  assert.match(policy, /"event\.upcoming"/);
  assert.match(policy, /Event-Erinnerung/);
  assert.match(digestRoute, /from\("founder_events"\)/);
  assert.match(digestRoute, /isReminderWindowReached/);
  assert.match(digestRoute, /type: "event\.upcoming"/);
  assert.match(digestRoute, /recipientProfileId: profileId/);
  assert.match(digestRoute, /dedupeKey\("event\.upcoming", "founder_event"/);
  assert.match(digestRoute, /reminder_generated_at/);
  assert.match(deliveryRoute, /shouldSendToGoogleChatDigest/);
  assert.match(deliveryRoute, /shouldSendToGoogleChatDm/);
});

test("health is slim while verification scripts detect operational migrations", async () => {
  const health = await readFile("src/app/api/health/route.ts", "utf8");
  const verify = await readFile("scripts/verify-supabase.mjs", "utf8");
  const schemaChecks = await readFile("src/lib/planning-schema-checks.json", "utf8");
  const operational = await readFile("scripts/verify-operational.mjs", "utf8");
  const pkg = await readFile("package.json", "utf8");

  assert.match(health, /coreTablesReachable/);
  assert.match(health, /usesSupabaseData/);
  assert.match(health, /supabaseConfigured/);
  assert.match(health, /authRequired/);
  assert.doesNotMatch(health, /planning-schema-checks\.json/);
  assert.doesNotMatch(health, /githubSyncMode/);
  assert.doesNotMatch(health, /googleChatDeliveryStatus/);
  assert.doesNotMatch(health, /tasksMin/);
  assert.doesNotMatch(health, /counts/);
  assert.doesNotMatch(health, /expected/);
  assert.doesNotMatch(health, /schemaReady/);
  assert.match(schemaChecks, /profiles\.google_chat/);
  assert.match(schemaChecks, /notification_preferences/);
  assert.match(schemaChecks, /tasks\.carryover/);
  assert.match(schemaChecks, /sprint_commitments/);
  assert.match(schemaChecks, /packages\.initiative/);
  assert.match(schemaChecks, /tasks\.template_v2/);
  assert.match(schemaChecks, /task_relationship_edges/);
  assert.match(schemaChecks, /task_external_comments/);
  assert.match(verify, /0008_google_chat_delivery\.sql/);
  assert.match(verify, /planning-schema-checks\.json/);
  assert.match(schemaChecks, /notification_events\.dedupe_key/);
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
  const ui = await readPlanningSurface();
  const settingsOverviewUi = await readFile("src/features/settings/organisms/settings-overview.tsx", "utf8");
  const settingsNotificationsUi = await readFile("src/features/settings/organisms/settings-notifications.tsx", "utf8");
  const data = await readFile("src/lib/planning-data-loader.ts", "utf8");

  assert.match(migration, /create table if not exists feedback_items/);
  assert.match(migration, /type text not null check \(type in \('bug', 'feature'\)\)/);
  assert.match(route, /requireFounder/);
  assert.match(route, /feedback\.bug_reported/);
  assert.match(route, /feedback\.feature_requested/);
  assert.match(route, /notification_events/);
  assert.match(ui, /SettingsOverview/);
  assert.match(settingsOverviewUi, /SettingsNotificationsSection/);
  assert.match(settingsNotificationsUi, /Benachrichtigungscenter/);
  assert.match(settingsNotificationsUi, /Feedback-Eingang/);
  assert.match(settingsNotificationsUi, /Benachrichtigungsausgang/);
  assert.match(settingsNotificationsUi, /xl:col-span-2/);
  assert.match(ui, /FeedbackDialog/);
  assert.match(ui, /\/api\/feedback/);
  assert.match(data, /feedbackItems/);
});

test("workspace selection uses path routes and preserves legacy mine filter", async () => {
  const ui = await readPlanningSurface();
  const sidebar = await readFile("src/features/planning/organisms/app-sidebar.tsx", "utf8");
  const workspaceHook = await readFile("src/features/planning/hooks/use-planning-workspace.ts", "utf8");
  const routes = await readFile("src/features/planning/model/workspace-routes.ts", "utf8");
  const rootPage = await readFile("src/app/page.tsx", "utf8");
  const workspacePages = await Promise.all([
    "planning",
    "execution",
    "reviews",
    "events",
    "ceo-intake",
    "sprint",
    "projects",
    "tools",
    "team",
    "settings",
    "profile",
  ].map((workspace) => readFile(`src/app/(workspaces)/${workspace}/page.tsx`, "utf8")));

  assert.match(ui, /usePlanningWorkspace/);
  assert.doesNotMatch(`${sidebar}\n${routes}`, /\/\?workspace=/);
  assert.match(routes, /href: "\/planning"/);
  assert.match(routes, /href: "\/execution"/);
  assert.match(routes, /href: "\/reviews"/);
  assert.match(routes, /href: "\/events"/);
  assert.match(routes, /href: "\/ceo-intake"/);
  assert.match(routes, /href: "\/sprint"/);
  assert.match(routes, /href: "\/projects"/);
  assert.match(routes, /href: "\/tools"/);
  assert.match(routes, /href: "\/team"/);
  assert.match(routes, /href: "\/settings"/);
  assert.match(routes, /href: "\/profile"/);
  for (const page of workspacePages) {
    assert.match(page, /renderWorkspacePage/);
    assert.match(page, /dynamic = "force-dynamic"/);
  }
  assert.match(rootPage, /redirect\(`\$\{workspacePath\(workspace\)\}/);
  assert.match(rootPage, /rawWorkspace === "mine"/);
  assert.match(workspaceHook, /workspaceStateKey/);
  assert.match(workspaceHook, /workspacePath\(initialWorkspace\)/);
  assert.match(workspaceHook, /workspacePath\(nextWorkspace\)/);
  assert.match(workspaceHook, /router\.replace/);
  assert.match(workspaceHook, /router\.push/);
  assert.match(workspaceHook, /window\.queueMicrotask/);
  assert.match(workspaceHook, /window\.localStorage\.setItem\(workspaceStateKey, legacyMine \? "mine" : initialWorkspace\)/);
  assert.match(workspaceHook, /url\.searchParams\.delete\("workspace"\)/);
  assert.doesNotMatch(workspaceHook, /url\.searchParams\.set\("workspace", workspace\)/);
});

test("ceo task intake is ceo-only and separated from team ai work access", async () => {
  const agents = await readFile("AGENTS.md", "utf8");
  const routes = await readFile("src/features/planning/model/workspace-routes.ts", "utf8");
  const sidebar = await readFile("src/features/planning/organisms/app-sidebar.tsx", "utf8");
  const ui = await readPlanningSurface();
  const intakeUi = await readFile("src/features/intake/organisms/ceo-task-intake.tsx", "utf8");
  const previewRoute = await readFile("src/app/api/ceo/task-intake/preview/route.ts", "utf8");
  const commitRoute = await readFile("src/app/api/ceo/task-intake/commit/route.ts", "utf8");
  const taskRoute = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const taskRouteHelpers = await readFile("src/features/tasks/model/task-route-update-helpers.ts", "utf8");
  const taskRoutePolicy = `${taskRoute}\n${taskRouteHelpers}`;
  const commentsRoute = await readFile("src/app/api/tasks/[id]/comments/route.ts", "utf8");

  assert.match(agents, /Task Intake, KI-gestützte Aufgabenerstellung und Bulk-Planung sind CEO-only/);
  assert.match(agents, /Deputy, Accountable, Responsible, Founder, Assignee, or Viewer/);
  assert.match(agents, /focused contract tests/);
  assert.match(routes, /ceo-intake/);
  assert.match(routes, /ceoOnly: true/);
  assert.match(routes, /href: "\/ceo-intake"/);
  assert.match(sidebar, /currentPlatformRole === "ceo"/);
  assert.match(ui, /canUseCeoIntake = currentProfile\?\.platformRole === "ceo"/);
  assert.match(ui, /workspace === "ceo-intake" && authChecked && !canUseCeoIntake/);
  assert.match(ui, /CeoTaskIntake/);
  assert.match(ui, /Deputy, Founder, Accountable, Responsible und Zuständige/);
  assert.match(previewRoute, /requireCEO/);
  assert.match(commitRoute, /requireCEO/);
  assert.doesNotMatch(previewRoute, /requireOperationalLead/);
  assert.doesNotMatch(commitRoute, /requireOperationalLead/);
  assert.match(intakeUi, /Aufgaben importieren/);
  assert.match(intakeUi, /Geschützte Felder/);
  assert.match(intakeUi, /Planung, RACI, Sprint, Review Owner, Punkte und Erledigt werden nicht automatisch überschrieben/);
  assert.match(taskRoutePolicy, /Founder können Aufgaben nur in Review geben/);
  assert.match(taskRoutePolicy, /Diese Felder sind geschützt/);
  assert.match(taskRoute, /Nur der CEO kann den Review Owner ändern/);
  assert.match(commentsRoute, /requireFounder/);
});

test("founderops agent api is token guarded and limited to planning intake", async () => {
  const agents = await readFile("AGENTS.md", "utf8");
  const envExample = await readFile(".env.example", "utf8");
  const docs = await readFile("docs/founderops-agent-api.md", "utf8");
  const openapi = await readFile("public/founderops-agent-openapi.json", "utf8");
  const agentAuth = await readFile("src/lib/agent-auth.ts", "utf8");
  const agentData = await readFile("src/lib/agent-data.ts", "utf8");
  const contextRoute = await readFile("src/app/api/agent/context/route.ts", "utf8");
  const tasksRoute = await readFile("src/app/api/agent/tasks/route.ts", "utf8");
  const previewRoute = await readFile("src/app/api/agent/task-intake/preview/route.ts", "utf8");
  const commitRoute = await readFile("src/app/api/agent/task-intake/commit/route.ts", "utf8");
  const ceoPreviewRoute = await readFile("src/app/api/ceo/task-intake/preview/route.ts", "utf8");
  const ceoCommitRoute = await readFile("src/app/api/ceo/task-intake/commit/route.ts", "utf8");
  const commitHelper = await readFile("src/lib/task-intake-commit.ts", "utf8");
  const routeHelper = await readFile("src/lib/task-intake-route.ts", "utf8");
  const taskInsertRow = await readFile("src/lib/task-insert-row.ts", "utf8");
  const intakeContext = await readFile("src/lib/task-intake-context.ts", "utf8");

  assert.match(envExample, /FOUNDEROPS_AGENT_TOKEN_SHA256=/);
  assert.match(agents, /Agent API access must stay token-guarded and CEO-scoped/);
  assert.match(agents, /Do not expose direct database credentials/);
  assert.match(docs, /FOUNDEROPS_AGENT_TOKEN_SHA256/);
  assert.match(docs, /keine direkten Datenbank-Credentials/);
  assert.match(docs, /Keine AI-Funktion innerhalb von FounderOps/);
  assert.match(openapi, /"\/api\/agent\/context"/);
  assert.match(openapi, /"\/api\/agent\/tasks"/);
  assert.match(openapi, /"\/api\/agent\/task-intake\/preview"/);
  assert.match(openapi, /"\/api\/agent\/task-intake\/commit"/);
  assert.match(openapi, /"bearerAuth"/);
  assert.match(openapi, /"scheme": "bearer"/);
  assert.doesNotMatch(openapi, /FOUNDEROPS_AGENT_TOKEN_SHA256/);
  assert.doesNotMatch(openapi, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(openapi, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);

  assert.match(agentAuth, /FOUNDEROPS_AGENT_TOKEN_SHA256/);
  assert.match(agentAuth, /authorization/i);
  assert.match(agentAuth, /Bearer /);
  assert.match(agentAuth, /createHash\("sha256"\)/);
  assert.match(agentAuth, /timingSafeEqual/);
  assert.match(agentAuth, /status: 401/);
  assert.match(agentAuth, /status: 403/);
  assert.match(agentAuth, /Agent token is required/);
  assert.match(agentAuth, /Agent token is invalid/);
  assert.match(agentAuth, /missing the required scope/);
  assert.match(agentAuth, /read:planning/);
  assert.match(agentAuth, /write:intake/);
  assert.doesNotMatch(agentAuth, /requireCEO/);
  assert.doesNotMatch(agentAuth, /requireOperationalLead/);
  assert.doesNotMatch(agentAuth, /getServerSupabase/);
  assert.doesNotMatch(agentAuth, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(agentAuth, /provider_token/);

  assert.match(agentData, /getPlanningData/);
  assert.match(agentData, /agentConstraints/);
  assert.match(agentData, /noDirectDatabaseCredentials: true/);
  assert.match(agentData, /noAiModelInsideFounderOps: true/);
  assert.match(agentData, /forbiddenWrites/);
  assert.match(agentData, /reviewOwnerProfileId/);
  assert.match(agentData, /taskBlockers/);
  assert.match(agentData, /taskComments/);

  for (const route of [contextRoute, tasksRoute]) {
    assert.match(route, /requireAgentScope/);
    assert.match(route, /read:planning/);
    assert.doesNotMatch(route, /requireCEO/);
    assert.doesNotMatch(route, /requireOperationalLead/);
    assert.doesNotMatch(route, /provider_token/);
    assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);
  }

  for (const route of [previewRoute, commitRoute]) {
    const routeContract = `${route}\n${routeHelper}`;
    assert.match(route, /requireAgentScope/);
    assert.match(route, /write:intake/);
    assert.match(routeContract, /buildTaskIntakePreview/);
    assert.match(routeContract, /loadTaskIntakeContext/);
    assert.doesNotMatch(route, /requireCEO/);
    assert.doesNotMatch(route, /requireOperationalLead/);
    assert.doesNotMatch(route, /provider_token/);
    assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);
  }

  assert.match(`${previewRoute}\n${routeHelper}`, /valid: preview\.every/);
  assert.match(commitRoute, /agent\.task_intake\.create/);
  assert.match(commitRoute, /Agent API/);
  assert.match(commitRoute, /Agent Task Intake enthält ungültige Aufgaben/);
  assert.match(commitRoute, /loadCeoActorProfileId/);
  assert.match(commitHelper, /task_activity/);
  assert.match(commitHelper, /audit_log/);
  assert.match(commitHelper, /auditAction/);
  assert.match(commitHelper, /agent\.task_intake\.create/);
  assert.match(commitHelper, /reviewOwnerProfileId: task\.reviewOwnerProfileId/);
  assert.match(taskInsertRow, /review_owner_profile_id: input\.reviewOwnerProfileId \|\| null/);
  assert.match(intakeContext, /accountable_profile_id/);
  assert.match(intakeContext, /responsible_profile_ids/);
  assert.match(`${ceoPreviewRoute}\n${routeHelper}`, /loadTaskIntakeContext/);
  assert.match(ceoCommitRoute, /commitTaskIntake/);
  assert.match(ceoPreviewRoute, /requireCEO/);
  assert.match(ceoCommitRoute, /requireCEO/);
});

test("local seed state persists task overrides in browser storage", async () => {
  const ui = await readPlanningSurface();
  const localStateHook = await readFile("src/features/planning/hooks/use-local-planning-state.ts", "utf8");

  assert.match(ui, /useLocalPlanningState/);
  assert.match(ui, /persistLocalPlanningTasks\(nextData\.tasks\)/);
  assert.match(localStateHook, /localStateKey = "fmd-planning-local-state-v1"/);
  assert.match(localStateHook, /localDataKey = "fmd-planning-local-data-v1"/);
  assert.match(localStateHook, /export function persistLocalPlanningData/);
  assert.match(localStateHook, /if \(source === "supabase"\) return/);
  assert.match(localStateHook, /window\.localStorage\.getItem\(localDataKey\)/);
  assert.match(localStateHook, /window\.localStorage\.getItem\(localStateKey\)/);
  assert.match(localStateHook, /normalizePlanningData\(parsedData \|\| current\)/);
  assert.match(localStateHook, /window\.localStorage\.setItem\(localDataKey, JSON\.stringify\(data\)\)/);
  assert.match(localStateHook, /window\.localStorage\.setItem\(localStateKey, JSON\.stringify\(changedTasks\)\)/);
  assert.match(localStateHook, /setLocalStateLoaded\(true\)/);
});

test("header actions are workspace aware", async () => {
  const ui = await readPlanningSurface();

  assert.match(ui, /type HeaderPrimaryAction/);
  assert.match(ui, /filtersAvailable = planningWorkspaces\.includes\(workspace\)/);
  assert.match(ui, /label: "Neue Aufgabe"/);
  assert.match(ui, /label: "Aufgabe hinzufügen"/);
  assert.match(ui, /data-tour-id="planning-task-scope"/);
  assert.doesNotMatch(ui, /label: "Neue Decision"|decision-create/);
  assert.doesNotMatch(ui, /planningWorkspaces\.includes\(workspace\) \? "" : "hidden"/);
});

test("planning filters stay in session while task panel opens without routing", async () => {
  const ui = await readPlanningSurface();
  const taskRoute = await readFile("src/app/tasks/[id]/page.tsx", "utf8");

  assert.match(taskRoute, /<TaskDetailPage/);
  assert.match(taskRoute, /PlanningApp/);
  assert.doesNotMatch(taskRoute, /initialTaskId/);
  assert.match(ui, /planningFiltersSessionKey = "fmd-planning-filters-v1"/);
  assert.match(ui, /function readPlanningFiltersFromSession\(\): PlanningFilters/);
  assert.match(ui, /window\.sessionStorage\.getItem\(planningFiltersSessionKey\)/);
  assert.match(ui, /useState<PlanningFilters>\(\(\) => readPlanningFiltersFromSession\(\)\)/);
  assert.match(ui, /window\.sessionStorage\.setItem\(planningFiltersSessionKey, JSON\.stringify\(filters\)\)/);
  assert.doesNotMatch(ui, /router\.push\(`\/tasks\/\$\{encodeURIComponent\(taskId\)\}`\)/);
});

test("planning personal scope follows the effective current profile", async () => {
  const ui = await readPlanningSurface();
  const header = await readFile("src/features/planning/organisms/planning-header.tsx", "utf8");
  const filters = await readFile("src/features/planning/organisms/planning-filters.tsx", "utf8");
  const workspaceHook = await readFile("src/features/planning/hooks/use-planning-workspace.ts", "utf8");
  const controller = await readFile("src/features/planning/hooks/use-planning-app-controller.ts", "utf8");

  assert.match(ui, /serverCurrentProfile/);
  assert.match(ui, /currentProfileId: serverCurrentProfile\?\.id/);
  assert.match(ui, /filters\.quick === "mine" && taskBelongsToProfile\(task, currentProfile\)/);
  assert.match(header, /data-tour-id="planning-task-scope"/);
  assert.match(header, /Aufgaben/);
  assert.match(header, /label: "Meine"/);
  assert.match(header, /assignee: "Alle"/);
  assert.match(header, /Ansicht/);
  assert.doesNotMatch(filters, /Meine Aufgaben/);
  assert.match(workspaceHook, /rawUrlWorkspace === "mine"/);
  assert.match(controller, /legacyMineWorkspace/);
  assert.doesNotMatch(ui, /currentProfile\?\.name \|\| "Volkan"/);
  assert.doesNotMatch(ui, /currentProfile\?\.id \|\| "volkan"/);
  assert.doesNotMatch(workspaceHook, /nextWorkspace === "mine"/);
  assert.doesNotMatch(ui, /workspace === "mine"\)/);
  assert.doesNotMatch(ui, /task\.owner === "Volkan"/);
});

test("gantt uses sprint dates for scheduled tasks", async () => {
  const ui = await readPlanningSurface();
  const ganttUi = await readFile("src/features/tasks/organisms/gantt-view.tsx", "utf8");

  assert.match(ui, /<GanttView tasks=\{visibleTasks\} packages=\{data\.packages\} sprints=\{data\.sprints\}/);
  assert.match(ganttUi, /export function GanttView\(\{ tasks, packages, sprints, relations, onOpen \}/);
  assert.match(ganttUi, /parseIsoDate\(sprint\?\.startDate \|\| ""\) \|\| parseIsoDate\(task\.startDate\)/);
  assert.match(ganttUi, /parseIsoDate\(sprint\?\.endDate \|\| ""\) \|\| parseIsoDate\(task\.endDate\)/);
});
