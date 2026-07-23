import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseGitNumstat,
  requiresProductUpdateForDiff,
} from "../scripts/lib/product-update-diff.mjs";

test("product updates auto-open, queue unseen releases, and remain available from the help menu", async () => {
  const provider = await readFile("src/features/product-updates/organisms/product-updates-provider.tsx", "utf8");
  const selection = await readFile("src/features/product-updates/model/product-update-selection.ts", "utf8");
  const helpMenu = await readFile("src/features/planning/molecules/planning-help-menu.tsx", "utf8");
  const appShell = await readFile("src/features/planning/templates/planning-app-shell.tsx", "utf8");
  const tourProvider = await readFile("src/features/product-tours/organisms/feature-tour-provider.tsx", "utf8");

  assert.match(provider, /selectUnseenProductUpdates/);
  assert.match(provider, /founderops\.product-updates\.seen/);
  assert.match(provider, /fmd:open-product-updates/);
  assert.match(provider, /fmd:start-feature-tour/);
  assert.match(provider, /Lass dich leiten/);
  assert.match(provider, /Was ist neu/);
  assert.match(selection, /selectActiveProductUpdates/);
  assert.match(selection, /expiresAt/);
  assert.match(helpMenu, /hasActiveProductUpdates/);
  assert.match(helpMenu, /product-updates-menu-link/);
  assert.match(helpMenu, /Was ist neu/);
  assert.match(appShell, /ProductUpdatesProvider/);
  assert.match(appShell, /openTaskPanel=\{controller\.openTaskPanel\}/);
  assert.match(tourProvider, /activeTour\.openTaskDetail/);
  assert.match(tourProvider, /activeTour\.openTaskShare/);
  assert.match(tourProvider, /openTaskPanelRef\.current\(taskId\)/);
});

test("product update releases require screenshots, expiry, and dedicated tours", async () => {
  const updates = JSON.parse(await readFile("src/features/product-updates/model/product-updates.json", "utf8"));
  const tours = await readFile("src/features/product-tours/model/feature-tour-registry.ts", "utf8");
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const deployWorkflow = await readFile(".github/workflows/deploy-production.yml", "utf8");
  const verifier = await readFile("scripts/verify-product-updates.mjs", "utf8");

  assert.ok(updates.length > 0);
  assert.ok(updates.every((update) => update.slides.length > 0));
  assert.ok(updates.every((update) => update.expiresAt && update.featureTourId));
  assert.ok(updates.every((update) => update.slides.every((slide) => slide.featureTourId === undefined)));
  assert.ok(updates.flatMap((update) => update.slides).every((slide) => slide.image?.src.startsWith("/product-updates/") && slide.image.alt));
  assert.match(tours, /product-updates-v1/);
  assert.match(tours, /issue-sharing-v1/);
  assert.match(tours, /productUpdateId: "2026-07-21-whats-new-gallery"/);
  assert.match(tours, /task-activity-v1/);
  assert.match(tours, /productUpdateId: "2026-07-21-clear-task-activity"/);
  assert.match(tours, /productUpdateId: "2026-07-21-issue-sharing"/);
  assert.match(tours, /Vorschlag, Review oder allgemeinen Abstimmungsbedarf/);
  assert.match(tours, /task-share-trigger/);
  assert.match(tours, /task-share-popover/);
  assert.match(tours, /help-menu-trigger/);
  assert.match(tours, /product-updates-menu-link/);
  assert.match(packageJson.scripts["verify:deploy"], /verify:product-updates/);
  assert.match(deployWorkflow, /PRODUCT_UPDATE_BASE_REF/);
  assert.match(verifier, /New or expanded production UI changes require both a product update registry change and a current screenshot/);
  assert.match(verifier, /expiresAt must be 1 to 60 days after releasedAt/);
  assert.match(verifier, /has no dedicated Driver\.js tour linked through productUpdateId/);
});

test("product update diff classification excludes removal-only UI maintenance", () => {
  const deletionOnly = parseGitNumstat([
    "0\t259\tsrc/features/intake/organisms/ceo-task-intake.tsx",
    "1\t27\tsrc/features/planning/organisms/planning-workspace-renderer.tsx",
    "1\t1\tdocs/team-planning-items-api.md",
  ].join("\n"));
  assert.equal(requiresProductUpdateForDiff(deletionOnly), false);

  const refactorWithoutSurfaceRemoval = parseGitNumstat(
    "1\t27\tsrc/features/planning/organisms/planning-workspace-renderer.tsx",
  );
  assert.equal(requiresProductUpdateForDiff(refactorWithoutSurfaceRemoval), true);

  const expandedUi = parseGitNumstat(
    "3\t1\tsrc/features/planning/organisms/planning-workspace-renderer.tsx",
  );
  assert.equal(requiresProductUpdateForDiff(expandedUi), true);

  const serverOnly = parseGitNumstat(
    "10\t0\tsrc/app/api/team/planning-items/v1/items/route.ts",
  );
  assert.equal(requiresProductUpdateForDiff(serverOnly), false);
});
