import { afterEach, expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function fixture({ error, receipt = {}, workspace = { mode: "legacy" }, onData } = {}) {
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) vi.stubEnv(name, "https://personal-planning.example.test");
  for (const name of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY"]) vi.stubEnv(name, "synthetic-anon");
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"]) vi.stubEnv(name, "synthetic-service");
  let authenticationRequests = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/authenticate_team_planning_items_token") {
      authenticationRequests++;
      if (error) return Response.json(error, { status: 400 });
      return Response.json({ tokenId: "token-1", tokenHint: "…a8F31x", scopes: ["read:planning-context"], scopeGranted: true,
        expiresAt: new Date(Date.now() + 3600000).toISOString(), evaluatedAt: new Date().toISOString(), remainingSeconds: 12.9,
        profile: { id: "profile-1", platformRole: "ceo" }, ...receipt });
    }
    if (url.pathname === "/rest/v1/rpc/workspace_access_context") return Response.json(workspace);
    if (onData) return onData(request);
    throw new Error("Unexpected external protocol in personal planning test");
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  return {
    authorize: (authorization = "Bearer fmd_ti_synthetic", operation = "planningContext.read", mode = "read") => authorizeCredentialAction({
      credential: { kind: "personal-planning-token", request: { headers: new Headers(authorization ? { authorization } : {}) } },
      action: "planning-items.access", operation, mode, itemId: "bound-item",
    }),
    authenticationRequests: () => authenticationRequests,
  };
}

test("personal token authorization preserves the safe database receipt without a service client", async () => {
  const token = await fixture();
  const result = await token.authorize();
  expect(result).toMatchObject({ ok: true, tokenHint: "…a8F31x", remainingSeconds: 12, profile: { id: "profile-1" }, requiredScopes: ["read:planning-context"], missingScopes: [] });
  expect("supabase" in result).toBe(false);
  expect("token" in result).toBe(false);
  await token.authorize();
  expect(token.authenticationRequests()).toBe(2);
});

test.each([
  ["P0004", 401, "TOKEN_INACTIVE"], ["P0005", 403, "INSUFFICIENT_SCOPE"],
  ["P0006", 403, "TOKEN_PROFILE_FORBIDDEN"], ["PGRST202", 503, "AUTHORIZATION_UNAVAILABLE"],
  ["42883", 503, "AUTHORIZATION_UNAVAILABLE"], ["unexpected", 500, "AUTHORIZATION_UNAVAILABLE"],
])("personal token authorization classifies database failure %s safely", async (providerCode, status, code) => {
  const token = await fixture({ error: { code: providerCode, message: "Sensitive upstream detail" } });
  const result = await token.authorize();
  expect(result).toMatchObject({ ok: false, status, code });
  expect("scopes" in result).toBe(false);
  expect(JSON.stringify(result)).not.toContain("Sensitive upstream detail");
});

test("personal token authorization rejects malformed and inconsistent receipts", async () => {
  for (const receipt of [{ tokenId: null }, { scopes: ["unknown:scope"] }, { scopeGranted: false }, { remainingSeconds: null }, { expiresAt: "invalid-date" }, { evaluatedAt: "invalid-date" }]) {
    const token = await fixture({ receipt });
    expect(await token.authorize()).toMatchObject({ ok: false, code: "AUTHORIZATION_UNAVAILABLE" });
  }
});

test("missing and unknown credentials retain separate codes without a token RPC", async () => {
  const token = await fixture();
  expect(await token.authorize("")).toMatchObject({ ok: false, code: "TOKEN_REQUIRED" });
  expect(await token.authorize("Basic malformed")).toMatchObject({ ok: false, code: "TOKEN_REQUIRED" });
  expect(await token.authorize("Bearer unknown-token")).toMatchObject({ ok: false, code: "TOKEN_INACTIVE" });
  expect(token.authenticationRequests()).toBe(0);
});

test("personal token access still denies an owner without Workspace admission", async () => {
  const token = await fixture({ workspace: { mode: "google", profileId: "profile-1", linked: false } });
  expect(await token.authorize()).toMatchObject({ ok: false, status: 403, code: "AUTHORIZATION_UNAVAILABLE" });
});

test("a context read capability cannot commit or dispatch a foreign projection", async () => {
  const token = await fixture();
  const result = await token.authorize();
  expect(result.ok).toBe(true);
  await expect(result.planningItems.commitUpdate({ parsed: {} }, () => {})).rejects.toMatchObject({ code: "P0007" });
  await expect(result.planningItems.dispatchGitHubProjection("foreign-operation")).rejects.toMatchObject({ code: "P0007" });
});

test("a preview capability cannot commit, change target or borrow browser activation", async () => {
  const token = await fixture({ receipt: { scopes: ["write:planning-items:update"], profile: { id: "profile-1", platformRole: "founder" }, authority: { capabilities: { operationalCorrection: true } } } });
  const result = await token.authorize(undefined, "planningItems.update", "preview");
  expect(result.ok).toBe(true);
  expect("authority" in result).toBe(false);
  await expect(result.planningItems.commitUpdate({ parsed: {} }, () => {})).rejects.toMatchObject({ code: "P0007" });
  await expect(result.planningItems.revise({ parsed: {} }, { command: { kind: "reviseItem", itemId: "foreign-item" } })).rejects.toMatchObject({ code: "P0007" });
});

test("scope metadata cannot be mutated to grant a GitHub-sync capability", async () => {
  const token = await fixture({ receipt: { scopes: ["write:planning-items:create"] } });
  const result = await token.authorize(undefined, "planningItems.create", "preview");
  expect(() => result.scopes.push("write:planning-items:github-sync")).toThrow();
  expect(result.planningItems.requireGitHubSync()).toEqual({ requiredScopes: ["write:planning-items:create", "write:planning-items:github-sync"], missingScopes: ["write:planning-items:github-sync"] });
  await expect(result.planningItems.create({ githubSyncMode: "wait" }, { command: { kind: "createItems", items: [] } })).rejects.toMatchObject({ code: "P0007" });
});

test("Workspace evidence expires 900 seconds after verification starts and never renews on reads", async () => {
  let now = Date.parse("2026-10-17T10:00:00Z");
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  const previousFetch = globalThis.fetch;
  let membershipRequests = 0, tokenRequests = 0, contextRequests = 0, unavailable = false;
  const profileId = "fixed-deadline-profile";
  const workspace = { mode: "google", linkingEnforced: false, userId: "synthetic-user", profileId, linked: true,
    identity: { sub: "fixed-deadline-subject", iss: "https://accounts.google.com", email_verified: true, email: "synthetic@findmydoc.eu", custom_claims: { hd: "findmydoc.eu" } } };
  try {
    await fixture();
    for (const [name, value] of Object.entries({ GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-pat-audience", GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "synthetic@example.test", GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu", VERCEL_OIDC_TOKEN: `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + 86400 })).toString("base64url")}.synthetic` })) vi.stubEnv(name, value);
    vi.stubGlobal("fetch", async (input, init) => {
      const url = new URL(new Request(input, init).url);
      if (url.pathname === "/rest/v1/rpc/authenticate_team_planning_items_token") {
        tokenRequests++;
        return Response.json({ tokenId: "fixed-deadline-token", tokenHint: "…abcdef", scopes: ["read:planning-context"], scopeGranted: true,
          expiresAt: "2026-10-18T10:00:00Z", evaluatedAt: new Date(now).toISOString(), remainingSeconds: 86400,
          profile: { id: profileId, platformRole: "founder" } });
      }
      if (url.pathname === "/rest/v1/rpc/workspace_access_context") { contextRequests++; return Response.json(workspace); }
      if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-sts" });
      if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-reader", expireTime: "2026-10-18T10:00:00Z" });
      if (url.hostname === "admin.googleapis.com") {
        membershipRequests++;
        now += 2000;
        return unavailable ? Response.json({}, { status: 503 }) : Response.json({ isMember: true });
      }
      throw new Error("Unexpected external protocol in personal planning freshness test");
    });
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
    const authorize = () => authorizeCredentialAction({ credential: { kind: "personal-planning-token", request: { headers: new Headers({ authorization: "Bearer fmd_ti_fixed-deadline" }) } }, action: "planning-items.access", operation: "planningContext.read", mode: "read" });
    expect(await authorize()).toMatchObject({ ok: true });
    now = Date.parse("2026-10-17T10:14:59Z");
    expect(await authorize()).toMatchObject({ ok: true });
    expect(membershipRequests).toBe(1);
    unavailable = true;
    now = Date.parse("2026-10-17T10:15:00Z");
    expect(await authorize()).toMatchObject({ ok: false, status: 503 });
    expect(membershipRequests).toBe(2);
    expect(tokenRequests).toBe(3);
    expect(contextRequests).toBe(3);
  } finally { clock.mockRestore(); vi.stubGlobal("fetch", previousFetch); }
});


test("a planning capability binds data targets to its authorized item and actor", async () => {
  const requests = [];
  const token = await fixture({ receipt: { scopes: ["write:planning-items:update"] }, onData: async request => {
    requests.push(new URL(request.url));
    return Response.json({ id: "bound-item" });
  } });
  const result = await token.authorize(undefined, "planningItems.update", "preview");
  expect(await result.planningItems.hasCanonicalItem("foreign-item")).toBe(true);
  expect(requests).toHaveLength(1);
  expect(requests[0].pathname).toBe("/rest/v1/active_tasks");
  expect(requests[0].searchParams.get("id")).toBe("eq.bound-item");
  expect(token.authenticationRequests()).toBe(2);
});

test("a GitHub capability accepts only its actor's enqueued projection ID", async () => {
  const token = await fixture({ receipt: { scopes: ["write:planning-items:github-sync"] }, onData: async request => {
    const body = await request.json();
    expect(body).toMatchObject({ p_token_id: "token-1", p_profile_id: "profile-1", p_item_id: "bound-item" });
    return Response.json({ operationId: "accepted-operation", itemType: "deliverable" });
  } });
  const result = await token.authorize(undefined, "planningItems.githubSync", "commit");
  const accepted = await result.planningItems.enqueueGitHubProjection({ tokenId: "foreign-token", actorProfileId: "foreign-owner", itemId: "foreign-item", idempotencyKey: "synthetic-key", command: { createIfMissing: false } });
  expect(accepted).toMatchObject({ ok: true, value: { operationId: "accepted-operation" } });
  await expect(result.planningItems.dispatchGitHubProjection("foreign-operation")).rejects.toMatchObject({ code: "P0007" });
});


test("a known token deadline is enforced even if its authentication receipt arrives late", async () => {
  const token = await fixture({ receipt: { expiresAt: new Date(Date.now() - 1).toISOString() } });
  expect(await token.authorize()).toMatchObject({ ok: false, status: 401, code: "TOKEN_INACTIVE" });
});
