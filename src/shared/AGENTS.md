# Shared UI Rules

- Do not add new domain-specific behavior or copy to `src/shared`. Move legacy domain labels to caller props when touching them; new task, sprint, review, or planning semantics belong in an owning feature.
- Do not import from `src/features` or `@/features`.
- Keep shared component APIs small, typed, and backward-compatible unless all call sites change in the same patch.
- Keep business rules, API calls, mutations, auth decisions, and domain-specific derived state out of shared primitives.
- Centralize branded choice and date behavior in the existing custom controls instead of adding one-off variants.
- Interactive primitives require keyboard, focus, and ARIA coverage in focused tests.
