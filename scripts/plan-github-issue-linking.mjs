import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadLocalEnv } from "./lib/env.mjs";
import { createSupabaseScriptClient } from "./lib/supabase.mjs";
import { normalizeWords } from "./lib/text-normalization.mjs";

const apply = process.argv.includes("--apply");
const execFileAsync = promisify(execFile);

await loadLocalEnv();

const githubReadToken = process.env.GITHUB_READ_TOKEN;
const owner = process.env.GITHUB_SYNC_OWNER || "findmydoc-platform";
const repo = process.env.GITHUB_SYNC_REPO || "management";

const supabase = await createSupabaseScriptClient({
  keyEnv: ["SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
  missingMessage: "Missing Supabase env. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
});

function normalizeTitle(value) {
  return normalizeWords(String(value || "")
    .replace(/^\[(deliverable|sub-issue|proposal|vorschlag)\]\s*:?\s*/i, "")
    .replace(/^\[(deliverable|subtask|sub-task)\]\s*:?\s*/i, "")
    .replace(/\s+#\d+$/, ""));
}

async function fetchIssues() {
  if (!githubReadToken) {
    const { stdout } = await execFileAsync("gh", [
      "issue",
      "list",
      "--repo",
      `${owner}/${repo}`,
      "--state",
      "all",
      "--limit",
      "1000",
      "--json",
      "number,title,state,url",
    ], { maxBuffer: 1024 * 1024 * 10 });
    return JSON.parse(stdout).map((issue) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      html_url: issue.url,
    }));
  }

  const issues = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=100&page=${page}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${githubReadToken}`,
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) throw new Error(`GitHub issues read failed: ${response.status}`);
    const pageIssues = await response.json();
    const onlyIssues = pageIssues.filter((issue) => !issue.pull_request);
    issues.push(...onlyIssues);
    if (pageIssues.length < 100) break;
  }
  return issues;
}

const { data: tasks, error: tasksError } = await supabase
  .from("tasks")
  .select("id,title,github_issue_number,github_issue_url,issue_number,issue_url,github_issue_sync_status")
  .neq("task_type", "sub_issue")
  .order("sort_order");

if (tasksError) throw new Error(`tasks: ${tasksError.message}`);

const issues = await fetchIssues();
const issuesByTitle = new Map();
for (const issue of issues) {
  const key = normalizeTitle(issue.title);
  if (!key) continue;
  const bucket = issuesByTitle.get(key) || [];
  bucket.push(issue);
  issuesByTitle.set(key, bucket);
}

const exact = [];
const ambiguous = [];
const unmatched = [];

for (const task of tasks) {
  if (task.github_issue_number || task.issue_number) continue;
  const key = normalizeTitle(task.title);
  const candidates = issuesByTitle.get(key) || [];
  if (candidates.length === 1) {
    exact.push({ task, issue: candidates[0] });
  } else if (candidates.length > 1) {
    ambiguous.push({ task, candidates });
  } else {
    unmatched.push(task);
  }
}

if (apply) {
  for (const match of exact) {
    const { error } = await supabase
      .from("tasks")
      .update({
        github_repo: `${owner}/${repo}`,
        github_issue_number: match.issue.number,
        github_issue_url: match.issue.html_url,
        github_issue_sync_status: "not_synced",
        github_issue_sync_error: null,
      })
      .eq("id", match.task.id);
    if (error) throw new Error(`${match.task.id}: ${error.message}`);
  }
}

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  repo: `${owner}/${repo}`,
  tasks: tasks.length,
  issues: issues.length,
  exactMatches: exact.length,
  ambiguousMatches: ambiguous.length,
  unmatched: unmatched.length,
  applied: apply ? exact.length : 0,
  exact: exact.slice(0, 50).map((match) => ({
    taskId: match.task.id,
    taskTitle: match.task.title,
    issueNumber: match.issue.number,
    issueTitle: match.issue.title,
    issueUrl: match.issue.html_url,
  })),
  ambiguous: ambiguous.slice(0, 20).map((match) => ({
    taskId: match.task.id,
    taskTitle: match.task.title,
    candidates: match.candidates.map((issue) => ({ number: issue.number, title: issue.title })),
  })),
  unmatched: unmatched.slice(0, 50).map((task) => ({ taskId: task.id, taskTitle: task.title })),
}, null, 2));
