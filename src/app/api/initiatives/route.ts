import { NextResponse, type NextRequest } from "next/server";
import { cleanText } from "@/lib/api-input";
import { requireOperationalLead, requirePlatformRole } from "@/lib/authz";
import { apiError, requireApiContext, requireJsonApiContext } from "@/lib/api-response";
import {
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
import { mapPackage } from "@/lib/planning-profile-mappers";
import type { DbPackage } from "@/lib/planning-data-row-types";
import { ACTIVE_PACKAGES_TABLE } from "@/lib/planning-read-model";
import { slugify } from "@/lib/slug";

function strategicStatus(value?: string) {
  if (value === "active") return "In Arbeit";
  if (value === "paused") return "Pausiert";
  if (value === "done") return "Erledigt";
  return "Offen";
}

export async function GET(request: NextRequest) {
  const context = await requireApiContext(
    request,
    (innerRequest) => requirePlatformRole(innerRequest, ["ceo", "founder", "deputy", "viewer"]),
  );
  if (!context.ok) return context.response;

  // active_packages is a security-invoker projection of canonical Initiative
  // tasks.  The old packages table is intentionally never read here.
  const { data, error } = await context.supabase
    .from(ACTIVE_PACKAGES_TABLE)
    .select("*")
    .eq("project_id", "findmydoc-founder-execution")
    .order("sort_order");
  if (error) return apiError(error.message, 500);
  return NextResponse.json({ ok: true, initiatives: (data || []).map((row) => mapPackage(row as DbPackage)) });
}

export async function POST(request: NextRequest) {
  const context = await requireJsonApiContext<InitiativePayload>(request, requireOperationalLead, {});
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  const isCeo = permission.profile?.platformRole === "ceo";
  if (payload.approveNow && !isCeo) return apiError("Nur der CEO kann beim Erstellen direkt freigeben.", 403);
  const title = cleanText(payload.title, 240);
  if (title.length < 3) return apiError("Titel ist erforderlich.", 400);
  if (!payload.ownerId) return apiError("Initiative-Owner ist erforderlich.", 400);
  if (payload.priority && !initiativePriorities.has(payload.priority)) return apiError("Ungültige Priorität.", 400);

  const parentTaskId = payload.milestoneId
    ? await resolveCanonicalStrategicItemId(supabase, payload.milestoneId, "epic")
    : null;
  if (payload.milestoneId && !parentTaskId) return apiError("Epic wurde nicht gefunden.", 404);
  const ownerResult = await validateProfileIds(supabase, [payload.ownerId]);
  if (ownerResult) return apiError(ownerResult, 404);

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

  const { data: maxRow, error: maxError } = await supabase
    .from("tasks")
    .select("sort_order")
    .eq("project_id", "findmydoc-founder-execution")
    .eq("task_type", "initiative")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();
  if (maxError) return apiError(maxError.message, 500);

  const id = `initiative-${slugify(title, { maxLength: 60 }) || "neu"}-${Date.now().toString(36)}`;
  const { data, error } = await supabase.rpc("create_planning_item_transaction", {
    p_item: {
      id,
      project_id: "findmydoc-founder-execution",
      task_type: "initiative",
      title,
      description: cleanText(payload.goal, 4_000),
      status: strategicStatus(payload.status),
      priority: payload.priority || "P2",
      owner: payload.ownerId,
      assignee: payload.ownerId,
      parent_task_id: parentTaskId,
      target_date: payload.targetDate || null,
      sort_order: Number(maxRow?.sort_order || 0) + 1,
    },
    p_strategy: {
      goal: cleanText(payload.goal, 4_000),
      successCriteria: cleanText(payload.successCriteria, 4_000),
      scopeConstraints: cleanText(payload.scopeConstraints, 4_000),
    },
    p_raci_assignments: [
      { profileId: accountableProfileId, role: "accountable", sortOrder: 0 },
      ...responsibleProfileIds.map((profileId, index) => ({ profileId, role: "responsible", sortOrder: index })),
      ...consultedProfileIds.map((profileId, index) => ({ profileId, role: "consulted", sortOrder: index })),
      ...informedProfileIds.map((profileId, index) => ({ profileId, role: "informed", sortOrder: index })),
    ],
    p_actor_profile_id: permission.profile?.id || null,
  });
  const createdId = (data as { task?: { id?: string } } | null)?.task?.id;
  if (error || !createdId) {
    if (error?.code === "23505") return apiError("Initiative existiert bereits.", 409);
    if (error?.code === "23514" || error?.code === "22023") return apiError(error.message || "Initiative ist ungültig.", 400);
    return apiError(error?.message || "Initiative konnte nicht erstellt werden.", 500);
  }

  if (payload.approveNow) {
    const approval = await supabase.rpc("decide_planning_item_approval_transaction", {
      p_task_id: createdId,
      p_expected_revision: 1,
      p_action: "approve",
      p_actor_profile_id: permission.profile?.id || "",
      p_note: "Bei Erstellung durch CEO freigegeben.",
    });
    if (approval.error) return apiError(approval.error.message || "Initiative konnte nicht freigegeben werden.", 400);
  }

  const created = await loadCanonicalStrategicItem(supabase, createdId, "initiative");
  if (!created) return apiError("Initiative konnte nicht geladen werden.", 500);
  return NextResponse.json({ ok: true, initiative: legacyInitiativeFromCanonical(created) });
}
