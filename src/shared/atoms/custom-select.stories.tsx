import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { CustomSelect } from "./custom-select";

const options = [
  { value: "open", label: "Offen" },
  { value: "working", label: "In Arbeit" },
  { value: "done", label: "Erledigt" },
];

function SelectStory() {
  const [value, setValue] = useState("open");
  return (
    <div className="h-48 w-64">
      <CustomSelect aria-label="Status" value={value} options={options} onChange={setValue} />
    </div>
  );
}

const meta = {
  component: SelectStory,
  tags: ["layer:atom", "status:stable"],
  title: "Shared/Atoms/CustomSelect",
} satisfies Meta<typeof SelectStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SelectsAnOption: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("combobox", { name: "Status" }));
    await userEvent.click(page.getByRole("option", { name: "In Arbeit" }));
    await expect(canvas.getByRole("combobox", { name: "Status" })).toHaveTextContent("In Arbeit");
  },
};
