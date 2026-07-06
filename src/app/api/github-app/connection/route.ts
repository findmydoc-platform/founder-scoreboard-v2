import { NextResponse, type NextRequest } from "next/server";
import { requireApiContext } from "@/lib/api-response";
import { requireTeamMember } from "@/lib/authz";
import { revokeGitHubAppUserConnection } from "@/lib/github-app";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest) {
  const apiContext = await requireApiContext(request, requireTeamMember);
  if (!apiContext.ok) return apiContext.response;

  await revokeGitHubAppUserConnection(apiContext.supabase, apiContext.permission.profile);
  return NextResponse.json({ ok: true });
}
