import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const platform = await loadTranspiledModule("src/lib/platform.ts");

test("CEO and only currently active Deputies can manage the GitHub Project", () => {
  const today = "2026-07-22";
  assert.equal(platform.canManageFounderOpsGitHubProject({ platformRole: "ceo" }, today), true);
  assert.equal(platform.canManageFounderOpsGitHubProject({
    platformRole: "deputy",
    deputyFor: "ceo",
    deputyActiveFrom: "2026-07-22",
    deputyActiveUntil: "2026-07-22",
  }, today), true);
  assert.equal(platform.canManageFounderOpsGitHubProject({
    platformRole: "deputy",
    deputyFor: "ceo",
    deputyActiveFrom: "2026-07-23",
  }, today), false);
  assert.equal(platform.canManageFounderOpsGitHubProject({
    platformRole: "deputy",
    deputyFor: "ceo",
    deputyActiveUntil: "2026-07-21",
  }, today), false);
  assert.equal(platform.canManageFounderOpsGitHubProject({ platformRole: "deputy" }, today), false);
  assert.equal(platform.canManageFounderOpsGitHubProject({ platformRole: "founder" }, today), false);
});
