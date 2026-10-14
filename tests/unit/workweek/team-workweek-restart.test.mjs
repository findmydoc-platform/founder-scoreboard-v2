import {expect,it} from "vitest";
import {importTestModule} from "../../helpers/vitest-module.mjs";
const {TeamWorkweekPublicationError}=await importTestModule("src/features/team-workweek/server/team-workweek-publication.ts",{"server-only":{},"./google-workspace-oauth":{getGoogleWorkspaceAccessToken:async()=>"token"}});
const restart=await importTestModule("src/features/team-workweek/server/team-workweek-restart.ts",{"server-only":{},"./team-workweek-publication":{TeamWorkweekPublicationError}});
function clients({foreign=false,failure=null,replayed=false}={}){
  const calls=[];
  const query=data=>({select(){return this;},eq(){return this;},async maybeSingle(){return {data,error:null};}});
  const serviceSupabase={from(table){
    if(table==="team_workweek_versions")return query({id:"old",owner_profile_id:foreign?"foreign":"owner",restarted_version_id:replayed?"new":null});
    if(table==="team_workweek_google_conflicts")return query({resolution_version_id:"resolution"});
    if(table==="team_workweek_publications")return query({id:"operation",status:"preparing",attempt_generation:2,effective_at:"2026-10-14T10:00:00Z"});
    throw new Error(table);
  }};
  const userSupabase={async rpc(name,args){calls.push([name,args]);return {data:{versionId:"new"},error:null};},from(){return query({id:"new",owner_profile_id:"owner",effective_from:"2026-10-12",activation_mode:"immediate",base_publication_id:"current",base_publication_revision:3,timezone:"Europe/Berlin",created_at:"2026-10-14T10:01:00Z",team_workweek_windows:[{weekday:1,start_minute:540,end_minute:1020}]});}};
  const input={ownerProfileId:"owner",versionId:"old",serviceSupabase,userSupabase,now:()=>new Date("2026-10-14T10:01:00Z"),accessTokenForOwner:async()=>{calls.push(["token"]);return "token";},compensate:async args=>{calls.push(["compensate",args.publicationId,args.generation]);return failure;}};
  return {input,calls};
}
it("compensates the associated resolution, then returns a fresh private draft without publishing",async()=>{
  const {input,calls}=clients();const result=await restart.restartPrivateTeamWorkweek(input);
  expect(calls).toEqual([["token"],["compensate","operation",2],["restart_private_team_workweek_version",{p_version_id:"old"}]]);
  expect(result.restart).toEqual({state:"ready",recovery:null});expect(result.version.windows.monday).toEqual([{start:"09:00",end:"17:00"}]);expect(result.version.basePublicationId).toBe("current");
});
it.each([["provider_unavailable","retry"],["oauth_reconnect_required","reconnect"],["provider_identity_mismatch","identity_conflict"]])("keeps the private state recoverable after %s",async(failure,recovery)=>{
  const {input,calls}=clients({failure});expect(await restart.restartPrivateTeamWorkweek(input)).toEqual({restart:{state:"delayed",recovery}});expect(calls.some(([name])=>name==="restart_private_team_workweek_version")).toBe(false);
});
it("rejects a foreign source before token access or provider writes",async()=>{
  const {input,calls}=clients({foreign:true});await expect(restart.restartPrivateTeamWorkweek(input)).rejects.toMatchObject({code:"forbidden"});expect(calls).toEqual([]);
});
it("recovers a lost completed restart response without replaying provider cleanup",async()=>{
  const {input,calls}=clients({replayed:true});expect((await restart.restartPrivateTeamWorkweek(input)).version.id).toBe("new");expect(calls).toEqual([["restart_private_team_workweek_version",{p_version_id:"old"}]]);
});
