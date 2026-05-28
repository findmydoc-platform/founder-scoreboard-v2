import { NextResponse, type NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";
import type { AvailabilityEntry } from "@/lib/types";

type AvailabilityPayload = {
  id?: number;
  profileId?: string;
  type?: AvailabilityEntry["type"];
  weekday?: number | null;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  note?: string;
};

const availabilityTypes = new Set(["working_hours", "busy", "vacation", "sick"]);

function isOperationalLead(role: string) {
  return role === "ceo" || role === "deputy";
}

function cleanDate(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function cleanTime(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  return /^\d{2}:\d{2}$/.test(value) ? value : "";
}

function mapAvailability(row: {
  id: number;
  profile_id: string;
  type: AvailabilityEntry["type"];
  weekday: number | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
}): AvailabilityEntry {
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
  };
}

export async function POST(request: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireFounder(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });
  if (!permission.profile) return NextResponse.json({ error: "Profil konnte nicht bestimmt werden." }, { status: 403 });

  const payload = (await request.json().catch(() => ({}))) as AvailabilityPayload;
  const profileId = typeof payload.profileId === "string" ? payload.profileId.trim() : "";
  const type = typeof payload.type === "string" && availabilityTypes.has(payload.type) ? payload.type : "";
  const startTime = cleanTime(payload.startTime);
  const endTime = cleanTime(payload.endTime);

  if (!profileId) return NextResponse.json({ error: "Profil ist erforderlich." }, { status: 400 });
  if (!type) return NextResponse.json({ error: "Typ ist erforderlich." }, { status: 400 });
  if (!startTime || !endTime || startTime >= endTime) return NextResponse.json({ error: "Start- und Endzeit sind ungültig." }, { status: 400 });
  if (!isOperationalLead(permission.profile.platformRole) && profileId !== permission.profile.id) {
    return NextResponse.json({ error: "Founder können nur eigene Verfügbarkeiten pflegen." }, { status: 403 });
  }

  const { data: targetProfile, error: profileError } = await supabase.from("profiles").select("id").eq("id", profileId).single();
  if (profileError || !targetProfile) return NextResponse.json({ error: "Profil wurde nicht gefunden." }, { status: 404 });

  const row: Record<string, string | number | null> = {
    profile_id: profileId,
    type,
    start_time: startTime,
    end_time: endTime,
    note: typeof payload.note === "string" ? payload.note.trim().slice(0, 1000) : null,
    created_by: permission.profile.id,
  };

  if (type === "working_hours") {
    const weekday = Number(payload.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return NextResponse.json({ error: "Wochentag ist ungültig." }, { status: 400 });
    row.weekday = weekday;
    row.start_date = null;
    row.end_date = null;
  } else {
    const startDate = cleanDate(payload.startDate);
    const endDate = cleanDate(payload.endDate) || startDate;
    if (!startDate || !endDate || startDate > endDate) return NextResponse.json({ error: "Datumsbereich ist ungültig." }, { status: 400 });
    row.weekday = null;
    row.start_date = startDate;
    row.end_date = endDate;
  }

  const { data: availability, error } = await supabase
    .from("availability")
    .insert(row)
    .select("id,profile_id,type,weekday,start_date,end_date,start_time,end_time,note")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile.id,
    action: "availability.create",
    entity_type: "availability",
    entity_id: String(availability.id),
    after_data: row,
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ availability: mapAvailability(availability) });
}

export async function DELETE(request: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireFounder(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });
  if (!permission.profile) return NextResponse.json({ error: "Profil konnte nicht bestimmt werden." }, { status: 403 });

  const payload = (await request.json().catch(() => ({}))) as AvailabilityPayload;
  const id = Number(payload.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Eintrag ist erforderlich." }, { status: 400 });

  const { data: current, error: readError } = await supabase
    .from("availability")
    .select("id,profile_id,type,weekday,start_date,end_date,start_time,end_time,note")
    .eq("id", id)
    .single();

  if (readError || !current) return NextResponse.json({ error: "Eintrag wurde nicht gefunden." }, { status: 404 });
  if (!isOperationalLead(permission.profile.platformRole) && current.profile_id !== permission.profile.id) {
    return NextResponse.json({ error: "Founder können nur eigene Verfügbarkeiten löschen." }, { status: 403 });
  }

  const { error } = await supabase.from("availability").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile.id,
    action: "availability.delete",
    entity_type: "availability",
    entity_id: String(id),
    before_data: current,
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true });
}
