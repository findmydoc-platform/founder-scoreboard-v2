# Credential verification measurements

## Bound GitHub status resource operation

On 2026-10-23, the complete GitHub status route was compared against `512a589b35370e569879b6fd402bf46e36355692` with the same synthetic fixture. The route still returns the user connection, waiting-comment count and independently obtained installation availability. Its resource operation now calls the existing private user-status implementation through its already bound, guarded database adapter. It no longer starts a second full session admission inside that operation. The standalone session-status action, disconnect and installation-status implementation are unchanged.

The integration fixture uses real local Auth, asymmetric JWT verification, JWKS and PostgREST. Synthetic OAuth session state is prepared before counting. Google STS, IAM and Directory and GitHub installation HTTP use fixed synthetic responses. Unexpected external requests fail. The cold observation includes fresh signing-key and membership evidence; the second invocation reuses those caches. Both observations include the pending-comment HEAD and separate installation GET. They exclude fixture creation, imports, a running Next.js server and the cookie proxy. These are direct Bearer route counts, not the historical production count of 41 that includes the cookie proxy, and establish no production latency result.

| Actual HTTP operation | Before cold / warm | After cold / warm |
| --- | --- | --- |
| JWKS | 1 / 0 | 1 / 0 |
| Auth user | 8 / 8 | 6 / 6 |
| Workspace access context | 8 / 8 | 6 / 6 |
| Linking session admission | 2 / 2 | 1 / 1 |
| Permit issue | 6 / 6 | 5 / 5 |
| Current authenticated profile | 6 / 6 | 5 / 5 |
| Permit release | 6 / 6 | 5 / 5 |
| Configured GitHub login | 1 / 1 | 1 / 1 |
| User token row | 1 / 1 | 1 / 1 |
| Waiting-comment count | 1 / 1 | 1 / 1 |
| GitHub installation GET | 1 / 1 | 1 / 1 |
| Directory STS, IAM and membership | 3 / 0 | 3 / 0 |
| **Total** | **44 / 40** | **36 / 32** |

The same fixture passed with baseline counts before the production change was restored. The retained `github-status-resource` integration test asserts the complete after budget and response. Focused cases retain all four existing reader roles, reject anonymous and unmapped actors, and exercise held operations after session loss, profile unbinding, role changes and Workspace-policy changes. Live connection revocation and login-association changes remain visible. Expiring tokens retain durable refresh claims, rotation, usage accounting on successful rotation, reconnect responses after unknown outcomes and protection against overwriting replacement connections. Ordinary status reads add no token-use mark. Credential reads and refresh claims retain the adapter's live dispatch checks, and the final live check still prevents a result after authority changes during the pending-comment read. Count failures retain their existing zero fallback.

## Bound Google Workspace status resource operation

On 2026-10-23, the complete Google Workspace status route was compared against `d540758ae8798e0e11d2b16e908abf6bc3dfd323` with the same synthetic fixture. The resource operation reuses its existing session admission through a private status seam. Before raw vault access, the bound context still revalidates the current Auth session, mapped profile, exact admitted role and Workspace policy. It checks the original evidence deadline and configuration binding. The full session-policy owner check and connection snapshot immediately before the primary Calendar probe remain in place. Standalone status, Calendar mutations and disconnect operations retain their existing paths.

The fixture uses real local Auth, asymmetric JWT verification, JWKS and PostgREST. Google STS, IAM, Directory and Calendar HTTP use synthetic responses; unexpected external requests fail. Counting starts after fixture setup and module imports. Cold includes signing-key and membership acquisition, and warm is the next invocation in the same worker. Both include pending-disconnect lookup, all three vault snapshots, the existing token-use RPC and one primary Calendar probe. The probe remains the five-second `GET /calendar/v3/calendars/primary/events` with `maxResults=1`, `fields=kind,summary` and the existing `founderOpsProbe=__never__` private-property filter. The scope excludes a running Next.js server and cookie proxy. Its baseline is 39 cold and 35 warm, not the historical production baseline of 36. This comparison establishes request savings, not production latency.

| Actual HTTP operation | Before cold / warm | After cold / warm |
| --- | --- | --- |
| JWKS | 1 / 0 | 1 / 0 |
| Auth user | 7 / 7 | 6 / 6 |
| Workspace access context | 7 / 7 | 6 / 6 |
| Linking session admission | 3 / 3 | 2 / 2 |
| Permit issue | 4 / 4 | 4 / 4 |
| Current authenticated profile | 4 / 4 | 4 / 4 |
| Permit release | 4 / 4 | 4 / 4 |
| Connection snapshots | 3 / 3 | 3 / 3 |
| Existing token-use RPC | 1 / 1 | 1 / 1 |
| Pending-disconnect lookup | 1 / 1 | 1 / 1 |
| Primary Calendar probe | 1 / 1 | 1 / 1 |
| Directory STS, IAM and membership | 3 / 0 | 3 / 0 |
| **Total** | **39 / 35** | **36 / 32** |

The public-route integration test asserts the complete response and after budget. Focused cases retain all four reader roles, anonymous and unmapped denials, held-resource denials after session/profile/role/Workspace changes, and rejection when the same session is mapped to a different owner. They also cover session loss and owner replacement after credential acquisition but before the probe, connection and token-version replacement, successful rotation, rejected/unavailable/uncertain refresh outcomes and a replacement connection during refresh. Scope, configuration and refresh deadlines retain their guards. Missing/revoked connections, pending-disconnect ownership and cleanup lookup failures retain their response semantics. No additional status token-use mark is introduced. Refresh claims, compare-and-swap finalization, encrypted storage and existing usage accounting remain owned by the credential implementation.

## Scope and method

These are local acceptance measurements, not a production latency guarantee. Before is `facc2e42ba0a95a8411e9d939cb909973b598122`; After is runtime source `17955b50917034c49ebb1b758635d8c07c8dccbc`. These measurements preceded the later bounded session-lifecycle and module-coverage correction; their source metadata and values are historical and unchanged. Both versions ran serially on the same Darwin arm64 host with Node v26.11.1 and Next.js 16.3.8, Postgres 17.6, synthetic users and fixed fixture dates. The Workweek DDL shared by both versions is byte-identical. Before used its actual 26-migration ledger; After used its actual 29-migration ledger. No new-schema assumption was imposed on the baseline.

Auth, Directory and Google login proof were scripted, zero-delay protocols. PostgREST and storage authorization used the real disposable database. External network access remained denied. No actual Google/GitHub/Notion/Chat request was sent. HTTPS used an owned certificate and browser-context trust; global TLS validation remained enabled.

The warm HTTP series uses development webpack Next.js, one untimed route warmup and 30 serialized samples per persisted state and version. TTFB stops at response headers; total stops after consuming the body. All 32 matched symbolic response digests agree. Canonicalization removes synthetic UUID differences and sorts owner-membership sets. Within calendar history it sorts only ties with the same effective date and publication revision, where the baseline secondary order is a random UUID. Meaningful chronology, weekdays, windows and presentation order remain unchanged.

The recorder observes actual fetch attempts and four unchanged function bodies: Proxy, route and the entry authority function. It adds file-writing overhead to both versions; this overhead is not calibrated. Entry-authority timings are not total verification time: the old route performs additional verification after its initial guard. Phase durations overlap and must not be added or subtracted from TTFB as independent costs. Request counts include actual permit issue/release and binding checks; data-only timing is not claimed.

Every summary below is median / nearest-rank p95 / maximum in milliseconds. Every recorded outlier remains included. Warm rows have n=30 per version. Request-category cells show exact counts or observed minimum–maximum per sample, not a rounded average.

## Separate module verification and deadlines

These five scenarios use isolated Node public-route protocols, controlled Date and real monotonic timing, with n=30 per scenario/version. They do not measure Next, browser or real-database latency. Module/verification-cold is a new module and original evidence miss. Expiry is exactly the original 900-second deadline, without sliding. Renewal requires fresh evidence; outage returns 503. Directory credential renewal advances its own service credential lifetime. Controlled clocks are never applied to the Next process or database.

| Scenario/version | Elapsed | Requests per sample | Status |
| --- | --- | --- | --- |
| `cold-authority-miss` Before | 1.56 / 2.40 / 9.54 | Auth 8, Data 2, Directory 6, EvidenceStore 13, Permit 6 | 200 |
| `warm-evidence` Before | 0.65 / 0.86 / 0.93 | Auth 8, Data 2, Directory 4, EvidenceStore 13, Permit 6 | 200 |
| `evidence-expiry-renewal` Before | 0.60 / 0.75 / 0.78 | Auth 8, Data 2, Directory 4, EvidenceStore 13, Permit 6 | 200 |
| `evidence-expiry-outage` Before | 0.10 / 0.13 / 0.16 | Auth 1, Directory 1, EvidenceStore 1 | 503 |
| `directory-credential-renewal` Before | 0.59 / 0.71 / 0.87 | Auth 8, Data 2, Directory 6, EvidenceStore 13, Permit 6 | 200 |
| `cold-authority-miss` After | 1.62 / 2.50 / 11.03 | Auth 4–5, Data 2, Directory 3, EvidenceStore 6, Permit 6 | 200 |
| `warm-evidence` After | 0.62 / 0.87 / 0.90 | Auth 4, Data 2, EvidenceStore 6, Permit 6 | 200 |
| `evidence-expiry-renewal` After | 0.57 / 0.76 / 0.78 | Auth 4–5, Data 2, Directory 1, EvidenceStore 6, Permit 6 | 200 |
| `evidence-expiry-outage` After | 0.26 / 0.34 / 0.58 | Auth 1, Directory 1, EvidenceStore 2 | 503 |
| `directory-credential-renewal` After | 0.63 / 0.87 / 1.04 | Auth 4–5, Data 2, Directory 3, EvidenceStore 6, Permit 6 | 200 |

## Final verification source

The earlier complete global checks passed on test-source candidate `ae655c595a9e15641beaaae4eb12c9c2e773709d`, after two fixture-only repairs retained with their observed failures. At that measured checkpoint, runtime source was `17955b50917034c49ebb1b758635d8c07c8dccbc`. The matched measurements retain that source and schema metadata. The subsequent session-lifecycle correction has a different executable source and new regression evidence in the [post-acceptance record](credential-verification-acceptance.md#post-acceptance-session-lifecycle-and-module-coverage); these historical measurements are not a measurement of that correction. The final global client scan is 63 chunks/maps and 2,231,432 bytes; it is separate from both the measurement build (183/2,390,345) and ticket 502’s earlier build (63/2,231,293).

## Grouped Calendar authorization comparison

The comparison for #523 and #526 ran on 2026-10-21. Before is `d906a9a50b1d60755055d443603b5ff9348997d8`; After runtime is `b13c5b00eefde93e2029828df45ab8968daa6e9a`. Both use the same dependency installation and disposable database with additive grouped RPCs present. The baseline invokes its original separate operations. Neither revision is patched for measurement.

The host runs Darwin arm64 and Node v26.12.0. The pinned Supabase CLI is v2.115.0 and the actual Auth container is GoTrue v2.195.0. Auth issues a real ES256 token with a key ID. Synthetic account setup signs in with a password, adds an OAuth AMR record to the disposable session, and refreshes through real Auth. Real `/user`, JWKS and PostgREST requests remain unmodified. This prepares synthetic OAuth session state; it does not exercise an external Google login. Only Google STS, IAM and Directory protocols return fixed synthetic responses, without delays. Google-only accounting also simulates the settings response because the disposable Auth provider configuration does not meet production Google-only configuration.

Each version runs in its own resident Vitest worker with independent module caches. The timed operation starts immediately before the public Cookie proxy action and stops after `authorizeCredentialAction` and its returned `calendar.readSnapshot` complete. It excludes imports, worker startup, account/fixture creation and result hashing. It measures the complete public credential journey, not browser navigation, a running Next.js HTTP server or production TTFB. A pass-through observer counts every actual fetch attempt and checks that protected requests retain the exact original JWT. No production testing flag or cache mutation interface is added.

The matched fixture uses the same viewer, JWT, Workspace linking policy, published owner, publication and date. Five untimed warmups per worker follow its initial cold request. Each batch then runs twenty ABBA blocks, giving 40 samples per version. Three batches use fresh workers. Samples remain within the original membership and JWT deadlines. Each of the 240 timed samples has the expected request count, four regular live Auth checks, no Directory request, refresh or retry, and an identical full snapshot digest. The timing host runs the shared local Docker infrastructure; no build, broad test suite or other deliberate CPU-heavy task runs during sampling. This does not imply a dedicated physical host or a cold database/OS cache.

| Batch | Before median / Q1 / Q3, ms | After median / Q1 / Q3, ms | Paired median saving, ms |
| --- | --- | --- | --- |
| 1 | 113.77 / 109.23 / 119.02 | 110.51 / 106.32 / 117.72 | 2.95 |
| 2 | 109.87 / 104.92 / 121.01 | 102.88 / 99.02 / 110.58 | 5.99 |
| 3 | 107.80 / 105.72 / 110.32 | 103.62 / 101.65 / 105.76 | 4.28 |

For even sample sizes, the median averages the middle pair. Quartiles linearly interpolate the sorted array at `(n - 1) * p`. Paired savings compare corresponding Before/After samples within each ABBA block.

Each batch median is lower after grouping. Variability overlaps and individual samples regress: the paired differences range from -82.68 to 51.24 ms, and batch 2's maximum is 246.40 ms Before versus 260.50 ms After. No sample is discarded. An earlier exploratory series also had lower batch medians but failed a later Google fixture assertion; it is excluded from this accepted table. The retained warm batches completed before a separate Google fixture setup failed. A corrected accounting rerun retained those raw timings, completed the comparison assertions and created a fresh real Auth session after Google-mode activation. Failed fixture attempts are not provider or performance successes. Raw arrays and task-specific drivers remain outside the repository.

This is a repeatable local median improvement under the declared conditions. It establishes no fixed percentage, general production speedup or improvement for every mode or request.

### Actual attempt accounting

For the ordinary warm Cookie path, the phase budget is proxy 1, entry 3 to 2, protected profile 5 to 4, and first snapshot 5 to 4. Profile and snapshot each retain their original user-JWT request, independent live Auth and separate permit cleanup. Logical phase spans add no HTTP count.

| Matched scenario | Before | After | Conditions and result |
| --- | --- | --- | --- |
| Warm enforced linking, Cookie | 14 | 11 | One owner/publication; four regular `/user` requests; no refresh/retry/Directory |
| Warm enforced linking, Bearer | 13 | 10 | Same complete result; no Cookie proxy |
| Fresh worker/signing keys and membership | 18 | 15 | One real JWKS request and three simulated Google requests in addition to the warm budget |
| Warm Google-only, Cookie | 15 | 12 | Real Auth/PostgREST; settings response simulated explicitly; no membership request |
| Legacy, Cookie | 9 | 9 | No membership or permit issuance; no latency benefit established |
| Unenforced linking, Cookie | 9 | 9 | No membership or permit issuance; no latency benefit established |
| 101 publications for one owner | 19 | 15 | Complete history includes one independently authorized publication continuation |
| 101 owners and 201 publications | 24 | 19 | Both pagination dimensions; complete identical snapshots |

Additional count scenarios are one matched observation each, not repeated latency evidence. The Google-only warm observation was slightly slower after grouping, as were the legacy and unenforced-linking observations. They are not included in the three enforced-linking timing batches. A separate matched date-range observation uses a valid publication supersession chain and returns the same 39 relevant publications from the 101-publication owner history. Published owner membership remains intact.

Symmetric JWT verification, concurrent/coalesced membership, expired evidence, Cookie refresh and permitted-read retries remain separate controlled regression scenarios. Symmetric verification adds its real Auth fallback to claim verification; it is not an asymmetric warm-key measurement. Each additional permitted Calendar attempt has fresh live Auth, grouped preparation, user-JWT dispatch and cleanup, compared with five separate attempts before grouping. Refresh traffic and retries must be counted as actual attempts, never blended into the ordinary budget. The controlled transport tests verify those paths and uncertainty/no-replay behavior; this experiment claims no real-provider latency result for them.

### Repeating the comparison

Use an isolated disposable Supabase project and verify its configured target before connecting. The integration runner resets the entire configured database; a separate worktree alone is insufficient isolation. Keep the baseline executable outside the implementation checkout and use matching dependencies. Seed synthetic Auth, strict identity binding, session admission and the same Calendar data, then pass the same real session to independent resident workers. Stub only the explicitly declared external protocols and deny unexpected hosts. Observe fetches without retaining URLs, headers, bodies, credentials or identities.

Warm workers independently, alternate ABBA order and time only the complete public journey with a monotonic clock. Assert the expected attempt map, original JWT use and full result equality in every sample. Record sample arrays privately and publish revision IDs, sample size, quantiles, ordering, exclusions and adverse results. Repeat with fresh workers before accepting a latency gain. Keep cold keys/membership, Google settings, transport, pagination, refresh and retry cases separate. Rerun production observation only after a separately authorized deployment; historical production data above does not measure this optimization.

The Migration Integration CI job now allows 30 minutes. Its previous 20-minute budget expired during cleanup after all 30 migration test files had passed on the combined runtime candidate. The additional time retains the complete migration suite and unconditional cleanup; no check or assertion is removed.
