import assert from "node:assert/strict";

export const PLANNING_BEHAVIOR_SURFACES = ["module", "browser", "team"];
export const PLANNING_AUTHORIZATION_SURFACES = ["module", "database", "browser", "team"];

function assertExactKeys(value, keys, label) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} has an incomplete contract`);
}

function validateObservation(observation, label, surface) {
  assert.equal(typeof observation, "object", `${label} must return an observation`);
  assert.notEqual(observation, null, `${label} must return an observation`);
  assertExactKeys(observation, [
    "canonicalCommand",
    "createdEffectIds",
    "idempotencyFingerprint",
    "payload",
    "replayLedgerWrites",
    "revision",
    "statusCode",
    "writeCount",
  ], label);
  if (surface === "module") {
    assert.equal(observation.statusCode, null, `${label}.statusCode must stay transport-neutral`);
  } else {
    assert.equal(Number.isInteger(observation.statusCode), true, `${label}.statusCode must be an integer`);
  }
  assert.equal(Number.isInteger(observation.writeCount), true, `${label}.writeCount must be an integer`);
  assert.equal(Number.isInteger(observation.replayLedgerWrites), true, `${label}.replayLedgerWrites must be an integer`);
  assert.equal(Array.isArray(observation.createdEffectIds), true, `${label}.createdEffectIds must be an array`);
  assert.notEqual(observation.payload, undefined, `${label}.payload must be explicit`);
}

export async function assertPlanningBehaviorParity({ cases, adapters }) {
  assert.ok(cases.length > 0, "behavior parity requires at least one case");
  assertExactKeys(adapters, PLANNING_BEHAVIOR_SURFACES, "behavior adapters");

  const observations = new Map();
  for (const parityCase of cases) {
    assert.ok(parityCase.id, "behavior case id is required");
    assert.ok(parityCase.parityKey, `${parityCase.id}.parityKey is required`);
    assert.ok(["preview", "commit", "replay", "error"].includes(parityCase.phase), `${parityCase.id}.phase is invalid`);
    assertExactKeys(parityCase.expected, PLANNING_BEHAVIOR_SURFACES, `${parityCase.id}.expected`);

    const bySurface = {};
    for (const surface of PLANNING_BEHAVIOR_SURFACES) {
      if (parityCase.expected[surface] === null) continue;
      const observed = await adapters[surface](parityCase.input, parityCase);
      validateObservation(observed, `${parityCase.id}.${surface}`, surface);
      assert.deepEqual(observed, parityCase.expected[surface], `${parityCase.id}.${surface} drifted`);
      bySurface[surface] = observed;

      if (parityCase.phase === "preview") {
        assert.equal(observed.writeCount, 0, `${parityCase.id}.${surface} preview wrote state`);
        assert.equal(observed.replayLedgerWrites, 0, `${parityCase.id}.${surface} preview wrote a replay receipt`);
        assert.deepEqual(observed.createdEffectIds, [], `${parityCase.id}.${surface} preview created local effects`);
      }
      if (parityCase.phase === "replay") {
        assert.equal(observed.writeCount, 0, `${parityCase.id}.${surface} replay wrote state`);
        assert.equal(observed.replayLedgerWrites, 0, `${parityCase.id}.${surface} replay rewrote its receipt`);
        assert.deepEqual(observed.createdEffectIds, [], `${parityCase.id}.${surface} replay duplicated effects`);
        assert.ok(observationReceiptId(observed), `${parityCase.id}.${surface} replay has no original receipt`);
      }
    }
    observations.set(parityCase.id, bySurface);
  }

  for (const parityCase of cases.filter(({ counterpartId }) => counterpartId)) {
    const counterpart = observations.get(parityCase.counterpartId);
    const current = observations.get(parityCase.id);
    assert.ok(counterpart, `${parityCase.id} references missing counterpart ${parityCase.counterpartId}`);
    for (const surface of PLANNING_BEHAVIOR_SURFACES) {
      if (!current[surface] || !counterpart[surface]) continue;
      assert.deepEqual(
        current[surface].canonicalCommand,
        counterpart[surface].canonicalCommand,
        `${parityCase.id}.${surface} did not share canonical normalization with ${parityCase.counterpartId}`,
      );
    }
  }
}

function observationReceiptId(observation) {
  if (!observation.payload || typeof observation.payload !== "object") return "";
  return typeof observation.payload.receiptId === "string" ? observation.payload.receiptId : "";
}

function validateAuthorizationDecision(decision, label) {
  assert.equal(typeof decision, "object", `${label} must return a decision`);
  assert.notEqual(decision, null, `${label} must return a decision`);
  assertExactKeys(decision, ["allowed", "reason"], label);
  assert.equal(typeof decision.allowed, "boolean", `${label}.allowed must be boolean`);
  assert.equal(typeof decision.reason, "string", `${label}.reason must be explicit`);
  if (!decision.allowed) assert.ok(decision.reason, `${label} denied without a reason`);
}

export async function assertPlanningAuthorizationParity({ cases, adapters }) {
  assert.ok(cases.length > 0, "authorization parity requires at least one case");
  assertExactKeys(adapters, PLANNING_AUTHORIZATION_SURFACES, "authorization adapters");

  const dimensions = new Set();
  for (const parityCase of cases) {
    assert.ok(parityCase.id, "authorization case id is required");
    assert.ok(parityCase.actor?.binding, `${parityCase.id}.actor.binding is required`);
    assert.ok(parityCase.actor?.role, `${parityCase.id}.actor.role is required`);
    assert.ok(parityCase.ownership, `${parityCase.id}.ownership is required`);
    assert.equal(Array.isArray(parityCase.actor.scopes), true, `${parityCase.id}.actor.scopes must be explicit`);
    assertExactKeys(parityCase.expected, PLANNING_AUTHORIZATION_SURFACES, `${parityCase.id}.expected`);
    dimensions.add(parityCase.actor.binding);
    dimensions.add(parityCase.actor.role);
    dimensions.add(parityCase.ownership);

    const decisions = {};
    for (const surface of PLANNING_AUTHORIZATION_SURFACES) {
      if (parityCase.expected[surface] === null) continue;
      const decision = await adapters[surface](parityCase);
      validateAuthorizationDecision(decision, `${parityCase.id}.${surface}`);
      assert.deepEqual(decision, parityCase.expected[surface], `${parityCase.id}.${surface} authorization drifted`);
      decisions[surface] = decision;
    }
    assert.equal(
      decisions.database?.allowed && !decisions.module?.allowed,
      false,
      `${parityCase.id} database allowed more than the module`,
    );
  }

  for (const required of ["mapped", "unmapped", "ceo", "founder", "deputy", "viewer", "owner", "other"] ) {
    assert.ok(dimensions.has(required), `authorization matrix does not cover ${required}`);
  }
  assert.ok(
    cases.some(({ actor }) => actor.binding === "planningToken" && actor.scopes.length === 0),
    "authorization matrix does not cover a missing token scope",
  );
  assert.ok(
    cases.some(({ actor }) => actor.binding === "planningToken" && actor.scopes.length > 0),
    "authorization matrix does not cover an allowed token scope",
  );
}
