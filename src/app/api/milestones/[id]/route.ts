import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { requireOperationalLead } from "@/lib/authz";
import {
  deleteProjectMilestone,
  isMilestoneNotEmptyDatabaseError,
  loadMilestoneChildCounts,
  loadProjectMilestone,
  mapMilestoneRow,
  milestoneNotEmptyError,
  parseMilestoneDeleteRequest,
  parseMilestonePatchRequest,
  updateProjectMilestone,
} from "@/features/projects/model/milestone-server";
import { buildMilestoneDeletePolicy } from "@/features/projects/model/milestone-policy";

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
    id,
    parsed.value.expectedUpdatedAt,
    parsed.value.update,
  );
  if (error) return apiError("Meilenstein konnte nicht gespeichert werden.", 500);
  if (!data) return apiError("Meilenstein wurde zwischenzeitlich geändert. Bitte neu laden.", 409);

  await context.supabase.from("audit_log").insert({
    actor_profile_id: context.permission.profile?.id || null,
    action: "milestone.update",
    entity_type: "milestone",
    entity_id: id,
    before_data: current.milestone,
    after_data: data,
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({ ok: true, milestone: mapMilestoneRow(data) });
}

export async function DELETE(request: NextRequest, routeContext: MilestoneRouteContext) {
  const context = await requireJsonApiContext<unknown>(request, requireOperationalLead, null);
  if (!context.ok) return context.response;

  const parsed = parseMilestoneDeleteRequest(context.payload);
  if (!parsed.ok) return apiError(parsed.error, 400);

  const { id } = await routeContext.params;
  const current = await loadMilestoneOrResponse(context.supabase, id);
  if (!current.ok) return current.response;

  const childCounts = await loadMilestoneChildCounts(context.supabase, id);
  if (!childCounts.ok) return apiError("Meilenstein-Zuordnungen konnten nicht geprüft werden.", 500);
  const deletePolicy = buildMilestoneDeletePolicy(childCounts.counts);
  if (!deletePolicy.canDelete) {
    return NextResponse.json(milestoneNotEmptyError(deletePolicy.children), { status: 409 });
  }

  const { data, error } = await deleteProjectMilestone(context.supabase, id, parsed.value.expectedUpdatedAt);
  if (error && isMilestoneNotEmptyDatabaseError(error)) {
    const [freshTarget, freshChildren] = await Promise.all([
      loadProjectMilestone(context.supabase, id),
      loadMilestoneChildCounts(context.supabase, id),
    ]);
    if (!freshTarget.error && freshTarget.data && freshChildren.ok) {
      const freshPolicy = buildMilestoneDeletePolicy(freshChildren.counts);
      if (!freshPolicy.canDelete) {
        return NextResponse.json(milestoneNotEmptyError(freshPolicy.children), { status: 409 });
      }
    }
  }
  if (error) return apiError("Meilenstein konnte nicht gelöscht werden.", 500);
  if (!data) return apiError("Meilenstein wurde zwischenzeitlich geändert. Bitte neu laden.", 409);

  await context.supabase.from("audit_log").insert({
    actor_profile_id: context.permission.profile?.id || null,
    action: "milestone.delete",
    entity_type: "milestone",
    entity_id: id,
    before_data: data,
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({ ok: true, milestone: mapMilestoneRow(data) });
}
