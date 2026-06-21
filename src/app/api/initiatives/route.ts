import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requireOperationalLead, requirePlatformRole } from "@/lib/authz";
import { apiError, requireApiContext, requireJsonApiContext } from "@/lib/api-response";
import {
  assertInitiativeReferenceRows,
  buildInitiativeInsert,
  founderProjectId,
  initiativePriorities,
  initiativeSelect,
  initiativeStatuses,
  mapInitiative,
  resolveInitiativeRaci,
  validateProfileIds,
  type InitiativePayload,
} from "@/features/projects/model/initiative-api";

export async function GET(request: NextRequest) {
  const context = await requireApiContext(
    request,
    (innerRequest) => requirePlatformRole(innerRequest, ["ceo", "founder", "deputy", "viewer"]),
  );
  if (!context.ok) return context.response;

  const { supabase } = context;
  const { data, error } = await supabase
    .from("packages")
    .select(initiativeSelect)
    .eq("project_id", founderProjectId)
    .order("sort_order");

  if (error) return apiError(error.message, 500);
  return NextResponse.json({ ok: true, initiatives: (data || []).map((row) => mapInitiative(row)) });
}

export async function POST(request: NextRequest) {
  const context = await requireJsonApiContext<InitiativePayload>(request, requireOperationalLead, {});
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  const title = cleanText(payload.title, 240);
  if (title.length < 3) return apiError("Titel ist erforderlich.", 400);
  if (!payload.milestoneId) return apiError("Meilenstein ist erforderlich.", 400);
  if (!payload.ownerId) return apiError("Initiative-Owner ist erforderlich.", 400);
  if (payload.priority && !initiativePriorities.has(payload.priority)) return apiError("Ungültige Priorität.", 400);
  if (payload.status && !initiativeStatuses.has(payload.status)) return apiError("Ungültiger Initiative-Status.", 400);

  const referenceError = await assertInitiativeReferenceRows(supabase, payload);
  if (referenceError) return apiError(referenceError, 404);

  const { accountableProfileId, responsibleProfileIds, consultedProfileIds, informedProfileIds } = resolveInitiativeRaci(payload);
  if (!accountableProfileId) return apiError("Accountable ist erforderlich.", 400);
  if (!responsibleProfileIds.length) return apiError("Responsible ist erforderlich.", 400);
  const raciReferenceError = await validateProfileIds(supabase, [
    accountableProfileId,
    ...responsibleProfileIds,
    ...consultedProfileIds,
    ...informedProfileIds,
  ]);
  if (raciReferenceError) return apiError(raciReferenceError, 404);

  const { data: maxRow } = await supabase
    .from("packages")
    .select("sort_order")
    .eq("project_id", founderProjectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { id, row: insert } = buildInitiativeInsert(payload, title, Number(maxRow?.sort_order || 0));

  const { data: created, error } = await supabase.from("packages").insert(insert).select("*").single();
  if (error || !created) return apiError(error?.message || "Initiative konnte nicht erstellt werden.", 500);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "initiative.create",
    entity_type: "initiative",
    entity_id: id,
    after_data: insert,
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({ ok: true, initiative: mapInitiative(created) });
}
