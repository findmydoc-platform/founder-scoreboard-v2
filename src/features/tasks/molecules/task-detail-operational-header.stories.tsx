import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { TaskDetailOperationalHeader } from "./task-detail-operational-header";
import { taskDetailStoryTask } from "./task-detail-story-fixtures";

const initiative = taskDetailStoryTask({
  id: "initiative-parent",
  title: "Parent Initiative",
  taskType: "initiative",
});
const deliverable = taskDetailStoryTask({
  id: "deliverable-child",
  title: "Child Deliverable",
  parentTaskId: initiative.id,
});

const meta = {
  component: TaskDetailOperationalHeader,
  decorators: [(Story) => <div className="w-[min(900px,90vw)] bg-white p-5"><Story /></div>],
  tags: ["domain:tasks", "layer:molecule", "status:stable"],
  title: "Features/Tasks/Molecules/TaskDetailOperationalHeader",
  args: {
    task: deliverable,
    initiative,
    profiles: [],
    subIssues: [],
    statusOptions: ["Offen"],
    canChangeStatus: false,
    canManageTaskMeta: false,
    onOpenTask: fn(),
    onUpdate: fn(),
  },
} satisfies Meta<typeof TaskDetailOperationalHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ParentHierarchy: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const parentLink = canvas.getByRole("link", { name: initiative.title });
    await userEvent.click(parentLink);
    await expect(args.onOpenTask).toHaveBeenCalledWith(initiative.id);
  },
};

export const MissingParent: Story = {
  args: {
    task: taskDetailStoryTask({
      id: "deliverable-without-parent",
      title: "Unparented Deliverable",
    }),
    initiative: undefined,
    parentTask: undefined,
  },
};
