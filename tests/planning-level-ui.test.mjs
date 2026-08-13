import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

test("planning creation labels and header actions follow the active level", async () => {
  const planningLevel = await loadTranspiledModule("src/features/planning/model/planning-level.ts");
  const { usePlanningHeaderActions } = await loadTranspiledModule(
    "src/features/planning/hooks/use-planning-header-actions.ts",
    {
      "@/features/planning/model/planning-level": planningLevel,
      "@/features/planning/model/planning-app-model": {
        epicPlanningItems: (tasks) => tasks.filter((item) => item.taskType === "epic"),
      },
      "@/features/projects/model/epic-policy": {
        canManageEpics: () => false,
      },
    },
  );
  const opened = [];
  const baseOptions = {
    currentProfile: null,
    data: { tasks: [] },
    setInitiativeDialogDefaults: () => {},
    setEpicDialogDefaults: () => {},
    setTaskDialogDefaults: (defaults) => opened.push(defaults),
    workspace: "planning",
  };

  assert.equal(planningLevel.planningLevelCreateLabel("epic"), "Neues Epic");
  assert.equal(planningLevel.planningLevelCreateLabel("initiative"), "Neue Initiative");
  assert.equal(planningLevel.planningLevelCreateLabel("deliverable"), "Neues Deliverable");

  const initiativeAction = usePlanningHeaderActions({
    ...baseOptions,
    planningLevel: "initiative",
    view: "board",
  })[0];
  assert.equal(initiativeAction.label, "Neue Initiative");
  initiativeAction.onClick();
  assert.deepEqual(opened.pop(), { taskType: "initiative" });

  const deliveryOnlyAction = usePlanningHeaderActions({
    ...baseOptions,
    planningLevel: "initiative",
    view: "table",
  })[0];
  assert.equal(deliveryOnlyAction.label, "Neues Deliverable");
  deliveryOnlyAction.onClick();
  assert.deepEqual(opened.pop(), { taskType: "deliverable" });
});
