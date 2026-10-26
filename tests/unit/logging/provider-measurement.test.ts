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
  expect(completion.requestId).not.toBe(forgedId);
  expect(completion.externalCalls.operations).not.toHaveProperty("github.read");
  expect(completion.proxy.durationMs).not.toBe(9999);
  expect(JSON.stringify(records())).not.toContain("seeded-private-id");
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


test.each([404, 403, 503])("GitHub accepted dependency absence preserves counts and only accepts its declared status: %s", async status => {
  configureGitHub(); const records = capture(); let deletes = 0;
  vi.stubGlobal("fetch", async (input: string) => {
    if (String(input).endsWith("/access_tokens")) return Response.json({ token: "synthetic-installation", expires_at: new Date(Date.now() + 3600000).toISOString() });
    deletes++; return Response.json({ message: "synthetic-provider-result" }, { status });
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const { observeRuntimeRoute } = await import("../../../src/lib/runtime-logging");
  await observeRuntimeRoute("task.github-sync", new Request("https://example.test/"), async () => {
    const { github } = await authorizeCredentialAction({ credential: { kind: "github-installation" }, action: "github.projection.apply", target: { repositories: ["findmydoc-platform/management"] } });
    const deletion = github.request("https://api.github.com/repos/findmydoc-platform/management/issues/1/dependencies/blocked_by/2", { method: "DELETE", operation: "mutation", allowedStatuses: [404], errorMessage: "safe" });
    if (status === 404) expect((await deletion).status).toBe(404);
    else await expect(deletion).rejects.toMatchObject({ status });
    return Response.json({ ok: status === 404 });
  });
  expect(deletes).toBe(1);
  const completion = records().find(record => record.event === "request.completed");
  expect(completion).toMatchObject({ outcome: status === 404 ? "success" : "error", externalCalls: { total: 2, operations: { "github.mutation": 2 } } });
  expect(completion.externalCalls.durationMsByOperation["github.mutation"]).toBeGreaterThan(0);
  expect(records().filter(record => record.event === "operation.failed")).toHaveLength(status === 404 ? 0 : 1);
});

test.each([[404, "rejected"], [409, "rejected"], [422, "invalid_input"], [424, "rejected"], [429, "rejected"]])("HTTP status %s retains a non-success completion", async (status, outcome) => {
  vi.stubEnv("RUNTIME_LOG_DETAIL_PERCENT", "0"); const records = capture();
  const { observeRuntimeRoute } = await importTestModule("src/lib/runtime-logging/index.ts", { "server-only": {} });
  const response = await observeRuntimeRoute("workweek.draft.write", new Request("https://example.test/"), async () => Response.json({ code: "synthetic-result" }, { status: Number(status) }));
  expect(response.status).toBe(status);
  expect(records().find(record => record.event === "request.completed")).toMatchObject({ status, outcome, retentionReason: "non_success", detailRetained: true });
});


test("completed measurements retain late operation aggregates and slow spans after phase truncation", async () => {
  vi.stubEnv("RUNTIME_LOG_DETAIL_PERCENT", "0"); const records = capture();
  const { performance } = await import("node:perf_hooks");
  let clock = 0; vi.spyOn(performance, "now").mockImplementation(() => clock);
  const { observeRuntimeRoute, observeRuntimePhase, observeRuntimePreparation } = await importTestModule("src/lib/runtime-logging/index.ts", { "server-only": {} });
  await observeRuntimeRoute("planning.board", new Request("https://example.test/"), async () => {
    for (let index = 0; index < 80; index++) await observeRuntimePhase("supabase.user", async () => { clock += 1; }, "http");
    await observeRuntimePhase("workspace.permit.release", async () => { clock += 400; });
    await observeRuntimePhase("workspace.permit.release", async () => { clock += 200; });
    observeRuntimePreparation(() => { clock += 10; });
    return Response.json({ unchanged: true });
  });
  const completion = records().find(record => record.event === "request.completed");
  expect(completion).toMatchObject({ detailRetained: false, phases: [],
    phaseAggregates: { "supabase.user": { http: [80, 80, 1] }, "workspace.permit.release": { operation: [2, 600, 400] }, "response.prepare": { operation: [1, 10, 10] } },
    completeness: { phaseAggregatesComplete: true, phaseAggregatesScope: "route", phasesTruncated: true },
  });
  expect(completion.slowestPhases).toHaveLength(8);
  expect(completion.slowestPhases).toContainEqual(expect.objectContaining({ operation: "workspace.permit.release", offsetMs: 80, durationMs: 400 }));
  expect(completion.slowestPhases).toContainEqual(expect.objectContaining({ operation: "response.prepare", offsetMs: 680, durationMs: 10 }));
});


test("the public Board response distinguishes its reads, header, avatars, mapping and serialization", async () => {
  const protocol = administratorProtocol({ role: "viewer" }); const records = capture();
  vi.stubEnv("RUNTIME_LOG_DETAIL_PERCENT", "100");
  const { performance } = await import("node:perf_hooks"); let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  let itemsEntered!: () => void, releaseItems!: () => void;
  const itemsStarted = new Promise<void>(resolve => { itemsEntered = resolve; });
  const itemsGate = new Promise<void>(resolve => { releaseItems = resolve; });
  let projectReadFinished = false, strategyReadFinished = false;
  const authFetch = globalThis.fetch;
  const reads: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), path = new URL(request.url).pathname;
    if (path === "/rest/v1/projects") { reads.push(path); projectReadFinished = true; return Response.json({ id: "findmydoc-founder-execution", name: "Synthetic board" }); }
    if (path === "/rest/v1/active_tasks") { reads.push(path); itemsEntered(); await itemsGate; return Response.json([]); }
    if (path === "/rest/v1/planning_item_strategy") { reads.push(path); strategyReadFinished = true; return Response.json([]); }
    if (path === "/auth/v1/user" && clock === 0) clock = 25;
    if (path === "/rest/v1/profiles") { reads.push(path); return Response.json([{ id: "synthetic-profile", name: "Seeded private name", platform_role: "viewer" }]); }
    if (path === "/rest/v1/rpc/workspace_access_contexts") return Response.json([{ profileId: "synthetic-profile", linked: false }]);
    if (path.startsWith("/rest/v1/") && !path.includes("/rpc/")) { reads.push(path); return Response.json([]); }
    return authFetch(request);
  });
  const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {}, "next/cache": { unstable_cache: (load: () => unknown) => load } });
  const pending = GET(protocol.request("/api/planning-board-data?private=seeded-private"));
  await itemsStarted;
  // Drain the other reads' promise continuations while the item response stays held.
  await new Promise<void>(resolve => setImmediate(resolve));
  try {
    expect(projectReadFinished).toBe(true);
    expect(strategyReadFinished).toBe(true);
  } finally {
    clock = 225;
    releaseItems();
  }
  const response = await pending;
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ model: { project: { name: "Synthetic board" } }, headerData: { quickLinks: { state: "ready" } }, currentProfile: { platformRole: "viewer" } });
  const completion = records().find(record => record.event === "request.completed");
  for (const operation of ["board.authorization", "board.load", "board.header", "board.project", "board.profiles", "board.items", "board.strategy", "board.raci", "board.links", "board.sprints", "board.relationships", "board.preferences", "board.avatars", "board.map", "response.prepare"]) {
    expect(completion.phaseAggregates[operation]?.operation?.[0], operation).toBe(1);
  }
  expect(completion.phaseAggregates["board.items"].operation).toEqual([1, 200, 200]);
  expect(completion.phaseAggregates["board.project"].operation).toEqual([1, 0, 0]);
  expect(completion.phaseAggregates["board.strategy"].operation).toEqual([1, 0, 0]);
  expect([...completion.phases, ...completion.slowestPhases]).toContainEqual(expect.objectContaining({ operation: "board.items", offsetMs: 25, durationMs: 200 }));
  expect(reads.filter(path => path === "/rest/v1/active_tasks")).toHaveLength(1);
  expect(JSON.stringify(records())).not.toMatch(/seeded-private|Seeded private name|synthetic-profile/);
});


test("late failed HTTP spans keep their error outcome outside retained chronological detail", async () => {
  const records = capture();
  const { performance } = await import("node:perf_hooks"); let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const { observeRuntimeRoute, observeRuntimePhase, observeProviderHttp } = await importTestModule("src/lib/runtime-logging/index.ts", { "server-only": {} });
  const original = Response.json({ unchanged: true });
  expect(await observeRuntimeRoute("planning.board", new Request("https://example.test/"), async () => {
    for (let index = 0; index < 80; index++) await observeRuntimePhase("supabase.user", async () => { clock++; });
    await observeProviderHttp("workspace.permit.release", async () => { clock += 500; return Response.json({ message: "seeded-private" }, { status: 503 }); });
    return original;
  })).toBe(original);
  const record = records().find(record => record.event === "request.completed");
  expect(record).toMatchObject({ outcome: "error", phaseAggregates: { "workspace.permit.release": { http: [1, 500, 500] } } });
  expect(record.slowestPhases).toContainEqual(expect.objectContaining({ operation: "workspace.permit.release", kind: "http", outcome: "error", durationMs: 500 }));
  expect(JSON.stringify(records())).not.toContain("seeded-private");
});

test("a completion reports unfinished observations and does not count a still-pending span", async () => {
  const records = capture(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { observeRuntimeRoute, observeRuntimePhase } = await importTestModule("src/lib/runtime-logging/index.ts", { "server-only": {} });
  let pending!: Promise<void>;
  await observeRuntimeRoute("planning.board", new Request("https://example.test/"), async () => {
    pending = observeRuntimePhase("board.header", () => gate);
    return Response.json({ unchanged: true });
  });
  const record = records().find(record => record.event === "request.completed");
  expect(record.completeness.phaseAggregatesComplete).toBe(false);
  expect(record.phaseAggregates).not.toHaveProperty("board.header");
  release(); await pending;
  expect(records().filter(record => record.event === "request.completed")).toHaveLength(1);
});

test("proxy detail truncation keeps the existing forwarding budget and separate complete measurements", async () => {
  const records = capture();
  const { NextResponse } = await import("next/server");
  const { observeRuntimeProxy, observeRuntimeRoute, observeRuntimePhase } = await importTestModule("src/lib/runtime-logging/index.ts", { "server-only": {} });
  const request = new NextRequest("https://example.test/api/planning-board-data");
  const forwarded = await observeRuntimeProxy(request, async () => {
    for (let index = 0; index < 80; index++) await observeRuntimePhase("supabase.user", async () => undefined);
    return NextResponse.next();
  });
  const metadata = forwarded.headers.get("x-middleware-request-x-founderops-proxy-observation");
  expect(metadata).toBeTruthy(); expect(Buffer.byteLength(metadata!)).toBeLessThan(1024);
  await observeRuntimeRoute("planning.board", new Request(request.url, { headers: { "x-founderops-proxy-observation": metadata! } }), async () => Response.json({ unchanged: true }));
  const completed = records().filter(record => record.event === "request.completed");
  expect(completed).toHaveLength(2);
  expect(completed[0]).toMatchObject({ stage: "proxy", requestId: forwarded.headers.get("x-request-id"), phaseAggregates: { "supabase.user": { operation: [80, expect.any(Number), expect.any(Number)] } }, completeness: { phaseAggregatesScope: "proxy", phaseAggregatesComplete: true } });
  expect(completed[1]).toMatchObject({ stage: "route", requestId: completed[0].requestId, completeness: { correlation: "complete", phaseAggregatesScope: "route", phaseAggregatesComplete: true } });
  expect(completed[1].phaseAggregates).not.toHaveProperty("supabase.user");
});


test("parallel inclusive span totals stay distinct from elapsed request time", async () => {
  const records = capture(); const { performance } = await import("node:perf_hooks"); let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const { observeRuntimeRoute, observeRuntimePhase } = await importTestModule("src/lib/runtime-logging/index.ts", { "server-only": {} });
  await observeRuntimeRoute("planning.board", new Request("https://example.test/"), async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const first = observeRuntimePhase("supabase.user", () => gate, "http");
    const second = observeRuntimePhase("supabase.user", () => gate, "http");
    clock = 10; release(); await Promise.all([first, second]);
    return Response.json({ unchanged: true });
  });
  expect(records().find(record => record.event === "request.completed")).toMatchObject({ durationMs: 10,
    phaseAggregates: { "supabase.user": { http: [2, 20, 10] }, "request.workflow": { operation: [1, 10, 10] } },
  });
});
