import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import {
  planningTrashError,
  planningTrashTransactionFromResult,
  restorePlanningItemCommand,
  withdrawPlanningItemCommand,
} from "@/features/planning-items/model/planning-items-trash";
import {
  validatePlanningTrashReason,
  validatePlanningTrashRevision,
  type PlanningTrashRestorePayload,
  type PlanningTrashWithdrawPayload,
} from "@/features/planning/model/planning-trash-contract";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError } from "@/lib/api-response";
import { requirePlanningJsonContext } from "@/features/planning/server/planning-api-context";
import type { TrashRootType } from "@/lib/types";

function label(rootType: TrashRootType) {
  return rootType === "initiative" ? "Initiative" : "Deliverable";
}

function requestMetadata(request: NextRequest) {
  const metadata = auditRequestMetadata(request);
  return {
    ...(metadata.request_ip ? { requestIp: metadata.request_ip } : {}),
    ...(metadata.user_agent ? { userAgent: metadata.user_agent } : {}),
  };
}

export async function handlePlanningTrashWithdraw(
  request: NextRequest,
  rootId: string,
  expectedRootType?: TrashRootType,
) {
  const context = await requirePlanningJsonContext<PlanningTrashWithdrawPayload>(request, "planning.trash.withdraw", {}, rootId);
  if (!context.ok) return context.response;
  const reason = validatePlanningTrashReason(context.payload.reason);
  if (!reason.ok) {
    return apiError(reason.reason === "too_long"
      ? "Die Begründung darf höchstens 2.000 Zeichen lang sein."
      : "Für das Zurückziehen ist eine Begründung erforderlich.", 400);
  }
  if (!validatePlanningTrashRevision(context.payload.expectedRevision)) return apiError("Aktueller Freigabestand ist erforderlich.", 400);
  const { data: item, error: itemError } = await context.planning.readItemKind();
  if (itemError) return apiError("Planungselement konnte nicht geladen werden.", 500);
  if (!item || (item.task_type !== "initiative" && item.task_type !== "deliverable")) {
    return apiError("Planungselement wurde nicht gefunden.", 404);
  }
  const rootType = item.task_type;
  if (expectedRootType && expectedRootType !== rootType) return apiError(`${label(expectedRootType)} wurde nicht gefunden.`, 404);

  const result = await context.planning.runTrash(rootType, {
    command: withdrawPlanningItemCommand(rootId, {
      expectedApprovalRevision: Number(context.payload.expectedRevision),
      reason: reason.reason,
    }),
    requestMetadata: requestMetadata(request),
  });
  if (!result.ok) {
    const mapped = planningTrashError(result.error, rootType, "withdraw");
    return apiError(mapped.message, mapped.status);
  }
  const transaction = planningTrashTransactionFromResult(result);
  if (result.status !== "committed" || !transaction) return apiError(`${label(rootType)} konnte nicht zurückgezogen werden.`, 500);
  const lifecycle = await context.planning.trashLifecycle();
  return NextResponse.json({ ok: true, ...transaction, lifecycle });
}

export async function handlePlanningTrashRestore(
  request: NextRequest,
  rootId: string,
  expectedRootType?: TrashRootType,
) {
  const context = await requirePlanningJsonContext<PlanningTrashRestorePayload>(request, "planning.trash.restore", {}, rootId);
  if (!context.ok) return context.response;
  if (!validatePlanningTrashRevision(context.payload.expectedTrashRevision)) return apiError("Aktueller Papierkorbstand ist erforderlich.", 400);
  const { data: item, error: itemError } = await context.planning.readItemKind();
  if (itemError) return apiError("Planungselement konnte nicht geladen werden.", 500);
  if (!item || (item.task_type !== "initiative" && item.task_type !== "deliverable")) {
    return apiError("Planungselement wurde nicht gefunden.", 404);
  }
  const rootType = item.task_type;
  if (expectedRootType && expectedRootType !== rootType) return apiError(`${label(expectedRootType)} wurde nicht gefunden.`, 404);

  const result = await context.planning.runTrash(rootType, {
    command: restorePlanningItemCommand(rootId, Number(context.payload.expectedTrashRevision)),
    requestMetadata: requestMetadata(request),
  });
  if (!result.ok) {
    const mapped = planningTrashError(result.error, rootType, "restore");
    return apiError(mapped.message, mapped.status);
  }
  const transaction = planningTrashTransactionFromResult(result);
  if (result.status !== "committed" || !transaction) return apiError(`${label(rootType)} konnte nicht wiederhergestellt werden.`, 500);
  const lifecycle = await context.planning.trashLifecycle();
  return NextResponse.json({ ok: true, ...transaction, lifecycle });
}
