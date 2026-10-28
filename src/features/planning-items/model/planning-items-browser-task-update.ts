import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-response";
import { requirePlanningContext, requirePlanningJsonContext } from "@/features/planning/server/planning-api-context";
import type { TaskUpdatePayload } from "@/features/tasks/model/task-mutation-contract";
import { taskAuditActionFromMessage } from "@/features/tasks/model/task-comment-timeline-policy";
import { rejectClientGitHubSyncStatusUpdate } from "@/features/tasks/model/task-route-update-helpers";
import {
  isPlanningReviewRequestPayload, parsePlanningReviewRequestPayload,
  planningReviewActivitiesFromResult, planningReviewError, planningReviewTaskFromResult,
  requestPlanningReviewCommand,
} from "./planning-items-review";
import {
  changePlanningParentCommand, isPlanningTaskReparentPayload,
  parsePlanningTaskReparentPayload, planningReparentError, planningReparentTaskFromResult,
} from "./planning-items-reparent";
import { auditRequestMetadata } from "@/lib/api-input";
import { mentionedProfileIds } from "@/lib/mentions";
import {
  emptyEpicDeleteCommand, emptyEpicDeleteError, parseEmptyEpicDeletePayload,
} from "./planning-items-empty-epic-delete";

const taskUpdatePayloadFields = new Set<keyof TaskUpdatePayload>([
  "expectedSprintUpdatedAt", "expectedUpdatedAt", "title", "description", "status", "ownerId", "reviewOwnerProfileId",
  "priority", "problemStatement", "intendedOutcome", "scopeConstraints", "acceptanceCriteria",
  "evidenceRequired", "definitionOfDone", "fixedDate", "dependsOn",
  "evidenceLink", "evidenceLinks", "evidenceExceptionNote", "note", "reviewStatus", "scorePoints", "scoreFinal",
  "sprintId", "parentTaskId", "targetDate", "strategy", "raciAssignments", "selfDodChecked",
  "selfEvidenceChecked", "selfDocumentedChecked", "selfBlockersChecked",
]);

export async function handleBrowserTaskUpdate(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const apiContext = await requirePlanningContext(request, "planning.task.update", id, "Änderungen konnten nicht dauerhaft gespeichert werden.");
  if (!apiContext.ok) return apiContext.response;
  const { permission, planning } = apiContext;
  const operationalCorrection = permission.authority?.capabilities.operationalCorrection === true;
  const rawPayload = await request.json() as unknown;
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return apiError("Aufgabenänderung ist ungültig.", 400);
  }
  const githubSyncStatusGuard = rejectClientGitHubSyncStatusUpdate(rawPayload);
  if (!githubSyncStatusGuard.ok) return apiError(githubSyncStatusGuard.error, githubSyncStatusGuard.status);
  const unknownField = Object.keys(rawPayload).find((field) => !taskUpdatePayloadFields.has(field as keyof TaskUpdatePayload));
  if (unknownField) return apiError(`Unbekanntes Feld: ${unknownField}.`, 400);
  const payload = { ...rawPayload } as TaskUpdatePayload;
  if (isPlanningReviewRequestPayload(rawPayload)) {
    if (operationalCorrection) return apiError("Adminzugang darf keine Reviews starten oder finalisieren.", 403);
    const parsed = parsePlanningReviewRequestPayload(rawPayload);
    if (!parsed.ok) return apiError(parsed.error, parsed.status);
    const { data: profiles, error: profilesError } = await planning.readMentionProfiles();
    if (profilesError) return apiError("Erwähnungen konnten nicht aufgelöst werden.", 500);
    const mentionRecipientProfileIds = mentionedProfileIds(
      parsed.value.evidenceExceptionNote,
      (profiles || []).map((profile) => ({ id: profile.id, name: profile.name, githubLogin: profile.github_login })),
    );
    const metadata = auditRequestMetadata(request);
    const result = await planning.runReview({
      command: requestPlanningReviewCommand(id, { ...parsed.value, mentionRecipientProfileIds }),
      requestMetadata: {
        requestIp: metadata.request_ip || undefined,
        userAgent: metadata.user_agent || undefined,
      },
    });
    if (!result.ok) {
      const mapped = planningReviewError(result.error, "request");
      return NextResponse.json({ error: mapped.message, ...(result.error.code === "conflict" && result.error.reason === "revision" ? { conflictReason: "revision" } : {}) }, { status: mapped.status });
    }
    const task = planningReviewTaskFromResult(result);
    if (result.status !== "committed" || !task) return apiError("Aufgabe konnte nicht gespeichert werden.", 500);
    const activities = planningReviewActivitiesFromResult(result).map((activity) => ({
      id: activity.id,
      taskId: activity.taskId,
      action: taskAuditActionFromMessage(activity.message),
      actorProfileId: permission.profile?.id || "",
      message: activity.message,
      beforeData: null,
      afterData: { message: activity.message },
      createdAt: activity.createdAt,
    })).filter((activity) => activity.action);
    return NextResponse.json({ ok: true, activities, task });
  }
  if (isPlanningTaskReparentPayload(rawPayload)) {
    if (operationalCorrection) return apiError("Adminzugang darf keine Parent-Zuordnung umgehen.", 403);
    const parsed = parsePlanningTaskReparentPayload(rawPayload);
    if (!parsed.ok) return apiError(parsed.error, parsed.status);
    const result = await planning.runReparent({
      command: changePlanningParentCommand(id, parsed.value.parentId || null, parsed.value.expectedUpdatedAt),
    });
    if (!result.ok) {
      const mapped = planningReparentError(result.error, "task");
      return NextResponse.json({ error: mapped.message, ...(result.error.code === "conflict" && result.error.reason === "revision" ? { conflictReason: "revision" } : {}) }, { status: mapped.status });
    }
    const task = planningReparentTaskFromResult(result);
    if (result.status !== "committed" || !task) return apiError("Zuordnung konnte nicht gespeichert werden.", 500);
    return NextResponse.json({
      ok: true,
      activities: [],
      task: {
        id,
        parentTaskId: task.parentTaskId || "",
        parentApprovalStatus: task.parentApprovalStatus ?? null,
        approvalStatus: task.approvalStatus ?? null,
        approvalRevision: Number(task.approvalRevision || 1),
        githubIssueSyncStatus: task.githubIssueSyncStatus || "not_synced",
        githubIssueSyncError: task.githubIssueSyncError || "",
        updatedAt: task.updatedAt,
      },
    });
  }
  const result = await planning.revise(payload);
  if (!result.ok) {
    const status = {
      invalidCommand: 400, forbidden: 403, notFound: 404,
      conflict: 409, dependencyUnavailable: 500,
    }[result.error.kind];
    return NextResponse.json({
      ...(result.error.code ? { code: result.error.code } : {}),
      error: result.error.message,
      ...(result.error.conflictReason ? { conflictReason: result.error.conflictReason } : {}),
      ...(result.error.lengthErrors ? { lengthErrors: result.error.lengthErrors } : {}),
    }, { status });
  }
  return NextResponse.json({ ok: true, ...result.value });
}

export async function handleBrowserTaskDelete(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const apiContext = await requirePlanningJsonContext<unknown>(request, "planning.task.delete", null, id);
  if (!apiContext.ok) return apiContext.response;
  const parsed = parseEmptyEpicDeletePayload(apiContext.payload);
  if (!parsed.ok) return apiError(parsed.error, 400);
  const metadata = auditRequestMetadata(request);
  const result = await apiContext.planning.runDelete({
    command: emptyEpicDeleteCommand(id.trim(), parsed.expectedUpdatedAt),
    requestMetadata: {
      requestIp: metadata.request_ip || undefined,
      userAgent: metadata.user_agent || undefined,
    },
  });
  if (!result.ok) {
    const mapped = emptyEpicDeleteError(result.error);
    if (mapped.code && mapped.children) {
      return NextResponse.json({ code: mapped.code, error: mapped.message, children: mapped.children }, { status: mapped.status });
    }
    if (result.error.code === "notFound") return apiError("Epic wurde nicht gefunden.", 404);
    if (result.error.code === "conflict" && result.error.reason === "revision") {
      return apiError("Epic wurde zwischenzeitlich geändert. Bitte neu laden.", 409);
    }
    return NextResponse.json({ error: mapped.message, ...(result.error.code === "conflict" && result.error.reason === "revision" ? { conflictReason: "revision" } : {}) }, { status: mapped.status });
  }
  const item = result.items[0];
  if (!item || item.kind !== "epic") return apiError("Epic konnte nicht gelöscht werden.", 500);
  return NextResponse.json({ ok: true, task: { id: item.id, taskType: "epic", updatedAt: item.updatedAt } });
}
