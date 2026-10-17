import {expect,it,vi} from "vitest";
import {importTestModule} from "../../helpers/vitest-module.mjs";
const {TeamWorkweekPublicationError}=await importTestModule("src/features/team-workweek/server/team-workweek-publication.ts",{"server-only":{},"./team-workweek-calendar":{calendarForWorkweekOwner:async()=>"token"}});
const restart=await importTestModule("src/features/team-workweek/server/team-workweek-restart.ts",{"server-only":{},"./team-workweek-publication":{TeamWorkweekPublicationError}});
function clients({foreign=false,failure=null,replayed=false,journalVersion,future=false,cancellation={state:"ready"}}={}){
  const calls=[];
  const query=data=>({select(){return this;},eq(){return this;},async maybeSingle(){return {data,error:null};}});
  const serviceSupabase={from(table){
    if(table==="team_workweek_versions")return query({id:"old",owner_profile_id:foreign?"foreign":"owner",restarted_version_id:replayed?"new":null});
    if(table==="team_workweek_google_conflicts")return query({resolution_version_id:"resolution"});
    if(table==="team_workweek_publications")return query({id:"operation",status:"preparing",attempt_generation:2,effective_at:future?"2099-01-12T10:00:00Z":"2026-10-14T10:00:00Z",...(journalVersion!==undefined?{write_journal_version:journalVersion}:{})});
    throw new Error(table);
  },async rpc(name,args){calls.push([name,args]);return {data:cancellation,error:null};}};
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

it("cancels a journaled future attempt before compensating and returning a private version",async()=>{
  const {input,calls}=clients({journalVersion:1,future:true});
  expect((await restart.restartPrivateTeamWorkweek(input)).restart.state).toBe("ready");
  expect(calls.map(([name])=>name)).toEqual(["request_team_workweek_publication_restart","token","compensate","restart_private_team_workweek_version"]);
});

it.each(["in_progress","legacy_untracked"])("keeps a future attempt and all inputs intact while recovery is %s",async reason=>{
  const {input,calls}=clients({journalVersion:reason==="legacy_untracked"?0:1,future:true,cancellation:{state:"delayed",reason}});
  expect(await restart.restartPrivateTeamWorkweek(input)).toEqual({restart:{state:"delayed",recovery:"retry",reason}});
  expect(calls.map(([name])=>name)).toEqual(["request_team_workweek_publication_restart"]);
});

it("reports uncertain provider recovery without creating a new private version",async()=>{
  const {input,calls}=clients({journalVersion:1,future:true,cancellation:{state:"delayed",reason:"uncertain"}});
  input.compensate=async args=>{args.onRecoveryReason("uncertain");return "provider_unavailable";};
  expect(await restart.restartPrivateTeamWorkweek(input)).toEqual({restart:{state:"delayed",recovery:"retry",reason:"uncertain"}});
  expect(calls.some(([name])=>name==="restart_private_team_workweek_version")).toBe(false);
});


it.each(["confirmed", "delayed"])("restarts through real cleanup and the selected recovery adapter when uncertain recovery is %s", async state => {
  const { input, calls } = clients({ journalVersion: 1, future: true });
  delete input.compensate;
  const originalFrom = input.serviceSupabase.from;
  input.serviceSupabase.from = table => table === "team_workweek_provider_writes" ? {
    select() { return this; }, eq() { return this; }, async in() {
      return { data: [{ team_workweek_publication_effects: {
        id: "effect", google_event_id: "fopsrecovercleanup", generation: 2, kind: "series", operation: "create",
        payload: { id: "fopsrecovercleanup" }, state: "pending", confirmed_etag: null,
      } }], error: null };
    },
  } : originalFrom(table);
  let claims = 0;
  let recovered = false;
  input.serviceSupabase.rpc = async (name, args) => {
    calls.push([name, args]);
    if (name === "request_team_workweek_publication_restart") return { data: { state: "ready" }, error: null };
    if (name === "claim_team_workweek_provider_operation") return { data: ++claims === 1
      ? { state: "uncertain", id: "old", purpose: "cleanup", abandon: true }
      : { state: "claimed", id: "new" }, error: null };
    if (name === "finish_team_workweek_provider_operation") return { data: { state: "settled" }, error: null };
    if (name === "prepare_team_workweek_effect_cleanup") return { data: { effects: [] }, error: null };
    throw new Error(name);
  };
  input.recoverWrite = async ({ effect, purpose, abandon }) => {
    expect(effect.id).toBe("effect");
    expect(purpose).toBe("cleanup");
    expect(abandon).toBe(true);
    recovered = true;
    return state === "confirmed" ? { state, etag: "absent", observedAt: "2026-10-14T10:01:00Z" }
      : { state, errorClass: "provider_unavailable" };
  };
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 503 }));
  try {
    const result = await restart.restartPrivateTeamWorkweek(input);
    expect(recovered).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    if (state === "confirmed") expect(result.restart).toEqual({ state: "ready", recovery: null });
    else {
      expect(result.restart).toEqual({ state: "delayed", recovery: "retry", reason: "uncertain" });
      expect(calls.some(([name]) => name === "restart_private_team_workweek_version")).toBe(false);
    }
  } finally { fetchSpy.mockRestore(); }
});
