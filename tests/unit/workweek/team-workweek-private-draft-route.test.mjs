import { vi } from "vitest";
vi.mock("@/lib/supabase-user", async () => vi.importMock("@/lib/supabase"));
import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const draftModel = await import("../../../src/features/team-workweek/model/team-workweek-draft.ts");

function apiError(message, status) {
  return Response.json({ error: message }, { status });
}

function query(data, error = null) {
  return {
    select() { return this; },
    eq() { return this; },
    order() { return this; },
    limit() { return this; },
    maybeSingle() { return Promise.resolve({ data, error }); },
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

const route = await importTestModule(
  "src/app/api/team-workweek/private-draft/route.ts",
  {
    "next/server": { NextResponse: { json: (value, init) => Response.json(value, init) } },
    "@/features/team-workweek/model/team-workweek-draft": {
      ...draftModel,
      nextVersionMondayIso: () => "2026-09-07",
    },
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
          if (table === "team_workweek_versions") return query(null);
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
  latestPublicationResult = { data: latestPublication, error: null };
});

test("the private editor receives the latest published windows as its edit base", async () => {
  const response = await route.GET({});
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.deepEqual(body.editBase, {
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

test("the immediate API stores intent without accepting a client activation time", async () => {
  postPayload={effectiveFrom:draftModel.nextMondayIso(),activationMode:"immediate",windows:draftModel.emptyTeamWorkweekWindows()};
  postCalls=[];
  const created=await route.POST({});assert.equal(created.status,201);
  assert.deepEqual(postCalls,[["create_private_immediate_team_workweek_version",{p_windows:[]}]]);
  postPayload={...postPayload,effectiveAt:"2026-10-14T10:00:00Z"};
  assert.equal((await route.POST({})).status,400);assert.equal(postCalls.length,1);
});
