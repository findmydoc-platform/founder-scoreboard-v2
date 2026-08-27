import assert from "node:assert/strict";
import { test } from "vitest";
import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

async function loadRevisionRoute({ apiContext, queryResult } = {}) {
  const calls = [];
  const teamGuard = () => ({ ok: true });
  const builder = {
    select(...args) { calls.push(["select", ...args]); return this; },
    eq(...args) { calls.push(["eq", ...args]); return this; },
    order(...args) { calls.push(["order", ...args]); return this; },
    async limit(...args) {
      calls.push(["limit", ...args]);
      return queryResult || { data: [], error: null, count: 0 };
    },
  };
  let receivedGuard = null;
  const route = await loadTranspiledModule("src/app/api/planning-revision/route.ts", {
    "next/server": {
      NextResponse: {
        json: (body, init = {}) => ({ body, headers: init.headers || {}, status: init.status || 200 }),
      },
    },
    "@/lib/api-response": {
      apiError: (error, status) => ({ body: { error }, headers: {}, status }),
      requireApiContext: async (_request, guard) => {
        receivedGuard = guard;
        return apiContext || {
          ok: true,
          supabase: {
            from(table) { calls.push(["from", table]); return builder; },
          },
        };
      },
    },
    "@/lib/authz": { requireTeamMember: teamGuard },
    "@/lib/planning-read-model": { ACTIVE_TASKS_TABLE: "active_tasks" },
  });
  return { ...route, calls, teamGuard, receivedGuard: () => receivedGuard };
}

test("planning task revisions compare active count and newest server timestamp", async () => {
  const revisions = await loadTranspiledModule("src/features/planning/model/planning-revision.ts");
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
  assert.equal(route.receivedGuard(), route.teamGuard);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    revision: { activeTaskCount: 17, latestUpdatedAt: "2026-08-03T12:00:00.000Z" },
  });
  assert.equal(response.headers["Cache-Control"], "private, no-store");
  assert.deepEqual(route.calls, [
    ["from", "active_tasks"],
    ["select", "updated_at", { count: "exact" }],
    ["eq", "project_id", "findmydoc-founder-execution"],
    ["order", "updated_at", { ascending: false }],
    ["limit", 1],
  ]);

  const empty = await loadRevisionRoute({ queryResult: { data: [], error: null, count: 0 } });
  assert.deepEqual((await empty.GET({})).body.revision, { activeTaskCount: 0, latestUpdatedAt: "" });

  const failed = await loadRevisionRoute({ queryResult: { data: null, error: { message: "offline" }, count: null } });
  const failedResponse = await failed.GET({});
  assert.equal(failedResponse.status, 500);
  assert.equal(failedResponse.body.error, "Planungsänderungen konnten nicht geprüft werden.");

  const deniedResponse = { status: 403, body: { error: "Nicht erlaubt" } };
  const denied = await loadRevisionRoute({ apiContext: { ok: false, response: deniedResponse } });
  assert.equal(await denied.GET({}), deniedResponse);
  assert.deepEqual(denied.calls, []);
});
