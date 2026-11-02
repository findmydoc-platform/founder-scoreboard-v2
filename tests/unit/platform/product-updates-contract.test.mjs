import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const productUpdateSelection = await importTestModule(
  "src/features/product-updates/model/product-update-selection.ts",
  {},
);
const featureTourSelection = await importTestModule(
  "src/features/product-tours/model/feature-tour-selection.ts",
  {},
);

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

test("current-week publication guidance has a live thirty-day update, matching screenshot and dedicated editor tour", async () => {
  const registry = JSON.parse(await readFile("src/features/product-updates/model/product-updates.json", "utf8"));
  const update = registry.find(({ id }) => id === "2026-10-14-workweek-current-publication");
  assert.ok(update);
  assert.notEqual(update.draft, true);
  assert.equal(update.featureTourId, "workweek-current-publication-v1");
  assert.equal((Date.parse(update.expiresAt) - Date.parse(update.releasedAt)) / 86400000, 30);
  const screenshot = await readFile(`public${update.slides[0].image.src}`);
  assert.equal(screenshot.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(screenshot.readUInt32BE(16), update.slides[0].image.width);
  assert.equal(screenshot.readUInt32BE(20), update.slides[0].image.height);
  assert.equal(productUpdateSelection.selectActiveProductUpdates([update], new Date("2026-11-15T00:00:00Z")).length, 0);
});
