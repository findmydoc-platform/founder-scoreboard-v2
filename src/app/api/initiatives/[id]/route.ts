import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { requirePlanningContributor } from "@/lib/authz";
import { isOperationalLeadRole } from "@/lib/platform";
import { apiError, requireApiContext } from "@/lib/api-response";
import {
  assertInitiativeReferenceRows,
  cleanProfileIds,
  initiativePriorities,
  initiativeSelect,
  initiativeStatuses,
  validateProfileIds,
  type InitiativePayload,
} from "@/features/projects/model/initiative-api";
import { mapPackage } from "@/lib/planning-profile-mappers";
import type { DbPackage } from "@/lib/planning-data-row-types";
import { requireActivePlanningItem } from "@/lib/planning-trash-mutation-guard";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireApiContext(request, requirePlanningContributor);
  if (!apiContext.ok) return apiContext.response;

  const { permission, supabase } = apiContext;

  const { id } = await context.params;
  const activeItem = await requireActivePlanningItem(supabase, "packages", id);
  if (!activeItem.ok) return apiError(activeItem.error, activeItem.status);
  const { data: current, error: currentError } = await supabase
    .from("packages")
    .select(initiativeSelect)
    .eq("id", id)
    .single();

  if (currentError || !current) return apiError("Initiative wurde nicht gefunden.", 404);

  const isOperationalLead = isOperationalLeadRole(permission.profile?.platformRole);
  const isInitiativeOwner = current.owner_id === permission.profile?.id;
  if (!isOperationalLead && !isInitiativeOwner) {
    return apiError("Nur CEO, Deputy oder der Initiative-Owner können diese Initiative bearbeiten.", 403);
  }

  const payload = (await request.json()) as InitiativePayload;
  if (payload.priority && !initiativePriorities.has(payload.priority)) return apiError("Ungültige Priorität.", 400);
  if (payload.status && !initiativeStatuses.has(payload.status)) return apiError("Ungültiger Initiative-Status.", 400);

  const restrictedForOwner = [
    payload.ownerId !== undefined && payload.ownerId !== (current.owner_id || "") ? "Owner" : "",
    payload.milestoneId !== undefined && payload.milestoneId !== (current.milestone_id || "") ? "Meilenstein" : "",
    payload.accountableProfileId !== undefined && payload.accountableProfileId !== (current.accountable_profile_id || current.owner_id || "") ? "Accountable" : "",
  ].filter(Boolean);
  if (!isOperationalLead && restrictedForOwner.length) {
    return apiError(`Diese Initiative-Felder sind geschützt: ${restrictedForOwner.join(", ")}.`, 403);
  }

  const referenceError = await assertInitiativeReferenceRows(supabase, payload);
  if (referenceError) return apiError(referenceError, 404);

  const raciProfileIds = [
    payload.accountableProfileId !== undefined ? payload.accountableProfileId : "",
    ...(payload.responsibleProfileIds !== undefined ? cleanProfileIds(payload.responsibleProfileIds) : []),
    ...(payload.consultedProfileIds !== undefined ? cleanProfileIds(payload.consultedProfileIds) : []),
    ...(payload.informedProfileIds !== undefined ? cleanProfileIds(payload.informedProfileIds) : []),
  ];
  const raciReferenceError = await validateProfileIds(supabase, raciProfileIds);
  if (raciReferenceError) return apiError(raciReferenceError, 404);

  const update: Record<string, string | string[] | number | null> = {};
  if (payload.title !== undefined) {
    const title = payload.title.trim().slice(0, 240);
    if (title.length < 3) return apiError("Titel ist erforderlich.", 400);
    update.title = title;
  }
  if (payload.milestoneId !== undefined) update.milestone_id = payload.milestoneId || null;
  if (payload.ownerId !== undefined) update.owner_id = payload.ownerId || null;
  if (payload.accountableProfileId !== undefined) {
    const accountableProfileId = payload.accountableProfileId.trim();
    if (!accountableProfileId) return apiError("Accountable ist erforderlich.", 400);
    update.accountable_profile_id = accountableProfileId;
  }
  if (payload.responsibleProfileIds !== undefined) {
    const responsibleProfileIds = cleanProfileIds(payload.responsibleProfileIds);
    if (!responsibleProfileIds.length) return apiError("Responsible ist erforderlich.", 400);
    update.responsible_profile_ids = responsibleProfileIds;
  }
  if (payload.consultedProfileIds !== undefined) update.consulted_profile_ids = cleanProfileIds(payload.consultedProfileIds);
  if (payload.informedProfileIds !== undefined) update.informed_profile_ids = cleanProfileIds(payload.informedProfileIds);
  if (payload.priority !== undefined) update.priority = payload.priority || "P2";
  if (payload.status !== undefined) update.status = payload.status || "planned";
  if (payload.targetDate !== undefined) update.target_date = payload.targetDate || null;
  if (payload.goal !== undefined) update.goal = payload.goal.trim().slice(0, 4000);
  if (payload.successCriteria !== undefined) update.success_criteria = payload.successCriteria.trim().slice(0, 4000);
  if (payload.scopeConstraints !== undefined) update.scope_constraints = payload.scopeConstraints.trim().slice(0, 4000);

  const materialChange = [
    ["title", current.title],
    ["goal", current.goal],
    ["success_criteria", current.success_criteria],
    ["scope_constraints", current.scope_constraints],
    ["milestone_id", current.milestone_id],
  ].some(([field, previous]) => field in update && update[field] !== (previous || null));
  if (materialChange) {
    update.approval_status = "proposed";
    update.approval_revision = Number(current.approval_revision || 1) + 1;
    update.proposed_by = permission.profile?.id || null;
    update.proposed_at = new Date().toISOString();
    update.decided_by = null;
    update.decided_at = null;
    update.decision_note = null;
  }

  if (!Object.keys(update).length) return NextResponse.json({ ok: true, initiative: mapPackage(current as DbPackage) });

  const { data: updated, error } = await supabase
    .from("packages")
    .update(update)
    .eq("id", id)
    .eq("approval_revision", Number(current.approval_revision || 1))
    .select("*")
    .maybeSingle();

  if (error) return apiError(error.message || "Initiative konnte nicht gespeichert werden.", 500);
  if (!updated) return apiError("Initiative wurde zwischenzeitlich geändert. Bitte neu laden.", 409);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "initiative.update",
    entity_type: "initiative",
    entity_id: id,
    before_data: current,
    after_data: update,
    ...auditRequestMetadata(request),
  });

  if (materialChange && update.approval_status === "proposed") {
    await supabase.from("audit_log").insert({
      actor_profile_id: permission.profile?.id || null,
      action: current.approval_status === "approved"
        ? "initiative.approval_reset"
        : current.approval_status === "proposed"
          ? "initiative.approval_revised"
          : "initiative.approval_resubmitted",
      entity_type: "initiative",
      entity_id: id,
      before_data: { approvalStatus: current.approval_status, revision: current.approval_revision },
      after_data: { approvalStatus: "proposed", revision: update.approval_revision },
      ...auditRequestMetadata(request),
    });
  }

  return NextResponse.json({ ok: true, initiative: mapPackage(updated as DbPackage) });
}
