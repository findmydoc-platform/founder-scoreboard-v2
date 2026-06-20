import { NextResponse, type NextRequest } from "next/server";
import { cleanOptionalDate, cleanOptionalText } from "@/lib/api-input";
import { requireCEO } from "@/lib/authz";
import type { PlatformRole } from "@/lib/types";
import { apiError, requireApiContext } from "@/lib/api-response";

type UpdatePayload = {
  githubLogin?: string;
  platformRole?: PlatformRole;
  orgRole?: string;
  deputyFor?: string;
  deputyActiveFrom?: string;
  deputyActiveUntil?: string;
  focus?: string;
  weeklyCapacity?: number;
  color?: string;
  googleChatUserId?: string;
  googleChatDmSpace?: string;
  notificationsEnabled?: boolean;
  googleCalendarEmail?: string;
  googleCalendarSyncEnabled?: boolean;
};

const platformRoles = new Set<PlatformRole>(["ceo", "founder", "deputy", "viewer"]);

function cleanColor(value: unknown) {
  if (typeof value !== "string") return undefined;
  return /^#[0-9A-Fa-f]{6}$/.test(value) ? value : undefined;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireApiContext(request, requireCEO);
  if (!apiContext.ok) return apiContext.response;

  const { permission, supabase } = apiContext;

  const { id } = await context.params;
  const payload = (await request.json()) as UpdatePayload;
  const update: Record<string, string | number | boolean | null> = {};

  if (payload.githubLogin !== undefined) {
    update.github_login = cleanOptionalText(payload.githubLogin, 80) || null;
  }

  if (payload.platformRole !== undefined) {
    if (!platformRoles.has(payload.platformRole)) {
      return apiError("Ungültige Plattformrolle.", 400);
    }
    update.platform_role = payload.platformRole;
  }

  if (payload.orgRole !== undefined) update.org_role = cleanOptionalText(payload.orgRole, 80) || null;
  if (payload.focus !== undefined) update.focus = cleanOptionalText(payload.focus, 240) || null;

  if (payload.color !== undefined) {
    const color = cleanColor(payload.color);
    if (!color) return apiError("Ungültige Profilfarbe.", 400);
    update.profile_color = color;
  }

  if (payload.weeklyCapacity !== undefined) {
    const capacity = Number(payload.weeklyCapacity);
    if (!Number.isFinite(capacity) || capacity < 0 || capacity > 80) {
      return apiError("Kapazität muss zwischen 0 und 80 Stunden liegen.", 400);
    }
    update.weekly_capacity = Math.round(capacity);
  }

  if (payload.deputyFor !== undefined) update.deputy_for = cleanOptionalText(payload.deputyFor, 80) || null;

  if (payload.deputyActiveFrom !== undefined) {
    const value = cleanOptionalDate(payload.deputyActiveFrom);
    if (value === undefined) return apiError("Ungültiges Startdatum.", 400);
    update.deputy_active_from = value;
  }

  if (payload.deputyActiveUntil !== undefined) {
    const value = cleanOptionalDate(payload.deputyActiveUntil);
    if (value === undefined) return apiError("Ungültiges Enddatum.", 400);
    update.deputy_active_until = value;
  }

  if (payload.googleChatUserId !== undefined) {
    update.google_chat_user_id = cleanOptionalText(payload.googleChatUserId, 160) || null;
  }

  if (payload.googleChatDmSpace !== undefined) {
    update.google_chat_dm_space = cleanOptionalText(payload.googleChatDmSpace, 240) || null;
  }

  if (payload.notificationsEnabled !== undefined) {
    update.notifications_enabled = Boolean(payload.notificationsEnabled);
  }

  if (payload.googleCalendarEmail !== undefined) {
    update.google_calendar_email = cleanOptionalText(payload.googleCalendarEmail, 240) || null;
  }

  if (payload.googleCalendarSyncEnabled !== undefined) {
    update.google_calendar_sync_enabled = Boolean(payload.googleCalendarSyncEnabled);
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

  if (readError) return apiError(readError.message, 500);

  const current = currentProfiles.find((profile) => profile.id === id);
  if (!current) return apiError("Profil wurde nicht gefunden.", 404);

  if (update.platform_role && update.platform_role !== "ceo") {
    const otherCeoExists = currentProfiles.some((profile) => profile.id !== id && profile.platform_role === "ceo");
    if (current.platform_role === "ceo" && !otherCeoExists) {
      return apiError("Mindestens ein CEO muss gesetzt bleiben.", 400);
    }
  }

  if (update.platform_role === "ceo") {
    const { error: demoteError } = await supabase
      .from("profiles")
      .update({ platform_role: "founder", org_role: "Founder", deputy_for: null, deputy_active_from: null, deputy_active_until: null })
      .neq("id", id)
      .eq("platform_role", "ceo");

    if (demoteError) return apiError(demoteError.message, 500);
  }

  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", id)
    .select("id,name,role,platform_role,org_role,github_login,deputy_for,deputy_active_from,deputy_active_until,focus,weekly_capacity,profile_color,google_chat_user_id,google_chat_dm_space,notifications_enabled,google_calendar_email,google_calendar_sync_enabled,google_calendar_last_synced_at")
    .single();

  if (updateError) return apiError(updateError.message, 500);

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
      color: updated.profile_color || "#64748b",
      googleChatUserId: updated.google_chat_user_id || "",
      googleChatDmSpace: updated.google_chat_dm_space || "",
      notificationsEnabled: updated.notifications_enabled !== false,
      googleCalendarEmail: updated.google_calendar_email || "",
      googleCalendarSyncEnabled: Boolean(updated.google_calendar_sync_enabled),
      googleCalendarLastSyncedAt: updated.google_calendar_last_synced_at || "",
    },
  });
}
