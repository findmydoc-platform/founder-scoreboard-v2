import { NextResponse, type NextRequest } from "next/server";
import { approvalTransactionError, validateApprovalDecision, type ApprovalDecisionPayload } from "@/lib/approval-api";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { requirePlanningContributor } from "@/lib/authz";
import {
  legacyInitiativeFromCanonical,
  loadCanonicalStrategicItem,
} from "@/features/projects/model/planning-legacy-adapters";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<ApprovalDecisionPayload>(request, requirePlanningContributor, {});
  if (!apiContext.ok) return apiContext.response;
  const decision = validateApprovalDecision(apiContext.payload);
  if (!decision.ok) return decision.response;

  const { id } = await context.params;
  const serviceSupabase = getServerServiceRoleSupabase();
  if (!serviceSupabase) return apiError("Server-Service für Freigaben ist nicht konfiguriert.", 503);
  const current = await loadCanonicalStrategicItem(serviceSupabase, id, "initiative");
  if (!current) return apiError("Initiative wurde nicht gefunden.", 404);

  const { error } = await serviceSupabase.rpc("decide_planning_item_approval_transaction", {
    p_task_id: current.id,
    p_expected_revision: decision.expectedRevision,
    p_action: decision.action,
    p_actor_profile_id: apiContext.permission.profile?.id || "",
    p_note: decision.note,
  });
  if (error) return approvalTransactionError(error, "Initiative");

  const updated = await loadCanonicalStrategicItem(serviceSupabase, current.id, "initiative");
  if (!updated) return apiError("Initiative konnte nicht geladen werden.", 500);
  // Strategic items deliberately have no GitHub lifecycle drain or delivery
  // notification side effect.
  return NextResponse.json({ ok: true, initiative: legacyInitiativeFromCanonical(updated), lifecycle: null });
}
