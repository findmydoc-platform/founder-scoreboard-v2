import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanupGoogleWorkweekEffect, discoverGoogleWorkweekInstance, type PreparedWorkweekEffect } from "./team-workweek-immediate-effects";
import type { TeamWorkweekPublicationDelayClass } from "./team-workweek-publication";
import { claimProviderOperation, finishProviderOperation, providerWriteJournal, type WorkweekRecoveryReason } from "./team-workweek-provider-operations";

/** Compensate the immutable generation, recording actual retained history. */
export async function compensateTeamWorkweekGeneration({accessToken,publicationId,generation,serviceSupabase,now=()=>new Date(),cleanupEffect=cleanupGoogleWorkweekEffect,discoverInstance=discoverGoogleWorkweekInstance,journaled=false,onRecoveryReason}:{accessToken:string;publicationId:string;generation:number;serviceSupabase:SupabaseClient;now?:()=>Date;cleanupEffect?:typeof cleanupGoogleWorkweekEffect;discoverInstance?:typeof discoverGoogleWorkweekInstance;journaled?:boolean;onRecoveryReason?:(reason:WorkweekRecoveryReason)=>void}):Promise<TeamWorkweekPublicationDelayClass|null> {
  const claim=journaled?await claimProviderOperation({accessToken,publicationId,generation,serviceSupabase,now,purpose:"cleanup"}):null;
  if(claim?.reason){onRecoveryReason?.(claim.reason);return claim.errorClass||"provider_unavailable";}
  try {
  const prepare=async()=>{
    const result=await serviceSupabase.rpc("prepare_team_workweek_effect_cleanup",{p_publication_id:publicationId,p_generation:generation});
    return !result.error && Array.isArray(result.data?.effects) ? result.data.effects as PreparedWorkweekEffect[] : null;
  };
  const confirm=async(effect:PreparedWorkweekEffect,etag:string,preserved:boolean)=>{
    const result=await serviceSupabase.rpc("confirm_team_workweek_planned_cleanup",{p_effect_id:effect.id,p_generation:generation,p_etag:etag,p_preserved:preserved});
    return result.error ? "storage_failed" as const : null;
  };
  for(const stage of ["create","crossing","predecessor"] as const){
    const effects=await prepare();
    if(!effects)return "storage_failed";
    for(let effect of effects){
      const kind=effect.operation==="create"?"create":effect.kind==="cleanup_crossing"?"crossing":"predecessor";
      if(kind!==stage || effect.state==="cleaned")continue;
      if(effect.kind==="cleanup_crossing"){
        const parent=effects.find(item=>item.id===effect.cleanupParentId);
        if(!parent || parent.state!=="cleaned")return "storage_failed";
        if(!parent.cleanupPreserved){const error=await confirm(effect,"absent",false);if(error)return error;continue;}
        if(!effect.expectedEtag){
          const observed=await discoverInstance({accessToken,effect});
          if(observed.state==="delayed")return observed.errorClass;
          const bound=await serviceSupabase.rpc("bind_team_workweek_crossing_instance",{p_effect_id:effect.id,p_generation:generation,p_event_id:observed.eventId,p_etag:observed.etag,p_original_payload:observed.originalPayload});
          if(bound.error || bound.data?.id!==effect.id)return "storage_failed";
          effect=bound.data;
        }
      }
      const result=await cleanupEffect({accessToken,effect,now,...(claim?.id?{writeJournal:providerWriteJournal(serviceSupabase,claim.id,effect.id)}:{})});
      if(result.state==="delayed")return result.errorClass;
      const error=await confirm(effect,result.etag,result.preserved??false);
      if(error)return error;
    }
  }
  return null;
  } finally {
    if(claim?.id)await finishProviderOperation(serviceSupabase,claim.id);
  }
}
