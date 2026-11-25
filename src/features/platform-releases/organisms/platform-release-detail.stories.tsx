import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PlatformReleaseDetail } from "./platform-release-detail";
import { historicalReleaseStoryFixture, releaseStoryFixture } from "./platform-release-story-fixture";

const release = releaseStoryFixture();
release.manifest.changes = release.manifest.changes.slice(0, 4);

const meta = {
  component: PlatformReleaseDetail,
  title: "Features/PlatformReleases/Organisms/Detail",
  parameters: { layout: "fullscreen" },
  args: { release },
} satisfies Meta<typeof PlatformReleaseDetail>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OneHighlight: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1, name: "Klinikgruppen im Dashboard vorbereitet" })).toBeVisible();
    await expect(canvas.getByText(args.release.summary)).toBeVisible();
    await expect(canvas.getByText("3 weitere Einträge")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /Alle Änderungen und Fehlerbehebungen anzeigen/ }));
    for (const change of args.release.manifest.changes) {
      await expect(canvas.getAllByRole("heading", { level: 3, name: change.title })).toHaveLength(1);
      await expect(canvas.getByText(change.summary)).toBeVisible();
    }
  },
};

export const ThreeReorderedHighlights: Story = {
  args: { release: releaseStoryFixture(["drafts", "admin-access", "clinic-access"]) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("3 weitere Einträge")).toBeVisible();
    await expect(
      canvas.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent?.trim()),
    ).toEqual([
      "Entwürfe bei Klinikwechseln schützen",
      "Interne Admin-Verwaltung begrenzen",
      "Berechtigte Kliniken gemeinsam verwalten",
    ]);
    await userEvent.click(canvas.getByRole("button", { name: /Alle Änderungen und Fehlerbehebungen anzeigen/ }));
    for (const change of args.release.manifest.changes) {
      await expect(canvas.getAllByRole("heading", { level: 3, name: change.title })).toHaveLength(1);
    }
  },
};

export const SixHighlights: Story = {
  ...ThreeReorderedHighlights,
  args: { release: releaseStoryFixture(["drafts", "admin-access", "clinic-access", "post-schedule", "notifications", "maintenance"]) },
};

export const HistoricalRelease: Story = {
  args: { release: historicalReleaseStoryFixture() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1, name: "findmydoc v0.50.0" })).toBeVisible();
    await expect(canvas.getByText(args.release.summary)).toBeVisible();
  },
};

export const LongGermanTitle: Story = {
  args: { release: { ...release, manifest: { ...release.manifest, title: "Klinikgruppenverwaltungsberechtigungszuordnungen" } } },
};

export const ContentRemainsUsableWhileReferencesArePending: Story = {
  args: { referenceState: { status: "loading" } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1, name: "Klinikgruppen im Dashboard vorbereitet" })).toBeVisible();
    await expect(canvas.getByText(args.release.summary)).toBeVisible();
    await expect(canvas.getAllByText("Planungszuordnungen werden geprüft.").some(node => node.getClientRects().length > 0)).toBe(true);
    await expect(canvas.queryByText("Noch keine Planungszuordnung erkannt.")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /Technische Details/ }));
    await expect(canvas.getByRole("heading", { name: "Pull Requests" })).toBeVisible();
  },
};

export const FailedReferencesDoNotReplaceContentAndCanRetry: Story = {
  args: { referenceState: { status: "unavailable" }, onRetryReferences: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(args.release.summary)).toBeVisible();
    await expect(canvas.queryByText("Noch keine Planungszuordnung erkannt.")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Planungszuordnungen erneut laden" }));
    await expect(args.onRetryReferences).toHaveBeenCalledOnce();
    await expect(canvas.getByText(args.release.summary)).toBeVisible();
  },
};
