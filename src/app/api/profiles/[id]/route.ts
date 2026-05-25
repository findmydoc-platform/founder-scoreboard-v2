import { NextResponse, type NextRequest } from "next/server";
import { requireCEO } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";
import type { PlatformRole } from "@/lib/types";

type UpdatePayload = {
  githubLogin?: string;
  platformRole?: PlatformRole;
  orgRole?: string;
  deputyFor?: string;
  deputyActiveFrom?: string;
  deputyActiveUntil?: string;
  focus?: string;
  weeklyCapacity?: number;
};

const platformRoles = new Set<PlatformRole>(["ceo", "founder", "deputy", "viewer"]);

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : "";
}

function cleanDate(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });
  }

  const permission = await requireCEO(request);
  if (!permission.ok) {
    return NextResponse.json({ error: permission.error }, { status: permission.status });
  }

  const { id } = await context.params;
  const payload = (await request.json()) as UpdatePayload;
  const update: Record<string, string | number | null> = {};

  if (payload.githubLogin !== undefined) {
    update.github_login = cleanText(payload.githubLogin, 80) || null;
  }

  if (payload.platformRole !== undefined) {
    if (!platformRoles.has(payload.platformRole)) {
      return NextResponse.json({ error: "Ungültige Plattformrolle." }, { status: 400 });
    }
    update.platform_role = payload.platformRole;
  }

  if (payload.orgRole !== undefined) update.org_role = cleanText(payload.orgRole, 80) || null;
  if (payload.focus !== undefined) update.focus = cleanText(payload.focus, 240) || null;

  if (payload.weeklyCapacity !== undefined) {
    const capacity = Number(payload.weeklyCapacity);
    if (!Number.isFinite(capacity) || capacity < 0 || capacity > 80) {
      return NextResponse.json({ error: "Kapazität muss zwischen 0 und 80 Stunden liegen." }, { status: 400 });
    }
    update.weekly_capacity = Math.round(capacity);
  }

  if (payload.deputyFor !== undefined) update.deputy_for = cleanText(payload.deputyFor, 80) || null;

  if (payload.deputyActiveFrom !== undefined) {
    const value = cleanDate(payload.deputyActiveFrom);
    if (value === undefined) return NextResponse.json({ error: "Ungültiges Startdatum." }, { status: 400 });
    update.deputy_active_from = value;
  }

  if (payload.deputyActiveUntil !== undefined) {
    const value = cleanDate(payload.deputyActiveUntil);
    if (value === undefined) return NextResponse.json({ error: "Ungültiges Enddatum." }, { status: 400 });
    update.deputy_active_until = value;
  }

  if (update.platform_role && update.platform_role !== "deputy") {
    update.deputy_for = null;
    update.deputy_active_from = null;
    update.deputy_active_until = null;
  }

  const { data: currentProfiles, error: readError } = await supabase
    .from("profiles")
    .select("id,platform_role")
    .order("id");

  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

  const current = currentProfiles.find((profile) => profile.id === id);
  if (!current) return NextResponse.json({ error: "Profil wurde nicht gefunden." }, { status: 404 });

  if (update.platform_role && update.platform_role !== "ceo") {
    const otherCeoExists = currentProfiles.some((profile) => profile.id !== id && profile.platform_role === "ceo");
    if (current.platform_role === "ceo" && !otherCeoExists) {
      return NextResponse.json({ error: "Mindestens ein CEO muss gesetzt bleiben." }, { status: 400 });
    }
  }

  if (update.platform_role === "ceo") {
    const { error: demoteError } = await supabase
      .from("profiles")
      .update({ platform_role: "founder", org_role: "Founder", deputy_for: null, deputy_active_from: null, deputy_active_until: null })
      .neq("id", id)
      .eq("platform_role", "ceo");

    if (demoteError) return NextResponse.json({ error: demoteError.message }, { status: 500 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", id)
    .select("id,name,role,platform_role,org_role,github_login,deputy_for,deputy_active_from,deputy_active_until,focus,weekly_capacity")
    .single();

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id,
    action: "profile.update",
    entity_type: "profile",
    entity_id: id,
    after_data: update,
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent"),
  });

  return NextResponse.json({
    profile: {
      id: updated.id,
      name: updated.name,
      role: updated.role,
      platformRole: updated.platform_role,
      orgRole: updated.org_role || "",
      githubLogin: updated.github_login || "",
      deputyFor: updated.deputy_for || "",
      deputyActiveFrom: updated.deputy_active_from || "",
      deputyActiveUntil: updated.deputy_active_until || "",
      focus: updated.focus || "",
      weeklyCapacity: updated.weekly_capacity,
    },
  });
}
