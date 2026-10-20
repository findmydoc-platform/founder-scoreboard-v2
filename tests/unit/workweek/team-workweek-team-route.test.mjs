import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
import { importTestModule } from "../../helpers/vitest-module.mjs";

const draftModel = await import("../../../src/features/team-workweek/model/team-workweek-draft.ts");
const calendarModel = await importTestModule(
  "src/features/team-workweek/model/team-workweek-calendar.ts",
  { "./team-workweek-draft": draftModel },
);
const publishedModel = await import("../../../src/features/team-workweek/model/published-team-workweek.ts");

let protocol;
let berlinTodayCalls;
let rows;
let queryStatuses;
const route = await importTestModule(
  "src/app/api/team-workweek/team/route.ts",
  {
    "next/server": { NextResponse: { json: (value, init) => Response.json(value, init) } },
    "@/features/team-workweek/model/team-workweek-calendar": calendarModel,
    "@/features/team-workweek/model/team-workweek-draft": {
      ...draftModel,
      berlinTodayIso: () => {
        berlinTodayCalls += 1;
        return "2026-08-25";
      },
    },
    "@/features/team-workweek/model/published-team-workweek": publishedModel,
    "server-only": {},
  },
);

function request(search = "") { return protocol.request(`/api/team-workweek/team?${search}`); }
test.beforeEach(() => {
  protocol = administratorProtocol();
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const operation = new Request(input, init), url = new URL(operation.url);
    if (url.pathname === "/rest/v1/profiles") {
      queryStatuses.push(url.searchParams.get("calendar.status")?.replace(/^eq\./, ""));
      const earliestDate = url.searchParams.get("calendar.or")?.match(/effective_to\.gte\.(\d{4}-\d{2}-\d{2})/)?.[1] ?? "0000-01-01";
      const relevant = rows.filter(row => row.effective_to == null || row.effective_to >= earliestDate)
        .sort((left, right) => right.effective_from.localeCompare(left.effective_from)
          || right.publication_revision - left.publication_revision || right.id.localeCompare(left.id));
      if (!rows.length) return Response.json([], { headers: { "content-range": "*/0" } });
      return Response.json([{ id: "profile-1", published: [{}], calendar: relevant,
        tail: relevant.length ? [{ id: relevant.at(-1).id, effective_from: relevant.at(-1).effective_from,
          publication_revision: relevant.at(-1).publication_revision }] : [] }], { headers: { "content-range": "0-0/1" } });
    }
    return authFetch(operation);
  });
  berlinTodayCalls = 0; queryStatuses = []; rows = [];
});

test("team calendar rejects unauthenticated requests before reading publications", async () => {
  protocol.state.authError = 401;
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
      id: "future",
      owner_profile_id: "profile-1",
      effective_from: "2026-08-31",
      effective_to: null,
      timezone: "Europe/Berlin",
      published_at: "2026-08-25T08:00:00.000Z",
      last_sync_at: "2026-08-25T08:00:00.000Z",
      publication_revision: 3,
      windows: [{ weekday: 1, startMinute: 600, endMinute: 1080 }],
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
  assert.ok(queryStatuses.length > 0 && queryStatuses.every(status => status === "published"));
  assert.equal(body.referenceDate, "2026-08-25");
  assert.equal(berlinTodayCalls, 1);
  assert.ok(Array.isArray(body.workweeks));
  assert.deepEqual(body.currentWorkweeks.map((entry) => entry.id), ["inside"]);
  assert.deepEqual(body.calendarWorkweeks.map((entry) => entry.id), ["future", "inside"]);
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

test("the no-range response includes the current workweek and omits calendarWorkweeks", async () => {
  rows = [{
    id: "current",
    owner_profile_id: "profile-1",
    effective_from: "2026-08-24",
    effective_to: "2026-08-30",
    timezone: "Europe/Berlin",
    published_at: "2026-08-24T08:00:00.000Z",
    last_sync_at: "2026-08-24T08:00:00.000Z",
    publication_revision: 2,
    windows: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
  }];

  const response = await route.GET(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.workweeks));
  assert.deepEqual(body.currentWorkweeks.map((entry) => entry.id), ["current"]);
  assert.equal(body.referenceDate, "2026-08-25");
  assert.equal(berlinTodayCalls, 1);
  assert.equal(Object.hasOwn(body, "calendarWorkweeks"), false);
});
