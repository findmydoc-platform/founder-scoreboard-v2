import assert from "node:assert/strict";

import { test } from "vitest";

const publicationCore = await import("../../../src/features/team-workweek/server/team-workweek-publication-core.ts");

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
    accessToken: { request: (url, init) => fetch(url, init) },
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
    accessToken: { request: (url, init) => fetch(url, init) },
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
    accessToken: { request: (url, init) => fetch(url, init) },
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
    accessToken: { request: (url, init) => fetch(url, init) },
    publication: { ...publication, series: [series] },
    series,
    fetchImpl: async () => foreignResponses.shift(),
  });
  assert.deepEqual(foreign, { state: "delayed", errorClass: "provider_identity_mismatch" });

  const staleRevision = await publicationCore.ensureGoogleWorkweekSeries({
    accessToken: { request: (url, init) => fetch(url, init) },
    publication: { ...publication, series: [series] },
    series,
    fetchImpl: async () => Response.json(event('"stale"', series.id, "0"), { status: 200 }),
  });
  assert.deepEqual(staleRevision, { state: "delayed", errorClass: "provider_identity_mismatch" });

  const missingRevision = await publicationCore.ensureGoogleWorkweekSeries({
    accessToken: { request: (url, init) => fetch(url, init) },
    publication: { ...publication, series: [series] },
    series,
    fetchImpl: async () => Response.json(event('"missing"', series.id, null), { status: 200 }),
  });
  assert.deepEqual(missingRevision, { state: "delayed", errorClass: "provider_identity_mismatch" });
});

test("lost success is observed before another write and provider failure stays delayed", async () => {
  let lostSuccessCalls = 0;
  const recovered = await publicationCore.ensureGoogleWorkweekSeries({
    accessToken: { request: (url, init) => fetch(url, init) },
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
    accessToken: { request: (url, init) => fetch(url, init) },
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

test("immediate projections confirm exact bounds and compensate only their own immutable effect", async () => {
  const effect = { id: series.id, generation: 1, calendarId: "primary", googleEventId: series.googleEventId, state: "pending", confirmedEtag: null, payload: {
    ...publicationCore.googleWorkweekSeriesEvent(publication, series),
    start: {dateTime:"2026-10-14T12:03:00Z",timeZone:"Europe/Berlin"},
    end: {dateTime:"2026-10-14T15:00:00Z",timeZone:"Europe/Berlin"},
    recurrence: undefined,
    extendedProperties:{private:{founderopsWorkweekEffectId:series.id,founderopsWorkweekGeneration:"1",founderopsWorkweekRevision:"1"}},
  }};
  const core = await import("../../../src/features/team-workweek/server/team-workweek-immediate-effects.ts");
  const existing = {...effect.payload,etag:'"same"'};
  const confirmation = await core.ensureGoogleWorkweekEffect({accessToken: { request: (url, init) => fetch(url, init) },effect,fetchImpl:async()=>Response.json(existing)});
  assert.equal(confirmation.state,"confirmed");
  const moved = await core.ensureGoogleWorkweekEffect({accessToken: { request: (url, init) => fetch(url, init) },effect,fetchImpl:async()=>Response.json({...existing,start:{...existing.start,dateTime:"2026-10-14T11:00:00Z"}})});
  assert.deepEqual(moved,{state:"delayed",errorClass:"provider_identity_mismatch"});
  const calls=[];
  const cleanup=await core.cleanupGoogleWorkweekEffect({accessToken: { request: (url, init) => fetch(url, init) },effect,fetchImpl:async(_url,init={})=>{
    calls.push(init);return init.method==="DELETE"?new Response(null,{status:204}):Response.json(existing);
  }});
  assert.equal(cleanup.state,"confirmed");assert.equal(calls[1].headers["if-match"],'"same"');
  const protectedForeign=await core.cleanupGoogleWorkweekEffect({accessToken: { request: (url, init) => fetch(url, init) },effect,fetchImpl:async()=>Response.json({...existing,extendedProperties:{private:{}}})});
  assert.equal(protectedForeign.errorClass,"provider_identity_mismatch");
});

test("a lost immediate insert response observes the same exact payload and never duplicates its event", async () => {
  const core=await import("../../../src/features/team-workweek/server/team-workweek-immediate-effects.ts");
  const payload={id:"fopsabc0123",start:{dateTime:"2026-03-27T08:00:00Z",timeZone:"Europe/Berlin"},end:{dateTime:"2026-03-27T16:00:00Z",timeZone:"Europe/Berlin"},recurrence:["RRULE:FREQ=WEEKLY"],extendedProperties:{private:{founderopsWorkweekEffectId:"durable",founderopsWorkweekGeneration:"2",founderopsWorkweekRevision:"1"}}};
  const effect={id:"durable",calendarId:"primary",googleEventId:payload.id,generation:2,state:"pending",confirmedEtag:null,payload};
  let stored=null,inserts=0;
  const fetchImpl=async(_url,init={})=>{if(init.method==="POST"){inserts++;stored={...JSON.parse(init.body),etag:'"committed"'};throw new Error("lost after commit");}return stored?Response.json(stored):new Response(null,{status:404});};
  const first=await core.ensureGoogleWorkweekEffect({accessToken: { request: (url, init) => fetch(url, init) },effect,fetchImpl});
  assert.equal(first.state,"confirmed");assert.equal(first.etag,'"committed"');
  const repeated=await core.ensureGoogleWorkweekEffect({accessToken: { request: (url, init) => fetch(url, init) },effect,fetchImpl});
  assert.equal(repeated.state,"confirmed");assert.equal(inserts,1);assert.deepEqual(stored.recurrence,["RRULE:FREQ=WEEKLY"]);
});

test("predecessor cutoffs retain master times, use If-Match, and restore an expired provisional update",async()=>{
  const core=await import("../../../src/features/team-workweek/server/team-workweek-immediate-effects.ts");
  const before={id:"fopsabc0123",start:{dateTime:"2026-10-07T07:00:00Z",timeZone:"Europe/Berlin"},end:{dateTime:"2026-10-07T15:00:00Z",timeZone:"Europe/Berlin"},recurrence:["RRULE:FREQ=WEEKLY"],extendedProperties:{private:{founderopsWorkweekSeriesId:"old",founderopsWorkweekRevision:"1"}}};
  const payload={...before,recurrence:["RRULE:FREQ=WEEKLY;COUNT=2"],status:"confirmed",extendedProperties:{private:{...before.extendedProperties.private,founderopsWorkweekTransitionId:"cutoff"}}};
  const effect={id:"cutoff",calendarId:"primary",googleEventId:before.id,generation:1,operation:"update",kind:"predecessor_cutoff",expectedPayload:before,expectedEtag:'"old"',payload,state:"pending",confirmedEtag:null};
  let stored={...before,etag:'"old"'};const calls=[];
  const fetchImpl=async(_url,init={})=>{calls.push(init);if(init.method){stored={...JSON.parse(init.body),etag:'"updated"'};}return Response.json(stored);};
  const changed=await core.ensureGoogleWorkweekEffect({accessToken: { request: (url, init) => fetch(url, init) },effect,fetchImpl});
  assert.equal(changed.state,"confirmed");assert.equal(calls[1].method,"PUT");assert.equal(calls[1].headers["if-match"],'"old"');assert.deepEqual(stored.start,before.start);
  const restored=await core.cleanupGoogleWorkweekEffect({accessToken: { request: (url, init) => fetch(url, init) },effect,fetchImpl});
  assert.equal(restored.state,"confirmed");assert.deepEqual(stored.recurrence,["RRULE:FREQ=WEEKLY"]);assert.equal(stored.extendedProperties.private.founderopsWorkweekTransitionId,undefined);
});

test("the actual crossing instance is discovered before any write and a zero-occurrence cancellation is reversible",async()=>{
  const core=await import("../../../src/features/team-workweek/server/team-workweek-immediate-effects.ts");
  const before={id:"fopsmaster",start:{dateTime:"2026-10-25T00:00:00Z",timeZone:"Europe/Berlin"},end:{dateTime:"2026-10-25T02:00:00Z",timeZone:"Europe/Berlin"},extendedProperties:{private:{founderopsWorkweekSeriesId:"old",founderopsWorkweekRevision:"1"}}};
  const crossing={id:"crossing",calendarId:"primary",googleEventId:"fopsmaster",generation:2,operation:"update",instanceOf:"fopsmaster",originalStart:"2026-10-25T00:00:00Z",expectedPayload:before,expectedEtag:null,payload:{...before,end:{...before.end,dateTime:"2026-10-25T01:30:00Z"}},state:"pending",confirmedEtag:null};
  const observed=await core.discoverGoogleWorkweekInstance({accessToken: { request: (url, init) => fetch(url, init) },effect:crossing,fetchImpl:async(_url,init)=>{assert.equal(init.method,undefined);return Response.json({items:[{...before,id:"fopsmaster_20261025T000000Z",etag:'"instance"',recurringEventId:"fopsmaster",originalStartTime:{dateTime:before.start.dateTime}}]});}});
  assert.equal(observed.state,"observed");assert.equal(observed.eventId,"fopsmaster_20261025T000000Z");assert.equal(observed.originalPayload.start.dateTime,"2026-10-25T00:00:00Z");
  const original={...before,recurrence:["RRULE:FREQ=WEEKLY"]};
  const cancelled={...original,status:"cancelled",extendedProperties:{private:{...original.extendedProperties.private,founderopsWorkweekTransitionId:"zero"}}};
  const effect={...crossing,id:"zero",instanceOf:null,expectedPayload:original,expectedEtag:'"old"',payload:cancelled,operation:"cancel"};
  let stored={...original,etag:'"old"'};
  const fetchImpl=async(_url,init={})=>{if(init.method==="PUT")stored={...JSON.parse(init.body),etag:'"changed"'};return Response.json(stored);};
  assert.equal((await core.ensureGoogleWorkweekEffect({accessToken: { request: (url, init) => fetch(url, init) },effect,fetchImpl})).state,"confirmed");
  assert.equal(stored.status,"cancelled");
  assert.equal((await core.cleanupGoogleWorkweekEffect({accessToken: { request: (url, init) => fetch(url, init) },effect,fetchImpl})).state,"confirmed");
  assert.equal(stored.status,"confirmed");assert.equal(stored.start.dateTime,original.start.dateTime);
});
