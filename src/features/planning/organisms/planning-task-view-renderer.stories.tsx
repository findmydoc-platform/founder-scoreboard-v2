import { useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { DEFAULT_PLANNING_FILTERS } from "@/features/planning/hooks/use-planning-view-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { ViewMode } from "@/lib/types";
import { createPlanningState } from "../model/internal/planning-state-owner";
import { normalizePlanningGanttQuery, planningGanttQueryKey } from "../model/planning-gantt-query";
import { emptyPlanningShellState } from "../model/planning-shell-state";
import { PlanningTaskViewRenderer } from "./planning-task-view-renderer";

const initiative = taskDetailStoryTask({ id: "initiative-1", title: "Lazy view initiative", taskType: "initiative" });
const deliverable = taskDetailStoryTask({ id: "deliverable-1", title: "Lazy view deliverable", parentTaskId: initiative.id });
const tasks = [initiative, deliverable];
const ganttQuery = normalizePlanningGanttQuery({ view: "gantt", filters: DEFAULT_PLANNING_FILTERS })!;
const emptyGantt = {
  readStatus: "current",
  selection: {
    query: ganttQuery,
    queryKey: planningGanttQueryKey(ganttQuery),
    itemIds: [],
    contextIds: [],
    total: 0,
    sourceRevision: "1",
    observedAt: "2026-11-18T00:00:00Z",
    temporalKey: "fixed",
    validUntil: null,
    coverage: { items: "complete", hierarchy: "complete", schedule: "complete", relationships: "complete" },
  },
  tasks: [],
  items: [],
  sprints: [],
  relationships: [],
} satisfies ReturnType<PlanningAppController["planningState"]["gantt"]>;

function StoryRenderer() {
  const [owner] = useState(() => createPlanningState({ userId: "deferred-views", initialData: { ...emptyPlanningShellState, tasks }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null } }));
  const data = useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
  const [view, setView] = useState<ViewMode>("board");
  const openTaskPanel = () => undefined;
  const controller = {
    canChangeTaskStatus: () => false,
    canManageFinalTaskStatus: false,
    canManageTaskMeta: false,
    planningState: owner.planning,
    data,
    dragOverStatus: null,
    draggedTaskId: null,
    expandedInitiatives: {},
    filters: DEFAULT_PLANNING_FILTERS,
    filtersAvailable: true,
    openTaskPanel,
    startTaskPanel: openTaskPanel,
    planningLevel: "deliverable",
    planningParentFilterId: "all",
    selectedTaskId: null,
    setAllInitiativeCollapse: () => undefined,
    setFilters: () => undefined,
    setTaskDialogDefaults: () => undefined,
    setView,
    toggleInitiativeCollapse: () => undefined,
    updateTask: () => undefined,
    view,
    selectedGantt: view === "gantt" ? emptyGantt : undefined,
    ganttReady: view === "gantt",
    viewerOpenSubIssueIdsByDeliverableId: {},
    visibleTasks: view === "gantt" ? [] : tasks,
  } as unknown as PlanningAppController;

  return (
    <>
      <nav aria-label="Testansichten" className="flex gap-2">
        <button onClick={() => setView("structure")}>Struktur öffnen</button>
        <button onClick={() => setView("table")}>Tabelle öffnen</button>
        <button onClick={() => setView("gantt")}>Gantt öffnen</button>
      </nav>
      <PlanningTaskViewRenderer controller={controller} />
    </>
  );
}

const meta = {
  component: StoryRenderer,
  title: "Planning/Organisms/PlanningTaskViewRenderer",
  tags: ["layer:organism", "status:stable"],
} satisfies Meta<typeof StoryRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LoadsEveryDeferredView: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Struktur öffnen" }));
    await expect(await canvas.findByRole("button", { name: "Alle einklappen" }, { timeout: 5_000 })).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Tabelle öffnen" }));
    await expect(await canvas.findByRole("combobox", { name: "Zuständigkeit für Lazy view deliverable ändern" }, { timeout: 5_000 })).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Gantt öffnen" }));
    await expect(await canvas.findByText("Aufgabe", {}, { timeout: 5_000 })).toBeInTheDocument();
  },
};
