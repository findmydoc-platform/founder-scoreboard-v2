import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requirePlanningContributor } from "@/lib/authz";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

type CommitmentPayload = {
  sprintId?: string;
  profileId?: string;
  commitmentLevel?: "Lite" | "Standard" | "Heavy" | "Away";
  weeklyHours?: number;
  note?: string;
};

const levels = new Set(["Lite", "Standard", "Heavy", "Away"]);

export async function PUT(request: NextRequest) {
  const context = await requireJsonApiContext<CommitmentPayload>(request, requirePlanningContributor, {});
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  const sprintId = payload.sprintId?.trim();
  const profileId = payload.profileId?.trim() || permission.profile?.id || "";
  const commitmentLevel = payload.commitmentLevel || "Standard";
  const weeklyHours = Math.max(0, Math.min(80, Math.round(Number(payload.weeklyHours ?? 0))));
  const note = cleanText(payload.note, 1000);

  if (!sprintId) return apiError("Sprint ist erforderlich.", 400);
  if (!profileId) return apiError("Profil ist erforderlich.", 400);
  if (!levels.has(commitmentLevel)) return apiError("Ungültiges Commitment.", 400);

  const canEditAny = permission.profile?.platformRole === "ceo" || permission.profile?.platformRole === "deputy";
  if (!canEditAny && profileId !== permission.profile?.id) {
    return apiError("Founder können nur ihr eigenes Commitment ändern.", 403);
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

  if (error || !data) return apiError(error?.message || "Commitment konnte nicht gespeichert werden.", 500);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "sprint.commitment.update",
    entity_type: "sprint_commitment",
    entity_id: String(data.id),
    after_data: data,
    ...auditRequestMetadata(request),
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
