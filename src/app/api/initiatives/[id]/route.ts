import { NextResponse, type NextRequest } from "next/server";
import { cleanText } from "@/lib/api-input";
import { requirePlanningContributor } from "@/lib/authz";
import { isOperationalLeadRole } from "@/lib/platform";
import { apiError, requireApiContext } from "@/lib/api-response";
import {
  cleanProfileIds,
  initiativePriorities,
  resolveInitiativeRaci,
  validateProfileIds,
  type InitiativePayload,
} from "@/features/projects/model/initiative-api";
import {
  legacyInitiativeFromCanonical,
  loadCanonicalStrategicItem,
  resolveCanonicalStrategicItemId,
} from "@/features/projects/model/planning-legacy-adapters";

function strategicStatus(value?: string) {
  if (value === "active") return "In Arbeit";
  if (value === "paused") return "Pausiert";
  if (value === "done") return "Erledigt";
  return "Offen";
}

function hasOwn(input: object, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireApiContext(request, requirePlanningContributor);
  if (!apiContext.ok) return apiContext.response;

  const { permission, supabase } = apiContext;
  const { id } = await context.params;
  const current = await loadCanonicalStrategicItem(supabase, id, "initiative");
  if (!current) return apiError("Initiative wurde nicht gefunden.", 404);

  const isOperationalLead = isOperationalLeadRole(permission.profile?.platformRole);
  const isInitiativeOwner = current.task.ownerId === permission.profile?.id;
  if (!isOperationalLead && !isInitiativeOwner) {
    return apiError("Nur CEO, Deputy oder der Initiative-Owner können diese Initiative bearbeiten.", 403);
  }

  const raw = await request.json() as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return apiError("Initiative-Änderung ist ungültig.", 400);
  const payload = raw as InitiativePayload;
  if (payload.priority && !initiativePriorities.has(payload.priority)) return apiError("Ungültige Priorität.", 400);

  const raciFields = ["accountableProfileId", "responsibleProfileIds", "consultedProfileIds", "informedProfileIds"];
  const parentTaskId = payload.milestoneId === undefined
    ? undefined
    : payload.milestoneId
      ? await resolveCanonicalStrategicItemId(supabase, payload.milestoneId, "epic")
      : null;
  if (payload.milestoneId && !parentTaskId) return apiError("Epic wurde nicht gefunden.", 404);

  const restrictedForOwner = [
    payload.ownerId !== undefined && payload.ownerId !== current.task.ownerId ? "Owner" : "",
    payload.milestoneId !== undefined && parentTaskId !== current.task.parentTaskId ? "Epic" : "",
    raciFields.some((field) => hasOwn(payload, field)) ? "RACI" : "",
  ].filter(Boolean);
  if (!isOperationalLead && restrictedForOwner.length) {
    return apiError(`Diese Initiative-Felder sind geschützt: ${restrictedForOwner.join(", ")}.`, 403);
  }

  if (payload.title !== undefined && cleanText(payload.title, 240).length < 3) {
    return apiError("Titel ist erforderlich.", 400);
  }
  if (payload.ownerId !== undefined) {
    const ownerError = await validateProfileIds(supabase, [payload.ownerId]);
    if (ownerError) return apiError(ownerError, 404);
  }

  let raciAssignments: Array<{ profileId: string; role: string; sortOrder: number }> | null = null;
  if (raciFields.some((field) => hasOwn(payload, field))) {
    const existing = current.task.raciAssignments || [];
    const existingIds = (role: string) => existing
      .filter((assignment) => assignment.role === role)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((assignment) => assignment.profileId);
    const resolved = resolveInitiativeRaci({
      ...payload,
      ownerId: payload.ownerId === undefined ? current.task.ownerId : payload.ownerId,
      accountableProfileId: payload.accountableProfileId === undefined ? existingIds("accountable")[0] || current.task.ownerId : payload.accountableProfileId,
      responsibleProfileIds: payload.responsibleProfileIds === undefined ? existingIds("responsible") : cleanProfileIds(payload.responsibleProfileIds),
      consultedProfileIds: payload.consultedProfileIds === undefined ? existingIds("consulted") : cleanProfileIds(payload.consultedProfileIds),
      informedProfileIds: payload.informedProfileIds === undefined ? existingIds("informed") : cleanProfileIds(payload.informedProfileIds),
    });
    if (!resolved.accountableProfileId) return apiError("Accountable ist erforderlich.", 400);
    if (!resolved.responsibleProfileIds.length) return apiError("Responsible ist erforderlich.", 400);
    const profileError = await validateProfileIds(supabase, [
      resolved.accountableProfileId,
      ...resolved.responsibleProfileIds,
      ...resolved.consultedProfileIds,
      ...resolved.informedProfileIds,
    ]);
    if (profileError) return apiError(profileError, 404);
    raciAssignments = [
      { profileId: resolved.accountableProfileId, role: "accountable", sortOrder: 0 },
      ...resolved.responsibleProfileIds.map((profileId, index) => ({ profileId, role: "responsible", sortOrder: index })),
      ...resolved.consultedProfileIds.map((profileId, index) => ({ profileId, role: "consulted", sortOrder: index })),
      ...resolved.informedProfileIds.map((profileId, index) => ({ profileId, role: "informed", sortOrder: index })),
    ];
  }

  const patch: Record<string, string | null> = {};
  if (payload.title !== undefined) patch.title = cleanText(payload.title, 240);
  if (payload.ownerId !== undefined) {
    patch.owner = payload.ownerId || null;
    patch.assignee = payload.ownerId || null;
  }
  if (payload.priority !== undefined) patch.priority = payload.priority || "P2";
  if (payload.status !== undefined) patch.status = strategicStatus(payload.status);
  if (payload.targetDate !== undefined) patch.target_date = payload.targetDate || null;
  if (parentTaskId !== undefined) patch.parent_task_id = parentTaskId;
  const strategyFieldsChanged = payload.goal !== undefined || payload.successCriteria !== undefined || payload.scopeConstraints !== undefined;
  const strategy = strategyFieldsChanged ? {
    goal: cleanText(payload.goal === undefined ? current.task.strategy?.goal : payload.goal, 4_000),
    successCriteria: cleanText(payload.successCriteria === undefined ? current.task.strategy?.successCriteria : payload.successCriteria, 4_000),
    scopeConstraints: cleanText(payload.scopeConstraints === undefined ? current.task.strategy?.scopeConstraints : payload.scopeConstraints, 4_000),
  } : null;
  if (!Object.keys(patch).length && !strategy && !raciAssignments) {
    return NextResponse.json({ ok: true, initiative: legacyInitiativeFromCanonical(current) });
  }

  const { error } = await supabase.rpc("update_planning_item_transaction", {
    p_task_id: current.id,
    p_expected_updated_at: current.task.updatedAt,
    p_patch: patch,
    p_strategy: strategy,
    p_raci_assignments: raciAssignments,
    p_actor_profile_id: permission.profile?.id || null,
  });
  if (error) {
    if (error.code === "P0001") return apiError("Initiative wurde zwischenzeitlich geändert. Bitte neu laden.", 409);
    if (error.code === "23514" || error.code === "22023") return apiError(error.message || "Initiative ist ungültig.", 400);
    return apiError(error.message || "Initiative konnte nicht gespeichert werden.", 500);
  }

  const updated = await loadCanonicalStrategicItem(supabase, current.id, "initiative");
  if (!updated) return apiError("Initiative konnte nicht geladen werden.", 500);
  return NextResponse.json({ ok: true, initiative: legacyInitiativeFromCanonical(updated) });
}
