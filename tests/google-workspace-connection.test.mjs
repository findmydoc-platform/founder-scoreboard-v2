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

test("server routes and vault keep OAuth tokens behind the service-role boundary", () => {
  const migration = readFileSync("supabase/migrations/20260825075422_google_workspace_connection_vault.sql", "utf8");
  const server = readFileSync("src/features/team-workweek/server/google-workspace-oauth.ts", "utf8");
  const connect = readFileSync("src/app/api/google-workspace/connect/route.ts", "utf8");
  const callback = readFileSync("src/app/api/google-workspace/callback/route.ts", "utf8");
  const status = readFileSync("src/app/api/google-workspace/status/route.ts", "utf8");
  const hook = readFileSync("src/features/team-workweek/hooks/use-google-workspace-connection.ts", "utf8");
  const card = readFileSync("src/features/team-workweek/molecules/google-workspace-connection-card.tsx", "utf8");
  const browserApiClient = readFileSync("src/lib/browser-api-client.ts", "utf8");

  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.google_workspace_connections from authenticated/);
  assert.match(migration, /revoke all on table public\.google_workspace_connections from service_role/);
  assert.match(migration, /grant select, insert, update, delete on table public\.google_workspace_connections to service_role/);
  assert.doesNotMatch(migration, /create policy/i);
  assert.match(connect, /getServerPlanningAuth\(\["ceo", "founder", "deputy"\]\)/);
  assert.match(callback, /getServerPlanningAuth\(\["ceo", "founder", "deputy"\]\)/);
  assert.doesNotMatch(connect, /"viewer"/);
  assert.doesNotMatch(callback, /"viewer"/);
  assert.match(callback, /verifyBoundGoogleWorkspaceState/);
  assert.match(callback, /getServerServiceRoleSupabase/);
  assert.match(status, /requireApiContext\(request, requireTeamMember\)/);
  assert.match(status, /getServerServiceRoleSupabase/);
  assert.match(server, /GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY/);
  assert.doesNotMatch(server, /GITHUB_TOKEN_ENCRYPTION_KEY|NEXT_PUBLIC_GOOGLE_WORKSPACE/);
  assert.doesNotMatch(status, /encrypted_access_token|encrypted_refresh_token|accessToken|refreshToken/);
  assert.doesNotMatch(card, /encrypted_access_token|encrypted_refresh_token|accessToken|refreshToken/);
  assert.match(server, /oauth_reconnect_required/);
  assert.match(server, /markGoogleWorkspaceConnectionError/);
  assert.match(server, /revokeAndRemoveGoogleWorkspaceConnection/);
  assert.match(server, /revokeIntentError/);
  assert.match(server, /revoked_at: revokedAt/);
  assert.match(server, /https:\/\/oauth2\.googleapis\.com\/revoke/);
  assert.match(server, /new URLSearchParams\(\{ token: refreshToken \}\)/);
  assert.match(server, /\.delete\(\)[\s\S]*\.eq\("profile_id", profileId\)/);
  assert.match(card, /callbackError/);
  assert.match(hook, /googleWorkspaceConnectPath/);
  assert.match(card, /onClick=\{startConnect\}/);
  assert.doesNotMatch(browserApiClient, /GoogleWorkspace|google-workspace/);
  assert.match(card, /veröffentlicht keine Arbeitswoche/);
  assert.match(card, /Google verbinden/);
  assert.match(card, /Neu verbinden/);
  assert.match(card, /profile\.platformRole !== "viewer"/);
  assert.match(card, /Viewer können den Verbindungsstatus lesen/);
});
