import { NextResponse, type NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";

type CommitmentPayload = {
  sprintId?: string;
  profileId?: string;
  commitmentLevel?: "Lite" | "Standard" | "Heavy" | "Away";
  weeklyHours?: number;
  note?: string;
};

const levels = new Set(["Lite", "Standard", "Heavy", "Away"]);

export async function PUT(request: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireFounder(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const payload = (await request.json()) as CommitmentPayload;
  const sprintId = payload.sprintId?.trim();
  const profileId = payload.profileId?.trim() || permission.profile?.id || "";
  const commitmentLevel = payload.commitmentLevel || "Standard";
  const weeklyHours = Math.max(0, Math.min(80, Math.round(Number(payload.weeklyHours ?? 0))));
  const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 1000) : "";

  if (!sprintId) return NextResponse.json({ error: "Sprint ist erforderlich." }, { status: 400 });
  if (!profileId) return NextResponse.json({ error: "Profil ist erforderlich." }, { status: 400 });
  if (!levels.has(commitmentLevel)) return NextResponse.json({ error: "Ungültiges Commitment." }, { status: 400 });

  const canEditAny = permission.profile?.platformRole === "ceo" || permission.profile?.platformRole === "deputy";
  if (!canEditAny && profileId !== permission.profile?.id) {
    return NextResponse.json({ error: "Founder können nur ihr eigenes Commitment ändern." }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("sprint_commitments")
    .upsert({
      sprint_id: sprintId,
      profile_id: profileId,
      commitment_level: commitmentLevel,
      weekly_hours: weeklyHours,
      note,
      updated_at: new Date().toISOString(),
    }, { onConflict: "sprint_id,profile_id" })
    .select("id,sprint_id,profile_id,commitment_level,weekly_hours,note")
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message || "Commitment konnte nicht gespeichert werden." }, { status: 500 });

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "sprint.commitment.update",
    entity_type: "sprint_commitment",
    entity_id: String(data.id),
    after_data: data,
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent"),
  });

  return NextResponse.json({
    ok: true,
    commitment: {
      id: data.id,
      sprintId: data.sprint_id,
      profileId: data.profile_id,
      commitmentLevel: data.commitment_level,
      weeklyHours: data.weekly_hours,
      note: data.note || "",
    },
  });
}
