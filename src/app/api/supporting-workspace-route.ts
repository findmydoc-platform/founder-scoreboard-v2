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
  let eventsRange: import("@/features/events/model/event-state").EventRange | null = null;
  if (action === "events.read") {
    const params = new URL(request.url).searchParams, from = params.get("from"), to = params.get("to");
    if (from !== null || to !== null) {
      const start = from ? new Date(from) : null, end = to ? new Date(to) : null;
      if (!start || !end || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) return apiError("Ein gültiger Event-Zeitraum mit Start und Ende ist erforderlich.", 400);
      eventsRange = { from: start.toISOString(), to: end.toISOString() };
    }
  }
  const result = await permission.resource.loadWorkspace({ eventsRange });
  if (result.status === "forbidden") return apiError(`${labels[action]} darf nicht geladen werden.`, 403);
  if (result.status === "unavailable") return apiError(`${labels[action]} konnte nicht geladen werden.`, 503);
  return observeRuntimePreparation(() => NextResponse.json({ model: result.model, headerData: result.headerData, currentProfile: permission.profile }));
}
