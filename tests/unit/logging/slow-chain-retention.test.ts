import { afterEach, expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules(); });
function capture() {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(line => { lines.push(String(line)); return true; });
  return () => lines.filter(line => line.startsWith('{"level"')).map(line => JSON.parse(line));
}
type Span = { id: string; parentId?: string; operation: string; offsetMs: number; durationMs: number };
function assertClosed(phases: Span[]) {
  expect(phases.length).toBeLessThanOrEqual(32);
  expect(Buffer.byteLength(JSON.stringify(phases))).toBeLessThanOrEqual(6000);
  for (const phase of phases) if (phase.parentId) expect(phases.some(parent => parent.id === phase.parentId)).toBe(true);
}

test("parallel late reads keep separate prepare and release parents with inclusive times", async () => {
  const records = capture(); const { performance } = await import("node:perf_hooks"); let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const { observeRuntimeRoute, observeRuntimePhase, observeProviderHttp } = await importTestModule("src/lib/runtime-logging/index.ts", { "server-only": {} });
  let releasePrepare!: () => void, releaseCleanup!: () => void;
  const prepareGate = new Promise<void>(resolve => { releasePrepare = resolve; });
  const cleanupGate = new Promise<void>(resolve => { releaseCleanup = resolve; });
  await observeRuntimeRoute("planning.board", new Request("https://example.test/"), async () => {
    for (let index = 0; index < 80; index++) await observeRuntimePhase("supabase.user", async () => {});
    const sprint = observeRuntimePhase("board.sprints", () => observeRuntimePhase("supabase.db.planning.read", async () => {
      await observeProviderHttp("workspace.dispatch.prepare", async () => { await prepareGate; return Response.json({}); });
      await observeProviderHttp("supabase.db.planning.read", async () => Response.json({}));
    }));
    const project = observeRuntimePhase("board.project", () => observeRuntimePhase("supabase.db.read", async () => {
      await observeProviderHttp("supabase.db.read", async () => Response.json({}));
      await observeProviderHttp("workspace.permit.release", async () => { await cleanupGate; return Response.json({}); });
    }));
    await new Promise<void>(resolve => setImmediate(resolve));
    clock = 100; releasePrepare(); await sprint;
    clock = 250; releaseCleanup(); await project;
    return Response.json({ unchanged: true });
  });
  const record = records().find(record => record.event === "request.completed");
  const phases: Span[] = record.slowChainPhases;
  assertClosed(phases);
  const prepare = phases.find(span => span.operation === "workspace.dispatch.prepare")!;
  const cleanup = phases.find(span => span.operation === "workspace.permit.release")!;
  const sprintSdk = phases.find(span => span.id === prepare.parentId)!;
  const projectSdk = phases.find(span => span.id === cleanup.parentId)!;
  expect(prepare).toMatchObject({ offsetMs: 0, durationMs: 100 });
  expect(cleanup).toMatchObject({ offsetMs: 0, durationMs: 250 });
  expect(sprintSdk).toMatchObject({ operation: "supabase.db.planning.read", durationMs: 100 });
  expect(projectSdk).toMatchObject({ operation: "supabase.db.read", durationMs: 250 });
  expect(phases.find(span => span.id === sprintSdk.parentId)).toMatchObject({ operation: "board.sprints", durationMs: 100 });
  expect(phases.find(span => span.id === projectSdk.parentId)).toMatchObject({ operation: "board.project", durationMs: 250 });
  expect(record.durationMs).toBe(250);
});

test("depth and shared span limits omit whole paths and preserve closed remaining evidence", async () => {
  const records = capture(); const { performance } = await import("node:perf_hooks"); let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const { observeRuntimeRoute, observeRuntimePhase } = await importTestModule("src/lib/runtime-logging/index.ts", { "server-only": {} });
  const nested = (depth: number): Promise<void> => observeRuntimePhase("supabase.db.planning.read", async () => {
    if (depth) await nested(depth - 1); else clock += 100;
  });
  await observeRuntimeRoute("planning.board", new Request("https://example.test/"), async () => {
    await nested(40);
    for (let branch = 0; branch < 20; branch++) await nested(7);
    return Response.json({ unchanged: true });
  });
  const completion = records().find(record => record.event === "request.completed");
  assertClosed(completion.slowChainPhases);
  expect(completion.slowChainPhases.length).toBeGreaterThan(0);
  expect(completion.completeness).toMatchObject({ slowChainsTruncated: true, slowChainsComplete: true });
  expect(completion.phaseAggregates["supabase.db.planning.read"].operation[0]).toBe(201);
  expect(Buffer.byteLength(JSON.stringify(completion))).toBeLessThan(16 * 1024);
});

test("completed children under an unfinished ancestor stay explicitly incomplete", async () => {
  const records = capture(); let release!: () => void, childDone!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const childFinished = new Promise<void>(resolve => { childDone = resolve; });
  const { observeRuntimeRoute, observeRuntimePhase } = await importTestModule("src/lib/runtime-logging/index.ts", { "server-only": {} });
  let pending!: Promise<void>;
  await observeRuntimeRoute("planning.board", new Request("https://example.test/"), async () => {
    pending = observeRuntimePhase("board.load", async () => {
      await observeRuntimePhase("board.sprints", async () => {});
      childDone(); await gate;
    });
    await childFinished;
    return Response.json({ unchanged: true });
  });
  const completion = records().find(record => record.event === "request.completed");
  expect(completion.completeness.slowChainsComplete).toBe(false);
  expect(completion.slowChainPhases).toEqual([]);
  release(); await pending;
  expect(records().filter(record => record.event === "request.completed")).toHaveLength(1);
});

test("observation without a request context preserves provider responses and thrown identities without output", async () => {
  const records = capture();
  const { observeRuntimePhase, observeProviderHttp, runtimeObservationActive } = await importTestModule("src/lib/runtime-logging/index.ts", { "server-only": {} });
  const original = Response.json({ private: "seeded-private" }); let dispatches = 0;
  expect(runtimeObservationActive()).toBe(false);
  expect(await observeProviderHttp("supabase.db.planning.read", async () => { dispatches++; return original; })).toBe(original);
  const failure = new Error("seeded-private");
  await expect(observeRuntimePhase("board.load", async () => { throw failure; })).rejects.toBe(failure);
  expect(dispatches).toBe(1);
  expect(records()).toEqual([]);
});


test("HTTP ends at Response while its SDK ancestor includes body work and awaited cleanup", async () => {
  const records = capture(); const { performance } = await import("node:perf_hooks"); let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const { observeRuntimeRoute, observeRuntimePhase, observeProviderHttp } = await importTestModule("src/lib/runtime-logging/index.ts", { "server-only": {} });
  let body!: ReadableStreamDefaultController<Uint8Array>, reading!: () => void;
  const bodyStarted = new Promise<void>(resolve => { reading = resolve; });
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { body = controller; } }));
  await observeRuntimeRoute("planning.board", new Request("https://example.test/"), async () => {
    const sdk = observeRuntimePhase("supabase.db.planning.read", async () => {
      expect(await observeProviderHttp("supabase.db.planning.read", async () => { clock = 10; return response; })).toBe(response);
      reading(); await response.text();
      await observeRuntimePhase("workspace.permit.release", async () => { clock += 50; });
    });
    await bodyStarted; clock = 110; body.enqueue(new TextEncoder().encode("safe")); body.close(); await sdk;
    return Response.json({ unchanged: true });
  });
  const completion = records().find(record => record.event === "request.completed");
  expect(completion.phaseAggregates["supabase.db.planning.read"]).toEqual({ operation: [1, 160, 160], http: [1, 10, 10] });
  expect(completion.phaseAggregates["workspace.permit.release"].operation).toEqual([1, 50, 50]);
  assertClosed(completion.slowChainPhases);
});

test("measurement failure preserves the operation result and marks its scope incomplete", async () => {
  const records = capture(); const { performance } = await import("node:perf_hooks");
  const now = vi.spyOn(performance, "now").mockReturnValue(0);
  const { observeRuntimeRoute, observeRuntimePhase } = await importTestModule("src/lib/runtime-logging/index.ts", { "server-only": {} });
  const original = Response.json({ unchanged: true });
  expect(await observeRuntimeRoute("planning.board", new Request("https://example.test/"), async () => {
    expect(await observeRuntimePhase("board.load", async () => {
      now.mockImplementationOnce(() => { throw new Error("seeded-private-measurement"); });
      return original;
    })).toBe(original);
    return original;
  })).toBe(original);
  const completion = records().find(record => record.event === "request.completed");
  expect(completion.completeness).toMatchObject({ phaseAggregatesComplete: false, slowChainsComplete: false });
  expect(JSON.stringify(completion)).not.toContain("seeded-private-measurement");
});
