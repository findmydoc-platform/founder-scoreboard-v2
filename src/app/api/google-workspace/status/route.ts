import { NextResponse, type NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import { apiError, authzError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "connection.google.read" });
  if (!permission.ok) return authzError(permission);
  if (!permission.profile?.id) return apiError("Teamprofil ist nicht verfügbar.", 403);
  try {
    return NextResponse.json(await permission.resource.readGoogleConnection());
  } catch {
    return apiError("Google-Verbindungsstatus ist nicht verfügbar.", 503);
  }
}
