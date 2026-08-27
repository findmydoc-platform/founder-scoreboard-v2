import assert from "node:assert/strict";
import { test } from "vitest";
import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

test("direct child progress counts only normalized completed children", async () => {
  const presentation = await loadTranspiledModule("src/features/tasks/model/task-card-presentation.ts", {
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
  const presentation = await loadTranspiledModule("src/features/tasks/model/task-card-presentation.ts", {
    "@/lib/status": { normalizeStatus: (status) => status },
  });

  assert.equal(presentation.directChildPluralLabel("epic"), "Initiativen");
  assert.equal(presentation.directChildPluralLabel("initiative"), "Deliverables");
  assert.equal(presentation.directChildPluralLabel("deliverable"), "Sub-Issues");
  assert.equal(presentation.directChildPluralLabel("sub_issue"), "Sub-Issues");
});
