import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requirePlanningJsonContext } from "@/features/planning/server/planning-api-context";
import { apiError } from "@/lib/api-response";
import { createNotificationPayload } from "@/lib/notification-catalog";
import { mentionedProfileIds } from "@/lib/mentions";
import { taskDetailPermissions } from "@/features/tasks/model/task-detail-permissions";

type BlockerPayload = {
  reason?: string;
  impact?: string;
  needsHelpFrom?: string;
};

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const apiContext = await requirePlanningJsonContext<BlockerPayload>(request, "planning.blocker.report", {}, id);
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, planning } = apiContext;
  const activeItem = await planning.ensureCollaborationActive();
  if (!activeItem.ok) return apiError(activeItem.error, activeItem.status);
  const reason = cleanText(payload.reason, 2000);
  const impact = cleanText(payload.impact, 2000);
  const needsHelpFrom = cleanText(payload.needsHelpFrom, 500);

  if (reason.length < 5) {
    return apiError("Blocker-Grund ist erforderlich.", 400);
  }

  const { data: task, error: taskError } = await planning.readCollaborationTask();

  if (taskError || !task) return apiError("Aufgabe wurde nicht gefunden.", 404);
  const detailPermissions = taskDetailPermissions({
    task: {
      assignee: task.assignee || "",
      assigneeId: task.assignee || "",
      owner: task.owner || "",
      ownerId: task.owner || "",
      reviewOwnerProfileId: "",
      reviewStatus: task.review_status || "not_requested",
      scoreFinal: Boolean(task.score_final),
      status: task.status || "",
      taskType: task.task_type === "sub_issue" ? "sub_issue" : "deliverable",
    },
    profile: permission.profile,
    unrestricted: !permission.profile,
  });
  if (!detailPermissions.canReportBlocker) {
    return apiError("Founder können Blocker nur für eigene Aufgaben melden.", 403);
  }

  const { data: profiles, error: profilesError } = await planning.readCollaborationProfiles();
  if (profilesError) return apiError("Erwähnungen konnten nicht aufgelöst werden.", 500);
  const mentionRecipients = new Set(mentionedProfileIds(
    [reason, impact, needsHelpFrom].filter(Boolean).join("\n"),
    (profiles || []).map((profile) => ({ id: profile.id, name: profile.name, githubLogin: profile.github_login })),
  ));
  const notifications = (profiles || [])
    .filter((profile) => ["ceo", "deputy"].includes(profile.platform_role))
    .filter((lead) => lead.id !== permission.profile?.id)
    .map((lead) => createNotificationPayload("task.blocker_reported", {
      actorProfileId: permission.profile?.id,
      recipientProfileId: lead.id,
      entityType: "task",
      entityId: id,
      title: `Blocker gemeldet: ${task.title}`,
      body: [reason, impact ? `Impact: ${impact}` : "", needsHelpFrom ? `Braucht Hilfe von: ${needsHelpFrom}` : ""].filter(Boolean).join("\n"),
    }))
    .filter((notification) => !mentionRecipients.has(notification.recipient_profile_id || ""));
  const metadata = auditRequestMetadata(request);
  const { data: transaction, error: transactionError } = await planning.writeBlocker({ reason, impact, needsHelpFrom, notifications, mentions: [...mentionRecipients] }, metadata);
  if (transactionError) {
    if (transactionError.code === "P0002") return apiError("Aufgabe wurde nicht gefunden.", 404);
    if (transactionError.code === "P0010") return apiError("Dieses Issue ist während oder nach dem Review geschützt.", 409);
    if (transactionError.code === "42501") return apiError("Founder können Blocker nur für eigene Aufgaben melden.", 403);
    if (transactionError.code === "22023") return apiError("Blocker-Grund ist erforderlich.", 400);
    return apiError("Blocker konnte nicht gespeichert werden.", 500);
  }
  const blocker = (transaction as { blocker?: {
    id: number;
    task_id: string;
    profile_id: string | null;
    reason: string;
    impact: string | null;
    needs_help_from: string | null;
    status: string;
    created_at: string;
    resolved_at: string | null;
  } } | null)?.blocker;
  if (!blocker) return apiError("Blocker konnte nicht gespeichert werden.", 500);

  return NextResponse.json({
    ok: true,
    blocker: {
      id: blocker.id,
      taskId: blocker.task_id,
      profileId: blocker.profile_id || "",
      reason: blocker.reason,
      impact: blocker.impact || "",
      needsHelpFrom: blocker.needs_help_from || "",
      status: blocker.status,
      createdAt: blocker.created_at,
      resolvedAt: blocker.resolved_at || "",
    },
    task: { id, status: "Blockiert" },
  });
}
