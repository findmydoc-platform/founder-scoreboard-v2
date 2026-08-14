# GitHub Issue Webhook Intake

FounderOps remains the source of truth. The inbound endpoint introduced here is a transport and audit boundary: it verifies and durably journals GitHub Issue deliveries, but it does not mutate planning items or call the GitHub API.

## Active receipt contract

`POST /api/github/webhooks` runs in the Node.js runtime and accepts GitHub's JSON webhook format up to 2 MiB.

The endpoint performs these steps in order:

1. Require the server-only webhook secret, expected GitHub App installation ID, and Supabase service-role client.
2. Verify `X-Hub-Signature-256` against the exact raw request bytes before parsing JSON.
3. Validate `X-GitHub-Delivery`, `X-GitHub-Event`, the installation ID, the repository allowlist, and the Issue identity.
4. Insert normalized trigger metadata and a hash of the verified raw payload into `github_webhook_deliveries` before returning success.
5. Deduplicate retries by `X-GitHub-Delivery`; the same delivery ID with a different event or payload hash is a conflict.

The journal deliberately does not copy Issue titles, bodies, labels, milestones, or the full webhook payload. The future processor must reload the current Issue from GitHub. The table is inaccessible to `public`, `anon`, and `authenticated`; the server-side `service_role` receives only `SELECT` and `INSERT`. Signatures and authorization headers are never stored.

Response behavior:

| Condition | Response |
| --- | --- |
| Signed `ping` | `200` |
| New verified Issue delivery persisted | `202` |
| Exact replay already persisted | `200` |
| Signed event outside the active scope | `204` |
| Invalid signature, headers, payload, installation, or repository | `4xx` |
| Missing runtime configuration or unavailable storage | `503` |

## Event priority

| Priority | GitHub event | Current behavior | Why |
| --- | --- | --- | --- |
| P0 | `ping` | Acknowledge, do not persist | Verifies webhook configuration without creating domain data. |
| P0 | `issues` | Verify and persist every action name and stable identity | One event covers the main Issue lifecycle without storing content or introducing premature field mapping. |
| P1 | `sub_issues` | Ignore for now | Needed when GitHub owns the native parent-child hierarchy. Enable together with a relationship processor. |
| P1 | `issue_dependencies` | Ignore for now | Needed when native blocked-by relationships become authoritative. Enable together with a relationship processor. |
| P2 | `issue_comment` | Ignore for now | Requires an explicit author, visibility, content-retention, and write-back-loop policy before ingestion. |

Every `issues` action is currently receipt-only. This includes:

- lifecycle actions such as `opened`, `edited`, `closed`, `reopened`, `deleted`, and `transferred`;
- assignment actions such as `assigned` and `unassigned`;
- `milestoned`, `demilestoned`, `labeled`, and `unlabeled`.

None of these actions currently changes FounderOps. Labels and milestones are not approved processor scope; they require a separate field-ownership decision before any inbound mapping. All other Issue actions remain journaled under the same receipt-only rule.

Separate milestone-definition, project, pull-request, release, and workflow events are outside this Issue-only intake. Issue milestone attachment and removal already arrive through `issues`.

## Future GitHub-first processing

The receipt boundary is reusable if GitHub later becomes authoritative. That change belongs in a separate processor and an approved source-of-truth plan; the public endpoint does not need to become a domain writer.

The processor must:

1. Claim journal rows idempotently using the stored processing state.
2. Reload the current Issue with a GitHub App installation token instead of trusting event order or treating the webhook payload as current state.
3. Resolve resources by stable repository ID, Issue ID, and Issue node ID; use the Issue number only as a repository-local display identity.
4. Apply an explicit field-ownership matrix. GitHub-owned fields may be projected inbound, while FounderOps-only fields such as approval, scoring, and internal founder metadata stay protected.
5. Preserve outbound operation markers or equivalent origin metadata so FounderOps projections do not bounce back as blind write loops.
6. Mark the journal row `processed`, `ignored`, or retryable/failed with a processor version and bounded attempts.

The current database grant intentionally excludes `UPDATE`. Enabling a processor requires a separate migration that grants only the update path needed for claiming and finalizing rows.

GitHub can deliver events out of order. The journal therefore separates quick HTTP receipt from reconciliation and gives operators a durable trigger identity without treating a stored payload as current state.

## Failed-delivery recovery

GitHub does not automatically redeliver failed webhook deliveries. During the receipt-only phase, the operator must:

1. Check the GitHub App's **Advanced → Recent deliveries** after every production deployment and at least daily while the webhook is active.
2. Investigate every non-2xx delivery. Resolve configuration or storage failures before redelivery; treat `409` as a delivery-identity incident rather than retrying blindly.
3. Use GitHub's **Redeliver** action after the endpoint is healthy and confirm that exactly one matching `delivery_id` exists in `github_webhook_deliveries`.

Before GitHub becomes authoritative, add automated failed-delivery monitoring through the GitHub App delivery API and a periodic full Issue reconciliation. Webhook receipt alone is not a correctness guarantee.

## Activation checklist

1. Before merging when possible, set a high-entropy `GITHUB_APP_WEBHOOK_SECRET` in Vercel Production only. If the merge already happened, set it and rerun the protected production workflow on `main`; Vercel environment changes require a new deployment.
2. Let the protected workflow apply the additive Supabase migration and deploy the application successfully.
3. Add a platform firewall or rate-limit rule for `/api/github/webhooks` before enabling public delivery.
4. Configure `https://founder-ops.findmydoc.eu/api/github/webhooks`, the same secret, JSON content type, and SSL verification in the GitHub App.
5. Grant only the GitHub App repository permissions needed to read Issues, subscribe only to Issue events for this phase, and keep the installation restricted to approved repositories.
6. Confirm the automatic `ping`, one controlled Issue edit, and an exact redelivery in the journal before relying on the intake operationally.

Preview must not receive the production webhook secret. A preview webhook requires a separate GitHub App, endpoint, and secret.
