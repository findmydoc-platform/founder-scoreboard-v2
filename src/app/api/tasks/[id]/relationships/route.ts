import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError, authzError, requireJsonApiContext } from "@/lib/api-response";
import {
  bearerToken,
  requirePlanningContributorOrActiveAdministrator,
  resolveAdministratorAccessFailure,
} from "@/lib/authz";
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
import { getSupabaseForToken } from "@/lib/supabase";
import { mentionedProfileIds } from "@/lib/mentions";

type RelationshipRouteContext = { params: Promise<{ id: string }> };

function actorFromPermission(permission: {
  profile: { id: string; platformRole: "ceo" | "founder" | "deputy" | "viewer" } | null;
  authority?: { capabilities: { operationalCorrection: boolean } };
}) {
  return actorContextFromSessionAuth({ ok: true, profile: permission.profile, authority: permission.authority });
}

function requestMetadata(request: NextRequest) {
  const metadata = auditRequestMetadata(request);
  return {
    requestIp: metadata.request_ip || undefined,
    userAgent: metadata.user_agent || undefined,
  };
}

export async function POST(request: NextRequest, context: RelationshipRouteContext) {
  const apiContext = await requireJsonApiContext<unknown>(request, requirePlanningContributorOrActiveAdministrator, {});
  if (!apiContext.ok) return apiContext.response;

  const parsed = parseAddPlanningRelationshipPayload(apiContext.payload);
  if (!parsed.ok) return apiError(parsed.error, 400);
  const { id } = await context.params;
  if (parsed.value.relatedTaskId === id) return apiError("Bitte eine andere Aufgabe auswählen.", 400);
  const actor = actorFromPermission(apiContext.permission);
  if (!actor.ok) {
    return apiError("Nur Owner, Accountable, CEO oder Deputy können diese Blocker-Abhängigkeit verwalten.", 403);
  }
  const administratorAccess = apiContext.permission.authority?.capabilities.operationalCorrection === true;
  const mutationClient = administratorAccess ? getSupabaseForToken(bearerToken(request)) : apiContext.supabase;
  if (!mutationClient) return apiError("Anmeldung erforderlich.", 401);
  let mentionRecipientProfileIds: string[] = [];
  if (parsed.value.note.includes("@")) {
    const profileResult = administratorAccess
      ? await mutationClient.rpc("administrator_directory_snapshot")
      : await apiContext.supabase.from("profiles").select("id,name,github_login");
    if (profileResult.error) return apiError("Erwähnungen konnten nicht aufgelöst werden.", 500);
    const profileRows = administratorAccess
      ? (((profileResult.data || {}) as { people?: Array<{ id: string; name: string; githubLogin?: string }> }).people || []).map((profile) => ({
        id: profile.id,
        name: profile.name,
        github_login: profile.githubLogin || "",
      }))
      : (profileResult.data || []) as Array<{ id: string; name: string; github_login?: string | null }>;
    mentionRecipientProfileIds = mentionedProfileIds(parsed.value.note, profileRows.map((profile) => ({
      id: profile.id,
      name: profile.name,
      githubLogin: profile.github_login || "",
    })));
  }
  const result = await createPlanningRelationshipPlanningItems(apiContext.supabase, {
    mutationClient,
    administratorAccess,
    mentionRecipientProfileIds,
  }).run({
    actor: actor.actor,
    mode: "commit",
    command: addPlanningRelationshipCommand(id, parsed.value),
    requestMetadata: requestMetadata(request),
  });
  if (!result.ok) {
    if (administratorAccess && result.error.code === "forbidden" && result.error.reason === "administratorAccessRequired") {
      return authzError(await resolveAdministratorAccessFailure(mutationClient));
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
  const apiContext = await requireJsonApiContext<unknown>(request, requirePlanningContributorOrActiveAdministrator, {});
  if (!apiContext.ok) return apiContext.response;

  const parsed = parseRemovePlanningRelationshipPayload(apiContext.payload);
  if (!parsed.ok) return apiError(parsed.error, 400);
  const { id } = await context.params;
  const actor = actorFromPermission(apiContext.permission);
  if (!actor.ok) {
    return apiError("Nur Owner, Accountable, CEO oder Deputy können diese Blocker-Abhängigkeit verwalten.", 403);
  }
  const administratorAccess = apiContext.permission.authority?.capabilities.operationalCorrection === true;
  const mutationClient = administratorAccess ? getSupabaseForToken(bearerToken(request)) : apiContext.supabase;
  if (!mutationClient) return apiError("Anmeldung erforderlich.", 401);
  const result = await createPlanningRelationshipPlanningItems(apiContext.supabase, {
    mutationClient,
    administratorAccess,
  }).run({
    actor: actor.actor,
    mode: "commit",
    command: removePlanningRelationshipCommand(id, parsed.value),
    requestMetadata: requestMetadata(request),
  });
  if (!result.ok) {
    if (administratorAccess && result.error.code === "forbidden" && result.error.reason === "administratorAccessRequired") {
      return authzError(await resolveAdministratorAccessFailure(mutationClient));
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
