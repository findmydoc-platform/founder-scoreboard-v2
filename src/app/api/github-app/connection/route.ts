import { NextResponse, type NextRequest } from "next/server";
import { requireApiContext } from "@/lib/api-response";
import { requireTeamMember } from "@/lib/authz";
import { authorizeCredentialAction } from "@/lib/credentials";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest) {
  const apiContext = await requireApiContext(request, requireTeamMember);
  if (!apiContext.ok) return apiContext.response;

  await authorizeCredentialAction({credential:{kind:"session-request",request},action:"github.connection.disconnect"});
  return NextResponse.json({ ok: true });
}
