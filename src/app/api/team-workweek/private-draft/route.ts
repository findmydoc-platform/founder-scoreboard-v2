import { type NextRequest, NextResponse } from "next/server";
import {
  flattenTeamWorkweekWindows,
  inflateTeamWorkweekWindows,
  validatePrivateTeamWorkweekDraft,
} from "@/features/team-workweek/model/team-workweek-draft";
import { apiError, readJsonPayload, requireApiContext } from "@/lib/api-response";
import { bearerToken, requirePlanningContributor } from "@/lib/authz";
import { getSupabaseForToken } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function authenticatedClient(request: NextRequest) {
  const token = bearerToken(request);
  return token ? getSupabaseForToken(token) : null;
}

export async function GET(request: NextRequest) {
  const context = await requireApiContext(request, requirePlanningContributor);
  if (!context.ok) return context.response;
  const supabase = authenticatedClient(request);
  if (!supabase) return apiError("Anmeldung erforderlich.", 401);

  const { data, error } = await supabase
    .from("team_workweek_versions")
    .select("id,effective_from,timezone,status,created_at,team_workweek_windows(weekday,start_minute,end_minute)")
    .eq("status", "preparing")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      effective_from: string;
      timezone: "Europe/Berlin";
      status: "preparing";
      created_at: string;
      team_workweek_windows: Array<{ weekday: number; start_minute: number; end_minute: number }>;
    }>();
  if (error) return apiError("Private Grundwoche konnte nicht geladen werden.", 503);

  const publication = data ? await supabase
    .from("team_workweek_publications")
    .select("status")
    .eq("source_version_id", data.id)
    .maybeSingle<{ status: "preparing" | "published" }>() : null;
  if (publication?.error) return apiError("Private Grundwoche konnte nicht geladen werden.", 503);
  const privateVersion = publication?.data?.status === "published" ? null : data;

  return NextResponse.json({
    version: privateVersion ? {
      id: privateVersion.id,
      effectiveFrom: privateVersion.effective_from,
      timezone: privateVersion.timezone,
      status: privateVersion.status,
      createdAt: privateVersion.created_at,
      windows: inflateTeamWorkweekWindows(privateVersion.team_workweek_windows || []),
    } : null,
  });
}

export async function POST(request: NextRequest) {
  const context = await requireApiContext(request, requirePlanningContributor);
  if (!context.ok) return context.response;
  const supabase = authenticatedClient(request);
  if (!supabase) return apiError("Anmeldung erforderlich.", 401);

  const validation = validatePrivateTeamWorkweekDraft(await readJsonPayload<unknown>(request, null));
  if (!validation.ok) return apiError(validation.errors[0], 400);

  const { data, error } = await supabase.rpc("create_private_team_workweek_version", {
    p_effective_from: validation.draft.effectiveFrom,
    p_windows: flattenTeamWorkweekWindows(validation.draft.windows),
  });
  if (error) {
    const status = error.code === "22023" ? 400 : error.code === "42501" ? 403 : 503;
    return apiError(status === 400 ? "Grundwoche ist ungültig." : status === 403 ? "Keine Berechtigung für diese Grundwoche." : "Grundwoche konnte nicht gespeichert werden.", status);
  }

  return NextResponse.json({ version: data }, { status: 201 });
}
