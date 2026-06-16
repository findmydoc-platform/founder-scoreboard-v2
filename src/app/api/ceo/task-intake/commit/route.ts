import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { requireCEO } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";
import { buildTaskIntakePreview, parseTaskIntakePayload, type TaskIntakePreviewTask } from "@/lib/task-intake";
import type { Task } from "@/lib/types";
import { loadTaskIntakeContext } from "../context";

type CreatedTaskRow = {
  id: string;
  sort_order: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  owner: string | null;
  assignee: string | null;
  created_by: string | null;
  workstream: string | null;
  package_id: string | null;
  deadline: string | null;
  problem_statement: string | null;
  intended_outcome: string | null;
  scope_constraints: string | null;
  acceptance_criteria: string | null;
  evidence_required: string | null;
  dod_template_version: string | null;
  definition_of_done: string | null;
  evidence_link: string | null;
  issue_number: string | null;
  issue_url: string | null;
  watched: boolean | null;
  estimate_hours: number | null;
  start_date: string | null;
  end_date: string | null;
  sprint_id: string | null;
  milestone_id: string | null;
  review_status: Task["reviewStatus"] | null;
  review_owner_profile_id: string | null;
  review_requested_at: string | null;
  score_points: number | null;
  score_final: boolean | null;
  github_repo: string | null;
  github_issue_number: number | null;
  github_issue_url: string | null;
  github_sync_status: Task["githubSyncStatus"] | null;
  github_last_synced_at: string | null;
  github_sync_error: string | null;
  task_type: Task["taskType"] | null;
  parent_task_id: string | null;
  score_relevant: boolean | null;
  self_dod_checked: boolean | null;
  self_evidence_checked: boolean | null;
  self_documented_checked: boolean | null;
  self_blockers_checked: boolean | null;
};

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

function insertForTask(task: TaskIntakePreviewTask, id: string, sortOrder: number, createdBy: string) {
  return {
    id,
    project_id: "findmydoc-founder-execution",
    package_id: task.packageId || null,
    milestone_id: task.milestoneId || null,
    title: task.title,
    description: task.description,
    problem_statement: task.problemStatement,
    intended_outcome: task.intendedOutcome,
    scope_constraints: task.scopeConstraints,
    acceptance_criteria: task.acceptanceCriteria,
    evidence_required: task.evidenceRequired,
    dod_template_version: "founder-deliverable-v2",
    status: task.status,
    priority: task.priority,
    owner: task.ownerId || null,
    assignee: task.ownerId || null,
    created_by: createdBy,
    workstream: task.workstream,
    sort_order: sortOrder,
    start_date: task.startDate || null,
    end_date: task.endDate || null,
    deadline: task.deadline || null,
    estimate_hours: task.hours,
    definition_of_done: task.definitionOfDone,
    sprint_id: task.taskType === "deliverable" ? task.sprintId || null : null,
    review_status: "not_requested",
    review_owner_profile_id: task.reviewOwnerProfileId || null,
    score_points: 0,
    score_final: false,
    github_repo: "findmydoc-platform/management",
    github_sync_status: "not_synced",
    task_type: task.taskType,
    parent_task_id: task.parentTaskId || null,
    score_relevant: task.scoreRelevant,
  };
}

function mapCreatedTask(row: CreatedTaskRow, profileNameById: Map<string, string>): Task {
  return {
    id: row.id,
    order: row.sort_order,
    title: row.title,
    description: row.description || "",
    status: row.status,
    priority: row.priority,
    ownerId: row.owner || "",
    owner: profileNameById.get(row.owner || "") || row.owner || "",
    assigneeId: row.assignee || "",
    assignee: profileNameById.get(row.assignee || "") || row.assignee || "",
    createdById: row.created_by || "",
    createdBy: profileNameById.get(row.created_by || "") || row.created_by || "",
    workstream: row.workstream || "",
    packageId: row.package_id || "",
    deadline: row.deadline || "",
    problemStatement: row.problem_statement || "",
    intendedOutcome: row.intended_outcome || "",
    scopeConstraints: row.scope_constraints || "",
    acceptanceCriteria: row.acceptance_criteria || "",
    evidenceRequired: row.evidence_required || "",
    dodTemplateVersion: row.dod_template_version || "founder-deliverable-v2",
    definitionOfDone: row.definition_of_done || "",
    dependsOn: "",
    evidenceLink: row.evidence_link || "",
    issueNumber: row.issue_number || "",
    issueUrl: row.issue_url || "",
    note: "",
    watched: Boolean(row.watched),
    hours: row.estimate_hours || 0,
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    sprintId: row.sprint_id || "",
    milestoneId: row.milestone_id || "",
    reviewStatus: row.review_status || "not_requested",
    reviewOwnerProfileId: row.review_owner_profile_id || "",
    reviewRequestedAt: row.review_requested_at || "",
    scorePoints: row.score_points || 0,
    scoreFinal: Boolean(row.score_final),
    githubRepo: row.github_repo || "findmydoc-platform/management",
    githubIssueNumber: row.github_issue_number,
    githubIssueUrl: row.github_issue_url || "",
    githubSyncStatus: row.github_sync_status || "not_synced",
    githubLastSyncedAt: row.github_last_synced_at || "",
    githubSyncError: row.github_sync_error || "",
    taskType: row.task_type || "deliverable",
    parentTaskId: row.parent_task_id || "",
    scoreRelevant: row.score_relevant !== false,
    selfDodChecked: Boolean(row.self_dod_checked),
    selfEvidenceChecked: Boolean(row.self_evidence_checked),
    selfDocumentedChecked: Boolean(row.self_documented_checked),
    selfBlockersChecked: Boolean(row.self_blockers_checked),
  };
}

export async function POST(request: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireCEO(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const payload = await request.json().catch(() => null);
  const rawTasks = parseTaskIntakePayload(payload);
  if (!rawTasks.length) return NextResponse.json({ error: "Mindestens eine Aufgabe ist erforderlich." }, { status: 400 });
  if (rawTasks.length > 30) return NextResponse.json({ error: "Maximal 30 Aufgaben pro Intake." }, { status: 400 });

  const parentTaskIds = [...new Set(rawTasks.map((task) => typeof task.parentTaskId === "string" ? task.parentTaskId.trim() : "").filter(Boolean))];

  try {
    const context = await loadTaskIntakeContext(supabase, parentTaskIds);
    const preview = buildTaskIntakePreview(rawTasks, context);
    const invalid = preview.filter((task) => task.errors.length > 0);
    if (invalid.length) {
      return NextResponse.json({ error: "Task Intake enthält ungültige Aufgaben.", tasks: preview }, { status: 400 });
    }

    const { data: maxRow } = await supabase
      .from("tasks")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const baseSortOrder = Number(maxRow?.sort_order || 0);
    const createdBy = permission.profile?.id || "ceo";
    const now = Date.now().toString(36);
    const inserts = preview.map((task, index) => {
      const id = `${createdBy}-${slugify(task.title) || "neue-aufgabe"}-${now}-${index + 1}`;
      return insertForTask(task, id, baseSortOrder + index + 1, createdBy);
    });

    const { data: createdRows, error: insertError } = await supabase.from("tasks").insert(inserts).select("*");
    if (insertError || !createdRows) return NextResponse.json({ error: insertError?.message || "Aufgaben konnten nicht erstellt werden." }, { status: 500 });

    const rows = createdRows as CreatedTaskRow[];
    await supabase.from("task_activity").insert(rows.map((task) => ({
      task_id: task.id,
      message: task.task_type === "sub_issue" ? "Sub-Issue über CEO Intake erstellt" : "Deliverable über CEO Intake erstellt",
    })));

    await supabase.from("audit_log").insert(rows.map((task) => ({
      actor_profile_id: permission.profile?.id || null,
      action: "task_intake.create",
      entity_type: "task",
      entity_id: task.id,
      after_data: task,
      ...auditRequestMetadata(request),
    })));

    const profileNameById = new Map(context.profiles.map((profile) => [profile.id, profile.name]));
    const createdTasks = rows.map((task) => mapCreatedTask(task, profileNameById));

    return NextResponse.json({ ok: true, tasks: createdTasks });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Task Intake konnte nicht gespeichert werden." }, { status: 500 });
  }
}
