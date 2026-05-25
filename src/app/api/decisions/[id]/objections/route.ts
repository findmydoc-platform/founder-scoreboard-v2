import { NextResponse, type NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";

type ObjectionPayload = {
  comment?: string;
};

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireFounder(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });
  if (!permission.profile) return NextResponse.json({ error: "Profil erforderlich." }, { status: 401 });

  const { id } = await context.params;
  const decisionId = Number(id);
  const payload = (await request.json()) as ObjectionPayload;
  const comment = typeof payload.comment === "string" ? payload.comment.trim().slice(0, 2000) : "";

  if (!comment) return NextResponse.json({ error: "Ein Kommentar ist erforderlich." }, { status: 400 });

  const { data: decision, error: decisionError } = await supabase
    .from("decision_log")
    .select("id,status")
    .eq("id", decisionId)
    .single();

  if (decisionError || !decision) return NextResponse.json({ error: "Decision nicht gefunden." }, { status: 404 });
  if (decision.status === "locked") return NextResponse.json({ error: "Gelockte Decisions können nicht mehr beanstandet werden." }, { status: 409 });

  const { data: objection, error } = await supabase
    .from("decision_comments")
    .insert({
      decision_id: decisionId,
      profile_id: permission.profile.id,
      type: "objection",
      comment,
    })
    .select("id,decision_id,profile_id,type,comment,created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("audit_log").insert({
    entity_type: "decision",
    entity_id: String(decisionId),
    action: "decision.objection",
    actor_profile_id: permission.profile.id,
    after_data: objection,
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent") || null,
  });

  return NextResponse.json({
    ok: true,
    comment: {
      id: objection.id,
      decisionId: objection.decision_id,
      profileId: objection.profile_id || "",
      type: objection.type,
      comment: objection.comment,
      createdAt: objection.created_at,
    },
  });
}
