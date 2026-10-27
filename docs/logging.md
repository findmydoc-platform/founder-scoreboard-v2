# Runtime logging contract

Status: the calendar pilot passed bounded production acceptance on 2026-10-20. The current implementation extends its central measurement to the registered routes below; that historical acceptance does not validate the extension.

The central module covers 25 registered method/route pairs, their existing session proxy, and the private Supabase Auth, Supabase database, Google Workspace and GitHub transports they reach. One route completion links the response ID to the safe proxy summary, membership evidence, actual HTTP-attempt counts, and bounded local phase intervals. It preserves the credential and cookie chain.

The original pilot completed the scope of [#518](https://github.com/findmydoc-platform/founder-scoreboard-v2/issues/518) and [#519](https://github.com/findmydoc-platform/founder-scoreboard-v2/issues/519). The production acceptance below records real-request correlation, observed Vercel log classification, and the existing retention entitlement. Its results apply to the inspected deployment and bounded sample.

The production acceptance and serialized example below predate the calendar snapshot implementation in PR #522. They remain evidence for the deployment and commit inspected on 2026-10-20; they do not establish production behavior or performance for the new read path.

## Registered HTTP scope

`src/lib/runtime-logging/routes.ts` owns the static method/route catalog. Dynamic task IDs and query strings are used by the existing application only; output contains the fixed `[id]` template. Unknown route keys are dropped at serialization. The proxy selects only catalog entries and replaces caller-supplied diagnostic values before forwarding.

| Area | Registered method and route |
| --- | --- |
| Calendar | GET `/api/team-workweek/team` |
| Planning | GET `/api/planning-header-data`, `/api/planning-board-data`, `/api/planning-revision`, `/api/sprint-data`, `/api/strategic-planning-data` |
| Task | GET `/api/tasks/[id]/detail-data`; POST `/api/tasks/[id]/comments`, `/api/tasks/[id]/github-comments`, `/api/tasks/[id]/sync-github` |
| GitHub connection | GET `/api/github-app/status`; DELETE `/api/github-app/connection` |
| Workweek | GET and POST `/api/team-workweek/private-draft` and `/api/team-workweek/conflict`; POST `/api/team-workweek/publish`, `/api/team-workweek/reconcile`, `/api/team-workweek/restart` |
| Google connection | GET `/api/google-workspace/status`; GET and POST `/api/google-workspace/disconnect` |
| Notifications | GET `/api/notifications-data`; GET and POST `/api/notifications/deliver` |

The central module owns request contexts, static operations, counters, timing and safe output. Routes only select their catalog entry. `request.workflow` encloses the non-Calendar handler; `credential.action` measures the public credential decision, including execution where that existing action executes work itself. Existing Auth and Workspace phases remain nested below it. HTTP phases identify actual provider attempts. `response.prepare` measures synchronous JSON response construction at the registered handlers and their shared response helpers. It does not measure transfer to the browser. The existing Calendar workflow keeps its detailed Calendar operations.

Membership and Directory credential observations retain their existing meaning. Other data or credential cache outcomes are not inferred from request counts. A low count is not evidence of a cache hit, and a new `instanceId` is not proof of a cold process start.

## Decisions and rationale

- Use a small server-only adapter around standalone Pino. The adapter accepts approved event shapes, not arbitrary objects or free-text messages. Pino remains replaceable behind that boundary.
- Reuse the website's structured event and context conventions. Do not import its logging modules, initialize Payload, or adopt its exception-retention exception.
- Use Vercel runtime logs as the initial destination. Additional log storage, PostHog integration, metrics exporters, distributed tracing, dashboards, and routes outside the fixed catalog require a separate scope decision.
- Keep application logs, metrics, and traces distinct. Logs describe individual events; metrics describe aggregates; traces connect execution across boundaries. Pino alone does not create distributed traces.
- Preserve the [authentication contract](auth-flow.md). Logging must not change authorization results, credential binding, cache deadlines, retry behavior, permit cleanup, or mutations.

The module exposes its random application request ID in the response header and uses the existing Vercel retention window without an additional archive. Neither setting is an authorization input.

## Implemented output

`src/lib/runtime-logging` owns the server-only Pino adapter and independent proxy/route contexts. It uses a local writable stream without a worker or network transport. Unknown fields are dropped before Pino redaction. Only reviewed operations, codes, enums, bounded numeric values and validated deployment identifiers reach output. Neither Pino bindings nor arbitrary messages are exposed to callers.

Every compact completion is emitted at an info-capable threshold. Records include `schemaVersion: 1`, a catalog-owned `scope: calendar | planning | workweek | github | notifications`, static method/route, timestamp, UUID request/runtime IDs, status, outcome, duration, observed processing time and completeness. The route embeds the approved proxy summary when available. Deployment environment, deployment ID, region and Vercel header ID are optional and omitted unless they match the adapter's conservative accepted formats. This does not imply equality with Vercel's runtime Request Id.

The module classifies failures at their observed source before public response mapping. Approved provider HTTP, network, timeout, invalid-response and configuration categories accompany static operation names. Expected access denials retain their existing public `deniedCode` and do not become unexpected application errors. A provider attempt or suppressed cleanup can fail while the factual response remains HTTP 200; the summary then retains the safe failure at `error`. Thrown application errors retain their original identity; raw errors never reach either output stream.

Response completion classifies HTTP 400 and 422 as `invalid_input`, 401 and 403 as `denied`, and other 4xx responses as `rejected`. HTTP 5xx responses, thrown application errors and observed provider failures remain `error`. Every non-success completion retains detail with `retentionReason: non_success`, including expected conflicts such as `edit_context_stale` with HTTP 409. A rejected request does not manufacture an `operation.failed` event when no operation failed.

An operation can accept a provider response as part of its existing protocol. GitHub's existing `allowedStatuses` also governs HTTP observation, so an already absent dependency with an accepted DELETE 404 remains a successful attempt. The Google Calendar capability accepts an optional `allowedStatuses` list containing only 404 and 410 for single-event GET or DELETE operations. The owning workflow declares exactly its existing absence semantics: publication observation accepts 404; disconnect, reconciliation and immediate-effect absence checks accept 404/410. The capability strips this option before network dispatch and ignores it for collection, instance-list and write operations other than DELETE. A normal event read without the explicit absence contract, a transition identity mismatch, and 401/403/5xx responses remain failures. Accepted responses still contribute counts, durations and HTTP phases; this changes no retry, authorization or application-response behavior.

The internal `x-founderops-proxy-observation` request header carries a schema-tagged summary below 1 KiB. Proxy execution deletes incoming diagnostic values before session maintenance and rebuilds Next.js request-override headers after refresh. Existing `Set-Cookie`, cache-control and downstream cookie updates remain intact. Route execution uses its own AsyncLocalStorage context and validates the forwarded summary. Missing or malformed metadata creates a fresh local ID and records `missing` or `invalid` correlation.

The adapter retains at most 64 chronological phase entries per context. Projection caps the combined proxy/route chronological detail at 64 entries. Chronological and slow-chain detail share the existing 10,000-byte allowance, with chronological entries removed first. It then measures the full completion line, including the Pino envelope, and removes chronological entries until the line fits the 16 KiB event limit. Operation aggregates, the eight slowest completed spans and bounded slow-chain evidence retain priority over chronological detail. If the event still exceeds 16 KiB, projection removes slow-chain descendants before their ancestors until it fits, preserving aggregates and the existing slowest list. Truncation preserves failures, cache observations, counts and totals and sets `phasesTruncated`. A final event that still exceeds the limit is dropped safely. Writable errors disable the affected sink; backpressure drops telemetry until drain. No event queue accumulates in the adapter. The fixed fallback marker is rate-limited to once per minute, drops while its own stream is blocked and ignores its own errors. Proxy-summary serialization failure also preserves the completed HTTP response and refreshed cookies.

## Events and approved fields

Use `request.completed` for segment/request summaries and `operation.failed` when a failure still has a known operation and safe category. Membership-cache observations are fields inside the completion summary; normal cache hits do not need individual log lines.

| Group | Approved fields and meaning |
| --- | --- |
| Envelope | `schemaVersion`, `event`, `severity`, `scope`, `operation`, `timestamp`. Names and messages come from reviewed constants. |
| Request | Server-generated UUID `requestId`; optional validated `vercelId`; fixed `method` and route template. Never copy a complete request URL, query, or arbitrary incoming correlation ID. |
| Deployment | `deploymentEnv`, `deploymentId`, public region code, opaque random `instanceId` for the observed runtime lifetime. Omit hostname and process ID. |
| Segment | `stage: proxy | route`, local `durationMs`, outbound-attempt counts grouped by approved operation. A route summary may embed the safe proxy summary. |
| Phase | `id`, optional `parentId`, fixed `operation`, `kind: operation | http`, local `offsetMs`, `durationMs`, and outcome. IDs carry their `proxy:` or `route:` segment prefix. Offsets are relative to their own segment. |
| Cache | `membership.result: hit | miss | expired | coalesced | bypass`, observed `reason`, `evidenceAgeMs`, `remainingLifetimeMs`, `expired`, opaque `cacheOwnerId`, optional `waitMs` and directly observed `capacityEvictions`. Unknown age or lifetime is null. `directoryCredential.result` separately records `reused` or `renewed`. |
| Error | Approved `errorCode`, `errorCategory`, optional integer `providerStatus`, and fixed message. Existing public auth codes remain authoritative for responses. |
| Completeness | `completeness` records correlation, declared transport scope, external-call completeness, uninstrumented adapters, proxy presence, cache availability and phase completeness/truncation. `detailRetained` and `retentionReason` explain detail selection. |

Bound a completion event to 16 KiB and at most 64 phase records. Keep embedded proxy metadata below 1 KiB. Validate strings, enums, numeric ranges, and lengths at the adapter boundary. Drop unknown fields. If detail must be truncated, retain status, the safe failure classification, cache result, counters, and segment durations.

## Complete local operation measurements

Every completion includes `phaseAggregates`, independent of chronological retention, sampling and the 64-entry limit. The fixed operation catalog bounds the number of entries. Each entry groups by `operation` or `http` kind and stores `[count, totalMs, maxMs]`. The count includes each completed observation once, including observations that throw or record a provider failure. Durations are inclusive of nested work. Parallel and nested totals can exceed the request duration and must not be added to derive a critical path.

`slowestPhases` retains up to eight completed spans from the same local context, ordered by duration. These spans include the usual safe operation, kind, outcome, phase ID, optional parent ID, offset and duration fields. Selection covers observations beyond the chronological limit and remains present in compact completions. Offsets use the local segment's start. A retained span can refer to a parent omitted from both bounded lists. Use `slowChainPhases` for ancestor-closed evidence. Neither list reconstructs all request work or proves a critical path.

`slowChainPhases` preserves the parents of slow terminal observations even when they start after the first 64 spans. A terminal observation has no observed child. Selection ranks up to eight terminal observations by inclusive duration, with earlier completions winning ties. Each candidate retains at most 32 ancestor references, including itself. The adapter retains no request-wide registry of completed spans. Active asynchronous scopes carry the same bounded ancestor list through the existing AsyncLocalStorage context.

Projection visits those paths in rank order and emits each shared ancestor once, before its descendants. The shared output budget is 32 spans and 6,000 serialized bytes. A path that exceeds depth or remaining output capacity is omitted as a whole. Ancestors keep their final inclusive durations. `offsetMs` uses the local segment start, and `offsetMs + durationMs` gives the relative end. Parent IDs resolve within `slowChainPhases`; their IDs also match the existing phase lists. Parallel durations overlap and must not be added. For example, a retained prepare HTTP span can identify its SDK operation and `board.sprints` parent, while a release HTTP span identifies the SDK operation that awaited cleanup. SDK durations include body processing and awaited permit release. HTTP durations end when fetch returns a Response.

`completeness.slowChainsComplete` reports whether all local observations finished without measurement failure. A completed child whose ancestor is still running is omitted, and this flag is false. Pending work does not delay the response or emit another completion. `slowChainsTruncated` reports candidate, depth, shared-output or final-envelope limits. These flags are independent: a finished scope can be truncated. A true completeness flag does not mean that the selected paths cover all request work. Slow-chain evidence remains available in compact completions and uses only the fixed operation catalog, IDs, relative times, kind and outcome. It contains no payloads, URLs, profile identifiers, SQL or caller labels.

`completeness.phaseAggregatesScope` identifies the local `proxy` or `route` stage. `phaseAggregatesComplete` is true only when all started local observations have completed and measurement bookkeeping has not failed. Still-pending spans are excluded from aggregates and the slowest list. Their later completion does not emit a second request summary. Completeness describes instrumentation observations, not all work performed by the platform or SDK.

Proxy aggregates and slowest spans remain in the proxy's own `request.completed` event. The existing forwarded summary stays below 1 KiB and does not carry these new fields. Correlate both completion events using `requestId` and preserve their stage boundaries. Route `externalCalls` still merges proxy counters as before; do not add the proxy counters again when using that merged field. Missing proxy correlation remains explicit.

The Board route adds static `board.authorization`, `board.load` and `board.header` spans. Its nine parallel model reads use `board.project`, `board.profiles`, `board.items`, `board.strategy`, `board.raci`, `board.links`, `board.sprints`, `board.relationships` and `board.preferences`. Each read duration includes its existing live checks, dispatch, response handling and permit cleanup. `board.avatars` measures profile mapping and avatar enrichment; `board.map` measures the subsequent model mapping. These spans change no queries, authority checks, scheduling or cache behavior. Shared model callers can produce the same model labels within their own observed request.

The existing `response.prepare` span measures the Board's original `NextResponse.json` execution once. It does not include later network transfer. Server diagnostics do not read, clone or serialize the response body to count bytes. A client measurement may record received body bytes separately.

## Privacy and safe failures

Never serialize raw exceptions, stacks, causes, arbitrary provider codes/messages, request or provider bodies, headers, cookies, credentials, credential fingerprints, cache keys, user identities, private endpoints, or private hostnames. Do not read a body solely for logging.

Classify failures where the operation is known, before existing code collapses several causes into a generic unavailable response. Allowed categories are `timeout`, `transport_error`, `provider_http_error`, `invalid_response`, `configuration_error`, and `unexpected_error`. A failure without an approved mapping receives a fixed unknown-failure code and message. A classifier may use structured values already available to the application; it must not infer a cause from arbitrary exception text.

For example, distinguish failure of `supabase.user`, `workspace.context`, `workspace.permit.issue`, `workspace.permit.release`, `directory.sts`, `directory.iam`, and `directory.membership`. These are static operation identifiers, not URLs. A failed cleanup remains observable even when the existing application intentionally suppresses its exception.

Calendar entry now reports the fixed `workspace.entry` operation for its grouped Workspace-context and session-admission request. Count its HTTP attempt once. Its logical checks do not add `workspace.context` or `workspace.session` attempts. Separate context requests by other actions retain their existing identifiers. A malformed grouped response is an `invalid_response`; an admission-provider failure becomes observable only after the existing identity and OAuth checks have passed. Request arguments and provider details remain excluded.

The combined Calendar entry and dispatch operations use 11 observed attempts rather than 14 for an ordinary warm enforced-linking Cookie load, including all four live `supabase.user` attempts. Google-only mode retains its settings attempt and uses 12 rather than 15. These budgets require warm asymmetric signing keys, a membership hit, one snapshot request and no refresh or retry. Legacy and unenforced linking retain their totals. The [controlled local comparison](credential-verification-measurements.md#grouped-calendar-authorization-comparison) records actual transport counts and separate elapsed times. Historical production measurements below retain their original implementation context.

Expected authorization denials remain denied outcomes with the existing safe code. They are not automatically unexpected application errors. An internal error code does not change the public error body or status. Any future change to that public contract requires its own decision and focused tests.

Use Pino redaction as additional protection after the approved-field projection. Never pass raw `Error` objects to Pino's default serializer or a fallback logger.

## Request and instance correlation

Create a fresh request ID at proxy entry for a registered route. Remove or overwrite caller-supplied application diagnostic headers before forwarding. Re-establish a local request context at route entry; do not assume that AsyncLocalStorage or module globals span proxy and route execution.

Forward only the bounded, approved proxy summary through internal request metadata. Preserve refreshed cookies and existing response behavior. Use Next.js request-header forwarding, not response-header forwarding. Treat malformed metadata as unavailable telemetry, never as an auth failure or authorization grant. A missing context gets a fresh local ID and an explicit incomplete-correlation indication.

Record proxy and route instance IDs separately. A random runtime ID identifies an observed lifetime, not a physical Vercel machine. Generate a cache-owner ID alongside the membership-evidence store so that its lifetime is unambiguous. Never use credential material to construct either identifier.

Return the application `requestId` as `x-request-id` on registered responses produced by the proxy or route, including successful, denied, invalid-input, and handled-error responses. The header must match the context that produced the response. Keep proxy summaries, auth outcomes, cache details, and internal metadata server-side. The ID is a diagnostic reference, not a credential. Failures before application execution are outside this header guarantee.

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

Use monotonic elapsed time within each segment. Measure the proxy, complete route, authorization, provider operations, snapshot and continuation reads, and local response preparation. Parent durations include their children; they must not be added together. Independently dispatched continuation requests have their own offsets and durations.

The route summary contains its local total and the observed proxy duration. Their sum may be reported as observed application processing time because these segments run sequentially, but it excludes the transfer gap, platform queuing, and browser network time. Never label it browser latency or end-to-end request duration. Do not subtract monotonic timestamps from different runtimes.

Count actual HTTP dispatch attempts in the private transports, after their existing authority checks. Include existing retries without adding any. The common Supabase observer covers auth/JWKS, service RPCs, cookie handling, bound data operations and the guarded planning, account, delivery and confirmed-bookkeeping transports. Provider observers cover explicit Directory, Google OAuth/userinfo, Calendar, Chat, GitHub resource/token/asset and GitHub OAuth requests. Global fetch is unchanged. Observation never reads a body. HTTP duration ends when fetch resolves or rejects; it does not measure response-body consumption. The enclosing credential/workflow phases include that work when it occurs before they complete.

The declared scope is `registered_provider_transports`. `externalCalls.operations` contains finite reviewed operation identifiers. `externalCalls.providers` groups attempts into `supabase_auth`, `supabase_db`, `google_workspace`, `github` and `unknown`. Grouped Workspace RPCs count as database attempts; a logical authorization phase adds no request. GitHub GraphQL POST uses the existing explicit read/mutation classification. Supabase `rpc` identifies a transport, not proof of a read or mutation: RPC names and arguments are never serialized. Known planning and identity tables have static groups; other PostgREST requests use generic read/write groups. Calendar-only snapshot labels stay limited to the Calendar route.

`externalCalls.durationMsByOperation` retains summed HTTP-attempt time for every approved operation even when phase detail is sampled out or truncated. These sums can overlap during concurrency and must never be presented as elapsed request time. Use `durationMs` for the route segment and `observedProcessingMs` for the sum of observed proxy and route segments. Browser/network delivery and gaps between runtime invocations remain outside those values.

OIDC acquisition has a timed operation, but its internal requests remain excluded as `vercel_oidc_internal`. Browser-originated requests, SSR work, unregistered routes, Notion and tool-metadata transports are outside this catalog. The completion lists `browser_and_ssr` alongside OIDC as exclusions. Unknown private operations lower completeness. Missing proxy metadata also sets route `externalCallsComplete: false`; available route counts remain useful partial observations. `externalCallsComplete` means complete within the declared transport scope, never unrestricted request-wide external coverage. Shared verification or credential-acquisition attempts belong to the request that executes them, not every waiter. Existing network failures and responses pass through unchanged.

Calendar reads use the fixed operation `calendar.snapshot` for the profile-root PostgREST request, including its embedded published-owner existence check, bounded calendar rows and tail marker. If the embedded rows omit the marker, every continuation dispatch is counted under `calendar.publications`; it receives its own existing authority check and permit lifecycle. These phases describe actual request boundaries. A joined row is not counted as a separate HTTP request, and phase durations are not summed into a synthetic total.

## Production emission and retention

The dedicated pilot logger must allow `info`; copying the website's production `warn` threshold would discard normal performance summaries. Apply selection before emitting:

| Observation | Emission rule |
| --- | --- |
| Compact proxy and route completion | Keep every pilot request, including fast successes. |
| Unexpected operation failure | Keep every failure at `error`, with approved safe fields. |
| Slow successful request | Keep at `warn` when observed proxy plus route processing time reaches 2,000 ms. This is an initial diagnostic threshold, not an SLO. |
| Detailed phases for a failed request, slow request, or membership miss/expiry | Keep all bounded detail available at completion. |
| Detailed phases for fast successful cache hits | Keep a deterministic 10% request-ID sample. |

Buffer only bounded phase detail until completion so that a late failure or slow operation can retain earlier observations. The deterministic sample keeps IDs whose last eight hexadecimal digits, interpreted as an integer, have remainder zero modulo ten. All compact completions remain emitted. `retentionReason` is `non_success`, `slow`, `membership_miss`, `membership_expired`, `sample`, or `compact`. Proxy details needed by the route must survive the forwarding boundary. A killed process may still lose its final summary; this increment does not provide durable delivery guarantees.

Application severity and Vercel's displayed log level are separate. Verify the selected sink and its platform classification. Do not assume that a Pino numeric level on stdout produces the corresponding Vercel badge. Keep explicit application `severity` searchable.

Sampling controls emission, not storage lifetime. Use the existing Vercel retention window without a new archive. The pilot requires no additional minimum retention period. Verify and record the project's actual window before later production acceptance so that operators know how long a request remains available. Longer retrospective diagnosis requires a separate retention decision before introducing storage or changing configuration.

## Server-controlled measurement detail

`RUNTIME_LOG_DETAIL_PERCENT` optionally selects a whole percentage from `0` through `100` for successful fast-request detail. Only that server environment variable is read. Incoming headers, request bodies and query parameters cannot select detail, skip authorization or force a provider operation. Omitted, empty or invalid values retain the existing deterministic one-in-ten request-ID selection. Configured values use the same request ID across proxy and route and report `retentionReason: configured_sample` when selected. Errors, slow requests and membership misses/expiry retain detail independently of this percentage, including when it is zero.

A later authorized measurement window can use `RUNTIME_LOG_DETAIL_PERCENT=100`. Compact completions, attempt counters and duration aggregates are emitted at every setting. The 64-phase, 10,000-detail-byte and 16 KiB event limits still apply at 100 percent; check `phasesTruncated` before treating detail as complete. Restore the default after the window. This change does not set production configuration, change retention, run a performance series or add a measurement script to the repository. The later deterministic series requires separate user approval and uses temporary code outside the repository.

## Logger failure behavior

Keep the first sink local, with no network destination or worker transport. Handle synchronous adapter/serialization failures and asynchronous writable-stream errors. Do not await telemetry network delivery or stream drain in the auth/data path. Bound memory; drop telemetry on sink failure or backpressure rather than retrying application work.

If available, use a fixed, rate-limited safe fallback marker for logger failure. Never include the original logging exception, recurse into the failed logger, or allow fallback failure to escape. This is failure isolation for telemetry only; application authorization remains fail-closed under its existing rules.

## Acceptance checks for implementation

Use Freeman and Pryce's Outside-In TDD and Kent Beck's Test Desiderata when implementing observable behavior. The implementation uses the HTTP/proxy/credential seam and the serialized-output seam. Provider-extension tests cross the actual Google status and task-detail routes, the public GitHub credential/resource operations, and the existing Calendar proxy flow. They cover exact dispatch counts, GraphQL reads, unchanged retry/no-replay behavior, concurrent isolation, forged metadata, dropped output and phase truncation with retained duration aggregates. Controlled tests cover response IDs, safe output, forged/missing metadata, cookie refresh, cache paths and original/JWT deadlines, concurrent request isolation and shared ownership, actual retries, overlapping monotonic intervals, late failures, threshold boundaries, sampling, bounds and sink isolation. Production checks require separate deployment authorization.

1. Seed distinctive secret values into exceptions, causes, unknown fields, headers, URLs, and bodies. Assert their absence from the actual serialized output, including fallback output. Assert the approved safe code and operation remain present.
2. Exercise proxy-to-route correlation with forged diagnostic headers, cookie refresh, missing metadata, and concurrent requests. Preserve cookies and responses; reject forged context without affecting authorization. Assert that `x-request-id` matches the producing context on successful, denied, invalid-input, and handled-error responses, and that internal diagnostic metadata does not appear in response headers.
3. Exercise membership hit, miss, expiry, capacity removal, and coalesced verification. Preserve original verification-start/JWT deadlines, authorization binding, and one execution per shared verification.
4. Use controlled overlapping operations and two interleaved requests. Assert correct local totals, intervals, parent relationships, and actual attempt counts without cross-request leakage or double-counting shared work.
5. Fail the logger synchronously, during serialization, asynchronously at the sink, and under backpressure. Preserve status, body, thrown application error, cookie changes, cache lifetime, dispatch/retry count, and permit cleanup. Emit no recursive failure storm.
6. Exercise late failures, both sides of the slow threshold, deterministic sampling, and truncation. Compact completions and required detailed observations must survive the production logger level.
7. After a separately authorized deployment, inspect real calendar requests. Verify one completion record explains the proxy and route work, cache outcome, safe failures, and declared external-call coverage; verify severity classification and actual retention. Synthetic local timings do not replace production evidence.

## Production acceptance on 2026-10-20

Result: **passed for the bounded production sample**. The active `founder-ops` production deployment was `dpl_7Ss9nCMomXPAw6WdZ4YJSAQk1BXV`, built from commit `9546c8db60085973b2a61fc2bd7cf30ebc9547d5`. The successful [production workflow](https://github.com/findmydoc-platform/founder-scoreboard-v2/actions/runs/39426408444) recorded the same deployment URL that Vercel reported as READY and assigned to the production domain.

Checks ran from 13:17:29 to 13:24:33 UTC. There were 18 targeted calendar GETs: one calendar UI load, ten sequential calls, three parallel calls, one invalid range, one anonymous navigation plus a header-observed anonymous GET in a separate browser context, and one authenticated call after the anonymous check. Response headers were captured for 17 requests. Full application log messages were read through the verified `vercel-findmydoc` CLI profile because the connector shortened longer messages. Queries used the exact deployment, test window, and captured request IDs.

| Check | Result and evidence | Remaining gap |
| --- | --- | --- |
| Success and correlation | All 15 header-observed successful calls returned 200. Each of the 17 captured response IDs matched exactly one proxy completion and one route completion, with complete proxy-to-route correlation. IDs were distinct; no internal diagnostic headers were exposed. | None in the inspected sample. |
| Cache behavior | Two misses and 14 hits across two opaque cache owners. Hits dispatched no Directory membership verification. Observed evidence age plus remaining lifetime stayed at 900,000 ms. | Expiry, eviction, bypass, and coalesced verification did not occur. Cache-owner changes alone do not establish a physical instance change or a miss cause. |
| Parallel isolation | Three concurrent calls returned 200 with separate IDs and matching summaries; all used existing membership evidence. | No shared in-flight verification occurred in this warm sample. |
| Invalid input and missing session | Invalid range returned 400 with `invalid_input` at `info`. The separate anonymous context returned 401 with `denied` at `info`, unavailable membership evidence, and zero scoped outbound attempts. The existing authenticated context subsequently returned 200. | No role or credential changes were made to generate other denials. |
| Output bounds and privacy | All 34 inspected events parsed as JSON and matched the approved field sets. Largest event: 8,325 UTF-8 bytes; maximum 46 phases and 6,774 phase-detail bytes. No disallowed fields or credential, identity, URL, or private-host patterns were found in those events. | This sample does not establish absence of sensitive data in all application logs. |
| Timing and outbound attempts | Durations were finite and nonnegative; observed processing matched route duration plus observed proxy duration. Scoped attempt totals matched operation counts and retained complete HTTP phases. OIDC internals remained explicitly excluded. | Browser elapsed time is not the application's observed processing time. |
| Detail selection and Vercel level | All 34 selection decisions matched the contract: eight slow, two sampled, two non-success, and 22 compact completions. Application `info` and `warn` both appeared as Vercel log-line `info`, consistent with stdout delivery. Search the structured `severity` field to find slow application warnings. | No application error or sampled fast-hit route detail occurred; their production classification was not exercised. No faults were injected. |
| Existing retention | Read-only team configuration confirmed active Pro billing, enabled `observabilityBase` with quantity 1 and its Observability entitlement. The Observability Plus disabled-project list was empty. This establishes the existing **30-day runtime-log retention** under the [published limits](https://vercel.com/docs/logs/runtime#limits) and [project inclusion rules](https://vercel.com/docs/observability/observability-plus#managing-projects). | Entitlement evidence, not a 30-day aging experiment. Recheck after plan or project-inclusion changes. |

The run used calendar GETs and read-only platform inspection. It changed no planning data, roles, credentials, Supabase settings, retention settings, or deployment configuration, performed no cache purge or lifetime change, and triggered no deployment. Raw logs stayed in memory; only these aggregate results are retained. Automated controlled tests remain the evidence for the unobserved cache boundaries, provider failures, logger failures, and backpressure. This acceptance found no confirmed application defect; #517, #518, and #519 remain closed.

## Synthetic output example

This compact warm-hit record comes from the real serialized adapter with synthetic inputs and reflects the pre-snapshot production path. Its 19 attempts include one proxy user check and 18 route attempts. OIDC internals remain excluded. The empty phase array is deliberate detail sampling, not zero application work.

```json
{
  "level": 30,
  "schemaVersion": 1,
  "scope": "calendar",
  "timestamp": "2026-10-20T10:31:45.274Z",
  "severity": "info",
  "requestId": "8ea34e08-8cc2-42ad-a562-87b700000001",
  "instanceId": "2f281f12-aaed-4f75-8b2f-1b69a5c6645c",
  "stage": "route",
  "operation": "calendar.request",
  "method": "GET",
  "route": "/api/team-workweek/team",
  "status": 200,
  "outcome": "success",
  "durationMs": 80,
  "observedProcessingMs": 92,
  "proxy": {
    "requestId": "8ea34e08-8cc2-42ad-a562-87b700000001",
    "instanceId": "3390a311-7f40-49c6-9b71-95c56ebeddbf",
    "durationMs": 12,
    "status": 200,
    "outcome": "success"
  },
  "externalCalls": {
    "total": 19,
    "operations": {
      "calendar.publications": 2,
      "calendar.profile": 1,
      "supabase.user": 5,
      "workspace.context": 4,
      "workspace.session": 1,
      "workspace.permit.issue": 3,
      "workspace.permit.release": 3
    }
  },
  "phases": [],
  "detailRetained": false,
  "retentionReason": "compact",
  "membership": {
    "result": "hit",
    "reason": "cached",
    "cacheOwnerId": "0ddece05-8547-49e8-ac53-597f17c15d83",
    "evidenceAgeMs": 30000,
    "remainingLifetimeMs": 870000,
    "expired": false
  },
  "completeness": {
    "correlation": "complete",
    "externalCallsScope": "private_supabase_and_explicit_directory_http",
    "externalCallsComplete": true,
    "uninstrumented": [
      "vercel_oidc_internal"
    ],
    "proxyObserved": true,
    "cache": "observed",
    "phasesComplete": false,
    "phasesTruncated": false
  },
  "event": "request.completed",
  "msg": "Calendar request completed"
}
```

## Sources

- [Pino API](https://github.com/pinojs/pino/blob/main/docs/api.md) and [default Error serializer](https://github.com/pinojs/pino-std-serializers/blob/master/lib/err.js).
- [Next.js Proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy), including request-header forwarding and execution separation.
- [Node.js asynchronous context](https://nodejs.org/api/async_context.html), [performance measurement](https://nodejs.org/api/perf_hooks.html#performancenow), and [stream errors](https://nodejs.org/api/stream.html#event-error).
- [Vercel runtime logs](https://vercel.com/docs/logs/runtime) and [request headers](https://vercel.com/docs/headers/request-headers).

Private production diagnosis, request samples, and operator artifacts are not part of this contract and must remain outside the repository.


## Grouped dispatch preparation

Calendar loads and `planning.revision.read` use the fixed operation identifier `workspace.dispatch.prepare` for the private `workspace_dispatch_prepare` request. The existing `workspace_calendar_prepare` RPC remains a compatible wrapper around the shared implementation. One HTTP attempt performs current binding validation, mode-dependent session admission and permit issuance where required. Its enclosing operation phase adds no external-call count. `workspace.permit.release` continues to count the separate cleanup request. Other session actions retain `workspace.context` and `workspace.permit.issue`. Planning revision session entry remains separate.

A PostgreSQL `42501` preparation result is an authority denial. A transport failure, timeout, unexpected provider status or invalid result remains a provider failure, even where the existing protected profile error contract returns HTTP 403. Preparation responses and arguments never enter logs. An uncertain outcome may add a cleanup attempt but never a replay of the writing preparation operation. A private terminal transport failure prevents the enclosing GET retry loop from repeating uncertain preparation. Logging failure cannot change the Calendar or Planning revision result.

For the defined warm enforced-linking path with the original entry flow, dispatch grouping saves two attempts (14 to 12 including Cookie proxy); each additional Calendar request saves one more. Grouped entry additionally reduces the one-page total to 11. Google-only mode retains its settings request. Cold keys, membership misses, refresh, retries and legacy/unenforced modes require separate accounting. Historical examples in this document describe their original deployed implementation and must not be read as measurements of grouped preparation.

The controlled warm enforced-linking Planning revision comparison counts the Cookie proxy and route together. Grouping reduces 20 HTTP requests to 17 by replacing three separate context-validation and permit-issuance pairs with three preparation requests. The three protected profile RPCs, their live Auth checks and releases remain separate. The proxy contributes one Auth request; the route contributes 16 requests. This request budget does not establish production latency or a real Google login.
