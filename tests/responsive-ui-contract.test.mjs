import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(path, "utf8");

test("the application shell keeps tablets compact and restores the desktop sidebar at 1200px", async () => {
  const [globals, sidebar, instructions] = await Promise.all([
    readSource("src/app/globals.css"),
    readSource("src/features/planning/organisms/app-sidebar.tsx"),
    readSource("AGENTS.md"),
  ]);

  assert.match(globals, /@media \(min-width: 1024px\)[\s\S]*padding-left: 4rem/);
  assert.match(globals, /@media \(min-width: 1200px\)[\s\S]*padding-left: 16rem/);
  assert.match(sidebar, /w-16 min-\[1200px\]:w-64/);
  assert.match(sidebar, /useModalDialog<HTMLDivElement>/);
  assert.match(sidebar, /data-autofocus/);
  assert.match(instructions, /desktop experience at `1200px`/);
  assert.match(instructions, /`1234x900`/);
});

test("planning keeps every status directly reachable in a self-contained horizontal board", async () => {
  const board = await readSource("src/features/tasks/organisms/task-board-view.tsx");

  assert.match(board, /overflow-x-auto overscroll-x-contain/);
  assert.match(board, /w-\[min\(82vw,360px\)\] md:max-\[1199px\]:w-\[520px\] min-\[1200px\]:w-\[320px\]/);
  assert.match(board, /isEmpty[\s\S]*\? "w-24"/);
  assert.match(board, /event\.currentTarget\.scrollBy/);
  assert.match(board, /event\.currentTarget\.scrollTo/);
  assert.doesNotMatch(board, /100vw|md:grid-cols-2/);
});

test("mobile planning keeps only a compact command row sticky and moves filters into a dialog sheet", async () => {
  const [appHeader, planningHeader, planningFilters] = await Promise.all([
    readSource("src/features/planning/organisms/app-header.tsx"),
    readSource("src/features/planning/organisms/planning-header.tsx"),
    readSource("src/features/planning/organisms/planning-filters.tsx"),
  ]);

  assert.match(appHeader, /min-\[1200px\]:sticky min-\[1200px\]:top-0/);
  assert.doesNotMatch(appHeader, /lg:sticky lg:top-0/);
  assert.match(planningHeader, /data-mobile-planning-toolbar/);
  assert.match(planningHeader, /sticky z-30/);
  assert.match(planningHeader, /top-10/);
  assert.match(planningHeader, /planning-mobile-filter-trigger/);
  assert.match(planningHeader, /h-12/);
  assert.match(planningFilters, /planning-mobile-filter-sheet/);
  assert.match(planningFilters, /useModalDialog<HTMLDivElement>/);
  assert.match(planningFilters, /max-h-\[min\(88dvh,48rem\)\]/);
  assert.match(planningFilters, /hidden min-\[1200px\]:block/);
  assert.match(planningFilters, /max-width: 1199px/);
});

test("test profile controls remain reachable after the mobile header scrolls away", async () => {
  const [authControl, banner, personas] = await Promise.all([
    readSource("src/features/settings/organisms/auth-control.tsx"),
    readSource("src/features/planning/molecules/test-profile-banner.tsx"),
    readSource("src/features/planning/model/test-profile-personas.ts"),
  ]);

  assert.match(authControl, /Testprofil wechseln/);
  assert.match(authControl, /fixed right-4 top-14 z-\[80\]/);
  assert.match(authControl, /\[@media\(pointer:coarse\)\]:h-11/);
  assert.match(banner, /Testprofil aktiv/);
  assert.match(banner, /Beenden/);
  assert.match(personas, /personaRoleOrder/);
});

test("wide data surfaces support tablet cards while retaining desktop tables", async () => {
  const dataSurface = await readSource("src/shared/molecules/data-surface.tsx");
  assert.match(dataSurface, /mobileContentBreakpoint\?: "lg" \| "xl"/);
  assert.match(dataSurface, /hidden xl:block/);

  const responsiveSurfaces = [
    "src/features/backlog/molecules/backlog-rank-table.tsx",
    "src/features/decision-log/organisms/decision-log-overview.tsx",
    "src/features/projects/organisms/projects-overview.tsx",
    "src/features/sprint/molecules/sprint-meeting-attendance-section.tsx",
    "src/features/sprint/organisms/sprint-founder-score-table.tsx",
    "src/features/sprint/organisms/sprint-task-tables.tsx",
    "src/features/tasks/organisms/task-table-view.tsx",
  ];

  for (const path of responsiveSurfaces) {
    const source = await readSource(path);
    assert.match(source, /mobileContent=/, `${path} must expose a non-table representation`);
    assert.match(source, /mobileContentBreakpoint="xl"/, `${path} must keep cards through tablet widths`);
  }

  const backlogSkeleton = await readSource("src/features/backlog/organisms/backlog-content-skeleton.tsx");
  assert.match(backlogSkeleton, /className="xl:hidden"/);
  assert.match(backlogSkeleton, /className="hidden overflow-x-auto xl:block"/);
});

test("phone and coarse-pointer controls retain practical touch targets", async () => {
  const [globals, taskReference, taskCard, authError] = await Promise.all([
    readSource("src/app/globals.css"),
    readSource("src/features/tasks/atoms/task-reference-link.tsx"),
    readSource("src/features/tasks/molecules/task-card.tsx"),
    readSource("src/app/auth/error/page.tsx"),
  ]);

  assert.match(globals, /@media \(pointer: coarse\)/);
  assert.match(globals, /@media \(max-width: 639px\)/);
  assert.match(globals, /min-height: 2\.75rem/);
  assert.match(globals, /\.coarse-touch-target[\s\S]*min-height: 2\.75rem !important/);
  assert.match(taskReference, /coarse-touch-target/);
  assert.match(taskCard, /coarse-touch-target/);
  assert.match(authError, /h-11[\s\S]*sm:h-10/);
});

test("long management dialogs keep their header, scrolling content, and actions inside a phone viewport", async () => {
  const teamDialog = await readSource("src/features/team/organisms/team-profile-edit-dialog.tsx");

  assert.match(teamDialog, /h-\[100dvh\] max-h-\[100dvh\]/);
  assert.match(teamDialog, /min-h-0 flex-1 gap-4 overflow-y-auto/);
  assert.match(teamDialog, /flex shrink-0 flex-wrap items-center/);
});
