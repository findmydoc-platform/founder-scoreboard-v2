import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TaskChildProgress } from "./task-child-progress";

const meta = {
  component: TaskChildProgress,
  args: {
    completed: 3,
    label: "Sub-Issues",
    percentage: 60,
    total: 5,
  },
  decorators: [(Story) => <div className="w-80"><Story /></div>],
  tags: ["domain:tasks", "layer:atom", "status:stable"],
  title: "Features/Tasks/Atoms/TaskChildProgress",
} satisfies Meta<typeof TaskChildProgress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InProgress: Story = {};

export const Complete: Story = {
  args: {
    completed: 5,
    percentage: 100,
  },
};
