import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("the planning dependency update has a current desktop screenshot and dedicated scope tour", async () => {
  const [registry, tourSource, profileSource, screenshot] = await Promise.all([
    readFile("src/features/product-updates/model/product-updates.json", "utf8").then(JSON.parse),
    readFile("src/features/product-tours/model/feature-tour-registry.ts", "utf8"),
    readFile("src/features/profile/organisms/profile-planning-items-tokens.tsx", "utf8"),
    readFile("public/product-updates/2026-09-13-planning-api-dependencies/planning-api-dependencies.png"),
  ]);
  const update = registry.find(({ id }) => id === "2026-09-13-planning-api-dependencies");

  assert.ok(update);
  assert.equal(update.releasedAt, "2026-09-13");
  assert.equal(update.expiresAt, "2026-10-13");
  assert.equal(update.featureTourId, "planning-api-dependencies-v1");
  assert.equal(update.title, "Aufgabenabhängigkeiten per Skill verwalten");
  assert.equal(
    update.summary,
    "Der FounderOps-Skill liest jetzt blockierende Aufgaben und kann Abhängigkeiten nach Vorschau gezielt hinzufügen oder entfernen.",
  );
  assert.equal(update.slides[0].image.width, 1440);
  assert.equal(update.slides[0].image.height, 900);
  assert.equal(screenshot.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(screenshot.readUInt32BE(16), 1440);
  assert.equal(screenshot.readUInt32BE(20), 900);
  assert.match(tourSource, /planningApiDependenciesTourId = "planning-api-dependencies-v1"/);
  assert.match(tourSource, /productUpdateId: "2026-09-13-planning-api-dependencies"/);
  assert.match(tourSource, /\[data-tour-id='founderops-planning-update-scope'\]/);
  assert.match(profileSource, /data-tour-id="founderops-planning-update-scope"/);
  assert.match(profileSource, /Update-Scope für Felder und Aufgabenabhängigkeiten/);
});

test("the JIT administration update is the newest product update and links its account-menu tour", async () => {
  const [registry, tourSource, screenshot] = await Promise.all([
    readFile("src/features/product-updates/model/product-updates.json", "utf8").then(JSON.parse),
    readFile("src/features/product-tours/model/feature-tour-registry.ts", "utf8"),
    readFile("public/product-updates/2026-09-22-jit-administration/administration.png"),
  ]);
  const update = registry.find(({ id }) => id === "2026-09-22-jit-administration");

  assert.equal(registry[0], update);
  assert.equal(update.expiresAt, "2026-10-22");
  assert.equal(update.featureTourId, "administration-workspace-v1");
  assert.equal(update.slides[0].image.width, 1440);
  assert.equal(update.slides[0].image.height, 900);
  assert.equal(screenshot.subarray(1, 4).toString("ascii"), "PNG");
  assert.match(tourSource, /administrationWorkspaceTourId = "administration-workspace-v1"/);
  assert.match(tourSource, /productUpdateId: "2026-09-22-jit-administration"/);
  assert.match(tourSource, /\[data-tour-id='account-menu-trigger'\]/);
});
