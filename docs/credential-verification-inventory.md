# Credential verification inventory

This inventory describes the integration base for spec #487. It applies Parnas's Information-Hiding Criterion and Robert C. Martin's Dependency Rule. Tests follow Freeman and Pryce's Outside-In TDD and Kent Beck's Test Desiderata. It records actual callers and credentials, including supported public and development contracts. It does not claim that migration or deployment is complete. The calendar route currently loads publications once and derives the selected range locally; historical counts in the spec describe an older analysis revision.

## Ownership and migration

The only new public server entry is `authorizeCredentialAction` from `@/lib/credentials`. Its input contains a credential and a semantic action. No caller chooses an adapter, cache lifetime or verification mode. `credentials/types.ts` exports types without runtime secrets. `credentials/internal/` is private and marked server-only. In the expand phase, the internal `legacy-session.ts` delegates to unchanged `authz.ts`. Old entry points stay compatible only for explicitly listed existing dependency edges. They are temporary debt, removed in #502.

The action result preserves the existing discriminated `ok` result, safe HTTP status, German message, optional error code and session authority. It exposes no Supabase client, provider token or service credential. The first adapter accepts Bearer request transport through existing guards. Cookie, browser lifecycle, personal and technical credential variants enter through their later vertical slices. They must not become caller-selected verification strategies. The expand step adds no cache or evidence claims. #489 owns exact credential binding, original verification timestamps, separate identity/action/outgoing usability, single-flight and failure behavior. Subsequent families extend this same public entry.

| Caller class and concrete entry | Credential or evidence | Required continuing contract | Migration |
| --- | --- | --- | --- |
| API guards in `src/lib/authz.ts`, API routes importing those guards | Bearer session JWT, authoritative profile binding | Existing role matrix, invalid session 401, verification outage 503, profile denial 403 | #489, #493, #504–#507 |
| `src/lib/planning-auth-server.ts`, `src/lib/supabase-server.ts`, `src/proxy.ts` | Cookie session, SSR and Proxy refresh | Request/response cookie propagation and exact account binding | #491 |
| `src/lib/browser-session-adapter.ts`, `src/lib/supabase.ts`, browser API and feature hooks | Browser login/recovery/refresh/logout | Clear protected state, prevent late account replacement, server-owned refresh decisions | #492 |
| `src/app/auth/login`, `callback`, `signout`, `google-link/start`; `src/app/api/auth/*` | PKCE/code exchange, Google login proof, OAuth state and link nonce | Redirect validation, exact identity, actual nonce consumption; no invented universal one-time-state rule | #491 |
| `src/lib/workspace-access.ts`, `workspace-directory.ts`, `google-provider-proof.ts` | Workspace context, Google session, Directory service identity, provider token proof | Domain/group checks, session admission, non-deferred mutable checks, original 900-second role/membership deadline | #489, #491 |
| Administrator access routes and `administrator-access` model | Session-only activation, eligibility, expiry, current capability | CEO governance remains separate; personal tokens never inherit activation | #493 |
| `src/features/planning-items/model/planning-items-token.ts`, `planning-actor-context-server.ts`, token and Planning Items routes | Personal token and session actors | Authoritative token RPC, owner, scopes, usage accounting, revocation, expiry and active-token limits | #494 |
| Team workweek calendar route and publication reads | Verified session, exact per-operation database permits | Confirmed public schedule only, owner/range/history, distinct permits, database enforcement | #489 |
| Private workweek draft and edit-context readers | Owner session, edit context, conflict revision | Five base user operations plus conditional reads, one selected context, stale-context 409 | #490 |
| `workspace-data-fetch.ts`, `supabase-user.ts`, user data paths | Exact JWT, method/path, admission permit, generation and expiry | JWT enforcement, separate permit issuance/release, RLS, grants and ownership | #489, #490 |
| `supabase-service-role.ts`, `getServerSupabase`, feature read-model adapters | Database service key or existing fallback credential | Explicit actor/action/owner filters; never substitute unrestricted service reads for user access | #489, #490, #499, #504–#510 |
| `src/lib/github-app.ts`, OAuth callback, GitHub resource modules | Installation JWT/token; separately encrypted user access/refresh token | Installation/account binding, vault, scopes, rotation, persisted use; user authorship remains user-bound | #495, #496 |
| `src/lib/github-http.ts`, `github-sync/task-projection.ts` | Constrained outgoing GitHub capability | Required transport, serial mutation, observe/compare/apply/reconcile, durable idempotency; existing projection ADR stays in force | #495, #496 |
| `team-workweek/server/google-workspace-oauth.ts`, provider operations and disconnect | Google Calendar connection access/refresh token and bound signed state | Owner/account/scope, encryption, guarded rotation, reconnect, uncertain mutation reconciliation | #497 |
| `src/lib/google-chat.ts`, `src/app/api/google-chat/events` | Bot/service-account access, configured webhook, signed event | Bot credentials confer no human action authority; preserve delivery and payload verification | #498 |
| `src/lib/notion-decision-log.ts`, Decision Log readers/actions | Notion integration credential plus human action authority | Existing integration purpose/timeouts; CEO-only Decision Log editing | #499, #506 |
| `src/app/api/team/platform-releases/v1/releases` and release manifest model | Release ingest technical credential, manifest digest | Digest, exact ingest contract, idempotency and attribution | #501 |
| GitHub webhook and Google Chat event routes | Concrete raw payload signature and delivery identity | Exact payload validation, deduplication and claims remain per operation | #498, #500 |
| Cron paths using `src/lib/maintenance-auth.ts` | Dedicated Cron Bearer secret | Timing-safe secret comparison, job ownership/claim/lease and consumption | #508 |
| `src/app/api/maintenance/*` | Dedicated maintenance secret | Technical action separation and existing maintenance claims | #509 |
| `src/app/api/notifications/deliver`, GitHub review/comment delivery | Dedicated delivery secret, outgoing provider credentials | Delivery authentication, attempts, claim consumption and safe recovery | #510 |
| Planning boards, tasks, sprint and trash workflows | Session action and resource context | Existing planning/deputy matrix, approval and revision checks | #504 |
| Account, settings, profile, administration data and preview endpoints | Session identity/capability plus bounded resource target | Existing owner filters, administrator expiry and preview access | #493, #505 |
| Interactive intake, AI task creation, bulk planning | CEO session and operation context | CEO-only scope, independent operation permits and model credentials | #507 |
| `src/app/api/auth/login-mode`, auth error pages, explicitly inert responses | Public configuration or no usable credential | Preserve public/inert contract; never treat these as authenticated actors | #491, #505 |
| `src/lib/local-development-auth.ts`, local-login route and dev profile override | Development-only simulated profile | Existing host/environment gate; deny deployed entry points | #489, #491 |
| `src/app/api/health/route.ts` | Existing public readiness probe using server database access | Return readiness/configuration booleans only, without granting a human actor or returning credentials | #499, #505 |

## Executable dependency rule

`pnpm verify:credentials` runs compiler-resolved fixture projects and the repository check. `pnpm build` also runs the repository check before Next.js compilation. Resolution honors `@/` and relative imports. The check visits imports, re-exports, namespace imports, literal dynamic imports, import-equals and CommonJS. New helpers cannot indirectly expose an internal adapter or a protected legacy entry because the helper's own edge fails. Non-literal runtime loads fail closed. Type-only imports remain usable.

The checked-in policy lists exact current source/target legacy edges and bounded network identifier references per file. It does not exempt `src/lib` or another directory. New SDK imports, protected helper dependencies and network references require approved internal adapter ownership. This is deterministic architecture enforcement, not a sandbox for malicious JavaScript. Approved internal adapters may use provider SDKs and transports. New public callers may import only the public seam or runtime-free types. Keep allowances shrinking as families migrate; do not regenerate a baseline to hide violations. #502 removes legacy allowances and delegation, and #503 validates the complete application and client bundle.

## Evidence and remaining work

#488 preserves existing authorization behavior and adds executable dependency acceptance/rejection fixtures. Focused seam tests use real guards and Supabase protocol handling with scripted external responses. They verify missing credentials, allowed founder planning access and denied CEO action. No existing database is reset, no provider is contacted and no performance improvement is claimed. All freshness, credential rotation, browser transport and real database acceptance remain assigned to the vertical slices and final acceptance.
