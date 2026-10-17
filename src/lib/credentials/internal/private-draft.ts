import "server-only";
import { authorizeSessionData } from "./session";
import type { PrivateDraftCredentialInput, PrivateDraftCredentialResult, PrivateDraftPublication, PrivateDraftPendingPublication, PrivateDraftVersion, PrivateDraftSaveInput } from "../types";

export async function authorizePrivateDraft(input: PrivateDraftCredentialInput): Promise<PrivateDraftCredentialResult> {
  const authorized = await authorizeSessionData(input.credential.request, input.action);
  if (!authorized.ok) return authorized;
  const { data, profile } = authorized;
  const ownerProfileId = profile.id;
  if (input.action === "workweek.private.write") return { ok: true, profile, privateDraft: { save: async (input: PrivateDraftSaveInput) => {
    const windows = input.windows;
    return input.selectedWeekStart
      ? await data.rpc("create_private_selected_team_workweek_version", { p_week_start: input.selectedWeekStart, p_windows: windows, p_context_token: input.contextToken })
      : input.activationMode === "immediate"
        ? input.basePublicationId
          ? await data.rpc("create_private_current_team_workweek_version", { p_windows: windows, p_base_publication_id: input.basePublicationId, p_base_publication_revision: input.basePublicationRevision })
          : await data.rpc("create_private_immediate_team_workweek_version", { p_windows: windows })
        : input.basePublicationId
          ? await data.rpc("create_private_monday_team_workweek_version", { p_effective_from: input.effectiveFrom, p_windows: windows, p_base_publication_id: input.basePublicationId, p_base_publication_revision: input.basePublicationRevision })
          : await data.rpc("create_private_team_workweek_version", { p_effective_from: input.effectiveFrom, p_windows: windows });
  } } };
  return { ok: true, profile, privateDraft: {
    readAutomaticPublication: async () => await data.from("team_workweek_publications")
    .select("id,source_version_id,effective_from,activation_mode,effective_at,effective_until,attempt_generation,status,sync_state,publication_revision,published_at,last_sync_at,team_workweek_google_reconciliation_status(state,last_observed_at),team_workweek_versions!team_workweek_publications_source_version_id_fkey!inner(origin)")
    .eq("owner_profile_id", ownerProfileId)
    .eq("status", "preparing")
    .eq("team_workweek_versions.origin", "google_reconciliation")
    .maybeSingle<PrivateDraftPublication>(),
    readPublishedPublications: async () => await data
    .from("team_workweek_publications")
    .select("id,source_version_id,superseded_by_publication_id,effective_from,effective_to,effective_until,activation_mode,effective_at,status,sync_state,publication_revision,published_at,last_sync_at,windows,team_workweek_google_series(id,google_event_id,confirmed_etag,state,provider_state,projection_part,source_window_ids),team_workweek_google_reconciliation_status(state,last_observed_at)")
    .eq("owner_profile_id", ownerProfileId)
    .eq("status", "published")
    .order("effective_from", { ascending: false })
    .order("publication_revision", { ascending: false })
    .returns<PrivateDraftPublication[]>(),
    readPendingPublication: async () => await data.from("team_workweek_publications")
    .select("id,source_version_id,effective_from,effective_at,attempt_generation,write_journal_version,restart_requested_at,last_error_class")
    .eq("owner_profile_id", ownerProfileId)
    .eq("status", "preparing")
    .maybeSingle<PrivateDraftPendingPublication>(),
    readSourcePublication: async (versionId: string) => await data
    .from("team_workweek_publications")
    .select("id,effective_from,activation_mode,effective_at,effective_until,attempt_generation,status,sync_state,publication_revision,published_at,last_sync_at,team_workweek_google_reconciliation_status(state,last_observed_at)")
    .eq("owner_profile_id", ownerProfileId).eq("source_version_id", versionId)
    .maybeSingle<PrivateDraftPublication>(),
    readAutomaticSource: async (versionId: string) => await data.from("team_workweek_versions")
          .select("id,owner_profile_id,effective_from,selected_week_start,activation_mode,base_publication_id,base_publication_revision,successor_snapshot,timezone,status,created_at,team_workweek_windows(weekday,start_minute,end_minute)")
          .eq("owner_profile_id", ownerProfileId).eq("id", versionId)
          .eq("origin", "google_reconciliation")
          .is("retired_at", null)
          .maybeSingle<PrivateDraftVersion>(),
    readPrivateVersion: async (week?: string | null) => {
  let privateQuery = data
    .from("team_workweek_versions")
    .select("id,owner_profile_id,effective_from,selected_week_start,activation_mode,base_publication_id,base_publication_revision,successor_snapshot,timezone,status,created_at,team_workweek_windows(weekday,start_minute,end_minute)")
    .eq("owner_profile_id", ownerProfileId)
    .eq("status", "preparing")
    .eq("origin", "owner")
    .is("retired_at",null);
  if (week) privateQuery = privateQuery.eq("effective_from", week);
  return await privateQuery
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<PrivateDraftVersion>();
    },
    readResolvingConflict: authorized.readOwnerConflict,
    readEditContext: async (week: string) => await data.rpc("team_workweek_edit_context", { p_week_start: week }),
  } };
}
