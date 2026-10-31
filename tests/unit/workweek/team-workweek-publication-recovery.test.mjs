import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { importTestModule } from "../../helpers/vitest-module.mjs";

const publicationCore = await import("../../../src/features/team-workweek/server/team-workweek-publication-core.ts");

const publishedModel = await import("../../../src/features/team-workweek/model/published-team-workweek.ts");

class MockGoogleWorkspaceOAuthContractError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const publicationServer = await importTestModule(
  "src/features/team-workweek/server/team-workweek-publication.ts",
  {
    "server-only": {},
    "./team-workweek-publication-core": publicationCore,
    "@/lib/google-calendar-errors": { GoogleWorkspaceOAuthContractError: MockGoogleWorkspaceOAuthContractError },
    "./team-workweek-calendar": { calendarForWorkweekOwner: async () => ({request:(url,init)=>fetch(url,init),mutate:(_binding,url,init)=>fetch(url,init)}) },
  },
);

const publication = {
  id: "11111111-1111-4111-8111-111111111111",
  sourceVersionId: "33333333-3333-4333-8333-333333333333",
  ownerProfileId: "profile-1",
  effectiveFrom: "2026-08-31",
  timezone: "Europe/Berlin",
  status: "preparing",
  syncState: "pending",
  publicationRevision: 1,
  publishedAt: null,
  lastSyncAt: null,
  attemptGeneration: 1,
  writeJournalVersion: 1,
  effectiveAt: "2099-01-12T09:00:00Z",
  effects: [],
};

test("keeps the provider claim until a late batch request settles even when another effect throws", async () => {
  const effect = id => ({ id, calendarId: "primary", googleEventId: id, generation: 1, state: "pending", confirmedEtag: null,
    payload: { id, start: { dateTime: "2099-01-12T09:00:00Z", timeZone: "Europe/Berlin" }, end: { dateTime: "2099-01-12T17:00:00Z", timeZone: "Europe/Berlin" }, extendedProperties: { private: { founderopsWorkweekEffectId: id } } } });
  const first = effect("fopsearlythrow"), second = effect("fopslatebatch");
  const prepared = { ...publication, activationMode: "immediate", effectiveAt: "2099-01-12T09:00:00Z", attemptGeneration: 1, writeJournalVersion: 1, effects: [first, second] };
  let release, started;
  const dispatched = new Promise(resolve => { started = resolve; });
  let finished = false;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url).includes(first.id)) return Response.json({ ...first.payload, etag: "known" });
    if (init?.method === "POST") { started(); return new Promise(resolve => { release = resolve; }); }
    return new Response(null, { status: 404 });
  });
  const userSupabase = { async rpc(name) {
    assert.equal(name, "prepare_team_workweek_publication");
    return { data: prepared, error: null };
  } };
  const serviceSupabase = { async rpc(name, args) {
    if (name === "claim_team_workweek_provider_operation") return { data: { state: "claimed", id: "batch-claim" }, error: null };
    if (name === "record_team_workweek_provider_write") return { data: null, error: args.p_effect_id === first.id ? { code: "storage" } : null };
    if (name === "confirm_team_workweek_effect") return { data: null, error: null };
    if (name === "delay_team_workweek_publication") return { data: { ...prepared, syncState: "delayed" }, error: null };
    if (name === "finish_team_workweek_provider_operation") { finished = true; return { data: { state: "settled" }, error: null }; }
    throw new Error(name);
  } };
  try {
    const result = publicationServer.publishTeamWorkweek({ serviceSupabase, userSupabase, versionId: publication.sourceVersionId }).catch(error => error);
    await dispatched;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(finished, false);
    release(Response.json({ ...second.payload, etag: "late" }));
    assert.equal((await result).syncState, "delayed");
    assert.equal(finished, true);
  } finally { fetchSpy.mockRestore(); }
});

test("a preflight delay persists the existing reconnect contract without provider writes", async () => {
  const calls = [];
  const result = await publicationServer.delayTeamWorkweekPublication({
    errorClass: "oauth_reconnect_required",
    serviceSupabase: {
      async rpc(name, args) {
        calls.push({ name, args });
        return {
          data: { id: publication.id, status: "preparing", syncState: "delayed", publishedAt: null, lastSyncAt: null, publicationRevision: 1 },
          error: null,
        };
      },
    },
    userSupabase: {
      async rpc(name, args) {
        calls.push({ name, args });
        return { data: publication, error: null };
      },
    },
    versionId: publication.sourceVersionId,
  });
  assert.equal(result.recovery, "reconnect");
  assert.deepEqual(calls.map(({ name }) => name), ["prepare_team_workweek_publication", "delay_team_workweek_publication"]);
});

test("team visibility switches from the bounded predecessor to the prepared successor on Monday", () => {
  const rows = [
    { id: "a-old", ownerProfileId: "a", effectiveFrom: "2026-08-17", effectiveTo: "2026-08-30", publicationRevision: 1 },
    { id: "a-new", ownerProfileId: "a", effectiveFrom: "2026-08-31", effectiveTo: null, publicationRevision: 2 },
    { id: "b-current", ownerProfileId: "b", effectiveFrom: "2026-08-24", effectiveTo: null, publicationRevision: 1 },
  ];
  assert.deepEqual(
    publishedModel.selectVisibleTeamWorkweeks(rows, "2026-08-30").map(({ id, phase }) => [id, phase]),
    [["a-old", "current"], ["a-new", "prepared"], ["b-current", "current"]],
  );
  assert.deepEqual(
    publishedModel.selectVisibleTeamWorkweeks(rows, "2026-08-31").map(({ id, phase }) => [id, phase]),
    [["a-new", "current"], ["b-current", "current"]],
  );
});

test("a provider confirmation arriving after the candidate never finalizes and retry cleans the expired generation first", async () => {
  let clock = new Date("2026-10-14T10:00:00Z");
  const effect={id:"effect-1",calendarId:"primary",googleEventId:"fops12345",generation:1,state:"pending",confirmedEtag:null,payload:{id:"fops12345",start:{dateTime:"2026-10-14T10:03:00Z",timeZone:"Europe/Berlin"},end:{dateTime:"2026-10-14T15:00:00Z",timeZone:"Europe/Berlin"},extendedProperties:{private:{founderopsWorkweekEffectId:"effect-1",founderopsWorkweekGeneration:"1"}}}};
  const prepared={...publication,activationMode:"immediate",effectiveAt:"2026-10-14T10:03:00Z",attemptGeneration:1,effects:[effect]};
  let cleaned=false;const calls=[];
  const userSupabase={async rpc(name){calls.push(name);if(name==="prepare_team_workweek_publication")return {data:cleaned?{...prepared,effectiveAt:"2026-10-14T10:07:00Z",attemptGeneration:2,effects:[]}:prepared,error:null};if(name==="finalize_team_workweek_publication")return {data:{...prepared,status:"published",syncState:"confirmed",effectiveAt:"2026-10-14T10:07:00Z"},error:null};throw new Error(name);}};
  const serviceSupabase={async rpc(name){calls.push(name);if(name==="claim_team_workweek_provider_operation")return {data:{state:"claimed",id:"op"},error:null};if(name==="finish_team_workweek_provider_operation")return {data:{state:"settled"},error:null};if(name==="prepare_team_workweek_effect_cleanup")return {data:{effects:[{...effect,operation:"create",state:cleaned?"cleaned":"pending",cleanupDisposition:"preserve",cleanupPayload:effect.payload}]},error:null};if(name==="confirm_team_workweek_planned_cleanup"){cleaned=true;return {data:null,error:null};}if(name==="delay_team_workweek_publication")return {data:{...prepared,syncState:"delayed"},error:null};throw new Error(name);}};
  const delayed=await publicationServer.publishTeamWorkweek({userSupabase,serviceSupabase,versionId:publication.sourceVersionId,now:()=>clock,ensureEffect:async()=>{clock=new Date("2026-10-14T10:04:00Z");return {state:"confirmed",etag:'"late"',observedAt:clock.toISOString()};}});
  assert.equal(delayed.status,"preparing");assert.equal(calls.includes("finalize_team_workweek_publication"),false);
  const recovered=await publicationServer.publishTeamWorkweek({userSupabase,serviceSupabase,versionId:publication.sourceVersionId,now:()=>clock,cleanupEffect:async()=>({state:"confirmed",etag:"absent",observedAt:clock.toISOString()})});
  assert.equal(cleaned,true);assert.equal(recovered.status,"published");assert.equal(recovered.effectiveAt,"2026-10-14T10:07:00Z");
});

test("a lost immediate finalization response replays the committed instant after its deadline", async () => {
  const result=await publicationServer.publishTeamWorkweek({
    versionId:publication.sourceVersionId,
    userSupabase:{async rpc(){return {data:{...publication,status:"published",syncState:"confirmed",activationMode:"immediate",effectiveAt:"2026-10-14T10:03:00Z",attemptGeneration:1,effects:[]},error:null};}},
    serviceSupabase:{async rpc(){throw new Error("committed publication must not be touched");}},
    now:()=>new Date("2026-10-15T12:00:00Z"),
    ensureEffect:async()=>{throw new Error("do not replay a committed projection");},
    cleanupEffect:async()=>{throw new Error("do not compensate a committed projection");},
  });
  assert.equal(result.status,"published");assert.equal(result.effectiveAt,"2026-10-14T10:03:00Z");assert.equal(result.recovery,null);
});

test("a confirmed same-week correction retains the baseline until its exact boundary",()=>{
  const rows=[{id:"old",ownerProfileId:"p",effectiveFrom:"2026-10-12",effectiveAt:"2026-10-14T07:00:00Z",effectiveUntil:"2026-10-14T10:03:00Z",effectiveTo:"2026-10-14",publicationRevision:1},{id:"new",ownerProfileId:"p",effectiveFrom:"2026-10-12",effectiveAt:"2026-10-14T10:03:00Z",effectiveTo:null,publicationRevision:2}];
  assert.deepEqual(publishedModel.selectVisibleTeamWorkweeks(rows,"2026-10-14",new Date("2026-10-14T10:02:59Z")).map(({id,phase})=>[id,phase]),[["old","current"],["new","prepared"]]);
  assert.deepEqual(publishedModel.selectVisibleTeamWorkweeks(rows,"2026-10-14",new Date("2026-10-14T10:03:00Z")).map(({id,phase})=>[id,phase]),[["new","current"]]);
});

test("lost partial predecessor updates are restored before a later candidate resumes",async()=>{
  let clock=new Date("2026-10-14T10:04:00Z");const events=[];
  const effect={id:"cutoff",calendarId:"primary",googleEventId:"fopsabc123",generation:1,state:"confirmed",confirmedEtag:'"cut"',operation:"update",kind:"predecessor_cutoff",expectedEtag:'"old"',expectedPayload:{id:"fopsabc123"},payload:{id:"fopsabc123"}};
  const first={...publication,activationMode:"immediate",effectiveAt:"2026-10-14T10:03:00Z",attemptGeneration:1,effects:[effect]};let restored=false;
  const userSupabase={async rpc(name){events.push(name);if(name==="prepare_team_workweek_publication")return {data:restored?{...first,effectiveAt:"2026-10-14T10:07:00Z",attemptGeneration:2,effects:[]}:first,error:null};if(name==="finalize_team_workweek_publication")return {data:{...first,status:"published",syncState:"confirmed",effectiveAt:"2026-10-14T10:07:00Z"},error:null};throw new Error(name);}};
  const serviceSupabase={async rpc(name,args){events.push(name);if(name==="claim_team_workweek_provider_operation")return {data:{state:"claimed",id:"op"},error:null};if(name==="finish_team_workweek_provider_operation")return {data:{state:"settled"},error:null};if(name==="prepare_team_workweek_effect_cleanup")return {data:{effects:[{...effect,state:restored?"cleaned":"confirmed",cleanupDisposition:"restore",cleanupPayload:effect.expectedPayload}]},error:null};assert.equal(name,"confirm_team_workweek_planned_cleanup");assert.equal(args.p_etag,'"restored"');assert.equal(args.p_preserved,false);restored=true;return {data:null,error:null};}};
  const result=await publicationServer.publishTeamWorkweek({versionId:publication.sourceVersionId,userSupabase,serviceSupabase,now:()=>clock,cleanupEffect:async()=>({state:"confirmed",etag:'"restored"',observedAt:clock.toISOString()})});
  assert.equal(result.status,"published");assert.deepEqual(events.filter(name=>!["claim_team_workweek_provider_operation","finish_team_workweek_provider_operation"].includes(name)),["prepare_team_workweek_publication","prepare_team_workweek_effect_cleanup","prepare_team_workweek_effect_cleanup","prepare_team_workweek_effect_cleanup","confirm_team_workweek_planned_cleanup","prepare_team_workweek_publication","finalize_team_workweek_publication"]);
});

test("a failed database completion resumes confirmed effects without another Google write", async () => {
  const prepared={...publication,activationMode:"future_monday",effectiveAt:"2099-01-11T23:00:00Z",attemptGeneration:1,effects:[{id:"confirmed-effect",calendarId:"primary",googleEventId:"managed",generation:1,state:"confirmed",confirmedEtag:"confirmed",operation:"create",kind:"weekly",payload:{id:"managed"}}]};
  let finalizations=0;
  const userSupabase={async rpc(name){
    if(name==="prepare_team_workweek_publication")return {data:prepared,error:null};
    if(name==="finalize_team_workweek_publication"){
      finalizations++;
      return finalizations===1?{data:null,error:{code:"23514"}}:{data:{...prepared,status:"published",syncState:"confirmed"},error:null};
    }
    throw new Error(name);
  }};
  const ensureEffect=vi.fn(()=>{throw new Error("confirmed Google writes must not repeat");});
  const args={userSupabase,serviceSupabase:{async rpc(name){return {data:name==="claim_team_workweek_provider_operation"?{state:"claimed",id:"op"}:{state:"settled"},error:null};}},versionId:publication.sourceVersionId,ensureEffect};
  await assert.rejects(publicationServer.publishTeamWorkweek(args),error=>error.code==="completion_pending");
  const result=await publicationServer.publishTeamWorkweek(args);
  assert.equal(result.id,prepared.id);assert.equal(result.status,"published");assert.equal(ensureEffect.mock.calls.length,0);
});

test("a fully superseded future interval never hides the replacement in the team overview",()=>{
  const start="2099-01-11T23:00:00Z";
  const base={ownerProfileId:"owner",effectiveFrom:"2099-01-12",effectiveAt:start,effectiveTo:null};
  const rows=publishedModel.selectVisibleTeamWorkweeks([
    {...base,id:"retired",effectiveUntil:start,publicationRevision:1},
    {...base,id:"replacement",publicationRevision:2},
  ],"2026-10-15",new Date("2026-10-15T12:00:00Z"));
  assert.deepEqual(rows.map(row=>row.id),["replacement"]);
});


test.each([false, true])("publication replays through its provider adapter and holds the claim through owner completion (completion fails: %s)", async (completionFails) => {
  const effect = { id: "recover-effect", calendarId: "primary", googleEventId: "fopsrecover", generation: 1,
    state: "confirmed", confirmedEtag: "confirmed", operation: "create", kind: "series",
    payload: { id: "fopsrecover" } };
  const prepared = { ...publication, activationMode: "immediate", effectiveAt: "2099-01-12T09:00:00Z",
    attemptGeneration: 1, writeJournalVersion: 1, effects: [effect] };
  let claimed = false;
  let recovered = false;
  let finalized = false;
  let settled = false;
  const serviceSupabase = {
    from() {
      return { select() { return this; }, eq() { return this; }, async in() {
        return { data: [{ effect_id: effect.id, team_workweek_publication_effects: {
          id: effect.id, google_event_id: effect.googleEventId, generation: 1, kind: effect.kind,
          operation: effect.operation, payload: effect.payload, state: effect.state, confirmed_etag: effect.confirmedEtag,
        } }], error: null };
      } };
    },
    async rpc(name, args) {
      if (name === "claim_team_workweek_provider_operation") {
        if (!claimed) { claimed = true; return { data: { state: "uncertain", id: "old", purpose: "publish", abandon: false }, error: null }; }
        assert.equal(recovered, true);
        return { data: { state: "claimed", id: "new" }, error: null };
      }
      if (name === "finish_team_workweek_provider_operation") {
        assert.equal(finalized, args.p_operation_id === "new");
        if (args.p_operation_id === "new") settled = true;
        return { data: { state: "settled" }, error: null };
      }
      throw new Error(name);
    },
  };
  const userSupabase = { async rpc(name) {
    if (name === "prepare_team_workweek_publication") return { data: prepared, error: null };
    assert.equal(name, "finalize_team_workweek_publication");
    assert.equal(recovered, true);
    finalized = true;
    return completionFails ? { data: null, error: { code: "23514" } }
      : { data: { ...prepared, status: "published", syncState: "confirmed" }, error: null };
  } };
  // A single provider seam must serve replay and normal execution; no global HTTP is needed.
  const execution = publicationServer.publishTeamWorkweek({ serviceSupabase, userSupabase,
    versionId: publication.sourceVersionId,
    recoverWrite: async ({ effect: recovering, purpose, abandon }) => {
      assert.equal(recovering.id, effect.id);
      assert.equal(purpose, "publish");
      assert.equal(abandon, false);
      recovered = true;
      return { state: "confirmed", etag: "recovered", observedAt: "2026-10-16T10:00:00Z" };
    },
    ensureEffect: async () => { throw new Error("Confirmed effects must not be written again."); },
  });
  if (completionFails) await assert.rejects(execution, error => error.code === "completion_pending");
  else assert.equal((await execution).status, "published");
  assert.equal(settled, true);
  assert.equal(finalized, true);
});
