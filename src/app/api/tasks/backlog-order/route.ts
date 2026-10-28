import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError } from "@/lib/api-response";
import { requirePlanningContext } from "@/features/planning/server/planning-api-context";
import {
  backlogMoveCommand,
  backlogMoveError,
  backlogMoveUpdatesFromChanges,
  parseBacklogMoveRequest,
} from "@/features/planning-items/model/planning-items-backlog-move";

export async function PATCH(request: NextRequest) {
  const move = parseBacklogMoveRequest(await request.json().catch(() => null));
  const apiContext = await requirePlanningContext(request, "planning.backlog.move", move?.taskId,
    "Backlog-Reihenfolge konnte nicht dauerhaft gespeichert werden.", move ? [move.targetTaskId] : []);
  if (!apiContext.ok) return apiContext.response;
  if (!move) return apiError("Backlog-Verschiebung ist ungültig.", 400);
  const metadata = auditRequestMetadata(request);
  const result = await apiContext.planning.runBacklogMove({
    command: backlogMoveCommand(move),
    requestMetadata: {
      requestIp: metadata.request_ip || undefined,
      userAgent: metadata.user_agent || undefined,
    },
  });
  if (!result.ok) {
    const mapped = backlogMoveError(result.error);
    return NextResponse.json({ error: mapped.message, ...(mapped.code ? { code: mapped.code } : {}) }, { status: mapped.status });
  }
  return NextResponse.json({ ok: true, completeness: "complete", updates: backlogMoveUpdatesFromChanges(result.changes) });
}
