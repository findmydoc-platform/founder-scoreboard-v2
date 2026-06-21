import { cleanText } from "@/lib/api-input";
import { slugify } from "@/lib/slug";
import { getServerSupabase } from "@/lib/supabase";
import type { Package } from "@/lib/types";

export type InitiativePayload = {
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

type SupabaseClient = NonNullable<ReturnType<typeof getServerSupabase>>;

export const initiativePriorities = new Set(["P0", "P1", "P2", "P3", "P4"]);
export const initiativeStatuses = new Set(["planned", "active", "done", "paused"]);
export const founderProjectId = "findmydoc-founder-execution";
export const initiativeSelect = "id,milestone_id,owner_id,accountable_profile_id,responsible_profile_ids,consulted_profile_ids,informed_profile_ids,title,goal,priority,status,target_date,success_criteria,scope_constraints,sort_order";

export function slugifyInitiativeId(value: string) {
  return slugify(value, { maxLength: 60 });
}

export function mapInitiative(row: Record<string, unknown>): Package {
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

export function cleanProfileIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

export async function validateProfileIds(supabase: SupabaseClient, profileIds: string[]) {
  const uniqueIds = [...new Set(profileIds.filter(Boolean))];
  if (!uniqueIds.length) return "";
  const { data, error } = await supabase.from("profiles").select("id").in("id", uniqueIds);
  if (error) return error.message;
  const existing = new Set((data || []).map((profile) => profile.id));
  const missing = uniqueIds.filter((profileId) => !existing.has(profileId));
  return missing.length ? `Unbekannte Profil-ID: ${missing.join(", ")}.` : "";
}

export async function assertInitiativeReferenceRows(supabase: SupabaseClient, payload: InitiativePayload) {
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

export function resolveInitiativeRaci(payload: InitiativePayload) {
  const accountableProfileId = cleanText(payload.accountableProfileId || payload.ownerId, 120);
  const responsibleProfileIds = cleanProfileIds(payload.responsibleProfileIds);
  const resolvedResponsibleProfileIds = responsibleProfileIds.length ? responsibleProfileIds : [payload.ownerId || ""];
  const consultedProfileIds = cleanProfileIds(payload.consultedProfileIds);
  const informedProfileIds = cleanProfileIds(payload.informedProfileIds);
  return {
    accountableProfileId,
    responsibleProfileIds: resolvedResponsibleProfileIds,
    consultedProfileIds,
    informedProfileIds,
  };
}

export function buildInitiativeInsert(payload: InitiativePayload, title: string, maxSortOrder: number) {
  const { accountableProfileId, responsibleProfileIds, consultedProfileIds, informedProfileIds } = resolveInitiativeRaci(payload);
  const idBase = `initiative-${slugifyInitiativeId(title) || "neu"}`;
  const id = `${idBase}-${Date.now().toString(36)}`;

  return {
    id,
    row: {
      id,
      project_id: founderProjectId,
      milestone_id: payload.milestoneId,
      owner_id: payload.ownerId,
      accountable_profile_id: accountableProfileId,
      responsible_profile_ids: responsibleProfileIds,
      consulted_profile_ids: consultedProfileIds,
      informed_profile_ids: informedProfileIds,
      title,
      goal: cleanText(payload.goal, 4000),
      priority: payload.priority && initiativePriorities.has(payload.priority) ? payload.priority : "P2",
      status: payload.status && initiativeStatuses.has(payload.status) ? payload.status : "planned",
      target_date: payload.targetDate || null,
      success_criteria: cleanText(payload.successCriteria, 4000),
      scope_constraints: cleanText(payload.scopeConstraints, 4000),
      sort_order: maxSortOrder + 1,
    },
    accountableProfileId,
    responsibleProfileIds,
    consultedProfileIds,
    informedProfileIds,
  };
}
