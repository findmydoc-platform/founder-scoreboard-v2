import { NextResponse, type NextRequest } from "next/server";
import { approvalTransactionError, validateApprovalDecision, type ApprovalDecisionPayload } from "@/lib/approval-api";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { requirePlanningContributor } from "@/lib/authz";
import { mapPackage } from "@/lib/planning-profile-mappers";
import type { DbPackage } from "@/lib/planning-data-row-types";
import { requireActivePlanningItem } from "@/lib/planning-trash-mutation-guard";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<ApprovalDecisionPayload>(request, requirePlanningContributor, {});
  if (!apiContext.ok) return apiContext.response;
  const decision = validateApprovalDecision(apiContext.payload);
  if (!decision.ok) return decision.response;

  const { id } = await context.params;
  const activeItem = await requireActivePlanningItem(apiContext.supabase, "packages", id);
  if (!activeItem.ok) return apiError(activeItem.error, activeItem.status);
  const { data, error } = await apiContext.supabase.rpc("decide_initiative_approval_transaction", {
    p_initiative_id: id,
    p_expected_revision: decision.expectedRevision,
    p_action: decision.action,
    p_actor_profile_id: apiContext.permission.profile?.id || "",
    p_note: decision.note,
  });
  if (error) return approvalTransactionError(error, "Initiative");
  return NextResponse.json({ ok: true, initiative: mapPackage(data as DbPackage) });
}
