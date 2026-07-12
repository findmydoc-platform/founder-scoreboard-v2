import { NextResponse, type NextRequest } from "next/server";
import { requireApiContext } from "@/lib/api-response";
import { getGitHubAppInstallationToken, getGitHubUserConnectionStatus } from "@/lib/github-app";
import { countWaitingGitHubCommentsForAuthor } from "@/lib/github-comment-delivery";
import { requireTeamMember } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const apiContext = await requireApiContext(request, requireTeamMember);
  if (!apiContext.ok) return apiContext.response;

  const user = await getGitHubUserConnectionStatus(apiContext.supabase, apiContext.permission.profile);
  const waitingCommentCount = await countWaitingGitHubCommentsForAuthor(
    apiContext.supabase,
    apiContext.permission.profile?.id || "",
  ).catch(() => 0);
  const installationAvailable = await getGitHubAppInstallationToken().then(() => true).catch(() => false);

  return NextResponse.json({
    installation: { available: installationAvailable },
    user,
    waitingCommentCount,
  });
}
