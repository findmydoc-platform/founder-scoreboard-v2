import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requirePlanningContributor } from "@/lib/authz";
import { actorContextFromSessionAuth } from "@/features/planning-items/model/planning-actor-context-server";
import {
  backlogMoveCommand,
  backlogMoveError,
  backlogMoveUpdatesFromChanges,
  createBacklogMovePlanningItems,
  parseBacklogMoveRequest,
} from "@/features/planning-items/model/planning-items-backlog-move";

export async function PATCH(request: NextRequest) {
  const apiContext = await requireApiContext(request, requirePlanningContributor, {
    supabaseUnavailableMessage: "Backlog-Reihenfolge konnte nicht dauerhaft gespeichert werden.",
  });
  if (!apiContext.ok) return apiContext.response;

  const { permission, supabase } = apiContext;
  const payload = await request.json().catch(() => null);
  const move = parseBacklogMoveRequest(payload);
  if (!move) return apiError("Backlog-Verschiebung ist ungültig.", 400);
  const actor = actorContextFromSessionAuth({
    ok: true,
    profile: permission.profile ? {
      id: permission.profile.id,
      platformRole: permission.profile.platformRole,
    } : null,
  });
  if (!actor.ok) return apiError("Nur CEO oder Deputy können die Backlog-Reihenfolge ändern.", 403);
  const metadata = auditRequestMetadata(request);
  const result = await createBacklogMovePlanningItems(supabase).run({
    actor: actor.actor,
    mode: "commit",
    command: backlogMoveCommand(move),
    requestMetadata: {
      requestIp: metadata.request_ip || undefined,
      userAgent: metadata.user_agent || undefined,
    },
  });
  if (!result.ok) {
    const mapped = backlogMoveError(result.error);
    return apiError(mapped.message, mapped.status);
  }
  return NextResponse.json({ ok: true, updates: backlogMoveUpdatesFromChanges(result.changes) });
}
