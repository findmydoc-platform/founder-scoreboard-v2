import { calendarProvider } from "../../helpers/calendar-provider";
import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const publicationCore = await import("../../../src/features/team-workweek/server/team-workweek-publication-core.ts");
const oauthCore = await import("../../../src/lib/credentials/internal/google-calendar-protocol.ts");
const draftModel = await import("../../../src/features/team-workweek/model/team-workweek-draft.ts");
function fakeState() {
  return {
    operation: null,
    targets: [],
    events: [],
  };
}

function builder(state, table) {
  const filters = [];
  let update = null;
  const api = {
    select() { return api; },
    eq(key, value) { filters.push(["eq", key, value]); return api; },
    neq(key, value) { filters.push(["neq", key, value]); return api; },
    order() { return api; },
    limit() { return api; },
    update(value) { update = value; return api; },
    async maybeSingle() {
      if (table !== "google_workspace_disconnect_operations") throw new Error(`unexpected single ${table}`);
      const row = state.operation;
      const visible = row && filters.every(([kind, key, value]) => kind === "eq" ? row[key] === value : row[key] !== value);
      return { data: visible ? row : null, error: null };
    },
    async returns() {
      if (table !== "google_workspace_disconnect_series") throw new Error(`unexpected rows ${table}`);
      const operationId = filters.find(([, key]) => key === "operation_id")?.[2];
      return { data: state.targets.filter((row) => row.operation_id === operationId), error: null };
    },
    then(resolve) {
      if (update) {
        if (table === "google_workspace_disconnect_series") {
          for (const row of state.targets) {
            if (filters.every(([kind, key, value]) => kind === "eq" ? row[key] === value : row[key] !== value)) Object.assign(row, update);
          }
        } else if (table === "google_workspace_disconnect_operations" && state.operation) {
          if (filters.every(([kind, key, value]) => kind === "eq" ? state.operation[key] === value : state.operation[key] !== value)) {
            Object.assign(state.operation, update);
          }
        }
      }
      return Promise.resolve({ data: null, error: null }).then(resolve);
    },
  };
  return api;
}

function operation() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    owner_profile_id: "profile-1",
    requested_by: "owner",
    revoke_connection: true,
    state: "cleaning",
    retained_version_id: null,
    deactivated_at: null,
    completed_at: null,
    last_error_class: null,
  };
}

function operationTargets() {
  return [
    {
      id: "33333333-3333-4333-8333-333333333333",
      operation_id: operation().id,
      series_id: "44444444-4444-4444-8444-444444444444",
      calendar_id: "primary",
      google_event_id: "afops44444444444444484444444444444444",
      expected_etag: '"etag-a"',
      expected_founderops_revision: 1,
      cleanup_action: "delete",
      recurrence_count: null,
      state: "pending",
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      operation_id: operation().id,
      series_id: "66666666-6666-4666-8666-666666666666",
      calendar_id: "primary",
      google_event_id: "bfops66666666666646668666666666666666",
      expected_etag: '"etag-b"',
      expected_founderops_revision: 1,
      cleanup_action: "truncate",
      recurrence_count: 4,
      state: "pending",
    },
  ];
}

function fakeClients(state) {
  return {
    serviceSupabase: {
      from(table) { return builder(state, table); },
      async rpc(name, args) {
        state.events.push(name);
        if (name === "prepare_google_workspace_disconnect") {
          if (state.operation?.state === "completed") return { data: { state: "completed" }, error: null };
          state.operation = operation();
          state.targets = operationTargets();
          return { data: { id: state.operation.id, state: "cleaning" }, error: null };
        }
        if (name === "record_google_workspace_disconnect_write") { return {data:null,error:null}; }
        if (name === "confirm_google_workspace_disconnect_series") {
          const row = state.targets.find((candidate) => candidate.id === args.p_target_id);
          row.state = "confirmed";
          return { data: null, error: null };
        }
        if (name === "finalize_google_workspace_disconnect") {
          if (state.targets.some((row) => row.state !== "confirmed")) return { data: null, error: { code: "P0003" } };
          state.operation.state = state.operation.revoke_connection ? "revoke_pending" : "completed";
          state.operation.deactivated_at = args.p_observed_at;
          return { data: { state: state.operation.state }, error: null };
        }
        if (name === "complete_google_workspace_disconnect") {
          state.operation.state = "completed";
          state.operation.completed_at = args.p_completed_at;
          return { data: null, error: null };
        }
        if (name === "deactivate_team_workweek_for_external_revocation") {
          state.operation.requested_by = "external_revocation";
          state.operation.revoke_connection = false;
          state.operation.state = "cleanup_pending";
          state.operation.deactivated_at = args.p_observed_at;
          state.events.push("external_revocation_confirmed");
          return { data: { state: "cleanup_pending" }, error: null };
        }
        if (name === "rebase_google_workspace_disconnect_series") {
          const row = state.targets.find((candidate) => candidate.id === args.p_target_id);
          if (!row || row.expected_etag !== args.p_expected_etag) return { data: null, error: { code: "P0004" } };
          row.expected_etag = args.p_observed_etag;
          return { data: null, error: null };
        }
        throw new Error(`unexpected RPC ${name}`);
      },
    },
  };
}

const disconnectServer = await importTestModule(
  "src/features/team-workweek/server/google-workspace-disconnect.ts",
  {
    "server-only": {},
    "@/lib/google-calendar-errors": oauthCore,
    "./team-workweek-calendar": {
      calendarForWorkweekOwner: async () => ({request:(url,init)=>fetch(url,init)}),
      removeWorkweekCalendarConnection: async () => undefined,
    },
    "./team-workweek-publication-core": publicationCore,
    "../model/team-workweek-draft": draftModel,
  },
);

function scriptedCalendar(state, {failTruncate = false, changed = false} = {}) {
  const events = new Map(operationTargets().map(target => [target.google_event_id, {
    id:target.google_event_id,etag:changed ? '"changed"' : target.expected_etag,
    start:{dateTime:target.cleanup_action === "delete" ? "2099-01-12T09:00:00Z" : "2026-08-03T07:00:00Z",timeZone:"Europe/Berlin"},
    end:{dateTime:target.cleanup_action === "delete" ? "2099-01-12T17:00:00Z" : "2026-08-03T15:00:00Z",timeZone:"Europe/Berlin"},
    recurrence:["RRULE:FREQ=WEEKLY"],
    extendedProperties:{private:{founderopsWorkweekSeriesId:target.series_id,founderopsWorkweekRevision:"1"}},
  }]));
  const writes=[];
  let fail=failTruncate;
  const provider=async(url,init={})=>{
    const id=new URL(url).pathname.split("/").at(-1);
    if(init.method === "DELETE") {writes.push("DELETE");events.delete(id);return new Response(null,{status:204});}
    if(init.method === "PUT") {
      writes.push("PUT");
      if(fail){fail=false;return new Response(null,{status:503});}
      events.set(id,{...JSON.parse(init.body),etag:'"cleaned"'});
    }
    return events.has(id) ? Response.json(events.get(id)) : new Response(null,{status:404});
  };
  return {writes,events,calendar:calendarProvider(provider,async()=>{state.events.push("dispatch");})};
}

test("manual disconnect journals partial cleanup, deactivates before local removal and replays completion",async()=>{
  const state=fakeState(), clients=fakeClients(state),google=scriptedCalendar(state,{failTruncate:true});
  let removals=0;
  const input={...clients,ownerProfileId:"profile-1",getAccessToken:async()=>google.calendar,now:()=>new Date("2026-08-25T12:00:00Z"),
    removeConnection:async()=>{assert.equal(state.operation.state,"revoke_pending");removals++;}};
  assert.deepEqual(await disconnectServer.disconnectGoogleWorkspace(input),{state:"cleaning",recovery:"retry"});
  assert.equal(state.targets[0].state,"confirmed");assert.equal(state.targets[1].state,"pending");assert.equal(removals,0);
  assert.deepEqual(await disconnectServer.disconnectGoogleWorkspace(input),{state:"completed",recovery:null});
  assert.equal(removals,1);assert.deepEqual(google.writes,["DELETE","PUT","PUT"]);
  assert.ok(state.events.indexOf("dispatch")<state.events.indexOf("confirm_google_workspace_disconnect_series"));
  assert.deepEqual(await disconnectServer.disconnectGoogleWorkspace(input),{state:"completed",recovery:null});
  assert.equal(removals,1);
});

test("local removal retries without calendar writes or provider revocation", async () => {
  const state = fakeState();
  state.operation = { ...operation(), state: "revoke_pending", deactivated_at: "2026-08-25T12:00:00.000Z" };
  const clients = fakeClients(state);
  let revokeAttempts = 0;
  const first = await disconnectServer.disconnectGoogleWorkspace({
    ...clients,
    ownerProfileId: "profile-1",
    removeConnection: async () => {
      revokeAttempts += 1;
      if (revokeAttempts === 1) throw new Error("lost response");
    },
  });
  assert.deepEqual(first, { state: "remove_pending", recovery: "retry" });
  const second = await disconnectServer.disconnectGoogleWorkspace({
    ...clients,
    ownerProfileId: "profile-1",
    removeConnection: async () => { revokeAttempts += 1; },
  });
  assert.deepEqual(second, { state: "completed", recovery: null });
  assert.equal(revokeAttempts, 2);
});

test("an already revoked connection deactivates the team week and leaves cleanup pending", async () => {
  const state = fakeState();
  const clients = fakeClients(state);
  let providerWrites = 0;
  let revokes = 0;
  const result = await disconnectServer.disconnectGoogleWorkspace({
    ...clients,
    ownerProfileId: "profile-1",
    getAccessToken: async () => {
      throw new oauthCore.GoogleWorkspaceOAuthContractError(
        "provider_revoked",
        "stored token is revoked",
      );
    },
    removeConnection: async () => {
      revokes += 1;
    },
    now: () => new Date("2026-08-25T12:03:00.000Z"),
  });
  assert.deepEqual(result, { state: "cleanup_pending", recovery: "reconnect" });
  assert.equal(state.operation.state, "cleanup_pending");
  assert.equal(state.operation.requested_by, "external_revocation");
  assert.equal(providerWrites, 0);
  assert.equal(revokes, 0);
  assert.ok(state.events.includes("external_revocation_confirmed"));
});

test("a local reconnect condition never deactivates the team week", async () => {
  const state = fakeState();
  const clients = fakeClients(state);
  const result = await disconnectServer.disconnectGoogleWorkspace({
    ...clients,
    ownerProfileId: "profile-1",
    getAccessToken: async () => {
      throw new oauthCore.GoogleWorkspaceOAuthContractError(
        "reconnect_required",
        "stored token cannot be decrypted",
      );
    },
  });
  assert.deepEqual(result, { state: "cleaning", recovery: "reconnect" });
  assert.equal(state.operation.state, "cleaning");
  assert.equal(state.events.includes("external_revocation_confirmed"), false);
});

test("a provider authorization response requests reconnect without automatic deactivation", async () => {
  const state = fakeState();
  const clients = fakeClients(state);
  const result = await disconnectServer.disconnectGoogleWorkspace({
    ...clients,
    ownerProfileId: "profile-1",
    getAccessToken: async () => calendarProvider(async()=>new Response(null,{status:401})),
  });
  assert.deepEqual(result, { state: "cleaning", recovery: "reconnect" });
  assert.equal(state.operation.state, "cleaning");
  assert.equal(state.events.includes("external_revocation_confirmed"), false);
});

test("a marker-stable historical series rebases before a journaled cleanup",async()=>{
  const state=fakeState(), clients=fakeClients(state),google=scriptedCalendar(state,{changed:true});
  const input={...clients,ownerProfileId:"profile-1",getAccessToken:async()=>google.calendar,removeConnection:async()=>{},now:()=>new Date("2026-08-25T12:00:00Z")};
  assert.deepEqual(await disconnectServer.disconnectGoogleWorkspace(input),{state:"cleaning",recovery:"retry"});
  assert.equal(state.targets[0].expected_etag,'"changed"');assert.deepEqual(google.writes,[]);
  // The second target needs its own explicit rebase before its next cleanup attempt.
  await disconnectServer.disconnectGoogleWorkspace(input);
  assert.deepEqual(await disconnectServer.disconnectGoogleWorkspace(input),{state:"completed",recovery:null});
  assert.deepEqual(google.writes,["DELETE","PUT"]);
});
