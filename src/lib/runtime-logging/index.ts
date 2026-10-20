import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { NextResponse, type NextRequest } from "next/server";
import { createRuntimeLogger, isRequestId, safeFailure, safeProxy, type SafeOperation, type Phase, type MembershipObservation, type Completion, type ProxySummary, type SafeFailure, type Stage } from "./output";

const instanceId = randomUUID();
const proxyHeader = "x-founderops-proxy-observation";
type Context = { completion: Completion; started: number; nextPhase: { value: number }; parentId?: string };
const contexts = new AsyncLocalStorage<Context>();
let logger: ReturnType<typeof createRuntimeLogger> | undefined;
const emit = (completion: Completion, failure?: SafeFailure) => {
  try {
    logger ??= createRuntimeLogger();
    if (failure) logger.failed(completion, failure);
    else logger.completed(completion);
  } catch { /* Diagnostics must never change application execution. */ }
};

function begin(stage: Stage, headers: Headers) {
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
  const completion: Completion = { requestId: proxy?.requestId || randomUUID(), instanceId, stage,
    status: 500, outcome: "error", durationMs: 0, ...(proxy ? { proxy } : {}),
    vercelId: headers.get("x-vercel-id") || undefined,
    deploymentEnv: process.env.VERCEL_ENV, deploymentId: process.env.VERCEL_DEPLOYMENT_ID, region: process.env.VERCEL_REGION,
    phases: [], externalCalls: { total: 0, operations: {}, complete: true },
    completeness: { correlation, externalCallsComplete: false, cache: "unavailable" },
  };
  return { completion, started: performance.now(), nextPhase: { value: 0 } };
}

export function recordCalendarFailure(reason: SafeFailure) {
  try {
    const context = contexts.getStore();
    const failure = safeFailure(reason);
    if (!context || !failure) return;
    context.completion.failure ??= failure;
    const phase = context.completion.phases?.find(value => value.id === context.parentId);
    if (phase) phase.outcome = "error";
    emit(context.completion, failure);
  } catch { /* Telemetry is isolated from the observed operation. */ }
}

export const calendarObservationActive = () => Boolean(contexts.getStore());

function startPhase(operation: SafeOperation, kind: Phase["kind"]) {
  const context = contexts.getStore();
  if (!context) return undefined;
  const phase: Phase = { id: `${context.completion.stage}:${++context.nextPhase.value}`, ...(context.parentId ? { parentId: context.parentId } : {}),
    operation, kind, offsetMs: Math.max(0, performance.now() - context.started), durationMs: 0, outcome: "success" };
  if (context.completion.phases!.length < 64) context.completion.phases!.push(phase);
  else context.completion.phasesTruncated = true;
  return { context, phase, started: performance.now() };
}

export function classifyCalendarError(error: unknown): SafeFailure["errorCategory"] {
  try {
    const name = error && typeof error === "object" && "name" in error ? error.name : undefined;
    return name === "TimeoutError" || name === "AbortError" ? "timeout" : error instanceof TypeError ? "transport_error" : "unexpected_error";
  } catch { return "unexpected_error"; }
}

export function observeCalendarPhase<T>(operation: SafeOperation, run: () => PromiseLike<T>, kind: Phase["kind"] = "operation"): Promise<T> {
  let active: ReturnType<typeof startPhase>;
  try { active = startPhase(operation, kind); } catch { /* Best effort. */ }
  const execute = async () => {
    try { return await run(); } catch (error) {
      if (active) active.phase.outcome = "error";
      // HTTP dispatch is the failure origin; enclosing phases preserve its classification.
      if (kind === "http") recordCalendarFailure({ operation, errorCode: "provider_request_failed", errorCategory: classifyCalendarError(error) });
      throw error;
    } finally { if (active) { try { active.phase.durationMs = Math.max(0, performance.now() - active.started); } catch { /* Best effort. */ } } }
  };
  return active ? contexts.run({ ...active.context, parentId: active.phase.id }, execute) : execute();
}

export function observeCalendarPreparation<T>(run: () => T): T {
  let active: ReturnType<typeof startPhase>;
  try { active = startPhase("calendar.prepare", "operation"); } catch { /* Best effort. */ }
  try { return run(); } finally { if (active) { try { active.phase.durationMs = Math.max(0, performance.now() - active.started); } catch { /* Best effort. */ } } }
}

export function observeCalendarResultPhase<T extends { error: unknown }>(operation: SafeOperation, run: () => PromiseLike<T>, errorCode: SafeFailure["errorCode"] = "provider_request_failed"): Promise<T> {
  return observeCalendarPhase(operation, async () => {
    const result = await run();
    recordCalendarResult(operation, result.error, errorCode);
    return result;
  });
}

export function recordCalendarResult(operation: SafeOperation, error: unknown, errorCode: SafeFailure["errorCode"] = "provider_request_failed") {
  if (error) recordCalendarFailure({ operation, errorCode, errorCategory: "provider_http_error" });
}

export function observeCalendarHttp(operation: SafeOperation, dispatch: () => Promise<Response>): Promise<Response> {
  try {
    const calls = contexts.getStore()?.completion.externalCalls;
    if (calls) { calls.total++; calls.operations[operation] = (calls.operations[operation] || 0) + 1; if (operation === "supabase.other") calls.complete = false; }
  } catch { /* Best effort. */ }
  return observeCalendarPhase(operation, async () => {
    const response = await dispatch();
    const expectedAuthDenial = ["supabase.user", "supabase.refresh"].includes(operation) && response.status >= 400 && response.status < 500;
    if (!response.ok && !expectedAuthDenial) recordCalendarFailure({ operation, errorCode: "provider_request_failed", errorCategory: "provider_http_error", providerStatus: response.status });
    return response;
  }, "http");
}

export function recordCalendarMembership(value: MembershipObservation) {
  try { const context = contexts.getStore(); if (context) context.completion.membership = value; } catch { /* Best effort. */ }
}

export function recordDirectoryCredential(result: "reused" | "renewed") {
  try { const context = contexts.getStore(); if (context) context.completion.directoryCredential = { result }; } catch { /* Best effort. */ }
}

export function recordCalendarDenial(code: string | undefined) {
  try { const context = contexts.getStore(); if (context) context.completion.deniedCode = code; } catch { /* Best effort. */ }
}

function finish(context: ReturnType<typeof begin>, response?: Response) {
  const value = context.completion;
  value.durationMs = Math.max(0, performance.now() - context.started);
  value.status = response?.status || 500;
  value.outcome = value.failure || !response || value.status >= 500 ? "error" : value.status === 400 ? "invalid_input"
    : value.status === 401 || value.status === 403 ? "denied" : "success";
  emit(value);
  return value;
}

function isolateDiagnostics(run: () => void) {
  try { run(); } catch { try { logger?.dropped(); } catch { /* No recursive fallback. */ } }
}

export async function observeCalendarRoute<T extends Response>(request: { headers: Headers }, run: () => Promise<T>): Promise<T> {
  const context = begin("route", request.headers);
  return contexts.run(context, async () => {
    let response: T;
    try { response = await run(); } catch (error) {
      recordCalendarFailure({ operation: "calendar.request", errorCode: "calendar_boundary_failure", errorCategory: "unexpected_error" });
      isolateDiagnostics(() => { finish(context); });
      throw error;
    }
    isolateDiagnostics(() => { response.headers.set("x-request-id", context.completion.requestId); finish(context, response); });
    return response;
  });
}

export async function observeCalendarProxy(request: NextRequest, run: () => Promise<Response>): Promise<Response> {
  request.headers.delete("x-request-id");
  request.headers.delete(proxyHeader);
  const context = begin("proxy", request.headers);
  return contexts.run(context, async () => {
    let response: Response;
    try { response = await run(); } catch (error) {
      recordCalendarFailure({ operation: "session.proxy", errorCode: "calendar_boundary_failure", errorCategory: "unexpected_error" });
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
