import { observeRuntimeHandler, observeRuntimePreparation } from "@/lib/runtime-logging";
import { NextResponse, type NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import { apiError, authzError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

async function handleGET(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "connection.google.read" });
  if (!permission.ok) return authzError(permission);
  if (!permission.profile?.id) return apiError("Teamprofil ist nicht verfügbar.", 403);
  try {
    const connection = await permission.resource.readGoogleConnection();
    return observeRuntimePreparation(() => NextResponse.json(connection));
  } catch {
    return apiError("Google-Verbindungsstatus ist nicht verfügbar.", 503);
  }
}

export const GET = observeRuntimeHandler("google.status", handleGET);
