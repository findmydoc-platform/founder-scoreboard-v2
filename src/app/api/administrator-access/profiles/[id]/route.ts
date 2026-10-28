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
  const payload = await request.json().catch(() => null) as { eligible?: unknown; expectedEligible?: unknown } | null;
  if (typeof payload?.eligible !== "boolean") return apiError("Eligibility muss gesetzt sein.", 400);
  if (payload.expectedEligible !== undefined && typeof payload.expectedEligible !== "boolean") return apiError("Die ursprüngliche Adminberechtigung ist ungültig.", 400);
  const { data, error } = payload.expectedEligible === undefined
    ? await permission.administrator.setEligibility(payload.eligible)
    : await permission.administrator.setEligibilityIfCurrent(payload.eligible, payload.expectedEligible);
  if (error?.code === "P0020") return NextResponse.json({ error: "Die Adminberechtigung wurde zwischenzeitlich geändert. Bitte vergleichen.", code: "administration_eligibility_conflict" }, { status: 409 });
  if (error?.code === "P0002") return apiError("Profil wurde nicht gefunden.", 404);
  if (error?.code === "42501") {
    return authzError(await permission.administrator.failure());
  }
  if (error?.code === "22023") return apiError("Die ursprüngliche Adminberechtigung ist ungültig.", 400);
  if (error) return apiError("Adminberechtigung konnte nicht gespeichert werden.", 500);
  return NextResponse.json({ administratorAccess: data });
}
