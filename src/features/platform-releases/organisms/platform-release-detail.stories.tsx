import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
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

const releaseWithScreenshot = releaseStoryFixture(["clinic-access", "post-schedule"]);
const screenshotAlt = "Sprint & Score auf dem Smartphone";
const screenshotUrl = new URL("../../../../public/product-updates/2026-08-14-mobile-founderops/sprint-score-phone.png", import.meta.url).href;
const otherScreenshotUrl = new URL("../../../../public/product-updates/2026-08-13-planning-api-v2/planning-api-v2.png", import.meta.url).href;
releaseWithScreenshot.manifest.changes[0].visualUrls = [screenshotUrl, otherScreenshotUrl];
releaseWithScreenshot.manifest.changes[1].visualUrls = [otherScreenshotUrl];
releaseWithScreenshot.manifest.visuals = [{
  url: screenshotUrl,
  altText: screenshotAlt,
  label: screenshotAlt,
  formFactor: "mobile",
  source: "ui-ux",
  repository: "findmydoc-platform/website",
  pullRequestNumber: 1842,
  releaseEligible: true,
  releaseRole: "primary",
}];

export const ScreenshotGallery: Story = {
  args: { release: releaseWithScreenshot },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const gallery = within(canvasElement.ownerDocument.body);
    const viewport = canvasElement.ownerDocument.defaultView!;
    const openButton = canvas.getByRole("button", { name: `Bild vergrößern: ${screenshotAlt}` });
    const otherButton = canvas.getByRole("button", { name: "Bild vergrößern: Blog-Veröffentlichungen nachvollziehen" });
    await expect(canvas.getAllByRole("button", { name: /Bild vergrößern/ })).toHaveLength(2);
    await expect(within(openButton).getAllByRole("img")).toHaveLength(1);
    const preview = within(openButton).getByRole<HTMLImageElement>("img", { name: screenshotAlt });
    await waitFor(() => expect(preview.naturalHeight).toBeGreaterThan(0));
    await expect(preview).toHaveStyle("object-fit: contain");

    const frame = openButton.getBoundingClientRect();
    const displayedPreviewHeight = Math.min(preview.clientHeight, preview.clientWidth * preview.naturalHeight / preview.naturalWidth);
    await expect(frame.width / frame.height).toBeCloseTo(16 / 9, 1);
    await expect(viewport.document.documentElement.scrollWidth).toBeLessThanOrEqual(viewport.innerWidth);
    openButton.scrollIntoView({ block: "center" });
    openButton.focus({ preventScroll: true });
    const readingPosition = viewport.scrollY;
    await userEvent.keyboard("{Enter}");
    const dialog = await gallery.findByRole("dialog", { name: screenshotAlt });
    const enlarged = within(dialog).getByRole<HTMLImageElement>("img", { name: screenshotAlt });
    await waitFor(() => expect(enlarged.naturalHeight).toBeGreaterThan(0));
    await expect(enlarged).toHaveStyle("object-fit: contain");
    const bounds = enlarged.getBoundingClientRect();
    await expect(bounds.left).toBeGreaterThanOrEqual(0);
    await expect(bounds.top).toBeGreaterThanOrEqual(0);
    await expect(bounds.right).toBeLessThanOrEqual(viewport.innerWidth);
    await expect(bounds.bottom).toBeLessThanOrEqual(viewport.innerHeight);
    await expect(bounds.height).toBeGreaterThan(displayedPreviewHeight);
    const closeButton = within(dialog).getByRole("button", { name: "Bildansicht schließen" });
    await waitFor(() => expect(closeButton).toHaveFocus());
    await userEvent.keyboard("{Tab}");
    await expect(closeButton).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect(gallery.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(openButton).toHaveFocus());
    await expect(viewport.scrollY).toBe(readingPosition);

    otherButton.scrollIntoView({ block: "center" });
    const otherReadingPosition = viewport.scrollY;
    await userEvent.click(otherButton);
    const otherDialog = await gallery.findByRole("dialog", { name: "Blog-Veröffentlichungen nachvollziehen" });
    await userEvent.click(within(otherDialog).getByRole("button", { name: "Bildansicht schließen" }));
    await expect(gallery.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(otherButton).toHaveFocus());
    await expect(viewport.scrollY).toBe(otherReadingPosition);
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
