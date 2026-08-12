import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { actorContextFromSessionAuth } from "@/features/planning-items/model/planning-actor-context-server";
import {
  createPlanningTrashPlanningItems,
  planningTrashError,
  planningTrashTransactionFromResult,
  restorePlanningItemCommand,
  runPlanningTrashLifecycle,
  withdrawPlanningItemCommand,
} from "@/features/planning-items/model/planning-items-trash";
import {
  validatePlanningTrashReason,
  validatePlanningTrashRevision,
  type PlanningTrashRestorePayload,
  type PlanningTrashWithdrawPayload,
} from "@/features/planning/model/planning-trash-contract";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { requireOperationalLead, requirePlanningContributor } from "@/lib/authz";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";
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
  rootType: TrashRootType,
) {
  const context = await requireJsonApiContext<PlanningTrashWithdrawPayload>(request, requirePlanningContributor, {});
  if (!context.ok) return context.response;
  const reason = validatePlanningTrashReason(context.payload.reason);
  if (!reason.ok) {
    return apiError(reason.reason === "too_long"
      ? "Die Begründung darf höchstens 2.000 Zeichen lang sein."
      : "Für das Zurückziehen ist eine Begründung erforderlich.", 400);
  }
  if (!validatePlanningTrashRevision(context.payload.expectedRevision)) return apiError("Aktueller Freigabestand ist erforderlich.", 400);
  const actor = actorContextFromSessionAuth({ ok: true, profile: context.permission.profile });
  if (!actor.ok) return apiError("Nur Antragsteller, CEO oder Deputy können dieses Item zurückziehen.", 403);
  const serviceSupabase = getServerServiceRoleSupabase();
  if (!serviceSupabase) return apiError("Server-Service für den Papierkorb ist nicht konfiguriert.", 503);

  const result = await createPlanningTrashPlanningItems(serviceSupabase, rootType).run({
    actor: actor.actor,
    mode: "commit",
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
  const lifecycle = await runPlanningTrashLifecycle(serviceSupabase, transaction);
  return NextResponse.json({ ok: true, ...transaction, lifecycle });
}

export async function handlePlanningTrashRestore(
  request: NextRequest,
  rootId: string,
  rootType: TrashRootType,
) {
  const context = await requireJsonApiContext<PlanningTrashRestorePayload>(request, requireOperationalLead, {});
  if (!context.ok) return context.response;
  if (!validatePlanningTrashRevision(context.payload.expectedTrashRevision)) return apiError("Aktueller Papierkorbstand ist erforderlich.", 400);
  const actor = actorContextFromSessionAuth({ ok: true, profile: context.permission.profile });
  if (!actor.ok) return apiError("Keine Berechtigung für diese Aktion.", 403);
  const serviceSupabase = getServerServiceRoleSupabase();
  if (!serviceSupabase) return apiError("Server-Service für den Papierkorb ist nicht konfiguriert.", 503);

  const result = await createPlanningTrashPlanningItems(serviceSupabase, rootType).run({
    actor: actor.actor,
    mode: "commit",
    command: restorePlanningItemCommand(rootId, Number(context.payload.expectedTrashRevision)),
    requestMetadata: requestMetadata(request),
  });
  if (!result.ok) {
    const mapped = planningTrashError(result.error, rootType, "restore");
    return apiError(mapped.message, mapped.status);
  }
  const transaction = planningTrashTransactionFromResult(result);
  if (result.status !== "committed" || !transaction) return apiError(`${label(rootType)} konnte nicht wiederhergestellt werden.`, 500);
  const lifecycle = await runPlanningTrashLifecycle(serviceSupabase, transaction);
  return NextResponse.json({ ok: true, ...transaction, lifecycle });
}
