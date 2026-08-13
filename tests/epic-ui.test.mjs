import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

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

test("epic UI exposes the bounded creation contract and saved schedule metadata", async () => {
  const [header, dialog, overview] = await Promise.all([
    read("src/features/planning/organisms/planning-header.tsx"),
    read("src/features/projects/organisms/epic-dialog.tsx"),
    read("src/features/projects/organisms/projects-overview.tsx"),
  ]);

  assert.match(header, /aria-disabled=\{action\.disabled \|\| undefined\}/);
  assert.match(header, /if \(!action\.disabled\) action\.onClick\(\)/);
  assert.match(dialog, /required/);
  assert.match(dialog, /minLength=\{3\}/);
  assert.match(dialog, /Der Titel benötigt mindestens 3 Zeichen/);
  assert.match(dialog, /titleError &&/);
  assert.match(dialog, /Pflichtfeld/);
  assert.match(dialog, /aria-label="Meilenstein-Dialog schließen"/);
  assert.match(dialog, /h-11 w-11/);
  assert.match(dialog, /overflow-y-auto/);
  assert.match(dialog, /Meilenstein erstellen/);
  assert.ok(dialog.indexOf("Zieltermin") < dialog.indexOf("Status</span>"));
  assert.match(overview, /epicStatusMeta/);
  assert.match(overview, /Zieltermin:/);
});
