import type { NextRequest } from "next/server";
import { handlePlanningItemsRequest, planningItemsError, planningItemsJson } from "@/features/planning-items/model/planning-items-route";
import {
  createTeamCreatePlanningItems,
  parsePlanningItemCreatePayload,
  planningItemCreateCommand,
  planningItemCreateRequiresOperationalLead,
} from "@/features/planning-items/model/planning-items-create";
import { actorContextFromPlanningTokenAuth } from "@/features/planning-items/model/planning-actor-context-server";

export async function POST(request: NextRequest) {
  return handlePlanningItemsRequest(request, "write:planning-items:create", "Planning-Items-Erstellung konnte nicht geprüft werden.", async (permission) => {
    const parsed = parsePlanningItemCreatePayload(await request.json().catch(() => null));
    if (!parsed.ok) return planningItemsError(parsed.error, 400);
    if (parsed.hasLegacyAliases) {
      return planningItemsError("Legacy-Aliase sind nicht mehr zulässig. Verwende itemType epic und parentTaskId.", 400);
    }
    if (parsed.githubSyncMode
      && !permission.scopes.includes("write:planning-items:github-sync")) {
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
      onPreview: (preview) => { items = preview; },
    }).run({
      actor: actor.actor,
      mode: "preview",
      command: planningItemCreateCommand(parsed.items, actor.actor.profileId),
    });
    return planningItemsJson({ ok: true, valid: items.every((item) => !item.errors.length), items });
  });
}
