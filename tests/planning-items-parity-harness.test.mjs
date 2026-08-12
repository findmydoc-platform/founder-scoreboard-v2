import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPlanningAuthorizationParity,
  assertPlanningBehaviorParity,
} from "./helpers/planning-items-parity-harness.mjs";
import {
  planningAuthorizationCases,
  planningBehaviorCases,
} from "./fixtures/planning-items-parity-fixtures.mjs";

function recordedBehaviorAdapter(surface) {
  return async (_input, parityCase) => structuredClone(parityCase.expected[surface]);
}

function recordedAuthorizationAdapter(surface) {
  return (parityCase) => Promise.resolve(structuredClone(parityCase.expected[surface]));
}

test("behavior harness executes module, Browser, and Team fixtures exactly", async () => {
  await assertPlanningBehaviorParity({
    cases: planningBehaviorCases,
    adapters: {
      module: recordedBehaviorAdapter("module"),
      browser: recordedBehaviorAdapter("browser"),
      team: recordedBehaviorAdapter("team"),
    },
  });
});

test("behavior harness rejects writes during preview", async () => {
  const preview = planningBehaviorCases.find(({ phase }) => phase === "preview");
  const broken = structuredClone(preview);
  broken.expected.module.writeCount = 1;

  await assert.rejects(
    assertPlanningBehaviorParity({
      cases: [broken],
      adapters: {
        module: recordedBehaviorAdapter("module"),
        browser: recordedBehaviorAdapter("browser"),
        team: recordedBehaviorAdapter("team"),
      },
    }),
    /preview wrote state/,
  );
});

test("behavior harness rejects duplicated replay effects", async () => {
  const replay = planningBehaviorCases.find(({ phase }) => phase === "replay");
  const broken = structuredClone(replay);
  broken.expected.team.createdEffectIds = ["audit-duplicate"];

  await assert.rejects(
    assertPlanningBehaviorParity({
      cases: [broken],
      adapters: {
        module: recordedBehaviorAdapter("module"),
        browser: recordedBehaviorAdapter("browser"),
        team: recordedBehaviorAdapter("team"),
      },
    }),
    /replay duplicated effects/,
  );
});

test("authorization harness executes the same role, ownership, binding, and scope matrix everywhere", async () => {
  await assertPlanningAuthorizationParity({
    cases: planningAuthorizationCases,
    adapters: {
      module: recordedAuthorizationAdapter("module"),
      database: recordedAuthorizationAdapter("database"),
      browser: recordedAuthorizationAdapter("browser"),
      team: recordedAuthorizationAdapter("team"),
    },
  });
});

test("authorization harness rejects a database path that is broader than the module", async () => {
  const denied = planningAuthorizationCases.find(({ id }) => id === "mapped-viewer");
  await assert.rejects(
    assertPlanningAuthorizationParity({
      cases: [
        planningAuthorizationCases.find(({ id }) => id === "mapped-ceo"),
        planningAuthorizationCases.find(({ id }) => id === "mapped-deputy"),
        planningAuthorizationCases.find(({ id }) => id === "mapped-founder-owner"),
        planningAuthorizationCases.find(({ id }) => id === "mapped-founder-other"),
        denied,
        planningAuthorizationCases.find(({ id }) => id === "unmapped-session"),
        planningAuthorizationCases.find(({ id }) => id === "token-with-scope"),
        planningAuthorizationCases.find(({ id }) => id === "token-without-scope"),
      ],
      adapters: {
        module: recordedAuthorizationAdapter("module"),
        database: async (parityCase) => parityCase.id === denied.id
          ? { allowed: true, reason: "unexpectedGrant" }
          : structuredClone(parityCase.expected.database),
        browser: recordedAuthorizationAdapter("browser"),
        team: recordedAuthorizationAdapter("team"),
      },
    }),
    /authorization drifted|database allowed more than the module/,
  );
});

test("fixtures retain transport text, defaults, revisions, idempotency, and local effects", () => {
  const preview = planningBehaviorCases.find(({ phase }) => phase === "preview");
  const commit = planningBehaviorCases.find(({ phase }) => phase === "commit");
  const invalid = planningBehaviorCases.find(({ phase }) => phase === "error");

  assert.equal(preview.expected.team.payload.valid, true);
  assert.deepEqual(preview.expected.team.payload.warnings, []);
  assert.match(invalid.expected.browser.payload.error, /Aufgabenänderung/);
  assert.match(invalid.expected.team.payload.error, /unbekannte Feld/);
  assert.match(commit.expected.team.payload.item.updatedAt, /^2026-/);
  assert.equal(commit.expected.team.idempotencyFingerprint, "sha256:revise-deliverable-1");
  assert.deepEqual(commit.expected.module.createdEffectIds, ["activity-1", "audit-1"]);
});
