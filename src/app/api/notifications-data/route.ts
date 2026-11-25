import { observeRuntimeHandler } from "@/lib/runtime-logging";
import type { NextRequest } from "next/server";
import { supportingWorkspaceGet } from "@/app/api/supporting-workspace-route";
import { authorizeCredentialAction } from "@/lib/credentials";
import { apiError, authzError } from "@/lib/api-response";

const handleGET = async (request: NextRequest) => {
  const area = request.nextUrl.searchParams.get("area");
  if (area === null) return supportingWorkspaceGet(request, "notifications.read");
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "notifications.read" });
  if (!permission.ok) return authzError(permission);
  if (area !== "preview" && area !== "count" && area !== "inbox" && area !== "revision") return apiError("Ungültiger Benachrichtigungsbereich.", 400);
  const continuation = request.nextUrl.searchParams.get("continuation");
  if (continuation !== null && (area !== "inbox" || !continuation || continuation.length > 4096)) return apiError("Ungültige Benachrichtigungsfortsetzung.", 400);
  const result = area === "revision"
    ? await permission.resource.observeNotificationSource({ signal: request.signal })
    : await permission.resource.loadNotificationScope(area, { signal: request.signal, continuation: continuation || undefined });
  if (result.status === "forbidden") return apiError("Benachrichtigungen dürfen nicht geladen werden.", 403);
  if (result.status === "staleContinuation") return Response.json({ error: "Die Benachrichtigungen haben sich geändert. Bitte erneut laden.", code: "stale_continuation" }, { status: 409, headers: { "cache-control": "no-store" } });
  if (result.status !== "ready") return apiError("Benachrichtigungen konnten nicht geladen werden.", 503);
  const { status: _status, ...body } = result;
  void _status;
  return Response.json(body, { headers: { "cache-control": "no-store" } });
};

export const GET = observeRuntimeHandler("notifications.read", handleGET);
