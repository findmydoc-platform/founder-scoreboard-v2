import { NextResponse, type NextRequest } from "next/server";
import { requireCEO } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";

type UpdateDecisionPayload = {
  title?: string;
  context?: string;
  decision?: string;
  requiredProfileIds?: string[];
};

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireCEO(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const { id } = await context.params;
  const decisionId = Number(id);
  const payload = (await request.json()) as UpdateDecisionPayload;

  const title = cleanText(payload.title, 160);
  const contextText = cleanText(payload.context, 4000);
  const decisionText = cleanText(payload.decision, 4000);
  const requiredProfileIds = Array.isArray(payload.requiredProfileIds) ? [...new Set(payload.requiredProfileIds)].filter(Boolean) : [];

  if (!title) return NextResponse.json({ error: "Titel ist erforderlich." }, { status: 400 });
  if (!decisionText) return NextResponse.json({ error: "Entscheidungstext ist erforderlich." }, { status: 400 });
  if (!requiredProfileIds.length) return NextResponse.json({ error: "Mindestens eine bestätigende Person ist erforderlich." }, { status: 400 });

  const { data: before, error: readError } = await supabase
    .from("decision_log")
    .select("id,title,context,decision,status,required_profile_ids,created_by,locked_at")
    .eq("id", decisionId)
    .single();

  if (readError || !before) return NextResponse.json({ error: "Decision nicht gefunden." }, { status: 404 });
  if (before.status === "locked") return NextResponse.json({ error: "Gelockte Decisions sind unveränderlich." }, { status: 409 });

  const { data: updated, error: updateError } = await supabase
    .from("decision_log")
    .update({
      title,
      context: contextText,
      decision: decisionText,
      required_profile_ids: requiredProfileIds,
      status: "open_for_confirmation",
      locked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", decisionId)
    .select("id,title,context,decision,status,required_profile_ids,created_by,locked_at")
    .single();

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  await supabase.from("decision_confirmations").delete().eq("decision_id", decisionId);

  await supabase.from("audit_log").insert({
    entity_type: "decision",
    entity_id: String(decisionId),
    action: "decision.update",
    actor_profile_id: permission.profile?.id || null,
    before_data: before,
    after_data: updated,
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent") || null,
  });

  return NextResponse.json({
    ok: true,
    decision: {
      id: updated.id,
      title: updated.title,
      context: updated.context || "",
      decision: updated.decision || "",
      status: updated.status,
      requiredProfileIds: updated.required_profile_ids || [],
      confirmedProfileIds: [],
      createdBy: updated.created_by || "",
      lockedAt: updated.locked_at || "",
    },
  });
}
