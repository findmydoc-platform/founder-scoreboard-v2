# Runtime logging contract

Status: first implementation slice complete; deployment and production acceptance pending.

The implemented slice covers the complete calendar HTTP path through the existing session proxy, authorization and data operations. It emits safe segment summaries, a shared response request ID, local elapsed durations, explicit correlation completeness and boundary-level failure classifications. It preserves the existing credential and cookie chain.

Cache observations, provider/data phase detail and scoped HTTP-attempt counts below are agreed follow-up work in [#519](https://github.com/findmydoc-platform/founder-scoreboard-v2/issues/519). Current records explicitly set `externalCallsScope: unavailable`, `externalCallsComplete: false`, `cache: unavailable` and `phasesComplete: false`. Missing measurements are not zero attempts or an inferred cache result. This first slice does not complete the parent specification.

FounderOps needs to explain a slow or failed calendar request from one application summary: the operation, safe failure category, membership-cache result, measured phases, and outbound HTTP attempts. The first increment covers only `GET /api/team-workweek/team`, its session proxy, and the credential and provider transports reached by that request.

## Decisions and rationale

- Use a small server-only adapter around standalone Pino. The adapter accepts approved event shapes, not arbitrary objects or free-text messages. Pino remains replaceable behind that boundary.
- Reuse the website's structured event and context conventions. Do not import its logging modules, initialize Payload, or adopt its exception-retention exception.
- Use Vercel runtime logs as the initial destination. Additional log storage, PostHog integration, metrics exporters, distributed tracing, dashboards, and instrumentation of other routes require a separate scope decision.
- Keep application logs, metrics, and traces distinct. Logs describe individual events; metrics describe aggregates; traces connect execution across boundaries. Pino alone does not create distributed traces.
- Preserve the [authentication contract](auth-flow.md). Logging must not change authorization results, credential binding, cache deadlines, retry behavior, permit cleanup, or mutations.

The pilot exposes its random application request ID in the response header and uses the existing Vercel retention window without an additional archive. Neither setting is an authorization input.

## Implemented output

`src/lib/runtime-logging` owns the server-only Pino adapter and independent proxy/route contexts. It uses a local writable stream without a worker or network transport. Unknown fields are dropped before Pino redaction. Only reviewed operations, codes, enums, bounded numeric values and validated deployment identifiers reach output. Neither Pino bindings nor arbitrary messages are exposed to callers.

Every compact completion is emitted at an info-capable threshold. Records include `schemaVersion: 1`, a fixed `scope: calendar`, static method/route, timestamp, UUID request/runtime IDs, status, outcome, duration, observed processing time and completeness. The route embeds the approved proxy summary when available. Deployment environment, deployment ID, region and Vercel header ID are optional and omitted unless they match the adapter's conservative accepted formats. This does not imply equality with Vercel's runtime Request Id.

The first slice classifies route/proxy exceptions, unavailable authorization and failed calendar data results through fixed boundary codes. Expected authorization denials retain their approved public `deniedCode` and do not produce an unexpected-error event. Deeper provider causes remain unavailable until #519. Thrown application errors retain their original identity; raw errors never reach either output stream.

The internal `x-founderops-proxy-observation` request header carries a schema-tagged summary below 1 KiB. Proxy execution deletes incoming diagnostic values before session maintenance and rebuilds Next.js request-override headers after refresh. Existing `Set-Cookie`, cache-control and downstream cookie updates remain intact. Route execution uses its own AsyncLocalStorage context and validates the forwarded summary. Missing or malformed metadata creates a fresh local ID and records `missing` or `invalid` correlation.

The adapter's fixed first-slice shape remains below 16 KiB and emits no phase entries. The agreed maximum of 64 entries applies when detailed phases are introduced. Output exceeding the byte cap is dropped safely. Writable errors disable the affected sink; backpressure drops telemetry until drain. No event queue accumulates in the adapter. The fixed fallback marker is rate-limited to once per minute, drops while its own stream is blocked and ignores its own errors. Proxy-summary serialization failure also preserves the completed HTTP response and refreshed cookies.

## Full pilot contract and pending detail

The following sections retain the agreed complete design. Cache, phase, sampling and transport-count behavior is pending #519; statements about production verification remain acceptance requirements, not deployed evidence.

## Events and approved fields

Use `request.completed` for segment/request summaries and `operation.failed` when a failure still has a known operation and safe category. Membership-cache observations are fields inside the completion summary; normal cache hits do not need individual log lines.

| Group | Approved fields and meaning |
| --- | --- |
| Envelope | `schemaVersion`, `event`, `severity`, `scope`, `operation`, `timestamp`. Names and messages come from reviewed constants. |
| Request | Server-generated UUID `requestId`; optional validated `vercelId`; fixed `method` and route template. Never copy a complete request URL, query, or arbitrary incoming correlation ID. |
| Deployment | `deploymentEnv`, `deploymentId`, public region code, opaque random `instanceId` for the observed runtime lifetime. Omit hostname and process ID. |
| Segment | `stage: proxy | route`, local `durationMs`, outbound-attempt counts grouped by approved operation. A route summary may embed the safe proxy summary. |
| Phase | `phaseId`, optional `parentPhaseId`, fixed `operation`, local `startOffsetMs`, `durationMs`, and outcome. Offsets are relative to their own segment. |
| Cache | Fixed `cacheName`, `result: hit | miss | expired | coalesced | bypass`, observed `reason`, `ageMs`, `remainingTtlMs`, `expired`, and opaque `cacheOwnerId`. Use null for unknown age or lifetime. |
| Error | Approved `errorCode`, `errorCategory`, optional integer `providerStatus`, and fixed message. Existing public auth codes remain authoritative for responses. |
| Completeness | `externalCallsScope`, `externalCallsComplete`, `phasesTruncated`, and `retentionReason`. Missing coverage must be visible. |

Bound a completion event to 16 KiB and at most 64 phase records. Keep embedded proxy metadata below 1 KiB. Validate strings, enums, numeric ranges, and lengths at the adapter boundary. Drop unknown fields. If detail must be truncated, retain status, the safe failure classification, cache result, counters, and segment durations.

## Privacy and safe failures

Never serialize raw exceptions, stacks, causes, arbitrary provider codes/messages, request or provider bodies, headers, cookies, credentials, credential fingerprints, cache keys, user identities, private endpoints, or private hostnames. Do not read a body solely for logging.

Classify failures where the operation is known, before existing code collapses several causes into a generic unavailable response. Allowed categories are `timeout`, `transport_error`, `provider_http_error`, `invalid_response`, `configuration_error`, and `unexpected_error`. A failure without an approved mapping receives a fixed unknown-failure code and message. A classifier may use structured values already available to the application; it must not infer a cause from arbitrary exception text.

For example, distinguish failure of `supabase.auth.get_user`, `supabase.workspace_access_context`, `supabase.workspace_issue_permit`, `supabase.workspace_release_permit`, `google.sts.exchange`, `google.iam.impersonate`, and `google.directory.membership`. These are static operation identifiers, not URLs. A failed cleanup remains observable even when the existing application intentionally suppresses its exception.

Expected authorization denials remain denied outcomes with the existing safe code. They are not automatically unexpected application errors. An internal error code does not change the public error body or status. Any future change to that public contract requires its own decision and focused tests.

Use Pino redaction as additional protection after the approved-field projection. Never pass raw `Error` objects to Pino's default serializer or a fallback logger.

## Request and instance correlation

Create a fresh request ID at proxy entry for the pilot route. Remove or overwrite caller-supplied application diagnostic headers before forwarding. Re-establish a local request context at route entry; do not assume that AsyncLocalStorage or module globals span proxy and route execution.

Forward only the bounded, approved proxy summary through internal request metadata. Preserve refreshed cookies and existing response behavior. Use Next.js request-header forwarding, not response-header forwarding. Treat malformed metadata as unavailable telemetry, never as an auth failure or authorization grant. A missing context gets a fresh local ID and an explicit incomplete-correlation indication.

Record proxy and route instance IDs separately. A random runtime ID identifies an observed lifetime, not a physical Vercel machine. Generate a cache-owner ID alongside the membership-evidence store so that its lifetime is unambiguous. Never use credential material to construct either identifier.

Return the application `requestId` as `x-request-id` on pilot responses produced by the proxy or route, including successful, denied, invalid-input, and handled-error responses. The header must match the context that produced the response. Keep proxy summaries, auth outcomes, cache details, and internal metadata server-side. The ID is a diagnostic reference, not a credential. Failures before application execution are outside this header guarantee.

The application request ID, `x-vercel-id`, and Vercel's runtime Request Id are distinct identifiers. Verify their association in the deployed runtime instead of assuming equality.

## Cache observations

The membership-evidence store and the Directory reader credential are different caches. A membership hit avoids a membership verification; it does not imply that user, role, profile, or mutable access checks can be skipped.

- `hit` means completed, usable membership evidence was reused.
- `miss` means no usable completed evidence or shared verification was found. Use `reason: not_found` when the underlying reason is unknown.
- `expired` means the target entry was observed expiring under the existing deadline check. Observe that fact before the existing purge removes it; do not change purge order or lifetime.
- `coalesced` means the request waited for an existing verification. Record its waiting time. Attribute outbound attempts to the executing request only; the waiter did not issue them.
- `bypass` means the existing authorization path does not use this cache. Record only a reviewed reason.

Membership age starts at the original verification start stored as `verifiedAt`, not at Directory completion or the latest hit. Expiry remains the earlier of that start plus 900 seconds and JWT expiry. Logging must not refresh it. Record capacity eviction only when directly observed. An absent entry alone cannot establish eviction, a changed credential, or a new instance. Do not add credential hashes or a diagnostic history of keys to explain misses.

The pilot records Directory credential reuse/renewal as a safe outcome and measures the existing STS, impersonation, and membership operations. Token values, account/audience binding values, and group/member addresses stay private.

## Timing and outbound attempts

Use monotonic elapsed time within each segment. Measure the proxy, complete route, authorization, provider operations, parallel calendar-data operations, and local response preparation. Parent durations include their children; they must not be added together. Parallel operations have their own offsets and durations.

The route summary contains its local total and the observed proxy duration. Their sum may be reported as observed application processing time because these segments run sequentially, but it excludes the transfer gap, platform queuing, and browser network time. Never label it browser latency or end-to-end request duration. Do not subtract monotonic timestamps from different runtimes.

Count actual HTTP dispatch attempts at the private transport boundaries. Include existing retries without adding any. Inject the observer into every Supabase client used by the pilot, including auth/JWKS, service RPCs, cookie handling, and data operations. Observe the existing explicit Directory fetches. Do not replace global fetch or inspect bodies. Distinguish fetch time to response headers from the surrounding SDK phase, which also includes response processing.

Declare the counter scope explicitly. Internal work of an uninstrumented adapter, such as OIDC-token acquisition, is not silently covered. `externalCallsComplete` is true only for its declared scope. Shared verification attempts belong to the request that executes them, not every waiter. Existing network failures and responses must pass through unchanged.

## Production emission and retention

The dedicated pilot logger must allow `info`; copying the website's production `warn` threshold would discard normal performance summaries. Apply selection before emitting:

| Observation | Emission rule |
| --- | --- |
| Compact proxy and route completion | Keep every pilot request, including fast successes. |
| Unexpected operation failure | Keep every failure at `error`, with approved safe fields. |
| Slow successful request | Keep at `warn` when observed proxy plus route processing time reaches 2,000 ms. This is an initial diagnostic threshold, not an SLO. |
| Detailed phases for a failed request, slow request, or membership miss/expiry | Keep all bounded detail available at completion. |
| Detailed phases for fast successful cache hits | Keep a deterministic 10% request-ID sample. |

Buffer only bounded phase detail until completion so that a late failure or slow operation can retain earlier observations. Proxy details needed by the route must survive the forwarding boundary. A killed process may still lose its final summary; this increment does not provide durable delivery guarantees.

Application severity and Vercel's displayed log level are separate. Verify the selected sink and its platform classification. Do not assume that a Pino numeric level on stdout produces the corresponding Vercel badge. Keep explicit application `severity` searchable.

Sampling controls emission, not storage lifetime. Use the existing Vercel retention window without a new archive. The pilot requires no additional minimum retention period. Verify and record the project's actual window before later production acceptance so that operators know how long a request remains available. Longer retrospective diagnosis requires a separate retention decision before introducing storage or changing configuration.

## Logger failure behavior

Keep the first sink local, with no network destination or worker transport. Handle synchronous adapter/serialization failures and asynchronous writable-stream errors. Do not await telemetry network delivery or stream drain in the auth/data path. Bound memory; drop telemetry on sink failure or backpressure rather than retrying application work.

If available, use a fixed, rate-limited safe fallback marker for logger failure. Never include the original logging exception, recurse into the failed logger, or allow fallback failure to escape. This is failure isolation for telemetry only; application authorization remains fail-closed under its existing rules.

## Acceptance checks for implementation

Use Freeman and Pryce's Outside-In TDD and Kent Beck's Test Desiderata when implementing observable behavior. The implementation uses the complete calendar HTTP/proxy/credential seam and the narrow serialized-output seam. Controlled tests cover response IDs, safe output, forged and missing metadata, cookie refresh, concurrent requests, monotonic elapsed durations, threshold boundaries, safe failures, output bounds and sink isolation. Cache/provider detail checks remain pending #519; production checks require separate deployment authorization.

1. Seed distinctive secret values into exceptions, causes, unknown fields, headers, URLs, and bodies. Assert their absence from the actual serialized output, including fallback output. Assert the approved safe code and operation remain present.
2. Exercise proxy-to-route correlation with forged diagnostic headers, cookie refresh, missing metadata, and concurrent requests. Preserve cookies and responses; reject forged context without affecting authorization. Assert that `x-request-id` matches the producing context on successful, denied, invalid-input, and handled-error responses, and that internal diagnostic metadata does not appear in response headers.
3. Exercise membership hit, miss, expiry, capacity removal, and coalesced verification. Preserve original verification-start/JWT deadlines, authorization binding, and one execution per shared verification.
4. Use controlled overlapping operations and two interleaved requests. Assert correct local totals, intervals, parent relationships, and actual attempt counts without cross-request leakage or double-counting shared work.
5. Fail the logger synchronously, during serialization, asynchronously at the sink, and under backpressure. Preserve status, body, thrown application error, cookie changes, cache lifetime, dispatch/retry count, and permit cleanup. Emit no recursive failure storm.
6. Exercise late failures, both sides of the slow threshold, deterministic sampling, and truncation. Compact completions and required detailed observations must survive the production logger level.
7. After a separately authorized deployment, inspect real calendar requests. Verify one completion record explains the proxy and route work, cache outcome, safe failures, and declared external-call coverage; verify severity classification and actual retention. Synthetic local timings do not replace production evidence.

## Sources

- [Pino API](https://github.com/pinojs/pino/blob/main/docs/api.md) and [default Error serializer](https://github.com/pinojs/pino-std-serializers/blob/master/lib/err.js).
- [Next.js Proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy), including request-header forwarding and execution separation.
- [Node.js asynchronous context](https://nodejs.org/api/async_context.html), [performance measurement](https://nodejs.org/api/perf_hooks.html#performancenow), and [stream errors](https://nodejs.org/api/stream.html#event-error).
- [Vercel runtime logs](https://vercel.com/docs/logs/runtime) and [request headers](https://vercel.com/docs/headers/request-headers).

Private production diagnosis, request samples, and operator artifacts are not part of this contract and must remain outside the repository.
