import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

test("GitHub App status route preserves its browser contract through the shared operational status", async () => {
  const protocol = administratorProtocol(), authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/profiles") return Response.json({ github_login: "synthetic-author" });
    if (url.pathname === "/rest/v1/github_app_user_tokens") return Response.json({ github_login: "synthetic-author", revoked_at: null, access_token_expires_at: null });
    if (url.pathname === "/rest/v1/task_comment_github_deliveries") { assert.equal(url.searchParams.get("author_profile_id"), "eq.synthetic-profile"); return new Response(null, { headers: { "content-range": "*/2" } }); }
    return authFetch(request);
  });
  const { GET } = await importTestModule("src/app/api/github-app/status/route.ts", { "server-only": {} });
  const response = await GET(protocol.request("/api/github-app/status"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { installation: { available: false }, user: { connected: true, needsReconnect: false, expiresAt: null }, waitingCommentCount: 2 });
});
