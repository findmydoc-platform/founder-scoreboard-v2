# GitHub API Idempotency

FounderOps treats GitHub mutations as resource-specific reconciliation, not as blindly retryable HTTP calls. The shared transport classifies requests and exposes retry metadata; each resource adapter owns the domain identity and recovery behavior.

## Operation contracts

| Operation | Required identity | Retry behavior |
| --- | --- | --- |
| Read | Repository and resource reference | One bounded automatic retry is allowed for transient failures. |
| Create once | Durable FounderOps marker or caller-supplied operation ID | Search for the marker before creation. After an ambiguous response, search again before another mutation. |
| Desired-state update | Validated repository, resource, and desired state | Reapplying the same state is allowed. After an ambiguous response, read the resource and compare first. |
| Ensure relationship | Validated endpoints and desired relationship | List or query the current relationship, then add or remove only the difference. |
| Ensure absent | Validated repository and resource identity | Delete once. A resource-specific `404` may mean success; authentication and target errors must still fail. |
| Webhook projection | GitHub delivery ID | Deduplicate `X-GitHub-Delivery`, persist the event, and project it without triggering a blind write-back loop. |

## Transport boundary

- `src/lib/github-http.ts` is the only transport for `api.github.com`.
- Resource adapters build endpoints, validate domain ownership, and decide whether an observed state satisfies the request.
- OAuth exchanges with `github.com/login/oauth` remain separate because they are not GitHub API resource calls.
- Read operations, including GraphQL queries sent through `POST`, may retry once when the server permits a short wait.
- Mutations never retry automatically. `GitHubApiError` carries the request ID, retry delay, and rate-limit metadata so an outbox or caller can reconcile and schedule later.

## Relationship reconciliation

Sub-issue synchronization follows `observe → compare → apply → reconcile`:

1. Resolve the parent and child issues and validate both global node IDs while reading the child's current parent.
2. Treat the desired parent as already applied when repository and issue number match.
3. Otherwise call `addSubIssue` once with `issueId`, `subIssueId`, and the intentional `replaceParent` setting.
4. After an ambiguous response, start the next sync with the same observation instead of retrying the mutation automatically.

Once the child issue has been resolved, do not rebuild `subIssueUrl` as mutation input. Use the validated child node ID already returned by GitHub.

## Mutation checklist

Before adding a mutation, answer all of the following in code and tests:

1. What stable repository and resource identity is validated?
2. Is the contract create-once, desired-state, ensure-relationship, or ensure-absent?
3. How does the next attempt detect that a lost response was actually successful?
4. Which exact status can mean already complete, and which statuses must still fail?
5. Does the caller keep the same operation key for the whole retry window?
6. Are mutations serialized and are rate-limit details preserved?
7. Do tests cover replay, ambiguous success, existing or missing state, wrong target, and missing permission?

## Examples

- Issue creation uses `<!-- founderops-task-id:... -->`; a retry searches the repository and updates the marker-owned issue instead of creating another one.
- Comment delivery uses `<!-- fmd-comment-id:... -->`; the outbox reconciles the marker before posting.
- Sub-issue synchronization resolves both node IDs and queries the child's current parent before `addSubIssue`.
- Dependency synchronization lists the managed set, adds missing relationships, and removes only stale managed relationships.
- Attachment uploads require a durable operation ID and deterministic GitHub path; this contract is implemented separately from the transport foundation.
