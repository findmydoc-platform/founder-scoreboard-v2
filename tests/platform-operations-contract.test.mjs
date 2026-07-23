import { readSupabaseSchemaContract } from "../scripts/lib/supabase-migrations.mjs";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { readFeatureSurface, readPlanningSurface } from "./helpers/planning-surface.mjs";
import test from "node:test";
import assert from "node:assert/strict";

test("google chat delivery is outbox based and webhook gated", async () => {
  const migration = await readSupabaseSchemaContract();
  const dedupeMigration = await readSupabaseSchemaContract();
  const resolvedStatusMigration = await readSupabaseSchemaContract();
  const route = await readFile("src/app/api/notifications/deliver/route.ts", "utf8");
  const generatorRoute = await readFile("src/app/api/notifications/generate-digest/route.ts", "utf8");
  const chat = await readFile("src/lib/google-chat.ts", "utf8");
  const policy = await readFile("src/lib/notification-policy.ts", "utf8");
  const catalog = await readFile("src/lib/notification-catalog.ts", "utf8");
  const resolutionPolicy = await readFile("src/lib/notification-resolution.ts", "utf8");
  const planningData = await readFile("src/lib/planning-data.ts", "utf8");
  const types = await readFile("src/lib/types.ts", "utf8");
  const ui = await readPlanningSurface();
  const notificationsOverviewUi = await readFile("src/features/notifications/organisms/notifications-overview.tsx", "utf8");
  const notificationOutboxUi = await readFile("src/features/notifications/organisms/notification-outbox-panel.tsx", "utf8");
  const inboxUi = await readFile("src/features/notifications/organisms/notification-inbox.tsx", "utf8");
  const notificationCommands = await readFile("src/features/planning/hooks/use-notification-commands.ts", "utf8");
  const notificationRoute = await readFile("src/app/api/notifications/[id]/route.ts", "utf8");
  const notificationTarget = await readFile("src/features/notifications/model/notification-target.ts", "utf8");

  assert.match(migration, /google_chat_user_id/);
  assert.match(migration, /google_chat_dm_space/);
  assert.match(migration, /notification_preferences/);
  assert.match(dedupeMigration, /create table if not exists notification_events[^]*dedupe_key text/);
  assert.match(dedupeMigration, /notification_events_dedupe_key_uidx/);
  assert.match(dedupeMigration, /notification_events_dedupe_key_uidx[^]*dedupe_key is not null/);
  assert.match(resolvedStatusMigration, /notification_events_status_check/);
  assert.match(resolvedStatusMigration, /'resolved'/);
  assert.match(types, /"pending" \| "sent" \| "failed" \| "dismissed" \| "resolved"/);
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
  assert.match(catalog, /task\.review_rework/);
  assert.match(catalog, /task\.review_completed/);
  assert.match(catalog, /task\.deadline_overdue/);
  assert.match(policy, /googleChatDirectDmEventTypes/);
  assert.match(policy, /shouldSendToGoogleChatDm/);
  assert.match(catalog, /sprint\.review_due/);
  assert.match(catalog, /meeting\.attendance_updated/);
  assert.doesNotMatch(catalog, /feedback\.bug_reported/);
  assert.doesNotMatch(catalog, /feedback\.feature_requested/);
  assert.match(catalog, /lifecycle: "actionable"/);
  assert.match(resolutionPolicy, /"task\.review_requested"/);
  assert.match(resolutionPolicy, /"task\.review_rework"/);
  assert.match(resolutionPolicy, /"task\.blocker_reported"/);
  assert.match(resolutionPolicy, /"task\.deadline_overdue"/);
  assert.match(resolutionPolicy, /"task\.proposed"/);
  assert.match(resolutionPolicy, /"sprint\.review_due"/);
  assert.match(resolutionPolicy, /"event\.upcoming"/);
  assert.match(catalog, /lifecycle: "informational"/);
  assert.match(resolutionPolicy, /"task\.comment"/);
  assert.match(resolutionPolicy, /"task\.mention"/);
  assert.match(resolutionPolicy, /"task\.review_completed"/);
  assert.match(resolutionPolicy, /"meeting\.attendance_updated"/);
  assert.match(planningData, /reconcileNotificationEvents/);
  assert.match(resolutionPolicy, /status: "resolved", resolved_at:/);
  assert.match(resolutionPolicy, /\.eq\("status", "pending"\)/);
  assert.match(ui, /NotificationInbox/);
  assert.match(inboxUi, /notificationTypeLabel/);
  assert.match(inboxUi, /HeaderNotification/);
  assert.match(inboxUi, /items\.map\(\(event\)/);
  assert.match(inboxUi, /unreadCount/);
  assert.match(inboxUi, /onDismiss\(event\.id\)/);
  assert.match(ui, /openTaskPanel\(task\.id\)/);
  assert.doesNotMatch(ui, /Die verknüpfte Aufgabe wurde nicht gefunden/);
  assert.match(notificationCommands, /updateNotificationStatus\(event\.id, "seen"\)/);
  assert.match(notificationCommands, /notificationTarget\(event\)/);
  assert.match(notificationCommands, /if \(!task \|\| !taskOverlayWorkspaces\.has\(workspace\)\)/);
  assert.match(notificationRoute, /"seen", "dismiss"/);
  assert.match(notificationRoute, /requireTeamMember/);
  assert.match(notificationTarget, /entityType === "founder_event"/);
  assert.match(notificationTarget, /entityType === "fmd_tool"/);
  assert.match(notificationTarget, /`\/initiatives\/\$\{encodeURIComponent\(entityId\)\}`/);
  assert.match(notificationTarget, /"meeting", "sprint", "sprint_commitment", "score_objection"/);
  assert.match(inboxUi, /notificationTarget\(event\)\.href/);
  assert.match(ui, /NotificationsOverview/);
  assert.match(notificationsOverviewUi, /NotificationOutboxPanel/);
  assert.match(notificationsOverviewUi, /Für mich/);
  assert.match(notificationsOverviewUi, /personalFilterLabels/);
  assert.match(notificationsOverviewUi, /isPersonalNotificationDone/);
  assert.match(notificationsOverviewUi, /status === "dismissed" \|\| status === "resolved"/);
  assert.match(notificationsOverviewUi, /onDismissNotification/);
  assert.match(notificationOutboxUi, /googleChatDigestNotifications/);
  assert.match(notificationOutboxUi, /googleChatReady/);
  assert.match(notificationOutboxUi, /googleChatDeliveryEnabled/);
  assert.doesNotMatch(notificationsOverviewUi, /SystemStatusSection|settings-readiness|Arbeitsbereitschaft/);
  assert.doesNotMatch(notificationOutboxUi, /GOOGLE_CHAT_DELIVERY_ENABLED/);
  assert.match(notificationOutboxUi, /notificationChannelLabel/);
  assert.match(notificationOutboxUi, /onSendGoogleChatTest/);
  assert.match(notificationOutboxUi, /onRetryNotificationDelivery/);
  assert.match(notificationOutboxUi, /webhook_digest/);
  assert.match(notificationOutboxUi, /direct_dm/);
});

test("google chat rollout is documented and verified before delivery activation", async () => {
  const envExample = await readFile(".env.example", "utf8");
  const rollout = await readFile("docs/google-chat-rollout.md", "utf8");
  const script = await readFile("scripts/verify-google-chat-rollout.mjs", "utf8");
  const deliverRoute = await readFile("src/app/api/notifications/deliver/route.ts", "utf8");
  const eventRoute = await readFile("src/app/api/google-chat/events/route.ts", "utf8");
  const releaseWorkflow = await readFile(".github/workflows/send-release-google-chat.yml", "utf8");
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
  assert.match(rollout, /\.github\/workflows\/send-release-google-chat\.yml/);
  assert.match(rollout, /x-founderops-delivery-secret/);
  assert.match(rollout, /FOUNDEROPS_DELIVERY_SECRET/);
  assert.match(rollout, /message_payload_json/);
  assert.match(rollout, /APP_URL=https:\/\/founder-ops\.findmydoc\.eu/);
  assert.match(rollout, /Rollback/);
  assert.match(rollout, /\/api\/google-chat\/events/);
  assert.match(rollout, /https:\/\/founder-ops\.findmydoc\.eu\/api\/google-chat\/events/);
  assert.match(rollout, /keinen Gruppenchat-Fallback/);
  assert.match(script, /googleChatDeliveryStatus/);
  assert.match(script, /GOOGLE_CHAT_DELIVERY_ENABLED=false/);
  assert.match(script, /FOUNDEROPS_DELIVERY_SECRET/);
  assert.match(script, /x-founderops-delivery-secret/);
  assert.match(script, /send-release-google-chat\.yml/);
  assert.doesNotMatch(script, /settings-notifications\.tsx/);
  assert.doesNotMatch(script, /Test-Sammelmeldung|Direktnachricht|Zustelldetails anzeigen/);
  assert.match(releaseWorkflow, /name: Send Release Google Chat/);
  assert.match(releaseWorkflow, /workflow_dispatch/);
  assert.match(releaseWorkflow, /message_payload_json/);
  assert.match(releaseWorkflow, /release_tag/);
  assert.match(releaseWorkflow, /permissions: \{\}/);
  assert.match(releaseWorkflow, /GOOGLE_CHAT_WEBHOOK_URL/);
  assert.match(releaseWorkflow, /messageReplyOption/);
  assert.doesNotMatch(releaseWorkflow, /FOUNDEROPS_DELIVERY_SECRET/);
  assert.doesNotMatch(releaseWorkflow, /x-founderops-delivery-secret/);
  assert.doesNotMatch(releaseWorkflow, /api\/notifications\/generate-digest/);
  assert.doesNotMatch(releaseWorkflow, /api\/notifications\/deliver/);
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
  const pkg = await readFile("package.json", "utf8");
  const layout = await readFile("src/app/layout.tsx", "utf8");
  const css = await readFile("src/app/globals.css", "utf8");
  const ui = await readPlanningSurface();
  const notificationsOverviewUi = await readFile("src/features/notifications/organisms/notifications-overview.tsx", "utf8");

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
  assert.match(verify, /send-release-google-chat\.yml/);
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
  assert.match(deployment, /send-release-google-chat\.yml/);
  assert.match(deployment, /message_payload_json/);
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
  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(css, /--font-sans: Inter, ui-sans-serif/);
  assert.match(ui, /NotificationsOverview/);
  assert.doesNotMatch(notificationsOverviewUi, /ProductionReadinessSection|SetupChecklistSection/);
  assert.doesNotMatch(notificationsOverviewUi, /Betriebsdetails|manuell offen/);
  assert.doesNotMatch(notificationsOverviewUi, /vercel login/);
  assert.doesNotMatch(notificationsOverviewUi, /GitHub-Zugriff|Anmelde-Weiterleitungen|Deployment-Automation|Arbeitsbereitschaft/);
});

test("founder events are modeled as team-visible operational reminders", async () => {
  const routes = await readFile("src/features/planning/model/workspace-routes.ts", "utf8");
  const app = await readPlanningSurface();
  const ui = await readFeatureSurface("src/features/events");
  const types = await readFile("src/lib/types.ts", "utf8");
  const data = await readFile("src/lib/planning-data-loader.ts", "utf8");
  const mappers = await readFile("src/lib/planning-notification-mappers.ts", "utf8");
  const migration = await readSupabaseSchemaContract();
  const verify = await readFile("scripts/verify-supabase.mjs", "utf8");

  assert.match(routes, /id: "events"/);
  assert.match(routes, /label: "Events"/);
  assert.match(routes, /href: "\/events"/);
  assert.match(app, /workspace === "events"/);
  assert.match(app, /EventsOverview/);
  assert.match(app, /canManageEvents=\{canManageTaskMeta\}/);
  assert.match(app, /HeaderEventCalendar/);
  assert.match(ui, /Event-Zentrale/);
  assert.match(ui, /Kalender öffnen/);
  assert.match(ui, /buildEventsByDay/);
  assert.match(ui, /eventDayKeys/);
  assert.match(ui, /Nächste Events/);
  assert.match(ui, /dayEvents\.slice\(0, 3\)/);
  assert.match(ui, /!events\.length/);
  assert.match(ui, /Noch keine Events/);
  assert.match(ui, /Event eintragen/);
  assert.match(ui, /eventForm/);
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
  const policy = await readFile("src/lib/notification-catalog.ts", "utf8");
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
  assert.match(verify, /canonical migration history/);
  assert.match(verify, /planning-schema-checks\.json/);
  assert.match(schemaChecks, /notification_events\.dedupe_key/);
  assert.match(verify, /pnpm run db:reset/);
  assert.match(verify, /notificationDeliveries/);
  assert.match(operational, /Planung/);
  assert.match(operational, /Backlog/);
  assert.match(operational, /Reviews/);
  assert.match(operational, /Sprint &amp; Score/);
  assert.match(operational, /Meilensteine/);
  assert.match(operational, /githubMappedProfiles/);
  assert.match(operational, /googleChatConfigured/);
  assert.match(operational, /googleChatDeliveryEnabled/);
  assert.match(operational, /googleChatReady/);
  assert.match(pkg, /verify:operational/);
});

test("active founder feedback is removed while historical migration stays intact", async () => {
  const migration = await readSupabaseSchemaContract();
  const ui = await readPlanningSurface();
  const notificationsOverviewUi = await readFile("src/features/notifications/organisms/notifications-overview.tsx", "utf8");
  const notificationOutboxUi = await readFile("src/features/notifications/organisms/notification-outbox-panel.tsx", "utf8");
  const data = await readFile("src/lib/planning-data-loader.ts", "utf8");
  const dataScopes = await readFile("src/lib/planning-data-scopes.ts", "utf8");
  const apiClient = await readFile("src/features/planning/model/planning-api-client.ts", "utf8");
  const notificationPolicy = await readFile("src/lib/notification-policy.ts", "utf8");

  assert.match(migration, /create table if not exists feedback_items/);
  assert.match(migration, /feedback_items_type_check[^]*'bug'[^]*'feature'/);
  assert.equal(existsSync("src/app/api/feedback/route.ts"), false);
  assert.equal(existsSync("src/features/settings/molecules/feedback-dialog.tsx"), false);
  assert.equal(existsSync("src/features/settings/hooks/use-feedback-commands.ts"), false);
  assert.match(ui, /NotificationsOverview/);
  assert.match(notificationsOverviewUi, /NotificationOutboxPanel/);
  assert.match(notificationOutboxUi, /Zustellung inaktiv/);
  assert.match(notificationOutboxUi, /Sammelmeldung senden/);
  assert.match(notificationOutboxUi, /Testversand/);
  assert.doesNotMatch(notificationOutboxUi, /Feedback-Eingang/);
  assert.doesNotMatch(ui, /FeedbackDialog/);
  assert.doesNotMatch(ui, /\/api\/feedback/);
  assert.doesNotMatch(data, /feedbackItems|feedback_items/);
  assert.doesNotMatch(dataScopes, /feedbackItems/);
  assert.doesNotMatch(apiClient, /createFeedbackRequest|\/api\/feedback/);
  assert.doesNotMatch(notificationPolicy, /feedback\.bug_reported|feedback\.feature_requested/);
});

test("workspace selection uses path routes and root-only profile defaults", async () => {
  const ui = await readPlanningSurface();
  const sidebar = await readFile("src/features/planning/organisms/app-sidebar.tsx", "utf8");
  const workspaceHook = await readFile("src/features/planning/hooks/use-planning-workspace.ts", "utf8");
  const preferenceSync = await readFile("src/features/profile/hooks/use-profile-ui-preference-sync.ts", "utf8");
  const routes = await readFile("src/features/planning/model/workspace-routes.ts", "utf8");
  const workspacePreferences = await readFile("src/features/planning/model/workspace-preferences.ts", "utf8");
  const rootPage = await readFile("src/app/page.tsx", "utf8");
  const planningAuth = await readFile("src/lib/planning-auth-server.ts", "utf8");
  const taskDetailWorkflow = await readFile("src/features/tasks/hooks/use-task-detail-workflow.ts", "utf8");
  const executionPage = await readFile("src/app/(workspaces)/execution/page.tsx", "utf8");
  const legacyReviewsPage = await readFile("src/app/(workspaces)/reviews/page.tsx", "utf8");
  const workspacePage = await readFile("src/app/(workspaces)/workspace-page.tsx", "utf8");
  const planningData = await readFile("src/lib/planning-data.ts", "utf8");
  const dataLoader = await readFile("src/lib/planning-data-loader.ts", "utf8");
  const dataScopes = await readFile("src/lib/planning-data-scopes.ts", "utf8");
  const headerData = await readFile("src/lib/planning-header-data.ts", "utf8");
  const planningDataApi = await readFile("src/app/api/planning-data/route.ts", "utf8");
  const workspacePages = await Promise.all([
    "planning",
    "decision-log",
    "events",
    "sprint",
    "projects",
    "tools",
    "team",
    "notifications",
    "settings",
    "profile",
  ].map((workspace) => readFile(`src/app/(workspaces)/${workspace}/page.tsx`, "utf8")));

  assert.match(ui, /usePlanningWorkspace/);
  assert.doesNotMatch(`${sidebar}\n${routes}`, /\/\?workspace=/);
  assert.match(routes, /href: "\/planning"/);
  assert.match(routes, /href: "\/decision-log"/);
  assert.doesNotMatch(routes, /href: "\/execution"|id: "execution"/);
  assert.doesNotMatch(routes, /href: "\/reviews"|id: "reviews"/);
  assert.match(workspacePreferences, /value === "mine" \|\| value === "execution" \|\| value === "reviews"/);
  assert.match(legacyReviewsPage, /permanentRedirect\("\/planning\?tasks\.review=requested"\)/);
  assert.match(routes, /href: "\/events"/);
  assert.doesNotMatch(routes, /ceo-intake|href: "\/ceo-intake"/);
  assert.match(routes, /href: "\/sprint"/);
  assert.match(routes, /href: "\/projects"/);
  assert.match(routes, /href: "\/tools"/);
  assert.match(routes, /href: "\/team"/);
  assert.match(routes, /href: "\/notifications"/);
  assert.doesNotMatch(routes, /href: "\/settings"/);
  assert.match(routes, /href: "\/profile"/);
  for (const page of workspacePages.filter((page) => !/redirect\("\/notifications"\)/.test(page))) {
    assert.match(page, /renderWorkspacePage/);
    assert.match(page, /dynamic = "force-dynamic"/);
  }
  assert.match(workspacePages.find((page) => /redirect\("\/notifications"\)/.test(page)) || "", /dynamic = "force-dynamic"/);
  assert.match(executionPage, /redirect\("\/planning"\)/);
  assert.match(rootPage, /getServerPlanningHomeWorkspace/);
  assert.match(rootPage, /redirect\(workspacePath\(workspace\)\)/);
  assert.doesNotMatch(rootPage, /searchParams|rawWorkspace|URLSearchParams|workspace=/);
  assert.match(planningAuth, /getServerPlanningAuthContext\(teamMemberRoles\)/);
  assert.match(planningAuth, /\.from\("profile_ui_preferences"\)/);
  assert.match(planningAuth, /\.eq\("profile_id", auth\.profile\.id\)/);
  assert.match(planningAuth, /rootWorkspaceFromPreference\(data\?\.default_workspace\)/);
  assert.match(workspacePreferences, /value === "settings"\) return "notifications"/);
  assert.match(workspacePage, /getPlanningData\(getPlanningDataScopeForWorkspace\(initialWorkspace\),/);
  assert.match(dataScopes, /export const workspaceDataScopes/);
  assert.match(dataScopes, /export const taskDetailPageDataScope/);
  assert.match(dataScopes, /getPlanningDataScopeForWorkspace/);
  assert.match(dataScopes, /planningDataWorkspaceFromValue/);
  assert.match(dataScopes, /notificationEvents: false/);
  assert.match(dataScopes, /tools: \{ \.\.\.baseWorkspaceDataScope, fmdTools: true \}/);
  assert.match(dataScopes, /events: \{ \.\.\.baseWorkspaceDataScope, events: true \}/);
  assert.match(dataScopes, /notifications: \{[\s\S]*notificationEvents: true,[\s\S]*notificationDeliveries: true,[\s\S]*\}/);
  assert.match(dataScopes, /value === "settings"\) return "notifications"/);
  assert.match(dataScopes, /sprint: \{[\s\S]*founderSprintScores: true,[\s\S]*meetingAttendance: true,[\s\S]*\}/);
  assert.match(dataScopes, /profile: \{[\s\S]*notificationPreferences: true,[\s\S]*\}/);
  assert.match(dataLoader, /export type PlanningDataQueryScope/);
  assert.match(dataLoader, /shouldLoad\(scope, "fmdTools"\)/);
  assert.match(dataLoader, /skippedListResult<DbFmdTool>/);
  assert.match(headerData, /HeaderQuickLink/);
  assert.match(headerData, /HeaderCalendarEvent/);
  assert.match(headerData, /headerQuickLinkSelect/);
  assert.match(headerData, /headerCalendarEventSelect/);
  assert.match(headerData, /loadPlanningHeaderData/);
  assert.match(planningData, /headerData/);
  assert.match(planningData, /filterPlanningDataForWorkspaceAccess/);
  assert.match(planningData, /isOperationalLeadRole\(access\.platformRole!/);
  assert.match(planningData, /event\.recipientProfileId === currentProfileId/);
  assert.match(planningData, /notificationDeliveries: \[\]/);
  assert.match(planningDataApi, /planningDataWorkspaceFromValue\(rawWorkspace\)/);
  assert.match(planningDataApi, /apiError\("Unknown planning workspace\.", 400\)/);
  assert.match(planningDataApi, /platformRole: auth\.profile\?\.platformRole/);
  assert.match(workspaceHook, /workspacePath\(nextWorkspace\)/);
  assert.match(workspaceHook, /router\.push/);
  assert.doesNotMatch(workspaceHook, /workspaceStateKey|localStorage|searchParams|legacyMineWorkspace|router\.replace/);
  assert.doesNotMatch(preferenceSync, /setWorkspace|pathHasWorkspace|workspaceFromPathname/);
  assert.match(taskDetailWorkflow, /router\.replace\("\/planning"\)/);
  assert.doesNotMatch(taskDetailWorkflow, /\/\?workspace=/);
});

test("Planning Items API is the sole automated planning-item creation contract", async () => {
  const routes = await readFile("src/features/planning/model/workspace-routes.ts", "utf8");
  const ui = await readPlanningSurface();
  const planningItemsRoute = await readFile("src/app/api/team/planning-items/v1/items/route.ts", "utf8");
  const planningItemsDocumentation = await readFile("docs/team-planning-items-api.md", "utf8");
  const taskRoute = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const taskRouteHelpers = await readFile("src/features/tasks/model/task-route-update-helpers.ts", "utf8");
  const taskRoutePolicy = `${taskRoute}\n${taskRouteHelpers}`;
  const commentsRoute = await readFile("src/app/api/tasks/[id]/comments/route.ts", "utf8");

  for (const path of [
    "src/app/(workspaces)/ceo-intake/page.tsx",
    "src/app/(workspaces)/ceo-intake/loading.tsx",
    "src/app/api/ceo/task-intake/preview/route.ts",
    "src/app/api/ceo/task-intake/commit/route.ts",
    "src/features/intake/organisms/ceo-task-intake.tsx",
    "src/features/intake/model/task-intake-api-client.ts",
  ]) {
    assert.equal(existsSync(path), false, `${path} must stay removed`);
  }
  assert.doesNotMatch(routes, /ceo-intake/);
  assert.doesNotMatch(ui, /CEO Intake|CeoTaskIntake|canUseCeoIntake|\/api\/ceo\/task-intake/);
  assert.match(planningItemsRoute, /create_team_planning_items_transaction/);
  assert.match(planningItemsDocumentation, /sole supported API contract for automated planning-item creation/);
  assert.match(taskRoutePolicy, /Founder können Aufgaben nur in Review geben/);
  assert.match(taskRoutePolicy, /Diese Felder sind geschützt/);
  assert.match(taskRoute, /Nur der CEO kann den Review Owner ändern/);
  assert.match(commentsRoute, /requirePlanningContributor/);
});

test("planning mutations do not persist a browser seed database", async () => {
  const ui = await readPlanningSurface();
  assert.doesNotMatch(ui, /useLocalPlanningState|persistLocalPlanningData|persistLocalPlanningTasks/);
});

test("header actions are workspace aware", async () => {
  const ui = await readPlanningSurface();
  const header = await readFile("src/features/planning/organisms/app-header.tsx", "utf8");
  const planningHeader = await readFile("src/features/planning/organisms/planning-header.tsx", "utf8");
  const model = await readFile("src/features/planning/model/planning-app-model.ts", "utf8");

  assert.match(ui, /type HeaderAction/);
  assert.match(ui, /filtersAvailable = planningWorkspaces\.includes\(workspace\)/);
  assert.match(header, /description: string/);
  assert.doesNotMatch(header, /subtitle/);
  assert.match(planningHeader, /description=\{description\}/);
  assert.match(planningHeader, /Zeitraum: \$\{data\.project\.range\}/);
  assert.match(model, /workspaceDescriptions: Record<Workspace, string>/);
  assert.match(model, /planning: "Zeigt die Gesamtplanung/);
  assert.match(model, /backlog: "Priorisiert Aufgaben, bereitet Vorschläge vor/);
  assert.doesNotMatch(model, /workspaceSubtitles/);
  assert.match(ui, /label: "Neue Aufgabe"/);
  assert.match(ui, /label: "Aufgabe hinzufügen"/);
  assert.match(ui, /label: "Neuer Meilenstein"/);
  assert.match(ui, /label: "Neue Initiative"/);
  assert.match(ui, /data-tour-id="planning-task-scope"/);
  assert.doesNotMatch(ui, /label: "Neue Decision"|decision-create/);
  assert.doesNotMatch(ui, /planningWorkspaces\.includes\(workspace\) \? "" : "hidden"/);
});

test("planning filters use namespaced URL state while task panel opens without routing", async () => {
  const ui = await readPlanningSurface();
  const viewState = await readFile("src/features/planning/hooks/use-planning-view-state.ts", "utf8");
  const taskRoute = await readFile("src/app/tasks/[id]/page.tsx", "utf8");

  assert.match(taskRoute, /<TaskDetailPage/);
  assert.match(taskRoute, /PlanningApp/);
  assert.doesNotMatch(taskRoute, /initialTaskId/);
  assert.match(viewState, /namespace: "tasks"/);
  assert.match(viewState, /useTableUrlState/);
  assert.match(viewState, /DEFAULT_PLANNING_FILTERS/);
  assert.doesNotMatch(viewState, /sessionStorage|planningFiltersSessionKey/);
  assert.doesNotMatch(ui, /router\.push\(`\/tasks\/\$\{encodeURIComponent\(taskId\)\}`\)/);
});

test("planning personal scope follows the effective current profile", async () => {
  const ui = await readPlanningSurface();
  const header = await readFile("src/features/planning/organisms/planning-header.tsx", "utf8");
  const filters = await readFile("src/features/planning/organisms/planning-filters.tsx", "utf8");
  const workspaceHook = await readFile("src/features/planning/hooks/use-planning-workspace.ts", "utf8");
  const controller = await readFile("src/features/planning/hooks/use-planning-app-controller.ts", "utf8");

  assert.match(ui, /serverCurrentProfile/);
  assert.match(ui, /currentProfileId: auth\.serverCurrentProfile\?\.id/);
  assert.match(ui, /quickFilter === "mine" && taskBelongsToProfile\(task, currentProfile\)/);
  assert.match(header, /data-tour-id="planning-task-scope"/);
  assert.match(header, /Aufgaben/);
  assert.match(header, /label: "Meine"/);
  assert.match(header, /assignee: "Alle"/);
  assert.match(header, /Ansicht/);
  assert.match(filters, /Meine Aufgaben/);
  assert.doesNotMatch(workspaceHook, /rawUrlWorkspace|localStorage|legacyMineWorkspace/);
  assert.doesNotMatch(controller, /legacyMineWorkspace/);
  assert.doesNotMatch(ui, /currentProfile\?\.name \|\| "Volkan"/);
  assert.doesNotMatch(ui, /currentProfile\?\.id \|\| "volkan"/);
  assert.doesNotMatch(workspaceHook, /nextWorkspace === "mine"/);
  assert.doesNotMatch(ui, /workspace === "mine"\)/);
  assert.doesNotMatch(ui, /task\.owner === "Volkan"/);
});

test("gantt uses sprint dates for scheduled tasks", async () => {
  const ui = await readPlanningSurface();
  const ganttUi = await readFile("src/features/tasks/organisms/gantt-view.tsx", "utf8");

  assert.match(ui, /<GanttView tasks=\{planningBoardTasks\} packages=\{data\.packages\} sprints=\{data\.sprints\}/);
  assert.match(ganttUi, /export function GanttView\(\{ tasks, packages, sprints, relations, onOpenTask \}/);
  assert.match(ganttUi, /parseIsoDate\(sprint\?\.startDate \|\| ""\) \|\| parseIsoDate\(task\.startDate\)/);
  assert.match(ganttUi, /parseIsoDate\(sprint\?\.endDate \|\| ""\) \|\| parseIsoDate\(task\.endDate\)/);
});
