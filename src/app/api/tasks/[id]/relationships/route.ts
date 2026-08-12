import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { requirePlanningContributor } from "@/lib/authz";
import { actorContextFromSessionAuth } from "@/features/planning-items/model/planning-actor-context-server";
import {
  addPlanningRelationshipCommand,
  createPlanningRelationshipPlanningItems,
  parseAddPlanningRelationshipPayload,
  parseRemovePlanningRelationshipPayload,
  planningRelationshipError,
  planningRelationshipFromResult,
  removePlanningRelationshipCommand,
} from "@/features/planning-items/model/planning-items-relationships";

type RelationshipRouteContext = { params: Promise<{ id: string }> };

function actorFromPermission(permission: {
  profile: { id: string; platformRole: "ceo" | "founder" | "deputy" | "viewer" } | null;
}) {
  return actorContextFromSessionAuth({ ok: true, profile: permission.profile });
}

function requestMetadata(request: NextRequest) {
  const metadata = auditRequestMetadata(request);
  return {
    requestIp: metadata.request_ip || undefined,
    userAgent: metadata.user_agent || undefined,
  };
}

export async function POST(request: NextRequest, context: RelationshipRouteContext) {
  const apiContext = await requireJsonApiContext<unknown>(request, requirePlanningContributor, {});
  if (!apiContext.ok) return apiContext.response;

  const parsed = parseAddPlanningRelationshipPayload(apiContext.payload);
  if (!parsed.ok) return apiError(parsed.error, 400);
  const { id } = await context.params;
  if (parsed.value.relatedTaskId === id) return apiError("Bitte eine andere Aufgabe auswählen.", 400);
  const actor = actorFromPermission(apiContext.permission);
  if (!actor.ok) {
    return apiError("Nur Owner, Accountable, CEO oder Deputy können diese Blocker-Abhängigkeit verwalten.", 403);
  }
  const result = await createPlanningRelationshipPlanningItems(apiContext.supabase).run({
    actor: actor.actor,
    mode: "commit",
    command: addPlanningRelationshipCommand(id, parsed.value),
    requestMetadata: requestMetadata(request),
  });
  if (!result.ok) {
    const mapped = planningRelationshipError(result.error);
    return apiError(mapped.message, mapped.status);
  }
  if (result.status !== "committed") return apiError("Abhängigkeit konnte nicht gespeichert werden.", 500);
  const relation = planningRelationshipFromResult(result);
  if (!relation) return apiError("Abhängigkeit konnte nicht gespeichert werden.", 500);
  return NextResponse.json({ ok: true, relation });
}

export async function DELETE(request: NextRequest, context: RelationshipRouteContext) {
  const apiContext = await requireJsonApiContext<unknown>(request, requirePlanningContributor, {});
  if (!apiContext.ok) return apiContext.response;

  const parsed = parseRemovePlanningRelationshipPayload(apiContext.payload);
  if (!parsed.ok) return apiError(parsed.error, 400);
  const { id } = await context.params;
  const actor = actorFromPermission(apiContext.permission);
  if (!actor.ok) {
    return apiError("Nur Owner, Accountable, CEO oder Deputy können diese Blocker-Abhängigkeit verwalten.", 403);
  }
  const result = await createPlanningRelationshipPlanningItems(apiContext.supabase).run({
    actor: actor.actor,
    mode: "commit",
    command: removePlanningRelationshipCommand(id, parsed.value),
    requestMetadata: requestMetadata(request),
  });
  if (!result.ok) {
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
