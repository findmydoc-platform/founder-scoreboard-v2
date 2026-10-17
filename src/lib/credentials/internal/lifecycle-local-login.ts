import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-response";
import { isLocalLoginRequestAllowed } from "@/lib/local-development-auth";
import { allowedSessionMutation } from "./browser-session-transport";
import { getServerAuthSupabase } from "./cookie-client";

export async function POST(request: NextRequest) {
  if (!isLocalLoginRequestAllowed(request.headers.get("host") || "")) {
    return apiError("Not found.", 404);
  }

  if (!allowedSessionMutation(request)) return new NextResponse(null, { status: 403 });

  const email = process.env.LOCAL_LOGIN_EMAIL?.trim() || "";
  const password = process.env.LOCAL_LOGIN_PASSWORD || "";
  const supabase = await getServerAuthSupabase();
  if (!email || !password || !supabase) {
    return apiError("Lokaler Login ist noch nicht eingerichtet. Bitte führe pnpm local:reset aus.", 503);
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user || !data.session) {
    return apiError("Lokaler Login konnte nicht erstellt werden. Bitte führe pnpm local:seed aus.", 503);
  }

  return NextResponse.json({ ok: true });
}
