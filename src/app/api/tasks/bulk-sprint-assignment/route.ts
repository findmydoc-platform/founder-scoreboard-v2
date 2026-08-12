import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requireOperationalLead } from "@/lib/authz";
import { actorContextFromSessionAuth } from "@/features/planning-items/model/planning-actor-context-server";
import {
  createSprintAssignmentPlanningItems,
  parseSprintAssignmentRequest,
  sprintAssignmentCommand,
  sprintAssignmentError,
  sprintAssignmentUpdatesFromChanges,
} from "@/features/planning-items/model/planning-items-sprint-assignment";

export async function PATCH(request: NextRequest) {
  const apiContext = await requireApiContext(request, requireOperationalLead, {
    supabaseUnavailableMessage: "Sprint-Zuordnungen konnten nicht dauerhaft gespeichert werden.",
  });
  if (!apiContext.ok) return apiContext.response;

  const payload = parseSprintAssignmentRequest(await request.json().catch(() => null));
  if (typeof payload === "string") return apiError(payload, 400);
  const actor = actorContextFromSessionAuth({
    ok: true,
    profile: apiContext.permission.profile ? {
      id: apiContext.permission.profile.id,
      platformRole: apiContext.permission.profile.platformRole,
    } : null,
  });
  if (!actor.ok) return apiError("Nur CEO oder Deputy können Sprint-Zuordnungen ändern.", 403);
  const metadata = auditRequestMetadata(request);
  const result = await createSprintAssignmentPlanningItems(apiContext.supabase).run({
    actor: actor.actor,
    mode: "commit",
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
