import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { CustomDatePicker } from "./custom-date-picker";

function DatePickerStory() {
  const [value, setValue] = useState("2026-09-12");
  return (
    <div className="h-[420px] w-72">
      <CustomDatePicker aria-label="Fixtermin" value={value} onChange={setValue} />
    </div>
  );
}

const meta = {
  component: DatePickerStory,
  tags: ["layer:atom", "status:stable"],
  title: "Shared/Atoms/CustomDatePicker",
} satisfies Meta<typeof DatePickerStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SelectsADate: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("button", { name: "Fixtermin" }));
    await userEvent.click(page.getByRole("gridcell", { name: /15\. September 2026/ }));
    await expect(canvas.getByRole("button", { name: "Fixtermin" })).toHaveTextContent("15.09.2026");
  },
};
