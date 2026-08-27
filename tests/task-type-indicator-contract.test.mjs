import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("item types keep the approved icon and color contract across planning surfaces", async () => {
  const indicator = await readFile("src/features/tasks/atoms/task-type-indicator.tsx", "utf8");
  const select = await readFile("src/shared/atoms/custom-select.tsx", "utf8");
  const levelSelect = await readFile("src/features/planning/molecules/planning-level-select.tsx", "utf8");
  const taskCard = await readFile("src/features/tasks/molecules/task-card.tsx", "utf8");
  const taskStructure = await readFile("src/features/tasks/organisms/task-structure-view.tsx", "utf8");
  const taskDetailHeader = await readFile("src/features/tasks/molecules/task-detail-operational-header.tsx", "utf8");
  const backlogTree = await readFile("src/features/backlog/molecules/planning-backlog-tree.tsx", "utf8");
  const newTaskDialog = await readFile("src/features/tasks/organisms/new-task-dialog.tsx", "utf8");

  assert.match(indicator, /epic:\s*\{[\s\S]*?Icon: Target,[\s\S]*?text-orange-600[\s\S]*?label: "Epic"/);
  assert.match(indicator, /initiative:\s*\{[\s\S]*?Icon: Route,[\s\S]*?text-violet-600[\s\S]*?label: "Initiative"/);
  assert.match(indicator, /deliverable:\s*\{[\s\S]*?Icon: PackageCheck,[\s\S]*?text-green-600[\s\S]*?label: "Deliverable"/);
  assert.match(indicator, /sub_issue:\s*\{[\s\S]*?Icon: SquareCheckBig,[\s\S]*?text-yellow-600[\s\S]*?label: "Sub-Issue"/);

  assert.match(select, /icon\?: ReactNode/);
  assert.match(select, /selectedOption\?\.icon/);
  assert.match(levelSelect, /icon: <TaskTypeIcon taskType=\{level\.value\}/);
  assert.match(taskCard, /<TaskTypeIcon taskType=\{task\.taskType\}/);
  assert.match(taskStructure, /<TaskTypeIcon taskType=\{initiative\.taskType\}/);
  assert.match(taskDetailHeader, /<TaskTypeIndicator taskType=\{task\.taskType\}/);
  assert.match(backlogTree, /<TaskTypeIndicator taskType=\{task\.taskType\}/);
  assert.match(newTaskDialog, /<TaskTypeIcon taskType=\{draft\.taskType\}/);
});
