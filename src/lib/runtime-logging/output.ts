import "server-only";
import pino from "pino";
import type { Writable } from "node:stream";

export type Stage = "proxy" | "route";
export type Outcome = "success" | "denied" | "invalid_input" | "error";
export type SafeOperation = "calendar.request" | "session.proxy" | "calendar.authorization" | "calendar.publications";
export type FailureCategory = "timeout" | "transport_error" | "provider_http_error" | "invalid_response" | "configuration_error" | "unexpected_error";
export type SafeFailure = {
  operation: SafeOperation;
  errorCode: "calendar_boundary_failure" | "calendar_authorization_unavailable" | "calendar_data_unavailable";
  errorCategory: FailureCategory;
  providerStatus?: number;
};
export type ProxySummary = { requestId: string; instanceId: string; durationMs: number; status: number; outcome: Outcome; failure?: SafeFailure };
export type Completion = {
  requestId: string; instanceId: string; stage: Stage; status: number; outcome: Outcome; durationMs: number;
  proxy?: ProxySummary;
  vercelId?: string;
  deploymentEnv?: string; deploymentId?: string; region?: string;
  failure?: SafeFailure;
  deniedCode?: string;
  completeness: { correlation: "complete" | "missing" | "invalid"; externalCallsComplete: false; cache: "unavailable" };
};
type LocalSink = Pick<Writable, "write" | "on"> & { writableNeedDrain?: boolean };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isRequestId = (value: unknown): value is string => typeof value === "string" && uuidPattern.test(value);
const duration = (value: number) => Number.isFinite(value) && value >= 0 && value <= 86_400_000 ? Math.round(value * 1000) / 1000 : 0;
const status = (value: number) => Number.isInteger(value) && value >= 100 && value <= 599 ? value : 500;
const outcomes = new Set<Outcome>(["success", "denied", "invalid_input", "error"]);
const operations = new Set<SafeOperation>(["calendar.request", "session.proxy", "calendar.authorization", "calendar.publications"]);
const categories = new Set<FailureCategory>(["timeout", "transport_error", "provider_http_error", "invalid_response", "configuration_error", "unexpected_error"]);
const errorCodes = new Set(["calendar_boundary_failure", "calendar_authorization_unavailable", "calendar_data_unavailable"]);
const deniedCodes = new Set(["workspace_access_denied", "workspace_access_unavailable", "workspace_link_required", "workspace_google_login_required",
  "session_invalid_before_effect", "administrator_access_required", "administrator_access_expired"]);

export function safeFailure(value: SafeFailure | undefined): SafeFailure | undefined {
  if (!value || !operations.has(value.operation) || !errorCodes.has(value.errorCode) || !categories.has(value.errorCategory)) return undefined;
  return { operation: value.operation, errorCode: value.errorCode, errorCategory: value.errorCategory,
    ...(value.providerStatus !== undefined && Number.isInteger(value.providerStatus) && value.providerStatus >= 100 && value.providerStatus <= 599
      ? { providerStatus: value.providerStatus } : {}),
  };
}
export function safeProxy(value: ProxySummary | undefined): ProxySummary | undefined {
  if (!value || !isRequestId(value.requestId) || !isRequestId(value.instanceId) || !outcomes.has(value.outcome)) return undefined;
  return { requestId: value.requestId, instanceId: value.instanceId, durationMs: duration(value.durationMs),
    status: status(value.status), outcome: value.outcome, ...(safeFailure(value.failure) ? { failure: safeFailure(value.failure) } : {}) };
}

function project(value: Completion) {
  if (!isRequestId(value.requestId) || !isRequestId(value.instanceId)) return null;
  const proxy = safeProxy(value.proxy);
  const failure = safeFailure(value.failure);
  const elapsed = duration(value.durationMs);
  const observedProcessingMs = elapsed + (proxy?.durationMs || 0);
  const outcome = outcomes.has(value.outcome) ? value.outcome : "error";
  const severity: "error" | "warn" | "info" = failure || outcome === "error" ? "error" : outcome === "success" && observedProcessingMs >= 2000 ? "warn" : "info";
  return {
    schemaVersion: 1, scope: "calendar", timestamp: new Date().toISOString(), severity,
    requestId: value.requestId, instanceId: value.instanceId, stage: value.stage === "proxy" ? "proxy" : "route",
    operation: value.stage === "proxy" ? "session.proxy" : "calendar.request", method: "GET", route: "/api/team-workweek/team",
    status: status(value.status), outcome, durationMs: elapsed, observedProcessingMs,
    ...(proxy ? { proxy } : {}), ...(failure ? { failure } : {}),
    ...(value.deniedCode && deniedCodes.has(value.deniedCode) ? { deniedCode: value.deniedCode } : {}),
    ...(value.deploymentEnv && ["production", "preview", "development"].includes(value.deploymentEnv) ? { deploymentEnv: value.deploymentEnv } : {}),
    ...(value.deploymentId && /^dpl_[A-Za-z0-9]{10,64}$/.test(value.deploymentId) ? { deploymentId: value.deploymentId } : {}),
    ...(value.region && /^[a-z]{3}[1-9]$/.test(value.region) ? { region: value.region } : {}),
    ...(value.vercelId && /^[a-z]{3}[1-9]::(?:[a-z]{3}[1-9]::)?[a-z0-9]{5}-[0-9]{13}-[a-f0-9]{12}$/.test(value.vercelId) ? { vercelId: value.vercelId } : {}),
    completeness: {
      correlation: ["complete", "missing", "invalid"].includes(value.completeness.correlation) ? value.completeness.correlation : "invalid",
      externalCallsScope: "unavailable", externalCallsComplete: false, cache: "unavailable", phasesComplete: false, phasesTruncated: false,
    },
  };
}

export function createRuntimeLogger(sink: LocalSink = process.stdout, fallback: LocalSink = process.stderr) {
  let blocked = false;
  let failed = false;
  let lastFallback = -Infinity;
  let fallbackBlocked = false;
  let fallbackFailed = false;
  const signalFailure = () => {
    try {
      const now = performance.now();
      if (fallbackBlocked || fallbackFailed || fallback.writableNeedDrain || now - lastFallback < 60_000) return;
      lastFallback = now;
      if (!fallback.write('{"event":"telemetry.dropped","severity":"warn","code":"runtime_logging_unavailable"}\n')) fallbackBlocked = true;
    } catch { fallbackFailed = true; }
  };
  try {
    sink.on("error", () => { failed = true; signalFailure(); });
    sink.on("drain", () => { blocked = false; });
    fallback.on("error", () => { fallbackFailed = true; });
    fallback.on("drain", () => { fallbackBlocked = false; });
  } catch { failed = true; }
  const logger = pino({ base: null, timestamp: false, level: "info", serializers: {},
    redact: { paths: ["err", "error", "stack", "cause", "token", "authorization", "cookie", "headers"], remove: true },
  }, { write(line) {
    if (failed || blocked || sink.writableNeedDrain || Buffer.byteLength(line) > 16 * 1024) { signalFailure(); return; }
    try { if (!sink.write(line)) { blocked = true; signalFailure(); } } catch { failed = true; signalFailure(); }
  } });
  return {
    dropped: signalFailure,
    completed(value: Completion) {
      try {
        const event = project(value);
        if (event) logger[event.severity]({ ...event, event: "request.completed" }, "Calendar request completed");
      } catch { signalFailure(); }
    },
    failed(value: Completion, reason: SafeFailure) {
      try {
        const event = project(value);
        const failure = safeFailure(reason);
        if (event && failure) logger.error({ ...event, event: "operation.failed", severity: "error", operation: failure.operation, failure }, "Calendar operation failed");
      } catch { signalFailure(); }
    },
  };
}
