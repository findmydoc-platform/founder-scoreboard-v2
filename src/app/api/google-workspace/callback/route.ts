import { NextResponse, type NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const result = await authorizeCredentialAction({credential:{kind:"google-calendar-oauth-request",request},action:"google-calendar.connection.complete"});
    const success = new URL(result.next,request.url);
    success.searchParams.set("googleWorkspace","connected");
    return NextResponse.redirect(success);
  } catch {
    return NextResponse.redirect(new URL("/team?googleWorkspace=connection_error",request.url));
  }
}
