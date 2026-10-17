import { NextResponse, type NextRequest } from "next/server";
import { authzError } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "connection.github.disconnect" });
  if (!permission.ok) return authzError(permission);
  await permission.resource.disconnectGitHub();
  return NextResponse.json({ ok: true });
}
