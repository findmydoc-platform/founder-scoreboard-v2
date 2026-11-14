import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
async function loadRevisionRoute({ queryResult = { data: [], count: 0 }, denied = false } = {}) {
  const protocol = administratorProtocol({ role: "viewer", profile: !denied });
  const calls = [], authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/planning_workspace_snapshot") {
      calls.push(url);
      return queryResult.error ? Response.json(queryResult.error, { status: 503 })
        : Response.json({ scope_revision: "42", active_task_count: queryResult.count, latest_updated_at: queryResult.data?.[0]?.updated_at || null });
    }
    return authFetch(request);
  });
  const route = await importTestModule("src/app/api/planning-revision/route.ts", { "server-only": {} });
  return { calls, GET: async () => { const response = await route.GET(protocol.request()); return { status: response.status, body: await response.json(), headers: Object.fromEntries(response.headers) }; } };
}

test("planning task revisions compare active count and newest server timestamp", async () => {
  const revisions = await importTestModule("src/features/planning/model/planning-revision.ts");
  const revision = revisions.planningTaskRevision([
    { id: "one", updatedAt: "2026-08-03T10:00:00.000Z" },
    { id: "two", updatedAt: "2026-08-03T12:00:00.000Z" },
    { id: "three", updatedAt: "" },
  ]);

  assert.deepEqual(revision, { activeTaskCount: 3, latestUpdatedAt: "2026-08-03T12:00:00.000Z" });
  assert.equal(revisions.planningTaskRevisionsEqual(revision, { ...revision }), true);
  assert.equal(revisions.planningTaskRevisionsEqual(revision, { ...revision, activeTaskCount: 4 }), false);
  assert.equal(revisions.planningTaskRevisionsEqual(revision, { ...revision, latestUpdatedAt: "2026-08-03T12:01:00.000Z" }), false);
});

test("planning revision route preserves authorization, exact count, latest timestamp, and failures", async () => {
  const route = await loadRevisionRoute({
    queryResult: {
      data: [{ updated_at: "2026-08-03T12:00:00.000Z" }],
      error: null,
      count: 17,
    },
  });
  const response = await route.GET({});
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    revision: { activeTaskCount: 17, latestUpdatedAt: "2026-08-03T12:00:00.000Z", scopeRevision: "42" },
  });
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.equal(route.calls.length, 1);


  const empty = await loadRevisionRoute({ queryResult: { data: [], error: null, count: 0 } });
  assert.deepEqual((await empty.GET({})).body.revision, { activeTaskCount: 0, latestUpdatedAt: "", scopeRevision: "42" });

  const failed = await loadRevisionRoute({ queryResult: { data: null, error: { message: "offline" }, count: null } });
  const failedResponse = await failed.GET({});
  assert.equal(failedResponse.status, 500);
  assert.equal(failedResponse.body.error, "Planungsänderungen konnten nicht geprüft werden.");

  const denied = await loadRevisionRoute({ denied: true });
  assert.equal((await denied.GET()).status, 403);
  assert.deepEqual(denied.calls, []);
});


test("source-only observation returns its version without requesting a complete snapshot or aggregate", async () => {
  const protocol = administratorProtocol({ role: "viewer", responses: { planning_source_version: "source-47" } });
  const route = await importTestModule("src/app/api/planning-source-version/route.ts", { "server-only": {} });
  const response = await route.GET(protocol.request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { version: "source-47" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(protocol.calls.map(call => call.name), ["planning_source_version"]);
});

test("source-only HTTP cancellation reaches the version RPC without a complete fallback", async () => {
  const protocol = administratorProtocol({ role: "viewer" });
  const fallback = globalThis.fetch;
  const controller = new AbortController();
  let receivedSignal, entered;
  const started = new Promise(resolve => { entered = resolve; });
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname !== "/rest/v1/rpc/planning_source_version") return fallback(request);
    receivedSignal = request.signal;
    entered();
    await new Promise(resolve => request.signal.addEventListener("abort", resolve, { once: true }));
    throw new DOMException("Controlled version cancellation", "AbortError");
  });
  const { NextRequest } = await import("next/server");
  const request = new NextRequest(protocol.request("/api/planning-source-version"), { signal: controller.signal });
  const route = await importTestModule("src/app/api/planning-source-version/route.ts", { "server-only": {} });
  const reading = route.GET(request);
  await started;
  controller.abort();
  await vi.waitFor(() => assert.equal(receivedSignal?.aborted, true));
  assert.equal((await reading).status, 503);
  assert.equal(protocol.calls.some(call => call.name === "planning_workspace_snapshot"), false);
});
