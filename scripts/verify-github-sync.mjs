import { createSupabaseScriptClient } from "./lib/supabase.mjs";

const owner = process.env.GITHUB_SYNC_OWNER || "findmydoc-platform";
const repo = process.env.GITHUB_SYNC_REPO || "management";
const repoSlug = `${owner}/${repo}`;

const supabase = await createSupabaseScriptClient();

async function fetchTasks() {
  const { data, error } = await supabase
    .from("tasks")
    .select("id,title,task_type,parent_task_id,approval_status,status,owner,github_repo,github_issue_number,github_issue_url,github_issue_sync_status,github_issue_last_synced_at")
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
const subIssues = tasks.filter((task) => task.task_type === "sub_issue");
const taskById = new Map(tasks.map((task) => [task.id, task]));
const hasGitHubIssue = (task) => Boolean(task.github_issue_number || task.github_issue_url);
const isSyncEligible = (task) => task.task_type === "deliverable"
  ? task.approval_status === "approved"
  : taskById.get(task.parent_task_id)?.approval_status === "approved";
const syncQueue = tasks.filter((task) => isSyncEligible(task)
  && (!hasGitHubIssue(task) || ["not_synced", "failed", "pending"].includes(task.github_issue_sync_status)));
const missingGitHubIssues = syncQueue.filter((task) => !hasGitHubIssue(task));

const result = {
  repo: repoSlug,
  syncMode: "github_app_installation_token",
  note: "CLI prüft Supabase-Mapping und Sync-Queue. GitHub-Schreibrechte laufen serverseitig über die GitHub App; Kommentare und Anhänge nutzen gespeicherte GitHub-App-User-Tokens.",
  tasks: {
    total: tasks.length,
    deliverables: deliverables.length,
    subIssues: subIssues.length,
    syncQueue: syncQueue.length,
    missingGitHubIssues: missingGitHubIssues.length,
    automaticSyncScope: "approved_deliverables_and_sub_issues_parent_first",
    relationships: relationshipCount,
  },
  syncQueuePreview: syncQueue.slice(0, 10).map((task) => ({
    id: task.id,
    title: task.title,
    taskType: task.task_type,
    parentTaskId: task.parent_task_id,
    status: task.status,
    githubIssueSyncStatus: task.github_issue_sync_status,
    githubIssueNumber: task.github_issue_number,
    githubIssueUrl: task.github_issue_url,
  })),
  missingGitHubIssuePreview: missingGitHubIssues.slice(0, 10).map((task) => ({
    id: task.id,
    title: task.title,
    taskType: task.task_type,
    parentTaskId: task.parent_task_id,
    status: task.status,
    owner: task.owner,
  })),
};

console.log(JSON.stringify(result, null, 2));
