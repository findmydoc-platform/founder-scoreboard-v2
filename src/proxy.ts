import type { NextRequest } from "next/server";
import { createProxyAuthSupabase } from "@/lib/supabase-server";

export async function proxy(request: NextRequest) {
  const { supabase, response } = createProxyAuthSupabase(request);
  if (supabase) await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
