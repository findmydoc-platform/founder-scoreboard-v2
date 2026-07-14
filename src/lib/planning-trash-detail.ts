import type { SupabaseClient } from "@supabase/supabase-js";
import { mapMilestone, mapPackage } from "@/lib/planning-profile-mappers";
import { mapTaskRow } from "@/lib/planning-task-mappers";
import { taskRowSelect, type DbMilestone, type DbPackage, type DbTask } from "@/lib/planning-data-row-types";
import type { Milestone, Package, Profile, Task, TrashCause, TrashRootType } from "@/lib/types";

const packageDetailSelect = "id,milestone_id,owner_id,accountable_profile_id,responsible_profile_ids,consulted_profile_ids,informed_profile_ids,title,goal,priority,status,target_date,success_criteria,scope_constraints,sort_order,approval_status,approval_revision,proposed_by,proposed_at,decided_by,decided_at,decision_note,trashed_at,trashed_by,trash_reason,trash_cause,purge_after,trash_root_type,trash_root_id,trash_revision";
const milestoneDetailSelect = "id,title,description,target_date,status,sort_order,updated_at";

type DetailLoadError = { ok: false; status: 404 | 500; error: string };

export type PlanningTrashMetadata = {
  trashedAt: string;
  actorId: string;
  actorName: string;
  reason: string;
  cause: TrashCause;
  purgeAfter: string;
  rootType: TrashRootType;
  rootId: string;
  revision: number;
};

export type PlanningTrashTaskSummary = {
  id: string;
  title: string;
  taskType: Task["taskType"];
  approvalStatus: Task["approvalStatus"];
  trashed: boolean;
};

export type PlanningTrashTaskDetail = {
  task: Task;
  initiative: Package | null;
  milestone: Milestone | null;
  parent: PlanningTrashTaskSummary | null;
  subIssues: PlanningTrashTaskSummary[];
  trash: PlanningTrashMetadata;
  githubLifecycle: "not_linked" | "server_managed_close";
};

export type PlanningInitiativeTaskSummary = PlanningTrashTaskSummary & {
  githubLinked: boolean;
};

export type PlanningInitiativeDetail = {
  initiative: Package;
  milestone: Milestone | null;
  deliverables: PlanningInitiativeTaskSummary[];
  trash: PlanningTrashMetadata | null;
  linkedGitHubIssueCount: number;
};

export type PlanningTrashTaskDetailResult =
  | { ok: true; detail: PlanningTrashTaskDetail }
  | DetailLoadError;

export type PlanningInitiativeDetailResult =
  | { ok: true; detail: PlanningInitiativeDetail }
  | DetailLoadError;

type TaskSummaryRow = {
  id: string;
  title: string;
  task_type: Task["taskType"];
  approval_status: Task["approvalStatus"];
  trashed_at: string | null;
  github_issue_number?: number | null;
  github_issue_url?: string | null;
  issue_number?: string | null;
  issue_url?: string | null;
};

function trashMetadata(
  item: Pick<Task | Package, "trashedAt" | "trashedById" | "trashReason" | "trashCause" | "purgeAfter" | "trashRootType" | "trashRootId" | "trashRevision">,
  profiles: Profile[],
): PlanningTrashMetadata | null {
  if (!item.trashedAt || !item.trashCause || !item.trashRootType) return null;
  const actorId = item.trashedById || "";
  return {
    trashedAt: item.trashedAt,
    actorId,
    actorName: profiles.find((profile) => profile.id === actorId)?.name || actorId || "Unbekannt",
    reason: item.trashReason || "Keine Begründung hinterlegt.",
    cause: item.trashCause,
    purgeAfter: item.purgeAfter || "",
    rootType: item.trashRootType,
    rootId: item.trashRootId || "",
    revision: item.trashRevision || 0,
  };
}

function taskSummary(row: TaskSummaryRow): PlanningTrashTaskSummary {
  return {
    id: row.id,
    title: row.title,
    taskType: row.task_type === "sub_issue" ? "sub_issue" : "deliverable",
    approvalStatus: row.task_type === "sub_issue" ? null : row.approval_status,
    trashed: Boolean(row.trashed_at),
  };
}

function hasGitHubIssue(row: Pick<TaskSummaryRow, "github_issue_number" | "github_issue_url" | "issue_number" | "issue_url">) {
  return Boolean(row.github_issue_number || row.github_issue_url || row.issue_number || row.issue_url?.includes("github.com"));
}

async function loadOptionalMilestone(supabase: SupabaseClient, milestoneId: string | null | undefined) {
  if (!milestoneId) return { data: null as DbMilestone | null, error: null };
  return supabase.from("milestones").select(milestoneDetailSelect).eq("id", milestoneId).maybeSingle<DbMilestone>();
}

async function loadOptionalPackage(supabase: SupabaseClient, packageId: string | null | undefined) {
  if (!packageId) return { data: null as DbPackage | null, error: null };
  return supabase.from("packages").select(packageDetailSelect).eq("id", packageId).maybeSingle<DbPackage>();
}

export async function loadPlanningTrashTaskDetail(
  supabase: SupabaseClient,
  taskId: string,
  profiles: Profile[],
): Promise<PlanningTrashTaskDetailResult> {
  const taskResult = await supabase.from("tasks").select(taskRowSelect).eq("id", taskId).maybeSingle<DbTask>();
  if (taskResult.error) return { ok: false, status: 500, error: taskResult.error.message };
  if (!taskResult.data?.trashed_at) return { ok: false, status: 404, error: "Aufgabe wurde nicht gefunden." };

  const row = taskResult.data;
  const [initiativeResult, milestoneResult, parentResult, subIssueResult] = await Promise.all([
    loadOptionalPackage(supabase, row.package_id),
    loadOptionalMilestone(supabase, row.milestone_id),
    row.parent_task_id
      ? supabase.from("tasks").select("id,title,task_type,approval_status,trashed_at").eq("id", row.parent_task_id).maybeSingle<TaskSummaryRow>()
      : Promise.resolve({ data: null as TaskSummaryRow | null, error: null }),
    row.task_type === "deliverable"
      ? supabase.from("tasks").select("id,title,task_type,approval_status,trashed_at").eq("parent_task_id", row.id).order("sort_order").returns<TaskSummaryRow[]>()
      : Promise.resolve({ data: [] as TaskSummaryRow[], error: null }),
  ]);

  const relatedError = initiativeResult.error || milestoneResult.error || parentResult.error || subIssueResult.error;
  if (relatedError) return { ok: false, status: 500, error: relatedError.message };

  const task = mapTaskRow(row, profiles);
  const trash = trashMetadata(task, profiles);
  if (!trash) return { ok: false, status: 500, error: "Papierkorb-Metadaten der Aufgabe sind unvollständig." };

  return {
    ok: true,
    detail: {
      task,
      initiative: initiativeResult.data ? mapPackage(initiativeResult.data) : null,
      milestone: milestoneResult.data ? mapMilestone(milestoneResult.data) : null,
      parent: parentResult.data ? taskSummary(parentResult.data) : null,
      subIssues: (subIssueResult.data || []).map(taskSummary),
      trash,
      githubLifecycle: task.githubIssueNumber || task.githubIssueUrl || task.issueNumber || task.issueUrl.includes("github.com")
        ? "server_managed_close"
        : "not_linked",
    },
  };
}

export async function loadPlanningInitiativeDetail(
  supabase: SupabaseClient,
  initiativeId: string,
  profiles: Profile[],
): Promise<PlanningInitiativeDetailResult> {
  const initiativeResult = await supabase.from("packages").select(packageDetailSelect).eq("id", initiativeId).maybeSingle<DbPackage>();
  if (initiativeResult.error) return { ok: false, status: 500, error: initiativeResult.error.message };
  if (!initiativeResult.data) return { ok: false, status: 404, error: "Initiative wurde nicht gefunden." };

  const [milestoneResult, deliverableResult] = await Promise.all([
    loadOptionalMilestone(supabase, initiativeResult.data.milestone_id),
    supabase
      .from("tasks")
      .select("id,title,task_type,approval_status,trashed_at,github_issue_number,github_issue_url,issue_number,issue_url")
      .eq("package_id", initiativeId)
      .eq("task_type", "deliverable")
      .order("sort_order")
      .returns<TaskSummaryRow[]>(),
  ]);
  const relatedError = milestoneResult.error || deliverableResult.error;
  if (relatedError) return { ok: false, status: 500, error: relatedError.message };

  const initiative = mapPackage(initiativeResult.data);
  const visibleRows = initiative.trashedAt
    ? deliverableResult.data || []
    : (deliverableResult.data || []).filter((row) => !row.trashed_at);
  const deliverables = visibleRows.map((row) => ({
    ...taskSummary(row),
    githubLinked: hasGitHubIssue(row),
  }));

  return {
    ok: true,
    detail: {
      initiative,
      milestone: milestoneResult.data ? mapMilestone(milestoneResult.data) : null,
      deliverables,
      trash: trashMetadata(initiative, profiles),
      linkedGitHubIssueCount: deliverables.filter((deliverable) => deliverable.githubLinked).length,
    },
  };
}
