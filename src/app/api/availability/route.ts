import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanDate, cleanTime } from "@/lib/api-input";
import { requireFounder } from "@/lib/authz";
import { isOperationalLeadRole } from "@/lib/platform";
import type { AvailabilityEntry } from "@/lib/types";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

type AvailabilityPayload = {
  id?: number;
  profileId?: string;
  type?: AvailabilityEntry["type"];
  title?: string;
  blockerKind?: AvailabilityEntry["blockerKind"];
  weekday?: number | null;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  note?: string;
};

const availabilityTypes = new Set(["working_hours", "busy", "vacation", "sick"]);
const blockerKinds = new Set([
  "working_hours",
  "on_business",
  "customer_appointment",
  "internal_meeting",
  "focus_time",
  "admin",
  "travel",
  "private_appointment",
  "vacation",
  "sick",
  "care",
  "calendar_event",
  "other",
]);

function mapAvailability(row: {
  id: number;
  profile_id: string;
  type: AvailabilityEntry["type"];
  title: string | null;
  blocker_kind: AvailabilityEntry["blockerKind"] | null;
  weekday: number | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
  source?: AvailabilityEntry["source"] | null;
  external_id?: string | null;
  external_calendar_id?: string | null;
  synced_at?: string | null;
}): AvailabilityEntry {
  return {
    id: row.id,
    profileId: row.profile_id,
    type: row.type,
    title: row.title || "",
    blockerKind: row.blocker_kind || (row.type === "working_hours" ? "working_hours" : row.type === "vacation" ? "vacation" : row.type === "sick" ? "sick" : "on_business"),
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
  const context = await requireJsonApiContext<AvailabilityPayload>(request, requireFounder, {});
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  if (!permission.profile) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const profileId = typeof payload.profileId === "string" ? payload.profileId.trim() : "";
  const type = typeof payload.type === "string" && availabilityTypes.has(payload.type) ? payload.type : "";
  const title = typeof payload.title === "string" ? payload.title.trim().slice(0, 160) : "";
  const blockerKind = typeof payload.blockerKind === "string" && blockerKinds.has(payload.blockerKind) ? payload.blockerKind : type === "working_hours" ? "working_hours" : type === "vacation" ? "vacation" : type === "sick" ? "sick" : "on_business";
  const startTime = cleanTime(payload.startTime);
  const endTime = cleanTime(payload.endTime);

  if (!profileId) return apiError("Profil ist erforderlich.", 400);
  if (!type) return apiError("Typ ist erforderlich.", 400);
  if (!startTime || !endTime || startTime >= endTime) return apiError("Start- und Endzeit sind ungültig.", 400);
  if (!isOperationalLeadRole(permission.profile.platformRole) && profileId !== permission.profile.id) {
    return apiError("Founder können nur eigene Verfügbarkeiten pflegen.", 403);
  }

  const { data: targetProfile, error: profileError } = await supabase.from("profiles").select("id").eq("id", profileId).single();
  if (profileError || !targetProfile) return apiError("Profil wurde nicht gefunden.", 404);

  const row: Record<string, string | number | null> = {
    profile_id: profileId,
    type,
    title,
    blocker_kind: blockerKind,
    start_time: startTime,
    end_time: endTime,
    note: typeof payload.note === "string" ? payload.note.trim().slice(0, 1000) : null,
    created_by: permission.profile.id,
    source: "manual",
  };

  if (type === "working_hours") {
    const weekday = Number(payload.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return apiError("Wochentag ist ungültig.", 400);
    row.weekday = weekday;
    row.start_date = null;
    row.end_date = null;
  } else {
    const startDate = cleanDate(payload.startDate);
    const endDate = cleanDate(payload.endDate) || startDate;
    if (!startDate || !endDate || startDate > endDate) return apiError("Datumsbereich ist ungültig.", 400);
    row.weekday = null;
    row.start_date = startDate;
    row.end_date = endDate;
  }

  const { data: availability, error } = await supabase
    .from("availability")
    .insert(row)
    .select("id,profile_id,type,title,blocker_kind,weekday,start_date,end_date,start_time,end_time,note,source,external_id,external_calendar_id,synced_at")
    .single();

  if (error) return apiError(error.message, 500);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile.id,
    action: "availability.create",
    entity_type: "availability",
    entity_id: String(availability.id),
    after_data: row,
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({ availability: mapAvailability(availability) });
}

export async function DELETE(request: NextRequest) {
  const context = await requireJsonApiContext<AvailabilityPayload>(request, requireFounder, {});
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  if (!permission.profile) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const id = Number(payload.id);
  if (!Number.isFinite(id)) return apiError("Eintrag ist erforderlich.", 400);

  const { data: current, error: readError } = await supabase
    .from("availability")
    .select("id,profile_id,type,title,blocker_kind,weekday,start_date,end_date,start_time,end_time,note,source,external_id,external_calendar_id,synced_at")
    .eq("id", id)
    .single();

  if (readError || !current) return apiError("Eintrag wurde nicht gefunden.", 404);
  if (!isOperationalLeadRole(permission.profile.platformRole) && current.profile_id !== permission.profile.id) {
    return apiError("Founder können nur eigene Verfügbarkeiten löschen.", 403);
  }

  const { error } = await supabase.from("availability").delete().eq("id", id);
  if (error) return apiError(error.message, 500);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile.id,
    action: "availability.delete",
    entity_type: "availability",
    entity_id: String(id),
    before_data: current,
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest) {
  const context = await requireJsonApiContext<AvailabilityPayload>(request, requireFounder, {});
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  if (!permission.profile) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const id = Number(payload.id);
  if (!Number.isFinite(id)) return apiError("Eintrag ist erforderlich.", 400);

  const { data: current, error: readError } = await supabase
    .from("availability")
    .select("id,profile_id,type,title,blocker_kind,weekday,start_date,end_date,start_time,end_time,note,source,external_id,external_calendar_id,synced_at")
    .eq("id", id)
    .single();

  if (readError || !current) return apiError("Eintrag wurde nicht gefunden.", 404);
  if (current.source === "google_calendar") {
    return apiError("Importierte Google-Kalenderblöcke können nicht in der App bearbeitet werden.", 403);
  }
  if (!isOperationalLeadRole(permission.profile.platformRole) && current.profile_id !== permission.profile.id) {
    return apiError("Founder können nur eigene Verfügbarkeiten bearbeiten.", 403);
  }

  const profileId = typeof payload.profileId === "string" ? payload.profileId.trim() : current.profile_id;
  const type = typeof payload.type === "string" && availabilityTypes.has(payload.type) ? payload.type : current.type;
  const title = typeof payload.title === "string" ? payload.title.trim().slice(0, 160) : current.title;
  const blockerKind = typeof payload.blockerKind === "string" && blockerKinds.has(payload.blockerKind) ? payload.blockerKind : current.blocker_kind;
  const startTime = cleanTime(payload.startTime) || current.start_time?.slice(0, 5) || "";
  const endTime = cleanTime(payload.endTime) || current.end_time?.slice(0, 5) || "";

  if (!profileId) return apiError("Profil ist erforderlich.", 400);
  if (!type) return apiError("Typ ist erforderlich.", 400);
  if (!startTime || !endTime || startTime >= endTime) return apiError("Start- und Endzeit sind ungültig.", 400);
  if (!isOperationalLeadRole(permission.profile.platformRole) && profileId !== permission.profile.id) {
    return apiError("Founder können Einträge nicht auf andere Profile übertragen.", 403);
  }

  const { data: targetProfile, error: profileError } = await supabase.from("profiles").select("id").eq("id", profileId).single();
  if (profileError || !targetProfile) return apiError("Profil wurde nicht gefunden.", 404);

  const row: Record<string, string | number | null> = {
    profile_id: profileId,
    type,
    title,
    blocker_kind: blockerKind,
    start_time: startTime,
    end_time: endTime,
    note: typeof payload.note === "string" ? payload.note.trim().slice(0, 1000) : current.note,
  };

  if (type === "working_hours") {
    const weekday = Number(payload.weekday ?? current.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return apiError("Wochentag ist ungültig.", 400);
    row.weekday = weekday;
    row.start_date = null;
    row.end_date = null;
  } else {
    const startDate = cleanDate(payload.startDate) || current.start_date || "";
    const endDate = cleanDate(payload.endDate) || current.end_date || startDate;
    if (!startDate || !endDate || startDate > endDate) return apiError("Datumsbereich ist ungültig.", 400);
    row.weekday = null;
    row.start_date = startDate;
    row.end_date = endDate;
  }

  const { data: availability, error } = await supabase
    .from("availability")
    .update(row)
    .eq("id", id)
    .select("id,profile_id,type,title,blocker_kind,weekday,start_date,end_date,start_time,end_time,note,source,external_id,external_calendar_id,synced_at")
    .single();

  if (error) return apiError(error.message, 500);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile.id,
    action: "availability.update",
    entity_type: "availability",
    entity_id: String(id),
    before_data: current,
    after_data: row,
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({ availability: mapAvailability(availability) });
}
