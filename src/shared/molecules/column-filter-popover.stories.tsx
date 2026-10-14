import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { ColumnFilterPopover } from "./column-filter-popover";

const onReset = fn();

const meta = {
  component: ColumnFilterPopover,
  args: {
    activeCount: 1,
    children: (
      <CustomSelect
        aria-label="Priorität"
        value="P1"
        options={[{ value: "Alle", label: "Alle" }, { value: "P1", label: "P1" }]}
        onChange={fn()}
      />
    ),
    label: "Priorität filtern",
    onReset,
  },
  decorators: [(Story) => <div className="h-64 w-80"><Story /></div>],
  tags: ["layer:molecule", "status:stable"],
  title: "Shared/Molecules/ColumnFilterPopover",
} satisfies Meta<typeof ColumnFilterPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpensAndResets: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("button", { name: "Priorität filtern" }));
    await expect(page.getByRole("dialog", { name: "Priorität filtern" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Zurücksetzen" }));
    await expect(onReset).toHaveBeenCalledOnce();
  },
};
