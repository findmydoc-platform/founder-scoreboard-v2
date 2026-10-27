import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { NextResponse, type NextRequest } from "next/server";
import { createRuntimeLogger, isRequestId, safeFailure, safeProxy, safeOperations, type SafeOperation, type Phase, type MembershipObservation, type Completion, type ProxySummary, type SafeFailure, type Stage, type PhaseNode } from "./output";

import { matchRuntimeRoute, runtimeRoute, type RuntimeRouteKey } from "./routes";

const instanceId = randomUUID();
const proxyHeader = "x-founderops-proxy-observation";
type Context = { completion: Completion; started: number; nextPhase: { value: number }; parentId?: string; parentPhase?: Phase; ancestors?: PhaseNode[]; chainTruncated?: boolean };
const contexts = new AsyncLocalStorage<Context>();
const measuredOperations = new Set<string>(safeOperations);
let logger: ReturnType<typeof createRuntimeLogger> | undefined;
const emit = (completion: Completion, failure?: SafeFailure) => {
  try {
    logger ??= createRuntimeLogger();
    if (failure) logger.failed(completion, failure);
    else logger.completed(completion);
  } catch { /* Diagnostics must never change application execution. */ }
};

function begin(stage: Stage, headers: Headers, routeKey: RuntimeRouteKey = "calendar.team") {
  let proxy: ProxySummary | undefined;
  let correlation: Completion["completeness"]["correlation"] = "missing";
  if (stage === "route") {
    const metadata = headers.get(proxyHeader);
    if (metadata !== null) {
      correlation = "invalid";
      try {
        if (Buffer.byteLength(metadata) < 1024) {
          const value = JSON.parse(metadata);
          // Only complete, schema-tagged proxy summaries may select a diagnostic ID.
          if (value.version === 1 && Number.isFinite(value.durationMs) && value.durationMs >= 0 && value.durationMs <= 86_400_000
            && value.status === 200 && value.outcome === "success") proxy = safeProxy(value);
          if (proxy) correlation = "complete";
        }
      } catch { /* Missing telemetry is not missing authority. */ }
    }
  }
  const completion: Completion = { routeKey, requestId: proxy?.requestId || randomUUID(), instanceId, stage,
    status: 500, outcome: "error", durationMs: 0, ...(proxy ? { proxy } : {}),
    vercelId: headers.get("x-vercel-id") || undefined,
    deploymentEnv: process.env.VERCEL_ENV, deploymentId: process.env.VERCEL_DEPLOYMENT_ID, region: process.env.VERCEL_REGION,
    phases: [], phaseMeasurement: { aggregates: {}, slowest: [], pending: 0, failed: false, chains: [], chainsTruncated: false }, externalCalls: { total: 0, operations: {}, durationMsByOperation: {}, complete: true },
    completeness: { correlation, externalCallsComplete: false, cache: "unavailable" },
  };
  return { completion, started: performance.now(), nextPhase: { value: 0 } };
}

export function recordRuntimeFailure(reason: SafeFailure) {
  try {
    const context = contexts.getStore();
    const failure = safeFailure(reason);
    if (!context || !failure) return;
    context.completion.failure ??= failure;
    const phase = context.parentPhase;
    if (phase) phase.outcome = "error";
    emit(context.completion, failure);
  } catch { /* Telemetry is isolated from the observed operation. */ }
}

export const runtimeObservationActive = () => Boolean(contexts.getStore());
export const runtimeObservationScope = () => runtimeRoute(contexts.getStore()?.completion.routeKey)?.scope;

function startPhase(operation: SafeOperation, kind: Phase["kind"]) {
  const context = contexts.getStore();
  if (!context || !measuredOperations.has(operation) || !["operation", "http"].includes(kind)) return undefined;
  context.completion.phaseMeasurement!.pending++;
  const phase: Phase = { id: `${context.completion.stage}:${++context.nextPhase.value}`, ...(context.parentId ? { parentId: context.parentId } : {}),
    operation, kind, offsetMs: Math.max(0, performance.now() - context.started), durationMs: 0, outcome: "success" };
  if (context.completion.phases!.length < 64) context.completion.phases!.push(phase);
  else context.completion.phasesTruncated = true;
  const node: PhaseNode = { phase, completed: false, hasChildren: false };
  const ancestors = context.ancestors || [];
  if (ancestors.length) ancestors[ancestors.length - 1].hasChildren = true;
  const chainTruncated = context.chainTruncated === true || ancestors.length >= 32;
  const nodes = [...ancestors.slice(-31), node];
  return { context, phase, node, nodes, chainTruncated, started: performance.now() };
}

function finishPhase(active: NonNullable<ReturnType<typeof startPhase>>) {
  const measurement = active.context.completion.phaseMeasurement!;
  try {
    const phase = active.phase;
    phase.durationMs = Math.max(0, performance.now() - active.started);
    const kinds = measurement.aggregates[phase.operation] ??= {};
    const aggregate = kinds[phase.kind] ??= [0, 0, 0];
    aggregate[0]++;
    aggregate[1] += phase.durationMs;
    aggregate[2] = Math.max(aggregate[2], phase.durationMs);
    measurement.slowest.push(phase);
    measurement.slowest.sort((left, right) => right.durationMs - left.durationMs);
    measurement.slowest.length = Math.min(measurement.slowest.length, 8);
    active.node.completed = true;
    // Terminal spans preserve the provider boundary without ancestors displacing it.
    if (!active.node.hasChildren) {
      const chains = measurement.chains!;
      chains.push({ nodes: active.nodes, truncated: active.chainTruncated });
      chains.sort((left, right) => right.nodes[right.nodes.length - 1].phase.durationMs - left.nodes[left.nodes.length - 1].phase.durationMs);
      if (chains.length > 8) { chains.length = 8; measurement.chainsTruncated = true; }
    }
  } catch { measurement.failed = true; } finally { measurement.pending--; }
}

export function classifyRuntimeError(error: unknown): SafeFailure["errorCategory"] {
  try {
    const name = error && typeof error === "object" && "name" in error ? error.name : undefined;
    return name === "TimeoutError" || name === "AbortError" ? "timeout" : error instanceof TypeError ? "transport_error" : "unexpected_error";
  } catch { return "unexpected_error"; }
}

export function observeRuntimePhase<T>(operation: SafeOperation, run: () => PromiseLike<T>, kind: Phase["kind"] = "operation"): Promise<T> {
  let active: ReturnType<typeof startPhase>;
  try { active = startPhase(operation, kind); } catch { /* Best effort. */ }
  const execute = async () => {
    try { return await run(); } catch (error) {
      if (active) active.phase.outcome = "error";
      // HTTP dispatch is the failure origin; enclosing phases preserve its classification.
      if (kind === "http") recordRuntimeFailure({ operation, errorCode: "provider_request_failed", errorCategory: classifyRuntimeError(error) });
      throw error;
    } finally { if (active) finishPhase(active); }
  };
  return active ? contexts.run({ ...active.context, parentId: active.phase.id, parentPhase: active.phase, ancestors: active.nodes, chainTruncated: active.chainTruncated }, execute) : execute();
}

export function observeRuntimePreparation<T>(run: () => T, operation: SafeOperation = "response.prepare"): T {
  let active: ReturnType<typeof startPhase>;
  try { active = startPhase(operation, "operation"); } catch { /* Best effort. */ }
  try { return run(); } catch (error) { if (active) active.phase.outcome = "error"; throw error; } finally { if (active) finishPhase(active); }
}

export const observeCalendarPreparation = <T>(run: () => T): T => observeRuntimePreparation(run, "calendar.prepare");

export function observeRuntimeResultPhase<T extends { error: unknown }>(operation: SafeOperation, run: () => PromiseLike<T>, errorCode: SafeFailure["errorCode"] = "provider_request_failed"): Promise<T> {
  return observeRuntimePhase(operation, async () => {
    const result = await run();
    recordRuntimeResult(operation, result.error, errorCode);
    return result;
  });
}

export function recordRuntimeResult(operation: SafeOperation, error: unknown, errorCode: SafeFailure["errorCode"] = "provider_request_failed") {
  try {
    // Only known authority results are denials; other RPC errors remain failures.
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    const expectedDenial = (["calendar.profile", "supabase.db.identity.rpc", "workspace.permit.issue", "workspace.dispatch.prepare"].includes(operation) && code === "42501")
      || (["calendar.profile", "supabase.db.identity.rpc"].includes(operation) && code === "workspace_access_denied");
    if (error && !expectedDenial) recordRuntimeFailure({ operation, errorCode, errorCategory: "provider_http_error" });
  } catch { /* Diagnostics must not change the SDK result. */ }
}

export function observeProviderHttp(operation: SafeOperation, dispatch: () => Promise<Response>, allowedStatuses: readonly number[] = []): Promise<Response> {
  const calls = contexts.getStore()?.completion.externalCalls;
  const started = performance.now();
  try {
    if (calls) { calls.total++; calls.operations[operation] = (calls.operations[operation] || 0) + 1; if (operation === "supabase.other") calls.complete = false; }
  } catch { /* Best effort. */ }
  return observeRuntimePhase(operation, async () => {
    const response = await dispatch();
    const expectedAuthDenial = ["supabase.user", "supabase.refresh"].includes(operation) && response.status >= 400 && response.status < 500;
    // Let the existing SDK result distinguish an authority denial from a provider failure.
    const deferredRpcDenial = ["calendar.profile", "supabase.db.identity.rpc", "workspace.permit.issue", "workspace.dispatch.prepare"].includes(operation) && response.status === 403;
    if (!response.ok && !allowedStatuses.includes(response.status) && !expectedAuthDenial && !deferredRpcDenial) recordRuntimeFailure({ operation, errorCode: "provider_request_failed", errorCategory: "provider_http_error", providerStatus: response.status });
    return response;
  }, "http").finally(() => {
    try {
      if (calls?.durationMsByOperation) calls.durationMsByOperation[operation] = (calls.durationMsByOperation[operation] || 0) + Math.max(0, performance.now() - started);
    } catch { /* Aggregate timing cannot affect dispatch or its failure. */ }
  });
}

export function recordWorkspaceMembership(value: MembershipObservation) {
  try { const context = contexts.getStore(); if (context) context.completion.membership = value; } catch { /* Best effort. */ }
}

export function recordDirectoryCredential(result: "reused" | "renewed") {
  try { const context = contexts.getStore(); if (context) context.completion.directoryCredential = { result }; } catch { /* Best effort. */ }
}

export function recordRuntimeDenial(code: string | undefined) {
  try { const context = contexts.getStore(); if (context) context.completion.deniedCode = code; } catch { /* Best effort. */ }
}

function finish(context: ReturnType<typeof begin>, response?: Response) {
  const value = context.completion;
  value.durationMs = Math.max(0, performance.now() - context.started);
  value.status = response?.status || 500;
  value.outcome = value.failure || !response || value.status >= 500 ? "error" : [400, 422].includes(value.status) ? "invalid_input"
    : value.status === 401 || value.status === 403 ? "denied" : value.status >= 400 ? "rejected" : "success";
  emit(value);
  return value;
}

function isolateDiagnostics(run: () => void) {
  try { run(); } catch { try { logger?.dropped(); } catch { /* No recursive fallback. */ } }
}

export async function observeRuntimeRoute<T extends Response>(routeKey: RuntimeRouteKey, request: { headers: Headers }, run: () => Promise<T>): Promise<T> {
  const context = begin("route", request.headers, routeKey);
  return contexts.run(context, async () => {
    let response: T;
    try { response = await observeRuntimePhase(routeKey === "calendar.team" ? "calendar.request" : "request.workflow", run); } catch (error) {
      recordRuntimeFailure({ operation: routeKey === "calendar.team" ? "calendar.request" : "request.workflow", errorCode: routeKey === "calendar.team" ? "calendar_boundary_failure" : "request_boundary_failure", errorCategory: "unexpected_error" });
      isolateDiagnostics(() => { finish(context); });
      throw error;
    }
    isolateDiagnostics(() => { response.headers.set("x-request-id", context.completion.requestId); finish(context, response); });
    return response;
  });
}

export function observeCalendarRoute<T extends Response>(request: { headers: Headers }, run: () => Promise<T>): Promise<T> {
  return observeRuntimeRoute("calendar.team", request, run);
}

export function observeRuntimeHandler<R extends Request, Args extends unknown[], T extends Response>(routeKey: RuntimeRouteKey, handler: (request: R, ...args: Args) => Promise<T>) {
  return (request: R, ...args: Args): Promise<T> => observeRuntimeRoute(routeKey, request, () => handler(request, ...args));
}

export async function observeRuntimeProxy(request: NextRequest, run: () => Promise<Response>): Promise<Response> {
  request.headers.delete("x-request-id");
  request.headers.delete(proxyHeader);
  const routeKey = matchRuntimeRoute(request.method, request.nextUrl.pathname);
  if (!routeKey) return run();
  const context = begin("proxy", request.headers, routeKey);
  return contexts.run(context, async () => {
    let response: Response;
    try { response = await run(); } catch (error) {
      recordRuntimeFailure({ operation: "session.proxy", errorCode: routeKey === "calendar.team" ? "calendar_boundary_failure" : "request_boundary_failure", errorCategory: "unexpected_error" });
      isolateDiagnostics(() => { finish(context); });
      throw error;
    }
    isolateDiagnostics(() => {
      response.headers.set("x-request-id", context.completion.requestId);
      const value = finish(context, response);
      if (response.headers.get("x-middleware-next") === "1" && isRequestId(value.requestId)) {
        const safe = safeProxy({ ...value, outcome: "success" })!;
        let summary = JSON.stringify({ version: 1, ...safe });
        while (Buffer.byteLength(summary) >= 1024 && safe.phases?.length) {
          safe.phases.pop(); safe.phasesTruncated = true;
          summary = JSON.stringify({ version: 1, ...safe });
        }
        if (Buffer.byteLength(summary) < 1024) {
          // Rebuild only Next's request-override headers after existing cookie refresh.
          const headers = new Headers(request.headers);
          headers.set(proxyHeader, summary);
          const forwarding = NextResponse.next({ request: { headers } });
          for (const [name, content] of forwarding.headers) if (name.startsWith("x-middleware-")) response.headers.set(name, content);
        }
      }
    });
    return response;
  });
}
