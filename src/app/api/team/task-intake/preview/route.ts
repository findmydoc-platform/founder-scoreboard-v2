import type { NextRequest } from "next/server";
import {
  buildTeamTaskIntakeForRoute,
  handleTeamTaskIntakeRequest,
  teamTaskIntakeError,
  teamTaskIntakeJson,
} from "@/features/intake/model/team-task-intake-route";

export async function POST(request: NextRequest) {
  return handleTeamTaskIntakeRequest(request, "write:task-intake", "Team Task Intake konnte nicht geprüft werden.", async (permission) => {
    const intake = await buildTeamTaskIntakeForRoute({
      actor: permission.profile,
      payload: await request.json().catch(() => null),
      supabase: permission.supabase,
    });
    if (!intake.ok) return teamTaskIntakeError(intake.error, intake.status);

    return teamTaskIntakeJson({
      ok: true,
      valid: intake.valid,
      tasks: intake.preview,
    });
  });
}
