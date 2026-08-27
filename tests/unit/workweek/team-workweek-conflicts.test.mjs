import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

const reconciliationCore = await import("../../../src/features/team-workweek/server/team-workweek-reconciliation-core.ts");
const oauthCore = await import("../../../src/features/team-workweek/server/google-workspace-oauth-core.ts");
const workweekModel = await import("../../../src/features/team-workweek/model/team-workweek-draft.ts");

const conflicts = await loadTranspiledModule(
  "src/features/team-workweek/server/team-workweek-conflicts.ts",
  {
    "server-only": {},
    "../model/team-workweek-draft": workweekModel,
    "./google-workspace-oauth": { getGoogleWorkspaceAccessToken: async () => "token" },
    "./google-workspace-oauth-core": oauthCore,
    "./team-workweek-reconciliation-core": reconciliationCore,
    "./team-workweek-publication": { publishTeamWorkweek: async () => { throw new Error("unused"); } },
  },
);

const now = () => new Date("2026-08-25T09:00:00.000Z");
const baseWindows = [{ weekday: 1, startMinute: 540, endMinute: 1020 }];
const googleWindows = [{ weekday: 1, startMinute: 600, endMinute: 1080 }];
const observations = [{
  seriesId: "22222222-2222-4222-8222-222222222222",
  priorEtag: '"etag-1"',
  observedEtag: '"etag-2"',
  founderopsRevision: 1,
  providerState: "active",
}];

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function googleFingerprint(value = observations) {
  return fingerprint(value.map((observation) => ({
    seriesId: observation.seriesId,
    observedEtag: observation.observedEtag,
    founderopsRevision: observation.founderopsRevision,
    providerState: observation.providerState,
  })));
}

function query(result) {
  return {
    select() { return this; },
    eq() { return this; },
    is() { return this; },
    in() { return this; },
    order() { return this; },
    limit() { return this; },
    maybeSingle: async () => result,
    then(resolve) { return Promise.resolve(result).then(resolve); },
  };
}

function detectionService(versionWindows, rpcCalls = []) {
  return {
    from(table) {
      if (table === "team_workweek_versions") return query({
        data: {
          id: "33333333-3333-4333-8333-333333333333",
          owner_profile_id: "profile-1",
          effective_from: "2026-08-31",
          origin: "owner",
          team_workweek_windows: versionWindows.map((window) => ({
            weekday: window.weekday,
            start_minute: window.startMinute,
            end_minute: window.endMinute,
          })),
        },
        error: null,
      });
      if (table === "team_workweek_publications") return query({
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          owner_profile_id: "profile-1",
          effective_from: "2026-08-24",
          publication_revision: 1,
          windows: baseWindows,
        },
        error: null,
      });
      if (table === "team_workweek_google_series") return query({
        data: [{
          id: observations[0].seriesId,
          calendar_id: "primary",
          google_event_id: "fops22222222222242228222222222222222",
          confirmed_etag: observations[0].priorEtag,
          confirmed_founderops_revision: 1,
          provider_state: "active",
          team_workweek_windows: { weekday: 1, start_minute: 540, end_minute: 1020 },
        }],
        error: null,
      });
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: { id: "44444444-4444-4444-8444-444444444444", conflictRevision: 1 }, error: null };
    },
  };
}

test("Google-only, FounderOps-only, and parallel changes remain distinct", async () => {
  const unchangedObservation = async () => ({ state: "unchanged", observations, observedAt: now().toISOString() });
  const founderOnlyRpcCalls = [];
  const founderOnly = await conflicts.detectTeamWorkweekParallelConflict({
    ownerProfileId: "profile-1",
    serviceSupabase: detectionService(googleWindows, founderOnlyRpcCalls),
    versionId: "33333333-3333-4333-8333-333333333333",
    getAccessToken: async () => "token",
    observe: unchangedObservation,
    now,
  });
  assert.equal(founderOnly.state, "clear");
  assert.equal(founderOnlyRpcCalls[0].name, "apply_google_team_workweek_observations");
  assert.deepEqual(founderOnlyRpcCalls[0].args.p_observations, observations);

  const changedObservation = async () => ({ state: "changed", observations, windows: googleWindows, observedAt: now().toISOString() });
  const googleOnly = await conflicts.detectTeamWorkweekParallelConflict({
    ownerProfileId: "profile-1",
    serviceSupabase: detectionService(baseWindows),
    versionId: "33333333-3333-4333-8333-333333333333",
    getAccessToken: async () => "token",
    observe: changedObservation,
    now,
  });
  assert.equal(googleOnly.state, "google_only");

  const rpcCalls = [];
  const parallel = await conflicts.detectTeamWorkweekParallelConflict({
    ownerProfileId: "profile-1",
    serviceSupabase: detectionService([{ weekday: 2, startMinute: 540, endMinute: 900 }], rpcCalls),
    versionId: "33333333-3333-4333-8333-333333333333",
    getAccessToken: async () => "token",
    observe: changedObservation,
    now,
  });
  assert.equal(parallel.state, "conflict");
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "create_team_workweek_google_conflict");
  assert.deepEqual(rpcCalls[0].args.p_google_windows, googleWindows);
  assert.equal(JSON.stringify(rpcCalls[0]).includes("summary"), false);
});

test("preflight keeps reconnect and retry delay classes explicit", async () => {
  await assert.rejects(conflicts.detectTeamWorkweekParallelConflict({
    ownerProfileId: "profile-1",
    serviceSupabase: detectionService(googleWindows),
    versionId: "33333333-3333-4333-8333-333333333333",
    getAccessToken: async () => {
      throw new oauthCore.GoogleWorkspaceOAuthContractError("reconnect_required", "expired");
    },
    now,
  }), (error) => error instanceof conflicts.TeamWorkweekConflictError
    && error.code === "unavailable"
    && error.delayClass === "oauth_reconnect_required");

  await assert.rejects(conflicts.detectTeamWorkweekParallelConflict({
    ownerProfileId: "profile-1",
    serviceSupabase: detectionService(googleWindows),
    versionId: "33333333-3333-4333-8333-333333333333",
    getAccessToken: async () => "token",
    observe: async () => ({ state: "delayed", errorClass: "quota_exceeded", observedAt: now().toISOString() }),
    now,
  }), (error) => error instanceof conflicts.TeamWorkweekConflictError
    && error.code === "unavailable"
    && error.delayClass === "provider_unavailable");
});

function resolvingConflict(decision) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    owner_profile_id: "profile-1",
    base_publication_id: "11111111-1111-4111-8111-111111111111",
    base_publication_revision: 1,
    founderops_version_id: "33333333-3333-4333-8333-333333333333",
    google_effective_from: "2026-08-31",
    google_windows: googleWindows,
    google_observations: observations,
    google_fingerprint: googleFingerprint(),
    founderops_fingerprint: fingerprint({ effectiveFrom: "2026-08-31", windows: [] }),
    conflict_revision: 1,
    state: "resolving",
    decision,
    resolution_version_id: "55555555-5555-4555-8555-555555555555",
    observed_at: now().toISOString(),
    team_workweek_versions: {
      id: "33333333-3333-4333-8333-333333333333",
      owner_profile_id: "profile-1",
      effective_from: "2026-08-31",
      origin: "owner",
      team_workweek_windows: [],
    },
  };
}

function resolvingService(conflict, rpcCalls = []) {
  return {
    from(table) {
      if (table === "team_workweek_google_conflicts") return query({ data: conflict, error: null });
      if (table === "team_workweek_publications") return query({
        data: {
          id: conflict.base_publication_id,
          owner_profile_id: conflict.owner_profile_id,
          effective_from: "2026-08-24",
          publication_revision: conflict.base_publication_revision,
          windows: baseWindows,
        },
        error: null,
      });
      if (table === "team_workweek_google_series") return query({
        data: [{
          id: observations[0].seriesId,
          calendar_id: "primary",
          google_event_id: "fops22222222222242228222222222222222",
          confirmed_etag: observations[0].priorEtag,
          confirmed_founderops_revision: 1,
          provider_state: "active",
          team_workweek_windows: { weekday: 1, start_minute: 540, end_minute: 1020 },
        }],
        error: null,
      });
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
  };
}

test("both decisions replay one prepared resolution and complete only after publication", async () => {
  for (const decision of ["founderops", "google"]) {
    const rpcCalls = [];
    const serviceSupabase = resolvingService(resolvingConflict(decision), rpcCalls);
    const publication = await conflicts.resolveTeamWorkweekConflict({
      conflictId: "44444444-4444-4444-8444-444444444444",
      conflictRevision: 1,
      decision,
      ownerProfileId: "profile-1",
      serviceSupabase,
      userSupabase: {},
      publish: async ({ versionId }) => ({
        id: "66666666-6666-4666-8666-666666666666",
        status: "published",
        syncState: "confirmed",
        publicationRevision: 2,
        publishedAt: now().toISOString(),
        lastSyncAt: now().toISOString(),
        recovery: null,
        versionId,
      }),
      observe: async () => ({ state: "changed", observations, windows: googleWindows, observedAt: now().toISOString() }),
      now,
    });
    assert.equal(publication.status, "published");
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].name, "complete_team_workweek_google_conflict_resolution");
  }
});

test("a stale or differently replayed decision stops before provider publication", async () => {
  let publishes = 0;
  await assert.rejects(conflicts.resolveTeamWorkweekConflict({
    conflictId: "44444444-4444-4444-8444-444444444444",
    conflictRevision: 1,
    decision: "google",
    ownerProfileId: "profile-1",
    serviceSupabase: resolvingService(resolvingConflict("founderops")),
    userSupabase: {},
    publish: async () => { publishes += 1; },
    observe: async () => ({ state: "changed", observations, windows: googleWindows, observedAt: now().toISOString() }),
    now,
  }), (error) => error instanceof conflicts.TeamWorkweekConflictError && error.code === "stale");
  assert.equal(publishes, 0);
});

test("a changed provider CAS refreshes the resolving conflict before an explicit replay", async () => {
  const changedObservations = [{ ...observations[0], priorEtag: observations[0].observedEtag, observedEtag: '"etag-3"' }];
  const staleConflict = resolvingConflict("founderops");
  const rpcCalls = [];
  let publishes = 0;
  await assert.rejects(conflicts.resolveTeamWorkweekConflict({
    conflictId: staleConflict.id,
    conflictRevision: 1,
    decision: "founderops",
    ownerProfileId: "profile-1",
    serviceSupabase: resolvingService(staleConflict, rpcCalls),
    userSupabase: {},
    publish: async () => { publishes += 1; },
    observe: async () => ({ state: "changed", observations: changedObservations, windows: googleWindows, observedAt: now().toISOString() }),
    now,
  }), (error) => error instanceof conflicts.TeamWorkweekConflictError && error.code === "stale");
  assert.equal(publishes, 0);
  assert.equal(rpcCalls[0].name, "refresh_team_workweek_google_conflict_resolution");

  const refreshedConflict = {
    ...staleConflict,
    conflict_revision: 2,
    google_observations: changedObservations,
    google_fingerprint: googleFingerprint(changedObservations),
  };
  let publicationInput = null;
  const publication = await conflicts.resolveTeamWorkweekConflict({
    conflictId: refreshedConflict.id,
    conflictRevision: 2,
    decision: "founderops",
    ownerProfileId: "profile-1",
    serviceSupabase: resolvingService(refreshedConflict),
    userSupabase: {},
    publish: async (input) => {
      publishes += 1;
      publicationInput = input;
      return {
        id: "66666666-6666-4666-8666-666666666666",
        status: "preparing",
        syncState: "delayed",
        publicationRevision: 2,
        publishedAt: null,
        lastSyncAt: null,
        recovery: "retry",
      };
    },
    observe: async () => ({ state: "changed", observations: changedObservations, windows: googleWindows, observedAt: now().toISOString() }),
    now,
  });
  assert.equal(publication.status, "preparing");
  assert.equal(publishes, 1);
  assert.equal(publicationInput.transitionsFirst, true);
});
