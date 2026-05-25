import { NextResponse, type NextRequest } from "next/server";
import { requireOperationalLead } from "@/lib/authz";
import { githubRepoSlug, githubUserForToken, upsertGitHubIssue, type GitHubTaskSyncContext } from "@/lib/github";
import { getServerSupabase } from "@/lib/supabase";
import type { Task } from "@/lib/types";

type TaskRow = Record<string, unknown>;
type SyncRequestBody = {
  createIfMissing?: boolean;
};

function providerToken(request: NextRequest) {
  return request.headers.get("x-github-provider-token")?.trim() || "";
}

async function requireMatchingGitHubToken(request: NextRequest, profile: { githubLogin?: string } | null) {
  const token = providerToken(request);
  if (!token) throw new Error("GitHub User-Token fehlt. Bitte erneut mit GitHub anmelden und den Sync erneut starten.");

  const githubUser = await githubUserForToken(token);
  const expectedLogin = profile?.githubLogin?.toLowerCase() || "";
  if (!expectedLogin || githubUser.login.toLowerCase() !== expectedLogin) {
    throw new Error("GitHub User-Token passt nicht zum angemeldeten Teamprofil.");
  }

  return token;
}

function hasLinkedGitHubIssue(task: Pick<Task, "githubIssueNumber" | "githubIssueUrl" | "issueNumber" | "issueUrl">) {
  return Boolean(
    task.githubIssueNumber ||
    task.githubIssueUrl ||
    task.issueNumber ||
    task.issueUrl.includes("github.com"),
  );
}

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
    problemStatement: String(row.problem_statement || ""),
    intendedOutcome: String(row.intended_outcome || ""),
    scopeConstraints: String(row.scope_constraints || ""),
    acceptanceCriteria: String(row.acceptance_criteria || ""),
    evidenceRequired: String(row.evidence_required || ""),
    dodTemplateVersion: String(row.dod_template_version || "founder-deliverable-v2"),
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
    milestoneId: String(row.milestone_id || ""),
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

  const [packageResult, milestoneResult, sprintResult, parentResult, commentsResult, blockersResult, outgoingRelationsResult, incomingRelationsResult] = await Promise.all([
    row.package_id ? supabase.from("packages").select("title,goal,milestone_id").eq("id", row.package_id).maybeSingle() : Promise.resolve({ data: null }),
    row.milestone_id ? supabase.from("milestones").select("title,target_date").eq("id", row.milestone_id).maybeSingle() : Promise.resolve({ data: null }),
    row.sprint_id ? supabase.from("sprints").select("name,start_date,end_date,review_due_at").eq("id", row.sprint_id).maybeSingle() : Promise.resolve({ data: null }),
    row.parent_task_id ? supabase.from("tasks").select("title,github_issue_url").eq("id", row.parent_task_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("task_comments").select("profile_id,comment,created_at").eq("task_id", row.id).order("created_at", { ascending: false }).limit(10),
    supabase.from("task_blockers").select("profile_id,reason,impact,needs_help_from,status,created_at").eq("task_id", row.id).order("created_at", { ascending: false }).limit(10),
    supabase.from("task_relationship_edges").select("id,relation_type,note,related_task_id,tasks!task_relationship_edges_related_task_id_fkey(id,title,status,owner,github_issue_number,github_issue_url)").eq("task_id", row.id),
    supabase.from("task_relationship_edges").select("id,relation_type,note,task_id,tasks!task_relationship_edges_task_id_fkey(id,title,status,owner,github_issue_number,github_issue_url)").eq("related_task_id", row.id),
  ]);

  const relationTask = (value: unknown) => Array.isArray(value) ? value[0] : value;
  type RelationTaskRow = { title?: string; status?: string; owner?: string; github_issue_number?: number | null; github_issue_url?: string | null };
  const outgoingRelations = ((outgoingRelationsResult.data || []) as Array<{ relation_type: string; tasks?: unknown }>).map((relation) => ({
    label: relation.relation_type === "blocked_by" ? "Wartet auf" : relation.relation_type === "blocks" ? "Blockiert" : "Verknüpft mit",
    task: relationTask(relation.tasks) as RelationTaskRow | undefined,
  }));
  const incomingRelations = ((incomingRelationsResult.data || []) as Array<{ relation_type: string; tasks?: unknown }>).map((relation) => ({
    label: relation.relation_type === "blocked_by" ? "Blockiert" : relation.relation_type === "blocks" ? "Wartet auf" : "Verknüpft mit",
    task: relationTask(relation.tasks) as RelationTaskRow | undefined,
  }));
  const relationshipRows = [...outgoingRelations, ...incomingRelations];

  for (const comment of (commentsResult.data || []) as Array<{ profile_id?: string | null }>) addProfileId(comment.profile_id);
  for (const blocker of (blockersResult.data || []) as Array<{ profile_id?: string | null }>) addProfileId(blocker.profile_id);
  for (const relation of relationshipRows) addProfileId(relation.task?.owner);

  const profilesResult = profileIds.size
    ? await supabase.from("profiles").select("id,name").in("id", [...profileIds])
    : { data: [] };
  const profileNameById = new Map((profilesResult.data || []).map((profile: { id: string; name: string }) => [profile.id, profile.name]));

  const packageData = packageResult.data as { title?: string | null; goal?: string | null; milestone_id?: string | null } | null;
  const milestoneData = milestoneResult.data as { title?: string | null; target_date?: string | null } | null;
  const sprintData = sprintResult.data as { name?: string | null; start_date?: string | null; end_date?: string | null; review_due_at?: string | null } | null;
  const parentData = parentResult.data as { title?: string | null; github_issue_url?: string | null } | null;
  return {
    packageTitle: packageData?.title || "",
    packageGoal: packageData?.goal || "",
    milestoneTitle: milestoneData?.title || "",
    milestoneTargetDate: milestoneData?.target_date || "",
    sprintName: sprintData?.name || "",
    sprintRange: sprintData ? formatDateRange(sprintData.start_date, sprintData.end_date) : "",
    sprintReviewDueAt: sprintData?.review_due_at || "",
    parentTitle: parentData?.title || "",
    parentGitHubUrl: parentData?.github_issue_url || "",
    relationships: relationshipRows
      .filter((relation) => relation.task?.title)
      .map((relation) => ({
        label: relation.label,
        title: relation.task?.title || "",
        issueNumber: relation.task?.github_issue_number || null,
        issueUrl: relation.task?.github_issue_url || "",
        status: relation.task?.status || "",
        owner: profileNameById.get(relation.task?.owner || "") || relation.task?.owner || "",
      })),
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
  let githubUserToken = "";
  try {
    githubUserToken = await requireMatchingGitHubToken(request, permission.profile);
  } catch (tokenError) {
    const message = tokenError instanceof Error ? tokenError.message : "GitHub User-Token konnte nicht geprüft werden.";
    return NextResponse.json({ error: message }, { status: 401 });
  }

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
  const payload = (await request.json().catch(() => ({}))) as SyncRequestBody;
  const hasExistingGitHubIssue = hasLinkedGitHubIssue(task);

  if (!hasExistingGitHubIssue && task.taskType !== "deliverable") {
    return NextResponse.json({
      error: "Nur Deliverables werden als eigenständige GitHub-Issues gespiegelt.",
      task: {
        githubSyncStatus: task.githubSyncStatus,
        githubSyncError: task.githubSyncError,
      },
    }, { status: 400 });
  }

  if (!hasExistingGitHubIssue && !payload.createIfMissing) {
    return NextResponse.json({
      error: "Diese Aufgabe ist App-only. Ein neues GitHub-Issue wird nur über eine bewusste Anlegen-Aktion erstellt.",
      task: {
        githubSyncStatus: task.githubSyncStatus,
        githubSyncError: "",
      },
    }, { status: 409 });
  }

  await supabase.from("tasks").update({ github_sync_status: "pending", github_sync_error: null }).eq("id", id);

  try {
    const issue = await upsertGitHubIssue(task, syncContext, githubUserToken);
    const syncedAt = new Date().toISOString();
    const githubRepo = githubRepoSlug();

    await supabase.from("tasks").update({
      github_repo: githubRepo,
      github_issue_number: issue.number,
      github_issue_url: issue.html_url,
      github_sync_status: "synced",
      github_last_synced_at: syncedAt,
      github_sync_error: null,
    }).eq("id", id);
    await supabase.from("task_activity").insert({
      task_id: id,
      message: `GitHub Sync ausgeführt: ${githubRepo}#${issue.number}`,
    });

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
    await supabase.from("task_activity").insert({
      task_id: id,
      message: `GitHub Sync fehlgeschlagen: ${message}`,
    });
    return NextResponse.json({
      error: message,
      task: {
        githubSyncStatus: "failed",
        githubSyncError: message,
      },
    }, { status: 502 });
  }
}
