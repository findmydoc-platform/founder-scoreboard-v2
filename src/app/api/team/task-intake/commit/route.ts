import type { NextRequest } from "next/server";
import {
  commitTeamTaskIntake,
  loadTeamTaskIntakeReplay,
  teamTaskIntakeRequestHash,
} from "@/features/intake/model/team-task-intake-commit";
import { isUuid } from "@/features/intake/model/team-task-intake-contract";
import {
  buildTeamTaskIntakeForRoute,
  handleTeamTaskIntakeRequest,
  parseTeamTaskIntakeForRoute,
  teamTaskIntakeError,
  teamTaskIntakeJson,
} from "@/features/intake/model/team-task-intake-route";

export async function POST(request: NextRequest) {
  return handleTeamTaskIntakeRequest(request, "write:task-intake", "Team Task Intake konnte nicht gespeichert werden.", async (permission) => {
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
    if (!isUuid(idempotencyKey)) return teamTaskIntakeError("Gültiger UUID-Idempotency-Key ist erforderlich.", 400);

    const parsed = parseTeamTaskIntakeForRoute(await request.json().catch(() => null));
    if (!parsed.ok) return teamTaskIntakeError(parsed.error, parsed.status);

    const requestHash = teamTaskIntakeRequestHash(parsed.tasks);
    const replay = await loadTeamTaskIntakeReplay({
      idempotencyKey,
      requestHash,
      supabase: permission.supabase,
      tokenId: permission.tokenId,
    });
    if (replay) return teamTaskIntakeJson({ ok: true, ...replay });

    const intake = await buildTeamTaskIntakeForRoute({
      actor: permission.profile,
      rawTasks: parsed.tasks,
      supabase: permission.supabase,
    });
    if (!intake.ok) return teamTaskIntakeError(intake.error, intake.status);
    if (!intake.valid) {
      return teamTaskIntakeJson({
        ok: false,
        error: "Team Task Intake enthält ungültige Aufgaben.",
        tasks: intake.preview,
      }, 400);
    }

    const result = await commitTeamTaskIntake({
      actor: permission.profile,
      idempotencyKey,
      preview: intake.preview,
      request,
      requestHash,
      supabase: permission.supabase,
      tokenId: permission.tokenId,
    });
    return teamTaskIntakeJson({ ok: true, ...result });
  });
}
