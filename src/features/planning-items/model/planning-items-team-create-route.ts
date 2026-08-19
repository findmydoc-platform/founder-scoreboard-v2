import { after, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { actorContextFromPlanningTokenAuth } from "@/features/planning-items/model/planning-actor-context-server";
import { isUuid } from "@/features/planning-items/model/planning-items-contract";
import {
  createTeamCreatePlanningItems,
  parsePlanningItemCreatePayload,
  planningCreateError,
  planningCreateTokenBecameInactive,
  planningCreateTransactionFromResult,
  planningItemCreateCommand,
  planningItemCreateRequiresOperationalLead,
} from "@/features/planning-items/model/planning-items-create";
import { dispatchAndLoadPlanningGitHubProjections } from "@/features/planning-items/model/planning-items-github-projection";
import {
  handlePlanningItemsRequest,
  planningItemsError,
  planningItemsJson,
  planningItemsTokenInactiveError,
} from "@/features/planning-items/model/planning-items-route";
function parseCreatePayload(payload: unknown) {
  return parsePlanningItemCreatePayload(payload);
}

export async function handleTeamPlanningItemsCreatePreview(
  request: NextRequest,
) {
  let parsed: ReturnType<typeof parseCreatePayload> | undefined;
  const parseRequest = async () => {
    parsed ??= parseCreatePayload(await request.json().catch(() => null));
    return parsed;
  };
  return handlePlanningItemsRequest(
    request,
    {
      operation: "planningItems.create",
      mode: "preview",
      requiredScopes: ["write:planning-items:create"],
      resolveAdditionalScopes: async () => {
        const payload = await parseRequest();
        return payload.ok && payload.githubSyncMode
          ? ["write:planning-items:github-sync"]
          : [];
      },
    },
    "Planning-Items-Erstellung konnte nicht geprüft werden.",
    async (permission) => {
      const parsed = await parseRequest();
      if (!parsed.ok) return planningItemsError(parsed.error, 400);
      if (planningItemCreateRequiresOperationalLead(parsed.items)
        && !["ceo", "deputy"].includes(permission.profile.platformRole)) {
        return planningItemsError("Nur CEO oder Deputy können Epics anlegen.", 403);
      }
      const actor = actorContextFromPlanningTokenAuth(permission);
      if (!actor.ok) return planningItemsError("Planning-API-Berechtigung ist nicht mehr gültig.", 403);
      let items: readonly { errors: readonly string[] }[] | undefined;
      const result = await createTeamCreatePlanningItems({
        supabase: permission.supabase,
        actor: actor.actor,
        tokenId: permission.tokenId,
        rawItems: parsed.items,
        githubSyncMode: parsed.githubSyncMode,
        onPreview: (preview) => { items = preview; },
      }).run({
        actor: actor.actor,
        mode: "preview",
        command: planningItemCreateCommand(parsed.items, actor.actor.profileId),
      });
      if (!result.ok && result.error.code !== "invalidCommand") {
        const mapped = planningCreateError(result.error);
        return planningItemsError(mapped.message, mapped.status);
      }
      if (!items) {
        return planningItemsError("Planning-Items-Erstellung konnte nicht geprüft werden.", 500);
      }
      return planningItemsJson({ ok: true, valid: items.every((item) => !item.errors.length), items });
    },
  );
}

export async function handleTeamPlanningItemsCreate(
  request: NextRequest,
) {
  let parsed: ReturnType<typeof parseCreatePayload> | undefined;
  const parseRequest = async () => {
    parsed ??= parseCreatePayload(await request.json().catch(() => null));
    return parsed;
  };
  return handlePlanningItemsRequest(
    request,
    {
      operation: "planningItems.create",
      mode: "commit",
      requiredScopes: ["write:planning-items:create"],
      resolveAdditionalScopes: async () => {
        const payload = await parseRequest();
        return payload.ok && payload.githubSyncMode
          ? ["write:planning-items:github-sync"]
          : [];
      },
    },
    "Planning-Items-Erstellung konnte nicht gespeichert werden.",
    async (permission) => {
      const parsed = await parseRequest();
      const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
      if (!isUuid(idempotencyKey)) {
        return planningItemsError("Gültiger UUID-Idempotency-Key ist erforderlich.", 400);
      }
      if (!parsed.ok) return planningItemsError(parsed.error, 400);
      if (planningItemCreateRequiresOperationalLead(parsed.items)
        && !["ceo", "deputy"].includes(permission.profile.platformRole)) {
        return planningItemsError("Nur CEO oder Deputy können Epics anlegen.", 403);
      }
      const actor = actorContextFromPlanningTokenAuth(permission);
      if (!actor.ok) return planningItemsError("Planning-API-Berechtigung ist nicht mehr gültig.", 403);
      let previewItems: readonly unknown[] | undefined;
      const planningItems = createTeamCreatePlanningItems({
        supabase: permission.supabase,
        actor: actor.actor,
        tokenId: permission.tokenId,
        rawItems: parsed.items,
        githubSyncMode: parsed.githubSyncMode,
        scheduleAfter: (callback) => after(callback),
        dispatchGitHubProjections: dispatchAndLoadPlanningGitHubProjections,
        onPreview: (items) => { previewItems = items; },
      });
      const metadata = auditRequestMetadata(request);
      const result = await planningItems.run({
        actor: actor.actor,
        mode: "commit",
        command: planningItemCreateCommand(parsed.items, actor.actor.profileId),
        idempotencyKey,
        requestMetadata: {
          requestIp: metadata.request_ip || undefined,
          userAgent: metadata.user_agent || undefined,
        },
      });
      if (!result.ok) {
        if (planningCreateTokenBecameInactive(result.error)) {
          return planningItemsTokenInactiveError();
        }
        const mapped = planningCreateError(result.error);
        if (mapped.issues) {
          return planningItemsJson({ ok: false, error: mapped.message, items: previewItems }, mapped.status);
        }
        return planningItemsError(mapped.message, mapped.status);
      }
      const transaction = planningCreateTransactionFromResult(result);
      if (!transaction) {
        return planningItemsError("Planning-Items-Erstellung konnte nicht gespeichert werden.", 500);
      }
      return planningItemsJson({
        ok: true,
        ...transaction,
        replayed: result.status === "committed" && result.replayed,
      });
    },
  );
}
