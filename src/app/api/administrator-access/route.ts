import { NextResponse, type NextRequest } from "next/server";
import { apiError, authzError } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";

export async function GET(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "administrator-access.read" });
  if (!permission.ok) return authzError(permission);
  const result = await permission.administrator.read();
  if (result.error) return apiError("Adminzugang konnte nicht geprüft werden.", 503);
  return NextResponse.json({ administratorAccess: result.data });
}

export async function POST(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "administrator-access.activate" });
  if (!permission.ok) return authzError(permission);
  const result = await permission.administrator.activate();
  if (result.error?.code === "42501") return apiError("Du bist nicht für den Adminzugang berechtigt.", 403);
  if (result.error) return apiError("Adminzugang konnte nicht aktiviert werden.", 500);
  return NextResponse.json({ administratorAccess: result.data });
}

export async function DELETE(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "administrator-access.end" });
  if (!permission.ok) return authzError(permission);
  const result = await permission.administrator.end();
  if (result.error) return apiError("Adminzugang konnte nicht beendet werden.", 500);
  return NextResponse.json({ administratorAccess: result.data });
}
