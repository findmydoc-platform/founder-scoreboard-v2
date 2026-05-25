import { NextResponse, type NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireFounder(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });
  if (!permission.profile) return NextResponse.json({ error: "Profil erforderlich." }, { status: 401 });

  const { id } = await context.params;
  const decisionId = Number(id);

  const { data: decision, error: decisionError } = await supabase
    .from("decision_log")
    .select("id,status,required_profile_ids")
    .eq("id", decisionId)
    .single();

  if (decisionError || !decision) return NextResponse.json({ error: "Decision nicht gefunden." }, { status: 404 });
  if (decision.status === "locked") return NextResponse.json({ error: "Decision ist bereits gelockt." }, { status: 409 });
  if (decision.status !== "open_for_confirmation") {
    return NextResponse.json({ error: "Decision ist noch nicht zur Bestätigung geöffnet." }, { status: 409 });
  }

  const { error } = await supabase
    .from("decision_confirmations")
    .upsert({ decision_id: decisionId, profile_id: permission.profile.id });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: confirmations } = await supabase
    .from("decision_confirmations")
    .select("profile_id")
    .eq("decision_id", decisionId);

  const confirmedIds = new Set((confirmations || []).map((item) => item.profile_id));
  const requiredIds = decision.required_profile_ids || [];
  const shouldLock = requiredIds.length > 0 && requiredIds.every((profileId: string) => confirmedIds.has(profileId));

  if (shouldLock) {
    await supabase
      .from("decision_log")
      .update({ status: "locked", locked_at: new Date().toISOString() })
      .eq("id", decisionId);
  }

  await supabase.from("audit_log").insert({
    entity_type: "decision",
    entity_id: String(decisionId),
    action: shouldLock ? "confirm_and_lock" : "confirm",
    actor_profile_id: permission.profile.id,
    request_ip: request.headers.get("x-forwarded-for") || null,
    user_agent: request.headers.get("user-agent") || null,
  });

  return NextResponse.json({
    ok: true,
    locked: shouldLock,
    confirmedProfileIds: [...confirmedIds],
  });
}
