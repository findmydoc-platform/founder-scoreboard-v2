import { NextResponse, type NextRequest } from "next/server";
import { apiError, supabaseUnavailable } from "@/lib/api-response";
import {
  FOUNDEROPS_MAINTENANCE_SECRET_HEADER,
  validateMaintenanceSecret,
} from "@/lib/maintenance-auth";
import { parsePlanningTrashPurgeResult } from "@/lib/planning-trash-maintenance-result.mjs";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!validateMaintenanceSecret(request.headers.get(FOUNDEROPS_MAINTENANCE_SECRET_HEADER))) {
    return apiError("Ungültiger Maintenance-Secret.", 401);
  }

  const supabase = getServerServiceRoleSupabase();
  if (!supabase) return supabaseUnavailable();

  const { data, error } = await supabase.rpc("purge_expired_planning_trash_batch", {
    p_limit: 25,
    p_dry_run: false,
  });
  if (error) return apiError("Planungspapierkorb konnte nicht bereinigt werden.", 500);

  const result = parsePlanningTrashPurgeResult(data);
  if (!result) return apiError("Planungspapierkorb lieferte ein ungültiges Bereinigungsergebnis.", 500);

  return NextResponse.json({
    ok: true,
    ...result,
  });
}
