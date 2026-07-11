import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { createNotificationPayload } from "@/lib/notification-catalog";
import { mapTaskRow, type TaskRowForMapping } from "@/lib/planning-task-mappers";
import { slugify } from "@/lib/slug";
import type { getServerSupabase } from "@/lib/supabase";
import { buildTaskInsertRow } from "@/lib/task-insert-row";
import type { AuthenticatedProfile, Task } from "@/lib/types";
import type { TeamTaskIntakeContext, TeamTaskIntakePreviewTask } from "@/features/intake/model/team-task-intake";

type SupabaseServer = NonNullable<ReturnType<typeof getServerSupabase>>;

type TeamTaskIntakeBatchResult = {
  batchId?: string;
  replayed?: boolean;
  tasks?: TaskRowForMapping[];
};

function requestHash(preview: TeamTaskIntakePreviewTask[]) {
  return createHash("sha256").update(JSON.stringify(preview), "utf8").digest("hex");
}

function deterministicTaskId(actorId: string, title: string, creationRequestId: string) {
  const suffix = createHash("sha256").update(creationRequestId, "utf8").digest("hex").slice(0, 12);
  return `${actorId}-${slugify(title, { maxLength: 70 }) || "neue-aufgabe"}-${suffix}`;
}

export async function commitTeamTaskIntake({
  actor,
  context,
  idempotencyKey,
  preview,
  request,
  supabase,
  tokenId,
}: {
  actor: AuthenticatedProfile;
  context: TeamTaskIntakeContext;
  idempotencyKey: string;
  preview: TeamTaskIntakePreviewTask[];
  request: NextRequest;
  supabase: SupabaseServer;
  tokenId: string;
}) {
  const { data: leadRows, error: leadsError } = preview.some((task) => task.taskType === "proposal")
    ? await supabase.from("profiles").select("id").in("platform_role", ["ceo", "deputy"])
    : { data: [], error: null };
  if (leadsError) throw new Error(leadsError.message);

  const items = preview.map((task, index) => {
    const creationRequestId = `team:${tokenId}:${idempotencyKey}:${index + 1}`;
    const notifications = task.taskType === "proposal"
      ? (leadRows || [])
        .filter((lead) => lead.id !== actor.id)
        .map((lead) => createNotificationPayload("task.proposed", {
          actorProfileId: actor.id,
          recipientProfileId: lead.id,
          entityType: "task",
          entityId: deterministicTaskId(actor.id, task.title, creationRequestId),
          title: `Aufgabenvorschlag: ${task.title}`,
          body: task.description || "Ein neuer Aufgabenvorschlag wurde über Team Intake eingereicht.",
        }))
      : [];

    return {
      taskInsert: buildTaskInsertRow({
        id: deterministicTaskId(actor.id, task.title, creationRequestId),
        creationRequestId,
        packageId: task.packageId || null,
        milestoneId: task.milestoneId || null,
        title: task.title,
        description: task.description,
        problemStatement: task.problemStatement,
        intendedOutcome: task.intendedOutcome,
        scopeConstraints: task.scopeConstraints,
        acceptanceCriteria: task.acceptanceCriteria,
        evidenceRequired: task.evidenceRequired,
        status: task.status,
        priority: task.priority,
        owner: task.ownerId || null,
        assignee: task.ownerId || null,
        createdBy: actor.id,
        workstream: task.workstream,
        sortOrder: 0,
        startDate: task.startDate || null,
        endDate: task.endDate || null,
        deadline: task.deadline || null,
        hours: task.hours,
        definitionOfDone: task.definitionOfDone,
        sprintId: null,
        reviewOwnerProfileId: null,
        scorePoints: 0,
        scoreFinal: false,
        taskType: task.taskType,
        parentTaskId: task.parentTaskId || null,
        scoreRelevant: false,
      }),
      activityMessage: task.taskType === "proposal"
        ? "Aufgabenvorschlag über Team Intake erstellt"
        : "Sub-Issue über Team Intake erstellt",
      notifications,
    };
  });

  const metadata = auditRequestMetadata(request);
  const { data, error } = await supabase.rpc("create_team_task_intake_batch_transaction", {
    p_token_id: tokenId,
    p_profile_id: actor.id,
    p_idempotency_key: idempotencyKey,
    p_request_hash: requestHash(preview),
    p_items: items,
    p_request_ip: metadata.request_ip,
    p_user_agent: metadata.user_agent,
  });

  if (error) {
    const commitError = new Error(error.message) as Error & { code?: string };
    commitError.code = error.code;
    throw commitError;
  }

  const result = data as TeamTaskIntakeBatchResult | null;
  if (!result?.batchId || !Array.isArray(result.tasks)) throw new Error("Team Task Intake lieferte kein vollständiges Batch-Ergebnis.");

  const profileNameById = new Map(context.profiles.map((profile) => [profile.id, profile.name]));
  const tasks = (result.tasks as Array<TaskRowForMapping & { task_type?: Task["taskType"] | null }>)
    .map((task) => mapTaskRow(task, profileNameById));

  return {
    batchId: result.batchId,
    replayed: Boolean(result.replayed),
    tasks,
  };
}
