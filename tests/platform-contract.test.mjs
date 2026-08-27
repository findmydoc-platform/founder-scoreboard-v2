import { readFile } from "node:fs/promises";
import { readPlanningSurface } from "./helpers/planning-surface.mjs";
import test from "node:test";
import assert from "node:assert/strict";

test("working status stays ownership-bound while Sub-Issue final transitions are role-based", async () => {
  const route = await readFile("src/features/planning-items/model/planning-items-browser-task-update.ts", "utf8");
  const routeHelpers = await readFile("src/features/tasks/model/task-route-update-helpers.ts", "utf8");
  const routePolicy = `${route}\n${routeHelpers}`;
  const app = await readPlanningSurface();
  const taskCard = await readFile("src/features/tasks/molecules/task-card.tsx", "utf8");
  const detailPanel = await readFile("src/features/tasks/organisms/task-detail-panel.tsx", "utf8");
  const detailSurface = await readFile("src/features/tasks/organisms/task-detail-surface.tsx", "utf8");
  const detailPermissions = await readFile("src/features/tasks/model/task-detail-permissions.ts", "utf8");
  const operationalHeader = await readFile("src/features/tasks/molecules/task-detail-operational-header.tsx", "utf8");
  const statusControl = await readFile("src/features/tasks/atoms/task-status-control.tsx", "utf8");

  assert.match(routePolicy, /taskAssignedToProfile/);
  assert.match(routePolicy, /Founder können nur den Status ihrer eigenen Aufgaben ändern/);
  assert.match(routePolicy, /roleBasedFinalTransition/);
  assert.match(routePolicy, /validateSubIssueStatusParentApproval/);
  assert.match(app, /canChangeTaskStatus/);
  assert.match(app, /canManageFinalTaskStatus/);
  assert.match(app, /taskBelongsToProfile\(task, currentProfile\)/);
  assert.match(app, /onDragStart=\{canUpdateStatus && onDragStart \? onDragStart : undefined\}/);
  assert.doesNotMatch(taskCard, /TaskStatusControl|statusDisabled/);
  assert.match(detailPanel, /TaskDetailSurface/);
  assert.match(detailSurface, /permissions\.canUpdateStatus/);
  assert.match(detailSurface, /permissions\.canCompleteSubIssue/);
  assert.match(detailSurface, /permissions\.canReopenSubIssue/);
  assert.match(detailPermissions, /taskOwnedByProfile/);
  assert.match(detailPermissions, /canContributorManageSubIssueFinalStatus/);
  assert.match(operationalHeader, /TaskStatusControl/);
  assert.match(detailSurface, /taskStatusOptionsForPermissions/);
  assert.match(statusControl, /lockedReason/);
  assert.match(statusControl, /isTaskStatusChange/);
});

test("header overlays and modals close without leaking focus or background interaction", async () => {
  const notifications = await readFile("src/features/notifications/organisms/notification-inbox.tsx", "utf8");
  const calendarAction = await readFile("src/features/planning/molecules/header-calendar-action.tsx", "utf8");
  const calendarDialog = await readFile("src/features/planning/organisms/header-calendar-dialog.tsx", "utf8");
  const modalDialog = await readFile("src/shared/hooks/use-modal-dialog.ts", "utf8");

  assert.match(notifications, /rootRef/);
  assert.match(notifications, /pointerdown/);
  assert.match(notifications, /keydown/);
  assert.match(notifications, /href="\/notifications"/);
  assert.match(calendarAction, /createPortal/);
  assert.match(calendarDialog, /useModalDialog/);
  assert.match(calendarDialog, /manageEnvironment: !desktopPopover/);
  assert.match(calendarDialog, /aria-modal=\{desktopPopover \? undefined : "true"\}/);
  assert.match(modalDialog, /Escape/);
});
