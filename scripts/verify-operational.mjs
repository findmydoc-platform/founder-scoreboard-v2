import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(process.cwd(), ".env.local");
const appUrl = process.env.APP_URL || "http://localhost:3000";
const seedSource = JSON.parse(await readFile(resolve(process.cwd(), "src/lib/seed/source.json"), "utf8"));
const expected = {
  profiles: seedSource.profiles.length,
  tasksMin: seedSource.tasks.length,
};

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const separator = trimmed.indexOf("=");
  if (separator < 0) return null;

  const key = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
  return [key, value];
}

if (existsSync(envPath)) {
  const envFile = await readFile(envPath, "utf8");
  for (const pair of envFile.split(/\r?\n/).map(parseEnvLine)) {
    if (!pair) continue;
    const [key, value] = pair;
    process.env[key] ||= value;
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("Missing Supabase env. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

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
  const markers = ["Founder Planning", "Sprint &amp; Score", "Decision Log", "Meeting Finder", "Board"];
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
    proposals: await count("tasks", (query) => query.eq("task_type", "proposal")),
    subIssues: await count("tasks", (query) => query.eq("task_type", "sub_issue")),
    sprints: await count("sprints"),
    milestones: await count("milestones"),
    meetings: await count("meetings"),
    notificationEvents: await count("notification_events"),
    notificationDeliveries: await count("notification_deliveries"),
    decisions: await count("decision_log"),
  },
  env: {
    requireSupabaseAuth: process.env.REQUIRE_SUPABASE_AUTH === "true",
    githubSyncMode: "logged_in_github_user_provider_token",
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
