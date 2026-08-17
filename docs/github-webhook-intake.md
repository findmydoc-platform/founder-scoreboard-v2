# GitHub Webhook Write Contract

FounderOps remains the source of truth and desired state for planning. GitHub is an authorized editing surface for existing projected Issues, not an independent planning database. A signed webhook is therefore a request to run the same FounderOps domain command as the person who caused the GitHub change. The GitHub App is only the actuator that projects the resulting FounderOps state back to GitHub.

The production endpoint is `POST /api/github/webhooks`. It accepts GitHub JSON webhook requests up to 2 MiB and handles Issue, Issue comment, sub-issue, dependency, and Projects v2 item events.

## Processing model

The endpoint performs these steps in order:

1. Verify `X-Hub-Signature-256` against the exact raw request bytes before parsing JSON.
2. Validate `X-GitHub-Delivery`, `X-GitHub-Event`, the configured GitHub App installation or organization identity, repository allowlists, and stable resource identities.
3. Persist content-free trigger metadata and the raw payload hash in a service-only journal. A delivery ID is unique; a replay with a different event or payload hash is a conflict.
4. Schedule the matching processor immediately in the same webhook execution after the durable response has been created. This is not a later manual synchronization step.
5. Reload current GitHub state with the GitHub App installation token and prove that its resource timestamp and action result still match the journaled event. A missing or newer resource can trigger corrective projection but cannot borrow the older sender's authority.
6. Resolve exactly one existing FounderOps item and the human actor by stable numeric GitHub user ID.
7. Run the normal FounderOps domain command with that actor's current role, ownership, review, parent, and completion permissions.
8. Enqueue and dispatch the FounderOps desired-state projection immediately, whether the inbound command was accepted or denied.

The HTTP response confirms durable receipt, not completion of the post-response processor. Failed processing is retained and retried automatically; it never requires a person to start a separate sync.

The journals never retain Issue title, body, labels, milestone, comment body, authorization headers, signatures, or the full payload. They retain only stable identities, bounded action metadata, timestamps, and `payload_sha256`. Both journal tables are inaccessible to `public`, `anon`, and `authenticated`; only narrow service-role grants and security-definer RPCs can claim and finalize work.

## Identity and authorization

- The webhook `sender.id` must map to exactly one active FounderOps profile through `github_app_user_tokens.github_user_id`. The mutable login is display-only and never authorizes a change.
- A GitHub App or bot sender is an idempotent no-op. App projections cannot authorize themselves through their own webhook.
- An unmapped person, ambiguous item mapping, unsupported value, or denied FounderOps command cannot mutate FounderOps.
- Missing or ambiguous Issue mappings never create a FounderOps item. This contract applies only to Issues already projected by FounderOps.
- A denied or invalid managed change is immediately overwritten with FounderOps desired state through the GitHub App identity.

## Ownership matrix

| GitHub surface | Accepted inbound intent | FounderOps behavior |
| --- | --- | --- |
| Issue title | Exact `[Deliverable]` or `[Sub-Issue]` managed title | Update through the normal item command when authorized; otherwise restore the FounderOps title. |
| Issue body | Exact FounderOps sections plus the matching `founderops-task-id` marker | Update only represented planning fields. Free text, unknown sections, missing markers, and lossy shapes are restored. |
| Assignee | Assign one GitHub user with a stable FounderOps mapping | Update owner when authorized. Unassigning or assigning an unmapped user is restored because FounderOps requires a desired owner. |
| Issue state | `closed` or `reopened` | Map to `Erledigt` or the explicit `Erledigt -> Offen` reopen command when the person is authorized. |
| Priority labels | Add `p0-urgent`, `p1-high`, `p2-medium`, or `p3-low` | Update Deliverable priority. Removing a managed priority label is restored from FounderOps. |
| `blocked` label | Add the label | Move to `Blockiert` when authorized. Removing it is restored from FounderOps desired state. |
| `review:ready` label | Add the label to an actionable Deliverable | Request review through the review command. Invalid or removed review labels are restored. |
| Projection-only labels | `task`, `deliverable`, `sub-issue`, `changes-requested` | Never mutate FounderOps; mismatches are restored. |
| Milestone | Add or remove | GitHub-owned and preserved. No FounderOps command or corrective writeback is produced. |
| Native sub-issue relationship | Add a mapped Sub-Issue below a mapped Deliverable | Reparent through the normal FounderOps command when authorized. FounderOps requires every Sub-Issue to have a parent, so removal is restored. |
| Native dependency | Add or remove a mapped blocked-by relationship | Run the normal relationship command when authorized; otherwise restore both Issues. |
| Issue comment | Create, edit, or delete | Refresh only the external-comment projection. Comments never mutate planning state and stay allowed during Review and after completion. Pull-request comments are ignored. |
| Project membership | Create, delete, archive, restore, or convert | FounderOps owns membership. Missing or archived managed items are projected back; reorder events are ignored. |

All documented `sub_issues` actions (`parent_issue_added`, `parent_issue_removed`, `sub_issue_added`, and `sub_issue_removed`) and `issue_dependencies` actions (`blocked_by_added`, `blocked_by_removed`, `blocking_added`, and `blocking_removed`) are allowlisted explicitly. Future action names are ignored until the contract is extended deliberately.

Issue actions are likewise limited to `edited`, `assigned`, `unassigned`, `closed`, `reopened`, `labeled`, `unlabeled`, `milestoned`, `demilestoned`, `field_added`, and `field_removed`. Relationship processing reloads both Issue versions plus the child's current parent or blocked-by set before it runs a FounderOps command, so delayed add/remove deliveries cannot authorize a later relationship state.

## Managed Issue fields

GitHub sends organization Issue-field changes as `issues.field_added` and `issues.field_removed`. The journal retains only the bounded field name. The processor reloads the current Issue-field value through GraphQL before applying policy, so webhook payload values never become desired state or stored content.

| Issue field | FounderOps field and validation |
| --- | --- |
| Priority | `Urgent -> P0`, `High -> P1`, `Medium -> P2`. GitHub `Low` is ambiguous between FounderOps P3 and P4 and is restored. |
| Start date | Deliverable start date. |
| Target date | Deliverable deadline. |

Other Issue fields are GitHub-owned and ignored. Removing a managed Issue field is treated as an explicit empty value and is accepted only where the normal FounderOps command permits it; otherwise the desired value is restored.

## Managed Project fields

`projects_v2_item` is accepted only for the configured stable organization and configured FounderOps Project. The current item and field value are reloaded through GraphQL.

| Project field | FounderOps field and validation |
| --- | --- |
| Status | `Todo -> Offen`, `In Progress -> In Arbeit`, `Review -> review request`, `Changes Requested -> Nacharbeit`, `Blocked -> Blockiert`, `Done -> Erledigt`. |
| Sprint | Exact existing sprint match by title and start date; ambiguous or missing matches are restored. |
| Workstream | Deliverable workstream. |
| Estimate hours | Finite whole-hour estimate from 0 through 200. |
| Evidence URL | A single `http` or `https` evidence link. A GitHub edit cannot collapse multiple FounderOps evidence links. |
| Priority | `Urgent -> P0`, `High -> P1`, `Medium -> P2`. GitHub `Low` is ambiguous between FounderOps P3 and P4 and is restored. |
| Start date | Deliverable start date. |
| Target date | Deliverable deadline. |

Other Project fields and reorder events are GitHub-owned and ignored. A managed value that cannot be represented without guessing is restored from FounderOps.

## Review and completion locks

Review and completion are domain locks, not UI conventions:

- During Review, after final review, and while an item is `Erledigt`, title, body, owner, planning fields, relationships, parent, and attachments are protected in the browser, APIs, RPCs, and webhook processor.
- A locked or completed parent also protects its Sub-Issues from parent or relationship changes.
- Comments remain available throughout Review and after completion.
- The only completed-item exception is an explicit, authorized `Erledigt -> Offen` transition. The person must reopen first and may edit only after that command succeeds.
- Any GitHub change that crosses these boundaries is denied by the normal FounderOps command and corrected immediately in GitHub.

## Delivery states and recovery

Response behavior:

| Condition | Response |
| --- | --- |
| Signed `ping` | `200` |
| New verified delivery persisted | `202` |
| Exact replay already persisted | `200` |
| Signed event or action outside the active contract | `204` |
| Invalid signature, headers, payload, installation, organization, or repository | `4xx` |
| Missing runtime configuration or unavailable storage | `503` |

Processors use leases and finalize each delivery as `processed`, `ignored`, `retry_scheduled`, or `failed`. Generic processing errors use bounded exponential delay and become terminal after five attempts. Corrective projections have their own five-attempt outbox lifecycle; the delivery remains retryable while its projection is pending and becomes terminal with it. The scheduled `process-github-webhooks.yml` workflow runs every 15 minutes, drains both queues, reclaims ready or stale work in batches of at most 25, and fails visibly when terminal failures remain.

GitHub itself does not automatically redeliver failed HTTP deliveries. Inspect the GitHub App's **Advanced -> Recent deliveries** for transport failures and use **Redeliver** only after the endpoint is healthy. Internal post-receipt failures are recovered from the journal by the maintenance workflow.

## Activation checklist

1. Merge through the protected production workflow so the additive migration and application deploy together.
2. Set `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_WEBHOOK_ORGANIZATION_ID`, and `FOUNDEROPS_MAINTENANCE_SECRET` in Vercel Production. A Vercel environment change requires a new protected deployment.
3. Set the production GitHub environment secrets `APP_URL` and the same `FOUNDEROPS_MAINTENANCE_SECRET` for the scheduled retry workflow.
4. Configure the GitHub App webhook URL as `https://founder-ops.findmydoc.eu/api/github/webhooks`, use `application/json`, keep SSL verification enabled, use the same high-entropy webhook secret, and subscribe to `issues`, `issue_comment`, `sub_issues`, and `issue_dependencies`.
5. Configure a separate organization webhook at the same URL with `application/json`, SSL verification, and the same secret. Subscribe that organization webhook only to `projects_v2_item`; GitHub exposes this event to organization webhooks, not GitHub App webhooks.
6. Grant the GitHub App the existing least-privilege Issue and organization Project access needed for read/write projection calls.
7. Keep the App installation restricted to the approved repositories and add a platform firewall or rate-limit rule for `/api/github/webhooks`.
8. Verify a signed `ping`, an authorized structured Issue edit, a locked or unauthorized edit that is corrected, comment create/edit/delete, one managed Project field, one sub-issue change, and one dependency change. Confirm both journal completion and the final FounderOps/GitHub state.
9. Run the maintenance workflow manually once and confirm zero outstanding or terminal deliveries before relying on the scheduled path.

Preview must not receive the production webhook secret. Preview testing requires a separate GitHub App or webhook configuration, endpoint, organization identity, and secret.
