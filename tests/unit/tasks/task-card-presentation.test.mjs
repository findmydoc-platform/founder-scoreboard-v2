import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

test("direct child progress counts only normalized completed children", async () => {
  const presentation = await importTestModule("src/features/tasks/model/task-card-presentation.ts", {
    "@/lib/status": {
      normalizeStatus: (status) => status === "done" ? "Erledigt" : status,
    },
  });

  assert.deepEqual(
    presentation.taskChildProgress([
      { status: "Erledigt" },
      { status: "done" },
      { status: "In Arbeit" },
      { status: "Blockiert" },
    ]),
    { completed: 2, percentage: 50, total: 4, unfinished: 2 },
  );
  assert.deepEqual(
    presentation.taskChildProgress([]),
    { completed: 0, percentage: 0, total: 0, unfinished: 0 },
  );
});

test("direct child labels follow the planning hierarchy", async () => {
  const presentation = await importTestModule("src/features/tasks/model/task-card-presentation.ts", {
    "@/lib/status": { normalizeStatus: (status) => status },
  });

  assert.equal(presentation.directChildPluralLabel("epic"), "Initiativen");
  assert.equal(presentation.directChildPluralLabel("initiative"), "Deliverables");
  assert.equal(presentation.directChildPluralLabel("deliverable"), "Sub-Issues");
  assert.equal(presentation.directChildPluralLabel("sub_issue"), "Sub-Issues");
});

test("task card resolves the assignee by stable profile id before display name", async () => {
  const presentation = await importTestModule("src/features/tasks/model/task-card-presentation.ts", {
    "@/lib/status": { normalizeStatus: (status) => status },
  });
  const profiles = [
    { id: "first", name: "Ada" },
    { id: "second", name: "Ben" },
  ];
  assert.equal(presentation.taskAssigneeProfile({ assigneeId: "second", assignee: "Ada" }, profiles), profiles[1]);
  assert.equal(presentation.taskAssigneeProfile({ assigneeId: "missing", assignee: "Ada" }, profiles), undefined);
  assert.equal(presentation.taskAssigneeProfile({ assigneeId: "", assignee: "Ada" }, profiles), profiles[0]);
  assert.equal(presentation.taskAssigneeProfile({ assigneeId: "", assignee: "" }, profiles), undefined);
});
