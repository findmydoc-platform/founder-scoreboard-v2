import { taskAuditActionFromMessage } from "@/features/tasks/model/task-comment-timeline-policy";
import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError } from "@/lib/api-response";
import { requirePlanningJsonContext } from "@/features/planning/server/planning-api-context";
import { mentionedProfileIds } from "@/lib/mentions";
import {
  decidePlanningReviewCommand,
  parsePlanningReviewDecisionPayload,
  planningReviewActivitiesFromResult,
  planningReviewError,
  planningReviewTaskFromResult,
  planningTaskReviewFromResult,
} from "@/features/planning-items/model/planning-items-review";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const apiContext = await requirePlanningJsonContext<unknown>(request, "planning.review.decide", {}, id);
  if (!apiContext.ok) return apiContext.response;
  const parsed = parsePlanningReviewDecisionPayload(apiContext.payload);
  if (!parsed.ok) return apiError(parsed.error, 400);
  const { data: profiles, error: profilesError } = await apiContext.planning.readMentionProfiles();
  if (profilesError) return apiError("Erwähnungen konnten nicht aufgelöst werden.", 500);
  const mentionRecipientProfileIds = mentionedProfileIds(
    parsed.value.comment,
    (profiles || []).map((profile) => ({ id: profile.id, name: profile.name, githubLogin: profile.github_login })),
  );
  const metadata = auditRequestMetadata(request);
  const result = await apiContext.planning.runReview({
    command: decidePlanningReviewCommand(id, { ...parsed.value, mentionRecipientProfileIds }),
    requestMetadata: {
      requestIp: metadata.request_ip || undefined,
      userAgent: metadata.user_agent || undefined,
    },
  });
  if (!result.ok) {
    const mapped = planningReviewError(result.error, "decide");
    return NextResponse.json({error:mapped.message,...(result.error.code==="conflict"&&result.error.reason==="revision"?{conflictReason:"revision"}:{}),code:result.error.code}, {status:mapped.status});
  }
  const task = planningReviewTaskFromResult(result);
  const review = planningTaskReviewFromResult(result);
  if (result.status !== "committed" || !task || !review) {
    return apiError("Review konnte nicht vollständig gespeichert werden.", 500);
  }
  await apiContext.planning.deliverReviews().catch(() => undefined);
  const activities = planningReviewActivitiesFromResult(result).map(activity=>({ ...activity, action:taskAuditActionFromMessage(activity.message),actorProfileId:apiContext.permission.profile?.id||"",beforeData:null,afterData:{message:activity.message} })).filter(activity=>activity.action);
  return NextResponse.json({ ok: true, activities, review, task });
}
