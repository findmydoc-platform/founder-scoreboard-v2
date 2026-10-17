import { after, NextResponse, type NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const result = await authorizeCredentialAction({ credential: { kind: "github-webhook-request", request }, action: "github.webhook.accept" });
  if (result.kind === "ping")
    return NextResponse.json({ ok: true });
  if (result.kind === "ignored")
    return new Response(null, { status: 204 });
  if (result.kind === "rejected")
    return NextResponse.json({ ok: false, code: result.code, error: result.message }, { status: result.status });
  after(async () => { await result.dispatch().catch(() => undefined); });
  return result.duplicate ? NextResponse.json({ ok: true, accepted: true, duplicate: true }) : NextResponse.json({ ok: true, accepted: true }, { status: 202 });
}
