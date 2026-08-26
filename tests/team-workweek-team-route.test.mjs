import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const draftModel = await import("../src/features/team-workweek/model/team-workweek-draft.ts");
const calendarModel = await loadTranspiledModule(
  "src/features/team-workweek/model/team-workweek-calendar.ts",
  { "./team-workweek-draft": draftModel },
);
const publishedModel = await import("../src/features/team-workweek/model/published-team-workweek.ts");

let authResult;
let rolloutResult;
let rows;
let queryStatuses;

function apiError(message, status) {
  return Response.json({ error: message }, { status });
}

function supabaseQuery() {
  return {
    select() { return this; },
    eq(column, value) {
      if (column === "status") queryStatuses.push(value);
      return this;
    },
    order() { return this; },
    returns() { return Promise.resolve({ data: rows, error: null }); },
  };
}

const route = await loadTranspiledModule(
  "src/app/api/team-workweek/team/route.ts",
  {
    "next/server": { NextResponse: { json: (value) => Response.json(value) } },
    "@/features/team-workweek/model/team-workweek-calendar": calendarModel,
    "@/features/team-workweek/model/team-workweek-draft": draftModel,
    "@/features/team-workweek/model/published-team-workweek": publishedModel,
    "@/features/team-workweek/server/team-workweek-rollout-api": {
      requireTeamWorkweekStarterApiAccess: async () => rolloutResult,
    },
    "@/lib/api-response": {
      apiError,
      requireApiContext: async () => authResult,
    },
    "@/lib/authz": {
      bearerToken: () => "session-token",
      requireTeamMember: Symbol("requireTeamMember"),
    },
    "@/lib/supabase": {
      getSupabaseForToken: () => ({ from: () => supabaseQuery() }),
    },
  },
);

function request(search = "") {
  return { nextUrl: { searchParams: new URLSearchParams(search) } };
}

test.beforeEach(() => {
  authResult = {
    ok: true,
    permission: { profile: { id: "profile-1", platformRole: "founder" } },
  };
  rolloutResult = { ok: true, serviceSupabase: {} };
  queryStatuses = [];
  rows = [];
});

test("team calendar rejects unauthenticated requests before reading publications", async () => {
  authResult = { ok: false, response: apiError("Anmeldung erforderlich.", 401) };
  const response = await route.GET(request("from=2026-08-24&to=2026-10-04"));
  assert.equal(response.status, 401);
  assert.deepEqual(queryStatuses, []);
});

test("team calendar validates paired ISO ranges and the 42-day maximum", async () => {
  for (const [search, expectedMessage] of [
    ["from=2026-08-24", "gemeinsam"],
    ["from=2026-02-30&to=2026-03-01", "YYYY-MM-DD"],
    ["from=2026-08-24&to=2026-10-05", "höchstens 42 Tage"],
  ]) {
    const response = await route.GET(request(search));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, new RegExp(expectedMessage));
  }
  assert.deepEqual(queryStatuses, []);
});

test("range responses stay additive, published-only, overlap-filtered, and provider-free", async () => {
  rows = [
    {
      id: "inside",
      owner_profile_id: "profile-1",
      effective_from: "2026-08-24",
      effective_to: "2026-08-30",
      timezone: "Europe/Berlin",
      published_at: "2026-08-24T08:00:00.000Z",
      last_sync_at: "2026-08-24T08:00:00.000Z",
      publication_revision: 2,
      windows: [{ weekday: 1, startMinute: 540, endMinute: 720 }],
      google_event_id: "must-not-leak",
      refresh_token: "must-not-leak",
    },
    {
      id: "outside",
      owner_profile_id: "profile-1",
      effective_from: "2026-07-01",
      effective_to: "2026-07-31",
      timezone: "Europe/Berlin",
      published_at: "2026-07-01T08:00:00.000Z",
      last_sync_at: "2026-07-01T08:00:00.000Z",
      publication_revision: 1,
      windows: [],
    },
  ];

  const response = await route.GET(request("from=2026-08-24&to=2026-10-04"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(queryStatuses, ["published"]);
  assert.ok(Array.isArray(body.workweeks));
  assert.deepEqual(body.calendarWorkweeks.map((entry) => entry.id), ["inside"]);
  assert.deepEqual(Object.keys(body.calendarWorkweeks[0]).sort(), [
    "effectiveFrom",
    "effectiveTo",
    "id",
    "lastSyncAt",
    "ownerProfileId",
    "publicationRevision",
    "timezone",
    "windows",
  ]);
  assert.doesNotMatch(JSON.stringify(body), /google_event_id|refresh_token|access_token|etag|calendar_id/);
});

test("the legacy response omits calendarWorkweeks when no range is requested", async () => {
  const response = await route.GET(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.workweeks));
  assert.equal(Object.hasOwn(body, "calendarWorkweeks"), false);
});
