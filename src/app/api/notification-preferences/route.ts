import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { requireFounder } from "@/lib/authz";
import { googleChatDigestEventTypes } from "@/lib/notification-policy";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

type PreferencePayload = {
  profileId?: string;
  eventType?: string;
  enabled?: boolean;
};

const allowedEventTypes = new Set<string>(googleChatDigestEventTypes);

function canEditProfilePreference(actorProfileId: string, actorRole: string, targetProfileId: string) {
  return actorProfileId === targetProfileId || actorRole === "ceo" || actorRole === "deputy";
}

export async function PATCH(request: NextRequest) {
  const context = await requireJsonApiContext<PreferencePayload>(request, requireFounder, {});
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  if (!permission.profile) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const profileId = typeof payload.profileId === "string" ? payload.profileId.trim() : "";
  const eventType = typeof payload.eventType === "string" ? payload.eventType.trim() : "";

  if (!profileId) return apiError("Profil ist erforderlich.", 400);
  if (!allowedEventTypes.has(eventType)) return apiError("Unbekannter Benachrichtigungstyp.", 400);
  if (typeof payload.enabled !== "boolean") return apiError("Status ist erforderlich.", 400);
  if (!canEditProfilePreference(permission.profile.id, permission.profile.platformRole, profileId)) {
    return apiError("Keine Berechtigung für diese Benachrichtigungseinstellung.", 403);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", profileId)
    .single();

  if (profileError || !profile) return apiError("Profil wurde nicht gefunden.", 404);

  const { data: preference, error } = await supabase
    .from("notification_preferences")
    .upsert({
      profile_id: profileId,
      channel: "google_chat",
      event_type: eventType,
      enabled: payload.enabled,
      updated_at: new Date().toISOString(),
    }, { onConflict: "profile_id,channel,event_type" })
    .select("id,profile_id,channel,event_type,enabled")
    .single();

  if (error) return apiError(error.message, 500);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile.id,
    action: "notification_preference.update",
    entity_type: "notification_preference",
    entity_id: `${profileId}:${eventType}`,
    after_data: {
      profile_id: profileId,
      channel: "google_chat",
      event_type: eventType,
      enabled: payload.enabled,
    },
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({
    preference: {
      id: preference.id,
      profileId: preference.profile_id,
      channel: preference.channel,
      eventType: preference.event_type,
      enabled: preference.enabled,
    },
  });
}
