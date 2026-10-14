import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { TaskReferenceLink } from "./task-reference-link";

const onOpenTask = fn();

const meta = {
  component: TaskReferenceLink,
  args: {
    onOpenTask,
    task: {
      id: "deliverable-1",
      title: "Clinic onboarding",
    },
  },
  tags: ["domain:tasks", "layer:atom", "status:stable"],
  title: "Features/Tasks/Atoms/TaskReferenceLink",
} satisfies Meta<typeof TaskReferenceLink>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpensTaskPanel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("link", { name: /Clinic onboarding/ }));
    await expect(onOpenTask).toHaveBeenCalledWith("deliverable-1");
  },
};
