import { NextResponse, type NextRequest } from "next/server";
import { validateApprovalDecision, type ApprovalDecisionPayload } from "@/lib/approval-api";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { requirePlanningContributor } from "@/lib/authz";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";
import { actorContextFromSessionAuth } from "@/features/planning-items/model/planning-actor-context-server";
import {
  createPlanningApprovalPlanningItems,
  decidePlanningApprovalCommand,
  planningApprovalError,
  planningApprovalTaskFromResult,
  runPlanningApprovalLifecycle,
} from "@/features/planning-items/model/planning-items-approval";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<ApprovalDecisionPayload>(request, requirePlanningContributor, {});
  if (!apiContext.ok) return apiContext.response;
  const decision = validateApprovalDecision(apiContext.payload);
  if (!decision.ok) return decision.response;
  const actor = actorContextFromSessionAuth({ ok: true, profile: apiContext.permission.profile });
  if (!actor.ok) return apiError("only ceo or deputy may decide planning approval", 403);
  const serviceSupabase = getServerServiceRoleSupabase();
  if (!serviceSupabase) return apiError("Server-Service für Freigaben ist nicht konfiguriert.", 503);
  const { id } = await context.params;
  const { data: item, error: itemError } = await serviceSupabase
    .from("tasks")
    .select("task_type")
    .eq("id", id)
    .maybeSingle<{ task_type: string }>();
  if (itemError) return apiError("Freigabe konnte nicht geladen werden.", 500);
  if (!item || (item.task_type !== "initiative" && item.task_type !== "deliverable")) {
    return apiError("Planungselement wurde nicht gefunden.", 404);
  }
  const result = await createPlanningApprovalPlanningItems(serviceSupabase, item.task_type).run({
    actor: actor.actor,
    mode: "commit",
    command: decidePlanningApprovalCommand(id, {
      expectedApprovalRevision: decision.expectedRevision,
      action: decision.action,
      note: decision.note || "",
    }),
  });
  if (!result.ok) {
    const mapped = planningApprovalError(result.error, item.task_type === "initiative" ? "Initiative" : "Deliverable");
    return apiError(mapped.message, mapped.status);
  }
  const task = planningApprovalTaskFromResult(result);
  if (result.status !== "committed" || !task) return apiError("Freigabe konnte nicht gespeichert werden.", 500);
  const lifecycle = item.task_type === "deliverable"
    ? await runPlanningApprovalLifecycle(serviceSupabase, task.id)
    : null;
  return NextResponse.json({ ok: true, task, lifecycle });
}
