import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { PlatformReleaseArchive } from "./platform-release-archive";
import { historicalReleaseStoryFixture, releaseStoryFixture } from "./platform-release-story-fixture";

const release = releaseStoryFixture();
const meta = {
  component: PlatformReleaseArchive,
  title: "Features/PlatformReleases/Organisms/Archive",
  parameters: { layout: "fullscreen" },
  args: { releases: [release] },
} satisfies Meta<typeof PlatformReleaseArchive>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ShortTitle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: /Klinikgruppen im Dashboard vorbereitet/ })).toBeVisible();
    await expect(canvas.getByText(release.summary)).toBeVisible();
    await userEvent.type(canvas.getByRole("textbox", { name: "Releases durchsuchen" }), "Dashboard vorbereitet");
    await expect(canvas.getByRole("link", { name: /Klinikgruppen im Dashboard vorbereitet/ })).toBeVisible();
  },
};

export const HistoricalRelease: Story = {
  args: { releases: [historicalReleaseStoryFixture()] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("findmydoc v0.50.0")).toBeVisible();
    await expect(canvas.getByText(args.releases[0].summary)).toBeVisible();
  },
};
