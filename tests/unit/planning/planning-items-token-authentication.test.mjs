import assert from "node:assert/strict";

import { test } from "vitest";

import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

const contract = await loadTranspiledModule(
  "src/features/planning-items/model/planning-items-contract.ts",
);

async function loadTokenModule(rpcResult) {
  return loadTranspiledModule(
    "src/features/planning-items/model/planning-items-token.ts",
    {
      "@/lib/supabase": {
        getServerSupabase: () => ({ rpc: async () => rpcResult }),
      },
      "@/features/planning-items/model/planning-items-contract": contract,
    },
  );
}

test("Planning token authentication preserves the safe database receipt", async () => {
  const token = await loadTokenModule({
    data: {
      tokenId: "token-1",
      tokenHint: "…a8F31x",
      scopes: ["read:planning-context"],
      scopeGranted: true,
      expiresAt: "2026-09-03T10:00:00Z",
      evaluatedAt: "2026-08-19T10:00:00Z",
      remainingSeconds: 12.9,
      profile: { id: "profile-1", platformRole: "ceo" },
    },
    error: null,
  });
  const result = await token.requireTeamPlanningItemScope({
    headers: new Headers({ authorization: "Bearer fmd_ti_test-token" }),
  }, "read:planning-context");
  assert.equal(result.ok, true);
  assert.equal(result.tokenHint, "…a8F31x");
  assert.equal(result.remainingSeconds, 12);
});

test("Planning token authentication classifies inactive and malformed receipts without metadata", async () => {
  const inactiveToken = await loadTokenModule({
    data: null,
    error: { code: "P0004" },
  });
  const inactive = await inactiveToken.requireTeamPlanningItemScope({
    headers: new Headers({ authorization: "Bearer fmd_ti_expired" }),
  }, "read:planning-context");
  assert.deepEqual(inactive, {
    ok: false,
    status: 401,
    code: "TOKEN_INACTIVE",
    error: "Planning-API-Token ist ungültig oder abgelaufen.",
  });

  const malformedToken = await loadTokenModule({
    data: { tokenId: "token-1" },
    error: null,
  });
  const malformed = await malformedToken.requireTeamPlanningItemScope({
    headers: new Headers({ authorization: "Bearer fmd_ti_malformed" }),
  }, "read:planning-context");
  assert.equal(malformed.ok, false);
  assert.equal(malformed.code, "AUTHORIZATION_UNAVAILABLE");
  assert.equal("scopes" in malformed, false);
});

test("Planning token authentication preserves scope and profile failure codes", async () => {
  const cases = [
    {
      providerCode: "P0005",
      status: 403,
      code: "INSUFFICIENT_SCOPE",
      error: "Planning-API-Token hat nicht den erforderlichen Scope.",
    },
    {
      providerCode: "P0006",
      status: 403,
      code: "TOKEN_PROFILE_FORBIDDEN",
      error: "Planning-API-Token ist keinem operativen FounderOps-Profil zugeordnet.",
    },
  ];
  for (const expected of cases) {
    const token = await loadTokenModule({
      data: null,
      error: { code: expected.providerCode },
    });
    const result = await token.requireTeamPlanningItemScope({
      headers: new Headers({ authorization: "Bearer fmd_ti_rejected" }),
    }, "read:planning-context");
    assert.deepEqual(result, {
      ok: false,
      status: expected.status,
      code: expected.code,
      error: expected.error,
    });
    assert.equal("scopes" in result, false);
    assert.equal("expiresAt" in result, false);
  }
});

test("Planning token authentication distinguishes missing credentials from an unknown bearer", async () => {
  let rpcCalls = 0;
  const token = await loadTranspiledModule(
    "src/features/planning-items/model/planning-items-token.ts",
    {
      "@/lib/supabase": {
        getServerSupabase: () => ({
          rpc: async () => {
            rpcCalls += 1;
            return { data: null, error: null };
          },
        }),
      },
      "@/features/planning-items/model/planning-items-contract": contract,
    },
  );

  const missing = await token.requireTeamPlanningItemScope({
    headers: new Headers(),
  }, "read:planning-context");
  assert.equal(missing.code, "TOKEN_REQUIRED");

  const malformed = await token.requireTeamPlanningItemScope({
    headers: new Headers({ authorization: "Basic malformed" }),
  }, "read:planning-context");
  assert.equal(malformed.code, "TOKEN_REQUIRED");

  const unknown = await token.requireTeamPlanningItemScope({
    headers: new Headers({ authorization: "Bearer unknown-token" }),
  }, "read:planning-context");
  assert.equal(unknown.code, "TOKEN_INACTIVE");
  assert.equal(rpcCalls, 0);
});
