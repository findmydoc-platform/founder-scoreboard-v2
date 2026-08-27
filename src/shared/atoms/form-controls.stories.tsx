import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { UiDateField, UiSelectField } from "./form-controls";

function FormControls() {
  return (
    <div className="grid w-80 gap-4">
      <UiSelectField
        label="Priorität"
        value="P1"
        options={[{ value: "P0", label: "P0" }, { value: "P1", label: "P1" }, { value: "P2", label: "P2" }]}
        onChange={fn()}
      />
      <UiDateField label="Fixtermin" value="2026-09-12" onChange={fn()} />
    </div>
  );
}

const meta = {
  component: FormControls,
  tags: ["layer:atom", "status:stable"],
  title: "Shared/Atoms/FormControls",
} satisfies Meta<typeof FormControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
