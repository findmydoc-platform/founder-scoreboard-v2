import { NextResponse, type NextRequest } from "next/server";
import { validateApprovalDecision, type ApprovalDecisionPayload } from "@/lib/approval-api";
import { apiError } from "@/lib/api-response";
import { requirePlanningJsonContext } from "@/features/planning/server/planning-api-context";
import {
  decidePlanningApprovalCommand,
  planningApprovalError,
  planningApprovalTaskFromResult,
} from "@/features/planning-items/model/planning-items-approval";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const apiContext = await requirePlanningJsonContext<ApprovalDecisionPayload>(request, "planning.approval.decide", {}, id);
  if (!apiContext.ok) return apiContext.response;
  const decision = validateApprovalDecision(apiContext.payload);
  if (!decision.ok) return decision.response;
  const { data: item, error: itemError } = await apiContext.planning.readItemKind();
  if (itemError) return apiError("Freigabe konnte nicht geladen werden.", 500);
  if (!item || (item.task_type !== "initiative" && item.task_type !== "deliverable")) {
    return apiError("Planungselement wurde nicht gefunden.", 404);
  }
  const result = await apiContext.planning.runApproval(item.task_type, {
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
    ? await apiContext.planning.approvalLifecycle()
    : null;
  return NextResponse.json({ ok: true, task, lifecycle });
}
