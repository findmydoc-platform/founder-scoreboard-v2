import { vi } from "vitest";
vi.mock("@/lib/supabase-user", async () => vi.importMock("@/lib/supabase"));
import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const draftModel = await import("../../../src/features/team-workweek/model/team-workweek-draft.ts");
const calendarModel = await import("../../../src/features/team-workweek/model/team-workweek-calendar.ts");

function apiError(message, status) {
  return Response.json({ error: message }, { status });
}

function query(data, error = null) {
  let sourceFilter=false;
  let automatic=false;
  return {
    select() { return this; },
    eq(key,value) { if(key==="source_version_id")sourceFilter=true;if(key==="origin" && value==="google_reconciliation")automatic=true;return this; },
    is() { return this; },
    order() { return this; },
    limit() { return this; },
    maybeSingle() { return Promise.resolve({ data:sourceFilter?null:automatic?automaticVersionResult:data, error }); },
    returns() { return Promise.resolve({ data: data ? (Array.isArray(data) ? data : [data]) : [], error }); },
  };
}

const latestPublication = {
  id: "publication-1",
  effective_from: "2026-08-31",
  status: "published",
  sync_state: "confirmed",
  publication_revision: 4,
  published_at: "2026-08-28T10:00:00.000Z",
  last_sync_at: "2026-08-28T10:00:00.000Z",
  windows: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
  team_workweek_google_reconciliation_status: null,
};
let postPayload = null;
let rpcError = null;
let pendingOwnerPublicationResult = null;
let postCalls = [];
let latestPublicationResult = { data: latestPublication, error: null };
let privateVersionResult=null;
let automaticVersionResult=null;
let automaticPublicationResult=null;

const route = await importTestModule(
  "src/app/api/team-workweek/private-draft/route.ts",
  {
    "next/server": { NextResponse: { json: (value, init) => Response.json(value, init) } },
    "@/features/team-workweek/model/team-workweek-draft": {
      ...draftModel,
      nextVersionMondayIso: () => "2026-09-07",
    },
    "@/features/team-workweek/model/team-workweek-calendar": calendarModel,
    "@/lib/api-response": {
      apiError,
      readJsonPayload: async () => postPayload,
      requireApiContext: async () => ({
        ok: true,
        permission: { profile: { id: "profile-1", platformRole: "founder" } },
      }),
    },
    "@/lib/authz": {
      bearerToken: () => "session-token",
      requireTeamMember: Symbol("requireTeamMember"),
    },
    "@/lib/supabase": {
      getSupabaseForToken: () => ({
        async rpc(name,args) { postCalls.push([name,args]); return { error:rpcError, data:{id:"first",activationMode:"immediate",effectiveFrom:"2026-10-12",status:"preparing",timezone:"Europe/Berlin"} }; },
        from(table) {
          if (table === "team_workweek_versions") return query(privateVersionResult);
          if (table === "team_workweek_google_conflicts") return query(null);
          if (table === "team_workweek_publications") {
            const result=query(latestPublicationResult.data, latestPublicationResult.error);
            let sourceId=null;
            let pendingLookup=false;
            const select=result.select;result.select=function(fields){pendingLookup=fields.includes("write_journal_version");return select.call(this,fields);};
            const filter=result.eq;
            result.eq=function(key,value){if(key==="source_version_id")sourceId=value;return filter.call(this,key,value);};
            result.maybeSingle=async()=>({data:pendingLookup?pendingOwnerPublicationResult:sourceId==="published-owner"?latestPublication:sourceId && sourceId!==automaticVersionResult?.id?null:automaticPublicationResult,error:null});
            return result;
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      }),
    },
  },
);

test.beforeEach(() => {
  rpcError=null;
  pendingOwnerPublicationResult=null;
  privateVersionResult=null;
  automaticVersionResult=null;
  automaticPublicationResult=null;
  latestPublicationResult = { data: latestPublication, error: null };
});

test("a selected current week uses the owner-bound week RPC instead of rejecting its elapsed Monday", async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
  try {
    postCalls=[];
    postPayload={selectedWeekStart:"2026-10-12",contextToken:"a".repeat(32),windows:draftModel.emptyTeamWorkweekWindows()};
    const result=await route.POST({});
    assert.equal(result.status,201);
    assert.deepEqual(postCalls,[["create_private_selected_team_workweek_version",{p_week_start:"2026-10-12",p_windows:[],p_context_token:"a".repeat(32)}]]);
  } finally {vi.useRealTimers();}
});

test.each(["2026-10-05","2026-10-20"])("rejects an invalid selected week before a write: %s",async week=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
  try {
    postCalls=[];postPayload={selectedWeekStart:week,contextToken:"a".repeat(32),windows:draftModel.emptyTeamWorkweekWindows()};
    assert.equal((await route.POST({})).status,400);
    assert.equal(postCalls.length,0);
  } finally {vi.useRealTimers();}
});

test.each(["delayed", "pending"])("a future Monday %s owner attempt exposes its server-guarded recovery", async syncState => {
  privateVersionResult = { id: "owner-future", owner_profile_id: "profile-1", effective_from: "2099-01-12", activation_mode: "future_monday", timezone: "Europe/Berlin", status: "preparing", created_at: "2026-10-14T10:00:00Z", team_workweek_windows: [] };
  automaticVersionResult = privateVersionResult;
  automaticPublicationResult = { ...latestPublication, id: "owner-operation", source_version_id: privateVersionResult.id, effective_from: "2099-01-12", effective_at: "2099-01-11T23:00:00Z", attempt_generation: 1, status: "preparing", sync_state: syncState };
  const body = await (await route.GET({nextUrl:new URL("http://localhost/api/team-workweek/private-draft")})).json();
  assert.equal(body.restartAvailable, true);
  assert.equal(body.publication.id, "owner-operation");
  assert.doesNotMatch(JSON.stringify(body), /provider_operations|provider_writes|google_event_id|confirmed_etag/);
});

test("a pinned successor mapping change offers explicit restart without exposing provider identities",async()=>{
  const future={...latestPublication,id:"future",source_version_id:"future-source",effective_from:"2030-04-01",effective_at:"2030-04-01T00:00:00+02:00",publication_revision:5,windows:[],team_workweek_google_series:[{id:"series",google_event_id:"managed",confirmed_etag:"old",state:"confirmed",provider_state:"active",projection_part:"legacy",source_window_ids:null}]};
  privateVersionResult={id:"private",owner_profile_id:"profile-1",effective_from:"2026-10-12",activation_mode:"immediate",base_publication_id:latestPublication.id,base_publication_revision:4,timezone:"Europe/Berlin",status:"preparing",created_at:"2026-10-14T10:00:00Z",team_workweek_windows:[],successor_snapshot:[{id:"future",revision:5,start:future.effective_at,until:null,effectiveTo:null,sourceVersionId:future.source_version_id,supersededBy:null,windows:[],series:[{id:"series",googleEventId:"managed",etag:"old",state:"confirmed",providerState:"active",part:"legacy",sources:null}]}]};
  latestPublicationResult={data:[future,latestPublication],error:null};
  assert.equal((await (await route.GET({nextUrl:new URL("http://localhost/api/team-workweek/private-draft")})).json()).restartAvailable,false);
  future.team_workweek_google_series[0].confirmed_etag="new";
  const result=await (await route.GET({nextUrl:new URL("http://localhost/api/team-workweek/private-draft")})).json();
  assert.equal(result.restartAvailable,true);
  assert.doesNotMatch(JSON.stringify(result),/managed|googleEventId|confirmed_etag/);
});

test("the private editor receives the latest published windows as its edit base", async () => {
  const response = await route.GET({nextUrl:new URL("http://localhost/api/team-workweek/private-draft")});
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.deepEqual(body.editBase, {
    basePublicationId:"publication-1",basePublicationRevision:4,
    windows: {
      monday: [{ start: "09:00", end: "17:00" }],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    },
  });
  assert.equal(body.minimumEffectiveFrom, "2026-09-07");
});

test("the first setup has no published edit base", async () => {
  latestPublicationResult = { data: null, error: null };

  const response = await route.GET({nextUrl:new URL("http://localhost/api/team-workweek/private-draft")});
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.editBase, null);
  assert.equal(body.latestPublished, null);
  assert.equal(body.minimumEffectiveFrom, "2026-09-07");
});

test("a publication lookup failure remains a load error", async () => {
  latestPublicationResult = { data: null, error: { message: "database unavailable" } };

  const response = await route.GET({nextUrl:new URL("http://localhost/api/team-workweek/private-draft")});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Veröffentlichungsstatus konnte nicht geladen werden." });
});

test("the editor corrects current windows and separately discloses the retained successor", async () => {
  const future = { ...latestPublication, id: "future", effective_from: "2099-09-07", publication_revision: 5,
    windows: [{ weekday: 1, startMinute: 600, endMinute: 960 }] };
  latestPublicationResult = { data: [future, { ...latestPublication, effective_to: "2099-09-06" }], error: null };
  const response = await route.GET({nextUrl:new URL("http://localhost/api/team-workweek/private-draft")});
  const body = await response.json();
  assert.deepEqual(body.editBase.windows.monday, [{ start: "09:00", end: "17:00" }]);
  assert.equal(body.editBase.basePublicationId, "publication-1");
  assert.equal(body.preparedSuccessor.id, "future");
  assert.equal(body.immediateAllowed, true);
});

test("two minutes before a legacy Monday the editor does not offer a candidate beyond that successor", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T21:58:00Z"));
  try {
    latestPublicationResult = { data: [{ ...latestPublication, id: "monday", effective_from: "2026-10-19", publication_revision: 5 }, { ...latestPublication, effective_to: "2026-10-18" }], error: null };
    const body = await (await route.GET({nextUrl:new URL("http://localhost/api/team-workweek/private-draft")})).json();
    assert.equal(body.immediateAllowed, false);
    assert.equal(body.editBase.basePublicationId, "publication-1");
  } finally { vi.useRealTimers(); }
});

test("the immediate API stores intent without accepting a client activation time", async () => {
  postPayload={effectiveFrom:draftModel.nextMondayIso(),activationMode:"immediate",windows:draftModel.emptyTeamWorkweekWindows()};
  postCalls=[];
  const created=await route.POST({});assert.equal(created.status,201);
  assert.deepEqual(postCalls,[["create_private_immediate_team_workweek_version",{p_windows:[]}]]);
  postPayload={...postPayload,effectiveAt:"2026-10-14T10:00:00Z"};
  assert.equal((await route.POST({})).status,400);assert.equal(postCalls.length,1);
});


test.each(["none","private","published"])("an expired automatic Google correction offers owner restart with %s owner history", async ownerState => {
  const existingDraft=ownerState==="private";
  automaticVersionResult={id:"automatic-version",owner_profile_id:"profile-1",effective_from:"2026-10-12",activation_mode:"immediate",base_publication_id:latestPublication.id,base_publication_revision:4,timezone:"Europe/Berlin",status:"preparing",created_at:"2026-10-14T10:00:00Z",team_workweek_windows:[{weekday:1,start_minute:600,end_minute:1080}]};
  automaticPublicationResult={...latestPublication,id:"automatic-operation",source_version_id:automaticVersionResult.id,status:"preparing",sync_state:"delayed",effective_at:"2026-10-14T10:03:00Z",attempt_generation:1};
  if(ownerState!=="none")privateVersionResult={...automaticVersionResult,id:existingDraft?"owner-draft":"published-owner",team_workweek_windows:[{weekday:1,start_minute:480,end_minute:720}]};
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-19T00:10:00Z"));
  try{
    const response=await route.GET({nextUrl:new URL("http://localhost/api/team-workweek/private-draft")});const body=await response.json();
    assert.equal(response.status,200);
    assert.equal(body.restartAvailable,true);
    assert.equal(body.version.id,existingDraft?"owner-draft":"automatic-version");
    assert.deepEqual(body.version.windows.monday,[existingDraft?{start:"08:00",end:"12:00"}:{start:"10:00",end:"18:00"}]);
    assert.equal(body.publication.id,"automatic-operation");
    assert.doesNotMatch(JSON.stringify(body),/google_event_id|confirmed_etag/);
  }finally{vi.useRealTimers();}
});


test.each([["P0003","publication_pending"],["P0004","edit_context_stale"]])("distinguishes save conflict %s",async (databaseCode,code)=>{
  rpcError={code:databaseCode};
  postPayload={effectiveFrom:draftModel.nextMondayIso(),activationMode:"immediate",windows:draftModel.emptyTeamWorkweekWindows()};
  const result=await route.POST({});
  assert.equal(result.status,409);
  const body=await result.json();assert.equal(body.code,code);assert.equal(typeof body.error,"string");
});

test("an owner sees the open publication even while loading a different week",async()=>{
  pendingOwnerPublicationResult={id:"pending-owner",source_version_id:"pending-source",effective_from:"2099-01-12",effective_at:"2099-01-11T23:00:00Z",write_journal_version:1,restart_requested_at:null};
  const body=await(await route.GET({nextUrl:new URL("http://localhost/api/team-workweek/private-draft?week=2099-01-19")})).json();
  assert.deepEqual(body.pendingPublication,{id:"pending-owner",sourceVersionId:"pending-source",effectiveFrom:"2099-01-12",resumeAllowed:true});
  pendingOwnerPublicationResult.restart_requested_at="2026-10-15T12:00:00Z";
  const cancelled=await(await route.GET({nextUrl:new URL("http://localhost/api/team-workweek/private-draft?week=2099-01-19")})).json();
  assert.equal(cancelled.pendingPublication.resumeAllowed,false);
});

test("an expired automatic operation does not replace an explicitly selected week's draft",async()=>{
  automaticVersionResult={id:"automatic-version",owner_profile_id:"profile-1",effective_from:"2026-10-12",activation_mode:"immediate",timezone:"Europe/Berlin",status:"preparing",created_at:"2026-10-14T10:00:00Z",team_workweek_windows:[]};
  automaticPublicationResult={...latestPublication,id:"automatic-operation",source_version_id:automaticVersionResult.id,status:"preparing",sync_state:"delayed",effective_at:"2026-10-14T10:03:00Z",attempt_generation:1};
  const body=await(await route.GET({nextUrl:new URL("http://localhost/api/team-workweek/private-draft?week=2099-01-19")})).json();
  assert.equal(body.version,null);
});


test("a pending legacy Monday publication resumes through publish while untracked modern attempts stay fenced",async()=>{
  pendingOwnerPublicationResult={id:"legacy",source_version_id:"legacy-source",effective_from:"2099-01-12",effective_at:null,attempt_generation:0,write_journal_version:0,restart_requested_at:null};
  const request={nextUrl:new URL("http://localhost/api/team-workweek/private-draft?week=2099-01-19")};
  assert.equal((await(await route.GET(request)).json()).pendingPublication.resumeAllowed,true);
  pendingOwnerPublicationResult.attempt_generation=1;
  assert.equal((await(await route.GET(request)).json()).pendingPublication.resumeAllowed,false);
});


test("a persistent Google identity conflict offers restart instead of repeating the same future publication",async()=>{
  pendingOwnerPublicationResult={id:"identity-pending",source_version_id:"identity-source",effective_from:"2099-01-12",effective_at:"2099-01-11T23:00:00Z",attempt_generation:1,write_journal_version:1,restart_requested_at:null,last_error_class:"provider_identity_mismatch"};
  const body=await(await route.GET({nextUrl:new URL("http://localhost/api/team-workweek/private-draft?week=2099-01-19")})).json();
  assert.equal(body.pendingPublication.resumeAllowed,false);
  assert.equal(body.pendingPublication.sourceVersionId,"identity-source");
  assert.deepEqual(postCalls.at(-1),["team_workweek_edit_context",{p_week_start:"2099-01-19"}]);
});
