import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

test("platform role helpers keep operational lead boundary explicit", async () => {
  const { isOperationalLeadRole } = await loadTranspiledModule("src/lib/platform.ts");

  assert.equal(isOperationalLeadRole("ceo"), true);
  assert.equal(isOperationalLeadRole("deputy"), true);
  assert.equal(isOperationalLeadRole("founder"), false);
  assert.equal(isOperationalLeadRole("viewer"), false);
  assert.equal(isOperationalLeadRole(""), false);
  assert.equal(isOperationalLeadRole(null), false);
  assert.equal(isOperationalLeadRole(undefined), false);
});

test("task assignment uses profile id before display name and legacy owner fallback", async () => {
  const { taskBelongsToProfile } = await loadTranspiledModule("src/lib/platform.ts");
  const sebastian = { id: "sebastian", name: "Sebastian" };
  const volkan = { id: "volkan", name: "Volkan" };

  assert.equal(taskBelongsToProfile({ assigneeId: "sebastian", assignee: "Volkan" }, sebastian), true);
  assert.equal(taskBelongsToProfile({ assigneeId: "volkan", assignee: "Sebastian" }, sebastian), false);
  assert.equal(taskBelongsToProfile({ assignee: "Sebastian" }, sebastian), true);
  assert.equal(taskBelongsToProfile({ assignee: "Volkan" }, sebastian), false);
  assert.equal(taskBelongsToProfile({ assigneeId: "volkan", assignee: "Volkan" }, volkan), true);
  assert.equal(taskBelongsToProfile({ ownerId: "sebastian", owner: "Sebastian" }, sebastian), true);
});
