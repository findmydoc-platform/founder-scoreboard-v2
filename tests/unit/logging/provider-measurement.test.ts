import { generateKeyPairSync } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

function capture() {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((line: string | Uint8Array) => { lines.push(String(line)); return true; });
  return () => lines.filter(line => line.startsWith('{"level"')).map(line => JSON.parse(line));
}
function configureGitHub() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  vi.stubEnv("GITHUB_APP_ID", "123"); vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "456");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY_PATH", ""); vi.stubEnv("RUNTIME_LOG_DETAIL_PERCENT", "100");
}

test("public credential operations count actual GitHub attempts and preserve read retry and mutation no-replay", async () => {
  configureGitHub(); const records = capture(); let reads = 0; let writes = 0;
  vi.stubGlobal("fetch", async (input: string, init: RequestInit) => {
    if (String(input).endsWith("/access_tokens")) return Response.json({ token: "seeded-private-token", expires_at: new Date(Date.now() + 3600000).toISOString() });
    if (init.method === "GET") { reads++; return Response.json([], { status: reads === 1 ? 503 : 200 }); }
    writes++; throw new TypeError("seeded-private-payload");
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const { observeRuntimeRoute } = await import("../../../src/lib/runtime-logging");
  const response = await observeRuntimeRoute("task.github-sync", new NextRequest("https://example.test/api/tasks/private-id/sync-github", { method: "POST" }), async () => {
    const { github } = await authorizeCredentialAction({ credential: { kind: "github-installation" }, action: "github.projection.apply", target: { repositories: ["findmydoc-platform/management"] } });
    await github.request("https://api.github.com/repos/findmydoc-platform/management/issues", { errorMessage: "safe" });
    await expect(github.request("https://api.github.com/repos/findmydoc-platform/management/issues/1", { operation: "mutation", method: "PATCH", body: { private: "seeded-private-payload" }, errorMessage: "safe" })).rejects.toMatchObject({ status: 0 });
    return Response.json({ unchanged: true });
  });
  expect(response.status).toBe(200); expect({ reads, writes }).toEqual({ reads: 2, writes: 1 });
  const completion = records().find(record => record.event === "request.completed");
  expect(completion).toMatchObject({ method: "POST", route: "/api/tasks/[id]/sync-github", externalCalls: { total: 4, operations: { "github.read": 2, "github.mutation": 2 }, providers: { github: 4 } } });
  expect(completion.phases.filter((phase: { kind: string }) => phase.kind === "http")).toHaveLength(4);
  expect(JSON.stringify(records())).not.toMatch(/seeded-private|private-id/);
});

test("actual task-detail HTTP entry preserves denial and hides caller path and diagnostic values", async () => {
  administratorProtocol();
  const records = capture();
  vi.stubGlobal("fetch", async () => { throw new Error("Unauthenticated requests must not dispatch"); });
  const { GET } = await importTestModule("src/app/api/tasks/[id]/detail-data/route.ts", { "server-only": {} });
  const response = await GET(new NextRequest("https://example.test/api/tasks/seeded-private-id/detail-data?token=seeded-private-token", { headers: { "x-request-id": "seeded-private-id", "x-founderops-proxy-observation": "seeded-private-token", "x-runtime-log-detail-percent": "100" } }), { params: Promise.resolve({ id: "seeded-private-id" }) });
  expect(response.status).toBe(401);
  expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  expect(records().filter(record => record.event === "request.completed")).toEqual([expect.objectContaining({ method: "GET", route: "/api/tasks/[id]/detail-data", outcome: "denied", externalCalls: expect.objectContaining({ total: 0 }), completeness: expect.objectContaining({ correlation: "invalid", externalCallsComplete: false }) })]);
  expect(records().find(record => record.event === "request.completed").phases.some((phase: { operation: string }) => phase.operation === "response.prepare")).toBe(true);
  expect(JSON.stringify(records())).not.toContain("seeded-private");
});

test("bounded phase detail keeps duration aggregates for every real provider attempt", async () => {
  configureGitHub(); const records = capture();
  vi.stubGlobal("fetch", async (input: string) => String(input).endsWith("/access_tokens")
    ? Response.json({ token: "synthetic-installation", expires_at: new Date(Date.now() + 3600000).toISOString() }) : Response.json([]));
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const { observeRuntimeRoute } = await import("../../../src/lib/runtime-logging");
  await observeRuntimeRoute("task.github-sync", new Request("https://example.test/"), async () => {
    const { github } = await authorizeCredentialAction({ credential: { kind: "github-installation" }, action: "github.issue.read", target: { repositories: ["findmydoc-platform/management"] } });
    for (let index = 0; index < 80; index++) await github.request("https://api.github.com/repos/findmydoc-platform/management/issues", { errorMessage: "safe" });
    return Response.json({ ok: true });
  });
  const completion = records().find(record => record.event === "request.completed");
  expect(completion.externalCalls).toMatchObject({ total: 81, operations: { "github.read": 80, "github.mutation": 1 } });
  expect(completion.externalCalls.durationMsByOperation["github.read"]).toBeGreaterThan(0);
  expect(completion.phases.length).toBeLessThanOrEqual(64);
  expect(completion.completeness.phasesTruncated).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(completion))).toBeLessThan(16 * 1024);
});

test("overlapping requests keep independent counts and GraphQL POST remains a read", async () => {
  configureGitHub(); const records = capture();
  let entered!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal("fetch", async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname;
    if (path === "/app/installations/456") { entered(); await gate; return Response.json({ id: 456 }); }
    if (path.endsWith("/access_tokens")) return Response.json({ token: "synthetic-installation", expires_at: new Date(Date.now() + 3600000).toISOString() });
    expect(path).toBe("/graphql"); expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body)).query).toMatch(/^query/);
    return Response.json({ data: { parentRepository: { issue: { id: "parent-node", number: 1 } }, childRepository: { issue: { id: "child-node", number: 2, parent: { number: 1, repository: { nameWithOwner: "findmydoc-platform/management" } } } } } });
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const { observeRuntimeRoute } = await import("../../../src/lib/runtime-logging");
  const { connectGitHubSubIssue } = await importTestModule("src/lib/github.ts");
  const first = observeRuntimeRoute("github.status", new Request("https://example.test/"), async () => {
    expect(await authorizeCredentialAction({ credential: { kind: "github-installation" }, action: "github.installation.status" })).toMatchObject({ available: true });
    return Response.json({ ok: true });
  });
  await started;
  const second = await observeRuntimeRoute("task.github-sync", new Request("https://example.test/"), async () => {
    const { github } = await authorizeCredentialAction({ credential: { kind: "github-installation" }, action: "github.projection.apply", target: { repositories: ["findmydoc-platform/management"] } });
    await connectGitHubSubIssue({ token: github, parentRepository: "findmydoc-platform/management", parentIssueNumber: 1, childRepository: "findmydoc-platform/management", childIssueNumber: 2 });
    return Response.json({ ok: true });
  });
  release(); const firstResponse = await first;
  expect(second.headers.get("x-request-id")).not.toBe(firstResponse.headers.get("x-request-id"));
  const completed = records().filter(record => record.event === "request.completed");
  expect(completed).toHaveLength(2);
  expect(completed.find(record => record.route === "/api/github-app/status").externalCalls).toMatchObject({ total: 1, operations: { "github.read": 1 } });
  expect(completed.find(record => record.route === "/api/tasks/[id]/sync-github").externalCalls).toMatchObject({ total: 2, operations: { "github.read": 1, "github.mutation": 1 } });
});

test("the actual proxy replaces valid forged summaries and correlates the static task route", async () => {
  administratorProtocol();
  const records = capture();
  vi.stubGlobal("fetch", async () => { throw new Error("No synthetic session was supplied"); });
  const forgedId = "8ea34e08-8cc2-42ad-a562-87b700000001";
  const { proxy } = await importTestModule("src/proxy.ts", { "server-only": {} });
  const request = new NextRequest("https://example.test/api/tasks/seeded-private-id/detail-data", { headers: { "x-request-id": forgedId, "x-founderops-proxy-observation": JSON.stringify({ version: 1, requestId: forgedId, instanceId: forgedId, durationMs: 9999, status: 200, outcome: "success", externalCalls: { total: 999, operations: { "github.read": 999 }, complete: true } }) } });
  const forwarded = await proxy(request);
  const metadata = forwarded.headers.get("x-middleware-request-x-founderops-proxy-observation");
  expect(metadata).toBeTruthy(); expect(forwarded.headers.get("x-request-id")).not.toBe(forgedId);
  const { GET } = await importTestModule("src/app/api/tasks/[id]/detail-data/route.ts", { "server-only": {} });
  const response = await GET(new NextRequest(request.url, { headers: { "x-founderops-proxy-observation": metadata! } }), { params: Promise.resolve({ id: "seeded-private-id" }) });
  expect(response.status).toBe(401);
  expect(response.headers.get("x-request-id")).toBe(forwarded.headers.get("x-request-id"));
  const completion = records().find(record => record.event === "request.completed" && record.stage === "route");
  expect(completion).toMatchObject({ externalCalls: { total: 0 }, completeness: { correlation: "complete", proxyObserved: true, externalCallsComplete: true } });
  expect(JSON.stringify(records())).not.toMatch(/seeded-private-id|9999/);
});

test("sink failures preserve a completed write and the original thrown application error", async () => {
  configureGitHub(); let writes = 0;
  vi.stubGlobal("fetch", async (input: string) => {
    if (String(input).endsWith("/access_tokens")) return Response.json({ token: "synthetic-installation", expires_at: new Date(Date.now() + 3600000).toISOString() });
    writes++; return Response.json({ id: 1 });
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const { observeRuntimeRoute } = await import("../../../src/lib/runtime-logging");
  vi.spyOn(process.stdout, "write").mockImplementation(() => { throw new Error("seeded-private-sink-error"); });
  const fallback = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const request = new Request("https://example.test/");
  const response = await observeRuntimeRoute("task.github-sync", request, async () => {
    const { github } = await authorizeCredentialAction({ credential: { kind: "github-installation" }, action: "github.projection.apply", target: { repositories: ["findmydoc-platform/management"] } });
    await github.request("https://api.github.com/repos/findmydoc-platform/management/issues/1", { method: "PATCH", operation: "mutation", body: { state: "closed" }, errorMessage: "safe" });
    return Response.json({ ok: true });
  });
  expect(await response.json()).toEqual({ ok: true }); expect(writes).toBe(1);
  const original = new Error("seeded-private-application-error");
  await expect(observeRuntimeRoute("task.github-sync", request, async () => { throw original; })).rejects.toBe(original);
  expect(fallback.mock.calls.flat().join("")).not.toContain("seeded-private");
});
