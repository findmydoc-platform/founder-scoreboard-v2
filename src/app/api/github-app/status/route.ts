import { NextResponse, type NextRequest } from "next/server";
import { requireApiContext } from "@/lib/api-response";
import { getGitHubAppConnectionStatus } from "@/lib/github-app";
import { requireTeamMember } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const apiContext = await requireApiContext(request, requireTeamMember);
  if (!apiContext.ok) return apiContext.response;

  const status = await getGitHubAppConnectionStatus(apiContext.supabase, apiContext.permission.profile);
  return NextResponse.json(status);
}
