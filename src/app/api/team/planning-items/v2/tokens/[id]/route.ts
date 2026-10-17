import { type NextRequest, NextResponse } from "next/server";
import { apiError, authzError } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";
import { isUuid } from "@/features/planning-items/model/planning-items-contract";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "planning-items.tokens.manage" });
  if (!permission.ok) return authzError(permission);

  const { id } = await context.params;
  if (!isUuid(id)) return apiError("Token-ID ist ungültig.", 400);

  const { data, error } = await permission.tokens.revoke(id);

  if (error) return apiError(error.code === "PGRST202" || error.code === "42883" ? "Planning-API-Schema ist noch nicht verfügbar." : "Planning-API-Token konnte nicht widerrufen werden.", error.code === "PGRST202" || error.code === "42883" ? 503 : 500);
  if (!data) return apiError("Aktiver Token wurde nicht gefunden.", 404);
  return NextResponse.json({ ok: true, tokenId: data });
}
