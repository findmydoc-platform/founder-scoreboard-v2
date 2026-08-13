import { after, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { actorContextFromPlanningTokenAuth } from "@/features/planning-items/model/planning-actor-context-server";
import { isUuid } from "@/features/planning-items/model/planning-items-contract";
import {
  createTeamCreatePlanningItems,
  parsePlanningItemCreatePayload,
  planningCreateError,
  planningCreateTransactionFromResult,
  planningItemCreateCommand,
  planningItemCreateRequiresOperationalLead,
} from "@/features/planning-items/model/planning-items-create";
import { dispatchAndLoadPlanningGitHubProjections } from "@/features/planning-items/model/planning-items-github-projection";
import {
  handlePlanningItemsRequest,
  planningItemsError,
  planningItemsJson,
} from "@/features/planning-items/model/planning-items-route";
import {
  canonicalTeamApiError,
  type TeamPlanningItemsApiContract,
} from "@/features/planning-items/model/planning-items-team-api-contract";

function parseCreatePayload(payload: unknown, contract: TeamPlanningItemsApiContract) {
  const parsed = parsePlanningItemCreatePayload(payload);
  if (!parsed.ok) return parsed;
  if (!contract.allowLegacyAliases && parsed.hasLegacyAliases) {
    return { ok: false as const, error: canonicalTeamApiError };
  }
  return parsed;
}

export async function handleTeamPlanningItemsCreatePreview(
  request: NextRequest,
  contract: TeamPlanningItemsApiContract,
) {
  return handlePlanningItemsRequest(
    request,
    "write:planning-items:create",
    "Planning-Items-Erstellung konnte nicht geprüft werden.",
    async (permission) => {
      const parsed = parseCreatePayload(await request.json().catch(() => null), contract);
      if (!parsed.ok) return planningItemsError(parsed.error, 400);
      if (parsed.githubSyncMode && !permission.scopes.includes("write:planning-items:github-sync")) {
        return planningItemsError("Planning-API-Token hat nicht den erforderlichen GitHub-Sync-Scope.", 403);
      }
      if (planningItemCreateRequiresOperationalLead(parsed.items)
        && !["ceo", "deputy"].includes(permission.profile.platformRole)) {
        return planningItemsError("Nur CEO oder Deputy können Epics anlegen.", 403);
      }
      const actor = actorContextFromPlanningTokenAuth(permission);
      if (!actor.ok) return planningItemsError("Planning-API-Berechtigung ist nicht mehr gültig.", 403);
      let items: readonly { errors: readonly string[] }[] = [];
      await createTeamCreatePlanningItems({
        supabase: permission.supabase,
        actor: actor.actor,
        tokenId: permission.tokenId,
        rawItems: parsed.items,
        githubSyncMode: parsed.githubSyncMode,
        allowLegacyReferences: contract.allowLegacyItemIds,
        minimumReplayContractVersion: contract.minimumReplayContractVersion,
        onPreview: (preview) => { items = preview; },
      }).run({
        actor: actor.actor,
        mode: "preview",
        command: planningItemCreateCommand(parsed.items, actor.actor.profileId),
      });
      return planningItemsJson({ ok: true, valid: items.every((item) => !item.errors.length), items });
    },
  );
}

export async function handleTeamPlanningItemsCreate(
  request: NextRequest,
  contract: TeamPlanningItemsApiContract,
) {
  return handlePlanningItemsRequest(
    request,
    "write:planning-items:create",
    "Planning-Items-Erstellung konnte nicht gespeichert werden.",
    async (permission) => {
      const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
      if (!isUuid(idempotencyKey)) {
        return planningItemsError("Gültiger UUID-Idempotency-Key ist erforderlich.", 400);
      }
      const parsed = parseCreatePayload(await request.json().catch(() => null), contract);
      if (!parsed.ok) return planningItemsError(parsed.error, 400);
      if (parsed.githubSyncMode && !permission.scopes.includes("write:planning-items:github-sync")) {
        return planningItemsError("Planning-API-Token hat nicht den erforderlichen GitHub-Sync-Scope.", 403);
      }
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
        allowLegacyReferences: contract.allowLegacyItemIds,
        minimumReplayContractVersion: contract.minimumReplayContractVersion,
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
