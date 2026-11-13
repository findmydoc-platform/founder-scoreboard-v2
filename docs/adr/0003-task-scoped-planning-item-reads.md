# Task-scoped Planning Item reads

## Status

Document status: Accepted. Architecture constraints were approved in [decision #636](https://github.com/findmydoc-platform/founder-scoreboard-v2/issues/636#issuecomment-6712685439) and carried into [specification #641](https://github.com/findmydoc-platform/founder-scoreboard-v2/issues/641). Acceptance of this record does not certify migration, runtime evidence or deployment. The [read contract](../planning-item-read-contracts.md) distinguishes required guarantees from the current readers.

## Context

Planning Items support tasks with different scopes. A Board page needs selected cards, a selector needs discoverable eligible candidates, and Sprint completion needs its complete decision basis. Several current readers enumerate a broad collection before projecting the requested result. Other readers stop at provider caps. Both approaches can make unrelated data a prerequisite or make incomplete data appear sufficient.

## Decision and rationale

Evolve the existing Planning Item read boundary into one shared Deep Module under Parnas's Information-Hiding Criterion and Robert C. Martin's Dependency Rule. It owns common authoritative selection semantics, query execution, relationship resolution and hydration. Supabase remains authoritative. Database selection, semantic ordering and complete-basis set summaries precede page limits. The server hydrates selected content and required context, then assembles task-specific responses. Existing domain modules retain calculations such as Sprint assessment.

This division removes full application hydration as a prerequisite for a small read while keeping membership and exact totals under one authority. Displayed membership, supporting context and Item existence remain different facts. Complete machine outputs retain their own larger logical basis. Every access retains the authorization contract in [ADR 0002](0002-central-credential-verification.md). The separate GitHub workflow in [ADR 0001](0001-deep-task-github-projection.md) keeps ownership of projection, locking and external mutations.

## Alternatives

- Independent consumer readers permit local optimization but duplicate search, ownership and relationship decisions.
- A facade over complete server loading changes call sites without changing work proportional to the complete collection.
- A compact complete semantic projection reduces hydration but still transfers and evaluates the entire search scope for each small query.
- A persistent secondary read model adds storage, update propagation and failure handling across Items, relationships, profiles and temporal rules.
- A rule language generating SQL and TypeScript adds a translator and a second equivalence problem.

The approved choice uses shared database rules and observable comparisons with the former TypeScript evaluation, supplemented by independent expected results.

## Consequences

Database translation must prove search, filter, ownership, ordering, hierarchy and relationship parity on complete isolated fixtures. Bounded output does not establish bounded physical database work. Exact counts, sorting and fan-out may still scale with their relevant scope. There is no universal page size, new retention policy or measured latency claim in this decision.

Task-specific contracts preserve existing public formats. No persistent read copy, second client Planning-state owner or production comparison reads are introduced. [Decision #640](https://github.com/findmydoc-platform/founder-scoreboard-v2/issues/640#issuecomment-6834379249) governs inventory, exceptions and enforcement. A later contradictory choice must name the decision it supersedes.
