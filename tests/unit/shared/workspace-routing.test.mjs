import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const workspacePreferences = await importTestModule(
  "src/features/planning/model/workspace-preferences.ts",
);

const { rootWorkspaceFromPreference } = workspacePreferences;

test("root workspace preferences normalize legacy values without accepting route queries", () => {
  assert.equal(rootWorkspaceFromPreference("reviews"), "planning");
  assert.equal(rootWorkspaceFromPreference("profile"), "profile");
  assert.equal(rootWorkspaceFromPreference("mine"), "planning");
  assert.equal(rootWorkspaceFromPreference("execution"), "planning");
  assert.equal(rootWorkspaceFromPreference("settings"), "planning");
  assert.equal(rootWorkspaceFromPreference("administration"), "planning");
  assert.equal(rootWorkspaceFromPreference("unknown"), "planning");
  assert.equal(rootWorkspaceFromPreference(undefined), "planning");
});

test("retired CEO intake preferences fall back to planning", () => {
  assert.equal(rootWorkspaceFromPreference("ceo-intake"), "planning");
});
