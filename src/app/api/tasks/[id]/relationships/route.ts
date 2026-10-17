import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError, authzError } from "@/lib/api-response";
import { requirePlanningJsonContext } from "@/features/planning/server/planning-api-context";
import {
  addPlanningRelationshipCommand,
  parseAddPlanningRelationshipPayload,
  parseRemovePlanningRelationshipPayload,
  planningRelationshipError,
  planningRelationshipFromResult,
  removePlanningRelationshipCommand,
} from "@/features/planning-items/model/planning-items-relationships";
import { mentionedProfileIds } from "@/lib/mentions";

type RelationshipRouteContext = { params: Promise<{ id: string }> };

function requestMetadata(request: NextRequest) {
  const metadata = auditRequestMetadata(request);
  return {
    requestIp: metadata.request_ip || undefined,
    userAgent: metadata.user_agent || undefined,
  };
}

export async function POST(request: NextRequest, context: RelationshipRouteContext) {
  const { id } = await context.params;
  const apiContext = await requirePlanningJsonContext<unknown>(request, "planning.relationship.add", {}, id);
  if (!apiContext.ok) return apiContext.response;

  const parsed = parseAddPlanningRelationshipPayload(apiContext.payload);
  if (!parsed.ok) return apiError(parsed.error, 400);
  if (parsed.value.relatedTaskId === id) return apiError("Bitte eine andere Aufgabe auswählen.", 400);
  const administratorAccess = apiContext.permission.authority?.capabilities.operationalCorrection === true;
  let mentionRecipientProfileIds: string[] = [];
  if (parsed.value.note.includes("@")) {
    const profileResult = await apiContext.planning.readMentionProfiles();
    if (profileResult.error) return apiError("Erwähnungen konnten nicht aufgelöst werden.", 500);
    const profileRows = profileResult.data || [];
    mentionRecipientProfileIds = mentionedProfileIds(parsed.value.note, profileRows.map((profile) => ({
      id: profile.id,
      name: profile.name,
      githubLogin: profile.github_login || "",
    })));
  }
  const result = await apiContext.planning.runRelationship({
    command: addPlanningRelationshipCommand(id, parsed.value),
    requestMetadata: requestMetadata(request),
  }, mentionRecipientProfileIds);
  if (!result.ok) {
    if (administratorAccess && result.error.code === "forbidden" && result.error.reason === "administratorAccessRequired") {
      return authzError(await apiContext.planning.failure());
    }
    const mapped = planningRelationshipError(result.error);
    return apiError(mapped.message, mapped.status);
  }
  if (result.status !== "committed") return apiError("Abhängigkeit konnte nicht gespeichert werden.", 500);
  const relation = planningRelationshipFromResult(result);
  if (!relation) return apiError("Abhängigkeit konnte nicht gespeichert werden.", 500);
  return NextResponse.json({ ok: true, relation });
}

export async function DELETE(request: NextRequest, context: RelationshipRouteContext) {
  const { id } = await context.params;
  const apiContext = await requirePlanningJsonContext<unknown>(request, "planning.relationship.remove", {}, id);
  if (!apiContext.ok) return apiContext.response;

  const parsed = parseRemovePlanningRelationshipPayload(apiContext.payload);
  if (!parsed.ok) return apiError(parsed.error, 400);
  const administratorAccess = apiContext.permission.authority?.capabilities.operationalCorrection === true;
  const result = await apiContext.planning.runRelationship({
    command: removePlanningRelationshipCommand(id, parsed.value),
    requestMetadata: requestMetadata(request),
  });
  if (!result.ok) {
    if (administratorAccess && result.error.code === "forbidden" && result.error.reason === "administratorAccessRequired") {
      return authzError(await apiContext.planning.failure());
    }
    if (result.error.code === "dependencyUnavailable") {
      return apiError("Abhängigkeit konnte nicht entfernt werden.", 500);
    }
    const mapped = planningRelationshipError(result.error);
    return apiError(mapped.message, mapped.status);
  }
  if (result.status !== "committed") return apiError("Abhängigkeit konnte nicht entfernt werden.", 500);
  const relation = planningRelationshipFromResult(result);
  if (!relation) return apiError("Abhängigkeit konnte nicht entfernt werden.", 500);
  return NextResponse.json({ ok: true, relationId: relation.id });
}
