import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CustomActionMenu } from "./custom-action-menu";

const onArchive = fn();

const meta = {
  component: CustomActionMenu,
  args: {
    label: "Aufgabenaktionen",
    triggerLabel: "Aktionen",
    groups: [{
      id: "task",
      label: "Aufgabe",
      items: [
        { id: "archive", label: "Archivieren", onSelect: onArchive },
        { id: "delete", label: "Endgültig löschen", disabled: true, disabledReason: "Nur im Papierkorb verfügbar.", onSelect: fn(), tone: "danger" },
      ],
    }],
  },
  decorators: [(Story) => <div className="h-64 w-80"><Story /></div>],
  tags: ["layer:molecule", "status:stable"],
  title: "Shared/Molecules/CustomActionMenu",
} satisfies Meta<typeof CustomActionMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SelectsAnAction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("button", { name: "Aufgabenaktionen" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Archivieren" }));
    await expect(onArchive).toHaveBeenCalledOnce();
  },
};
