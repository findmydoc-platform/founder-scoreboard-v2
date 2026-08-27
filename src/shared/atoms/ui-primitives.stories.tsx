import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { UiButton } from "./ui-primitives";

const meta = {
  component: UiButton,
  tags: ["layer:atom", "status:stable"],
  title: "Shared/Atoms/Button",
} satisfies Meta<typeof UiButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    children: "Änderungen speichern",
    variant: "primary",
  },
};

export const Secondary: Story = {
  args: {
    children: "Details ansehen",
  },
};
