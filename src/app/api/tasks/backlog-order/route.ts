import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requirePlanningContributor } from "@/lib/authz";
import { isOperationalLeadRole } from "@/lib/platform";

type BacklogPlacement = "before" | "after";

type BacklogMove = {
  taskId: string;
  targetTaskId: string;
  placement: BacklogPlacement;
  expectedTaskUpdatedAt: string;
  expectedTargetUpdatedAt: string;
};

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Boolean(value) && !Number.isNaN(Date.parse(value));
}

function parseBacklogMove(payload: unknown): BacklogMove | string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "Backlog-Verschiebung ist ungültig.";
  const candidate = payload as Partial<Record<keyof BacklogMove, unknown>>;
  const taskId = typeof candidate.taskId === "string" ? candidate.taskId.trim() : "";
  const targetTaskId = typeof candidate.targetTaskId === "string" ? candidate.targetTaskId.trim() : "";
  const placement = candidate.placement;

  if (
    !taskId
    || !targetTaskId
    || taskId === targetTaskId
    || (placement !== "before" && placement !== "after")
    || !validTimestamp(candidate.expectedTaskUpdatedAt)
    || !validTimestamp(candidate.expectedTargetUpdatedAt)
  ) {
    return "Backlog-Verschiebung ist ungültig.";
  }

  return {
    taskId,
    targetTaskId,
    placement,
    expectedTaskUpdatedAt: candidate.expectedTaskUpdatedAt,
    expectedTargetUpdatedAt: candidate.expectedTargetUpdatedAt,
  };
}

export async function PATCH(request: NextRequest) {
  const apiContext = await requireApiContext(request, requirePlanningContributor, {
    supabaseUnavailableMessage: "Backlog-Reihenfolge konnte nicht dauerhaft gespeichert werden.",
  });
  if (!apiContext.ok) return apiContext.response;

  const { permission, supabase } = apiContext;
  if (!isOperationalLeadRole(permission.profile?.platformRole)) {
    return apiError("Nur CEO oder Deputy können die Backlog-Reihenfolge ändern.", 403);
  }

  const payload = await request.json().catch(() => null);
  const move = parseBacklogMove(payload);
  if (typeof move === "string") return apiError(move, 400);

  const metadata = auditRequestMetadata(request);
  const { data: transactionData, error: transactionError } = await supabase.rpc("move_backlog_task_transaction", {
    p_task_id: move.taskId,
    p_target_task_id: move.targetTaskId,
    p_placement: move.placement,
    p_expected_task_updated_at: move.expectedTaskUpdatedAt,
    p_expected_target_updated_at: move.expectedTargetUpdatedAt,
    p_actor_profile_id: permission.profile?.id || null,
    p_request_ip: metadata.request_ip,
    p_user_agent: metadata.user_agent || null,
  });
  if (transactionError) {
    if (transactionError.code === "P0001") return apiError("Backlog wurde parallel geändert. Bitte neu laden.", 409);
    if (transactionError.code === "P0002") return apiError("Mindestens eine Aufgabe wurde nicht gefunden.", 404);
    if (transactionError.code === "P0003") return apiError("Backlog hat sich geändert. Bitte neu laden.", 409);
    if (transactionError.code === "22023") return apiError("Backlog-Änderung ist ungültig.", 400);
    return apiError(transactionError.message, 500);
  }

  return NextResponse.json({ ok: true, updates: transactionData || [] });
}
