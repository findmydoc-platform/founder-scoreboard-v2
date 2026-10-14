import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { TaskCardSubIssueNotice } from "./task-card-sub-issue-notice";

const meta = {
  component: TaskCardSubIssueNotice,
  args: {
    count: 1,
  },
  decorators: [(Story) => <div className="w-72"><Story /></div>],
  tags: ["domain:tasks", "layer:atom", "status:stable"],
  title: "Features/Tasks/Atoms/TaskCardSubIssueNotice",
} satisfies Meta<typeof TaskCardSubIssueNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Singular: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("1 offenes Sub-Issue für dich")).toBeVisible();
  },
};

export const Plural: Story = {
  args: {
    count: 3,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("3 offene Sub-Issues für dich")).toBeVisible();
  },
};

export const Hidden: Story = {
  args: {
    count: 0,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(/für dich/)).not.toBeInTheDocument();
  },
};
