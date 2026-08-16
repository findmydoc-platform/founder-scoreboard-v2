import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

test("fullscreen task detail keeps auth bootstrap input stable across local renders", async () => {
  const page = await readFile("src/features/tasks/templates/task-detail-page.tsx", "utf8");

  assert.match(page, /useMemo\(\(\) => taskDetailModelToPlanningShellState\(initialModel\), \[initialModel\]\)/);
  assert.match(page, /initialData,/);
  assert.doesNotMatch(page, /initialData:\s*taskDetailModelToPlanningShellState\(/);
});
