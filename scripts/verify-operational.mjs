import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createSupabaseScriptClient } from "./lib/supabase.mjs";

const appUrl = process.env.APP_URL || "http://localhost:3000";
const seedSource = JSON.parse(await readFile(resolve(process.cwd(), "src/lib/seed/source.json"), "utf8"));
const expected = {
  profiles: seedSource.profiles.length,
  tasksMin: seedSource.tasks.length,
};

const supabase = await createSupabaseScriptClient();

async function count(table, query = (builder) => builder) {
  const { count: rowCount, error } = await query(supabase.from(table).select("*", { count: "exact", head: true }));
  if (error) throw new Error(`${table}: ${error.message}`);
  return rowCount ?? 0;
}

async function health() {
  const response = await fetch(`${appUrl}/api/health`, { cache: "no-store" });
  const body = await response.json();
  return { statusCode: response.status, body };
}

async function pageSmoke() {
  const response = await fetch(appUrl, { cache: "no-store" });
  const html = await response.text();
  const markers = ["Planung", "Backlog", "Reviews", "Sprint &amp; Score", "Meilensteine"];
  const authGateEnabled = process.env.REQUIRE_SUPABASE_AUTH === "true";
  const markerResults = Object.fromEntries(markers.map((marker) => [marker, html.includes(marker)]));

  return {
    statusCode: response.status,
    mode: authGateEnabled ? "auth-gated" : "public",
    markers: markerResults,
    markerCheckRequired: !authGateEnabled,
  };
}

const [healthResult, pageResult] = await Promise.all([health(), pageSmoke()]);

const result = {
  appUrl,
  health: healthResult,
  page: pageResult,
  data: {
    profiles: await count("profiles"),
    ceos: await count("profiles", (query) => query.eq("platform_role", "ceo")),
    githubMappedProfiles: await count("profiles", (query) => query.not("github_login", "is", null)),
    tasks: await count("tasks"),
    deliverables: await count("tasks", (query) => query.eq("task_type", "deliverable")),
    proposedDeliverables: await count("tasks", (query) => query.eq("task_type", "deliverable").eq("approval_status", "proposed")),
    subIssues: await count("tasks", (query) => query.eq("task_type", "sub_issue")),
    sprints: await count("sprints"),
    milestones: await count("milestones"),
    meetings: await count("meetings"),
    notificationEvents: await count("notification_events"),
    notificationDeliveries: await count("notification_deliveries"),
  },
  env: {
    requireSupabaseAuth: process.env.REQUIRE_SUPABASE_AUTH === "true",
    githubSyncMode: "github_app_installation_token",
    googleChatConfigured: Boolean(process.env.GOOGLE_CHAT_WEBHOOK_URL),
    googleChatDeliveryEnabled: process.env.GOOGLE_CHAT_DELIVERY_ENABLED === "true",
    googleChatReady: Boolean(process.env.GOOGLE_CHAT_WEBHOOK_URL) && process.env.GOOGLE_CHAT_DELIVERY_ENABLED === "true",
  },
};

console.log(JSON.stringify(result, null, 2));

const failedMarkers = Object.entries(pageResult.markers).filter(([, ok]) => !ok).map(([marker]) => marker);
const authGateEnabled = process.env.REQUIRE_SUPABASE_AUTH === "true";
const failures = [
  healthResult.statusCode !== 200 ? `health status ${healthResult.statusCode}` : "",
  healthResult.body?.status !== "ready" ? `health body status ${healthResult.body?.status}` : "",
  pageResult.statusCode !== 200 ? `page status ${pageResult.statusCode}` : "",
  !authGateEnabled && failedMarkers.length ? `missing page markers: ${failedMarkers.join(", ")}` : "",
  result.data.profiles !== expected.profiles ? `expected ${expected.profiles} profiles, got ${result.data.profiles}` : "",
  result.data.ceos !== 1 ? `expected 1 CEO, got ${result.data.ceos}` : "",
  result.data.githubMappedProfiles !== 5 ? `expected 5 github-mapped profiles, got ${result.data.githubMappedProfiles}` : "",
  result.data.tasks < expected.tasksMin ? `expected at least ${expected.tasksMin} tasks, got ${result.data.tasks}` : "",
  result.data.sprints < 1 ? "expected at least 1 sprint" : "",
  result.data.milestones < 1 ? "expected at least 1 milestone" : "",
  result.data.meetings < 1 ? "expected at least 1 meeting" : "",
].filter(Boolean);

if (failures.length) {
  console.error(`Operational verification failed: ${failures.join("; ")}`);
  process.exit(1);
}
