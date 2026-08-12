import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const {
  PlanningShellStateUnavailableError,
  isPlanningShellStateUnavailableError,
} = await loadTranspiledModule("src/lib/workspace-data-availability.ts");

test("planning data outages use a dedicated expected error", () => {
  const error = new PlanningShellStateUnavailableError();
  assert.equal(isPlanningShellStateUnavailableError(error), true);
  assert.equal(isPlanningShellStateUnavailableError(new Error("other")), false);
  assert.match(error.message, /vorübergehend nicht verfügbar/);
});
