import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanDate, cleanTime } from "@/lib/api-input";
import { requireFounder } from "@/lib/authz";
import { isOperationalLeadRole } from "@/lib/platform";
import { mapAvailability } from "@/lib/planning-data-mappers";
import type { AvailabilityEntry, PlatformRole } from "@/lib/types";
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
const availabilitySelect = "id,profile_id,type,title,blocker_kind,weekday,start_date,end_date,start_time,end_time,note,source,external_id,external_calendar_id,synced_at";

type ActorProfile = {
  id: string;
  platformRole?: PlatformRole | null;
};

type AvailabilityRow = {
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
  source: string | null;
};

function availabilityAccessError(profile: ActorProfile, profileId: string, message: string) {
  return !isOperationalLeadRole(profile.platformRole) && profileId !== profile.id ? message : "";
}

function fallbackBlockerKind(type: AvailabilityEntry["type"] | "") {
  return type === "working_hours" ? "working_hours" : type === "vacation" ? "vacation" : type === "sick" ? "sick" : "on_business";
}

function buildAvailabilityRow(
  payload: AvailabilityPayload,
  actorProfile: ActorProfile,
  current?: AvailabilityRow,
): { ok: true; profileId: string; row: Record<string, string | number | null> } | { ok: false; error: string; status: number } {
  const profileId = typeof payload.profileId === "string" ? payload.profileId.trim() : current?.profile_id || "";
  const type = typeof payload.type === "string" && availabilityTypes.has(payload.type) ? payload.type : current?.type || "";
  const title = typeof payload.title === "string" ? payload.title.trim().slice(0, 160) : current?.title || "";
  const blockerKind = typeof payload.blockerKind === "string" && blockerKinds.has(payload.blockerKind)
    ? payload.blockerKind
    : current?.blocker_kind || fallbackBlockerKind(type);
  const startTime = cleanTime(payload.startTime) || current?.start_time?.slice(0, 5) || "";
  const endTime = cleanTime(payload.endTime) || current?.end_time?.slice(0, 5) || "";

  if (!profileId) return { ok: false, error: "Profil ist erforderlich.", status: 400 };
  if (!type) return { ok: false, error: "Typ ist erforderlich.", status: 400 };
  if (!startTime || !endTime || startTime >= endTime) return { ok: false, error: "Start- und Endzeit sind ungültig.", status: 400 };

  const accessError = availabilityAccessError(
    actorProfile,
    profileId,
    current ? "Founder können Einträge nicht auf andere Profile übertragen." : "Founder können nur eigene Verfügbarkeiten pflegen.",
  );
  if (accessError) return { ok: false, error: accessError, status: 403 };

  const row: Record<string, string | number | null> = {
    profile_id: profileId,
    type,
    title,
    blocker_kind: blockerKind,
    start_time: startTime,
    end_time: endTime,
    note: typeof payload.note === "string" ? payload.note.trim().slice(0, 1000) : current?.note ?? null,
  };

  if (!current) {
    row.created_by = actorProfile.id;
    row.source = "manual";
  }

  if (type === "working_hours") {
    const weekday = Number(payload.weekday ?? current?.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { ok: false, error: "Wochentag ist ungültig.", status: 400 };
    row.weekday = weekday;
    row.start_date = null;
    row.end_date = null;
  } else {
    const startDate = cleanDate(payload.startDate) || current?.start_date || "";
    const endDate = cleanDate(payload.endDate) || current?.end_date || startDate;
    if (!startDate || !endDate || startDate > endDate) return { ok: false, error: "Datumsbereich ist ungültig.", status: 400 };
    row.weekday = null;
    row.start_date = startDate;
    row.end_date = endDate;
  }

  return { ok: true, profileId, row };
}

export async function POST(request: NextRequest) {
  const context = await requireJsonApiContext<AvailabilityPayload>(request, requireFounder, {});
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  if (!permission.profile) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const prepared = buildAvailabilityRow(payload, permission.profile);
  if (!prepared.ok) return apiError(prepared.error, prepared.status);

  const { data: targetProfile, error: profileError } = await supabase.from("profiles").select("id").eq("id", prepared.profileId).single();
  if (profileError || !targetProfile) return apiError("Profil wurde nicht gefunden.", 404);
  const { row } = prepared;

  const { data: availability, error } = await supabase
    .from("availability")
    .insert(row)
    .select(availabilitySelect)
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
    .select(availabilitySelect)
    .eq("id", id)
    .single();

  if (readError || !current) return apiError("Eintrag wurde nicht gefunden.", 404);
  const accessError = availabilityAccessError(permission.profile, current.profile_id, "Founder können nur eigene Verfügbarkeiten löschen.");
  if (accessError) return apiError(accessError, 403);

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
    .select(availabilitySelect)
    .eq("id", id)
    .single();

  if (readError || !current) return apiError("Eintrag wurde nicht gefunden.", 404);
  if (current.source === "google_calendar") {
    return apiError("Importierte Google-Kalenderblöcke können nicht in der App bearbeitet werden.", 403);
  }
  const accessError = availabilityAccessError(permission.profile, current.profile_id, "Founder können nur eigene Verfügbarkeiten bearbeiten.");
  if (accessError) return apiError(accessError, 403);

  const prepared = buildAvailabilityRow(payload, permission.profile, current as AvailabilityRow);
  if (!prepared.ok) return apiError(prepared.error, prepared.status);

  const { data: targetProfile, error: profileError } = await supabase.from("profiles").select("id").eq("id", prepared.profileId).single();
  if (profileError || !targetProfile) return apiError("Profil wurde nicht gefunden.", 404);
  const { row } = prepared;

  const { data: availability, error } = await supabase
    .from("availability")
    .update(row)
    .eq("id", id)
    .select(availabilitySelect)
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
