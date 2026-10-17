import { authorizeCredentialAction } from "@/lib/credentials";
import { NextResponse, type NextRequest } from "next/server";
import { requireApiContext } from "@/lib/api-response";
import { countWaitingGitHubCommentsForAuthor } from "@/lib/github-comment-delivery";
import { requireTeamMember } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const apiContext = await requireApiContext(request, requireTeamMember);
  if (!apiContext.ok) return apiContext.response;

  const user = await authorizeCredentialAction({credential:{kind:"session-request",request},action:"github.connection.status"});
  const waitingCommentCount = await countWaitingGitHubCommentsForAuthor(
    apiContext.supabase,
    apiContext.permission.profile?.id || "",
  ).catch(() => 0);
  const installationStatus = await authorizeCredentialAction({ credential: { kind: "github-installation" }, action: "github.installation.status" });

  return NextResponse.json({
    installation: { available: installationStatus.available },
    user,
    waitingCommentCount,
  });
}
