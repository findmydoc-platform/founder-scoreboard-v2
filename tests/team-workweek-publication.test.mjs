import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const publicationCore = await import("../src/features/team-workweek/server/team-workweek-publication-core.ts");
const publishedModel = await import("../src/features/team-workweek/model/published-team-workweek.ts");

class MockGoogleWorkspaceOAuthContractError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const publicationServer = await loadTranspiledModule(
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

function event(etag = '"etag-1"', marker = series.id, revision = "1") {
  return {
    id: series.googleEventId,
    etag,
    extendedProperties: {
      private: {
        [publicationCore.FOUNDEROPS_WORKWEEK_PROPERTY_KEY]: marker,
        founderopsWorkweekRevision: revision,
      },
    },
  };
}

function transitionEvent({ etag = '"etag-1"', completed = false, revision = "1" } = {}) {
  return {
    ...event(etag, series.id, revision),
    summary: "Arbeitszeit",
    description: "Mit FounderOps synchronisiert",
    start: { dateTime: "2026-08-31T09:00:00", timeZone: "Europe/Berlin" },
    end: { dateTime: "2026-08-31T17:00:00", timeZone: "Europe/Berlin" },
    recurrence: [completed ? "RRULE:FREQ=WEEKLY;COUNT=2" : "RRULE:FREQ=WEEKLY"],
    transparency: "transparent",
    visibility: "private",
    reminders: { useDefault: false },
    extendedProperties: {
      private: {
        founderopsWorkweekSeriesId: series.id,
        founderopsWorkweekRevision: revision,
        ...(completed ? { founderopsWorkweekTransitionId: transition.id } : {}),
      },
    },
  };
}

test("initial publication creates one transparent private reminder-free weekly series", async () => {
  const calls = [];
  const responses = [
    new Response(null, { status: 404 }),
    Response.json(event(), { status: 200 }),
  ];
  const result = await publicationCore.ensureGoogleWorkweekSeries({
    accessToken: "secret-access-token",
    publication: { ...publication, series: [series] },
    series,
    now: () => new Date("2026-08-25T09:00:00.000Z"),
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return responses.shift();
    },
  });

  assert.deepEqual(result, { state: "confirmed", etag: '"etag-1"', observedAt: "2026-08-25T09:00:00.000Z" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, undefined);
  assert.equal(calls[1].init.method, "POST");
  assert.match(calls[1].url, /sendUpdates=none/);
  const payload = JSON.parse(calls[1].init.body);
  assert.deepEqual(payload, {
    id: series.googleEventId,
    summary: "Arbeitszeit",
    description: "Mit FounderOps synchronisiert",
    start: { dateTime: "2026-08-31T09:00:00", timeZone: "Europe/Berlin" },
    end: { dateTime: "2026-08-31T17:00:00", timeZone: "Europe/Berlin" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
    transparency: "transparent",
    visibility: "private",
    reminders: { useDefault: false },
    extendedProperties: {
      private: {
        founderopsWorkweekSeriesId: series.id,
        founderopsWorkweekRevision: "1",
      },
    },
  });
});

test("repeat publication observes the durable identity without another insert", async () => {
  let calls = 0;
  const result = await publicationCore.ensureGoogleWorkweekSeries({
    accessToken: "token",
    publication: { ...publication, series: [series] },
    series,
    fetchImpl: async () => {
      calls += 1;
      return Response.json(event(), { status: 200 });
    },
  });
  assert.equal(result.state, "confirmed");
  assert.equal(calls, 1);
});

test("409 is success only after the expected private FounderOps identity is observed", async () => {
  const responses = [
    new Response(null, { status: 404 }),
    new Response(null, { status: 409 }),
    Response.json(event(), { status: 200 }),
  ];
  const recovered = await publicationCore.ensureGoogleWorkweekSeries({
    accessToken: "token",
    publication: { ...publication, series: [series] },
    series,
    fetchImpl: async () => responses.shift(),
  });
  assert.equal(recovered.state, "confirmed");

  const foreignResponses = [
    new Response(null, { status: 404 }),
    new Response(null, { status: 409 }),
    Response.json(event('"foreign"', "different-founderops-id"), { status: 200 }),
  ];
  const foreign = await publicationCore.ensureGoogleWorkweekSeries({
    accessToken: "token",
    publication: { ...publication, series: [series] },
    series,
    fetchImpl: async () => foreignResponses.shift(),
  });
  assert.deepEqual(foreign, { state: "delayed", errorClass: "provider_identity_mismatch" });

  const staleRevision = await publicationCore.ensureGoogleWorkweekSeries({
    accessToken: "token",
    publication: { ...publication, series: [series] },
    series,
    fetchImpl: async () => Response.json(event('"stale"', series.id, "0"), { status: 200 }),
  });
  assert.deepEqual(staleRevision, { state: "delayed", errorClass: "provider_identity_mismatch" });

  const missingRevision = await publicationCore.ensureGoogleWorkweekSeries({
    accessToken: "token",
    publication: { ...publication, series: [series] },
    series,
    fetchImpl: async () => Response.json(event('"missing"', series.id, null), { status: 200 }),
  });
  assert.deepEqual(missingRevision, { state: "delayed", errorClass: "provider_identity_mismatch" });
});

test("lost success is observed before another write and provider failure stays delayed", async () => {
  let lostSuccessCalls = 0;
  const recovered = await publicationCore.ensureGoogleWorkweekSeries({
    accessToken: "token",
    publication: { ...publication, series: [series] },
    series,
    fetchImpl: async (_url, init = {}) => {
      lostSuccessCalls += 1;
      if (lostSuccessCalls === 1) return new Response(null, { status: 404 });
      if (init.method === "POST") throw new TypeError("network lost after provider commit");
      return Response.json(event(), { status: 200 });
    },
  });
  assert.equal(recovered.state, "confirmed");
  assert.equal(lostSuccessCalls, 3);

  let unavailableCalls = 0;
  const unavailable = await publicationCore.ensureGoogleWorkweekSeries({
    accessToken: "token",
    publication: { ...publication, series: [series] },
    series,
    fetchImpl: async (_url, init = {}) => {
      unavailableCalls += 1;
      return init.method === "POST"
        ? new Response(null, { status: 503 })
        : new Response(null, { status: 404 });
    },
  });
  assert.deepEqual(unavailable, { state: "delayed", errorClass: "provider_unavailable" });
  assert.equal(unavailableCalls, 3);
});

test("delayed provider states preserve the required recovery action", () => {
  assert.equal(publicationCore.googleWorkweekRecovery("provider_unavailable"), "retry");
  assert.equal(publicationCore.googleWorkweekRecovery("oauth_reconnect_required"), "reconnect");
  assert.equal(publicationCore.googleWorkweekRecovery("provider_identity_mismatch"), "identity_conflict");
});

test("a later Monday ends the predecessor series with COUNT and an ETag precondition", async () => {
  const calls = [];
  const responses = [
    Response.json(transitionEvent(), { status: 200 }),
    Response.json(transitionEvent({ etag: '"etag-2"', completed: true }), { status: 200 }),
  ];
  const result = await publicationCore.ensureGoogleWorkweekSeriesTransition({
    accessToken: "token",
    transition,
    now: () => new Date("2026-08-25T10:00:00.000Z"),
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return responses.shift();
    },
  });

  assert.deepEqual(result, { state: "confirmed", etag: '"etag-2"', observedAt: "2026-08-25T10:00:00.000Z" });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.method, "PUT");
  assert.equal(calls[1].init.headers["if-match"], '"etag-1"');
  assert.match(calls[1].url, /sendUpdates=none/);
  const payload = JSON.parse(calls[1].init.body);
  assert.deepEqual(payload.recurrence, ["RRULE:FREQ=WEEKLY;COUNT=2"]);
  assert.equal(payload.extendedProperties.private.founderopsWorkweekTransitionId, transition.id);
});

test("a stale predecessor revision remains a stable conflict without an overwrite", async () => {
  let calls = 0;
  const staleEtag = await publicationCore.ensureGoogleWorkweekSeriesTransition({
    accessToken: "token",
    transition,
    fetchImpl: async () => {
      calls += 1;
      return Response.json(transitionEvent({ etag: '"changed"' }), { status: 200 });
    },
  });
  assert.deepEqual(staleEtag, { state: "delayed", errorClass: "provider_identity_mismatch" });
  assert.equal(calls, 1);

  const staleRevision = await publicationCore.ensureGoogleWorkweekSeriesTransition({
    accessToken: "token",
    transition,
    fetchImpl: async () => Response.json(transitionEvent({ revision: "0" }), { status: 200 }),
  });
  assert.deepEqual(staleRevision, { state: "delayed", errorClass: "provider_identity_mismatch" });
});

test("a lost predecessor update is observed before any further write", async () => {
  let calls = 0;
  const result = await publicationCore.ensureGoogleWorkweekSeriesTransition({
    accessToken: "token",
    transition,
    now: () => new Date("2026-08-25T11:00:00.000Z"),
    fetchImpl: async (_url, init = {}) => {
      calls += 1;
      if (calls === 1) return Response.json(transitionEvent(), { status: 200 });
      if (init.method === "PUT") throw new TypeError("network lost after provider commit");
      return Response.json(transitionEvent({ etag: '"etag-2"', completed: true }), { status: 200 });
    },
  });
  assert.deepEqual(result, { state: "confirmed", etag: '"etag-2"', observedAt: "2026-08-25T11:00:00.000Z" });
  assert.equal(calls, 3);
});

test("conditional predecessor updates classify 412 and recover a committed 503 without another write", async () => {
  for (const scenario of [
    {
      status: 412,
      after: transitionEvent(),
      expected: { state: "delayed", errorClass: "provider_identity_mismatch" },
    },
    {
      status: 503,
      after: transitionEvent({ etag: '"etag-2"', completed: true }),
      expected: { state: "confirmed", etag: '"etag-2"', observedAt: "2026-08-25T12:00:00.000Z" },
    },
  ]) {
    const calls = [];
    const responses = [
      Response.json(transitionEvent(), { status: 200 }),
      new Response(null, { status: scenario.status }),
      Response.json(scenario.after, { status: 200 }),
    ];
    const result = await publicationCore.ensureGoogleWorkweekSeriesTransition({
      accessToken: "token",
      transition,
      now: () => new Date("2026-08-25T12:00:00.000Z"),
      fetchImpl: async (_url, init = {}) => {
        calls.push(init);
        return responses.shift();
      },
    });
    assert.deepEqual(result, scenario.expected);
    assert.equal(calls.filter((call) => call.method === "PUT").length, 1);
  }
});

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

test("Monday versioning keeps history and team visibility behind every provider confirmation", () => {
  const migration = readFileSync("supabase/migrations/20260825094630_version_team_workweeks_from_monday.sql", "utf8");
  const teamRoute = readFileSync("src/app/api/team-workweek/team/route.ts", "utf8");
  const privateHook = readFileSync("src/features/team-workweek/hooks/use-private-team-workweek.ts", "utf8");

  assert.match(migration, /effective_to date/);
  assert.match(migration, /predecessor_publication_id uuid/);
  assert.match(migration, /row_number\(\) over/);
  assert.match(migration, /series\.confirmed_founderops_revision/);
  assert.doesNotMatch(migration, /team_workweek_publications_owner_preparing_unique/);
  assert.match(migration, /superseded_by_publication_id uuid/);
  assert.match(migration, /publication_revision\)\s*;/);
  assert.match(migration, /recurrence_count integer not null/);
  assert.match(migration, /expected_etag text not null/);
  assert.match(migration, /all predecessor Google series transitions must be confirmed before team publication/);
  assert.match(migration, /effective_to = v_publication\.effective_from - 1/);
  assert.match(migration, /published workweek revision is stale/);
  assert.match(migration, /new workweek version must start after the latest published boundary/);
  assert.match(teamRoute, /selectVisibleTeamWorkweeks/);
  assert.match(privateHook, /bisherige Teamversion bleibt sichtbar/);
  assert.match(privateHook, /Letzter erfolgreicher Sync/);
});

test("database contract keeps partial publication private and provider identifiers owner-private", () => {
  const migration = readFileSync("supabase/migrations/20260825090341_publish_team_workweek_atomically.sql", "utf8");
  const teamRoute = readFileSync("src/app/api/team-workweek/team/route.ts", "utf8");
  const publishRoute = readFileSync("src/app/api/team-workweek/publish/route.ts", "utf8");
  const privateHook = readFileSync("src/features/team-workweek/hooks/use-private-team-workweek.ts", "utf8");

  assert.match(migration, /all Google series must be confirmed before team publication/);
  assert.match(migration, /status = 'published'[\s\S]*sync_state = 'confirmed'/);
  assert.match(migration, /team_workweek_google_series_select_owner_private/);
  assert.match(migration, /owner_profile_id = public\.current_profile_id\(\)/);
  assert.match(migration, /unique \(calendar_id, google_event_id\)/);
  assert.match(migration, /on conflict \(source_window_id\) do nothing/);
  assert.match(migration, /create table public\.team_workweek_publications/);
  assert.doesNotMatch(migration, /alter table public\.team_workweek_versions|drop constraint team_workweek_versions_private_status/);
  assert.match(publishRoute, /requireApiContext\(request, requirePlanningContributor\)/);
  assert.match(publishRoute, /publication\.syncState === "delayed" \? 202 : 200/);
  assert.match(teamRoute, /requireApiContext\(request, requireTeamMember\)/);
  assert.doesNotMatch(teamRoute, /google_event_id|calendar_id|confirmed_etag|private_property_key/);
  assert.doesNotMatch(publishRoute, /accessToken|authorization/);
  assert.match(privateHook, /recovery === "reconnect"/);
  assert.match(privateHook, /recovery === "identity_conflict"/);
});
