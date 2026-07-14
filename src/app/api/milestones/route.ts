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

export async function GET(request: NextRequest) {
  const context = await requireApiContext(request, requireTeamMember);
  if (!context.ok) return context.response;

  const { data, error } = await listProjectMilestones(context.supabase);
  if (error) return apiError("Meilensteine konnten nicht geladen werden.", 500);
  return NextResponse.json({
    ok: true,
    milestones: (data || []).map(mapMilestoneRow),
  });
}

export async function POST(request: NextRequest) {
  const context = await requireJsonApiContext<unknown>(request, requireOperationalLead, null);
  if (!context.ok) return context.response;

  const parsed = parseMilestoneCreateRequest(context.payload);
  if (!parsed.ok) return apiError(parsed.error, 400);

  const { data, error } = await insertProjectMilestone(context.supabase, parsed.value);
  if (error || !data) return apiError("Meilenstein konnte nicht erstellt werden.", 500);

  await context.supabase.from("audit_log").insert({
    actor_profile_id: context.permission.profile?.id || null,
    action: "milestone.create",
    entity_type: "milestone",
    entity_id: data.id,
    after_data: data,
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({ ok: true, milestone: mapMilestoneRow(data) });
}
