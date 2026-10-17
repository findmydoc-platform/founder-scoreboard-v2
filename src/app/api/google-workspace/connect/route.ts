import { NextResponse, type NextRequest } from "next/server";
import { GoogleWorkspaceOAuthContractError } from "@/lib/google-calendar-errors";
import { authorizeCredentialAction } from "@/lib/credentials";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const result = await authorizeCredentialAction({credential:{kind:"google-calendar-oauth-request",request},action:"google-calendar.connection.start"});
    return NextResponse.redirect(result.redirect!);
  } catch (error) {
    if (error instanceof GoogleWorkspaceOAuthContractError && error.code === "reconnect_required") return NextResponse.redirect(new URL("/auth/error?next=%2Fteam",request.url));
    return NextResponse.redirect(new URL("/team?googleWorkspace=configuration_error",request.url));
  }
}
