# GitHub Projection Rules

- Keep HTTP parsing, Next.js response construction, session authorization, and token acquisition outside this module.
- Run hard projections before warning-only projections. Issue, Dependency or native Sub-Issue parent, and Project membership are hard. Project fields, linked Pull Request reads, and Comment delivery are warning-only or best effort.
- A stale compare-and-set result is retryable and must not be persisted as a failed projection. Other hard failures must persist `failed`, and failure-persistence errors must remain explicit.
- Validate creation intent and all local GitHub references before acquiring the resource lock. Treat lock release as a typed cleanup outcome; never discard a returned or thrown release error.
- Dependency projection must reconcile both `blocked_by` and `blocking` directions for the current Issue and retain trashed tasks with GitHub references in the managed identity set.
- Test behavior through the owning projection interface. Do not test source positions, private helpers, or compatibility exports.
