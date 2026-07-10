import { readPlanningSurface } from "./helpers/planning-surface.mjs";
import test from "node:test";
import assert from "node:assert/strict";

test("task updates keep the protected planning cache aligned across detail-route remounts", async () => {
  const ui = await readPlanningSurface();

  assert.match(ui, /const applyPlanningDataUpdate = useCallback/);
  assert.match(
    ui,
    /setProtectedPlanningDataCache\(\{\s*authUserId: authUser\.id,\s*data: nextData,\s*headerData,\s*currentProfile: serverCurrentProfile,\s*\}\)/s,
  );
  assert.match(
    ui,
    /const updateTask = \(task: Task, patch: Partial<Task>\) => \{[\s\S]*applyPlanningDataUpdate\(\(current\) => \{/,
  );
  assert.match(
    ui,
    /if \(body\?\.activities\?\.length\) \{[\s\S]*applyPlanningDataUpdate\(\(current\) => \(\{/,
  );
});
