import { afterEach, expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

test.each([
  ["workspace_calendar_entry", "workspace.entry", "board.authorization"],
  ["current_authenticated_profile", "supabase.db.identity.rpc", "board.authorization"],
  ["user", "supabase.user", "board.authorization"],
  ["workspace_dispatch_prepare", "workspace.dispatch.prepare", "board.authorization"],
  ["workspace_release_permit", "workspace.permit.release", "board.authorization"],
  ["sprints", "supabase.db.planning.read", "board.sprints"],
])("Board completion attributes delayed %s to its own ancestor chain", async (target, operation, owner) => {
  const protocol = administratorProtocol({ role: "viewer", claims: { amr: [{ method: "oauth" }] } });
  vi.stubEnv("RUNTIME_LOG_DETAIL_PERCENT", "0");
  vi.stubEnv("GOOGLE_AUTHORIZED_GROUP", "internal-tool-founder-ops-access@findmydoc.eu");
  vi.stubEnv("GOOGLE_WORKLOAD_IDENTITY_AUDIENCE", "synthetic-audience");
  vi.stubEnv("GOOGLE_WORKSPACE_SERVICE_ACCOUNT", "synthetic-account");
  vi.stubEnv("VERCEL_OIDC_TOKEN", protocol.request().headers.get("authorization")!.slice(7));
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(line => { lines.push(String(line)); return true; });
  const { performance } = await import("node:perf_hooks"); let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const identity = { sub: "synthetic-subject", email: "synthetic@findmydoc.eu", email_verified: true,
    iss: "https://accounts.google.com", custom_claims: { hd: "findmydoc.eu" } };
  const fallback = globalThis.fetch;
  let delayed = false; const requests: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url), name = url.pathname.split("/").at(-1)!;
    requests.push(name);
    if (!delayed && name === target) { delayed = true; clock += 400; }
    if (["workspace_access_context", "workspace_calendar_entry"].includes(name)) return Response.json({ mode: "linking", linkingEnforced: true,
      userId: "synthetic-user", profileId: "synthetic-profile", linked: true, identity, sessionAllowed: true, sessionError: false });
    if (name === "workspace_dispatch_prepare") return Response.json(true);
    if (name === "workspace_release_permit") return new Response(null, { status: 204 });
    if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-exchange" });
    if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-directory", expireTime: new Date(Date.now() + 3600000).toISOString() });
    if (url.hostname === "admin.googleapis.com") return Response.json({ isMember: true });
    if (name === "projects") return Response.json({ id: "findmydoc-founder-execution", name: "Synthetic board" });
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/")) return Response.json([]);
    return fallback(request);
  });
  const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {}, "next/cache": { unstable_cache: (load: () => unknown) => load } });
  const response = await GET(protocol.request("/api/planning-board-data?private=seeded-private"));
  expect(response.status, JSON.stringify({ requests, body: await response.clone().json() })).toBe(200);
  expect(await response.json()).toMatchObject({ model: { project: { name: "Synthetic board" } }, currentProfile: { platformRole: "viewer" } });
  expect(delayed).toBe(true);
  const completion = lines.filter(line => line.startsWith('{"level"')).map(line => JSON.parse(line)).find(record => record.event === "request.completed");
  const phases = completion.slowChainPhases;
  let span = phases.find((phase: { operation: string; kind: string; durationMs: number }) => phase.operation === operation && phase.kind === "http" && phase.durationMs === 400);
  expect(span).toBeDefined();
  const ancestors: string[] = [];
  while (span) { ancestors.push(span.operation); span = phases.find((phase: { id: string }) => phase.id === span.parentId); }
  expect(ancestors).toContain(owner);
  expect(ancestors.at(-1)).toBe("request.workflow");
  expect(requests.filter(name => name === "workspace_calendar_entry")).toHaveLength(1);
  expect(requests.filter(name => name === "user")).toHaveLength(16);
  expect(requests.filter(name => name === "workspace_dispatch_prepare")).toHaveLength(14);
  expect(requests.filter(name => name === "workspace_release_permit")).toHaveLength(14);
  expect(requests.filter(name => name === "sprints")).toHaveLength(1);
  expect(completion.externalCalls.total).toBe(requests.length);
  expect(JSON.stringify(completion)).not.toMatch(/seeded-private|synthetic-profile|synthetic-subject|synthetic-exchange|synthetic-directory|example\.test/);
});
