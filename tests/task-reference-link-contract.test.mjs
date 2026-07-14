import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const primaryReferenceFiles = [
  "src/features/tasks/molecules/task-card.tsx",
  "src/features/tasks/organisms/task-table-view.tsx",
  "src/features/tasks/organisms/gantt-view.tsx",
  "src/features/backlog/molecules/backlog-rank-table.tsx",
  "src/features/projects/organisms/projects-overview.tsx",
  "src/features/reviews/organisms/review-workspace-overview.tsx",
  "src/features/reviews/organisms/task-review-sheet.tsx",
  "src/features/sprint/organisms/sprint-task-tables.tsx",
  "src/features/tasks/organisms/task-github-sync-queue.tsx",
  "src/features/notifications/organisms/notification-inbox.tsx",
  "src/features/notifications/organisms/notifications-overview.tsx",
  "src/features/tasks/molecules/task-detail-panel-sub-issues-section.tsx",
  "src/features/tasks/molecules/relationship-list.tsx",
];

test("primary saved task references share the canonical quick-view link", async () => {
  const link = await readFile("src/features/tasks/atoms/task-reference-link.tsx", "utf8");

  assert.match(link, /href=\{`\/tasks\/\$\{encodeURIComponent\(task\.id\)\}`\}/);
  assert.match(link, /aria-haspopup=\{onOpenTask \? "dialog" : undefined\}/);
  assert.match(link, /cursor-pointer/);
  assert.match(link, /hover:underline/);
  assert.match(link, /focus-visible:underline/);
  assert.match(link, /event\.preventDefault\(\)/);

  for (const file of primaryReferenceFiles) {
    const source = await readFile(file, "utf8");
    assert.match(source, /TaskReferenceLink/, `${file} must use TaskReferenceLink`);
  }
});

test("non-interactive task text stays static in intent-free contexts", async () => {
  const files = [
    "src/features/planning/organisms/status-guard-dialog.tsx",
    "src/features/intake/organisms/ceo-task-intake.tsx",
    "src/features/tasks/organisms/new-task-dialog.tsx",
  ];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /TaskReferenceLink/, `${file} must not add quick-view links`);
  }
});

test("drawer focus navigation and full-page overlay remain available", async () => {
  const header = await readFile("src/features/tasks/molecules/task-detail-panel-header.tsx", "utf8");
  const panel = await readFile("src/features/tasks/organisms/task-detail-panel.tsx", "utf8");
  const surface = await readFile("src/features/tasks/organisms/task-detail-surface.tsx", "utf8");
  const taskPage = await readFile("src/features/tasks/templates/task-detail-page.tsx", "utf8");
  const reviewShell = await readFile("src/features/planning/templates/planning-app-shell.tsx", "utf8");

  assert.match(header, /data-autofocus/);
  assert.doesNotMatch(header, /titleRef\.current\?\.focus\(\)/);
  assert.match(header, /Zurück zu/);
  assert.match(header, /Große Ansicht/);
  assert.match(panel, /aria-labelledby="task-detail-panel-title"/);
  assert.match(panel, /overflow-hidden/);
  assert.match(surface, /overflow-y-auto overscroll-contain/);
  assert.match(panel, /onOverviewDirtyChange/);
  assert.match(taskPage, /PlanningOverlayLayer/);
  assert.match(reviewShell, /ReviewDetailPage/);
  assert.match(reviewShell, /PlanningOverlayLayer/);
});

test("FounderOps tasks and GitHub issues use unambiguous labels", async () => {
  const files = [
    "src/features/tasks/molecules/task-card.tsx",
    "src/features/tasks/organisms/task-github-sync-queue.tsx",
    "src/features/tasks/organisms/task-detail-panel-sidebar.tsx",
  ];

  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(source, /Kein Issue/);
  assert.match(source, /Kein GitHub Issue/);
  assert.match(source, /GitHub Issue/);
});
