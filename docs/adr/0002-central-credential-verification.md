# ADR: Central credential verification and action authorization

## Status (Table)

| Name | Content |
| --- | --- |
| Author | Sebastian Schütze |
| Version | 0.3 |
| Date | 17.10.2026 |
| Status | Draft |

## Background

FounderOps accepts user sessions, personal Planning Items tokens and technical request credentials. It also obtains credentials for outgoing GitHub, Google, Notion and database operations. Before this change, authentication, Workspace membership, authorization and refresh knowledge spanned callers, guards, transports and provider helpers.

This record follows **ADR according to Nygard**, using the [Website ADR template](https://github.com/findmydoc-platform/website/blob/eda78ba87601db5f00fe8c218ce1acd36e6b0b1d/docs/adrs/templates/adr-templates.md). It records the architecture decision and its consequences; it does not assert implementation or deployment. The existing [Task GitHub projection decision](0001-deep-task-github-projection.md) remains in force. The architecture constraints are approved by spec #487. Document status remains Draft. The implementation now includes the migration and contract closeout; production deployment and the separate acceptance measurements remain distinct states.

## Problem Description

Repeated authentication and Workspace checks add external requests to normal use. The calendar and private workweek draft paths demonstrate that a route guard and its subsequent data operations can rebuild the same verification chain. Other callers independently own session recovery, credential expiry or provider refresh. A voluntary helper leaves those competing paths available and allows future drift.

## Considerations

Keeping the current distributed checks preserves familiar call sites but retains repeated network work and scattered policy. A GET-only opt-in removes some duplicates but leaves authorization and refresh knowledge outside the proposed module.

A mandatory server-side deep module concentrates that knowledge and supports deterministic dependency enforcement. It requires a broad refactor, including browser session transport and provider credential ownership. One public decision seam can contain different internal adapters without treating every credential as a user session.

A process-local cache adds no infrastructure and can honor a fixed maximum evidence age across instances. It does not share hits or coordinate rotating refresh tokens between instances. A shared evidence store could reduce duplicate verification but introduces network reads, storage lifecycle and concurrency handling. The existing database is justified for cross-instance rotation or one-time claims; a new cache service is not justified by the present evidence.

## Decision with Rationale

We centralize credential verification, action authorization, freshness policy and credential lifecycle management in one mandatory server-side deep module. Callers identify the credential and intended action. They do not select verification modes, cache lifetimes, introspection or refresh strategies. Approved internal adapters own provider-specific verification and credential handling. Routes and resource adapters receive only the context or constrained access they need.

We allow role and Workspace-membership changes to take at most 15 minutes to affect authorization. The deadline derives from the original authoritative verification, conservatively timed from the start of that verification. Cache hits, copying evidence and repeated use never extend it. Known token expiry and temporal authority limits remain binding. This allowance does not authorize equivalent delays for other revocation or data-right changes.

We keep identity, action permission and outgoing credential usability distinct. Personal tokens never inherit browser-session administrator activation. Scope checks, usage accounting, limits, signatures for the concrete payload, one-time consumption and operation-specific claims remain effective on cache hits.

We begin with bounded process-local evidence caching and coalesce concurrent equivalent verification within an instance. We use the existing database where cross-instance rotation or one-time consumption requires durable coordination. Shared evidence storage is a later internal choice only when measurements justify it; callers remain unaffected.

We enforce the public seam with resolved dependency checks, restricted SDK and transport access, server-only ownership and executable rejection fixtures. Old unrestricted entry points are removed. User-bound data adapters reuse verified context while retaining database JWT verification, per-operation permits, grants, RLS and ownership. Existing service-backed reads still require their actual action and data restrictions.

Calendar loading and the private workweek draft are the first end-to-end proof cases. Completion includes all actual FounderOps callers and credential families. This decision preserves the separate Task GitHub projection module and its mutation contracts.

## Technical Debt

The contract closeout removes the legacy guards, client-argument delegation, unrestricted server/browser acquisition helpers and public verification-only action variants. Live session, Workspace, permit, provider-proof and service-client implementations are private to the credential module. The inventory in `docs/credential-verification-inventory.md` records actual application actions and deliberately public contracts.

The resolved dependency verifier rejects SDK acquisition, private imports, computed loaders and independent transport outside the declared resource boundaries. The browser dependency graph and production static-bundle verifier provide separate source and emitted-artifact checks. The remaining transport declarations are resource protocols, not transitional verification exceptions.

Membership evidence is cached within its original deadline. Role, account and binding checks remain live. Shared header caches hold data only; each invocation checks its own authority before cache hits and uses its own guarded client on a miss. Confirmed operations retain only their exact existing accounting authority, bound to accepted operation IDs and captured database configuration.

Process-local caches can repeat verification after cold starts or on other instances. Their deadlines still bound role and membership staleness. Cache effectiveness and total remaining network requests must be measured before adding shared storage.

The broad refactor increases the importance of one stable public seam. Provider protocols remain internal adapters rather than public flags. Tests that only assert removed wiring are replaced by observable behavior tests at that seam; distinct database invariants retain focused coverage.

## Risks

An incorrectly broad cache entry could transfer authority across users, sessions, credentials, providers, scopes or actions. Evidence must retain those bindings, and each intended action must be evaluated with its applicable requirements.

An outage must not renew expired authorization evidence. Explicit denial and temporary inability to verify remain distinguishable. Existing checks for non-deferred revocation conditions remain authoritative until an equivalent replacement is demonstrated.

Independent refreshes can overwrite newer credentials or misuse rotating refresh tokens. Cross-instance coordination must prevent stale writes, preserve usage tracking and avoid replaying external mutations after uncertain outcomes.

Browser refresh centralization changes session transport responsibilities. Cookie propagation, origin and CSRF protections, logout, session replacement and protected client-state clearing need direct acceptance coverage.
