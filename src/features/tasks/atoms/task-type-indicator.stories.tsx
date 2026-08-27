import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TaskTypeIndicator } from "./task-type-indicator";

function TaskTypeCatalog() {
  return (
    <div className="grid gap-3 text-sm">
      <TaskTypeIndicator taskType="epic" />
      <TaskTypeIndicator taskType="initiative" />
      <TaskTypeIndicator taskType="deliverable" />
      <TaskTypeIndicator taskType="sub_issue" />
    </div>
  );
}

const meta = {
  component: TaskTypeCatalog,
  tags: ["domain:tasks", "layer:atom", "status:stable"],
  title: "Features/Tasks/Atoms/TaskTypeIndicator",
} satisfies Meta<typeof TaskTypeCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllTypes: Story = {};
