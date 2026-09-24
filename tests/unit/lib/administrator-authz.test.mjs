import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

let profile;
let snapshot;
let snapshotError;
let authRequired;

beforeEach(() => {
  authRequired = true;
  profile = {
    id: "founder-1",
    name: "Founder",
    platform_role: "founder",
    github_login: "founder",
  };
  snapshot = { eligible: true, active: true, expiresAt: "2026-09-22T13:00:00.000Z" };
  snapshotError = null;
});

const accessModel = await importTestModule(
  "src/features/administrator-access/model/administrator-access.ts",
);

const authz = await importTestModule("src/lib/authz.ts", {
  "./auth-error-contract": {
    invalidSessionBeforeEffectErrorCode: "session_invalid_before_effect",
    administratorAccessRequiredErrorCode: "administrator_access_required",
    administratorAccessExpiredErrorCode: "administrator_access_expired",
  },
  "./local-development-auth": { isLocalLoginRequestAllowed: () => false },
  "./platform": { isOperationalLeadRole: () => false },
  "./supabase": {
    requiresSupabaseAuth: () => authRequired,
    getSupabaseForToken: () => ({
      auth: { getUser: async () => ({ data: { user: { id: "auth-user" } }, error: null }) },
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() { return { data: profile, error: null }; },
        };
      },
      async rpc(name) {
        if (name === "current_authenticated_profile") return { data: profile, error: null };
        if (name === "administrator_access_snapshot") return { data: snapshot, error: snapshotError };
        throw new Error(`Unexpected RPC: ${name}`);
      },
    }),
  },
  "@/features/administrator-access/model/administrator-access": accessModel,
});

function request(extraHeaders = {}) {
  return { headers: new Headers({ authorization: "Bearer session-token", ...extraHeaders }) };
}

test("active administrator guard returns named capabilities", async () => {
  const result = await authz.requireActiveAdministrator(request());

  assert.equal(result.ok, true);
  assert.equal(result.authority.capabilities.technicalAdministration, true);
  assert.equal(result.authority.capabilities.ceoGovernance, false);
});

test("eligibility manager accepts CEO without active administrator access", async () => {
  profile = { ...profile, platform_role: "ceo" };
  snapshot = { eligible: false, active: false, expiresAt: null };

  const result = await authz.requireAdministratorEligibilityManager(request());

  assert.equal(result.ok, true);
  assert.equal(result.authority.capabilities.manageAdministratorEligibility, true);
  assert.equal(result.authority.capabilities.technicalAdministration, false);
});

test("inactive and local-simulation access fail closed", async () => {
  snapshot = { eligible: true, active: false, expiresAt: null };
  assert.deepEqual(await authz.requireActiveAdministrator(request()), {
    ok: false,
    status: 403,
    code: "administrator_access_expired",
    error: "Der Adminzugang ist abgelaufen.",
  });

  authRequired = false;
  assert.deepEqual(await authz.requireActiveAdministrator(request()), {
    ok: false,
    status: 403,
    code: "administrator_access_required",
    error: "Ein echter, aktiver Adminzugang ist erforderlich.",
  });
});

test("administrator correction is exposed only through the named guard", async () => {
  profile = { ...profile, platform_role: "viewer" };

  const ordinaryContributor = await authz.requirePlanningContributor(request());
  const correctionContributor = await authz.requirePlanningContributorOrActiveAdministrator(request());

  assert.equal(ordinaryContributor.ok, false);
  assert.equal(ordinaryContributor.status, 403);
  assert.equal(correctionContributor.ok, true);
  assert.equal(correctionContributor.authority.capabilities.operationalCorrection, true);

  const simulatedActor = await authz.requirePlanningContributorOrActiveAdministrator(request({ "x-fmd-dev-profile-id": "simulated-viewer" }));
  assert.equal(simulatedActor.ok, false);
  assert.equal(simulatedActor.status, 403);
});

test("active planning contributors retain their role access and receive operational correction", async () => {
  const result = await authz.requirePlanningContributorOrActiveAdministrator(request());

  assert.equal(result.ok, true);
  assert.equal(result.profile.platformRole, "founder");
  assert.equal(result.authority.capabilities.operationalCorrection, true);
});

test("inactive planning contributors retain role access without operational correction", async () => {
  snapshot = { eligible: true, active: false, expiresAt: null };

  const result = await authz.requirePlanningContributorOrActiveAdministrator(request());

  assert.equal(result.ok, true);
  assert.equal(result.profile.platformRole, "founder");
  assert.equal(result.authority?.capabilities.operationalCorrection ?? false, false);
});

test("planning contributors retain base access when the optional administrator snapshot is unavailable", async () => {
  snapshotError = { message: "temporarily unavailable" };

  const result = await authz.requirePlanningContributorOrActiveAdministrator(request());

  assert.equal(result.ok, true);
  assert.equal(result.profile.platformRole, "founder");
  assert.equal(result.authority, undefined);
});

test("post-guard administrator failures distinguish expiry from revoked eligibility", async () => {
  const client = {
    rpc: async () => ({ data: snapshot, error: null }),
  };

  snapshot = { eligible: true, active: false, expiresAt: null };
  assert.deepEqual(await authz.resolveAdministratorAccessFailure(client), {
    ok: false,
    status: 403,
    code: "administrator_access_expired",
    error: "Der Adminzugang ist abgelaufen.",
  });

  snapshot = { eligible: false, active: false, expiresAt: null };
  assert.deepEqual(await authz.resolveAdministratorAccessFailure(client), {
    ok: false,
    status: 403,
    code: "administrator_access_required",
    error: "Ein aktiver Adminzugang ist erforderlich.",
  });
});
