import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(process.cwd(), ".env.local");

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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const owner = process.env.GITHUB_SYNC_OWNER || "findmydoc-platform";
const repo = process.env.GITHUB_SYNC_REPO || "management";
const repoSlug = `${owner}/${repo}`;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase env. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

async function fetchTasks() {
  const { data, error } = await supabase
    .from("tasks")
    .select("id,title,task_type,status,owner,github_repo,github_issue_number,github_issue_url,github_sync_status,github_last_synced_at")
    .order("sort_order", { ascending: true });

  if (error) throw new Error(`tasks: ${error.message}`);
  return data ?? [];
}

async function fetchRelationshipsCount() {
  const { count, error } = await supabase
    .from("task_relationship_edges")
    .select("*", { count: "exact", head: true });

  if (error) throw new Error(`task_relationship_edges: ${error.message}`);
  return count ?? 0;
}

const [tasks, relationshipCount] = await Promise.all([
  fetchTasks(),
  fetchRelationshipsCount(),
]);

const deliverables = tasks.filter((task) => task.task_type === "deliverable");
const linkedDeliverables = deliverables.filter((task) => task.github_issue_number || task.github_issue_url);
const appOnlyDeliverables = deliverables.filter((task) => !task.github_issue_number && !task.github_issue_url);
const syncQueue = linkedDeliverables.filter((task) => ["not_synced", "failed", "pending"].includes(task.github_sync_status));

const result = {
  repo: repoSlug,
  syncMode: "logged_in_github_user_provider_token",
  note: "CLI prüft Supabase-Mapping und Sync-Queue. Echte GitHub-Schreibrechte werden bewusst im Browser mit dem eingeloggten GitHub-User geprüft.",
  tasks: {
    total: tasks.length,
    deliverables: deliverables.length,
    linkedDeliverables: linkedDeliverables.length,
    appOnlyDeliverables: appOnlyDeliverables.length,
    syncQueue: syncQueue.length,
    automaticSyncScope: "linked_deliverables_only",
    relationships: relationshipCount,
  },
  syncQueuePreview: syncQueue.slice(0, 10).map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    githubSyncStatus: task.github_sync_status,
    githubIssueNumber: task.github_issue_number,
    githubIssueUrl: task.github_issue_url,
  })),
  appOnlyPreview: appOnlyDeliverables.slice(0, 10).map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    owner: task.owner,
  })),
};

console.log(JSON.stringify(result, null, 2));
