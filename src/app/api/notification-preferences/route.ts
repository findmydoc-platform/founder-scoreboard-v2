import { NextResponse, type NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
import { googleChatDigestEventTypes } from "@/lib/notification-policy";
import { getServerSupabase } from "@/lib/supabase";

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
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireFounder(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });
  if (!permission.profile) return NextResponse.json({ error: "Profil konnte nicht bestimmt werden." }, { status: 403 });

  const payload = (await request.json().catch(() => ({}))) as PreferencePayload;
  const profileId = typeof payload.profileId === "string" ? payload.profileId.trim() : "";
  const eventType = typeof payload.eventType === "string" ? payload.eventType.trim() : "";

  if (!profileId) return NextResponse.json({ error: "Profil ist erforderlich." }, { status: 400 });
  if (!allowedEventTypes.has(eventType)) return NextResponse.json({ error: "Unbekannter Benachrichtigungstyp." }, { status: 400 });
  if (typeof payload.enabled !== "boolean") return NextResponse.json({ error: "Status ist erforderlich." }, { status: 400 });
  if (!canEditProfilePreference(permission.profile.id, permission.profile.platformRole, profileId)) {
    return NextResponse.json({ error: "Keine Berechtigung für diese Benachrichtigungseinstellung." }, { status: 403 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", profileId)
    .single();

  if (profileError || !profile) return NextResponse.json({ error: "Profil wurde nicht gefunden." }, { status: 404 });

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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent"),
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
