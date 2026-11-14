import { expect, test, vi } from "vitest";
import fixture from "../../fixtures/planning-reads/contract.json";
import { DEFAULT_PLANNING_FILTERS } from "@/features/planning/model/planning-board-query";
import { buildPlanningTaskTableViewModel } from "@/features/planning/model/planning-task-table-view-model";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { groupDirectChildrenByParent, taskChildProgress } from "@/features/tasks/model/task-card-presentation";
import { sprintObjectionWindowState } from "@/lib/sprint-review-window";
import { isActiveDeputy, taskBelongsToProfile } from "@/lib/platform";
import type { PlanningFilterPreferences, PlanningShellState, Profile, Task } from "@/lib/types";

function completeFixture(): PlanningShellState {
  return {
    ...emptyPlanningShellState,
    profiles: fixture.profiles.map(profile => ({ orgRole: "", githubLogin: "", weeklyCapacity: 20, ...profile })) as Profile[],
    tasks: fixture.tasks.map(task => ({ ...fixture.taskDefaults, ...task })) as Task[],
    sprints: fixture.sprints as PlanningShellState["sprints"],
    taskRelations: fixture.relationships as PlanningShellState["taskRelations"],
  };
}
function selectedIds(data: PlanningShellState, filters: Partial<PlanningFilterPreferences>) {
  return buildPlanningTaskTableViewModel({
    data, currentProfile: data.profiles[0], includeAssignedSubIssueParents: true,
    filters: { ...DEFAULT_PLANNING_FILTERS, ...filters },
  }).visibleTasks.filter(task => task.taskType === "deliverable").map(task => task.id);
}

test.each(fixture.searchCases)("complete authorized fixture preserves $name", ({ filters, ids }) => {
  expect(selectedIds(completeFixture(), filters as Partial<PlanningFilterPreferences>)).toEqual(ids);
});

test("the final qualifying child completing removes only personal parent inclusion", () => {
  const data = completeFixture();
  data.tasks = data.tasks.map(task => task.id === "fixture-child-open" ? { ...task, status: "Erledigt" } : task);
  expect(selectedIds(data, { quick: ["mine"] })).toEqual(fixture.expected.personalAfterFinalChildCompletes);
});

test.each(Object.entries(fixture.expected.directChildProgress))("%s progress counts direct children and excludes grandchildren", (parentId, expected) => {
  const children = groupDirectChildrenByParent(completeFixture().tasks);
  expect(taskChildProgress(children.get(parentId) || [])).toEqual(expected);
});

test("week selection uses the controlled evaluation time without treating unscheduled or future work as current", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(fixture.evaluationTime));
  try {
    const ids = selectedIds(completeFixture(), { quick: ["week"] });
    expect(ids).toEqual(expect.arrayContaining(fixture.expected.weekIncluded));
    for (const id of fixture.expected.weekExcluded) expect(ids).not.toContain(id);
  } finally { vi.useRealTimers(); }
});

test("deputy authority expires by date without requiring a source write", () => {
  const { activeFrom, activeUntil, atDate, nextDate } = fixture.expected.deputy;
  const deputy = { platformRole: "deputy" as const, deputyFor: "fixture-reviewer", deputyActiveFrom: activeFrom, deputyActiveUntil: activeUntil };
  expect(isActiveDeputy(deputy, "2026-11-13")).toBe(atDate);
  expect(isActiveDeputy(deputy, "2026-11-14")).toBe(nextDate);
});

test("objection validity expires after its inclusive deadline without a write", () => {
  const { endDate, dueAt, atDeadline, afterDeadline } = fixture.expected.objectionWindow;
  expect(sprintObjectionWindowState(endDate, dueAt, new Date("2026-11-13T12:00:00Z")).open).toBe(atDeadline);
  expect(sprintObjectionWindowState(endDate, dueAt, new Date("2026-11-13T12:00:00.001Z")).open).toBe(afterDeadline);
});

test.each(fixture.ownershipCases)("ownership preserves $name", ({ task, belongs }) => {
  expect(taskBelongsToProfile(task, fixture.profiles[0])).toBe(belongs);
});
