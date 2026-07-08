import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

test("display helpers preserve shared labels and date formatting", async () => {
  const display = await loadTranspiledModule("src/lib/display.ts");
  const profiles = [{ id: "volkan", name: "Volkan" }];

  assert.equal(display.unassignedAssigneeLabel, "Nicht zugeordnet");
  assert.equal(display.taskAssigneeLabel({ assignee: "" }), "Nicht zugeordnet");
  assert.equal(display.taskAssigneeLabel({ assignee: "Volkan" }), "Volkan");
  assert.deepEqual(display.taskAssigneeOptions("proposal", profiles), [
    { value: "", label: "Nicht zugeordnet" },
    { value: "volkan", label: "Volkan" },
  ]);
  assert.deepEqual(display.taskAssigneeOptions("deliverable", profiles), [
    { value: "volkan", label: "Volkan" },
  ]);

  assert.equal(display.initiativeOptionLabel({ title: "Initiative A" }), "Initiative A");
  assert.equal(display.relationTypeLabel("blocked_by"), "Wartet auf");
  assert.equal(display.relationTypeLabel("blocks"), "Blockiert");
  assert.equal(display.relationTypeLabel("relates_to"), "Verknüpft mit");
  assert.equal(display.focusStatusLabel("needs_decision"), "Entscheidung nötig");
  assert.match(display.relationshipHelpText("Wartet auf"), /sauber weitergehen/);

  const dateWithoutYear = display.formatDate("2026-06-09");
  const dateWithYear = display.formatDate("2026-06-09", { includeYear: true });
  assert.match(dateWithoutYear, /09/);
  assert.doesNotMatch(dateWithoutYear, /2026/);
  assert.match(dateWithYear, /2026/);
  assert.equal(display.formatDate(""), "ohne Datum");
  assert.equal(display.formatDate("not-a-date"), "not-a-date");

  const range = display.dateRange({ startDate: "2026-06-09", endDate: "2026-06-10", deadline: "" });
  assert.match(range, /09/);
  assert.match(range, /10/);
  assert.equal(display.dateRange({ startDate: "", endDate: "", deadline: "2026-06-30" }), "2026-06-30");
});
