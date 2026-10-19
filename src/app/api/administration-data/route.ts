import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdministrationReadModel } from "@/features/administration/server/administration-read-model-supabase";
import { apiError, authzError } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";

export async function GET(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "administration.directory.read" });
  if (!permission.ok) return authzError(permission);
  if (!permission.authority) return apiError("Adminautorität konnte nicht bestimmt werden.", 403);

  const result = await createSupabaseAdministrationReadModel(permission.administrator.directory).load({
    capabilities: permission.authority.capabilities,
  });
  if (result.status === "forbidden") {
    return authzError(await permission.administrator.failure());
  }
  if (result.status === "unavailable") return apiError("Administrationsdaten konnten nicht geladen werden.", 503);
  return NextResponse.json({ administration: result.model });
}
