import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const platform = await importTestModule("src/lib/platform.ts");

test("only the CEO can configure the global GitHub Project", () => {
  assert.equal(platform.canConfigureFounderOpsGitHubProject({ platformRole: "ceo" }), true);
  assert.equal(platform.canConfigureFounderOpsGitHubProject({
    platformRole: "deputy",
    deputyFor: "ceo",
    deputyActiveFrom: "2026-07-22",
    deputyActiveUntil: "2026-07-22",
  }), false);
  assert.equal(platform.canConfigureFounderOpsGitHubProject({ platformRole: "founder" }), false);
  assert.equal(platform.canConfigureFounderOpsGitHubProject({ platformRole: "viewer" }), false);
});
