import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";
import {
  assertGoogleWorkspaceOAuthStateBinding,
  createGoogleWorkspaceOAuthState,
  GOOGLE_WORKSPACE_CALENDAR_SCOPE,
  validateGoogleWorkspaceTokenResponse,
  verifyGoogleWorkspaceOAuthState,
} from "../src/features/team-workweek/server/google-workspace-oauth-core.ts";
import {
  ensureGoogleWorkweekSeries,
} from "../src/features/team-workweek/server/team-workweek-publication-core.ts";
import {
  observeGoogleWorkweek,
} from "../src/features/team-workweek/server/team-workweek-reconciliation-core.ts";

const publicationCore = await import("../src/features/team-workweek/server/team-workweek-publication-core.ts");
const oauthCore = await import("../src/features/team-workweek/server/google-workspace-oauth-core.ts");
const draftModel = await import("../src/features/team-workweek/model/team-workweek-draft.ts");
const { ensureGoogleWorkweekSeriesAbsent } = await loadTranspiledModule(
  "src/features/team-workweek/server/google-workspace-disconnect-core.ts",
  { "./team-workweek-publication-core": publicationCore },
);
const oauthServer = await loadTranspiledModule(
  "src/features/team-workweek/server/google-workspace-oauth.ts",
  {
    "server-only": {},
    "./google-workspace-oauth-core": oauthCore,
  },
);
const disconnectServer = await loadTranspiledModule(
  "src/features/team-workweek/server/google-workspace-disconnect.ts",
  {
    "server-only": {},
    "./google-workspace-oauth-core": oauthCore,
    "./google-workspace-oauth": {
      getGoogleWorkspaceAccessToken: async () => "controlled-access-token",
      revokeAndRemoveGoogleWorkspaceConnection: async () => undefined,
    },
    "./google-workspace-disconnect-core": { ensureGoogleWorkweekSeriesAbsent },
    "./team-workweek-publication-core": publicationCore,
    "../model/team-workweek-draft": draftModel,
  },
);

const starterProfiles = ["anil", "oezen", "sebastian", "volkan", "youssef"];
const fixedDate = new Date("2026-08-25T09:15:00.000Z");
const fixedClock = () => new Date(fixedDate);

function jsonResponse(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  });
}

class ControlledGoogleCalendarAdapter {
  events = new Map();
  loseNextCreateResponse = false;

  key(url) {
    const parsed = new URL(String(url));
    const segments = parsed.pathname.split("/").filter(Boolean);
    return decodeURIComponent(segments.at(-1) || "");
  }

  event(id) {
    return this.events.get(id) || null;
  }

  store(event, etag) {
    this.events.set(event.id, { ...event, etag, status: event.status || "confirmed" });
  }

  editWindow(id, { start, end, etag }) {
    const current = this.event(id);
    assert.ok(current);
    this.store({
      ...current,
      start: { dateTime: start, timeZone: "Europe/Berlin" },
      end: { dateTime: end, timeZone: "Europe/Berlin" },
      recurrence: ["RRULE:FREQ=WEEKLY"],
    }, etag);
  }

  corruptIdentity(id) {
    const current = this.event(id);
    assert.ok(current);
    this.store({
      ...current,
      extendedProperties: { private: { founderopsWorkweekSeriesId: "foreign-series" } },
    }, '"identity-conflict"');
  }

  async fetch(input, init = {}) {
    const url = new URL(String(input));
    const method = String(init.method || "GET").toUpperCase();
    const isCollection = url.pathname.endsWith("/events");
    const id = this.key(url);

    if (method === "GET") {
      const event = this.event(id);
      return event ? jsonResponse(200, event) : jsonResponse(404);
    }
    if (method === "POST" && isCollection) {
      const event = JSON.parse(String(init.body));
      const stored = { ...event, etag: `"${event.id}-etag"`, status: "confirmed" };
      this.store(stored, stored.etag);
      if (this.loseNextCreateResponse) {
        this.loseNextCreateResponse = false;
        throw new Error("controlled lost response");
      }
      return jsonResponse(200, stored);
    }
    if (method === "DELETE") {
      const event = this.event(id);
      if (!event) return jsonResponse(404);
      const expectedEtag = new Headers(init.headers).get("if-match");
      if (expectedEtag !== event.etag) return jsonResponse(412);
      this.events.delete(id);
      return jsonResponse(204);
    }
    return jsonResponse(405);
  }
}

function publication(profileId, revision, series) {
  return {
    id: `${profileId}-publication-${revision}`,
    sourceVersionId: `${profileId}-version-${revision}`,
    ownerProfileId: profileId,
    effectiveFrom: "2026-08-31",
    timezone: "Europe/Berlin",
    status: "preparing",
    syncState: "pending",
    publicationRevision: revision,
    publishedAt: null,
    lastSyncAt: null,
    series: [series],
    transitions: [],
  };
}

function series(profileId, revision) {
  return {
    id: `${profileId}-series-${revision}`,
    calendarId: "primary",
    googleEventId: `${profileId}-event-${revision}`,
    state: "pending",
    confirmedEtag: null,
    weekday: 1,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
  };
}

function controlledToken(profileId, suffix = "initial") {
  return validateGoogleWorkspaceTokenResponse({
    access_token: `${profileId}-${suffix}-access`,
    refresh_token: `${profileId}-${suffix}-refresh`,
    expires_in: 3600,
    scope: GOOGLE_WORKSPACE_CALENDAR_SCOPE,
    token_type: "Bearer",
  });
}

function createProfileVaultHarness() {
  const connections = new Map();
  const operations = new Map();
  const targets = new Map();
  const preparedTargets = new Map();
  const revokedProfiles = [];

  function disconnectBuilder(table) {
    const filters = [];
    const api = {
      select() { return api; },
      eq(key, value) { filters.push(["eq", key, value]); return api; },
      neq(key, value) { filters.push(["neq", key, value]); return api; },
      order() { return api; },
      limit() { return api; },
      async maybeSingle() {
        assert.equal(table, "google_workspace_disconnect_operations");
        const ownerProfileId = filters.find(([, key]) => key === "owner_profile_id")?.[2];
        const operation = operations.get(ownerProfileId) || null;
        const visible = operation && filters.every(([kind, key, value]) => (
          kind === "eq" ? operation[key] === value : operation[key] !== value
        ));
        return { data: visible ? operation : null, error: null };
      },
      async returns() {
        assert.equal(table, "google_workspace_disconnect_series");
        const operationId = filters.find(([, key]) => key === "operation_id")?.[2];
        const rows = Array.from(targets.values()).flat().filter((row) => row.operation_id === operationId);
        return { data: rows, error: null };
      },
    };
    return api;
  }

  const serviceSupabase = {
    from(table) {
      if (table === "google_workspace_connections") {
        return {
          async upsert(row, options) {
            assert.deepEqual(options, { onConflict: "profile_id" });
            connections.set(row.profile_id, structuredClone(row));
            return { error: null };
          },
        };
      }
      return disconnectBuilder(table);
    },
    async rpc(name, args) {
      if (name === "prepare_google_workspace_disconnect") {
        const profileId = args.p_owner_profile_id;
        const operation = {
          id: `${profileId}-disconnect`,
          owner_profile_id: profileId,
          requested_by: "owner",
          revoke_connection: true,
          state: "cleaning",
          retained_version_id: null,
          deactivated_at: null,
          completed_at: null,
          last_error_class: null,
        };
        const target = preparedTargets.get(profileId);
        assert.ok(target, `missing controlled cleanup target for ${profileId}`);
        operations.set(profileId, operation);
        targets.set(profileId, [{
          ...target,
          id: `${profileId}-disconnect-target`,
          operation_id: operation.id,
          cleanup_action: "delete",
          recurrence_count: null,
          state: "pending",
        }]);
        return { data: { id: operation.id, state: operation.state }, error: null };
      }
      if (name === "confirm_google_workspace_disconnect_series") {
        const target = Array.from(targets.values()).flat().find((candidate) => candidate.id === args.p_target_id);
        assert.ok(target);
        assert.equal(target.expected_etag, args.p_expected_etag);
        target.state = "confirmed";
        return { data: null, error: null };
      }
      if (name === "finalize_google_workspace_disconnect") {
        const operation = Array.from(operations.values()).find((candidate) => candidate.id === args.p_operation_id);
        assert.ok(operation);
        assert.equal(targets.get(operation.owner_profile_id)?.every((target) => target.state === "confirmed"), true);
        operation.state = "revoke_pending";
        operation.deactivated_at = args.p_observed_at;
        return { data: { state: operation.state }, error: null };
      }
      if (name === "complete_google_workspace_disconnect") {
        const operation = operations.get(args.p_owner_profile_id);
        assert.ok(operation);
        assert.equal(operation.id, args.p_operation_id);
        operation.state = "completed";
        operation.completed_at = args.p_completed_at;
        return { data: null, error: null };
      }
      throw new Error(`unexpected acceptance RPC ${name}`);
    },
  };

  return {
    connections,
    operations,
    preparedTargets,
    revokedProfiles,
    serviceSupabase,
  };
}

test("the five-profile starter completes the deterministic Google lifecycle without exposing private evidence", async () => {
  const publicEvidence = [];
  const vault = createProfileVaultHarness();
  const previousEnvironment = {
    clientId: process.env.GOOGLE_WORKSPACE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_WORKSPACE_CLIENT_SECRET,
    encryptionKey: process.env.GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY,
  };
  process.env.GOOGLE_WORKSPACE_CLIENT_ID = "controlled-client";
  process.env.GOOGLE_WORKSPACE_CLIENT_SECRET = "controlled-client-secret";
  process.env.GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 42).toString("base64");

  try {
    for (const profileId of starterProfiles) {
      const token = controlledToken(profileId);
      await oauthServer.storeGoogleWorkspaceConnection({
        supabase: vault.serviceSupabase,
        profileId,
        token,
        now: fixedDate.getTime(),
      });
      const stored = vault.connections.get(profileId);
      assert.ok(stored);
      assert.notEqual(stored.encrypted_access_token, token.accessToken);
      assert.notEqual(stored.encrypted_refresh_token, token.refreshToken);
      assert.deepEqual(stored.oauth_scopes, [GOOGLE_WORKSPACE_CALENDAR_SCOPE]);
    }
    assert.equal(vault.connections.size, starterProfiles.length);

    for (const [index, profileId] of starterProfiles.entries()) {
    const adapter = new ControlledGoogleCalendarAdapter();
    const fetchImpl = adapter.fetch.bind(adapter);
    const signingKey = Buffer.alloc(32, index + 1);
    const stateValue = createGoogleWorkspaceOAuthState({
      userId: `${profileId}-auth-user`,
      profileId,
      next: "/team",
      now: fixedDate.getTime(),
      nonce: `${profileId}-nonce`,
      key: signingKey,
    });
    const state = verifyGoogleWorkspaceOAuthState(stateValue, {
      key: signingKey,
      now: fixedDate.getTime(),
    });
    assertGoogleWorkspaceOAuthStateBinding(state, {
      userId: `${profileId}-auth-user`,
      profileId,
    });
    const token = controlledToken(profileId);

    const initialSeries = series(profileId, 1);
    adapter.loseNextCreateResponse = true;
    const firstProjection = await ensureGoogleWorkweekSeries({
      accessToken: token.accessToken,
      fetchImpl,
      now: fixedClock,
      publication: publication(profileId, 1, initialSeries),
      series: initialSeries,
    });
    assert.equal(firstProjection.state, "confirmed");
    assert.equal(firstProjection.observedAt, fixedDate.toISOString());

    const changedSeries = series(profileId, 2);
    const founderopsChange = await ensureGoogleWorkweekSeries({
      accessToken: token.accessToken,
      fetchImpl,
      now: fixedClock,
      publication: publication(profileId, 2, changedSeries),
      series: changedSeries,
    });
    assert.equal(founderopsChange.state, "confirmed");

    adapter.editWindow(changedSeries.googleEventId, {
      start: "2026-08-31T10:00:00+02:00",
      end: "2026-08-31T18:00:00+02:00",
      etag: `"${profileId}-google-change"`,
    });
    const knownSeries = [{
      id: changedSeries.id,
      calendarId: "primary",
      googleEventId: changedSeries.googleEventId,
      confirmedEtag: founderopsChange.etag,
      confirmedFounderopsRevision: 2,
      weekday: 1,
      startMinute: changedSeries.startMinute,
      endMinute: changedSeries.endMinute,
    }];
    const googleChange = await observeGoogleWorkweek({
      accessToken: token.accessToken,
      fetchImpl,
      now: fixedClock,
      series: knownSeries,
      wait: async () => {},
    });
    assert.equal(googleChange.state, "changed");
    assert.deepEqual(googleChange.windows, [{ weekday: 1, startMinute: 600, endMinute: 1080 }]);

    const validEvent = adapter.event(changedSeries.googleEventId);
    adapter.corruptIdentity(changedSeries.googleEventId);
    const conflict = await observeGoogleWorkweek({
      accessToken: token.accessToken,
      fetchImpl,
      now: fixedClock,
      series: knownSeries,
      wait: async () => {},
    });
    assert.deepEqual(
      { state: conflict.state, errorClass: conflict.errorClass },
      { state: "conflict", errorClass: "provider_identity_mismatch" },
    );

    adapter.store(validEvent, validEvent.etag);
    adapter.events.delete(changedSeries.googleEventId);
    const googleDeletion = await observeGoogleWorkweek({
      accessToken: token.accessToken,
      fetchImpl,
      now: fixedClock,
      series: knownSeries,
      wait: async () => {},
    });
    assert.equal(googleDeletion.state, "changed");
    assert.deepEqual(googleDeletion.windows, []);

    const cleanupEtag = `"${profileId}-cleanup"`;
    adapter.store(validEvent, cleanupEtag);
    adapter.store({ id: `${profileId}-ordinary-event`, summary: "Private calendar content" }, `"${profileId}-ordinary"`);
    vault.preparedTargets.set(profileId, {
        calendarId: "primary",
        calendar_id: "primary",
        google_event_id: changedSeries.googleEventId,
        series_id: changedSeries.id,
        expected_etag: cleanupEtag,
        expected_founderops_revision: 2,
      });
    const disconnected = await disconnectServer.disconnectGoogleWorkspace({
      ownerProfileId: profileId,
      serviceSupabase: vault.serviceSupabase,
      getAccessToken: async (_supabase, requestedProfileId) => {
        assert.equal(requestedProfileId, profileId);
        assert.ok(vault.connections.has(requestedProfileId));
        return token.accessToken;
      },
      observe: async ({ target }) => ({ state: "present", etag: target.expectedEtag }),
      ensureAbsent: async (input) => ensureGoogleWorkweekSeriesAbsent({ ...input, fetchImpl }),
      revoke: async (_supabase, requestedProfileId) => {
        assert.equal(requestedProfileId, profileId);
        assert.equal(vault.operations.get(requestedProfileId)?.state, "revoke_pending");
        assert.equal(vault.connections.delete(requestedProfileId), true);
        vault.revokedProfiles.push(requestedProfileId);
      },
      now: fixedClock,
    });
    assert.deepEqual(disconnected, { state: "completed", recovery: null });
    assert.equal(adapter.event(changedSeries.googleEventId), null);
    assert.ok(adapter.event(`${profileId}-ordinary-event`));
    assert.equal(vault.connections.has(profileId), false);

    await oauthServer.storeGoogleWorkspaceConnection({
      supabase: vault.serviceSupabase,
      profileId,
      token: controlledToken(profileId, "reconnected"),
      now: fixedDate.getTime(),
    });
    assert.ok(vault.connections.has(profileId));

    const reconnectedSeries = series(profileId, 3);
    const reconnection = await ensureGoogleWorkweekSeries({
      accessToken: token.accessToken,
      fetchImpl,
      now: fixedClock,
      publication: publication(profileId, 3, reconnectedSeries),
      series: reconnectedSeries,
    });
    assert.equal(reconnection.state, "confirmed");

    publicEvidence.push({
      profileId,
      connection: "confirmed",
      firstProjection: firstProjection.state,
      founderopsChange: founderopsChange.state,
      googleChange: googleChange.state,
      conflict: conflict.state,
      lostResponse: "recovered",
      deletion: googleDeletion.state,
      disconnect: disconnected.state,
      revoke: vault.revokedProfiles.includes(profileId) ? "confirmed" : "missing",
      cleanup: "confirmed",
      reconnection: reconnection.state,
    });
    }

    assert.equal(publicEvidence.length, 5);
    assert.deepEqual(vault.revokedProfiles, starterProfiles);
    assert.equal(vault.connections.size, starterProfiles.length);
    assert.deepEqual(Array.from(vault.connections.keys()).sort(), [...starterProfiles].sort());
    assert.ok(publicEvidence.every((entry) => entry.revoke === "confirmed"));
    assert.ok(publicEvidence.every((entry) => Object.values(entry).every(Boolean)));
    assert.doesNotMatch(JSON.stringify(publicEvidence), /token|authorization|Private calendar content/i);
  } finally {
    if (previousEnvironment.clientId === undefined) delete process.env.GOOGLE_WORKSPACE_CLIENT_ID;
    else process.env.GOOGLE_WORKSPACE_CLIENT_ID = previousEnvironment.clientId;
    if (previousEnvironment.clientSecret === undefined) delete process.env.GOOGLE_WORKSPACE_CLIENT_SECRET;
    else process.env.GOOGLE_WORKSPACE_CLIENT_SECRET = previousEnvironment.clientSecret;
    if (previousEnvironment.encryptionKey === undefined) delete process.env.GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY;
    else process.env.GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY = previousEnvironment.encryptionKey;
  }
});
