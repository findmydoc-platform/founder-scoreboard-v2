import assert from "node:assert/strict";
import { test } from "vitest";
import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

test("project header exposes ordered epic actions only to allowed roles", async () => {
  const { usePlanningHeaderActions } = await loadTranspiledModule(
    "src/features/planning/hooks/use-planning-header-actions.ts",
    {
      "@/features/planning/model/planning-level": {
        planningLevelCreateLabel: (level) => level === "initiative" ? "Neue Initiative" : `Neues ${level === "epic" ? "Epic" : "Deliverable"}`,
      },
      "@/features/planning/model/planning-app-model": {
        epicPlanningItems: (tasks) => tasks.filter((item) => item.taskType === "epic"),
      },
      "@/features/projects/model/epic-policy": {
        canManageEpics: (role, source) => source === "seed" || role === "ceo" || role === "deputy",
      },
    },
  );
  const opened = [];
  const options = {
    currentProfile: { platformRole: "ceo" },
    data: { tasks: [] },
    setInitiativeDialogDefaults: (value) => opened.push(["initiative", value]),
    setEpicDialogDefaults: (value) => opened.push(["epic", value]),
    setTaskDialogDefaults: () => {},
    source: "supabase",
    workspace: "projects",
  };

  const emptyActions = usePlanningHeaderActions(options);
  assert.deepEqual(emptyActions.map((action) => action.id), ["new-epic", "new-initiative"]);
  assert.equal(emptyActions[0].variant, "primary");
  assert.equal(emptyActions[1].disabled, true);
  assert.equal(emptyActions[1].disabledReason, "Lege zuerst einen Meilenstein an.");
  emptyActions[0].onClick();
  assert.deepEqual(opened, [["epic", {}]]);

  const populatedActions = usePlanningHeaderActions({
    ...options,
    data: { tasks: [{ id: "m1", taskType: "epic" }] },
  });
  assert.equal(populatedActions[1].disabled, false);

  assert.deepEqual(usePlanningHeaderActions({
    ...options,
    currentProfile: { platformRole: "founder" },
  }), []);
});
