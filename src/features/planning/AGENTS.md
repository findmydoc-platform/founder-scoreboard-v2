# Planning read coordination

- Before changing Planning entry, reads, refresh, caching or result acceptance, read `docs/planning-item-read-contracts.md` and update the affected consumer entry and evidence.
- Keep common coordination in the existing Planning-state owner. Reuse requires sufficient compatible coverage and valid original authority. Do not add a second owner or a complete-read fallback.
- Follow the contract's exact search, refresh, revision-check and interaction obligations. Keep invalidation, scheduling, cancellation and acceptance distinct.
