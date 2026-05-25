import { NextResponse, type NextRequest } from "next/server";
import { requireOperationalLead } from "@/lib/authz";
import { upsertGitHubIssue, type GitHubTaskSyncContext } from "@/lib/github";
import { getServerSupabase } from "@/lib/supabase";
import type { Task } from "@/lib/types";

type TaskRow = Record<string, unknown>;

function mapTask(row: TaskRow, profileNameById: Map<string, string>): Task {
  const owner = String(row.owner || "");
  const assignee = String(row.assignee || "");

  return {
    id: String(row.id),
    order: Number(row.sort_order || 0),
    title: String(row.title || ""),
    description: String(row.description || ""),
    status: String(row.status || "Offen"),
    priority: String(row.priority || "P2"),
    owner: profileNameById.get(owner) || owner,
    assignee: profileNameById.get(assignee) || assignee,
    workstream: String(row.workstream || ""),
    packageId: String(row.package_id || ""),
    deadline: String(row.deadline || ""),
    definitionOfDone: String(row.definition_of_done || ""),
    dependsOn: "",
    evidenceLink: String(row.evidence_link || ""),
    issueNumber: String(row.issue_number || ""),
    issueUrl: String(row.issue_url || ""),
    note: "",
    watched: Boolean(row.watched),
    hours: Number(row.estimate_hours || 0),
    startDate: String(row.start_date || ""),
    endDate: String(row.end_date || ""),
    sprintId: String(row.sprint_id || ""),
    reviewStatus: (row.review_status as Task["reviewStatus"]) || "not_requested",
    scorePoints: Number(row.score_points || 0),
    scoreFinal: Boolean(row.score_final),
    githubRepo: String(row.github_repo || "findmydoc-platform/management"),
    githubIssueNumber: row.github_issue_number ? Number(row.github_issue_number) : null,
    githubIssueUrl: String(row.github_issue_url || ""),
    githubSyncStatus: (row.github_sync_status as Task["githubSyncStatus"]) || "not_synced",
    githubLastSyncedAt: String(row.github_last_synced_at || ""),
    githubSyncError: String(row.github_sync_error || ""),
    taskType: (row.task_type as Task["taskType"]) || "deliverable",
    parentTaskId: String(row.parent_task_id || ""),
    scoreRelevant: row.score_relevant !== false,
  };
}

function formatDateRange(start?: unknown, end?: unknown) {
  const startValue = String(start || "");
  const endValue = String(end || "");
  if (!startValue && !endValue) return "";
  return `${startValue || "offen"} bis ${endValue || "offen"}`;
}

async function buildSyncContext(supabase: ReturnType<typeof getServerSupabase>, row: TaskRow): Promise<GitHubTaskSyncContext> {
  if (!supabase) return {};

  const profileIds = new Set<string>();
  const addProfileId = (value: unknown) => {
    if (typeof value === "string" && value) profileIds.add(value);
  };

  addProfileId(row.owner);
  addProfileId(row.assignee);

  const [packageResult, sprintResult, parentResult, commentsResult, blockersResult] = await Promise.all([
    row.package_id ? supabase.from("packages").select("title,goal").eq("id", row.package_id).maybeSingle() : Promise.resolve({ data: null }),
    row.sprint_id ? supabase.from("sprints").select("name,start_date,end_date,review_due_at").eq("id", row.sprint_id).maybeSingle() : Promise.resolve({ data: null }),
    row.parent_task_id ? supabase.from("tasks").select("title,github_issue_url").eq("id", row.parent_task_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("task_comments").select("profile_id,comment,created_at").eq("task_id", row.id).order("created_at", { ascending: false }).limit(10),
    supabase.from("task_blockers").select("profile_id,reason,impact,needs_help_from,status,created_at").eq("task_id", row.id).order("created_at", { ascending: false }).limit(10),
  ]);

  for (const comment of (commentsResult.data || []) as Array<{ profile_id?: string | null }>) addProfileId(comment.profile_id);
  for (const blocker of (blockersResult.data || []) as Array<{ profile_id?: string | null }>) addProfileId(blocker.profile_id);

  const profilesResult = profileIds.size
    ? await supabase.from("profiles").select("id,name").in("id", [...profileIds])
    : { data: [] };
  const profileNameById = new Map((profilesResult.data || []).map((profile: { id: string; name: string }) => [profile.id, profile.name]));

  const packageData = packageResult.data as { title?: string | null; goal?: string | null } | null;
  const sprintData = sprintResult.data as { name?: string | null; start_date?: string | null; end_date?: string | null; review_due_at?: string | null } | null;
  const parentData = parentResult.data as { title?: string | null; github_issue_url?: string | null } | null;

  return {
    packageTitle: packageData?.title || "",
    packageGoal: packageData?.goal || "",
    sprintName: sprintData?.name || "",
    sprintRange: sprintData ? formatDateRange(sprintData.start_date, sprintData.end_date) : "",
    sprintReviewDueAt: sprintData?.review_due_at || "",
    parentTitle: parentData?.title || "",
    parentGitHubUrl: parentData?.github_issue_url || "",
    comments: ((commentsResult.data || []) as Array<{ profile_id?: string | null; comment: string; created_at: string }>).map((comment) => ({
      author: profileNameById.get(comment.profile_id || "") || comment.profile_id || "Unbekannt",
      comment: comment.comment,
      createdAt: comment.created_at,
    })),
    blockers: ((blockersResult.data || []) as Array<{ profile_id?: string | null; reason: string; impact?: string | null; needs_help_from?: string | null; status: string; created_at: string }>).map((blocker) => ({
      author: profileNameById.get(blocker.profile_id || "") || blocker.profile_id || "Unbekannt",
      reason: blocker.reason,
      impact: blocker.impact || "",
      needsHelpFrom: blocker.needs_help_from || "",
      status: blocker.status,
      createdAt: blocker.created_at,
    })),
  };
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireOperationalLead(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const { id } = await context.params;
  const { data, error } = await supabase.from("tasks").select("*").eq("id", id).single();
  if (error || !data) return NextResponse.json({ error: error?.message || "Aufgabe nicht gefunden." }, { status: 404 });

  const syncContext = await buildSyncContext(supabase, data as TaskRow);
  const profileNameById = new Map<string, string>();
  const involvedProfileIds = [data.owner, data.assignee].filter((value): value is string => typeof value === "string" && Boolean(value));
  if (involvedProfileIds.length) {
    const profiles = await supabase.from("profiles").select("id,name").in("id", involvedProfileIds);
    for (const profile of profiles.data || []) profileNameById.set(profile.id, profile.name);
  }
  const task = mapTask(data as TaskRow, profileNameById);
  await supabase.from("tasks").update({ github_sync_status: "pending", github_sync_error: null }).eq("id", id);

  try {
    const issue = await upsertGitHubIssue(task, syncContext);
    const syncedAt = new Date().toISOString();
    const githubRepo = process.env.GITHUB_SYNC_REPO ? `${process.env.GITHUB_SYNC_OWNER || "findmydoc-platform"}/${process.env.GITHUB_SYNC_REPO}` : "findmydoc-platform/management";

    await supabase.from("tasks").update({
      github_repo: githubRepo,
      github_issue_number: issue.number,
      github_issue_url: issue.html_url,
      github_sync_status: "synced",
      github_last_synced_at: syncedAt,
      github_sync_error: null,
    }).eq("id", id);

    return NextResponse.json({
      ok: true,
      issue,
      task: {
        githubRepo,
        githubIssueNumber: issue.number,
        githubIssueUrl: issue.html_url,
        githubSyncStatus: "synced",
        githubLastSyncedAt: syncedAt,
        githubSyncError: "",
      },
    });
  } catch (syncError) {
    const message = syncError instanceof Error ? syncError.message : "GitHub Sync fehlgeschlagen.";
    await supabase.from("tasks").update({ github_sync_status: "failed", github_sync_error: message }).eq("id", id);
    return NextResponse.json({
      error: message,
      task: {
        githubSyncStatus: "failed",
        githubSyncError: message,
      },
    }, { status: 502 });
  }
}
