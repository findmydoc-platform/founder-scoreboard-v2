import { authorizeCredentialAction } from "@/lib/credentials";
import { NextResponse, type NextRequest } from "next/server";
import { authzError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "connection.github.read" });
  if (!permission.ok) return authzError(permission);
  const { user, waitingCommentCount } = await permission.resource.readGitHubConnection();
  const installationStatus = await authorizeCredentialAction({ credential: { kind: "github-installation" }, action: "github.installation.status" });

  return NextResponse.json({
    installation: { available: installationStatus.available },
    user,
    waitingCommentCount,
  });
}
