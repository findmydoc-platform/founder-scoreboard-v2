import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdministrationReadModel } from "@/features/administration/server/administration-read-model-supabase";
import { apiError, authzError } from "@/lib/api-response";
import { bearerToken, requireAdministratorEligibilityManager, resolveAdministratorAccessFailure } from "@/lib/authz";
import { getSupabaseForToken } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const permission = await requireAdministratorEligibilityManager(request);
  if (!permission.ok) return authzError(permission);
  if (!permission.authority) return apiError("Adminautorität konnte nicht bestimmt werden.", 403);
  const token = bearerToken(request);
  const supabase = token ? getSupabaseForToken(token) : null;
  if (!supabase) return apiError("Anmeldung erforderlich.", 401);

  const result = await createSupabaseAdministrationReadModel(supabase).load({
    capabilities: permission.authority.capabilities,
  });
  if (result.status === "forbidden") {
    return authzError(await resolveAdministratorAccessFailure(supabase));
  }
  if (result.status === "unavailable") return apiError("Administrationsdaten konnten nicht geladen werden.", 503);
  return NextResponse.json({ administration: result.model });
}
