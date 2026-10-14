import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { ToggleSwitch } from "./toggle-switch";

function ToggleSwitchStory() {
  const [checked, setChecked] = useState(false);
  return <ToggleSwitch checked={checked} label="Benachrichtigungen aktiv" onChange={setChecked} />;
}

const meta = {
  component: ToggleSwitchStory,
  tags: ["layer:atom", "status:stable"],
  title: "Shared/Atoms/ToggleSwitch",
} satisfies Meta<typeof ToggleSwitchStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TogglesWithKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const control = canvas.getByRole("switch", { name: "Benachrichtigungen aktiv" });
    await expect(control).not.toBeChecked();
    control.focus();
    await userEvent.keyboard(" ");
    await expect(control).toBeChecked();
  },
};
