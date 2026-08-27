import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { Sprint } from "@/lib/types";
import { TaskDetailPlanningSection } from "./task-detail-planning-section";
import { taskDetailStoryTask } from "./task-detail-story-fixtures";

const meta = {
  component: TaskDetailPlanningSection,
  decorators: [(Story) => <div className="w-[min(900px,90vw)] bg-white px-5"><Story /></div>],
  tags: ["domain:tasks", "layer:molecule", "status:stable"],
  title: "Features/Tasks/Molecules/TaskDetailPlanningSection",
  args: {
    teamProfiles: [],
    canManageTaskMeta: false,
    canReparentSubIssue: false,
    pending: false,
    onUpdate: fn(),
  },
} satisfies Meta<typeof TaskDetailPlanningSection>;

export default meta;
type Story = StoryObj<typeof meta>;

const epic = taskDetailStoryTask({
  id: "epic-parent",
  title: "Unique Parent Epic",
  taskType: "epic",
});
const initiative = taskDetailStoryTask({
  id: "initiative-child",
  title: "Initiative",
  taskType: "initiative",
  parentTaskId: epic.id,
  targetDate: "2026-08-30",
});

export const InitiativeHierarchy: Story = {
  args: {
    task: initiative,
    allTasks: [epic, initiative],
    sprints: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(epic.title)).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Einordnung anzeigen" }));
    await expect(canvas.getByText(epic.title)).toBeVisible();
  },
};

const parentInitiative = taskDetailStoryTask({
  id: "initiative-parent",
  title: "Unique Parent Initiative",
  taskType: "initiative",
});
const deliverable = taskDetailStoryTask({
  id: "deliverable-child",
  title: "Deliverable",
  parentTaskId: parentInitiative.id,
  sprintId: "sprint-1",
});
const sprint: Sprint = {
  id: "sprint-1",
  name: "Sprint 1",
  status: "active",
  startDate: "2026-06-02",
  endDate: "2026-06-04",
  reviewDueAt: "2026-06-05T10:00:00.000Z",
  scoreLocked: false,
};

export const DeliverableHierarchy: Story = {
  args: {
    task: deliverable,
    allTasks: [parentInitiative, deliverable],
    sprints: [sprint],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Sprint 1")).toBeVisible();
    await expect(canvas.getByText("02.–04. Juni")).toBeVisible();
    await expect(canvas.queryByText(parentInitiative.title)).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Planung anzeigen" }));
    await expect(canvas.getByText(parentInitiative.title)).toBeVisible();
  },
};
