import { vi } from "vitest";
import assert from "node:assert/strict";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { afterEach, beforeEach, test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
let protocol;
beforeEach(() => { protocol = administratorProtocol({ authError: 401 }); });

const { apiError, authzError } = await importTestModule("src/lib/api-response.ts", {
  "./supabase": { getServerSupabase: () => ({}) },
});

const { authorizeCredentialAction: authorize } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });

test("an invalid application session is marked for browser recovery", async () => {
  const permission = await authorize({ credential: { kind: "session-request", request: protocol.request() }, action: "tools.create" });
  assert.deepEqual(permission, {
    ok: false,
    status: 401,
    code: "session_invalid_before_effect",
    error: "Anmeldung ungültig oder abgelaufen.",
  });

  const response = authzError(permission);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    code: "session_invalid_before_effect",
    error: "Anmeldung ungültig oder abgelaufen.",
  });
});

test("only the authorization serializer emits the pre-effect marker", async () => {
  const response = apiError("Anmeldung ungültig oder abgelaufen.", 401);

  assert.deepEqual(await response.json(), {
    error: "Anmeldung ungültig oder abgelaufen.",
  });
});

test("authorization response fields cannot forge the pre-effect marker", async () => {
  const response = authzError(
    { ok: false, status: 401, error: "Anmeldung erforderlich." },
    { code: "session_invalid_before_effect", ok: false },
  );

  assert.deepEqual(await response.json(), {
    ok: false,
    error: "Anmeldung erforderlich.",
  });
});

test("a retryable Supabase Auth outage is not marked as an invalid session", async () => {
  protocol.state.authError = 503;

  const permission = await authorize({ credential: { kind: "session-request", request: protocol.request() }, action: "tools.create" });

  assert.deepEqual(permission, {
    ok: false,
    status: 503,
    error: "Anmeldung konnte vorübergehend nicht geprüft werden.",
  });
  const response = authzError(permission);
  assert.deepEqual(await response.json(), {
    error: "Anmeldung konnte vorübergehend nicht geprüft werden.",
  });
});


test("session authorization returns a valid mapped team profile", async () => {
  protocol.state.authError = null; protocol.state.role = "deputy";
  const result = await authorize({ credential: { kind: "session-request", request: protocol.request() }, action: "tools.create" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.profile, { id: "synthetic-profile", name: "Synthetic Founder", platformRole: "deputy", githubLogin: "" });
});
test("session authorization fails closed for an unmapped user", async () => {
  protocol.state.authError = null; protocol.state.profile = false;
  const result = await authorize({ credential: { kind: "session-request", request: protocol.request() }, action: "tools.create" });
  assert.deepEqual(result, { ok: false, status: 403, error: "Dieses Konto ist keinem Teamprofil zugeordnet." });
});
test("session authorization fails closed when profile lookup is ambiguous", async () => {
  protocol.state.authError = null; protocol.state.profileError = true;
  const result = await authorize({ credential: { kind: "session-request", request: protocol.request() }, action: "tools.create" });
  assert.deepEqual(result, { ok: false, status: 403, error: "Teamprofil konnte nicht eindeutig geprüft werden." });
});
