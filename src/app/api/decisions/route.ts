import { NextResponse, type NextRequest } from "next/server";
import { cleanText } from "@/lib/api-input";
import { requireCEO } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";

type CreateDecisionPayload = {
  title?: string;
  context?: string;
  decision?: string;
  requiredProfileIds?: string[];
};

export async function POST(request: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireCEO(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const payload = (await request.json()) as CreateDecisionPayload;
  const title = cleanText(payload.title, 160);
  const context = cleanText(payload.context, 4000);
  const decision = cleanText(payload.decision, 4000);
  const requiredProfileIds = Array.isArray(payload.requiredProfileIds) ? [...new Set(payload.requiredProfileIds)].filter(Boolean) : [];

  if (!title) return NextResponse.json({ error: "Titel ist erforderlich." }, { status: 400 });
  if (!decision) return NextResponse.json({ error: "Entscheidungstext ist erforderlich." }, { status: 400 });
  if (!requiredProfileIds.length) return NextResponse.json({ error: "Mindestens eine bestätigende Person ist erforderlich." }, { status: 400 });

  const { data, error } = await supabase
    .from("decision_log")
    .insert({
      title,
      context,
      decision,
      status: "open_for_confirmation",
      required_profile_ids: requiredProfileIds,
      created_by: permission.profile?.id || null,
    })
    .select("*, decision_confirmations(profile_id)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("audit_log").insert({
    entity_type: "decision",
    entity_id: String(data.id),
    action: "create",
    actor_profile_id: permission.profile?.id || null,
    after_data: data,
    request_ip: request.headers.get("x-forwarded-for") || null,
    user_agent: request.headers.get("user-agent") || null,
  });

  return NextResponse.json({
    ok: true,
    decision: {
      id: data.id,
      title: data.title,
      context: data.context || "",
      decision: data.decision || "",
      status: data.status,
      requiredProfileIds: data.required_profile_ids || [],
      confirmedProfileIds: [],
      createdBy: data.created_by || "",
      lockedAt: data.locked_at || "",
    },
  });
}
