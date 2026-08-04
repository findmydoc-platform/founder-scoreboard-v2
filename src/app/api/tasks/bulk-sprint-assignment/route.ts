import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requireOperationalLead } from "@/lib/authz";

type BulkSprintAssignment = {
  taskId: string;
  expectedUpdatedAt: string;
};

type BulkSprintAssignmentPayload = {
  assignments: BulkSprintAssignment[];
  sprintId: string;
};

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Boolean(value) && !Number.isNaN(Date.parse(value));
}

export function parseBulkSprintAssignment(payload: unknown): BulkSprintAssignmentPayload | string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "Sprint-Zuordnung ist ungültig.";
  const candidate = payload as { assignments?: unknown; sprintId?: unknown };
  const sprintId = typeof candidate.sprintId === "string" ? candidate.sprintId.trim() : "";
  if (!sprintId || !Array.isArray(candidate.assignments) || candidate.assignments.length < 1 || candidate.assignments.length > 100) {
    return "Wähle zwischen 1 und 100 Deliverables sowie einen Sprint aus.";
  }

  const assignments: BulkSprintAssignment[] = [];
  const taskIds = new Set<string>();
  for (const value of candidate.assignments) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "Sprint-Zuordnung ist ungültig.";
    const assignment = value as { taskId?: unknown; expectedUpdatedAt?: unknown };
    const taskId = typeof assignment.taskId === "string" ? assignment.taskId.trim() : "";
    if (!taskId || taskIds.has(taskId) || !validTimestamp(assignment.expectedUpdatedAt)) {
      return "Sprint-Zuordnung ist ungültig.";
    }
    taskIds.add(taskId);
    assignments.push({ taskId, expectedUpdatedAt: assignment.expectedUpdatedAt });
  }

  return { assignments, sprintId };
}

export async function PATCH(request: NextRequest) {
  const apiContext = await requireApiContext(request, requireOperationalLead, {
    supabaseUnavailableMessage: "Sprint-Zuordnungen konnten nicht dauerhaft gespeichert werden.",
  });
  if (!apiContext.ok) return apiContext.response;

  const payload = parseBulkSprintAssignment(await request.json().catch(() => null));
  if (typeof payload === "string") return apiError(payload, 400);

  const metadata = auditRequestMetadata(request);
  const { data, error } = await apiContext.supabase.rpc("assign_backlog_tasks_to_sprint_transaction", {
    p_assignments: payload.assignments,
    p_sprint_id: payload.sprintId,
    p_actor_profile_id: apiContext.permission.profile?.id || null,
    p_request_ip: metadata.request_ip,
    p_user_agent: metadata.user_agent || null,
  });
  if (error) {
    if (error.code === "P0001") return apiError("Mindestens ein Deliverable wurde zwischenzeitlich geändert. Bitte neu laden.", 409);
    if (error.code === "P0002") return apiError("Mindestens ein Deliverable wurde nicht gefunden.", 404);
    if (error.code === "P0004") return apiError("Sprint wurde nicht gefunden.", 404);
    if (error.code === "P0005") return apiError("Der Ziel-Sprint ist gesperrt.", 409);
    if (error.code === "P0006") return apiError("Ein bisheriger Sprint wurde nicht gefunden. Bitte neu laden.", 409);
    if (error.code === "P0007") return apiError("Deliverables aus einem gesperrten Sprint können nicht umgeplant werden.", 409);
    if (error.code === "P0010") return apiError("Nur Deliverables können einem Sprint zugeordnet werden.", 400);
    if (error.code === "P0011") return apiError("Nur freigegebene Deliverables können einem Sprint zugeordnet werden.", 409);
    if (error.code === "P0012") return apiError("Erledigte Deliverables können nicht mehr einem Sprint zugeordnet werden.", 409);
    if (error.code === "P0013") return apiError("Für mindestens ein Deliverable fehlt die Zuständigkeit.", 409);
    if (error.code === "P0014") return apiError("Für mindestens ein Deliverable fehlt eine freigegebene Initiative.", 409);
    if (error.code === "22023" || error.code === "22007") return apiError("Sprint-Zuordnung ist ungültig.", 400);
    return apiError("Sprint-Zuordnungen konnten nicht gespeichert werden.", 500);
  }

  return NextResponse.json({ ok: true, updates: data || [] });
}
