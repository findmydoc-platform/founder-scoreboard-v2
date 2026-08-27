import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const {
  PlanningShellStateUnavailableError,
  isPlanningShellStateUnavailableError,
} = await importTestModule("src/lib/workspace-data-availability.ts");

test("planning data outages use a dedicated expected error", () => {
  const error = new PlanningShellStateUnavailableError();
  assert.equal(isPlanningShellStateUnavailableError(error), true);
  assert.equal(isPlanningShellStateUnavailableError(new Error("other")), false);
  assert.match(error.message, /vorübergehend nicht verfügbar/);
});
