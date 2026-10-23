import { observeRuntimePreparation } from "@/lib/runtime-logging";
import { NextResponse, type NextRequest } from "next/server";
import { apiError, authzError } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";
import type { ResourceReadAction } from "@/lib/credentials/resource-types";

const labels: Record<ResourceReadAction, string> = {
  "events.read": "Termine und Erinnerungen", "tools.read": "Links und Tools", "team.read": "Team",
  "notifications.read": "Benachrichtigungen", "strategic.read": "Strategische Planung",
};
export async function supportingWorkspaceGet(request: NextRequest, action: ResourceReadAction) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action });
  if (!permission.ok) return authzError(permission);
  const result = await permission.resource.loadWorkspace();
  if (result.status === "forbidden") return apiError(`${labels[action]} darf nicht geladen werden.`, 403);
  if (result.status === "unavailable") return apiError(`${labels[action]} konnte nicht geladen werden.`, 503);
  return observeRuntimePreparation(() => NextResponse.json({ model: result.model, headerData: result.headerData, currentProfile: permission.profile }));
}
