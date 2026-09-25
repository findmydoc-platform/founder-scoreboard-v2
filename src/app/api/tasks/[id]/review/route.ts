import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { requirePlanningContributor } from "@/lib/authz";
import { mentionedProfileIds } from "@/lib/mentions";
import { deliverPendingGitHubReviews } from "@/lib/github-review-delivery";
import { actorContextFromSessionAuth } from "@/features/planning-items/model/planning-actor-context-server";
import {
  createPlanningReviewPlanningItems,
  decidePlanningReviewCommand,
  parsePlanningReviewDecisionPayload,
  planningReviewError,
  planningReviewTaskFromResult,
  planningTaskReviewFromResult,
} from "@/features/planning-items/model/planning-items-review";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<unknown>(request, requirePlanningContributor, {});
  if (!apiContext.ok) return apiContext.response;
  const parsed = parsePlanningReviewDecisionPayload(apiContext.payload);
  if (!parsed.ok) return apiError(parsed.error, 400);
  const actor = actorContextFromSessionAuth({ ok: true, profile: apiContext.permission.profile });
  if (!actor.ok) return apiError("Nur Review Owner, CEO oder Deputy können diese Review finalisieren.", 403);
  const { id } = await context.params;
  const { data: profiles, error: profilesError } = await apiContext.supabase
    .from("profiles")
    .select("id,name,github_login");
  if (profilesError) return apiError("Erwähnungen konnten nicht aufgelöst werden.", 500);
  const mentionRecipientProfileIds = mentionedProfileIds(
    parsed.value.comment,
    (profiles || []).map((profile) => ({ id: profile.id, name: profile.name, githubLogin: profile.github_login })),
  );
  const metadata = auditRequestMetadata(request);
  const result = await createPlanningReviewPlanningItems(apiContext.supabase).run({
    actor: actor.actor,
    mode: "commit",
    command: decidePlanningReviewCommand(id, { ...parsed.value, mentionRecipientProfileIds }),
    requestMetadata: {
      requestIp: metadata.request_ip || undefined,
      userAgent: metadata.user_agent || undefined,
    },
  });
  if (!result.ok) {
    const mapped = planningReviewError(result.error, "decide");
    return apiError(mapped.message, mapped.status);
  }
  const task = planningReviewTaskFromResult(result);
  const review = planningTaskReviewFromResult(result);
  if (result.status !== "committed" || !task || !review) {
    return apiError("Review konnte nicht vollständig gespeichert werden.", 500);
  }
  await deliverPendingGitHubReviews({ supabase: apiContext.supabase, taskId: id, limit: 20 }).catch(() => undefined);
  return NextResponse.json({ ok: true, review, task });
}
