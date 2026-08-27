import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";





test("task detail uses a custom Parent control and GitHub replaces the native parent", async () => {
  const [surface, planningSection, customSelect, syncRoute, github, docs] = await Promise.all([
    readFile("src/features/tasks/organisms/task-detail-surface.tsx", "utf8"),
    readFile("src/features/tasks/molecules/task-detail-planning-section.tsx", "utf8"),
    readFile("src/shared/atoms/custom-select.tsx", "utf8"),
    readFile("src/lib/github-sync/task-projection.ts", "utf8"),
    readFile("src/lib/github.ts", "utf8"),
    readFile("docs/planning-hierarchy.md", "utf8"),
  ]);

  assert.match(surface, /canReparentSubIssue=\{controller\.permissions\.canReparentSubIssue\}/);
  assert.match(planningSection, /label="Parent-Deliverable"/);
  assert.match(planningSection, /parentDeliverableOptions\(allTasks\)/);
  assert.match(planningSection, /Unter einem nicht freigegebenen Deliverable bleibt dieses Sub-Issue inaktiv/);
  assert.doesNotMatch(planningSection, /<select\b|<option\b/);
  assert.match(customSelect, /role="listbox"/);
  assert.match(syncRoute, /connectGitHubSubIssue/);
  assert.match(github, /replaceParent: true/);
  assert.match(docs, /next explicit GitHub sync replaces the native parent relationship/);
});
