import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const permission = { ok: true, profile: { id: "founder", platformRole: "founder" } };
const database = {};
let authorization;
const commit = vi.fn();
const handler = await importTestModule("src/features/planning-items/model/planning-items-browser-task-update.ts", {
  "server-only": {},
  "@/lib/api-response": {
    requireApiContext: async () => authorization,
    apiError: (error, status) => NextResponse.json({ error }, { status }),
  },
  "./planning-item-revision": { createPlanningItemRevision: () => ({ commitBrowserRevision: commit }) },
});

beforeEach(() => {
  authorization = { ok: true, permission, supabase: database };
  commit.mockReset();
});

function update(payload = { expectedUpdatedAt: "2026-09-24T10:00:00.000Z", title: "Changed title" }) {
  return handler.handleBrowserTaskUpdate(new NextRequest("http://localhost:3000/api/tasks/task", {
    method: "PATCH", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" },
  }), { params: Promise.resolve({ id: "task" }) });
}

test("Browser adapter forwards the authenticated revision and its mapped result", async () => {
  const value = { task: { id: "task", updatedAt: "2026-09-24T11:00:00.000Z" }, activities: [] };
  commit.mockResolvedValue({ ok: true, value });
  const response = await update();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, ...value });
  assert.deepEqual(commit.mock.calls[0][0], { itemId: "task", payload: { expectedUpdatedAt: "2026-09-24T10:00:00.000Z", title: "Changed title" }, permission });
});

test.each([
  ["invalidCommand", 400], ["forbidden", 403], ["notFound", 404],
  ["conflict", 409], ["dependencyUnavailable", 500],
])("Browser adapter maps %s to HTTP %i", async (kind, status) => {
  commit.mockResolvedValue({ ok: false, error: { kind, message: "Revision rejected" } });
  const response = await update();
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error: "Revision rejected" });
});

test("Browser adapter preserves structured length errors and administrator codes", async () => {
  const lengthErrors = [{ field: "title", maximum: 240, actual: 241, excess: 1, message: "Too long" }];
  commit.mockResolvedValueOnce({ ok: false, error: { kind: "invalidCommand", message: "Too long", lengthErrors } });
  assert.deepEqual(await (await update()).json(), { error: "Too long", lengthErrors });
  commit.mockResolvedValueOnce({ ok: false, error: { kind: "forbidden", message: "Expired", code: "administrator_access_expired" } });
  const denied = await update();
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: "Expired", code: "administrator_access_expired" });
});

test("Browser adapter stops before revision when authorization fails", async () => {
  authorization = { ok: false, response: NextResponse.json({ error: "Denied" }, { status: 403 }) };
  assert.equal((await update()).status, 403);
  assert.equal(commit.mock.calls.length, 0);
});

test.each([[null, 400], [[], 400], [{ unknownField: true }, 400], [{ githubIssueSyncStatus: "synced" }, 403]])("Browser adapter rejects unsupported transport payload %j", async (payload, status) => {
  assert.equal((await update(payload)).status, status);
  assert.equal(commit.mock.calls.length, 0);
});

// These actions keep their dedicated authorization and transaction paths.
test.each([{ status: "Review" }, { parentTaskId: "parent" }])("Browser adapter routes special action %j outside ordinary revision", async (payload) => {
  const response = await update(payload);
  assert.equal(response.status, 400);
  assert.equal(commit.mock.calls.length, 0);
});
