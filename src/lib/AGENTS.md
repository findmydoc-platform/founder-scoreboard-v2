# Library and Server Boundary Rules

- Authorize server actions through `authorizeCredentialAction` from `@/lib/credentials`. Keep shared role policy and credential lifecycle inside `credentials/internal/`; feature modules retain domain rules and response mapping.
- Browser paths use the public browser session adapter. Server callers receive fixed action-bound capabilities, never SDK clients, tokens, generic query callbacks or caller-selected verification modes. Keep SDK acquisition and raw credential transports private to `credentials/internal/`.
- Keep GitHub App installation tokens separate from encrypted user tokens, and never return either token class to the browser.
- Prefer pure named functions for mapping, validation, sorting, policy, and error classification so they can be tested directly.
- Keep React rendering components out of `src/lib`. Domain-specific helpers may depend on the owning feature model only when that boundary is already intentional.
- Preserve exported types, route-facing result shapes, and database field mappings unless all consumers and tests change together.
- Add direct tests for changed policies and run `verify:auth` when the affected identity boundary requires it. GitHub changes require focused behavior tests for the affected projection or sync path.

## GitHub API Mutation Rules

- Send GitHub resource operations through `github-http.ts` with an authorized installation or user capability. Raw HTTP and credentials belong to the private credential transport; OAuth token exchange remains its separate protocol.
- Classify every non-GET request as `read` or `mutation`. A GraphQL query sent with `POST` is a read; GraphQL and REST writes are mutations.
- Give every mutation one explicit idempotency contract: desired-state reconciliation, a durable domain marker or operation ID for create-once behavior, or a resource-specific ensure-absent flow.
- Implement mutation workflows as observe, compare, apply, and reconcile. Never blindly retry a mutation after a timeout, network error, or 5xx response; observe GitHub first because the prior attempt may have succeeded.
- Treat `404` as success only inside an ensure-absent operation after repository and resource identity have been validated. Never suppress `401`, `403`, or unrelated `404` responses.
- Do not use timestamps, server-generated random paths, or GraphQL `clientMutationId` as deduplication. A retry key must be durable across the caller's retry window.
- Execute mutating GitHub calls serially. Do not introduce mutating `Promise.all` batches; preserve retry and rate-limit metadata for the owning route, outbox, or workflow.
- Add executable tests for repeated calls, a lost success response, already-present or already-absent state, wrong targets, and permission failures. Prose instructions are not a substitute for behavior tests.
- Follow `docs/github-api-idempotency.md` when adding or changing a GitHub mutation.
- `github-graphql.ts` is the only adapter for the GitHub GraphQL envelope, GraphQL errors, and missing data. Resource modules provide queries, variables, operation classification, and domain interpretation.
- Task-to-GitHub orchestration belongs behind `projectTaskToGitHub` in `github-sync/task-projection.ts`; routes and unrelated library modules must not reconstruct its projection order.
