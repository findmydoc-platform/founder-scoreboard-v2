# Planning read consistency and client ownership

## Status

Document status: Accepted. Constraints were approved in [decision #637](https://github.com/findmydoc-platform/founder-scoreboard-v2/issues/637#issuecomment-6827012925) and [decision #638](https://github.com/findmydoc-platform/founder-scoreboard-v2/issues/638#issuecomment-6828242358), then carried into [specification #641](https://github.com/findmydoc-platform/founder-scoreboard-v2/issues/641). This record does not assert that every reader already supplies the required evidence. Current coverage and migration status belong in the [read contract](../planning-item-read-contract.md).

## Context

Progressive reads can make independent work usable earlier. They can also combine old pages, fresh details and unrelated totals into a false current result. An Item timestamp does not cover every contributing source. Discussion, preferences and temporal conditions can change without an Item update. Late reads can reverse a confirmed edit unless acceptance preserves its evidence.

## Decision and rationale

Keep the existing client Planning-state owner as the sole coordinator of accepted Planning results. The shared read module owns source dependencies and compatible task foundations. Joint assertions and dependent actions require a demonstrably compatible complete basis across selection, supporting sources and hydration. Independent tasks can use different valid bases. No global FounderOps snapshot is required.

Separate invalidation, scheduling, cancellation and response acceptance. Invalidation marks potentially affected evidence stale. Scheduling requests only currently needed replacement data. Cancellation asks supported transports to stop unnecessary work. Acceptance discards obsolete success in full and protects confirmed writes, field coverage and session binding. These responsibilities solve different problems and cannot substitute for one another.

Keep reusable Item fields separate from query membership. A newer Item version does not reconfirm omitted detail fields. A continuation belongs to its user, scope, query, ordering, source and temporal basis. Incompatible pages restart their affected scope instead of forming an apparently complete result. Previously useful authorized content can remain explicitly stale while independent activities continue.

Source equality never renews authority or temporal validity. [ADR 0002](0002-central-credential-verification.md) retains credential ownership and original deadlines. [ADR 0001](0001-deep-task-github-projection.md) retains durable synchronization ownership. UI demand changes do not cancel writes or durable jobs.

## Alternatives

- A global snapshot couples independent tasks and adds coordination beyond their actual assertions.
- Independent per-view caches duplicate acceptance and can disagree about writes, coverage and sessions.
- A full reload after every change discards useful independent work and duplicates reads.
- Item timestamps or content hashes alone miss contributing sources and do not prove coherent database reads.
- Keeping historical snapshots for continuations adds lifecycle and storage obligations. Scoped stale rejection and restart were selected instead.

## Consequences

Every changed reader must identify contributing sources and relevant evaluation-time boundaries. Tests must distinguish partial, stale, unavailable and forbidden data from proven absence. Authorization loss removes affected protected content immediately. First successfully stored writes win, stale writes conflict, and uncertain outcomes remain unconfirmed under existing operation contracts.

Exact scheduling values and interaction guarantees belong in the shared contract rather than this rationale. Observable evidence must distinguish request suppression, coalescing, cancellation, observed backend termination and response rejection. Smaller payloads or rejected late responses alone prove neither faster interaction nor less database work.
