import assert from "node:assert/strict";

import { test } from "vitest";

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
    "./google-workspace-oauth-core": { GoogleWorkspaceOAuthContractError: MockGoogleWorkspaceOAuthContractError },
    "./google-workspace-oauth": { getGoogleWorkspaceAccessToken: async () => "token" },
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
  series: [],
  transitions: [],
};

const series = {
  id: "22222222-2222-4222-8222-222222222222",
  calendarId: "primary",
  googleEventId: "fops22222222222242228222222222222222",
  state: "pending",
  confirmedEtag: null,
  weekday: 1,
  startMinute: 9 * 60,
  endMinute: 17 * 60,
};

const transition = {
  id: "44444444-4444-4444-8444-444444444444",
  calendarId: "primary",
  googleEventId: series.googleEventId,
  predecessorSeriesId: series.id,
  state: "pending",
  expectedEtag: '"etag-1"',
  expectedFounderopsRevision: 1,
  recurrenceCount: 2,
  confirmedEtag: null,
};

test("publication resumes pending transitions only after every replacement series is confirmed", async () => {
  let seriesConfirmed = false;
  let transitionConfirmed = false;
  let transitionAttempts = 0;
  const userCalls = [];
  const serviceCalls = [];
  const prepared = {
    ...publication,
    publicationRevision: 2,
    syncState: "pending",
    series: [{ ...series, state: "pending" }],
    transitions: [transition],
  };
  const userSupabase = {
    async rpc(name, args) {
      userCalls.push({ name, args });
      if (name === "prepare_team_workweek_publication") {
        return {
          data: {
            ...prepared,
            syncState: seriesConfirmed ? "delayed" : "pending",
            series: prepared.series.map((item) => ({ ...item, state: seriesConfirmed ? "confirmed" : "pending" })),
            transitions: prepared.transitions.map((item) => ({ ...item, state: transitionConfirmed ? "confirmed" : "pending" })),
          },
          error: null,
        };
      }
      if (name === "finalize_team_workweek_publication") {
        assert.equal(seriesConfirmed, true);
        assert.equal(transitionConfirmed, true);
        return {
          data: {
            id: publication.id,
            status: "published",
            syncState: "confirmed",
            publishedAt: "2026-08-25T12:30:00.000Z",
            lastSyncAt: "2026-08-25T12:30:00.000Z",
            publicationRevision: 2,
          },
          error: null,
        };
      }
      throw new Error(`Unexpected user RPC ${name}`);
    },
  };
  const serviceSupabase = {
    async rpc(name, args) {
      serviceCalls.push({ name, args });
      if (name === "confirm_team_workweek_google_series") {
        seriesConfirmed = true;
        return { data: null, error: null };
      }
      if (name === "confirm_team_workweek_google_series_transition") {
        transitionConfirmed = true;
        return { data: null, error: null };
      }
      if (name === "delay_team_workweek_publication") {
        return {
          data: {
            id: publication.id,
            status: "preparing",
            syncState: "delayed",
            publishedAt: null,
            lastSyncAt: null,
            publicationRevision: 2,
          },
          error: null,
        };
      }
      throw new Error(`Unexpected service RPC ${name}`);
    },
  };
  const ensureSeries = async () => ({ state: "confirmed", etag: '"new"', observedAt: "2026-08-25T12:10:00.000Z" });
  const ensureTransition = async () => {
    transitionAttempts += 1;
    return transitionAttempts === 1
      ? { state: "delayed", errorClass: "provider_identity_mismatch" }
      : { state: "confirmed", etag: '"transition"', observedAt: "2026-08-25T12:20:00.000Z" };
  };

  const delayed = await publicationServer.publishTeamWorkweek({
    serviceSupabase,
    userSupabase,
    versionId: publication.sourceVersionId,
    ensureSeries,
    ensureTransition,
  });
  assert.equal(delayed.recovery, "identity_conflict");
  assert.equal(userCalls.some((call) => call.name === "finalize_team_workweek_publication"), false);
  assert.equal(serviceCalls.filter((call) => call.name === "confirm_team_workweek_google_series").length, 1);

  const published = await publicationServer.publishTeamWorkweek({
    serviceSupabase,
    userSupabase,
    versionId: publication.sourceVersionId,
    ensureSeries: async () => {
      throw new Error("confirmed replacement series must not be replayed");
    },
    ensureTransition,
  });
  assert.equal(published.status, "published");
  assert.equal(serviceCalls.at(-1).args.p_expected_founderops_revision, transition.expectedFounderopsRevision);
  assert.equal(userCalls.at(-1).name, "finalize_team_workweek_publication");
});

test("a failed replacement series prevents every predecessor transition in that attempt", async () => {
  let transitionCalls = 0;
  const prepared = {
    ...publication,
    publicationRevision: 2,
    series: [{ ...series, state: "pending" }],
    transitions: [transition],
  };
  const userSupabase = {
    async rpc(name) {
      if (name === "prepare_team_workweek_publication") return { data: prepared, error: null };
      throw new Error(`Unexpected user RPC ${name}`);
    },
  };
  const serviceSupabase = {
    async rpc(name) {
      if (name === "delay_team_workweek_publication") {
        return {
          data: { id: publication.id, status: "preparing", syncState: "delayed", publishedAt: null, lastSyncAt: null, publicationRevision: 2 },
          error: null,
        };
      }
      throw new Error(`Unexpected service RPC ${name}`);
    },
  };
  const result = await publicationServer.publishTeamWorkweek({
    serviceSupabase,
    userSupabase,
    versionId: publication.sourceVersionId,
    ensureSeries: async () => ({ state: "delayed", errorClass: "provider_identity_mismatch" }),
    ensureTransition: async () => {
      transitionCalls += 1;
      return { state: "confirmed", etag: '"never"', observedAt: "2026-08-25T12:00:00.000Z" };
    },
  });
  assert.equal(result.recovery, "identity_conflict");
  assert.equal(transitionCalls, 0);
});

test("conflict resolution checks predecessor transitions before creating replacement series", async () => {
  let seriesCalls = 0;
  const prepared = {
    ...publication,
    publicationRevision: 2,
    series: [{ ...series, state: "pending" }],
    transitions: [transition],
  };
  const userSupabase = {
    async rpc(name) {
      if (name === "prepare_team_workweek_publication") return { data: prepared, error: null };
      throw new Error(`Unexpected user RPC ${name}`);
    },
  };
  const serviceSupabase = {
    async rpc(name) {
      if (name === "delay_team_workweek_publication") {
        return {
          data: { id: publication.id, status: "preparing", syncState: "delayed", publishedAt: null, lastSyncAt: null, publicationRevision: 2 },
          error: null,
        };
      }
      throw new Error(`Unexpected service RPC ${name}`);
    },
  };
  const result = await publicationServer.publishTeamWorkweek({
    serviceSupabase,
    userSupabase,
    versionId: publication.sourceVersionId,
    transitionsFirst: true,
    ensureSeries: async () => {
      seriesCalls += 1;
      return { state: "confirmed", etag: '"new"', observedAt: "2026-08-25T12:00:00.000Z" };
    },
    ensureTransition: async () => ({ state: "delayed", errorClass: "provider_identity_mismatch" }),
  });
  assert.equal(result.recovery, "identity_conflict");
  assert.equal(seriesCalls, 0);
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
  const serviceSupabase={async rpc(name){calls.push(name);if(name==="prepare_team_workweek_effect_cleanup")return {data:{effects:[{...effect,operation:"create",state:cleaned?"cleaned":"pending",cleanupDisposition:"preserve",cleanupPayload:effect.payload}]},error:null};if(name==="confirm_team_workweek_planned_cleanup"){cleaned=true;return {data:null,error:null};}if(name==="delay_team_workweek_publication")return {data:{...prepared,syncState:"delayed"},error:null};throw new Error(name);}};
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
  const serviceSupabase={async rpc(name,args){events.push(name);if(name==="prepare_team_workweek_effect_cleanup")return {data:{effects:[{...effect,state:restored?"cleaned":"confirmed",cleanupDisposition:"restore",cleanupPayload:effect.expectedPayload}]},error:null};assert.equal(name,"confirm_team_workweek_planned_cleanup");assert.equal(args.p_etag,'"restored"');assert.equal(args.p_preserved,false);restored=true;return {data:null,error:null};}};
  const result=await publicationServer.publishTeamWorkweek({versionId:publication.sourceVersionId,userSupabase,serviceSupabase,now:()=>clock,cleanupEffect:async()=>({state:"confirmed",etag:'"restored"',observedAt:clock.toISOString()})});
  assert.equal(result.status,"published");assert.deepEqual(events,["prepare_team_workweek_publication","prepare_team_workweek_effect_cleanup","prepare_team_workweek_effect_cleanup","prepare_team_workweek_effect_cleanup","confirm_team_workweek_planned_cleanup","prepare_team_workweek_publication","finalize_team_workweek_publication"]);
});
