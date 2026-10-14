import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AppBrand } from "./app-brand";

const meta = {
  component: AppBrand,
  tags: ["layer:atom", "status:stable"],
  title: "Shared/Atoms/AppBrand",
} satisfies Meta<typeof AppBrand>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Login: Story = {
  args: {
    size: "login",
  },
};

export const Badge: Story = {
  args: {
    founderOpsVariant: "badge",
  },
};
