import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
  return readFile(path, "utf8");
}

test("overview editing uses a stable baseline and a safe discard dialog", async () => {
  const [controller, overview, surface, guard, dialog, page, panel, sidebar] = await Promise.all([
    read("src/features/tasks/hooks/use-task-detail-controller.ts"),
    read("src/features/tasks/organisms/task-overview-panel.tsx"),
    read("src/features/tasks/organisms/task-detail-surface.tsx"),
    read("src/features/tasks/hooks/use-task-discard-guard.ts"),
    read("src/features/tasks/molecules/task-discard-changes-dialog.tsx"),
    read("src/features/tasks/templates/task-detail-page.tsx"),
    read("src/features/tasks/organisms/task-detail-panel.tsx"),
    read("src/features/planning/organisms/app-sidebar.tsx"),
  ]);

  assert.match(controller, /overviewBaseline/);
  assert.match(controller, /taskOverviewPatch\(overviewBaseline/);
  assert.match(overview, /value\.trim\(\) !== \(baseline\.evidenceLinks\[index\] \|\| ""\)\.trim\(\)/);
  assert.match(overview, /Leere Felder werden nicht gespeichert/);
  assert.match(overview, /öffnet in neuem Tab/);
  assert.doesNotMatch(surface, /window\.confirm/);
  assert.match(surface, /onRequestDiscardAction\(action, true\)/);
  assert.match(dialog, /role="alertdialog"/);
  assert.match(dialog, /Weiter bearbeiten/);
  assert.match(dialog, /Änderungen verwerfen/);
  assert.match(guard, /pendingActionRef/);
  assert.match(page, /onRequestNavigation/);
  assert.match(panel, /onRequestFullPage/);
  assert.match(sidebar, /onNavigate/);
});

test("detail data failure stays visible without false empty states", async () => {
  const [loader, surface, dependencyBand, blocker, relationships, timeline] = await Promise.all([
    read("src/features/tasks/hooks/use-task-detail-data-loader.ts"),
    read("src/features/tasks/organisms/task-detail-surface.tsx"),
    read("src/features/tasks/molecules/task-detail-operational-header.tsx"),
    read("src/features/tasks/molecules/task-detail-panel-blocker-section.tsx"),
    read("src/features/tasks/organisms/task-relationships-section.tsx"),
    read("src/features/tasks/molecules/task-comment-timeline.tsx"),
  ]);

  assert.match(loader, /selectedTaskNeedsLoad && \(!selectedStateMatches \|\| loadState\.loading\)/);
  assert.match(surface, /TaskDetailDependencyBand/);
  assert.match(surface, /detailDataUnavailable/);
  assert.match(dependencyBand, /Zusätzliche Item-Daten konnten nicht geladen werden/);
  assert.match(blocker, /unavailable && blockers\.length === 0/);
  assert.match(relationships, /relationshipDataReady/);
  assert.match(timeline, /!unavailable/);
  assert.doesNotMatch(surface, /subIssues=\{subIssues\}[\s\S]{0,120}loading=\{detailDataLoading\}/);
});

test("relationships and blockers wait for confirmed mutations", async () => {
  const [commands, surface, blocker, relationshipSection, relationshipModel] = await Promise.all([
    read("src/features/tasks/hooks/use-task-collaboration-commands.ts"),
    read("src/features/tasks/organisms/task-detail-surface.tsx"),
    read("src/features/tasks/molecules/task-detail-panel-blocker-section.tsx"),
    read("src/features/tasks/organisms/task-relationships-section.tsx"),
    read("src/features/tasks/model/task-detail-state.ts"),
  ]);

  assert.match(commands, /Promise<TaskActionResult>/);
  assert.match(commands, /resolve\(\{ ok: false, error \}\)/);
  assert.match(blocker, /if \(!result\.ok\)/);
  assert.match(blocker, /onBlockerDraftChange\(\{ reason: "", impact: "", needsHelpFrom: "" \}\)/);
  assert.match(relationshipSection, /if \(!result\.ok\)/);
  assert.match(relationshipSection, /onUpdateLegacyDependsOn/);
  assert.match(surface, /if \(result\.ok\)/);
  assert.match(relationshipModel, /directionalTaskIds/);
});

test("conditional tabs, visible lock reasons, and modal scrolling preserve hierarchy", async () => {
  const [surface, tabs, tabModel, status] = await Promise.all([
    read("src/features/tasks/organisms/task-detail-surface.tsx"),
    read("src/features/tasks/molecules/task-detail-tabs.tsx"),
    read("src/features/tasks/model/task-detail-tabs-model.ts"),
    read("src/features/tasks/atoms/task-status-control.tsx"),
  ]);

  assert.match(surface, /availableTabs=\{availableTabs\}/);
  assert.match(surface, /overflow-y-auto overscroll-contain/);
  assert.match(tabs, /renderedTabs/);
  assert.match(tabs, /resolveTaskDetailTab/);
  assert.match(tabModel, /if \(subIssueCount > 0 \|\| canCreateSubIssue\)/);
  assert.match(status, /aria-describedby=\{reasonId\}/);
  assert.match(status, /\{reason\}/);
});
