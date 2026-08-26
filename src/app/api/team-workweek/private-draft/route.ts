import { type NextRequest, NextResponse } from "next/server";
import {
  flattenTeamWorkweekWindows,
  inflateTeamWorkweekWindows,
  nextVersionMondayIso,
  validatePrivateTeamWorkweekDraft,
} from "@/features/team-workweek/model/team-workweek-draft";
import { requireTeamWorkweekStarterApiAccess } from "@/features/team-workweek/server/team-workweek-rollout-api";
import { apiError, readJsonPayload, requireApiContext } from "@/lib/api-response";
import { bearerToken, requirePlanningContributor } from "@/lib/authz";
import { getSupabaseForToken } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type PublicationRow = Readonly<{
  id: string;
  effective_from: string;
  status: "preparing" | "published";
  sync_state: "pending" | "delayed" | "confirmed";
  publication_revision: number;
  published_at: string | null;
  last_sync_at: string | null;
  team_workweek_google_reconciliation_status: Readonly<{
    state: "confirmed" | "pending" | "delayed" | "conflict";
    last_observed_at: string | null;
  }> | Array<Readonly<{
    state: "confirmed" | "pending" | "delayed" | "conflict";
    last_observed_at: string | null;
  }>> | null;
}>;

function publicationPayload(row: PublicationRow | null) {
  const reconciliation = row
    ? Array.isArray(row.team_workweek_google_reconciliation_status)
      ? row.team_workweek_google_reconciliation_status[0]
      : row.team_workweek_google_reconciliation_status
    : null;
  return row ? {
    id: row.id,
    effectiveFrom: row.effective_from,
    status: row.status,
    syncState: row.sync_state,
    publicationRevision: row.publication_revision,
    publishedAt: row.published_at,
    lastSyncAt: row.last_sync_at,
    googleReconciliationState: reconciliation?.state || "confirmed",
    lastGoogleReconciliationAt: reconciliation?.last_observed_at || null,
  } : null;
}

function authenticatedClient(request: NextRequest) {
  const token = bearerToken(request);
  return token ? getSupabaseForToken(token) : null;
}

export async function GET(request: NextRequest) {
  const context = await requireApiContext(request, requirePlanningContributor);
  if (!context.ok) return context.response;
  const rollout = await requireTeamWorkweekStarterApiAccess({
    actorProfileId: context.permission.profile?.id || "",
    actorRole: context.permission.profile?.platformRole,
  });
  if (!rollout.ok) return rollout.response;
  const supabase = authenticatedClient(request);
  if (!supabase) return apiError("Anmeldung erforderlich.", 401);

  const { data, error } = await supabase
    .from("team_workweek_versions")
    .select("id,owner_profile_id,effective_from,timezone,status,created_at,team_workweek_windows(weekday,start_minute,end_minute)")
    .eq("status", "preparing")
    .eq("origin", "owner")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      owner_profile_id: string;
      effective_from: string;
      timezone: "Europe/Berlin";
      status: "preparing";
      created_at: string;
      team_workweek_windows: Array<{ weekday: number; start_minute: number; end_minute: number }>;
    }>();
  if (error) return apiError("Private Grundwoche konnte nicht geladen werden.", 503);

  const publication = data ? await supabase
    .from("team_workweek_publications")
    .select("id,effective_from,status,sync_state,publication_revision,published_at,last_sync_at,team_workweek_google_reconciliation_status(state,last_observed_at)")
    .eq("source_version_id", data.id)
    .maybeSingle<PublicationRow>() : null;
  if (publication?.error) return apiError("Private Grundwoche konnte nicht geladen werden.", 503);
  const privateVersion = publication?.data?.status === "published" ? null : data;
  const ownerProfileId = context.permission.profile?.id || data?.owner_profile_id || null;
  const latestPublishedResponse = ownerProfileId ? await supabase
    .from("team_workweek_publications")
    .select("id,effective_from,status,sync_state,publication_revision,published_at,last_sync_at,team_workweek_google_reconciliation_status(state,last_observed_at)")
    .eq("owner_profile_id", ownerProfileId)
    .eq("status", "published")
    .order("effective_from", { ascending: false })
    .order("publication_revision", { ascending: false })
    .limit(1)
    .maybeSingle<PublicationRow>() : null;
  if (latestPublishedResponse?.error) return apiError("Veröffentlichungsstatus konnte nicht geladen werden.", 503);
  const latestPublished = latestPublishedResponse?.data || null;

  return NextResponse.json({
    version: privateVersion ? {
      id: privateVersion.id,
      effectiveFrom: privateVersion.effective_from,
      timezone: privateVersion.timezone,
      status: privateVersion.status,
      createdAt: privateVersion.created_at,
      windows: inflateTeamWorkweekWindows(privateVersion.team_workweek_windows || []),
    } : null,
    publication: privateVersion ? publicationPayload(publication?.data || null) : null,
    latestPublished: publicationPayload(latestPublished),
    minimumEffectiveFrom: nextVersionMondayIso(latestPublished?.effective_from || null),
  });
}

export async function POST(request: NextRequest) {
  const context = await requireApiContext(request, requirePlanningContributor);
  if (!context.ok) return context.response;
  const rollout = await requireTeamWorkweekStarterApiAccess({
    actorProfileId: context.permission.profile?.id || "",
    actorRole: context.permission.profile?.platformRole,
  });
  if (!rollout.ok) return rollout.response;
  const supabase = authenticatedClient(request);
  if (!supabase) return apiError("Anmeldung erforderlich.", 401);

  const validation = validatePrivateTeamWorkweekDraft(await readJsonPayload<unknown>(request, null));
  if (!validation.ok) return apiError(validation.errors[0], 400);

  const { data, error } = await supabase.rpc("create_private_team_workweek_version", {
    p_effective_from: validation.draft.effectiveFrom,
    p_windows: flattenTeamWorkweekWindows(validation.draft.windows),
  });
  if (error) {
    const status = error.code === "22023" ? 400 : error.code === "42501" ? 403 : error.code === "P0003" ? 409 : 503;
    return apiError(
      status === 400
        ? "Grundwoche ist ungültig."
        : status === 403
          ? "Keine Berechtigung für diese Grundwoche."
          : status === 409
            ? "Google-Abgleich zuerst abschließen."
            : "Grundwoche konnte nicht gespeichert werden.",
      status,
    );
  }

  return NextResponse.json({ version: data }, { status: 201 });
}
