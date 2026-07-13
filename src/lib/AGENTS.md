# Library and Server Boundary Rules

- Keep authorization policy centralized in `authz.ts`, platform policy helpers, and existing API context helpers. Do not duplicate role matrices in unrelated helpers.
- Client paths may call only `getBrowserSupabase`; server paths use the existing server helpers. Never pass service-role credentials or clients across the boundary, and put new secret-only helpers in server-only modules.
- Keep GitHub App installation tokens separate from encrypted user tokens, and never return either token class to the browser.
- Prefer pure named functions for mapping, validation, sorting, policy, and error classification so they can be tested directly.
- Keep React rendering components out of `src/lib`. Domain-specific helpers may depend on the owning feature model only when that boundary is already intentional.
- Preserve exported types, route-facing result shapes, and database field mappings unless all consumers and tests change together.
- Add direct tests for changed policies and run `verify:auth`, `verify:supabase`, or `verify:github-sync` when the affected boundary requires it.
