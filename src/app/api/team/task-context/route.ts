import type { NextRequest } from "next/server";
import { buildTeamTaskContext } from "@/features/intake/model/team-task-context";
import { handleTeamTaskIntakeRequest, teamTaskIntakeJson } from "@/features/intake/model/team-task-intake-route";

export async function GET(request: NextRequest) {
  return handleTeamTaskIntakeRequest(request, "read:task-context", "Team-Task-Kontext konnte nicht geladen werden.", async (permission) => {
    const context = await buildTeamTaskContext(permission.supabase, permission.profile);
    return teamTaskIntakeJson({ ok: true, context });
  });
}
