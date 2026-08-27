import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import type { TaskStatus } from "@/lib/types";
import { TaskStatusControl } from "./task-status-control";

const options: TaskStatus[] = ["Offen", "In Arbeit", "Erledigt"];

function EditableStatus() {
  const [status, setStatus] = useState<TaskStatus>("Offen");
  return <TaskStatusControl canChange status={status} options={options} onChange={setStatus} selectClassName="h-10 w-48" />;
}

const meta = {
  component: EditableStatus,
  tags: ["domain:tasks", "layer:atom", "status:stable"],
  title: "Features/Tasks/Atoms/TaskStatusControl",
} satisfies Meta<typeof EditableStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ChangesStatus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("combobox", { name: "Status ändern" }));
    await userEvent.click(page.getByRole("option", { name: "In Arbeit" }));
    await expect(canvas.getByRole("combobox", { name: "Status ändern" })).toHaveTextContent("In Arbeit");
  },
};

export const Locked: Story = {
  render: () => (
    <TaskStatusControl
      canChange={false}
      status="Erledigt"
      options={options}
      onChange={() => undefined}
      lockedReason="Nur CEO kann wieder öffnen."
    />
  ),
};
