import assert from "node:assert/strict";
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
