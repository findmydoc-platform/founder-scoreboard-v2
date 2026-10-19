import assert from "node:assert/strict";
import {test} from "vitest";
import {importTestModule} from "../../helpers/vitest-module.mjs";

test("the proxy bypasses Supabase auth only for the exact webhook path", async () => {
  let authFactoryCalls = 0;
  let getUserCalls = 0;
  const webhookResponse = { kind: "webhook-bypass" };
  const authenticatedResponse = { kind: "authenticated" };
  const proxyModule = await importTestModule("src/proxy.ts", {
    "next/server": {
      NextResponse: {
        next: () => webhookResponse,
      },
    },
    "@/lib/credentials": {
      authorizeCredentialAction: async () => { authFactoryCalls++; getUserCalls++; return authenticatedResponse; },
    },
  });

  assert.equal(
    await proxyModule.proxy({ nextUrl: { pathname: "/api/github/webhooks" } }),
    webhookResponse,
  );
  assert.equal(authFactoryCalls, 0);
  assert.equal(getUserCalls, 0);

  assert.equal(
    await proxyModule.proxy({ nextUrl: { pathname: "/api/github/webhooks/extra" } }),
    authenticatedResponse,
  );
  assert.equal(authFactoryCalls, 1);
  assert.equal(getUserCalls, 1);
});
