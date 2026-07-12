import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authzError, supabaseUnavailable } from "@/lib/api-response";
import { requireOperationalLead } from "@/lib/authz";
import { deliverPendingGitHubComments, previewPendingGitHubComments } from "@/lib/github-comment-delivery";
import { getServerSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function secretsMatch(provided: string, expected: string) {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

async function authorizeReconciliation(request: NextRequest) {
  const providedSecret = request.headers.get("x-founderops-delivery-secret")?.trim() || "";
  if (providedSecret) {
    const expectedSecret = process.env.FOUNDEROPS_DELIVERY_SECRET?.trim() || "";
    if (!expectedSecret || !secretsMatch(providedSecret, expectedSecret)) {
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
