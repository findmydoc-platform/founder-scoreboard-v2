import type { NextRequest } from "next/server";
import { handleTeamTaskIntakeRequest, teamTaskIntakeError, teamTaskIntakeJson } from "@/features/intake/model/team-task-intake-route";
import { buildTeamTaskIntakeV2Preview, parseTeamTaskIntakeV2Payload } from "@/features/intake/model/team-task-intake-v2";

export async function POST(request: NextRequest) {
  return handleTeamTaskIntakeRequest(request, "write:task-intake", "Team Task Intake v2 konnte nicht geprüft werden.", async (permission) => {
    const parsed = parseTeamTaskIntakeV2Payload(await request.json().catch(() => null));
    if (!parsed.ok) return teamTaskIntakeError(parsed.error, 400);
    const items = await buildTeamTaskIntakeV2Preview(parsed.items, permission.profile, permission.supabase);
    return teamTaskIntakeJson({ ok: true, valid: items.every((item) => !item.errors.length), items });
  });
}
