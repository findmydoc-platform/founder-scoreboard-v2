import { NextResponse, type NextRequest } from "next/server";
import { requireOperationalLead } from "@/lib/authz";
import { getGoogleCalendarEvents, isGoogleCalendarSyncConfigured, type GoogleCalendarEvent } from "@/lib/google-calendar";
import { getServerSupabase } from "@/lib/supabase";
import type { AvailabilityEntry } from "@/lib/types";

export const runtime = "nodejs";

type CalendarProfileRow = {
  id: string;
  name: string;
  google_calendar_email: string | null;
  google_calendar_sync_enabled: boolean | null;
};

type AvailabilityRow = {
  id: number;
  profile_id: string;
  type: AvailabilityEntry["type"];
  weekday: number | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
  source: AvailabilityEntry["source"] | null;
  external_id: string | null;
  external_calendar_id: string | null;
  synced_at: string | null;
};

const syncWindowDays = 14;
const berlinDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const berlinTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function previousDateKey(value: string) {
  return dateKey(addDays(new Date(`${value}T00:00:00Z`), -1));
}

function berlinParts(value: string) {
  const date = new Date(value);
  return {
    date: berlinDateFormatter.format(date),
    time: berlinTimeFormatter.format(date),
  };
}

function mapEventToAvailability(profile: CalendarProfileRow, event: GoogleCalendarEvent, syncedAt: string) {
  const eventId = event.id?.trim();
  if (!eventId || !event.start || !event.end) return null;

  let startDate = "";
  let endDate = "";
  let startTime = "00:00";
  let endTime = "23:59";

  if (event.start.date && event.end.date) {
    startDate = event.start.date;
    endDate = previousDateKey(event.end.date);
  } else if (event.start.dateTime && event.end.dateTime) {
    const start = berlinParts(event.start.dateTime);
    const end = berlinParts(event.end.dateTime);
    startDate = start.date;
    endDate = end.date;
    startTime = start.time;
    endTime = end.time === "00:00" ? "23:59" : end.time;
  }

  if (!startDate || !endDate) return null;

  return {
    profile_id: profile.id,
    type: "busy" as const,
    weekday: null,
    start_date: startDate,
    end_date: endDate,
    start_time: startTime,
    end_time: endTime,
    note: event.summary ? `Google Kalender: ${event.summary}` : "Google Kalender: belegt",
    source: "google_calendar" as const,
    external_id: eventId,
    external_calendar_id: profile.google_calendar_email,
    synced_at: syncedAt,
  };
}

function mapAvailability(row: AvailabilityRow): AvailabilityEntry {
  return {
    id: row.id,
    profileId: row.profile_id,
    type: row.type,
    weekday: row.weekday,
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    startTime: row.start_time?.slice(0, 5) || "",
    endTime: row.end_time?.slice(0, 5) || "",
    note: row.note || "",
    source: row.source || "manual",
    externalId: row.external_id || "",
    externalCalendarId: row.external_calendar_id || "",
    syncedAt: row.synced_at || "",
  };
}

export async function POST(request: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireOperationalLead(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });
  if (!permission.profile) return NextResponse.json({ error: "Profil konnte nicht bestimmt werden." }, { status: 403 });

  if (!isGoogleCalendarSyncConfigured()) {
    return NextResponse.json({
      ready: false,
      skipped: true,
      reason: "Google Calendar ist noch nicht konfiguriert.",
      requiredEnv: ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_KEY"],
    });
  }

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id,name,google_calendar_email,google_calendar_sync_enabled")
    .eq("google_calendar_sync_enabled", true)
    .not("google_calendar_email", "is", null)
    .order("name");

  if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 });

  const enabledProfiles = (profiles || []) as CalendarProfileRow[];
  if (!enabledProfiles.length) {
    return NextResponse.json({
      ready: true,
      skipped: true,
      reason: "Noch kein Profil ist für Google Calendar Sync aktiviert.",
      results: [],
    });
  }

  const syncedAt = new Date().toISOString();
  const from = dateKey(new Date());
  const to = dateKey(addDays(new Date(), syncWindowDays));
  const results: Array<{ profileId: string; email: string; imported: number; error?: string }> = [];
  let imported = 0;

  for (const profile of enabledProfiles) {
    const email = profile.google_calendar_email || "";
    try {
      const events = await getGoogleCalendarEvents(email, from, to);
      let profileImported = 0;

      for (const event of events) {
        const row = mapEventToAvailability(profile, event, syncedAt);
        if (!row) continue;

        const { data: existing } = await supabase
          .from("availability")
          .select("id")
          .eq("source", "google_calendar")
          .eq("external_calendar_id", email)
          .eq("external_id", row.external_id)
          .maybeSingle();

        if (existing?.id) {
          const { error } = await supabase.from("availability").update(row).eq("id", existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("availability").insert(row);
          if (error) throw error;
        }
        profileImported += 1;
      }

      await supabase.from("profiles").update({ google_calendar_last_synced_at: syncedAt }).eq("id", profile.id);
      results.push({ profileId: profile.id, email, imported: profileImported });
      imported += profileImported;
    } catch (error) {
      results.push({
        profileId: profile.id,
        email,
        imported: 0,
        error: error instanceof Error ? error.message : "Google Calendar Sync fehlgeschlagen.",
      });
    }
  }

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile.id,
    action: "availability.google_calendar_sync",
    entity_type: "availability",
    entity_id: "google_calendar",
    after_data: { from, to, results },
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent"),
  });

  const { data: availabilityRows, error: availabilityError } = await supabase
    .from("availability")
    .select("id,profile_id,type,weekday,start_date,end_date,start_time,end_time,note,source,external_id,external_calendar_id,synced_at")
    .order("start_date");

  if (availabilityError) return NextResponse.json({ error: availabilityError.message }, { status: 500 });

  return NextResponse.json({
    ready: true,
    syncedAt,
    window: { from, to },
    imported,
    results,
    availability: ((availabilityRows || []) as AvailabilityRow[]).map(mapAvailability),
  });
}
