import type { NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { mapTaskRow, type TaskRowForMapping } from "@/lib/planning-task-mappers";
import { slugify } from "@/lib/slug";
import { buildTaskInsertRow } from "@/lib/task-insert-row";
import type { TaskIntakeContext, TaskIntakePreviewTask } from "@/features/intake/model/task-intake";
import type { Task } from "@/lib/types";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";

type SupabaseReader = ReturnType<typeof import("@/lib/supabase").getServerSupabase>;

type CommitTaskIntakeOptions = {
  supabase: NonNullable<SupabaseReader>;
  request: NextRequest;
  context: TaskIntakeContext;
  preview: TaskIntakePreviewTask[];
  actorProfileId: string | null;
  auditAction: "task_intake.create" | "agent.task_intake.create";
  activitySource: "CEO Intake" | "Agent API";
};

function insertForTask(task: TaskIntakePreviewTask, id: string, sortOrder: number, createdBy: string | null) {
  return buildTaskInsertRow({
    id,
    packageId: task.packageId,
    milestoneId: task.milestoneId,
    title: task.title,
    description: task.description,
    problemStatement: task.problemStatement,
    intendedOutcome: task.intendedOutcome,
    scopeConstraints: task.scopeConstraints,
    acceptanceCriteria: task.acceptanceCriteria,
    evidenceRequired: task.evidenceRequired,
    status: task.status,
    priority: task.priority,
    owner: task.assigneeId,
    assignee: task.assigneeId,
    createdBy,
    workstream: task.workstream,
    sortOrder,
    startDate: task.startDate,
    endDate: task.endDate,
    deadline: task.deadline || null,
    hours: task.hours,
    definitionOfDone: task.definitionOfDone,
    sprintId: null,
    reviewOwnerProfileId: task.reviewOwnerProfileId,
    taskType: task.taskType,
    parentTaskId: task.parentTaskId,
    scoreRelevant: false,
    approvalStatus: task.taskType === "sub_issue" ? null : "proposed",
  });
}

export async function commitTaskIntake({
  supabase,
  request,
  context,
  preview,
  actorProfileId,
  auditAction,
  activitySource,
}: CommitTaskIntakeOptions) {
  const { data: maxRow } = await supabase
    .from(ACTIVE_TASKS_TABLE)
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const baseSortOrder = Number(maxRow?.sort_order || 0);
  const createdBy = actorProfileId;
  const idPrefix = actorProfileId || "agent";
  const now = Date.now().toString(36);
  const inserts = preview.map((task, index) => {
    const id = `${idPrefix}-${slugify(task.title, { maxLength: 70 }) || "neue-aufgabe"}-${now}-${index + 1}`;
    return insertForTask(task, id, baseSortOrder + index + 1, createdBy);
  });

  const { data: createdRows, error: insertError } = await supabase.from("tasks").insert(inserts).select("*");
  if (insertError || !createdRows) throw new Error(insertError?.message || "Aufgaben konnten nicht erstellt werden.");

  const rows = createdRows as (TaskRowForMapping & { id: string; task_type?: Task["taskType"] | null })[];
  await supabase.from("task_activity").insert(rows.map((task) => ({
    task_id: task.id,
    message: task.task_type === "sub_issue" ? `Sub-Issue über ${activitySource} erstellt` : `Deliverable über ${activitySource} erstellt`,
  })));

  await supabase.from("audit_log").insert(rows.map((task) => ({
    actor_profile_id: actorProfileId,
    action: auditAction,
    entity_type: "task",
    entity_id: task.id,
    after_data: { ...task, agentApi: auditAction === "agent.task_intake.create" },
    ...auditRequestMetadata(request),
  })));

  const profileNameById = new Map(context.profiles.map((profile) => [profile.id, profile.name]));
  return rows.map((task) => mapTaskRow(task, profileNameById));
}
