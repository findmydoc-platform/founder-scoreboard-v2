import { NextResponse, type NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import { safeRelativeNext } from "@/lib/auth-redirect";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest) {
  try {
    const access=await authorizeCredentialAction({credential:{kind:"github-oauth-request",request},action:"github.connection.start"});
    return NextResponse.redirect(access.redirect!);
  } catch {
    return NextResponse.redirect(new URL(`/auth/error?next=${encodeURIComponent(safeRelativeNext(request.nextUrl.searchParams.get("next")))}`,request.url));
  }
}
