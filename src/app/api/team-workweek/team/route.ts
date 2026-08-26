import { type NextRequest, NextResponse } from "next/server";
import { validateCalendarWorkweekRange } from "@/features/team-workweek/model/team-workweek-calendar";
import { berlinTodayIso, inflateTeamWorkweekWindows } from "@/features/team-workweek/model/team-workweek-draft";
import { selectVisibleTeamWorkweeks } from "@/features/team-workweek/model/published-team-workweek";
import { requireTeamWorkweekStarterApiAccess } from "@/features/team-workweek/server/team-workweek-rollout-api";
import { apiError, requireApiContext } from "@/lib/api-response";
import { bearerToken, requireTeamMember } from "@/lib/authz";
import { getSupabaseForToken } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type PublishedVersionRow = Readonly<{
  id: string;
  owner_profile_id: string;
  effective_from: string;
  effective_to: string | null;
  timezone: "Europe/Berlin";
  published_at: string;
  last_sync_at: string;
  publication_revision: number;
  windows: Array<{ weekday: number; startMinute: number; endMinute: number }>;
}>;

export async function GET(request: NextRequest) {
  const context = await requireApiContext(request, requireTeamMember);
  if (!context.ok) return context.response;
  const rollout = await requireTeamWorkweekStarterApiAccess({
    actorProfileId: context.permission.profile?.id || "",
    actorRole: context.permission.profile?.platformRole,
  });
  if (!rollout.ok) return rollout.response;
  const requestedRange = validateCalendarWorkweekRange(
    request.nextUrl.searchParams.get("from"),
    request.nextUrl.searchParams.get("to"),
  );
  if (!requestedRange.ok) return apiError(requestedRange.error, 400);
  const token = bearerToken(request);
  const supabase = token ? getSupabaseForToken(token) : null;
  if (!supabase) return apiError("Anmeldung erforderlich.", 401);

  const { data, error } = await supabase
    .from("team_workweek_publications")
    .select("id,owner_profile_id,effective_from,effective_to,timezone,published_at,last_sync_at,publication_revision,windows")
    .eq("status", "published")
    .order("effective_from", { ascending: false })
    .order("publication_revision", { ascending: false })
    .order("id", { ascending: false })
    .returns<PublishedVersionRow[]>();
  if (error) return apiError("Veröffentlichte Grundwochen konnten nicht geladen werden.", 503);

  const visible = selectVisibleTeamWorkweeks((data || []).map((row) => ({
    ownerProfileId: row.owner_profile_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    publicationRevision: row.publication_revision,
    row,
  })), berlinTodayIso());

  const workweeks = visible.map(({ row, phase }) => ({
    id: row.id,
    ownerProfileId: row.owner_profile_id,
    effectiveFrom: row.effective_from,
    timezone: row.timezone,
    publishedAt: row.published_at,
    lastSyncAt: row.last_sync_at,
    publicationRevision: row.publication_revision,
    phase,
    windows: inflateTeamWorkweekWindows((row.windows || []).map((window) => ({
      weekday: window.weekday,
      start_minute: window.startMinute,
      end_minute: window.endMinute,
    }))),
  }));
  const calendarWorkweeks = requestedRange.range
    ? (data || [])
      .filter((row) => row.effective_from <= requestedRange.range!.to)
      .filter((row) => !row.effective_to || row.effective_to >= requestedRange.range!.from)
      .map((row) => ({
        id: row.id,
        ownerProfileId: row.owner_profile_id,
        effectiveFrom: row.effective_from,
        effectiveTo: row.effective_to,
        timezone: row.timezone,
        publicationRevision: row.publication_revision,
        lastSyncAt: row.last_sync_at,
        windows: inflateTeamWorkweekWindows((row.windows || []).map((window) => ({
          weekday: window.weekday,
          start_minute: window.startMinute,
          end_minute: window.endMinute,
        }))),
      }))
    : undefined;

  return NextResponse.json({
    workweeks,
    ...(calendarWorkweeks ? { calendarWorkweeks } : {}),
  });
}
