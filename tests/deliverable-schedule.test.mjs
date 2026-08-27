import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const schedule = await loadTranspiledModule(
  "src/features/planning-items/model/deliverable-schedule.ts",
);

const sprints = [{
  id: "sprint-8",
  name: "Sprint 8",
  startDate: "2026-08-24",
  endDate: "2026-09-06",
}];

test("Deliverable schedule derives its execution period only from the assigned Sprint", () => {
  assert.deepEqual(
    schedule.projectDeliverableSchedule({
      sprintId: "sprint-8",
      fixedDate: "2026-09-10",
    }, sprints),
    {
      sprintId: "sprint-8",
      fixedDate: "2026-09-10",
      sprint: sprints[0],
    },
  );

  assert.deepEqual(
    schedule.projectDeliverableSchedule({
      sprintId: null,
      fixedDate: "2026-09-10",
    }, sprints),
    {
      sprintId: null,
      fixedDate: "2026-09-10",
      sprint: null,
    },
  );
});

test("Deliverable fixed dates accept only real ISO calendar dates", () => {
  assert.equal(schedule.normalizeFixedDate("2026-02-28"), "2026-02-28");
  assert.equal(schedule.normalizeFixedDate("2026-02-30"), null);
  assert.equal(schedule.normalizeFixedDate("Sprint 8"), null);
  assert.equal(schedule.normalizeFixedDate(""), null);
  assert.equal(schedule.normalizeFixedDate(null), null);
});
