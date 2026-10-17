import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError } from "@/lib/api-response";
import { requirePlanningContext } from "@/features/planning/server/planning-api-context";
import {
  parseSprintAssignmentRequest,
  sprintAssignmentCommand,
  sprintAssignmentError,
  sprintAssignmentUpdatesFromChanges,
} from "@/features/planning-items/model/planning-items-sprint-assignment";

export async function PATCH(request: NextRequest) {
  const payload = parseSprintAssignmentRequest(await request.json().catch(() => null));
  const apiContext = await requirePlanningContext(request, "planning.sprint.assign", typeof payload === "string" ? "" : payload.sprintId,
    "Sprint-Zuordnungen konnten nicht dauerhaft gespeichert werden.", typeof payload === "string" ? [] : payload.assignments.map(item => item.taskId));
  if (!apiContext.ok) return apiContext.response;
  if (typeof payload === "string") return apiError(payload, 400);
  const metadata = auditRequestMetadata(request);
  const result = await apiContext.planning.runSprintAssignment({
    command: sprintAssignmentCommand(payload),
    requestMetadata: {
      requestIp: metadata.request_ip || undefined,
      userAgent: metadata.user_agent || undefined,
    },
  });
  if (!result.ok) {
    const mapped = sprintAssignmentError(result.error);
    return apiError(mapped.message, mapped.status);
  }
  return NextResponse.json({ ok: true, updates: sprintAssignmentUpdatesFromChanges(result.changes) });
}
