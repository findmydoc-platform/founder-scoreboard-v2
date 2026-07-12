import type { NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { isUuid } from "@/features/intake/model/team-task-intake-contract";
import { handleTeamTaskIntakeRequest, teamTaskIntakeError, teamTaskIntakeJson } from "@/features/intake/model/team-task-intake-route";
import { buildTeamTaskIntakeV2Preview, parseTeamTaskIntakeV2Payload, teamTaskIntakeV2CommitItem, teamTaskIntakeV2Hash } from "@/features/intake/model/team-task-intake-v2";

export async function POST(request: NextRequest) {
  return handleTeamTaskIntakeRequest(request, "write:task-intake", "Team Task Intake v2 konnte nicht gespeichert werden.", async (permission) => {
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
    if (!isUuid(idempotencyKey)) return teamTaskIntakeError("Gültiger UUID-Idempotency-Key ist erforderlich.", 400);
    const parsed = parseTeamTaskIntakeV2Payload(await request.json().catch(() => null));
    if (!parsed.ok) return teamTaskIntakeError(parsed.error, 400);
    const items = await buildTeamTaskIntakeV2Preview(parsed.items, permission.profile, permission.supabase);
    if (items.some((item) => item.errors.length)) return teamTaskIntakeJson({ ok: false, error: "Team Task Intake v2 enthält ungültige Einträge.", items }, 400);
    const metadata = auditRequestMetadata(request);
    const { data, error } = await permission.supabase.rpc("create_team_task_intake_v2_transaction", {
      p_token_id: permission.tokenId,
      p_profile_id: permission.profile.id,
      p_idempotency_key: idempotencyKey,
      p_request_hash: teamTaskIntakeV2Hash(items),
      p_items: items.map(teamTaskIntakeV2CommitItem),
      p_request_ip: metadata.request_ip,
      p_user_agent: metadata.user_agent || null,
    });
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return teamTaskIntakeJson({ ok: true, ...(data as object) });
  });
}
