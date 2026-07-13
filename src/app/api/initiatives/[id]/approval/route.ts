import { NextResponse, type NextRequest } from "next/server";
import { approvalTransactionError, validateApprovalDecision, type ApprovalDecisionPayload } from "@/lib/approval-api";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { requirePlanningContributor } from "@/lib/authz";
import { mapPackage } from "@/lib/planning-profile-mappers";
import type { DbPackage } from "@/lib/planning-data-row-types";
import { attemptPlanningGitHubLifecycleDrain, loadOutstandingPlanningGitHubLifecycleTaskIds } from "@/lib/planning-github-lifecycle-trigger";
import { requireActivePlanningItem } from "@/lib/planning-trash-mutation-guard";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<ApprovalDecisionPayload>(request, requirePlanningContributor, {});
  if (!apiContext.ok) return apiContext.response;
  const decision = validateApprovalDecision(apiContext.payload);
  if (!decision.ok) return decision.response;

  const { id } = await context.params;
  const serviceSupabase = getServerServiceRoleSupabase();
  if (!serviceSupabase) return apiError("Server-Service für Freigaben ist nicht konfiguriert.", 503);
  const activeItem = await requireActivePlanningItem(serviceSupabase, "packages", id);
  if (!activeItem.ok) return apiError(activeItem.error, activeItem.status);
  const { data, error } = await serviceSupabase.rpc("decide_initiative_approval_transaction", {
    p_initiative_id: id,
    p_expected_revision: decision.expectedRevision,
    p_action: decision.action,
    p_actor_profile_id: apiContext.permission.profile?.id || "",
    p_note: decision.note,
  });
  if (error) return approvalTransactionError(error, "Initiative");
  const lifecycleScope = await loadOutstandingPlanningGitHubLifecycleTaskIds(serviceSupabase, "initiative", id);
  const lifecycle = lifecycleScope.error
    ? { attempted: false, completed: false, error: lifecycleScope.error }
    : await attemptPlanningGitHubLifecycleDrain({
        rootType: "initiative",
        rootId: id,
        taskIds: lifecycleScope.taskIds,
        supabase: serviceSupabase,
      });
  return NextResponse.json({ ok: true, initiative: mapPackage(data as DbPackage), lifecycle });
}
