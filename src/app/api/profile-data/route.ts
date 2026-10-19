import { NextResponse, type NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import { apiError, authzError } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "account.profile.read" });
  if (!permission.ok) return authzError(permission);
  const result = await permission.account.loadProfile();
  if (result.status === "forbidden") return apiError("Profil darf nicht geladen werden.", 403);
  if (result.status !== "ready") return apiError("Profil konnte nicht geladen werden.", 503);
  return NextResponse.json({ model: result.model, headerData: result.headerData, currentProfile: permission.profile });
}
