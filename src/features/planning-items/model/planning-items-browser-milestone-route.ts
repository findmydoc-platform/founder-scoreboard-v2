import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError, requireApiContext, requireJsonApiContext } from "@/lib/api-response";
import { requireOperationalLead, requireTeamMember } from "@/lib/authz";
import {
  insertProjectMilestone,
  listProjectMilestones,
  mapMilestoneRow,
  parseMilestoneCreateRequest,
} from "@/features/projects/model/milestone-server";
import { actorContextFromSessionAuth } from "@/features/planning-items/model/planning-actor-context-server";

export async function handleBrowserMilestonesRead(request: NextRequest) {
  const context = await requireApiContext(request, requireTeamMember);
  if (!context.ok) return context.response;

  const { data, error } = await listProjectMilestones(context.supabase);
  if (error) return apiError("Meilensteine konnten nicht geladen werden.", 500);
  return NextResponse.json({
    ok: true,
    milestones: (data || []).map(mapMilestoneRow),
  });
}

export async function handleBrowserMilestoneCreate(request: NextRequest) {
  const context = await requireJsonApiContext<unknown>(request, requireOperationalLead, null);
  if (!context.ok) return context.response;

  const parsed = parseMilestoneCreateRequest(context.payload);
  if (!parsed.ok) return apiError(parsed.error, 400);
  const actor = actorContextFromSessionAuth({ ok: true, profile: context.permission.profile });
  if (!actor.ok) return apiError("Meilenstein konnte nicht erstellt werden.", 500);
  const metadata = auditRequestMetadata(request);

  const { data, error } = await insertProjectMilestone(
    context.supabase,
    parsed.value,
    actor.actor,
    { requestIp: metadata.request_ip || undefined, userAgent: metadata.user_agent || undefined },
  );
  if (error || !data) return apiError("Meilenstein konnte nicht erstellt werden.", 500);

  return NextResponse.json({ ok: true, milestone: mapMilestoneRow(data) });
}
