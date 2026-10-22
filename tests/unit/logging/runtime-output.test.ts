import { EventEmitter } from "node:events";
import { afterEach, expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

class Sink extends EventEmitter {
  lines: string[] = [];
  write(line: string) { this.lines.push(line); return true; }
}
const requestId = "8ea34e08-8cc2-42ad-a562-87b7c11362b4";
const instanceId = "2f281f12-aaed-4f75-8b2f-1b69a5c6645c";
const completion = () => ({ requestId, instanceId, stage: "route", status: 200, outcome: "success", durationMs: 5,
  completeness: { correlation: "missing", externalCallsComplete: false, cache: "unavailable" } });
const adapter = () => importTestModule("src/lib/runtime-logging/output.ts", { "server-only": {} });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

test("the serialized event projects approved fields and omits seeded private data", async () => {
  const { createRuntimeLogger } = await adapter();
  const sink = new Sink(); const fallback = new Sink();
  const logger = createRuntimeLogger(sink, fallback);
  const secret = "seeded-cookie-token-private-host.example.invalid";
  const event = { ...completion(), token: secret, headers: { authorization: secret }, message: secret,
    err: new Error(secret, { cause: new Error(secret) }), deploymentId: secret, vercelId: secret,
    proxy: { requestId, instanceId, durationMs: 3, status: 200, outcome: "success", cookie: secret },
  };
  logger.completed(event);
  expect(sink.lines).toHaveLength(1);
  expect(sink.lines[0]).not.toContain(secret);
  expect(JSON.parse(sink.lines[0])).toMatchObject({ event: "request.completed", severity: "info", level: 30,
    schemaVersion: 1, scope: "calendar", operation: "calendar.request", requestId, instanceId,
    proxy: { requestId, instanceId, durationMs: 3 }, observedProcessingMs: 8,
  });
  expect(JSON.parse(sink.lines[0])).not.toHaveProperty("pid");
  expect(JSON.parse(sink.lines[0])).not.toHaveProperty("hostname");
  expect(fallback.lines).toEqual([]);
});

test.each([1999.999, 2000])("local observed processing threshold %s ms selects application severity", async elapsed => {
  const { createRuntimeLogger } = await adapter(); const sink = new Sink();
  createRuntimeLogger(sink, new Sink()).completed({ ...completion(), durationMs: elapsed - 1000,
    proxy: { requestId, instanceId, durationMs: 1000, status: 200, outcome: "success" } });
  expect(JSON.parse(sink.lines[0])).toMatchObject({ severity: elapsed < 2000 ? "info" : "warn", observedProcessingMs: elapsed });
});

test.each(["sync", "async", "backpressure", "serialization", "fallback"])("%s failure drops bounded telemetry without escaping or recursing", async mode => {
  const { createRuntimeLogger } = await adapter(); const sink = new Sink(); const fallback = new Sink();
  const logger = createRuntimeLogger(sink, fallback);
  const privateError = new Error("seeded-private-cookie-and-provider-stack");
  if (mode === "sync" || mode === "fallback") sink.write = () => { throw privateError; };
  if (mode === "async") sink.emit("error", privateError);
  if (mode === "backpressure") sink.write = (line: string) => { sink.lines.push(line); return false; };
  if (mode === "fallback") fallback.write = () => { throw privateError; };
  const event = completion();
  if (mode === "serialization") Object.defineProperty(event, "requestId", { get() { throw privateError; } });
  for (let attempt = 0; attempt < 100; attempt++) expect(() => logger.completed(event)).not.toThrow();
  expect(sink.lines.length).toBeLessThanOrEqual(1);
  expect(fallback.lines.length).toBeLessThanOrEqual(1);
  expect([...sink.lines, ...fallback.lines].join("")).not.toContain(privateError.message);
  expect(() => fallback.emit("error", privateError)).not.toThrow();
  if (mode === "backpressure") {
    sink.emit("drain");
    logger.completed(completion());
    expect(sink.lines).toHaveLength(2);
  }
});

test("only approved failures are serialized, with fixed messages and bounded output", async () => {
  const { createRuntimeLogger } = await adapter(); const sink = new Sink();
  const logger = createRuntimeLogger(sink, new Sink());
  const secret = "seeded-provider-code-and-stack";
  const failure = { operation: "calendar.publications", errorCode: "calendar_data_unavailable", errorCategory: "provider_http_error", providerStatus: 503,
    message: secret, stack: secret, cause: new Error(secret) };
  logger.failed({ ...completion(), outcome: "error", failure, phases: Array.from({ length: 5000 }, () => ({ message: secret })) }, failure);
  logger.completed({ ...completion(), outcome: "error", failure });
  expect(sink.lines.map(line => JSON.parse(line).event)).toEqual(["operation.failed", "request.completed"]);
  for (const line of sink.lines) {
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(16 * 1024);
    expect(line).not.toContain(secret);
    expect(JSON.parse(line)).toMatchObject({ severity: "error", failure: { errorCode: "calendar_data_unavailable", providerStatus: 503 } });
  }
  logger.failed(completion(), { operation: secret, errorCode: secret, errorCategory: "unexpected_error" });
  expect(sink.lines).toHaveLength(2);
});

test("a backed-up fallback never accumulates another write until drain", async () => {
  const { createRuntimeLogger } = await adapter(); const sink = new Sink(); const fallback = new Sink();
  sink.write = () => { throw new Error("seeded-private-sink-error"); };
  fallback.write = (line: string) => { fallback.lines.push(line); return false; };
  const now = vi.spyOn(performance, "now");
  const logger = createRuntimeLogger(sink, fallback);
  for (let attempt = 0; attempt < 100; attempt++) {
    now.mockReturnValue(attempt * 60_001);
    logger.completed(completion());
  }
  expect(fallback.lines).toHaveLength(1);
  fallback.emit("drain");
  now.mockReturnValue(6_000_100);
  logger.completed(completion());
  expect(fallback.lines).toHaveLength(2);
});


test("fast successful hits retain exactly one deterministic request-ID sample in ten", async () => {
  const { createRuntimeLogger } = await adapter(); const sink = new Sink(); const logger = createRuntimeLogger(sink, new Sink());
  const phases = [{ id: "route:1", operation: "calendar.authorization", kind: "operation", offsetMs: 0, durationMs: 5, outcome: "success" }];
  for (let id = 0; id < 10; id++) logger.completed({ ...completion(), requestId: `8ea34e08-8cc2-42ad-a562-87b7${id.toString(16).padStart(8, "0")}`,
    membership: { result: "hit", reason: "cached", cacheOwnerId: instanceId, evidenceAgeMs: 10, remainingLifetimeMs: 899990, expired: false }, phases });
  const records = sink.lines.map(line => JSON.parse(line));
  expect(records).toHaveLength(10);
  expect(records.filter(record => record.detailRetained).map(record => record.requestId)).toEqual(["8ea34e08-8cc2-42ad-a562-87b700000000"]);
  expect(records.filter(record => !record.detailRetained).every(record => record.phases.length === 0)).toBe(true);
});

test("tail selection retains misses, expiry, errors and exact-threshold slowness", async () => {
  const { createRuntimeLogger } = await adapter(); const sink = new Sink(); const logger = createRuntimeLogger(sink, new Sink());
  const phase = { id: "route:1", operation: "calendar.authorization", kind: "operation", offsetMs: 0, durationMs: 1, outcome: "success" };
  for (const mode of ["miss", "expired", "error", "slow"]) logger.completed({ ...completion(), requestId: "8ea34e08-8cc2-42ad-a562-87b700000001",
    durationMs: mode === "slow" ? 2000 : 1, outcome: mode === "error" ? "error" : "success", phases: [phase],
    ...(mode === "miss" || mode === "expired" ? { membership: { result: mode, reason: mode === "miss" ? "not_found" : "observed_expiry", cacheOwnerId: instanceId, evidenceAgeMs: null, remainingLifetimeMs: null, expired: mode === "expired" } } : {}),
  });
  expect(sink.lines.map(line => JSON.parse(line)).every(record => record.detailRetained && record.phases.length === 1)).toBe(true);
});

test("phase truncation preserves compact failure, cache, counters and coverage within the byte bound", async () => {
  const { createRuntimeLogger } = await adapter(); const sink = new Sink();
  const secret = "seeded-private-phase-message";
  createRuntimeLogger(sink, new Sink()).completed({ ...completion(), outcome: "error",
    failure: { operation: "calendar.publications", errorCode: "calendar_data_unavailable", errorCategory: "provider_http_error", providerStatus: 503 },
    membership: { result: "miss", reason: "not_found", cacheOwnerId: instanceId, evidenceAgeMs: null, remainingLifetimeMs: null, expired: false, token: secret },
    externalCalls: { total: 80, complete: false, operations: { "calendar.publications": 80, [secret]: 999 } },
    phases: Array.from({ length: 80 }, (_, index) => ({ id: `route:${index + 1}`, operation: "calendar.publications", kind: "http", offsetMs: index, durationMs: 1, outcome: "error", message: secret })),
  });
  expect(sink.lines).toHaveLength(1); expect(Buffer.byteLength(sink.lines[0])).toBeLessThanOrEqual(16 * 1024);
  expect(sink.lines[0]).not.toContain(secret);
  expect(JSON.parse(sink.lines[0])).toMatchObject({ externalCalls: { total: 80, operations: { "calendar.publications": 80 } },
    completeness: { externalCallsComplete: false, phasesTruncated: true }, membership: { result: "miss" }, failure: { providerStatus: 503 } });
  expect(JSON.parse(sink.lines[0]).phases.length).toBeLessThanOrEqual(64);
});


test("registered requests retain their static method and route and aggregate the four provider areas", async () => {
  const { createRuntimeLogger } = await adapter(); const sink = new Sink();
  createRuntimeLogger(sink, new Sink()).completed({ ...completion(), routeKey: "task.comment",
    externalCalls: { total: 6, complete: true, operations: { "supabase.user": 1, "supabase.db.read": 2, "google.calendar.read": 1, "github.read": 1, "github.mutation": 1 } },
  });
  expect(JSON.parse(sink.lines[0])).toMatchObject({ scope: "planning", operation: "request.workflow", method: "POST", route: "/api/tasks/[id]/comments",
    externalCalls: { total: 6, providers: { supabase_auth: 1, supabase_db: 2, google_workspace: 1, github: 2 } },
    completeness: { externalCallsScope: "registered_provider_transports", externalCallsComplete: false, uninstrumented: ["vercel_oidc_internal", "browser_and_ssr"] },
  });
});

test("server detail percentage retains bounded phases without accepting caller detail flags", async () => {
  const { createRuntimeLogger } = await adapter(); const sink = new Sink(); const logger = createRuntimeLogger(sink, new Sink());
  const value = { ...completion(), requestId: "8ea34e08-8cc2-42ad-a562-87b700000001", routeKey: "task.detail",
    phases: [{ id: "route:1", operation: "request.workflow", kind: "operation", offsetMs: 0, durationMs: 1, outcome: "success" }], detailPercent: 100 };
  logger.completed(value);
  vi.stubEnv("RUNTIME_LOG_DETAIL_PERCENT", "100");
  logger.completed(value);
  vi.stubEnv("RUNTIME_LOG_DETAIL_PERCENT", "101");
  logger.completed(value);
  expect(sink.lines.map(line => JSON.parse(line).detailRetained)).toEqual([false, true, false]);
  expect(JSON.parse(sink.lines[1])).toMatchObject({ retentionReason: "configured_sample", phases: value.phases });
});
