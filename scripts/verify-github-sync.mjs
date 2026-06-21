import { createSupabaseScriptClient } from "./lib/supabase.mjs";

const owner = process.env.GITHUB_SYNC_OWNER || "findmydoc-platform";
const repo = process.env.GITHUB_SYNC_REPO || "management";
const repoSlug = `${owner}/${repo}`;

const supabase = await createSupabaseScriptClient();

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
