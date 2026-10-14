import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const access = await importTestModule(
  "src/features/administrator-access/model/administrator-access.ts",
);

test("active administrator access grants technical and correction capabilities without CEO governance", () => {
  const authority = access.sessionAuthority({
    platformRole: "founder",
    credentialKind: "session",
    administratorAccess: {
      eligible: true,
      active: true,
      expiresAt: "2026-09-22T13:00:00.000Z",
    },
  });

  assert.deepEqual(authority.capabilities, {
    technicalAdministration: true,
    manageAdministratorEligibility: true,
    operationalCorrection: true,
    ceoGovernance: false,
  });
});

test("CEO can manage eligibility without inheriting technical administration", () => {
  const authority = access.sessionAuthority({
    platformRole: "ceo",
    credentialKind: "session",
    administratorAccess: access.inactiveAdministratorAccess,
  });

  assert.deepEqual(authority.capabilities, {
    technicalAdministration: false,
    manageAdministratorEligibility: true,
    operationalCorrection: false,
    ceoGovernance: true,
  });
});

test("non-session credentials never receive JIT administrator capabilities", () => {
  for (const credentialKind of ["planning_token", "webhook", "local_simulation"]) {
    const authority = access.sessionAuthority({
      platformRole: "ceo",
      credentialKind,
      administratorAccess: {
        eligible: true,
        active: true,
        expiresAt: "2026-09-22T13:00:00.000Z",
      },
    });

    assert.equal(authority.administratorAccess.active, false);
    assert.equal(authority.capabilities.technicalAdministration, false);
    assert.equal(authority.capabilities.operationalCorrection, false);
    assert.equal(authority.capabilities.ceoGovernance, true);
  }
});
