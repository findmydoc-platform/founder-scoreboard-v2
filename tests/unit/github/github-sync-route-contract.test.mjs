import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
import { planningRouteProtocol } from "../../helpers/planning-route-protocol.mjs";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
async function workflow({ kind = "deliverable", outage = false, missing = false } = {}) {
  const task = { id: "task-1", task_type: kind, project_id: "findmydoc-founder-execution", title: "Synthetic task", status: "Offen", approval_status: "approved", github_repo: "findmydoc-platform/management", trashed_at: null };
  const protocol = planningRouteProtocol({ role: "founder", tables: {
    active_tasks: () => outage ? Response.json({ code: "08006", message: "Unavailable" }, { status: 503 }) : missing ? null : task,
    tasks: task,
  } });
  let tokenCalls = 0;
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.hostname === "api.github.com") {
      assert.equal(url.pathname, "/app/installations/456/access_tokens"); tokenCalls += 1;
      return Response.json({ token: "synthetic-installation", expires_at: new Date(Date.now() + 3600000).toISOString() });
    }
    return authFetch(request);
  });
  const { POST } = await importTestModule("src/app/api/tasks/[id]/sync-github/route.ts", { "server-only": {} });
  return { ...protocol, tokenCalls: () => tokenCalls, send: payload => POST(protocol.request("/api/tasks/task-1/sync-github", "POST", payload), { params: Promise.resolve({ id: "task-1" }) }) };
}

test("sync route rejects a non-boolean creation decision before token acquisition", async () => {
  const state = await workflow();
  const response = await state.send({ createIfMissing: "false" });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { ok: false, code: "github_sync_invalid_target", error: "createIfMissing muss als Boolean übergeben werden.", retryable: false });
  assert.equal(state.tokenCalls(), 0); assert.equal(state.requests.length, 0);
});

test("sync route forwards an explicit false creation decision unchanged", async () => {
  const state = await workflow();
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  vi.stubEnv("GITHUB_APP_ID", "123"); vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "456");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKey.export({ type: "pkcs8", format: "pem" }));
  const response = await state.send({ createIfMissing: false });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "github_sync_creation_required");
  assert.equal(state.tokenCalls(), 1);
  assert.equal(state.calls.length, 0);
});

test("sync route preserves API context infrastructure status metadata", async () => {
  const state = await workflow();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ""); vi.stubEnv("SUPABASE_URL", "");
  const response = await state.send({ createIfMissing: false });
  assert.equal(response.status, 501);
  const body = await response.json();
  assert.equal(body.code, "github_sync_unavailable"); assert.equal(body.retryable, true);
  assert.equal(state.tokenCalls(), 0); assert.equal(state.requests.length, 0);
});

test("sync route preserves a marked pre-effect session failure", async () => {
  const state = await workflow(); state.state.authError = 401;
  const response = await state.send({ createIfMissing: false });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { code: "session_invalid_before_effect", error: "Anmeldung ungültig oder abgelaufen." });
  assert.equal(state.tokenCalls(), 0); assert.equal(state.requests.length, 0);
});

test("sync route rejects strategic items before token acquisition", async () => {
  const state = await workflow({ kind: "initiative" });
  const response = await state.send({ createIfMissing: false });
  assert.equal(response.status, 409); assert.equal((await response.json()).code, "github_sync_invalid_target");
  assert.equal(state.tokenCalls(), 0); assert.equal(state.calls.length, 0);
});

test("sync route distinguishes a database outage from a missing item", async () => {
  const failed = await workflow({ outage: true });
  const response = await failed.send({ createIfMissing: false });
  assert.equal(response.status, 503);
  const body = await response.json(); assert.equal(body.code, "github_sync_unavailable"); assert.equal(body.retryable, true); assert.equal(failed.tokenCalls(), 0);
  const missing = await workflow({ missing: true });
  const absent = await missing.send({ createIfMissing: false });
  assert.equal(absent.status, 404);
  const absentBody = await absent.json(); assert.equal(absentBody.code, "github_sync_not_found"); assert.equal(absentBody.retryable, false); assert.equal(missing.tokenCalls(), 0);
});
