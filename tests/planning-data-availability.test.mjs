import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const {
  allowsLocalPlanningFallback,
  PlanningDataUnavailableError,
  isPlanningDataUnavailableError,
} = await loadTranspiledModule("src/lib/planning-data-availability.ts");

test("local development keeps the planning seed fallback", () => {
  assert.equal(allowsLocalPlanningFallback({ NODE_ENV: "development" }), true);
});

test("online and CI environments never enable the planning seed fallback", () => {
  assert.equal(allowsLocalPlanningFallback({ NODE_ENV: "production" }), false);
  assert.equal(allowsLocalPlanningFallback({ NODE_ENV: "development", VERCEL_ENV: "preview" }), false);
  assert.equal(allowsLocalPlanningFallback({ NODE_ENV: "development", VERCEL: "1" }), false);
  assert.equal(allowsLocalPlanningFallback({ NODE_ENV: "development", CI: "true" }), false);
});

test("planning data outages use a dedicated expected error", () => {
  const error = new PlanningDataUnavailableError();
  assert.equal(isPlanningDataUnavailableError(error), true);
  assert.equal(isPlanningDataUnavailableError(new Error("other")), false);
  assert.match(error.message, /vorübergehend nicht verfügbar/);
});
