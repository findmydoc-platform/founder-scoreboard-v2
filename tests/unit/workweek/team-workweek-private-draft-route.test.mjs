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
  return {
    select() { return this; },
    eq(key) { if(key==="source_version_id")sourceFilter=true;return this; },
    is() { return this; },
    order() { return this; },
    limit() { return this; },
    maybeSingle() { return Promise.resolve({ data:sourceFilter?null:data, error }); },
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
let postCalls = [];
let latestPublicationResult = { data: latestPublication, error: null };
let privateVersionResult=null;

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
        async rpc(name,args) { postCalls.push([name,args]); return { data:{id:"first",activationMode:"immediate",effectiveFrom:"2026-10-12",status:"preparing",timezone:"Europe/Berlin"},error:null }; },
        from(table) {
          if (table === "team_workweek_versions") return query(privateVersionResult);
          if (table === "team_workweek_google_conflicts") return query(null);
          if (table === "team_workweek_publications") {
            return query(latestPublicationResult.data, latestPublicationResult.error);
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      }),
    },
  },
);

test.beforeEach(() => {
  privateVersionResult=null;
  latestPublicationResult = { data: latestPublication, error: null };
});

test("a pinned successor mapping change offers explicit restart without exposing provider identities",async()=>{
  const future={...latestPublication,id:"future",source_version_id:"future-source",effective_from:"2030-04-01",effective_at:"2030-04-01T00:00:00+02:00",publication_revision:5,windows:[],team_workweek_google_series:[{id:"series",google_event_id:"managed",confirmed_etag:"old",state:"confirmed",provider_state:"active",projection_part:"legacy",source_window_ids:null}]};
  privateVersionResult={id:"private",owner_profile_id:"profile-1",effective_from:"2026-10-12",activation_mode:"immediate",base_publication_id:latestPublication.id,base_publication_revision:4,timezone:"Europe/Berlin",status:"preparing",created_at:"2026-10-14T10:00:00Z",team_workweek_windows:[],successor_snapshot:[{id:"future",revision:5,start:future.effective_at,until:null,effectiveTo:null,sourceVersionId:future.source_version_id,supersededBy:null,windows:[],series:[{id:"series",googleEventId:"managed",etag:"old",state:"confirmed",providerState:"active",part:"legacy",sources:null}]}]};
  latestPublicationResult={data:[future,latestPublication],error:null};
  assert.equal((await (await route.GET({})).json()).restartAvailable,false);
  future.team_workweek_google_series[0].confirmed_etag="new";
  const result=await (await route.GET({})).json();
  assert.equal(result.restartAvailable,true);
  assert.doesNotMatch(JSON.stringify(result),/managed|googleEventId|confirmed_etag/);
});

test("the private editor receives the latest published windows as its edit base", async () => {
  const response = await route.GET({});
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

  const response = await route.GET({});
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.editBase, null);
  assert.equal(body.latestPublished, null);
  assert.equal(body.minimumEffectiveFrom, "2026-09-07");
});

test("a publication lookup failure remains a load error", async () => {
  latestPublicationResult = { data: null, error: { message: "database unavailable" } };

  const response = await route.GET({});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Veröffentlichungsstatus konnte nicht geladen werden." });
});

test("the editor corrects current windows and separately discloses the retained successor", async () => {
  const future = { ...latestPublication, id: "future", effective_from: "2099-09-07", publication_revision: 5,
    windows: [{ weekday: 1, startMinute: 600, endMinute: 960 }] };
  latestPublicationResult = { data: [future, { ...latestPublication, effective_to: "2099-09-06" }], error: null };
  const response = await route.GET({});
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
    const body = await (await route.GET({})).json();
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
