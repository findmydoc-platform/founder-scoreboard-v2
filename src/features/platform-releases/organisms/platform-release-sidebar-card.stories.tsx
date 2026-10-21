import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { PlatformReleaseSidebarCardView } from "./platform-release-sidebar-card";
import { historicalReleaseStoryFixture, releaseStoryFixture } from "./platform-release-story-fixture";

const release = releaseStoryFixture();
const meta = {
  component: PlatformReleaseSidebarCardView,
  title: "Features/PlatformReleases/Organisms/SidebarCard",
  args: { release },
  decorators: [(Story) => <div className="w-64"><Story /></div>],
} satisfies Meta<typeof PlatformReleaseSidebarCardView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ShortTitle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Klinikgruppen im Dashboard vorbereitet")).toBeVisible();
    await expect(canvas.getByText(release.summary)).toBeVisible();
  },
};

export const Mobile: Story = { ...ShortTitle, args: { mobile: true } };

export const Compact: Story = {
  args: { compact: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("link", { name: "Neu auf der Plattform: Klinikgruppen im Dashboard vorbereitet" })).toBeVisible();
  },
};

export const HistoricalRelease: Story = {
  args: { release: historicalReleaseStoryFixture() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("findmydoc v0.50.0")).toBeVisible();
    const summary = canvas.getByText(args.release.summary);
    await expect(summary).toBeVisible();
    await expect(summary.scrollHeight).toBeLessThanOrEqual(summary.clientHeight);
  },
};

export const HistoricalMobile: Story = { ...HistoricalRelease, args: { ...HistoricalRelease.args, mobile: true } };
