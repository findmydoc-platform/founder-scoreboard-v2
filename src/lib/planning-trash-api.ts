import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import {
  isWithdrawableApprovalStatus,
  validatePlanningTrashReason,
  validatePlanningTrashRevision,
  type PlanningTrashRestorePayload,
  type PlanningTrashWithdrawPayload,
} from "@/features/planning/model/planning-trash-contract";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { requireOperationalLead, requirePlanningContributor } from "@/lib/authz";
import { attemptPlanningGitHubLifecycleDrain } from "@/lib/planning-github-lifecycle-trigger";
import { isOperationalLeadRole } from "@/lib/platform";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";
import type { ApprovalStatus, TrashRootType } from "@/lib/types";

type PlanningTrashRootRow = {
  id: string;
  task_type?: "deliverable" | "sub_issue" | null;
  approval_status: ApprovalStatus | null;
  approval_revision: number | null;
  proposed_by: string | null;
  trashed_at: string | null;
  trash_revision: number | null;
};

type PlanningTrashTransactionResult = Record<string, unknown> & {
  affectedTaskIds?: unknown;
  affected_task_ids?: unknown;
  eventIds?: unknown;
  event_ids?: unknown;
  item?: unknown;
  rootId?: unknown;
  root_id?: unknown;
  rootType?: unknown;
  root_type?: unknown;
  trashRevision?: unknown;
  trash_revision?: unknown;
};

function planningTrashRootLabel(rootType: TrashRootType) {
  return rootType === "initiative" ? "Initiative" : "Deliverable";
}

function planningTrashRootTable(rootType: TrashRootType) {
  return rootType === "initiative" ? "packages" : "tasks";
}

function planningTrashRootSelect(rootType: TrashRootType) {
  return rootType === "initiative"
    ? "id,approval_status,approval_revision,proposed_by,trashed_at,trash_revision"
    : "id,task_type,approval_status,approval_revision,proposed_by,trashed_at,trash_revision";
}

function planningTrashTransactionError(
  error: { code?: string; message?: string },
  rootType: TrashRootType,
  action: "withdraw" | "restore",
) {
  const label = planningTrashRootLabel(rootType);
  if (error.code === "P0001") return apiError(`${label} wurde zwischenzeitlich geändert. Bitte neu laden.`, 409);
  if (error.code === "P0002") return apiError(`${label} wurde nicht gefunden.`, 404);
  if (error.code === "P0003") return apiError(error.message || `${label} kann in diesem Zustand nicht ${action === "withdraw" ? "zurückgezogen" : "wiederhergestellt"} werden.`, 409);
  if (error.code === "P0006") return apiError(error.message || "Keine Berechtigung für diese Aktion.", 403);
  if (error.code === "22023") return apiError(error.message || "Papierkorb-Aktion ist ungültig.", 400);
  return apiError(error.message || `${label} konnte nicht ${action === "withdraw" ? "zurückgezogen" : "wiederhergestellt"} werden.`, 500);
}

function values(value: unknown): Array<string | number> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string | number => typeof item === "string" || typeof item === "number");
}

function stringValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())))];
}

function normalizePlanningTrashTransactionResult(data: unknown, rootType: TrashRootType, rootId: string) {
  const result = data && typeof data === "object" ? data as PlanningTrashTransactionResult : {};
  return {
    rootType: result.rootType === "initiative" || result.rootType === "deliverable"
      ? result.rootType
      : result.root_type === "initiative" || result.root_type === "deliverable"
        ? result.root_type
        : rootType,
    rootId: typeof result.rootId === "string"
      ? result.rootId
      : typeof result.root_id === "string"
        ? result.root_id
        : rootId,
    affectedTaskIds: stringValues(result.affectedTaskIds ?? result.affected_task_ids),
    trashRevision: Number(result.trashRevision ?? result.trash_revision ?? 0),
    item: result.item && typeof result.item === "object" ? result.item : null,
    eventIds: values(result.eventIds ?? result.event_ids),
  };
}

async function loadPlanningTrashRoot(
  supabase: SupabaseClient,
  rootType: TrashRootType,
  rootId: string,
) {
  return supabase
    .from(planningTrashRootTable(rootType))
    .select(planningTrashRootSelect(rootType))
    .eq("id", rootId)
    .maybeSingle<PlanningTrashRootRow>();
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
    return apiError(
      reason.reason === "too_long"
        ? "Die Begründung darf höchstens 2.000 Zeichen lang sein."
        : "Für das Zurückziehen ist eine Begründung erforderlich.",
      400,
    );
  }
  if (!validatePlanningTrashRevision(context.payload.expectedRevision)) {
    return apiError("Aktueller Freigabestand ist erforderlich.", 400);
  }

  const serviceSupabase = getServerServiceRoleSupabase();
  if (!serviceSupabase) return apiError("Server-Service für den Papierkorb ist nicht konfiguriert.", 503);
  const { data: root, error: rootError } = await loadPlanningTrashRoot(serviceSupabase, rootType, rootId);
  if (rootError) return apiError(rootError.message, 500);
  if (!root) return apiError(`${planningTrashRootLabel(rootType)} wurde nicht gefunden.`, 404);
  if (rootType === "deliverable" && root.task_type !== "deliverable") {
    return apiError("Sub-Issues können nicht unabhängig zurückgezogen werden.", 400);
  }
  if (root.trashed_at) return apiError(`${planningTrashRootLabel(rootType)} liegt bereits im Papierkorb.`, 409);
  if (!isWithdrawableApprovalStatus(root.approval_status)) {
    return apiError("Nur Entwürfe oder eingereichte Vorschläge können zurückgezogen werden.", 409);
  }
  if (Number(root.approval_revision || 0) !== Number(context.payload.expectedRevision)) {
    return apiError(`${planningTrashRootLabel(rootType)} wurde zwischenzeitlich geändert. Bitte neu laden.`, 409);
  }

  const profile = context.permission.profile;
  if (profile && !isOperationalLeadRole(profile.platformRole) && root.proposed_by !== profile.id) {
    return apiError("Nur Antragsteller, CEO oder Deputy können dieses Item zurückziehen.", 403);
  }

  const requestMetadata = auditRequestMetadata(request);
  const { data, error } = await serviceSupabase.rpc("withdraw_planning_item_transaction", {
    p_root_type: rootType,
    p_root_id: rootId,
    p_expected_revision: Number(context.payload.expectedRevision),
    p_actor_profile_id: profile?.id || null,
    p_reason: reason.reason,
    p_request_ip: requestMetadata.request_ip,
    p_user_agent: requestMetadata.user_agent || null,
  });
  if (error) return planningTrashTransactionError(error, rootType, "withdraw");

  const result = normalizePlanningTrashTransactionResult(data, rootType, rootId);
  const lifecycle = await attemptPlanningGitHubLifecycleDrain({ rootType, rootId, taskIds: result.affectedTaskIds, supabase: serviceSupabase });
  return NextResponse.json({ ok: true, ...result, lifecycle });
}

export async function handlePlanningTrashRestore(
  request: NextRequest,
  rootId: string,
  rootType: TrashRootType,
) {
  const context = await requireJsonApiContext<PlanningTrashRestorePayload>(request, requireOperationalLead, {});
  if (!context.ok) return context.response;
  if (!validatePlanningTrashRevision(context.payload.expectedTrashRevision)) {
    return apiError("Aktueller Papierkorbstand ist erforderlich.", 400);
  }

  const serviceSupabase = getServerServiceRoleSupabase();
  if (!serviceSupabase) return apiError("Server-Service für den Papierkorb ist nicht konfiguriert.", 503);
  const { data: root, error: rootError } = await loadPlanningTrashRoot(serviceSupabase, rootType, rootId);
  if (rootError) return apiError(rootError.message, 500);
  if (!root) return apiError(`${planningTrashRootLabel(rootType)} wurde nicht gefunden.`, 404);
  if (rootType === "deliverable" && root.task_type !== "deliverable") {
    return apiError("Sub-Issues können nicht unabhängig wiederhergestellt werden.", 400);
  }
  if (!root.trashed_at) return apiError(`${planningTrashRootLabel(rootType)} liegt nicht im Papierkorb.`, 409);
  if (Number(root.trash_revision || 0) !== Number(context.payload.expectedTrashRevision)) {
    return apiError(`${planningTrashRootLabel(rootType)} wurde zwischenzeitlich geändert. Bitte neu laden.`, 409);
  }

  const requestMetadata = auditRequestMetadata(request);
  const { data, error } = await serviceSupabase.rpc("restore_planning_item_transaction", {
    p_root_type: rootType,
    p_root_id: rootId,
    p_expected_trash_revision: Number(context.payload.expectedTrashRevision),
    p_actor_profile_id: context.permission.profile?.id || null,
    p_request_ip: requestMetadata.request_ip,
    p_user_agent: requestMetadata.user_agent || null,
  });
  if (error) return planningTrashTransactionError(error, rootType, "restore");

  const result = normalizePlanningTrashTransactionResult(data, rootType, rootId);
  const lifecycle = await attemptPlanningGitHubLifecycleDrain({ rootType, rootId, taskIds: result.affectedTaskIds, supabase: serviceSupabase });
  return NextResponse.json({ ok: true, ...result, lifecycle });
}
