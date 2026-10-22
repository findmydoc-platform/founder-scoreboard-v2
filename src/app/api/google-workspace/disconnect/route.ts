import { observeRuntimeHandler, observeRuntimePreparation } from "@/lib/runtime-logging";
import { type NextRequest, NextResponse } from "next/server";
import {
  GoogleWorkspaceDisconnectError,
} from "@/features/team-workweek/server/google-workspace-disconnect";
import { apiError, authzError, readJsonPayload } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";

export const dynamic = "force-dynamic";

async function handleGET(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "connection.google.disconnect.preview" });
  if (!permission.ok) return authzError(permission);
  const ownerProfileId = permission.profile?.id;
  if (!ownerProfileId) return apiError("Gebundenes Teamprofil erforderlich.", 403);
  try {
    const disconnect = await permission.resource.readGoogleDisconnect();
    return observeRuntimePreparation(() => NextResponse.json({ disconnect }));
  } catch {
    return apiError("Trennungsvorschau ist nicht verfügbar.", 503);
  }
}

async function handlePOST(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "connection.google.disconnect" });
  if (!permission.ok) return authzError(permission);
  const ownerProfileId = permission.profile?.id;
  if (!ownerProfileId) return apiError("Gebundenes Teamprofil erforderlich.", 403);
  const payload = await readJsonPayload<unknown>(request, null);
  const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (Object.keys(input).some((key) => key !== "confirm") || input.confirm !== true) {
    return apiError("Trennung muss ausdrücklich bestätigt werden.", 400);
  }
  try {
    const result = await permission.resource.disconnectGoogle();
    return observeRuntimePreparation(() => NextResponse.json({ result }, { status: result.state === "completed" ? 200 : 202 }));
  } catch (error) {
    if (error instanceof GoogleWorkspaceDisconnectError) {
      return apiError(error.message, error.code === "conflict" ? 409 : 503);
    }
    return apiError("Google-Verbindung konnte nicht getrennt werden.", 503);
  }
}

export const GET = observeRuntimeHandler("google.disconnect.preview", handleGET);

export const POST = observeRuntimeHandler("google.disconnect", handlePOST);
