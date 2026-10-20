import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { NextResponse, type NextRequest } from "next/server";
import { createRuntimeLogger, isRequestId, safeFailure, safeProxy, type Completion, type ProxySummary, type SafeFailure, type Stage } from "./output";

const instanceId = randomUUID();
const proxyHeader = "x-founderops-proxy-observation";
const contexts = new AsyncLocalStorage<{ completion: Completion; started: number }>();
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
    completeness: { correlation, externalCallsComplete: false, cache: "unavailable" },
  };
  return { completion, started: performance.now() };
}

export function recordCalendarFailure(reason: SafeFailure) {
  try {
    const context = contexts.getStore();
    const failure = safeFailure(reason);
    if (!context || !failure) return;
    context.completion.failure ??= failure;
    emit(context.completion, failure);
  } catch { /* Telemetry is isolated from the observed operation. */ }
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
        const summary = JSON.stringify({ version: 1, ...safeProxy({ ...value, outcome: "success" }) });
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
