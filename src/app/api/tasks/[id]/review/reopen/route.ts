import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { requirePlanningContributor } from "@/lib/authz";
import { actorContextFromSessionAuth } from "@/features/planning-items/model/planning-actor-context-server";
import {
  createPlanningReviewPlanningItems,
  parsePlanningReviewReopenPayload,
  planningReviewError,
  planningReviewTaskFromResult,
  reopenPlanningReviewCommand,
} from "@/features/planning-items/model/planning-items-review";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<unknown>(request, requirePlanningContributor, {});
  if (!apiContext.ok) return apiContext.response;
  const parsed = parsePlanningReviewReopenPayload(apiContext.payload);
  if (!parsed.ok) return apiError(parsed.error, 400);
  const actor = actorContextFromSessionAuth({ ok: true, profile: apiContext.permission.profile });
  if (!actor.ok) return apiError("Nur Review Owner, CEO oder Deputy können diese Review finalisieren.", 403);
  const { id } = await context.params;
  const metadata = auditRequestMetadata(request);
  const result = await createPlanningReviewPlanningItems(apiContext.supabase).run({
    actor: actor.actor,
    mode: "commit",
    command: reopenPlanningReviewCommand(id, parsed.value.expectedUpdatedAt),
    requestMetadata: {
      requestIp: metadata.request_ip || undefined,
      userAgent: metadata.user_agent || undefined,
    },
  });
  if (!result.ok) {
    const mapped = planningReviewError(result.error, "reopen");
    return apiError(mapped.message, mapped.status);
  }
  const task = planningReviewTaskFromResult(result);
  if (result.status !== "committed" || !task) return apiError("Review konnte nicht vollständig wieder geöffnet werden.", 500);
  return NextResponse.json({ ok: true, task });
}
