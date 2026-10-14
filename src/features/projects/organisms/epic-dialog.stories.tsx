import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { EpicDialog } from "./epic-dialog";

const longDescription = "Kontext mit Umlauten äöü. ".repeat(2700);
const meta = {
  title: "Features/Projects/Organisms/EpicDialog",
  component: EpicDialog,
  parameters: { layout: "fullscreen" },
  args: { defaults: { title: "Strategisches Ziel", description: longDescription }, onClose: fn(), onSave: fn(async () => undefined) },
} satisfies Meta<typeof EpicDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const OversizedContent: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Meilenstein erstellen" }));
    await expect(canvas.getByRole("alert")).toHaveTextContent("maximal 65.536 Zeichen");
    const description = canvas.getByRole("textbox", { name: "Gemeinsames Ziel" });
    await expect(description).toHaveValue(longDescription);
    await expect(args.onSave).not.toHaveBeenCalled();
    await userEvent.clear(description);
    await userEvent.type(description, "Vollständiger kurzer Kontext.");
    await userEvent.click(canvas.getByRole("button", { name: "Meilenstein erstellen" }));
    await expect(args.onSave).toHaveBeenCalledWith(expect.objectContaining({ description: "Vollständiger kurzer Kontext." }));
  },
};
