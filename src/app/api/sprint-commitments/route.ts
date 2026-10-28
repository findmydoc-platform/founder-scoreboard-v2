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
  expectedUpdatedAt?: string | null;
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

  if (payload.expectedUpdatedAt !== null && (typeof payload.expectedUpdatedAt !== "string" || !payload.expectedUpdatedAt.trim())) return apiError("Die ursprüngliche Bearbeitungsbasis ist erforderlich.", 400);

  const { data, error } = await planning.writeCommitment({ profileId, commitmentLevel, weeklyHours, note, expectedUpdatedAt: payload.expectedUpdatedAt });

  if (error?.code === "commitment_revision_conflict") return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
  if (error?.code === "42501") return apiError(error.message, 403);
  if (error || !data) return apiError(error?.message || "Commitment konnte nicht gespeichert werden.", 500);

  let auditError = "";
  try { const audit = await planning.auditCommitment(auditRequestMetadata(request)); if (audit.error) auditError = "Commitment gespeichert; Audit-Eintrag konnte nicht bestätigt werden."; } catch { auditError = "Commitment gespeichert; Audit-Eintrag konnte nicht bestätigt werden."; }

  return NextResponse.json({
    ok: true,
    ...(auditError ? { auditError } : {}),
    commitment: {
      id: data.id,
      updatedAt: data.updated_at,
      sprintId: data.sprint_id,
      profileId: data.profile_id,
      commitmentLevel: data.commitment_level,
      weeklyHours: data.weekly_hours,
      note: data.note || "",
    },
  });
}
