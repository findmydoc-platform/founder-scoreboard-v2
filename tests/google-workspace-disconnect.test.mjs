import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { listSupabaseMigrations } from "../scripts/lib/supabase-migrations.mjs";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const publicationCore = await import("../src/features/team-workweek/server/team-workweek-publication-core.ts");
const oauthCore = await import("../src/features/team-workweek/server/google-workspace-oauth-core.ts");
const draftModel = await import("../src/features/team-workweek/model/team-workweek-draft.ts");
const disconnectCore = await loadTranspiledModule(
  "src/features/team-workweek/server/google-workspace-disconnect-core.ts",
  { "./team-workweek-publication-core": publicationCore },
);

const target = {
  calendarId: "primary",
  googleEventId: "fops22222222222242228222222222222222",
  seriesId: "22222222-2222-4222-8222-222222222222",
  expectedEtag: '"etag-1"',
  expectedFounderopsRevision: 1,
};

function response(status, body = null) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: body === null ? undefined : { "content-type": "application/json" },
  });
}

function event(etag = target.expectedEtag, seriesId = target.seriesId) {
  return {
    id: target.googleEventId,
    etag,
    extendedProperties: {
      private: {
        founderopsWorkweekSeriesId: seriesId,
        founderopsWorkweekRevision: String(target.expectedFounderopsRevision),
      },
    },
  };
}

test("future-only series deletion observes exact identity and uses ETag CAS", async () => {
  const calls = [];
  const result = await disconnectCore.ensureGoogleWorkweekSeriesAbsent({
    accessToken: "secret-token",
    target,
    fetchImpl: async (input, init = {}) => {
      calls.push({ input: String(input), init });
      return init.method === "DELETE" ? response(204) : response(200, event());
    },
    now: () => new Date("2026-08-25T12:00:00.000Z"),
  });
  assert.equal(result.state, "confirmed");
  assert.equal(calls.length, 2);
  assert.match(calls[0].input, /fields=id%2Cetag%2CextendedProperties%2Fprivate/);
  assert.equal(calls[1].init.headers["if-match"], target.expectedEtag);
  assert.equal(typeof calls[0].init.headers.authorization === "string", true);
});

test("lost delete success is observed before any retry and an unrelated event is never deleted", async () => {
  let attempts = 0;
  let deletes = 0;
  const lost = await disconnectCore.ensureGoogleWorkweekSeriesAbsent({
    accessToken: "token",
    target,
    fetchImpl: async (_input, init = {}) => {
      attempts += 1;
      if (attempts === 1) return response(200, event());
      if (init.method === "DELETE") {
        deletes += 1;
        throw new Error("lost response");
      }
      return response(404);
    },
  });
  assert.equal(lost.state, "confirmed");
  assert.equal(deletes, 1);

  deletes = 0;
  const unrelated = await disconnectCore.ensureGoogleWorkweekSeriesAbsent({
    accessToken: "token",
    target,
    fetchImpl: async (_input, init = {}) => {
      if (init.method === "DELETE") deletes += 1;
      return response(200, event(target.expectedEtag, "different-series"));
    },
  });
  assert.deepEqual(unrelated, { state: "delayed", errorClass: "provider_identity_mismatch" });
  assert.equal(deletes, 0);
});

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

const disconnectServer = await loadTranspiledModule(
  "src/features/team-workweek/server/google-workspace-disconnect.ts",
  {
    "server-only": {},
    "./google-workspace-oauth-core": oauthCore,
    "./google-workspace-oauth": {
      getGoogleWorkspaceAccessToken: async () => "token",
      revokeAndRemoveGoogleWorkspaceConnection: async () => undefined,
    },
    "./google-workspace-disconnect-core": disconnectCore,
    "./team-workweek-publication-core": publicationCore,
    "../model/team-workweek-draft": draftModel,
  },
);

test("manual disconnect resumes partial cleanup, deactivates before revoke, and replays completion", async () => {
  const state = fakeState();
  const clients = fakeClients(state);
  let truncateAttempts = 0;
  let revokes = 0;
  const input = {
    ...clients,
    ownerProfileId: "profile-1",
    getAccessToken: async () => "token",
    observe: async ({ target: observedTarget }) => ({ state: "present", etag: observedTarget.expectedEtag }),
    ensureAbsent: async () => ({ state: "confirmed", etag: '"etag-a"', observedAt: "2026-08-25T12:00:00.000Z" }),
    ensureTransition: async () => {
      truncateAttempts += 1;
      return truncateAttempts === 1
        ? { state: "delayed", errorClass: "provider_unavailable" }
        : { state: "confirmed", etag: '"etag-b2"', observedAt: "2026-08-25T12:01:00.000Z" };
    },
    revoke: async () => {
      assert.equal(state.operation.state, "revoke_pending");
      revokes += 1;
    },
    now: () => new Date("2026-08-25T12:02:00.000Z"),
  };

  const partial = await disconnectServer.disconnectGoogleWorkspace(input);
  assert.deepEqual(partial, { state: "cleaning", recovery: "retry" });
  assert.equal(state.targets[0].state, "confirmed");
  assert.equal(state.targets[1].state, "pending");
  assert.equal(revokes, 0);

  const completed = await disconnectServer.disconnectGoogleWorkspace(input);
  assert.deepEqual(completed, { state: "completed", recovery: null });
  assert.equal(state.targets.every((row) => row.state === "confirmed"), true);
  assert.equal(revokes, 1);
  assert.ok(state.events.indexOf("finalize_google_workspace_disconnect") < state.events.indexOf("complete_google_workspace_disconnect"));

  const replayed = await disconnectServer.disconnectGoogleWorkspace(input);
  assert.deepEqual(replayed, { state: "completed", recovery: null });
  assert.equal(revokes, 1);
});

test("lost revocation response stays revoke-pending and retries without calendar writes", async () => {
  const state = fakeState();
  state.operation = { ...operation(), state: "revoke_pending", deactivated_at: "2026-08-25T12:00:00.000Z" };
  const clients = fakeClients(state);
  let revokeAttempts = 0;
  const first = await disconnectServer.disconnectGoogleWorkspace({
    ...clients,
    ownerProfileId: "profile-1",
    observe: async ({ target: observedTarget }) => ({ state: "present", etag: observedTarget.expectedEtag }),
    revoke: async () => {
      revokeAttempts += 1;
      if (revokeAttempts === 1) throw new Error("lost response");
    },
  });
  assert.deepEqual(first, { state: "revoke_pending", recovery: "retry" });
  const second = await disconnectServer.disconnectGoogleWorkspace({
    ...clients,
    ownerProfileId: "profile-1",
    observe: async ({ target: observedTarget }) => ({ state: "present", etag: observedTarget.expectedEtag }),
    revoke: async () => { revokeAttempts += 1; },
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
    ensureAbsent: async () => {
      providerWrites += 1;
      return { state: "confirmed" };
    },
    ensureTransition: async () => {
      providerWrites += 1;
      return { state: "confirmed" };
    },
    revoke: async () => {
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
    getAccessToken: async () => "token",
    observe: async () => ({ state: "delayed", errorClass: "oauth_reconnect_required" }),
  });
  assert.deepEqual(result, { state: "cleaning", recovery: "reconnect" });
  assert.equal(state.operation.state, "cleaning");
  assert.equal(state.events.includes("external_revocation_confirmed"), false);
});

test("a marker-stable ETag change rebases once before cleanup resumes", async () => {
  const state = fakeState();
  const clients = fakeClients(state);
  let observed = 0;
  let providerWrites = 0;
  const input = {
    ...clients,
    ownerProfileId: "profile-1",
    getAccessToken: async () => "token",
    observe: async ({ target: observedTarget }) => {
      observed += 1;
      return {
        state: "present",
        etag: observed === 1 ? '"etag-a2"' : observedTarget.expectedEtag,
      };
    },
    ensureAbsent: async () => {
      providerWrites += 1;
      return { state: "confirmed", etag: '"etag-a2"', observedAt: "2026-08-25T12:04:00.000Z" };
    },
    ensureTransition: async () => {
      providerWrites += 1;
      return { state: "confirmed", etag: '"etag-b"', observedAt: "2026-08-25T12:04:00.000Z" };
    },
    revoke: async () => undefined,
    now: () => new Date("2026-08-25T12:04:00.000Z"),
  };
  const rebased = await disconnectServer.disconnectGoogleWorkspace(input);
  assert.deepEqual(rebased, { state: "cleaning", recovery: "retry" });
  assert.equal(state.targets[0].expected_etag, '"etag-a2"');
  assert.equal(providerWrites, 0);
  const completed = await disconnectServer.disconnectGoogleWorkspace(input);
  assert.deepEqual(completed, { state: "completed", recovery: null });
  assert.equal(providerWrites, 2);
});

test("database, API, and UI keep disconnect targets server-only and confirmation explicit", async () => {
  const migrations = await listSupabaseMigrations();
  const migration = migrations.find(({ file }) => file === "20260825114432_disconnect_google_workspace_safely.sql")?.sql || "";
  assert.match(migration, /create table public\.google_workspace_disconnect_operations/);
  assert.match(migration, /create table public\.google_workspace_disconnect_series/);
  assert.match(migration, /status in \('preparing', 'published', 'inactive'\)/);
  assert.match(migration, /requested_by, revoke_connection, cutoff_date, state/);
  assert.match(migration, /retain_private_team_workweek_after_deactivation/);
  assert.match(migration, /deactivate_team_workweek_for_external_revocation/);
  assert.match(migration, /rebase_google_workspace_disconnect_series/);
  assert.match(migration, /grant execute on function public\.prepare_google_workspace_disconnect\(text\) to service_role/i);
  assert.doesNotMatch(migration, /grant execute on function public\.prepare_google_workspace_disconnect[^;]*to authenticated/i);
  assert.doesNotMatch(migration, /grant (?:select|insert|update|delete).*google_workspace_disconnect_(?:operations|series).*authenticated/i);

  const route = await readFile("src/app/api/google-workspace/disconnect/route.ts", "utf8");
  assert.match(route, /requirePlanningContributor/);
  assert.match(route, /input\.confirm !== true/);
  assert.doesNotMatch(route, /input\.(?:profileId|ownerProfileId|calendarId|googleEventId)/);

  const dialog = await readFile("src/features/team-workweek/molecules/google-workspace-disconnect-dialog.tsx", "utf8");
  assert.match(dialog, /zukünftige eindeutig markierte Google-Serie/);
  assert.match(dialog, /Vergangene FounderOps-Vorkommen und gewöhnliche Kalendertermine bleiben unverändert/);
  assert.match(dialog, /spätere Verbindung veröffentlicht die Woche nicht automatisch/);

  const server = await readFile("src/features/team-workweek/server/google-workspace-disconnect.ts", "utf8");
  assert.match(server, /publication\.effective_to === null \|\| publication\.effective_to >= cutoff/);
  assert.match(server, /\.in\("publication_id", futurePublicationIds\)/);
});
