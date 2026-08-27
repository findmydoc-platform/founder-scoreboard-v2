import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const productUpdateSelection = await loadTranspiledModule(
  "src/features/product-updates/model/product-update-selection.ts",
  {},
);
const featureTourSelection = await loadTranspiledModule(
  "src/features/product-tours/model/feature-tour-selection.ts",
  {},
);

test("product updates auto-open, queue unseen releases, and remain available from the help menu", async () => {
  const provider = await readFile("src/features/product-updates/organisms/product-updates-provider.tsx", "utf8");
  const selection = await readFile("src/features/product-updates/model/product-update-selection.ts", "utf8");
  const helpMenu = await readFile("src/features/planning/molecules/planning-help-menu.tsx", "utf8");
  const appShell = await readFile("src/features/planning/templates/planning-app-shell.tsx", "utf8");
  const tourProvider = await readFile("src/features/product-tours/organisms/feature-tour-provider.tsx", "utf8");

  assert.match(provider, /selectUnseenProductUpdates/);
  assert.match(provider, /founderops\.product-updates\.seen/);
  assert.match(provider, /fmd:open-product-updates/);
  assert.match(provider, /fmd:start-feature-tour/);
  assert.match(provider, /Lass dich leiten/);
  assert.match(provider, /Was ist neu/);
  assert.match(selection, /selectActiveProductUpdates/);
  assert.match(selection, /expiresAt/);
  assert.match(helpMenu, /hasActiveProductUpdates/);
  assert.match(helpMenu, /product-updates-menu-link/);
  assert.match(helpMenu, /Was ist neu/);
  assert.match(appShell, /ProductUpdatesProvider/);
  assert.match(appShell, /openTaskPanel=\{controller\.openTaskPanel\}/);
  assert.match(tourProvider, /activeTour\.openTaskDetail/);
  assert.match(tourProvider, /activeTour\.openTaskShare/);
  assert.match(tourProvider, /openTaskPanelRef\.current\(taskId\)/);
  assert.match(tourProvider, /availableTours\.find/);
  assert.match(tourProvider, /const resumedTour = availableTours\.find/);
});

test("the shared calendar product update and tour no longer depend on a rollout capability", () => {
  const currentUpdate = {
    id: "team-workweek",
    releasedAt: "2026-08-25",
    expiresAt: "2026-09-24",
    featureTourId: "team-workweek-v1",
    title: "Team workweek",
    summary: "",
    slides: [],
  };
  const currentTour = {
    id: "team-workweek-v1",
    requiredSelectors: [],
    steps: [],
  };
  const now = new Date("2026-08-25T12:00:00.000Z");

  assert.deepEqual(
    productUpdateSelection.selectActiveProductUpdates([currentUpdate], now),
    [currentUpdate],
  );
  assert.equal(
    featureTourSelection.selectNextFeatureTour(
      [currentTour],
      "planning",
      "profile-1",
      [],
    )?.id,
    "team-workweek-v1",
  );
});

test("product update releases require screenshots, expiry, and dedicated tours", async () => {
  const updates = JSON.parse(await readFile("src/features/product-updates/model/product-updates.json", "utf8"));
  const tours = await readFile("src/features/product-tours/model/feature-tour-registry.ts", "utf8");

  assert.equal(updates.length, 10);
  assert.ok(updates.every((update) => update.slides.length > 0));
  assert.ok(updates.every((update) => update.expiresAt && update.featureTourId));
  assert.ok(updates.every((update) => update.slides.every((slide) => slide.featureTourId === undefined)));
  assert.ok(updates.flatMap((update) => update.slides).every((slide) => slide.image?.src.startsWith("/product-updates/") && slide.image.alt));
  const planningApiUpdate = updates.find((update) => update.id === "2026-08-13-planning-api-v2");
  const githubWebhookUpdate = updates.find((update) => update.id === "2026-08-18-github-issue-webhook-sync");
  const teamWorkweekUpdate = updates.find((update) => update.id === "2026-08-25-team-workweek");
  assert.equal(teamWorkweekUpdate?.featureTourId, "team-workweek-v1");
  assert.equal(teamWorkweekUpdate?.availability, undefined);
  assert.equal(teamWorkweekUpdate?.expiresAt, "2026-09-24");
  assert.equal(
    teamWorkweekUpdate?.slides[0]?.image?.src,
    "/product-updates/2026-08-25-team-workweek/team-workweek.png",
  );
  assert.equal(githubWebhookUpdate?.featureTourId, "github-issue-webhook-sync-v1");
  assert.equal(
    githubWebhookUpdate?.slides[0]?.image?.src,
    "/product-updates/2026-08-18-github-issue-webhook-sync/github-issue-webhook-sync.png",
  );
  assert.equal(
    planningApiUpdate?.slides[0]?.link?.href,
    "https://github.com/findmydoc-platform/agent-skills/tree/main/skills/founderops-planning-items",
  );
  assert.match(tours, /product-updates-v1/);
  assert.match(tours, /github-issue-webhook-sync-v1/);
  assert.match(tours, /team-workweek-v1/);
  assert.match(tours, /productUpdateId: "2026-08-25-team-workweek"/);
  assert.match(tours, /header-calendar-action/);
  assert.match(tours, /productUpdateId: "2026-08-18-github-issue-webhook-sync"/);
  assert.match(tours, /issue-sharing-v1/);
  assert.match(tours, /productUpdateId: "2026-07-21-whats-new-gallery"/);
  assert.match(tours, /task-activity-v1/);
  assert.match(tours, /productUpdateId: "2026-07-21-clear-task-activity"/);
  assert.match(tours, /productUpdateId: "2026-07-21-issue-sharing"/);
  assert.match(tours, /productUpdateId: "2026-08-13-planning-api-v2"/);
  assert.match(tours, /productUpdateId: "2026-08-14-platform-releases"/);
  assert.match(tours, /Vorschlag, Review oder allgemeinen Abstimmungsbedarf/);
  assert.match(tours, /task-share-trigger/);
  assert.match(tours, /task-share-popover/);
  assert.match(tours, /task-detail-tab-activity/);
  assert.match(tours, /help-menu-trigger/);
  assert.match(tours, /product-updates-menu-link/);
});
