import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { requireOperationalLead } from "@/lib/authz";
import { actorContextFromSessionAuth } from "@/features/planning-items/model/planning-actor-context-server";
import {
  createEmptyEpicDeletePlanningItems,
  emptyEpicDeleteCommand,
  emptyEpicDeleteError,
  emptyEpicDeleteMilestone,
  parseEmptyEpicDeletePayload,
} from "@/features/planning-items/model/planning-items-empty-epic-delete";
import {
  loadProjectMilestone,
  mapMilestoneRow,
  parseMilestonePatchRequest,
  updateProjectMilestone,
} from "@/features/projects/model/milestone-server";

type MilestoneRouteContext = { params: Promise<{ id: string }> };

async function loadMilestoneOrResponse(supabase: Parameters<typeof loadProjectMilestone>[0], id: string) {
  const result = await loadProjectMilestone(supabase, id);
  if (result.error) return { ok: false as const, response: apiError("Meilenstein konnte nicht geladen werden.", 500) };
  if (!result.data) return { ok: false as const, response: apiError("Meilenstein wurde nicht gefunden.", 404) };
  return { ok: true as const, milestone: result.data };
}

export async function PATCH(request: NextRequest, routeContext: MilestoneRouteContext) {
  const context = await requireJsonApiContext<unknown>(request, requireOperationalLead, null);
  if (!context.ok) return context.response;

  const parsed = parseMilestonePatchRequest(context.payload);
  if (!parsed.ok) return apiError(parsed.error, 400);

  const { id } = await routeContext.params;
  const current = await loadMilestoneOrResponse(context.supabase, id);
  if (!current.ok) return current.response;

  const { data, error } = await updateProjectMilestone(
    context.supabase,
    current.milestone.id,
    parsed.value.expectedUpdatedAt,
    parsed.value.update,
    context.permission.profile?.id || "",
  );
  if (error) return apiError("Meilenstein konnte nicht gespeichert werden.", 500);
  if (!data) return apiError("Meilenstein wurde zwischenzeitlich geändert. Bitte neu laden.", 409);

  await context.supabase.from("audit_log").insert({
    actor_profile_id: context.permission.profile?.id || null,
    action: "milestone.update",
    entity_type: "milestone",
    entity_id: current.milestone.id,
    before_data: current.milestone,
    after_data: data,
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({ ok: true, milestone: mapMilestoneRow(data) });
}

export async function DELETE(request: NextRequest, routeContext: MilestoneRouteContext) {
  const context = await requireJsonApiContext<unknown>(request, requireOperationalLead, null);
  if (!context.ok) return context.response;

  const parsed = parseEmptyEpicDeletePayload(context.payload);
  if (!parsed.ok) return apiError(parsed.error, 400);

  const { id } = await routeContext.params;
  const actor = actorContextFromSessionAuth({
    ok: true,
    profile: context.permission.profile ? {
      id: context.permission.profile.id,
      platformRole: context.permission.profile.platformRole,
    } : null,
  });
  if (!actor.ok) return apiError("Nur CEO oder Deputy können Epics löschen.", 403);
  const metadata = auditRequestMetadata(request);
  const result = await createEmptyEpicDeletePlanningItems(context.supabase).run({
    actor: actor.actor,
    mode: "commit",
    command: emptyEpicDeleteCommand(id.trim(), parsed.expectedUpdatedAt),
    requestMetadata: {
      requestIp: metadata.request_ip || undefined,
      userAgent: metadata.user_agent || undefined,
    },
  });
  if (!result.ok) {
    const mapped = emptyEpicDeleteError(result.error);
    if (mapped.code && mapped.children) {
      return NextResponse.json({ code: mapped.code, error: mapped.message, children: mapped.children }, { status: mapped.status });
    }
    if (result.error.code === "notFound") return apiError("Meilenstein wurde nicht gefunden.", 404);
    if (result.error.code === "conflict" && result.error.reason === "revision") {
      return apiError("Meilenstein wurde zwischenzeitlich geändert. Bitte neu laden.", 409);
    }
    if (result.error.code === "dependencyUnavailable") return apiError("Meilenstein konnte nicht gelöscht werden.", 500);
    return apiError(mapped.message, mapped.status);
  }
  const milestone = emptyEpicDeleteMilestone(result);
  if (!milestone) return apiError("Meilenstein konnte nicht gelöscht werden.", 500);

  return NextResponse.json({ ok: true, milestone });
}
