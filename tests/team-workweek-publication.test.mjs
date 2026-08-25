import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publicationCore = await import("../src/features/team-workweek/server/team-workweek-publication-core.ts");

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
