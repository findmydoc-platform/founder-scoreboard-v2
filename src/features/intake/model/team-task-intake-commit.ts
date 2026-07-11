import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import type { getServerSupabase } from "@/lib/supabase";
import type { AuthenticatedProfile } from "@/lib/types";
import type { TaskIntakeInput } from "@/features/intake/model/task-intake";
import { canonicalTeamTaskIntakeRequest, type TeamTaskIntakePreviewTask } from "@/features/intake/model/team-task-intake";
import type { TeamTaskIntakeCreatedTask, TeamTaskIntakeTaskType } from "@/features/intake/model/team-task-intake-contract";

type SupabaseServer = NonNullable<ReturnType<typeof getServerSupabase>>;

type TeamTaskIntakeTaskSnapshot = {
  id?: string;
  title?: string;
  status?: string;
  priority?: string;
  owner?: string | null;
  assignee?: string | null;
  created_by?: string | null;
  package_id?: string | null;
  milestone_id?: string | null;
  sprint_id?: string | null;
  task_type?: TeamTaskIntakeTaskType | null;
  parent_task_id?: string | null;
  score_relevant?: boolean | null;
};

type TeamTaskIntakeBatchResult = {
  batchId?: string;
  replayed?: boolean;
  tasks?: TeamTaskIntakeTaskSnapshot[];
};

function rpcError(error: { message: string; code?: string }) {
  const commitError = new Error(error.message) as Error & { code?: string };
  commitError.code = error.code;
  return commitError;
}

export function teamTaskIntakeRequestHash(rawTasks: TaskIntakeInput[]) {
  const canonicalRequest = canonicalTeamTaskIntakeRequest(rawTasks);
  return createHash("sha256").update(JSON.stringify(canonicalRequest), "utf8").digest("hex");
}

export function mapTeamTaskIntakeCreatedTask(task: TeamTaskIntakeTaskSnapshot): TeamTaskIntakeCreatedTask {
  return {
    id: task.id || "",
    title: task.title || "",
    status: task.status || "Offen",
    priority: task.priority || "P2",
    ownerId: task.owner || "",
    assigneeId: task.assignee || "",
    createdById: task.created_by || "",
    initiativeId: task.package_id || "",
    milestoneId: task.milestone_id || "",
    sprintId: task.sprint_id || "",
    taskType: task.task_type === "sub_issue" ? "sub_issue" : "proposal",
    parentTaskId: task.parent_task_id || "",
    scoreRelevant: false,
  };
}

export async function loadTeamTaskIntakeReplay({
  idempotencyKey,
  requestHash,
  supabase,
  tokenId,
}: {
  idempotencyKey: string;
  requestHash: string;
  supabase: SupabaseServer;
  tokenId: string;
}) {
  const { data, error } = await supabase
    .from("team_task_intake_batches")
    .select("id,request_hash,response_tasks")
    .eq("token_id", tokenId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw rpcError(error);
  if (!data) return null;
  if (data.request_hash !== requestHash) throw rpcError({ code: "P0003", message: "idempotency key conflict" });

  return {
    batchId: data.id,
    replayed: true,
    tasks: ((data.response_tasks || []) as TeamTaskIntakeTaskSnapshot[]).map(mapTeamTaskIntakeCreatedTask),
  };
}

export async function commitTeamTaskIntake({
  actor,
  idempotencyKey,
  preview,
  request,
  requestHash,
  supabase,
  tokenId,
}: {
  actor: AuthenticatedProfile;
  idempotencyKey: string;
  preview: TeamTaskIntakePreviewTask[];
  request: NextRequest;
  requestHash: string;
  supabase: SupabaseServer;
  tokenId: string;
}) {
  const items = preview.map((task) => ({
    title: task.title,
    description: task.description,
    problemStatement: task.problemStatement,
    intendedOutcome: task.intendedOutcome,
    scopeConstraints: task.scopeConstraints,
    acceptanceCriteria: task.acceptanceCriteria,
    evidenceRequired: task.evidenceRequired,
    definitionOfDone: task.definitionOfDone,
    taskType: task.taskType,
    parentTaskId: task.parentTaskId,
    packageId: task.packageId,
    milestoneId: task.milestoneId,
    ownerId: task.ownerId,
    priority: task.priority,
    status: task.status,
    workstream: task.workstream,
    startDate: task.startDate,
    endDate: task.endDate,
    deadline: task.deadline,
    hours: task.hours,
  }));

  const metadata = auditRequestMetadata(request);
  const { data, error } = await supabase.rpc("create_team_task_intake_batch_transaction", {
    p_token_id: tokenId,
    p_profile_id: actor.id,
    p_idempotency_key: idempotencyKey,
    p_request_hash: requestHash,
    p_items: items,
    p_request_ip: metadata.request_ip,
    p_user_agent: metadata.user_agent,
  });

  if (error) throw rpcError(error);

  const result = data as TeamTaskIntakeBatchResult | null;
  if (!result?.batchId || !Array.isArray(result.tasks)) throw new Error("Team Task Intake returned an incomplete batch result.");

  return {
    batchId: result.batchId,
    replayed: Boolean(result.replayed),
    tasks: result.tasks.map(mapTeamTaskIntakeCreatedTask),
  };
}
