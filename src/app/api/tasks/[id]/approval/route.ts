import { NextResponse, type NextRequest } from "next/server";
import { approvalTransactionError, validateApprovalDecision, type ApprovalDecisionPayload } from "@/lib/approval-api";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { requirePlanningContributor } from "@/lib/authz";
import { mapTaskRow } from "@/lib/planning-task-mappers";
import { requireActivePlanningItem } from "@/lib/planning-trash-mutation-guard";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<ApprovalDecisionPayload>(request, requirePlanningContributor, {});
  if (!apiContext.ok) return apiContext.response;
  const decision = validateApprovalDecision(apiContext.payload);
  if (!decision.ok) return decision.response;

  const { id } = await context.params;
  const activeItem = await requireActivePlanningItem(apiContext.supabase, "tasks", id);
  if (!activeItem.ok) return apiError(activeItem.error, activeItem.status);
  const { data, error } = await apiContext.supabase.rpc("decide_deliverable_approval_transaction", {
    p_task_id: id,
    p_expected_revision: decision.expectedRevision,
    p_action: decision.action,
    p_actor_profile_id: apiContext.permission.profile?.id || "",
    p_note: decision.note,
  });
  if (error) return approvalTransactionError(error, "Deliverable");

  const row = data as Record<string, unknown>;
  const profileIds = [row.assignee, row.owner, row.created_by].filter((value): value is string => typeof value === "string" && Boolean(value));
  const { data: profiles } = profileIds.length
    ? await apiContext.supabase.from("profiles").select("id,name").in("id", [...new Set(profileIds)])
    : { data: [] };
  const profileNames = new Map((profiles || []).map((profile: { id: string; name: string }) => [profile.id, profile.name]));
  return NextResponse.json({ ok: true, task: mapTaskRow(row, profileNames) });
}
