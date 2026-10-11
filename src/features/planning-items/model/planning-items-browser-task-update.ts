import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiContext, requireJsonApiContext } from "@/lib/api-response";
import { bearerToken, requirePlanningContributorOrActiveAdministrator, requireOperationalLead } from "@/lib/authz";
import type { TaskUpdatePayload } from "@/features/tasks/model/task-mutation-contract";
import { taskAuditActionFromMessage } from "@/features/tasks/model/task-comment-timeline-policy";
import { rejectClientGitHubSyncStatusUpdate } from "@/features/tasks/model/task-route-update-helpers";
import { actorContextFromSessionAuth } from "./planning-actor-context-server";
import { createPlanningItemRevision } from "./planning-item-revision";
import {
  createPlanningReviewPlanningItems, isPlanningReviewRequestPayload, parsePlanningReviewRequestPayload,
  planningReviewActivitiesFromResult, planningReviewError, planningReviewTaskFromResult,
  requestPlanningReviewCommand,
} from "./planning-items-review";
import {
  changePlanningParentCommand, createPlanningReparentPlanningItems, isPlanningTaskReparentPayload,
  parsePlanningTaskReparentPayload, planningReparentError, planningReparentTaskFromResult,
} from "./planning-items-reparent";
import { auditRequestMetadata } from "@/lib/api-input";
import { mentionedProfileIds } from "@/lib/mentions";
import { getSupabaseForToken } from "@/lib/supabase-user";
import {
  createEmptyEpicDeletePlanningItems, emptyEpicDeleteCommand, emptyEpicDeleteError, parseEmptyEpicDeletePayload,
} from "./planning-items-empty-epic-delete";

const taskUpdatePayloadFields = new Set<keyof TaskUpdatePayload>([
  "expectedUpdatedAt", "title", "description", "status", "ownerId", "reviewOwnerProfileId",
  "priority", "problemStatement", "intendedOutcome", "scopeConstraints", "acceptanceCriteria",
  "evidenceRequired", "definitionOfDone", "fixedDate", "dependsOn",
  "evidenceLink", "evidenceLinks", "evidenceExceptionNote", "note", "reviewStatus", "scorePoints", "scoreFinal",
  "sprintId", "parentTaskId", "targetDate", "strategy", "raciAssignments", "selfDodChecked",
  "selfEvidenceChecked", "selfDocumentedChecked", "selfBlockersChecked",
]);

export async function handleBrowserTaskUpdate(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireApiContext(request, requirePlanningContributorOrActiveAdministrator, {
    supabaseUnavailableMessage: "Änderungen konnten nicht dauerhaft gespeichert werden.",
  });
  if (!apiContext.ok) return apiContext.response;

  const { permission } = apiContext;
  const operationalCorrection = permission.authority?.capabilities.operationalCorrection === true;
  const supabase = operationalCorrection
    ? getSupabaseForToken(bearerToken(request))
    : apiContext.supabase;
  if (!supabase) return apiError("Anmeldung erforderlich.", 401);

  const { id } = await context.params;
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
    const actor = actorContextFromSessionAuth(permission);
    if (!actor.ok) return apiError("Founder können nur den Status ihrer eigenen Aufgaben ändern.", 403);
    const { data: profiles, error: profilesError } = await supabase.from("profiles").select("id,name,github_login");
    if (profilesError) return apiError("Erwähnungen konnten nicht aufgelöst werden.", 500);
    const mentionRecipientProfileIds = mentionedProfileIds(
      parsed.value.evidenceExceptionNote,
      (profiles || []).map((profile) => ({ id: profile.id, name: profile.name, githubLogin: profile.github_login })),
    );
    const metadata = auditRequestMetadata(request);
    const result = await createPlanningReviewPlanningItems(supabase).run({
      actor: actor.actor,
      mode: "commit",
      command: requestPlanningReviewCommand(id, { ...parsed.value, mentionRecipientProfileIds }),
      requestMetadata: {
        requestIp: metadata.request_ip || undefined,
        userAgent: metadata.user_agent || undefined,
      },
    });
    if (!result.ok) {
      const mapped = planningReviewError(result.error, "request");
      return apiError(mapped.message, mapped.status);
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
    const actor = actorContextFromSessionAuth(permission);
    if (!actor.ok) return apiError("Zuordnung konnte nicht gespeichert werden.", 403);
    const result = await createPlanningReparentPlanningItems(supabase, "any").run({
      actor: actor.actor,
      mode: "commit",
      command: changePlanningParentCommand(id, parsed.value.parentId || null, parsed.value.expectedUpdatedAt),
    });
    if (!result.ok) {
      const mapped = planningReparentError(result.error, "task");
      return apiError(mapped.message, mapped.status);
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
  const result = await createPlanningItemRevision(supabase).commitBrowserRevision({ itemId: id, payload, permission });
  if (!result.ok) {
    const status = {
      invalidCommand: 400, forbidden: 403, notFound: 404,
      conflict: 409, dependencyUnavailable: 500,
    }[result.error.kind];
    return NextResponse.json({
      ...(result.error.code ? { code: result.error.code } : {}),
      error: result.error.message,
      ...(result.error.lengthErrors ? { lengthErrors: result.error.lengthErrors } : {}),
    }, { status });
  }
  return NextResponse.json({ ok: true, ...result.value });
}

export async function handleBrowserTaskDelete(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const apiContext = await requireJsonApiContext<unknown>(request, requireOperationalLead, null);
  if (!apiContext.ok) return apiContext.response;
  const parsed = parseEmptyEpicDeletePayload(apiContext.payload);
  if (!parsed.ok) return apiError(parsed.error, 400);
  const actor = actorContextFromSessionAuth({ ok: true, profile: apiContext.permission.profile });
  if (!actor.ok) return apiError("Nur CEO oder Deputy können Epics löschen.", 403);
  const { id } = await context.params;
  const metadata = auditRequestMetadata(request);
  const result = await createEmptyEpicDeletePlanningItems(apiContext.supabase).run({
    actor: actor.actor,
    mode: "commit",
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
    return apiError(mapped.message, mapped.status);
  }
  const item = result.items[0];
  if (!item || item.kind !== "epic") return apiError("Epic konnte nicht gelöscht werden.", 500);
  return NextResponse.json({ ok: true, task: { id: item.id, taskType: "epic", updatedAt: item.updatedAt } });
}
