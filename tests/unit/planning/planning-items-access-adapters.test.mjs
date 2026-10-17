import { afterEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

test("all v2 planning HTTP adapters preserve denied operation, mode and exact scope metadata", async () => {
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) vi.stubEnv(key, "https://planning-adapters.example.test");
  for (const key of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY"]) vi.stubEnv(key, "synthetic-anon");
  for (const key of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"]) vi.stubEnv(key, "synthetic-service");
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/authenticate_team_planning_items_token") return Response.json({ tokenId: "synthetic-token", tokenHint: "…abcdef", scopes: [], scopeGranted: false,
      expiresAt: "2030-01-01T00:00:00Z", evaluatedAt: "2026-10-17T00:00:00Z", remainingSeconds: 3600, profile: { id: "synthetic-profile", platformRole: "ceo" } });
    if (url.pathname === "/rest/v1/rpc/workspace_access_context") return Response.json({ mode: "legacy" });
    throw new Error("Unexpected external protocol in planning HTTP adapter test");
  });
  const cases = [
    ["context", "GET", "planningContext.read", "read", "read:planning-context"],
    ["items/preview", "POST", "planningItems.create", "preview", "write:planning-items:create"],
    ["items", "POST", "planningItems.create", "commit", "write:planning-items:create"],
    ["items/[id]/preview", "POST", "planningItems.update", "preview", "write:planning-items:update"],
    ["items/[id]", "PATCH", "planningItems.update", "commit", "write:planning-items:update"],
    ["items/[id]/delete/preview", "POST", "planningItems.deleteEmpty", "preview", "write:planning-items:delete-empty"],
    ["items/[id]", "DELETE", "planningItems.deleteEmpty", "commit", "write:planning-items:delete-empty"],
    ["items/[id]/github-sync", "POST", "planningItems.githubSync", "commit", "write:planning-items:github-sync"],
  ];
  for (const [path, method, operation, mode, scope] of cases) {
    const route = await importTestModule(`src/app/api/team/planning-items/v2/${path}/route.ts`, { "server-only": {} });
    const response = await route[method](new NextRequest("https://app.example.test/api/planning", { method, headers: { authorization: "Bearer fmd_ti_synthetic" } }), { params: Promise.resolve({ id: "item-1" }) });
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toBe('Bearer error="insufficient_scope"');
    expect(await response.json()).toMatchObject({ code: "INSUFFICIENT_SCOPE", _meta: { operation, mode, access: { decision: "denied", requiredScopes: [scope], missingScopes: [scope] } } });
  }
});
