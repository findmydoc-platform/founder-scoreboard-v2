import { NextResponse, type NextRequest } from "next/server";
import { createProxyAuthSupabase } from "@/lib/supabase-server";

export async function proxy(request: NextRequest) {
  if (process.env.PLANNING_MAINTENANCE_MODE === "1") {
    return NextResponse.json(
      { status: "maintenance", message: "FounderOps wird gerade aktualisiert." },
      { status: 503, headers: { "cache-control": "no-store", "retry-after": "300" } },
    );
  }
  const { supabase, response } = createProxyAuthSupabase(request);
  if (supabase) await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
