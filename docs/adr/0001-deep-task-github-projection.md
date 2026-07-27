# Use a deep Task GitHub projection module

FounderOps keeps Supabase authoritative and GitHub as a one-way projection. The task sync route is an HTTP and authorization adapter only; `projectTaskToGitHub` owns the complete projection workflow behind one typed interface. Hard projections run before warning-only reads and field updates, and the endpoint returns one flat discriminated response union so every client classifies the same outcome consistently.

## Considered Options

- Keep orchestration in the route: rejected because HTTP concerns, locking, projection order, and recovery were inseparable and tests depended on source positions.
- Keep separate shallow Issue, Project, and Dependency calls in the route: rejected because callers had to know intermediate identifiers, ordering, and failure policy.
- Preserve compatibility exports: rejected because they would keep the old seams available and allow architectural drift.
- Preserve the previous Project-before-Dependency order: rejected because a warning-only field projection must not precede the hard relationship projection.
- Keep the previous loosely typed response: rejected because create, detail, single-sync, and bulk-sync clients had already developed separate status and code rules.

## Consequences

New projection behavior must enter through `projectTaskToGitHub`, GraphQL envelopes must enter through `githubGraphql`, and tests exercise projection interfaces rather than implementation order. Issue and relationship mutations remain serial and reconcile observed GitHub state before applying a difference.
