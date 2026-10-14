import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { UiSkeletonChips, UiSkeletonPulse } from "./skeleton-primitives";

function SkeletonPrimitives() {
  return (
    <div className="grid w-96 gap-4">
      <UiSkeletonPulse className="h-7 w-56" />
      <UiSkeletonPulse className="h-20 w-full" />
      <UiSkeletonChips />
    </div>
  );
}

const meta = {
  component: SkeletonPrimitives,
  tags: ["layer:atom", "status:stable"],
  title: "Shared/Atoms/SkeletonPrimitives",
} satisfies Meta<typeof SkeletonPrimitives>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {};
