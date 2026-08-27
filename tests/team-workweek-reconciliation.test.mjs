import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const reconciliation = await import("../src/features/team-workweek/server/team-workweek-reconciliation-core.ts");
const workweekModel = await import("../src/features/team-workweek/model/team-workweek-draft.ts");

class MockTeamWorkweekPublicationError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

const reconciliationServer = await loadTranspiledModule(
  "src/features/team-workweek/server/team-workweek-reconciliation.ts",
  {
    "server-only": {},
    "../model/team-workweek-draft": workweekModel,
    "./google-workspace-oauth-core": { GoogleWorkspaceOAuthContractError: class extends Error {} },
    "./google-workspace-oauth": { getGoogleWorkspaceAccessToken: async () => "token" },
    "./team-workweek-reconciliation-core": reconciliation,
    "./team-workweek-publication": {
      publishTeamWorkweek: async () => { throw new Error("unused"); },
      TeamWorkweekPublicationError: MockTeamWorkweekPublicationError,
    },
  },
);

const now = () => new Date("2026-08-25T09:00:00.000Z");
const noWait = async () => {};

function known(overrides = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    calendarId: "primary",
    googleEventId: "fops22222222222242228222222222222222",
    confirmedEtag: '"etag-1"',
    confirmedFounderopsRevision: 1,
    weekday: 1,
    startMinute: 540,
    endMinute: 1020,
    ...overrides,
  };
}

function event(series = known(), overrides = {}) {
  return {
    id: series.googleEventId,
    etag: '"etag-2"',
    status: "confirmed",
    start: { dateTime: "2026-08-31T10:00:00+02:00", timeZone: "Europe/Berlin" },
    end: { dateTime: "2026-08-31T18:00:00+02:00", timeZone: "Europe/Berlin" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
    extendedProperties: {
      private: {
        founderopsWorkweekSeriesId: series.id,
        founderopsWorkweekRevision: String(series.confirmedFounderopsRevision),
      },
    },
    ...overrides,
  };
}

test("known recurring masters are read by exact id with a minimal field projection", async () => {
  const calls = [];
  const series = known();
  const result = await reconciliation.observeGoogleWorkweek({
    accessToken: "secret-token",
    series: [series],
    now,
    wait: noWait,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json(event(series));
    },
  });

  assert.equal(result.state, "changed");
  assert.deepEqual(result.windows, [{ weekday: 1, startMinute: 600, endMinute: 1080 }]);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, `/calendar/v3/calendars/primary/events/${series.googleEventId}`);
  assert.match(url.searchParams.get("fields"), /extendedProperties\/private/);
  assert.doesNotMatch(url.searchParams.get("fields"), /summary|description|location|attendees|attachments/);
  assert.equal(calls[0].init.headers.authorization, "Bearer secret-token");
});

test("ordinary events and instance exceptions never enter the known-series read set", async () => {
  const series = known();
  const calls = [];
  const result = await reconciliation.observeGoogleWorkweek({
    accessToken: "token",
    series: [series],
    now,
    wait: noWait,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return Response.json(event(series, {
        etag: series.confirmedEtag,
        start: { dateTime: "2026-08-31T09:00:00+02:00", timeZone: "Europe/Berlin" },
        end: { dateTime: "2026-08-31T17:00:00+02:00", timeZone: "Europe/Berlin" },
      }));
    },
  });

  assert.equal(result.state, "unchanged");
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0], /singleEvents|instances|syncToken|timeMin|privateExtendedProperty/);
});

test("a deleted recurring master removes only its known workweek window", async () => {
  const monday = known();
  const wednesday = known({
    id: "33333333-3333-4333-8333-333333333333",
    googleEventId: "fops33333333333343338333333333333333",
    weekday: 3,
    startMinute: 600,
    endMinute: 900,
  });
  const result = await reconciliation.observeGoogleWorkweek({
    accessToken: "token",
    series: [monday, wednesday],
    now,
    wait: noWait,
    fetchImpl: async (url) => String(url).includes(monday.googleEventId)
      ? new Response(null, { status: 410 })
      : Response.json(event(wednesday, {
        etag: wednesday.confirmedEtag,
        start: { dateTime: "2026-09-02T10:00:00+02:00", timeZone: "Europe/Berlin" },
        end: { dateTime: "2026-09-02T15:00:00+02:00", timeZone: "Europe/Berlin" },
      })),
  });

  assert.equal(result.state, "changed");
  assert.deepEqual(result.windows, [{ weekday: 3, startMinute: 600, endMinute: 900 }]);
  assert.equal(result.observations[0].providerState, "deleted");
});

test("non-schedule event edits advance the known ETag without creating a new week", async () => {
  const series = known();
  const result = await reconciliation.observeGoogleWorkweek({
    accessToken: "token",
    series: [series],
    now,
    wait: noWait,
    fetchImpl: async () => Response.json(event(series, {
      summary: "Private title that must never be stored",
      description: "Private body that must never be stored",
      start: { dateTime: "2026-08-31T09:00:00+02:00", timeZone: "Europe/Berlin" },
      end: { dateTime: "2026-08-31T17:00:00+02:00", timeZone: "Europe/Berlin" },
    })),
  });

  assert.equal(result.state, "unchanged");
  assert.equal(result.observations[0].observedEtag, '"etag-2"');
  assert.equal(JSON.stringify(result).includes("Private"), false);
});

test("ambiguous series shape and overlapping windows preserve the confirmed state", async () => {
  const first = known();
  const second = known({
    id: "33333333-3333-4333-8333-333333333333",
    googleEventId: "fops33333333333343338333333333333333",
    startMinute: 1080,
    endMinute: 1200,
  });
  const ambiguous = await reconciliation.observeGoogleWorkweek({
    accessToken: "token",
    series: [first],
    now,
    wait: noWait,
    fetchImpl: async () => Response.json(event(first, { recurringEventId: "parent", originalStartTime: {} })),
  });
  assert.deepEqual(ambiguous, {
    state: "conflict",
    errorClass: "invalid_series",
    observedAt: "2026-08-25T09:00:00.000Z",
  });

  const overlap = await reconciliation.observeGoogleWorkweek({
    accessToken: "token",
    series: [first, second],
    now,
    wait: noWait,
    fetchImpl: async (url) => Response.json(event(String(url).includes(first.googleEventId) ? first : second, {
      start: { dateTime: "2026-08-31T10:00:00+02:00", timeZone: "Europe/Berlin" },
      end: { dateTime: "2026-08-31T12:00:00+02:00", timeZone: "Europe/Berlin" },
    })),
  });
  assert.equal(overlap.state, "conflict");
  assert.equal(overlap.errorClass, "invalid_windows");
});

test("weekly recurrence accepts only a single BYDAY matching the master start", async () => {
  const series = known();
  for (const recurrence of ["RRULE:FREQ=WEEKLY;BYDAY=MO", "RRULE:FREQ=WEEKLY;INTERVAL=1;WKST=MO;BYDAY=MO"]) {
    const result = await reconciliation.observeGoogleWorkweek({
      accessToken: "token",
      series: [series],
      now,
      wait: noWait,
      fetchImpl: async () => Response.json(event(series, { recurrence: [recurrence] })),
    });
    assert.equal(result.state, "changed");
  }

  for (const recurrence of ["RRULE:FREQ=WEEKLY;BYDAY=TU", "RRULE:FREQ=WEEKLY;BYDAY=MO,TU", "RRULE:FREQ=WEEKLY;BYDAY=1MO"]) {
    const result = await reconciliation.observeGoogleWorkweek({
      accessToken: "token",
      series: [series],
      now,
      wait: noWait,
      fetchImpl: async () => Response.json(event(series, { recurrence: [recurrence] })),
    });
    assert.equal(result.state, "conflict");
    assert.equal(result.errorClass, "invalid_series");
  }
});

test("auth, quota, and transport failures use bounded idempotent reads and later recover", async () => {
  const series = known();
  let quotaCalls = 0;
  const quota = await reconciliation.observeGoogleWorkweek({
    accessToken: "token",
    series: [series],
    now,
    wait: noWait,
    fetchImpl: async () => {
      quotaCalls += 1;
      return new Response(null, { status: 429 });
    },
  });
  assert.equal(quota.state, "delayed");
  assert.equal(quota.errorClass, "quota_exceeded");
  assert.equal(quotaCalls, 3);

  let authCalls = 0;
  const auth = await reconciliation.observeGoogleWorkweek({
    accessToken: "token",
    series: [series],
    now,
    wait: noWait,
    fetchImpl: async () => {
      authCalls += 1;
      return new Response(null, { status: 401 });
    },
  });
  assert.equal(auth.errorClass, "oauth_reconnect_required");
  assert.equal(authCalls, 1);

  let transportCalls = 0;
  const recovered = await reconciliation.observeGoogleWorkweek({
    accessToken: "token",
    series: [series],
    now,
    wait: noWait,
    fetchImpl: async () => {
      transportCalls += 1;
      if (transportCalls < 3) throw new Error("lost response");
      return Response.json(event(series));
    },
  });
  assert.equal(recovered.state, "changed");
  assert.equal(transportCalls, 3);
});

function singleResult(result) {
  return {
    select() { return this; },
    eq() { return this; },
    is() { return this; },
    order() { return this; },
    limit() { return this; },
    maybeSingle: async () => result,
  };
}

function pendingReconciliationService({ recordError = null } = {}) {
  const pending = {
    id: "55555555-5555-4555-8555-555555555555",
    source_version_id: "66666666-6666-4666-8666-666666666666",
    owner_profile_id: "profile-1",
    effective_from: "2026-08-31",
    publication_revision: 2,
    last_sync_at: null,
    status: "preparing",
    predecessor_publication_id: "77777777-7777-4777-8777-777777777777",
  };
  const rpcCalls = [];
  let publicationRead = 0;
  return {
    rpcCalls,
    client: {
      from(table) {
        if (table === "team_workweek_versions") {
          return singleResult({
            data: {
              id: pending.source_version_id,
              origin: "google_reconciliation",
              google_reconciliation_source_publication_id: pending.predecessor_publication_id,
            },
            error: null,
          });
        }
        if (table === "team_workweek_publications") {
          publicationRead += 1;
          return singleResult(publicationRead === 1
            ? { data: pending, error: null }
            : {
                data: {
                  id: pending.predecessor_publication_id,
                  publication_revision: 1,
                  last_sync_at: "2026-08-24T08:00:00.000Z",
                },
                error: null,
              });
        }
        throw new Error(`unexpected table ${table}`);
      },
      async rpc(name, args) {
        rpcCalls.push({ name, args });
        return { data: null, error: recordError };
      },
    },
  };
}

test("pending publication errors preserve conflict, retry, and forbidden semantics", async () => {
  for (const scenario of [
    { code: "unavailable", state: "delayed", recovery: "retry", errorClass: "storage_failed" },
    { code: "conflict", state: "conflict", recovery: "resolve_conflict", errorClass: "founderops_changed" },
  ]) {
    const service = pendingReconciliationService();
    const result = await reconciliationServer.reconcileTeamWorkweek({
      ownerProfileId: "profile-1",
      serviceSupabase: service.client,
      userSupabase: {},
      now,
      publish: async () => { throw new MockTeamWorkweekPublicationError(scenario.code); },
    });
    assert.equal(result.state, scenario.state);
    assert.equal(result.recovery, scenario.recovery);
    assert.equal(result.lastSuccessfulSyncAt, "2026-08-24T08:00:00.000Z");
    assert.equal(service.rpcCalls.length, 1);
    assert.equal(service.rpcCalls[0].name, "record_google_team_workweek_reconciliation_state");
    assert.equal(service.rpcCalls[0].args.p_error_class, scenario.errorClass);
  }

  const forbiddenService = pendingReconciliationService();
  await assert.rejects(
    reconciliationServer.reconcileTeamWorkweek({
      ownerProfileId: "profile-1",
      serviceSupabase: forbiddenService.client,
      userSupabase: {},
      now,
      publish: async () => { throw new MockTeamWorkweekPublicationError("forbidden"); },
    }),
    (error) => error instanceof reconciliationServer.TeamWorkweekReconciliationError && error.code === "forbidden",
  );
  assert.equal(forbiddenService.rpcCalls.length, 0);
});

test("a failed status write is not reclassified or retried", async () => {
  const service = pendingReconciliationService({ recordError: { code: "XX000" } });
  await assert.rejects(
    reconciliationServer.reconcileTeamWorkweek({
      ownerProfileId: "profile-1",
      serviceSupabase: service.client,
      userSupabase: {},
      now,
      publish: async () => { throw new MockTeamWorkweekPublicationError("unavailable"); },
    }),
    (error) => error instanceof reconciliationServer.TeamWorkweekReconciliationError && error.code === "unavailable",
  );
  assert.equal(service.rpcCalls.length, 1);
  assert.equal(service.rpcCalls[0].args.p_error_class, "storage_failed");
});

test("a resumed publication confirms reconciliation on the new published version", async () => {
  const service = pendingReconciliationService();
  const result = await reconciliationServer.reconcileTeamWorkweek({
    ownerProfileId: "profile-1",
    serviceSupabase: service.client,
    userSupabase: {},
    now,
    publish: async () => ({
      id: "55555555-5555-4555-8555-555555555555",
      status: "published",
      syncState: "confirmed",
      publishedAt: "2026-08-25T09:00:00.000Z",
      lastSyncAt: "2026-08-25T09:00:00.000Z",
      publicationRevision: 2,
      recovery: null,
    }),
  });
  assert.equal(result.state, "updated");
  assert.equal(service.rpcCalls.length, 1);
  assert.deepEqual(service.rpcCalls[0].args, {
    p_publication_id: "55555555-5555-4555-8555-555555555555",
    p_publication_revision: 2,
    p_state: "confirmed",
    p_error_class: null,
    p_observed_at: "2026-08-25T09:00:00.000Z",
  });
});



test("reconciliation API binds the owner to the mapped session and accepts no target input", async () => {
  const route = await readFile("src/app/api/team-workweek/reconcile/route.ts", "utf8");
  assert.match(route, /requireApiContext\(request, requireTeamMember\)/);
  assert.match(route, /context\.permission\.profile\?\.id/);
  assert.match(route, /Object\.keys\(payload\)\.length/);
  assert.match(route, /Google-Abgleich akzeptiert keine frei gewählten Ziele/);
  assert.doesNotMatch(route, /input\.(?:profileId|ownerProfileId|calendarId|googleEventId)/);

  const privateDraftRoute = await readFile("src/app/api/team-workweek/private-draft/route.ts", "utf8");
  assert.match(privateDraftRoute, /\.eq\("origin", "owner"\)/);
  assert.match(privateDraftRoute, /team_workweek_google_reconciliation_status\(state,last_observed_at\)/);
});
