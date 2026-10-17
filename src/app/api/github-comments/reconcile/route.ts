import { NextResponse, type NextRequest } from "next/server";
import { authzError, apiError, supabaseUnavailable } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";
export const dynamic = "force-dynamic";
async function reconcile(request: NextRequest, preview: boolean) {
  const permission = await authorizeCredentialAction({ credential: { kind: "notification-delivery-request", request }, action: preview ? "github.reconciliation.preview" : "github.reconciliation.deliver" });
  if (!permission.ok)
    return permission.status === 501 ? supabaseUnavailable() : authzError(permission);
  if ("preview" in permission.reconciliation)
    return NextResponse.json({ ok: true, preview: await permission.reconciliation.preview() });
  const commentDelivery = await permission.reconciliation.comments();
  const reviewDelivery = await permission.reconciliation.reviews();
  return NextResponse.json({ ok: true, commentDelivery, reviewDelivery });
}
async function respond(request: NextRequest, preview: boolean) {
  try {
    return await reconcile(request, preview);
  }
  catch (error) {
    if (error instanceof Error && "status" in error && typeof error.status === "number")
      return NextResponse.json({ error: error.message, ...("code" in error && error.code ? { code: error.code } : {}) }, { status: error.status });
    return apiError("GitHub-Abgleich konnte nicht abgeschlossen werden.", 500);
  }
}
export async function GET(request: NextRequest) { return respond(request, true); }
export async function POST(request: NextRequest) { return respond(request, false); }
