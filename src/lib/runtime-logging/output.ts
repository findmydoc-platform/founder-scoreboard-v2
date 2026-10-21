import "server-only";
import pino from "pino";
import type { Writable } from "node:stream";

export type Stage = "proxy" | "route";
export type Outcome = "success" | "denied" | "invalid_input" | "error";
export const safeOperations = ["calendar.request", "session.proxy", "calendar.authorization", "calendar.snapshot", "calendar.publications", "calendar.prepare", "calendar.data", "calendar.profile",
  "supabase.claims", "supabase.jwks", "supabase.user", "supabase.refresh", "supabase.settings", "supabase.other", "workspace.context", "workspace.session", "workspace.membership", "workspace.wait",
  "workspace.dispatch.prepare", "workspace.permit.issue", "workspace.permit.release", "directory.reader", "directory.oidc", "directory.sts", "directory.iam", "directory.membership"] as const;
export type SafeOperation = typeof safeOperations[number];
export type Phase = { id: string; parentId?: string; operation: SafeOperation; kind: "operation" | "http"; offsetMs: number; durationMs: number; outcome: "success" | "error" };
export type ExternalCalls = { total: number; operations: Partial<Record<SafeOperation, number>>; complete: boolean };
export type FailureCategory = "timeout" | "transport_error" | "provider_http_error" | "invalid_response" | "configuration_error" | "unexpected_error";
export type SafeFailure = {
  operation: SafeOperation;
  errorCode: "calendar_boundary_failure" | "calendar_authorization_unavailable" | "calendar_data_unavailable" | "provider_request_failed" | "provider_response_invalid" | "provider_configuration_invalid" | "permit_cleanup_failed";
  errorCategory: FailureCategory;
  providerStatus?: number;
};
export type MembershipObservation = { result: "hit" | "miss" | "expired" | "coalesced" | "bypass"; reason: "cached" | "not_found" | "observed_expiry" | "in_flight" | "not_required"; cacheOwnerId: string; evidenceAgeMs: number | null; remainingLifetimeMs: number | null; expired: boolean; capacityEvictions?: number; waitMs?: number };
export type DirectoryCredentialObservation = { result: "reused" | "renewed" };
export type ProxySummary = { requestId: string; instanceId: string; durationMs: number; status: number; outcome: Outcome; failure?: SafeFailure; externalCalls?: ExternalCalls; phases?: Phase[]; phasesTruncated?: boolean };
export type Completion = {
  requestId: string; instanceId: string; stage: Stage; status: number; outcome: Outcome; durationMs: number;
  proxy?: ProxySummary;
  vercelId?: string;
  deploymentEnv?: string; deploymentId?: string; region?: string;
  failure?: SafeFailure;
  deniedCode?: string;
  membership?: MembershipObservation;
  directoryCredential?: DirectoryCredentialObservation;
  externalCalls?: ExternalCalls;
  phases?: Phase[];
  phasesTruncated?: boolean;
  completeness: { correlation: "complete" | "missing" | "invalid"; externalCallsComplete: false; cache: "unavailable" };
};
type LocalSink = Pick<Writable, "write" | "on"> & { writableNeedDrain?: boolean };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isRequestId = (value: unknown): value is string => typeof value === "string" && uuidPattern.test(value);
const duration = (value: number) => Number.isFinite(value) && value >= 0 && value <= 86_400_000 ? Math.round(value * 1000) / 1000 : 0;
const status = (value: number) => Number.isInteger(value) && value >= 100 && value <= 599 ? value : 500;
const outcomes = new Set<Outcome>(["success", "denied", "invalid_input", "error"]);
const operations = new Set<string>(safeOperations);
const categories = new Set<FailureCategory>(["timeout", "transport_error", "provider_http_error", "invalid_response", "configuration_error", "unexpected_error"]);
const errorCodes = new Set(["calendar_boundary_failure", "calendar_authorization_unavailable", "calendar_data_unavailable", "provider_request_failed", "provider_response_invalid", "provider_configuration_invalid", "permit_cleanup_failed"]);
const deniedCodes = new Set(["workspace_access_denied", "workspace_access_unavailable", "workspace_link_required", "workspace_google_login_required",
  "session_invalid_before_effect", "administrator_access_required", "administrator_access_expired"]);

export function safeFailure(value: SafeFailure | undefined): SafeFailure | undefined {
  if (!value || !operations.has(value.operation) || !errorCodes.has(value.errorCode) || !categories.has(value.errorCategory)) return undefined;
  return { operation: value.operation, errorCode: value.errorCode, errorCategory: value.errorCategory,
    ...(value.providerStatus !== undefined && Number.isInteger(value.providerStatus) && value.providerStatus >= 100 && value.providerStatus <= 599
      ? { providerStatus: value.providerStatus } : {}),
  };
}
export function safePhases(values: Phase[] | undefined): Phase[] {
  if (!Array.isArray(values)) return [];
  return values.slice(0, 64).filter(value => value && /^(proxy|route):[1-9][0-9]{0,5}$/.test(value.id) && operations.has(value.operation)
    && ["operation", "http"].includes(value.kind) && ["success", "error"].includes(value.outcome)).map(value => ({
      id: value.id, ...(value.parentId && /^(proxy|route):[1-9][0-9]{0,5}$/.test(value.parentId) ? { parentId: value.parentId } : {}),
      operation: value.operation, kind: value.kind, offsetMs: duration(value.offsetMs), durationMs: duration(value.durationMs), outcome: value.outcome,
    }));
}
export function safeExternalCalls(value: ExternalCalls | undefined): ExternalCalls | undefined {
  if (!value || !Number.isSafeInteger(value.total) || value.total < 0) return undefined;
  const counts: Partial<Record<SafeOperation, number>> = {};
  for (const operation of safeOperations) {
    const count = value.operations?.[operation];
    if (Number.isSafeInteger(count) && count! >= 0) counts[operation] = count;
  }
  return { total: value.total, operations: counts, complete: value.complete === true };
}
export function safeProxy(value: ProxySummary | undefined): ProxySummary | undefined {
  if (!value || !isRequestId(value.requestId) || !isRequestId(value.instanceId) || !outcomes.has(value.outcome)) return undefined;
  return { requestId: value.requestId, instanceId: value.instanceId, durationMs: duration(value.durationMs),
    status: status(value.status), outcome: value.outcome,
    ...(safeExternalCalls(value.externalCalls) ? { externalCalls: safeExternalCalls(value.externalCalls) } : {}),
    ...(value.phases ? { phases: safePhases(value.phases), phasesTruncated: value.phasesTruncated === true || value.phases.length > 64 } : {}),
    ...(safeFailure(value.failure) ? { failure: safeFailure(value.failure) } : {}) };
}

function safeMembership(value: MembershipObservation | undefined) {
  if (!value || !isRequestId(value.cacheOwnerId) || !["hit", "miss", "expired", "coalesced", "bypass"].includes(value.result)
    || !["cached", "not_found", "observed_expiry", "in_flight", "not_required"].includes(value.reason)) return undefined;
  return { result: value.result, reason: value.reason, cacheOwnerId: value.cacheOwnerId,
    evidenceAgeMs: value.evidenceAgeMs === null ? null : duration(value.evidenceAgeMs),
    remainingLifetimeMs: value.remainingLifetimeMs === null ? null : duration(value.remainingLifetimeMs),
    expired: value.expired === true, ...(value.capacityEvictions === 1 ? { capacityEvictions: 1 } : {}), ...(value.waitMs === undefined ? {} : { waitMs: duration(value.waitMs) }) };
}

function project(value: Completion) {
  if (!isRequestId(value.requestId) || !isRequestId(value.instanceId)) return null;
  const proxy = safeProxy(value.proxy);
  const failure = safeFailure(value.failure) || safeFailure(proxy?.failure);
  const elapsed = duration(value.durationMs);
  const observedProcessingMs = elapsed + (proxy?.durationMs || 0);
  const outcome = failure ? "error" : outcomes.has(value.outcome) ? value.outcome : "error";
  const severity: "error" | "warn" | "info" = failure || outcome === "error" ? "error" : outcome === "success" && observedProcessingMs >= 2000 ? "warn" : "info";
  const calls = safeExternalCalls(value.externalCalls);
  const proxyCalls = proxy?.externalCalls;
  const combined = calls ? { ...calls, operations: { ...calls.operations } } : undefined;
  if (combined && proxyCalls) {
    combined.total += proxyCalls.total;
    for (const operation of safeOperations) if (proxyCalls.operations[operation]) combined.operations[operation] = (combined.operations[operation] || 0) + proxyCalls.operations[operation]!;
    combined.complete &&= proxyCalls.complete;
  }
  const retentionReason = outcome !== "success" || failure ? "non_success" : observedProcessingMs >= 2000 ? "slow"
    : value.membership?.result === "miss" ? "membership_miss" : value.membership?.result === "expired" ? "membership_expired"
      : parseInt(value.requestId.slice(-8), 16) % 10 === 0 ? "sample" : "compact";
  const retainDetail = retentionReason !== "compact";
  const allPhases = [...(proxy?.phases || []), ...safePhases(value.phases)];
  let phases = retainDetail ? allPhases.slice(0, 64) : [];
  let truncated = value.phasesTruncated === true || proxy?.phasesTruncated === true || allPhases.length > 64 || (value.phases?.length || 0) > 64;
  // Reserve space for the fixed essential envelope, then shorten detail before serialization.
  while (Buffer.byteLength(JSON.stringify(phases)) > 10_000) { phases = phases.slice(0, -1); truncated = true; }
  return {
    schemaVersion: 1, scope: "calendar", timestamp: new Date().toISOString(), severity,
    requestId: value.requestId, instanceId: value.instanceId, stage: value.stage === "proxy" ? "proxy" : "route",
    operation: value.stage === "proxy" ? "session.proxy" : "calendar.request", method: "GET", route: "/api/team-workweek/team",
    status: status(value.status), outcome, durationMs: elapsed, observedProcessingMs,
    ...(proxy ? { proxy: { requestId: proxy.requestId, instanceId: proxy.instanceId, durationMs: proxy.durationMs, status: proxy.status, outcome: proxy.outcome } } : {}), ...(failure ? { failure } : {}),
    ...(combined ? { externalCalls: { total: combined.total, operations: combined.operations } } : {}),
    phases, detailRetained: retainDetail, retentionReason,
    ...(safeMembership(value.membership) ? { membership: safeMembership(value.membership) } : {}),
    ...(value.directoryCredential && ["reused", "renewed"].includes(value.directoryCredential.result) ? { directoryCredential: { result: value.directoryCredential.result } } : {}),
    ...(value.deniedCode && deniedCodes.has(value.deniedCode) ? { deniedCode: value.deniedCode } : {}),
    ...(value.deploymentEnv && ["production", "preview", "development"].includes(value.deploymentEnv) ? { deploymentEnv: value.deploymentEnv } : {}),
    ...(value.deploymentId && /^dpl_[A-Za-z0-9]{10,64}$/.test(value.deploymentId) ? { deploymentId: value.deploymentId } : {}),
    ...(value.region && /^[a-z]{3}[1-9]$/.test(value.region) ? { region: value.region } : {}),
    ...(value.vercelId && /^[a-z]{3}[1-9]::(?:[a-z]{3}[1-9]::)?[a-z0-9]{5}-[0-9]{13}-[a-f0-9]{12}$/.test(value.vercelId) ? { vercelId: value.vercelId } : {}),
    completeness: {
      correlation: ["complete", "missing", "invalid"].includes(value.completeness.correlation) ? value.completeness.correlation : "invalid",
      externalCallsScope: calls ? "private_supabase_and_explicit_directory_http" : "unavailable",
      externalCallsComplete: combined?.complete === true && (value.stage === "proxy" || Boolean(proxyCalls)),
      uninstrumented: ["vercel_oidc_internal"], proxyObserved: Boolean(proxy), cache: safeMembership(value.membership) ? "observed" : "unavailable", phasesComplete: retainDetail && !truncated && (value.stage === "proxy" || Boolean(proxy)), phasesTruncated: truncated,
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
        if (event && failure) {
          const { schemaVersion, scope, timestamp, requestId, instanceId, stage, method, route, deploymentEnv, deploymentId, region, vercelId } = event;
          logger.error({ schemaVersion, scope, timestamp, requestId, instanceId, stage, method, route,
            deploymentEnv, deploymentId, region, vercelId, event: "operation.failed", severity: "error", operation: failure.operation, failure }, "Calendar operation failed");
        }
      } catch { signalFailure(); }
    },
  };
}
