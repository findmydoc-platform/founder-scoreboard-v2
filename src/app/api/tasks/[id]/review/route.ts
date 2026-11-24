import { taskAuditActionFromMessage } from "@/features/tasks/model/task-comment-timeline-policy";
import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError } from "@/lib/api-response";
import { requirePlanningContext, requirePlanningJsonContext } from "@/features/planning/server/planning-api-context";
import { mentionedProfileIds } from "@/lib/mentions";
import {
  decidePlanningReviewCommand,
  parsePlanningReviewDecisionPayload,
  planningReviewActivitiesFromResult,
  planningReviewError,
  planningReviewTaskFromResult,
  planningTaskReviewFromResult,
} from "@/features/planning-items/model/planning-items-review";

const noStore = { "Cache-Control": "private, no-store" };

const reviewBasisFailures = {
  forbidden: { status: 403, code: "review_basis_denied", error: "Diese Review-Grundlage ist nicht verfügbar." },
  notFound: { status: 404, code: "review_target_not_found", error: "Das Deliverable wurde nicht gefunden." },
  stale: { status: 409, code: "stale_review_basis", error: "Die Review-Grundlage hat sich geändert. Bitte aktualisieren." },
  unavailable: { status: 503, code: "review_basis_unavailable", error: "Die Review-Grundlage konnte nicht vollständig geprüft werden." },
} as const;

function reviewBasisFailure(status: keyof typeof reviewBasisFailures) {
  const failure = reviewBasisFailures[status];
  return NextResponse.json({ code: failure.code, error: failure.error }, { status: failure.status, headers: noStore });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const apiContext = await requirePlanningContext(request, "planning.review.basis.read", id);
  if (!apiContext.ok) return apiContext.response;
  const result = await apiContext.planning.loadDeliverableReviewBasis(request.signal);
  return result.status === "ready"
    ? NextResponse.json({ ok: true, basis: result.basis }, { headers: noStore })
    : reviewBasisFailure(result.status);
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const apiContext = await requirePlanningJsonContext<unknown>(request, "planning.review.decide", {}, id);
  if (!apiContext.ok) return apiContext.response;
  const parsed = parsePlanningReviewDecisionPayload(apiContext.payload);
  if (!parsed.ok) return apiError(parsed.error, 400);
  const decisionBasis = apiContext.payload && typeof apiContext.payload === "object" && "decisionBasis" in apiContext.payload
    ? apiContext.payload.decisionBasis : undefined;
  if (decisionBasis !== undefined && (typeof decisionBasis !== "string" || decisionBasis.length > 4096)) {
    return reviewBasisFailure("stale");
  }
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
  }, decisionBasis);
  if (!result.ok) {
    if (result.error.code === "conflict" && result.error.reason === "state") {
      const reason = result.error.details?.planningReviewReason;
      if (reason === "staleBasis" || (decisionBasis !== undefined && (reason === "sprintLocked" || reason === "evidenceRequired"
        || reason === "notActive" || reason === "notApproved" || reason === "trashed" || reason === "completed"))) return reviewBasisFailure("stale");
    }
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
