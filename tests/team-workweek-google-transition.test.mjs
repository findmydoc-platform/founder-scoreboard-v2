import assert from "node:assert/strict";

import test from "node:test";

const publicationCore = await import("../src/features/team-workweek/server/team-workweek-publication-core.ts");

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
