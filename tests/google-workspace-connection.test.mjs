import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const core = await import("../src/features/team-workweek/server/google-workspace-oauth-core.ts");
const connectionModel = await import("../src/features/team-workweek/model/google-workspace-connection.ts");

const key = Buffer.alloc(32, 7);

test("Google Workspace tokens use an independent authenticated 32-byte encryption key", () => {
  const encodedKey = key.toString("base64");
  assert.deepEqual(core.googleWorkspaceEncryptionKey(encodedKey), key);
  assert.throws(() => core.googleWorkspaceEncryptionKey(Buffer.alloc(31).toString("base64")), /exakt 32 Byte/);

  const encrypted = core.encryptGoogleWorkspaceToken("private-refresh-token", key);
  assert.match(encrypted, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(core.decryptGoogleWorkspaceToken(encrypted, key), "private-refresh-token");
  assert.throws(() => core.decryptGoogleWorkspaceToken(encrypted, Buffer.alloc(32, 8)), (error) => {
    assert.match(error.message, /nicht entschlüsselt/);
    return error.code === "reconnect_required";
  });
  assert.doesNotMatch(encrypted, /private-refresh-token/);
});

test("OAuth state is signed, short-lived, redirect-safe, and bound to user plus profile", () => {
  const source = readFileSync("src/features/team-workweek/server/google-workspace-oauth-core.ts", "utf8");
  assert.match(source, /hkdfSync\([\s\S]*oauth-state-signing/);
  const now = Date.parse("2026-08-25T08:00:00.000Z");
  const stateValue = core.createGoogleWorkspaceOAuthState({
    userId: "user-1",
    profileId: "profile-1",
    next: "/team?view=week",
    now,
    nonce: "fixed-nonce",
    key,
  });
  const state = core.verifyGoogleWorkspaceOAuthState(stateValue, { key, now: now + 1_000 });
  assert.equal(state.userId, "user-1");
  assert.equal(state.profileId, "profile-1");
  assert.equal(state.next, "/team?view=week");
  assert.doesNotThrow(() => core.assertGoogleWorkspaceOAuthStateBinding(state, {
    userId: "user-1",
    profileId: "profile-1",
  }));
  assert.throws(() => core.assertGoogleWorkspaceOAuthStateBinding(state, {
    userId: "user-2",
    profileId: "profile-1",
  }), /aktuellen FounderOps-Sitzung/);
  assert.throws(() => core.verifyGoogleWorkspaceOAuthState(`${stateValue.slice(0, -1)}x`, { key, now }), /nicht geprüft/);
  assert.throws(() => core.verifyGoogleWorkspaceOAuthState(stateValue, {
    key,
    now: now + core.GOOGLE_WORKSPACE_STATE_TTL_MS + 1,
  }), /abgelaufen/);

  const unsafe = core.createGoogleWorkspaceOAuthState({
    userId: "user-1",
    profileId: "profile-1",
    next: "https://attacker.invalid/callback",
    now,
    key,
  });
  assert.equal(core.verifyGoogleWorkspaceOAuthState(unsafe, { key, now }).next, "/team");
});

test("authorization requests only owned calendar events with offline consent", () => {
  const url = core.googleWorkspaceAuthorizationUrl({
    clientId: "client-id",
    redirectUri: "https://founder-ops.findmydoc.eu/api/google-workspace/callback",
    state: "signed-state",
  });
  assert.equal(url.searchParams.get("scope"), core.GOOGLE_WORKSPACE_CALENDAR_SCOPE);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("include_granted_scopes"), "false");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.doesNotMatch(url.toString(), /openid|userinfo\.email|userinfo\.profile|calendar\.events(?!\.owned)/);
});

test("feature-owned connect navigation preserves the complete relative return target", () => {
  assert.equal(
    connectionModel.googleWorkspaceConnectPath({ pathname: "/team", search: "?week=next", hash: "#google" }),
    "/api/google-workspace/connect?next=%2Fteam%3Fweek%3Dnext%23google",
  );
  assert.equal(
    connectionModel.googleWorkspaceConnectPath({ pathname: "", search: "", hash: "" }),
    "/api/google-workspace/connect?next=%2Fteam",
  );
});

test("token responses fail closed for missing refresh tokens and expanded scopes", () => {
  const valid = core.validateGoogleWorkspaceTokenResponse({
    access_token: "access-secret",
    refresh_token: "refresh-secret",
    expires_in: 3600,
    refresh_token_expires_in: 604800,
    scope: core.GOOGLE_WORKSPACE_CALENDAR_SCOPE,
    token_type: "Bearer",
  });
  assert.equal(valid.refreshToken, "refresh-secret");
  assert.equal(valid.scope.length, 1);

  assert.throws(() => core.validateGoogleWorkspaceTokenResponse({
    access_token: "access-secret",
    expires_in: 3600,
    scope: core.GOOGLE_WORKSPACE_CALENDAR_SCOPE,
    token_type: "Bearer",
  }), (error) => {
    assert.doesNotMatch(error.message, /access-secret/);
    return error.code === "invalid_token_response";
  });
  assert.throws(() => core.validateGoogleWorkspaceTokenResponse({
    access_token: "access-secret",
    refresh_token: "refresh-secret",
    expires_in: 3600,
    scope: `${core.GOOGLE_WORKSPACE_CALENDAR_SCOPE} openid`,
    token_type: "Bearer",
  }), (error) => error.code === "scope_mismatch");
});

test("connection status exposes no token material and recognizes reconnect states", () => {
  const row = {
    connected_at: "2026-08-25T08:00:00.000Z",
    refreshed_at: null,
    last_used_at: null,
    access_token_expires_at: "2026-08-25T09:00:00.000Z",
    refresh_token_expires_at: null,
    revoked_at: null,
    last_error_class: null,
  };
  assert.equal(core.googleWorkspaceConnectionStatus(null).state, "not_connected");
  const connected = core.googleWorkspaceConnectionStatus(row, Date.parse("2026-08-25T08:30:00.000Z"));
  assert.equal(connected.state, "connected");
  assert.deepEqual(Object.keys(connected).sort(), [
    "accessTokenExpiresAt",
    "connectedAt",
    "lastUsedAt",
    "refreshedAt",
    "state",
  ]);
  assert.equal(core.googleWorkspaceConnectionStatus({
    ...row,
    last_error_class: "oauth_reconnect_required",
  }).state, "reconnect_required");
  assert.equal(core.googleWorkspaceConnectionStatus({
    ...row,
    revoked_at: "2026-08-25T08:15:00.000Z",
  }).state, "reconnect_required");
});
