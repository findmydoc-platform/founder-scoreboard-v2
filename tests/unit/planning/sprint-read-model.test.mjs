import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const { sprintWorkspaceReducer } = await importTestModule("src/features/sprint/model/sprint-read-model.ts");

test("Sprint reducer keeps updates inside the focused slice", () => {
  const model = {
    revision: "one",
    project: { id: "project" },
    people: [{ id: "person" }],
    items: [{ id: "item", sprintId: "sprint", scoreFinal: false, status: "Offen" }],
    sprints: [{ id: "sprint", status: "active", scoreLocked: false }],
    commitments: [],
    scores: [],
    strikeStates: [],
    strikeEvents: [],
    objections: [],
    meetings: [],
    attendance: [],
  };
  const patched = sprintWorkspaceReducer(model, { type: "itemPatched", itemId: "item", patch: { status: "Review" } });
  assert.equal(patched.items[0].status, "Review");
  assert.equal(patched.people, model.people);
  assert.equal(patched.sprints, model.sprints);

  const locked = sprintWorkspaceReducer(patched, { type: "sprintLocked", sprintId: "sprint" });
  assert.equal(locked.sprints[0].scoreLocked, true);
  assert.equal(locked.items[0].scoreFinal, true);
});
