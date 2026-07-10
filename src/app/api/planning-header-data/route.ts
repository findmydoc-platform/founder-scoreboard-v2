import { NextResponse, type NextRequest } from "next/server";
import { requirePlatformRole } from "@/lib/authz";
import { apiError, authzError, supabaseUnavailable } from "@/lib/api-response";
import { getServerSupabase } from "@/lib/supabase";
import { loadPlanningHeaderData, parsePlanningHeaderSlots } from "@/lib/planning-header-data";

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRole(request, ["ceo", "founder", "deputy", "viewer"]);
  if (!auth.ok) return authzError(auth);

  const slots = parsePlanningHeaderSlots(request.nextUrl.searchParams.get("slots"));
  if (!slots) return apiError("Unknown planning header slot.", 400);

  const supabase = getServerSupabase();
  if (!supabase) return supabaseUnavailable();

  const headerData = await loadPlanningHeaderData(supabase, {
    currentProfileId: auth.profile?.id || null,
    slots,
  });

  return NextResponse.json({ headerData });
}
