import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanOptionalDate, cleanOptionalText } from "@/lib/api-input";
import { requireCEO } from "@/lib/authz";
import { mapNotificationPreference, mapProfile } from "@/lib/planning-data-mappers";
import type { DbNotificationPreference, DbProfile } from "@/lib/planning-data-row-types";
import { googleChatDigestEventTypes } from "@/lib/notification-policy";
import type { NotificationPreference, PlatformRole } from "@/lib/types";
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
  notificationEvents?: Record<string, boolean>;
};

type ProfileAdminTransactionResult = {
  profile?: DbProfile;
  notification_preferences?: DbNotificationPreference[];
};

const platformRoles = new Set<PlatformRole>(["ceo", "founder", "deputy", "viewer"]);
const allowedEventTypes = new Set<string>(googleChatDigestEventTypes);

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
    if (typeof payload.notificationsEnabled !== "boolean") {
      return apiError("Benachrichtigungsstatus ist ungültig.", 400);
    }
    update.notifications_enabled = payload.notificationsEnabled;
  }

  if (update.platform_role && update.platform_role !== "deputy") {
    update.deputy_for = null;
    update.deputy_active_from = null;
    update.deputy_active_until = null;
  }

  const notificationEvents: Record<string, boolean> = {};
  if (payload.notificationEvents !== undefined) {
    if (!payload.notificationEvents || typeof payload.notificationEvents !== "object") {
      return apiError("Benachrichtigungseinstellungen sind ungültig.", 400);
    }
    for (const [eventType, enabled] of Object.entries(payload.notificationEvents)) {
      if (!allowedEventTypes.has(eventType)) return apiError("Unbekannter Benachrichtigungstyp.", 400);
      if (typeof enabled !== "boolean") return apiError("Benachrichtigungsstatus ist erforderlich.", 400);
      notificationEvents[eventType] = enabled;
    }
  }

  const metadata = auditRequestMetadata(request);
  const { data: transactionData, error: transactionError } = await supabase.rpc("update_profile_admin_transaction", {
    p_profile_id: id,
    p_actor_profile_id: permission.profile?.id || "",
    p_profile_patch: update,
    p_notification_events: notificationEvents,
    p_request_ip: metadata.request_ip,
    p_user_agent: metadata.user_agent,
  });

  if (transactionError) {
    if (transactionError.code === "P0002") return apiError("Profil wurde nicht gefunden.", 404);
    if (transactionError.code === "23514") return apiError("Genau ein CEO muss gesetzt bleiben.", 409);
    if (transactionError.code === "22023") return apiError("Profiländerung ist ungültig.", 400);
    return apiError(transactionError.message, 500);
  }

  const result = transactionData as ProfileAdminTransactionResult | null;
  if (!result?.profile) return apiError("Profil konnte nicht gespeichert werden.", 500);

  const profile = mapProfile(result.profile);
  const notificationPreferences: NotificationPreference[] = (result.notification_preferences || []).map(mapNotificationPreference);

  return NextResponse.json({
    profile,
    notificationPreferences,
  });
}
