import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const {
  PlanningDataUnavailableError,
  isPlanningDataUnavailableError,
} = await loadTranspiledModule("src/lib/planning-data-availability.ts");

test("planning data outages use a dedicated expected error", () => {
  const error = new PlanningDataUnavailableError();
  assert.equal(isPlanningDataUnavailableError(error), true);
  assert.equal(isPlanningDataUnavailableError(new Error("other")), false);
  assert.match(error.message, /vorübergehend nicht verfügbar/);
});
