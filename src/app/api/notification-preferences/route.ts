import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { authorizeCredentialAction } from "@/lib/credentials";
import { googleChatDigestEventTypes } from "@/lib/notification-policy";
import { apiError, authzError } from "@/lib/api-response";

type PreferencePayload = {
  profileId?: string;
  eventType?: string;
  enabled?: boolean;
};

const allowedEventTypes = new Set<string>(googleChatDigestEventTypes);

export async function PATCH(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "account.notifications.update" });
  if (!permission.ok) return authzError(permission);
  const payload = await request.json().catch(() => ({})) as PreferencePayload;
  if (!permission.profile) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const profileId = typeof payload.profileId === "string" ? payload.profileId.trim() : "";
  const eventType = typeof payload.eventType === "string" ? payload.eventType.trim() : "";

  if (!profileId) return apiError("Profil ist erforderlich.", 400);
  if (!allowedEventTypes.has(eventType)) return apiError("Unbekannter Benachrichtigungstyp.", 400);
  if (typeof payload.enabled !== "boolean") return apiError("Status ist erforderlich.", 400);
  const { data: preference, error } = await permission.account.updateNotificationPreference({ profileId, eventType, enabled: payload.enabled, metadata: auditRequestMetadata(request) });
  if (error) return apiError(error.message, error.status);
  if (!preference) return apiError("Profil wurde nicht gefunden.", 404);

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
