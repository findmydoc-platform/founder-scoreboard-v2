import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { TaskChecklist } from "./task-checklist";

const meta = {
  component: TaskChecklist,
  args: {
    value: "- [ ] Prüfe https://example.com/review, danach weiter",
    emptyText: "Keine Kriterien hinterlegt.",
    onChange: fn(),
  },
  tags: ["domain:tasks", "layer:molecule", "status:stable"],
  title: "Features/Tasks/Molecules/TaskChecklist",
} satisfies Meta<typeof TaskChecklist>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PlainTextUrl: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole("link", { name: "https://example.com/review (öffnet in neuem Tab)" });
    const toggle = canvas.getByRole("button", { name: "Kriterium als erledigt markieren", pressed: false });

    await expect(link).toHaveAttribute("href", "https://example.com/review");
    await expect(link.closest("button")).toBeNull();
    await userEvent.click(toggle);
    await expect(args.onChange).toHaveBeenCalledWith("- [x] Prüfe https://example.com/review, danach weiter");
  },
};
