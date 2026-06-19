import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requireOperationalLead, requirePlatformRole } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";
import type { Package } from "@/lib/types";
import { apiError, authzError, supabaseUnavailable } from "@/lib/api-response";

type InitiativePayload = {
  title?: string;
  milestoneId?: string;
  ownerId?: string;
  accountableProfileId?: string;
  responsibleProfileIds?: string[];
  consultedProfileIds?: string[];
  informedProfileIds?: string[];
  priority?: string;
  status?: Package["status"];
  targetDate?: string;
  goal?: string;
  successCriteria?: string;
  scopeConstraints?: string;
};

const priorities = new Set(["P0", "P1", "P2", "P3", "P4"]);
const statuses = new Set(["planned", "active", "done", "paused"]);
const projectId = "findmydoc-founder-execution";

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function mapInitiative(row: Record<string, unknown>): Package {
  const ownerId = String(row.owner_id || "");
  const accountableProfileId = String(row.accountable_profile_id || ownerId);
  const responsibleProfileIds = Array.isArray(row.responsible_profile_ids) ? row.responsible_profile_ids.map(String) : ownerId ? [ownerId] : [];
  return {
    id: String(row.id || ""),
    milestoneId: String(row.milestone_id || ""),
    ownerId,
    accountableProfileId,
    responsibleProfileIds,
    consultedProfileIds: Array.isArray(row.consulted_profile_ids) ? row.consulted_profile_ids.map(String) : [],
    informedProfileIds: Array.isArray(row.informed_profile_ids) ? row.informed_profile_ids.map(String) : [],
    title: String(row.title || ""),
    goal: String(row.goal || ""),
    priority: String(row.priority || "P2"),
    status: (row.status as Package["status"]) || "planned",
    targetDate: String(row.target_date || ""),
    successCriteria: String(row.success_criteria || ""),
    scopeConstraints: String(row.scope_constraints || ""),
    sortOrder: Number(row.sort_order || 0),
  };
}

function cleanProfileIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

async function validateProfileIds(
  supabase: NonNullable<ReturnType<typeof getServerSupabase>>,
  profileIds: string[],
) {
  const uniqueIds = [...new Set(profileIds.filter(Boolean))];
  if (!uniqueIds.length) return "";
  const { data, error } = await supabase.from("profiles").select("id").in("id", uniqueIds);
  if (error) return error.message;
  const existing = new Set((data || []).map((profile) => profile.id));
  const missing = uniqueIds.filter((profileId) => !existing.has(profileId));
  return missing.length ? `Unbekannte Profil-ID: ${missing.join(", ")}.` : "";
}

async function assertReferenceRows(
  supabase: NonNullable<ReturnType<typeof getServerSupabase>>,
  payload: InitiativePayload,
) {
  if (payload.milestoneId) {
    const { data: milestone, error } = await supabase
      .from("milestones")
      .select("id")
      .eq("id", payload.milestoneId)
      .single();
    if (error || !milestone) return "Meilenstein wurde nicht gefunden.";
  }

  if (payload.ownerId) {
    const { data: owner, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", payload.ownerId)
      .single();
    if (error || !owner) return "Initiative-Owner wurde nicht gefunden.";
  }

  return "";
}

export async function GET(request: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) return supabaseUnavailable();

  const auth = await requirePlatformRole(request, ["ceo", "founder", "deputy", "viewer"]);
  if (!auth.ok) return authzError(auth);

  const { data, error } = await supabase
    .from("packages")
    .select("id,milestone_id,owner_id,accountable_profile_id,responsible_profile_ids,consulted_profile_ids,informed_profile_ids,title,goal,priority,status,target_date,success_criteria,scope_constraints,sort_order")
    .eq("project_id", projectId)
    .order("sort_order");

  if (error) return apiError(error.message, 500);
  return NextResponse.json({ ok: true, initiatives: (data || []).map((row) => mapInitiative(row)) });
}

export async function POST(request: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) return supabaseUnavailable();

  const permission = await requireOperationalLead(request);
  if (!permission.ok) return authzError(permission);

  const payload = (await request.json()) as InitiativePayload;
  const title = cleanText(payload.title, 240);
  if (title.length < 3) return apiError("Titel ist erforderlich.", 400);
  if (!payload.milestoneId) return apiError("Meilenstein ist erforderlich.", 400);
  if (!payload.ownerId) return apiError("Initiative-Owner ist erforderlich.", 400);
  if (payload.priority && !priorities.has(payload.priority)) return apiError("Ungültige Priorität.", 400);
  if (payload.status && !statuses.has(payload.status)) return apiError("Ungültiger Initiative-Status.", 400);

  const referenceError = await assertReferenceRows(supabase, payload);
  if (referenceError) return apiError(referenceError, 404);

  const accountableProfileId = cleanText(payload.accountableProfileId || payload.ownerId, 120);
  const responsibleProfileIds = cleanProfileIds(payload.responsibleProfileIds);
  const resolvedResponsibleProfileIds = responsibleProfileIds.length ? responsibleProfileIds : [payload.ownerId];
  const consultedProfileIds = cleanProfileIds(payload.consultedProfileIds);
  const informedProfileIds = cleanProfileIds(payload.informedProfileIds);
  if (!accountableProfileId) return apiError("Accountable ist erforderlich.", 400);
  if (!resolvedResponsibleProfileIds.length) return apiError("Responsible ist erforderlich.", 400);
  const raciReferenceError = await validateProfileIds(supabase, [
    accountableProfileId,
    ...resolvedResponsibleProfileIds,
    ...consultedProfileIds,
    ...informedProfileIds,
  ]);
  if (raciReferenceError) return apiError(raciReferenceError, 404);

  const { data: maxRow } = await supabase
    .from("packages")
    .select("sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const idBase = `initiative-${slugify(title) || "neu"}`;
  const id = `${idBase}-${Date.now().toString(36)}`;
  const insert = {
    id,
    project_id: projectId,
    milestone_id: payload.milestoneId,
    owner_id: payload.ownerId,
    accountable_profile_id: accountableProfileId,
    responsible_profile_ids: resolvedResponsibleProfileIds,
    consulted_profile_ids: consultedProfileIds,
    informed_profile_ids: informedProfileIds,
    title,
    goal: cleanText(payload.goal, 4000),
    priority: payload.priority && priorities.has(payload.priority) ? payload.priority : "P2",
    status: payload.status && statuses.has(payload.status) ? payload.status : "planned",
    target_date: payload.targetDate || null,
    success_criteria: cleanText(payload.successCriteria, 4000),
    scope_constraints: cleanText(payload.scopeConstraints, 4000),
    sort_order: Number(maxRow?.sort_order || 0) + 1,
  };

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
