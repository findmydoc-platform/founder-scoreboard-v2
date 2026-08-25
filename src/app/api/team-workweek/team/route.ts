import { type NextRequest, NextResponse } from "next/server";
import { inflateTeamWorkweekWindows } from "@/features/team-workweek/model/team-workweek-draft";
import { apiError, requireApiContext } from "@/lib/api-response";
import { bearerToken, requireTeamMember } from "@/lib/authz";
import { getSupabaseForToken } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type PublishedVersionRow = Readonly<{
  id: string;
  owner_profile_id: string;
  effective_from: string;
  timezone: "Europe/Berlin";
  published_at: string;
  last_sync_at: string;
  windows: Array<{ weekday: number; startMinute: number; endMinute: number }>;
}>;

export async function GET(request: NextRequest) {
  const context = await requireApiContext(request, requireTeamMember);
  if (!context.ok) return context.response;
  const token = bearerToken(request);
  const supabase = token ? getSupabaseForToken(token) : null;
  if (!supabase) return apiError("Anmeldung erforderlich.", 401);

  const { data, error } = await supabase
    .from("team_workweek_publications")
    .select("id,owner_profile_id,effective_from,timezone,published_at,last_sync_at,publication_revision,windows")
    .eq("status", "published")
    .order("effective_from", { ascending: false })
    .order("publication_revision", { ascending: false })
    .order("id", { ascending: false })
    .returns<PublishedVersionRow[]>();
  if (error) return apiError("Veröffentlichte Grundwochen konnten nicht geladen werden.", 503);

  const latestByOwner = new Map<string, PublishedVersionRow>();
  for (const row of data || []) {
    if (!latestByOwner.has(row.owner_profile_id)) latestByOwner.set(row.owner_profile_id, row);
  }

  return NextResponse.json({
    workweeks: [...latestByOwner.values()].map((row) => ({
      id: row.id,
      ownerProfileId: row.owner_profile_id,
      effectiveFrom: row.effective_from,
      timezone: row.timezone,
      publishedAt: row.published_at,
      lastSyncAt: row.last_sync_at,
      windows: inflateTeamWorkweekWindows((row.windows || []).map((window) => ({
        weekday: window.weekday,
        start_minute: window.startMinute,
        end_minute: window.endMinute,
      }))),
    })),
  });
}
