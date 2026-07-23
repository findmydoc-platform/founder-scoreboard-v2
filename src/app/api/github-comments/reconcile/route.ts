import { NextResponse, type NextRequest } from "next/server";
import { authzError, supabaseUnavailable } from "@/lib/api-response";
import { requireOperationalLead } from "@/lib/authz";
import {
  FOUNDEROPS_DELIVERY_SECRET_HEADER,
  validateDeliverySecret,
} from "@/lib/delivery-auth";
import { deliverPendingGitHubComments, previewPendingGitHubComments } from "@/lib/github-comment-delivery";
import { getServerSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function authorizeReconciliation(request: NextRequest) {
  const providedSecret = request.headers.get(FOUNDEROPS_DELIVERY_SECRET_HEADER)?.trim() || "";
  if (providedSecret) {
    if (!validateDeliverySecret(providedSecret)) {
      return { ok: false as const, status: 401, error: "Ungültiger Delivery-Secret." };
    }
    return { ok: true as const };
  }

  return requireOperationalLead(request);
}

async function authorizedSupabase(request: NextRequest) {
  const permission = await authorizeReconciliation(request);
  if (!permission.ok) return { ok: false as const, response: authzError(permission) };

  const supabase = getServerSupabase();
  if (!supabase) return { ok: false as const, response: supabaseUnavailable() };
  return { ok: true as const, supabase };
}

export async function GET(request: NextRequest) {
  const context = await authorizedSupabase(request);
  if (!context.ok) return context.response;
  const preview = await previewPendingGitHubComments(context.supabase, 100);
  return NextResponse.json({ ok: true, preview });
}

export async function POST(request: NextRequest) {
  const context = await authorizedSupabase(request);
  if (!context.ok) return context.response;

  const commentDelivery = await deliverPendingGitHubComments({ supabase: context.supabase, limit: 100 });
  return NextResponse.json({ ok: true, commentDelivery });
}
