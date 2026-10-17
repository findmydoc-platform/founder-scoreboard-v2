import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { apiError, readJsonPayload } from "@/lib/api-response";
import { requirePlanningContext } from "@/features/planning/server/planning-api-context";

type CommitmentPayload = {
  sprintId?: string;
  profileId?: string;
  commitmentLevel?: "Lite" | "Standard" | "Heavy" | "Away";
  weeklyHours?: number;
  note?: string;
};

const levels = new Set(["Lite", "Standard", "Heavy", "Away"]);

export async function PUT(request: NextRequest) {
  const payload = await readJsonPayload<CommitmentPayload>(request, {});
  const context = await requirePlanningContext(request, "planning.sprint.commitment.write", payload.sprintId?.trim());
  if (!context.ok) return context.response;

  const { permission, planning } = context;
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

  const { data, error } = await planning.writeCommitment({ profileId, commitmentLevel, weeklyHours, note });

  if (error || !data) return apiError(error?.message || "Commitment konnte nicht gespeichert werden.", 500);

  await planning.auditCommitment(auditRequestMetadata(request));

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
