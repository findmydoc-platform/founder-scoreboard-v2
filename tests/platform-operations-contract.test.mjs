import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

test("google chat delivery is outbox based and webhook gated", async () => {
  const migration = await readFile("supabase/0008_google_chat_delivery.sql", "utf8");
  const route = await readFile("src/app/api/notifications/deliver/route.ts", "utf8");
  const chat = await readFile("src/lib/google-chat.ts", "utf8");
  const policy = await readFile("src/lib/notification-policy.ts", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const settingsOverviewUi = await readFile("src/components/settings-overview.tsx", "utf8");
  const readinessUi = await readFile("src/components/settings-readiness.tsx", "utf8");
  const settingsNotificationsUi = await readFile("src/components/settings-notifications.tsx", "utf8");
  const inboxUi = await readFile("src/components/notification-inbox.tsx", "utf8");

  assert.match(migration, /google_chat_user_id/);
  assert.match(migration, /google_chat_dm_space/);
  assert.match(migration, /notification_preferences/);
  assert.match(route, /requireOperationalLead/);
  assert.match(route, /notification_events/);
  assert.match(route, /notification_deliveries/);
  assert.match(chat, /GOOGLE_CHAT_WEBHOOK_URL/);
  assert.match(chat, /GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL/);
  assert.match(chat, /GOOGLE_CHAT_PRIVATE_KEY/);
  assert.match(chat, /GOOGLE_CHAT_DELIVERY_ENABLED/);
  assert.match(chat, /googleChatDeliveryStatus/);
  assert.match(chat, /formatGoogleChatMessage/);
  assert.match(chat, /formatGoogleChatDigestCard/);
  assert.match(chat, /sendGoogleChatSpaceDigest/);
  assert.match(chat, /https:\/\/www\.googleapis\.com\/auth\/chat\.bot/);
  assert.match(route, /shouldSendToGoogleChatDigest/);
  assert.match(route, /googleChatDeliveryStatus/);
  assert.match(route, /isGoogleChatDmSpace/);
  assert.match(route, /deliveryMode: "direct_dm"/);
  assert.match(route, /notification_preferences/);
  assert.match(route, /Google-Chat-Präferenz/);
  assert.match(route, /notification_deliveries/);
  assert.match(policy, /task\.review_rework/);
  assert.match(policy, /task\.review_completed/);
  assert.match(policy, /meeting\.attendance_updated/);
  assert.match(policy, /feedback\.bug_reported/);
  assert.match(policy, /feedback\.feature_requested/);
  assert.match(ui, /NotificationInbox/);
  assert.match(inboxUi, /notificationTypeLabel/);
  assert.match(inboxUi, /Persönliche Hinweise bleiben hier/);
  assert.match(inboxUi, /Keine offenen Hinweise/);
  assert.match(ui, /openTaskPanel\(task\.id\)/);
  assert.match(ui, /Die verknüpfte Aufgabe wurde nicht gefunden/);
  assert.match(ui, /SettingsOverview/);
  assert.match(settingsOverviewUi, /SettingsNotificationsSection/);
  assert.match(settingsNotificationsUi, /Notification-Ausgang/);
  assert.match(settingsNotificationsUi, /googleChatDigestNotifications/);
  assert.match(settingsNotificationsUi, /googleChatReady/);
  assert.match(readinessUi, /nur gesammelt/);
  assert.match(settingsNotificationsUi, /GOOGLE_CHAT_DELIVERY_ENABLED=true/);
  assert.match(settingsNotificationsUi, /notificationChannelLabel/);
  assert.match(settingsNotificationsUi, /Keine Benachrichtigung wartet auf den Google-Chat-Digest/);
  assert.match(settingsNotificationsUi, /Digest senden/);
});

test("google chat rollout is documented and verified before delivery activation", async () => {
  const envExample = await readFile(".env.example", "utf8");
  const rollout = await readFile("docs/google-chat-rollout.md", "utf8");
  const nextStep = await readFile("docs/google-chat-next-step.md", "utf8");
  const script = await readFile("scripts/verify-google-chat-rollout.mjs", "utf8");
  const eventRoute = await readFile("src/app/api/google-chat/events/route.ts", "utf8");
  const pkg = await readFile("package.json", "utf8");

  assert.match(envExample, /GOOGLE_CHAT_WEBHOOK_URL=/);
  assert.match(envExample, /GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL=/);
  assert.match(envExample, /GOOGLE_CHAT_PRIVATE_KEY=/);
  assert.match(envExample, /GOOGLE_CHAT_DELIVERY_ENABLED=false/);
  assert.match(rollout, /GOOGLE_CHAT_DELIVERY_ENABLED=false/);
  assert.match(rollout, /GOOGLE_CHAT_DELIVERY_ENABLED=true/);
  assert.match(rollout, /notification_preferences/);
  assert.match(rollout, /profiles\.google_chat_dm_space/);
  assert.match(rollout, /spaces\/\.\.\./);
  assert.match(rollout, /Rollback/);
  assert.match(rollout, /\/api\/google-chat\/events/);
  assert.match(nextStep, /docs\/google-chat-rollout\.md/);
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

test("repo readiness includes optional ci and deployment gates", async () => {
  const verify = await readFile("scripts/verify-vercel-ready.mjs", "utf8");
  const dependabot = await readFile(".github/dependabot.yml", "utf8");
  const gitignore = await readFile(".gitignore", "utf8");
  const deployment = await readFile("docs/vercel-deployment.md", "utf8");
  const skill = await readFile("skills/fmd-vercel-readiness/SKILL.md", "utf8");
  const pkg = await readFile("package.json", "utf8");
  const layout = await readFile("src/app/layout.tsx", "utf8");
  const css = await readFile("src/app/globals.css", "utf8");
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const settingsOverviewUi = await readFile("src/components/settings-overview.tsx", "utf8");
  const readinessUi = await readFile("src/components/settings-readiness.tsx", "utf8");

  assert.match(verify, /ciWorkflowPresent/);
  assert.match(verify, /node --test tests\/\*\.test\.mjs/);
  assert.match(verify, /npm run verify:release/);
  assert.match(verify, /ready-for-github-actions-deployment/);
  assert.match(verify, /GitHub Actions Deployment Workflow/);
  assert.match(verify, /GitHub Actions job logs/);
  assert.doesNotMatch(verify, /localProjectLinked/);
  assert.doesNotMatch(verify, /manualNextSteps/);
  assert.doesNotMatch(verify, /vercel link --yes --project founder-ops/);
  assert.match(verify, /\.github\/dependabot\.yml/);
  assert.match(verify, /GOOGLE_CHAT_DELIVERY_ENABLED/);
  assert.match(verify, /verify:google-chat/);
  assert.match(verify, /GITHUB_SYNC_TOKEN/);
  assert.match(verify, /founderops\.findmydoc\.eu/);
  assert.match(pkg, /verify:release/);
  assert.match(pkg, /verify:deploy/);
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
  assert.match(deployment, /npm run build[\s\S]*npm run verify:release/);
  assert.match(deployment, /npm run verify:release/);
  assert.match(deployment, /npm audit --audit-level=moderate/);
  assert.match(deployment, /Run `npm run build` as its own command/);
  assert.match(deployment, /GOOGLE_CHAT_DELIVERY_ENABLED=false/);
  assert.match(deployment, /founderops\.findmydoc\.eu/);
  assert.match(deployment, /Do not configure a shared `GITHUB_SYNC_TOKEN`/);
  assert.match(deployment, /npm run verify:deploy/);
  assert.match(deployment, /GitHub Actions job logs/);
  assert.doesNotMatch(deployment, /vercel link --yes --project founder-ops/);
  assert.doesNotMatch(deployment, /vercel login/);
  assert.doesNotMatch(deployment, /vercel inspect/);
  assert.doesNotMatch(deployment, /vercel logs/);
  assert.match(skill, /GitHub Actions/);
  assert.match(skill, /GitHub Actions job logs/);
  assert.match(skill, /GOOGLE_CHAT_DELIVERY_ENABLED=false/);
  assert.match(skill, /founderops\.findmydoc\.eu/);
  assert.doesNotMatch(skill, /Vercel CLI/);
  assert.doesNotMatch(skill, /vercel link --yes --project founder-ops/);
  assert.doesNotMatch(skill, /vercel login/);
  assert.doesNotMatch(skill, /vercel inspect/);
  assert.doesNotMatch(skill, /vercel logs/);
  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(css, /--font-sans: Inter, ui-sans-serif/);
  assert.match(ui, /SettingsOverview/);
  assert.match(settingsOverviewUi, /ProductionReadinessSection/);
  assert.match(readinessUi, /Production Readiness/);
  assert.match(readinessUi, /GitHub Actions offen/);
  assert.doesNotMatch(readinessUi, /vercel login/);
  assert.match(readinessUi, /GitHub OAuth/);
  assert.match(readinessUi, /Supabase Auth Redirects/);
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
  const settingsOverviewUi = await readFile("src/components/settings-overview.tsx", "utf8");
  const settingsNotificationsUi = await readFile("src/components/settings-notifications.tsx", "utf8");
  const data = await readFile("src/lib/planning-data.ts", "utf8");

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
  assert.match(settingsNotificationsUi, /Notification-Ausgang/);
  assert.match(settingsNotificationsUi, /xl:col-span-2/);
  assert.match(ui, /FeedbackDialog/);
  assert.match(ui, /\/api\/feedback/);
  assert.match(data, /feedbackItems/);
});

test("workspace selection survives page refreshes", async () => {
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const workspaceHook = await readFile("src/hooks/use-planning-workspace.ts", "utf8");

  assert.match(ui, /usePlanningWorkspace/);
  assert.match(workspaceHook, /workspaceStateKey/);
  assert.match(workspaceHook, /URLSearchParams\(window\.location\.search\)/);
  assert.match(workspaceHook, /window\.localStorage\.setItem\(workspaceStateKey, workspace\)/);
  assert.match(workspaceHook, /url\.searchParams\.set\("workspace", workspace\)/);
});

test("local seed state persists task overrides in browser storage", async () => {
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const localStateHook = await readFile("src/hooks/use-local-planning-state.ts", "utf8");

  assert.match(ui, /useLocalPlanningState/);
  assert.match(ui, /persistLocalPlanningTasks\(nextData\.tasks\)/);
  assert.match(localStateHook, /localStateKey = "fmd-planning-local-state-v1"/);
  assert.match(localStateHook, /if \(source === "supabase"\) return/);
  assert.match(localStateHook, /window\.localStorage\.getItem\(localStateKey\)/);
  assert.match(localStateHook, /window\.localStorage\.setItem\(localStateKey, JSON\.stringify\(changedTasks\)\)/);
  assert.match(localStateHook, /setLocalStateLoaded\(true\)/);
});

test("header actions are workspace aware", async () => {
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const decisionUi = await readFile("src/components/decision-log-overview.tsx", "utf8");

  assert.match(ui, /type HeaderPrimaryAction/);
  assert.match(ui, /filtersAvailable = planningWorkspaces\.includes\(workspace\)/);
  assert.match(ui, /label: "Neue Aufgabe"/);
  assert.match(ui, /label: "Vorschlag erstellen"/);
  assert.match(ui, /label: "Aufgabe hinzufügen"/);
  assert.match(ui, /label: "Neue Decision"/);
  assert.match(decisionUi, /id="decision-create"/);
  assert.doesNotMatch(ui, /planningWorkspaces\.includes\(workspace\) \? "" : "hidden"/);
});

test("mine workspace follows the effective current profile", async () => {
  const ui = await readFile("src/components/planning-app.tsx", "utf8");

  assert.match(ui, /const mineOwnerName = currentProfile\?\.name \|\| "Volkan"/);
  assert.match(ui, /filters\.quick === "mine" && task\.owner === mineOwnerName/);
  assert.match(ui, /workspace === "mine"\) return filteredTasks\.filter\(\(task\) => task\.owner === mineOwnerName\)/);
  assert.match(ui, /Fokus auf die Aufgaben von \$\{mineOwnerName\}/);
  assert.doesNotMatch(ui, /workspace === "mine"\) return filteredTasks\.filter\(\(task\) => task\.owner === "Volkan"\)/);
});

test("gantt uses sprint dates for scheduled tasks", async () => {
  const ui = await readFile("src/components/planning-app.tsx", "utf8");
  const ganttUi = await readFile("src/components/gantt-view.tsx", "utf8");

  assert.match(ui, /<CurrentGanttView tasks=\{visibleTasks\} packages=\{data\.packages\} sprints=\{data\.sprints\}/);
  assert.match(ganttUi, /export function GanttView\(\{ tasks, packages, sprints, relations, onOpen \}/);
  assert.match(ganttUi, /parseIsoDate\(sprint\?\.startDate \|\| ""\) \|\| parseIsoDate\(task\.startDate\)/);
  assert.match(ganttUi, /parseIsoDate\(sprint\?\.endDate \|\| ""\) \|\| parseIsoDate\(task\.endDate\)/);
});
