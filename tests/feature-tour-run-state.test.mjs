import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const {
  featureTourRunOwnsClaim,
  shouldReleaseFeatureTourClaim,
} = await loadTranspiledModule(
  "src/features/product-tours/model/feature-tour-run-state.ts",
);

test("an interrupted current tour run releases only its own unstarted claim", () => {
  const interruptedRun = {
    driverStarted: false,
    tourId: "planning-tour",
  };

  assert.equal(featureTourRunOwnsClaim(interruptedRun, "planning-tour"), true);
  assert.equal(shouldReleaseFeatureTourClaim(interruptedRun, "planning-tour"), true);
  assert.equal(shouldReleaseFeatureTourClaim(interruptedRun, "newer-tour"), false);
});

test("a tour whose driver started keeps its claim until driver cleanup", () => {
  const startedRun = {
    driverStarted: true,
    tourId: "profile-tour",
  };

  assert.equal(shouldReleaseFeatureTourClaim(startedRun, "profile-tour"), false);
});
