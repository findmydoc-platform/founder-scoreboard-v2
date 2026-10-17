import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { authOrigin } from "@/lib/auth-redirect";
import { getServerAuthSupabase } from "./cookie-client";

export async function POST(request: NextRequest) {
  try {
    const origin = authOrigin();
    if (request.headers.get("origin") !== origin) return new NextResponse(null, { status: 403 });
    const supabase = await getServerAuthSupabase();
    const result = await supabase?.auth.signOut({ scope: "local" });
    if (result?.error) return new NextResponse(null, { status: 503 });
    return NextResponse.redirect(new URL("/auth/link-google", origin), 303);
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
