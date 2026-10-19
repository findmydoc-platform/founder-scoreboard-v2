import { NextResponse, type NextRequest } from "next/server";
import { apiError, authzError } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "administration.eligibility.manage", targetProfileId: id });
  if (!permission.ok) return authzError(permission);
  const payload = await request.json().catch(() => null) as { eligible?: unknown } | null;
  if (typeof payload?.eligible !== "boolean") return apiError("Eligibility muss gesetzt sein.", 400);
  const { data, error } = await permission.administrator.setEligibility(payload.eligible);
  if (error?.code === "P0002") return apiError("Profil wurde nicht gefunden.", 404);
  if (error?.code === "42501") {
    return authzError(await permission.administrator.failure());
  }
  if (error) return apiError("Adminberechtigung konnte nicht gespeichert werden.", 500);
  return NextResponse.json({ administratorAccess: data });
}
