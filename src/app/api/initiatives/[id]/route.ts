import { NextResponse, type NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
import { isOperationalLeadRole } from "@/lib/platform";
import { getServerSupabase } from "@/lib/supabase";
import type { Package } from "@/lib/types";

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

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireFounder(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const { id } = await context.params;
  const { data: current, error: currentError } = await supabase
    .from("packages")
    .select("id,milestone_id,owner_id,accountable_profile_id,responsible_profile_ids,consulted_profile_ids,informed_profile_ids,title,goal,priority,status,target_date,success_criteria,scope_constraints,sort_order")
    .eq("id", id)
    .single();

  if (currentError || !current) return NextResponse.json({ error: "Initiative wurde nicht gefunden." }, { status: 404 });

  const isOperationalLead = isOperationalLeadRole(permission.profile?.platformRole);
  const isInitiativeOwner = current.owner_id === permission.profile?.id;
  if (!isOperationalLead && !isInitiativeOwner) {
    return NextResponse.json({ error: "Nur CEO, Deputy oder der Initiative-Owner können diese Initiative bearbeiten." }, { status: 403 });
  }

  const payload = (await request.json()) as InitiativePayload;
  if (payload.priority && !priorities.has(payload.priority)) return NextResponse.json({ error: "Ungültige Priorität." }, { status: 400 });
  if (payload.status && !statuses.has(payload.status)) return NextResponse.json({ error: "Ungültiger Initiative-Status." }, { status: 400 });

  const restrictedForOwner = [
    payload.ownerId !== undefined && payload.ownerId !== (current.owner_id || "") ? "Owner" : "",
    payload.milestoneId !== undefined && payload.milestoneId !== (current.milestone_id || "") ? "Meilenstein" : "",
    payload.accountableProfileId !== undefined && payload.accountableProfileId !== (current.accountable_profile_id || current.owner_id || "") ? "Accountable" : "",
  ].filter(Boolean);
  if (!isOperationalLead && restrictedForOwner.length) {
    return NextResponse.json({ error: `Diese Initiative-Felder sind geschützt: ${restrictedForOwner.join(", ")}.` }, { status: 403 });
  }

  const referenceError = await assertReferenceRows(supabase, payload);
  if (referenceError) return NextResponse.json({ error: referenceError }, { status: 404 });

  const raciProfileIds = [
    payload.accountableProfileId !== undefined ? payload.accountableProfileId : "",
    ...(payload.responsibleProfileIds !== undefined ? cleanProfileIds(payload.responsibleProfileIds) : []),
    ...(payload.consultedProfileIds !== undefined ? cleanProfileIds(payload.consultedProfileIds) : []),
    ...(payload.informedProfileIds !== undefined ? cleanProfileIds(payload.informedProfileIds) : []),
  ];
  const raciReferenceError = await validateProfileIds(supabase, raciProfileIds);
  if (raciReferenceError) return NextResponse.json({ error: raciReferenceError }, { status: 404 });

  const update: Record<string, string | string[] | null> = {};
  if (payload.title !== undefined) {
    const title = payload.title.trim().slice(0, 240);
    if (title.length < 3) return NextResponse.json({ error: "Titel ist erforderlich." }, { status: 400 });
    update.title = title;
  }
  if (payload.milestoneId !== undefined) update.milestone_id = payload.milestoneId || null;
  if (payload.ownerId !== undefined) update.owner_id = payload.ownerId || null;
  if (payload.accountableProfileId !== undefined) {
    const accountableProfileId = payload.accountableProfileId.trim();
    if (!accountableProfileId) return NextResponse.json({ error: "Accountable ist erforderlich." }, { status: 400 });
    update.accountable_profile_id = accountableProfileId;
  }
  if (payload.responsibleProfileIds !== undefined) {
    const responsibleProfileIds = cleanProfileIds(payload.responsibleProfileIds);
    if (!responsibleProfileIds.length) return NextResponse.json({ error: "Responsible ist erforderlich." }, { status: 400 });
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

  if (!Object.keys(update).length) return NextResponse.json({ ok: true, initiative: mapInitiative(current) });

  const { data: updated, error } = await supabase
    .from("packages")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !updated) return NextResponse.json({ error: error?.message || "Initiative konnte nicht gespeichert werden." }, { status: 500 });

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "initiative.update",
    entity_type: "initiative",
    entity_id: id,
    before_data: current,
    after_data: update,
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, initiative: mapInitiative(updated) });
}
