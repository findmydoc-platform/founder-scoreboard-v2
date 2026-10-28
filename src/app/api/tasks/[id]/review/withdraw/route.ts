import { taskAuditActionFromMessage } from "@/features/tasks/model/task-comment-timeline-policy";
import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError } from "@/lib/api-response";
import { requirePlanningJsonContext } from "@/features/planning/server/planning-api-context";
import { mentionedProfileIds } from "@/lib/mentions";
import {
  parsePlanningReviewWithdrawPayload,
  planningReviewActivitiesFromResult,
  planningReviewError,
  planningReviewTaskFromResult,
  withdrawPlanningReviewCommand,
} from "@/features/planning-items/model/planning-items-review";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const apiContext = await requirePlanningJsonContext<unknown>(request, "planning.review.withdraw", {}, id);
  if (!apiContext.ok) return apiContext.response;
  const parsed = parsePlanningReviewWithdrawPayload(apiContext.payload);
  if (!parsed.ok) return apiError(parsed.error, 400);
  const { data: profiles, error: profilesError } = await apiContext.planning.readMentionProfiles();
  if (profilesError) return apiError("Erwähnungen konnten nicht aufgelöst werden.", 500);
  const mentionRecipientProfileIds = mentionedProfileIds(
    parsed.value.reason,
    (profiles || []).map((profile) => ({ id: profile.id, name: profile.name, githubLogin: profile.github_login })),
  );
  const metadata = auditRequestMetadata(request);
  const result = await apiContext.planning.runReview({
    command: withdrawPlanningReviewCommand(id, parsed.value.expectedUpdatedAt, parsed.value.reason, mentionRecipientProfileIds),
    requestMetadata: {
      requestIp: metadata.request_ip || undefined,
      userAgent: metadata.user_agent || undefined,
    },
  });
  if (!result.ok) {
    const mapped = planningReviewError(result.error, "withdraw");
    return NextResponse.json({error:mapped.message,...(result.error.code==="conflict"&&result.error.reason==="revision"?{conflictReason:"revision"}:{}),code:result.error.code}, {status:mapped.status});
  }
  const task = planningReviewTaskFromResult(result);
  if (result.status !== "committed" || !task) return apiError("Review konnte nicht zurückgezogen werden.", 500);
  const activities = planningReviewActivitiesFromResult(result).map(activity=>({ ...activity, action:taskAuditActionFromMessage(activity.message),actorProfileId:apiContext.permission.profile?.id||"",beforeData:null,afterData:{message:activity.message} })).filter(activity=>activity.action);
  return NextResponse.json({ ok: true, activities, task });
}
