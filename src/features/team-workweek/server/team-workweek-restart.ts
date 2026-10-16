import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inflateTeamWorkweekWindows, type PrivateTeamWorkweekVersion } from "../model/team-workweek-draft";
import { compensateTeamWorkweekGeneration } from "./team-workweek-execution";
import { GoogleWorkspaceOAuthContractError } from "./google-workspace-oauth-core";
import { getGoogleWorkspaceAccessToken } from "./google-workspace-oauth";
import { TeamWorkweekPublicationError } from "./team-workweek-publication";
import type { WorkweekRecoveryReason } from "./team-workweek-provider-operations";
import { cleanupGoogleWorkweekEffect, discoverGoogleWorkweekInstance, recoverGoogleWorkweekWrite } from "./team-workweek-immediate-effects";

type VersionRow={id:string;owner_profile_id:string;effective_from:string;activation_mode:"immediate"|"future_monday";base_publication_id:string|null;base_publication_revision:number|null;timezone:"Europe/Berlin";created_at:string;retired_at:string|null;restarted_version_id:string|null;team_workweek_windows:Array<{weekday:number;start_minute:number;end_minute:number}>};
export type TeamWorkweekRestartResult={version?:PrivateTeamWorkweekVersion;restart:{state:"ready"|"delayed";recovery:"retry"|"reconnect"|"identity_conflict"|null;reason?:WorkweekRecoveryReason}};
export async function restartPrivateTeamWorkweek({
  ownerProfileId, versionId, userSupabase, serviceSupabase,
  now = () => new Date(),
  accessTokenForOwner = getGoogleWorkspaceAccessToken,
  compensate = compensateTeamWorkweekGeneration,
  cleanupEffect = cleanupGoogleWorkweekEffect,
  discoverInstance = discoverGoogleWorkweekInstance,
  recoverWrite = recoverGoogleWorkweekWrite,
}: {
  ownerProfileId: string;
  versionId: string;
  userSupabase: SupabaseClient;
  serviceSupabase: SupabaseClient;
  now?: () => Date;
  accessTokenForOwner?: typeof getGoogleWorkspaceAccessToken;
  compensate?: typeof compensateTeamWorkweekGeneration;
  cleanupEffect?: typeof cleanupGoogleWorkweekEffect;
  discoverInstance?: typeof discoverGoogleWorkweekInstance;
  recoverWrite?: typeof recoverGoogleWorkweekWrite;
}): Promise<TeamWorkweekRestartResult> {
  const source=await serviceSupabase.from("team_workweek_versions").select("id,owner_profile_id,retired_at,restarted_version_id").eq("id",versionId).maybeSingle<Pick<VersionRow,"id"|"owner_profile_id"|"retired_at"|"restarted_version_id">>();
  if(source.error)throw new TeamWorkweekPublicationError("unavailable","Private Version konnte nicht geladen werden.");
  if(!source.data)throw new TeamWorkweekPublicationError("not_found","Private Version ist nicht vorhanden.");
  if(source.data.owner_profile_id!==ownerProfileId)throw new TeamWorkweekPublicationError("forbidden","Keine Berechtigung für diese Grundwoche.");
  if(!source.data.restarted_version_id){
    const conflict=await serviceSupabase.from("team_workweek_google_conflicts").select("resolution_version_id").eq("owner_profile_id",ownerProfileId).eq("founderops_version_id",versionId).eq("state","resolving").maybeSingle<{resolution_version_id:string}>();
    if(conflict.error)throw new TeamWorkweekPublicationError("unavailable","Konfliktstatus konnte nicht geladen werden.");
    let publication=await serviceSupabase.from("team_workweek_publications").select("id,status,attempt_generation,effective_at,write_journal_version").eq("source_version_id",conflict.data?.resolution_version_id||versionId).maybeSingle<{id:string;status:string;attempt_generation:number;effective_at:string|null;write_journal_version?:number}>();
    if(publication.error)throw new TeamWorkweekPublicationError("unavailable","Veröffentlichungsstatus konnte nicht geladen werden.");
    if (!publication.data) {
      publication = await serviceSupabase.from("team_workweek_publications")
        .select("id,status,attempt_generation,effective_at,write_journal_version,team_workweek_versions!team_workweek_publications_source_version_id_fkey!inner(origin)")
        .eq("owner_profile_id", ownerProfileId).eq("status", "preparing")
        .eq("team_workweek_versions.origin", "google_reconciliation")
        .maybeSingle<{id:string;status:string;attempt_generation:number;effective_at:string|null;write_journal_version?:number}>();
      if (publication.error) throw new TeamWorkweekPublicationError("unavailable", "Vorbereiteter Google-Abgleich konnte nicht geladen werden.");
    }

    if(publication.data){
      if(publication.data.status!=="preparing" || !publication.data.attempt_generation || !publication.data.effective_at)throw new TeamWorkweekPublicationError("conflict","Die Veröffentlichung läuft noch. Lade ihren aktuellen Stand erneut.");
      const journaled=publication.data.write_journal_version!==undefined;
      if(journaled){
        const cancellation=await serviceSupabase.rpc("request_team_workweek_publication_restart",{p_publication_id:publication.data.id,p_owner_profile_id:ownerProfileId});
        if(cancellation.error)throw new TeamWorkweekPublicationError("conflict","Der Veröffentlichungsversuch konnte noch nicht angehalten werden.");
        if(cancellation.data?.state!=="ready" && cancellation.data?.reason!=="uncertain")return {restart:{state:"delayed",recovery:"retry",reason:cancellation.data?.reason||"in_progress"}};
      }else if(new Date(publication.data.effective_at)>now())throw new TeamWorkweekPublicationError("conflict","Die Veröffentlichung läuft noch. Lade ihren aktuellen Stand erneut.");
      let token:string;
      try{token=await accessTokenForOwner(serviceSupabase,ownerProfileId);}catch(error){
        if(error instanceof GoogleWorkspaceOAuthContractError)return {restart:{state:"delayed",recovery:error.code==="provider_revoked" || error.code==="reconnect_required"?"reconnect":"retry"}};
        throw error;
      }
      let reason:WorkweekRecoveryReason|undefined;
      const failure=await compensate({accessToken:token,publicationId:publication.data.id,generation:publication.data.attempt_generation,serviceSupabase,now,journaled,cleanupEffect,discoverInstance,recoverWrite,onRecoveryReason:value=>{reason=value;}});
      if(failure)return {restart:{state:"delayed",recovery:failure==="oauth_reconnect_required"?"reconnect":failure==="provider_identity_mismatch"?"identity_conflict":"retry",...(reason?{reason}:{})}};
    }
  }
  const restarted=await userSupabase.rpc("restart_private_team_workweek_version",{p_version_id:versionId});
  if(restarted.error)throw new TeamWorkweekPublicationError(restarted.error.code==="42501"?"forbidden":restarted.error.code==="P0003"||restarted.error.code==="P0004"?"conflict":"unavailable","Die private Version konnte noch nicht mit dem aktuellen Stand neu begonnen werden.");
  const result=await userSupabase.from("team_workweek_versions").select("id,owner_profile_id,effective_from,activation_mode,base_publication_id,base_publication_revision,timezone,created_at,retired_at,restarted_version_id,team_workweek_windows(weekday,start_minute,end_minute)").eq("id",restarted.data?.versionId).maybeSingle<VersionRow>();
  if(result.error || !result.data || result.data.owner_profile_id!==ownerProfileId)throw new TeamWorkweekPublicationError("unavailable","Neue private Version konnte nicht geladen werden. Lade die Arbeitswoche erneut.");
  const row=result.data;
  return {version:{id:row.id,effectiveFrom:row.effective_from,activationMode:row.activation_mode,...(row.base_publication_id?{basePublicationId:row.base_publication_id,basePublicationRevision:row.base_publication_revision!}:{}),timezone:row.timezone,status:"preparing",createdAt:row.created_at,windows:inflateTeamWorkweekWindows(row.team_workweek_windows)},restart:{state:"ready",recovery:null}};
}
