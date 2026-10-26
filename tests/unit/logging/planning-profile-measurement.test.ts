import { performance } from "node:perf_hooks";
import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

async function measuredPlanning(options: { profileError?: { code: string; status: number }; parallel?: boolean } = {}) {
  const protocol = administratorProtocol({ role: "viewer", claims: { amr: [{ method: "oauth" }] } });
  for (const [key, value] of Object.entries({ VERCEL_OIDC_TOKEN: protocol.request().headers.get("authorization")!.slice(7), GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-audience",
    GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "reader@example.test", GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu", RUNTIME_LOG_DETAIL_PERCENT: "100" })) vi.stubEnv(key, value);
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((line: string | Uint8Array) => { lines.push(String(line)); return true; });
  let clock = 0, profiles = 0, pendingProfiles = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const attempts: string[] = [];
  const authFetch = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url), path = url.pathname;
    attempts.push(path);
    if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-sts" });
    if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-directory", expireTime: new Date(Date.now() + 3600000).toISOString() });
    if (url.hostname === "admin.googleapis.com") return Response.json({ isMember: true });
    if (path === "/auth/v1/user") clock += 2;
    if (path.endsWith("/rpc/workspace_access_context")) return Response.json({ mode: "linking", linkingEnforced: true, linked: true,
      userId: "synthetic-user", profileId: "synthetic-profile", identity: { sub: "google-member", email: "member@findmydoc.eu",
        email_verified: true, iss: "https://accounts.google.com", custom_claims: { hd: "findmydoc.eu" } } });
    if (path.endsWith("/rpc/workspace_linking_session_allowed")) return Response.json(true);
    if (path.endsWith("/rpc/workspace_dispatch_prepare")) { clock += 3; return Response.json(true); }
    if (path.endsWith("/rpc/workspace_release_permit")) { clock += 7; return new Response(null, { status: 204 }); }
    if (path.endsWith("/rpc/current_authenticated_profile")) {
      profiles++;
      if (options.parallel && profiles > 1) {
        pendingProfiles++;
        if (pendingProfiles === 2) release();
        await gate;
      }
      clock += 5;
      const response = options.profileError && profiles > 1
        ? Response.json({ code: options.profileError.code, message: "seeded-private-profile-error" }, { status: options.profileError.status })
        : await authFetch(request);
      const text = response.text.bind(response);
      vi.spyOn(response, "text").mockImplementation(async () => { clock += 11; return text(); });
      return response;
    }
    return authFetch(request);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const { observeRuntimeRoute } = await import("../../../src/lib/runtime-logging");
  const results: unknown[] = [];
  const response = await observeRuntimeRoute("planning.board", protocol.request("/api/planning-board-data"), async () => {
    const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action: "planning.board.read" });
    expect(permission).toMatchObject({ ok: true });
    if (!permission.ok) throw new Error("Synthetic authorization failed");
    if (options.parallel) results.push(...await Promise.all([permission.planning.loadHeader([]), permission.planning.loadHeader([])]));
    else results.push(await permission.planning.loadHeader([]), await permission.planning.loadHeader([]));
    return Response.json({ unchanged: true });
  });
  const records = lines.filter(line => line.startsWith('{"level"')).map(line => JSON.parse(line));
  return { response, results, records, attempts, pendingProfiles, completion: records.find(record => record.event === "request.completed") };
}

test("public Planning credentials measure every full SDK profile operation including live auth, preparation, release and body processing", async () => {
  const { response, results, completion, attempts, records } = await measuredPlanning();
  expect(await response.json()).toEqual({ unchanged: true });
  expect(results).toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);
  expect(completion.phaseAggregates["supabase.db.identity.rpc"]).toEqual({ operation: [3, 84, 28], http: [3, 15, 5] });
  expect(completion.phaseAggregates["workspace.dispatch.prepare"]).toEqual({ operation: [3, 9, 3], http: [3, 9, 3] });
  expect(completion.phaseAggregates["workspace.permit.release"]).toEqual({ operation: [3, 21, 7], http: [3, 21, 7] });
  expect(completion.externalCalls.operations).toMatchObject({ "supabase.db.identity.rpc": 3, "workspace.dispatch.prepare": 3, "workspace.permit.release": 3 });
  expect(completion.externalCalls.total).toBe(19);
  expect(attempts).toHaveLength(19);
  expect(attempts.filter(path => path.endsWith("/rpc/current_authenticated_profile"))).toHaveLength(3);
  expect(JSON.stringify(records)).not.toMatch(/seeded-private|synthetic-profile/);
});

test("repeated Planning profile checks retain overlapping dispatch instead of serializing parallel callers", async () => {
  const { completion, pendingProfiles, results } = await measuredPlanning({ parallel: true });
  expect(pendingProfiles).toBe(2);
  expect(results).toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);
  expect(completion.phaseAggregates["supabase.db.identity.rpc"].operation[0]).toBe(3);
  expect(completion.externalCalls.operations["supabase.db.identity.rpc"]).toBe(3);
});

test.each([["42501", 403, false], ["workspace_access_denied", 403, false], ["PGRST116", 400, true], ["provider_unavailable", 503, true]] as const)(
  "repeated profile result %s preserves the public denial and provider classification", async (code, status, failure) => {
    const { response, results, completion, records } = await measuredPlanning({ profileError: { code, status } });
    expect(response.status).toBe(200);
    expect(results).toEqual([expect.objectContaining({ ok: false, status: status >= 500 ? 503 : 403 }), expect.objectContaining({ ok: false, status: status >= 500 ? 503 : 403 })]);
    expect(completion.outcome).toBe(failure ? "error" : "success");
    expect(completion.phaseAggregates["supabase.db.identity.rpc"].operation[0]).toBe(3);
    if (failure) expect(records).toContainEqual(expect.objectContaining({ event: "operation.failed", failure: expect.objectContaining({ operation: "supabase.db.identity.rpc", errorCategory: "provider_http_error" }) }));
    else expect(records.filter(record => record.event === "operation.failed")).toEqual([]);
    expect(JSON.stringify(records)).not.toContain("seeded-private");
  },
);
