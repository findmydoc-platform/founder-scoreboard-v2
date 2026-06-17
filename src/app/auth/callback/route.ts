import { NextResponse, type NextRequest } from "next/server";
import { getServerAuthSupabase } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

function safeRelativeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const parsed = new URL(value, "http://localhost");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeRelativeNext(requestUrl.searchParams.get("next"));

  if (code) {
    const supabase = await getServerAuthSupabase();
    const { error } = supabase ? await supabase.auth.exchangeCodeForSession(code) : { error: new Error("Supabase Auth is not configured.") };
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }

  return NextResponse.redirect(new URL(`/auth/error?next=${encodeURIComponent(next)}`, request.url));
}
