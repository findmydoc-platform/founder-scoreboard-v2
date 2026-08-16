# GitHub Issue and Comment Webhook Intake

FounderOps remains the source of truth for planning fields. The inbound endpoint is a transport and audit boundary: it verifies and durably journals GitHub Issue and Issue comment deliveries. It does not mutate planning items. Verified Issue comment deliveries then trigger a separate processor that refreshes only the existing external-comment projection from GitHub.

## Active receipt contract

`POST /api/github/webhooks` runs in the Node.js runtime and accepts GitHub's JSON webhook format up to 2 MiB.

The endpoint performs these steps in order:

1. Require the server-only webhook secret, expected GitHub App installation ID, and Supabase service-role client.
2. Verify `X-Hub-Signature-256` against the exact raw request bytes before parsing JSON.
3. Validate `X-GitHub-Delivery`, `X-GitHub-Event`, the installation ID, the repository allowlist, and the Issue identity. Issue comment deliveries additionally require a stable comment identity and timestamp.
4. Insert normalized trigger metadata and a hash of the verified raw payload into `github_webhook_deliveries` before returning success.
5. Deduplicate retries by `X-GitHub-Delivery`; the same delivery ID with a different event or payload hash is a conflict.
6. After the response, claim verified Issue comment deliveries and reconcile the current GitHub comment into `task_external_comments` when the repository and Issue map to exactly one FounderOps task.

The journal deliberately does not copy Issue titles, bodies, labels, milestones, comment bodies, or the full webhook payload. The comment processor reloads the current comment with a GitHub App installation token, so out-of-order deliveries reconcile desired state instead of replaying stale webhook content. The journal timestamp and durable delete event provide the version boundary for an atomic comment-projection RPC; older snapshots cannot overwrite a newer edit or recreate a deleted comment. The table is inaccessible to `public`, `anon`, and `authenticated`; the server-side `service_role` receives `SELECT` and `INSERT` plus execute access to the narrow claim, mapping, projection, and finalize RPCs, but no direct `UPDATE` grant. Signatures and authorization headers are never stored.

Response behavior:

| Condition | Response |
| --- | --- |
| Signed `ping` | `200` |
| New verified Issue or Issue comment delivery persisted | `202` |
| Exact replay already persisted | `200` |
| Signed event outside the active scope | `204` |
| Invalid signature, headers, payload, installation, or repository | `4xx` |
| Missing runtime configuration or unavailable storage | `503` |

`200` or `202` confirms durable receipt, not successful post-response projection. Projection state is tracked separately on the journal row.

## Event priority

| Priority | GitHub event | Current behavior | Why |
| --- | --- | --- | --- |
| P0 | `ping` | Acknowledge, do not persist | Verifies webhook configuration without creating domain data. |
| P0 | `issues` | Verify and persist every action name and stable identity | One event covers the main Issue lifecycle without storing content or introducing premature field mapping. |
| P0 | `issue_comment` | Verify and persist `created`, `edited`, and `deleted`, then reconcile the current comment into the external discussion | Automates native GitHub comment display without retaining webhook content or creating write-back loops. Pull-request conversation comments are ignored. |
| P1 | `sub_issues` | Ignore for now | Needed when GitHub owns the native parent-child hierarchy. Enable together with a relationship processor. |
| P1 | `issue_dependencies` | Ignore for now | Needed when native blocked-by relationships become authoritative. Enable together with a relationship processor. |

Every `issues` action is currently receipt-only. This includes:

- lifecycle actions such as `opened`, `edited`, `closed`, `reopened`, `deleted`, and `transferred`;
- assignment actions such as `assigned` and `unassigned`;
- `milestoned`, `demilestoned`, `labeled`, and `unlabeled`.

None of these actions currently changes FounderOps. Labels and milestones are not approved processor scope; they require a separate field-ownership decision before any inbound mapping. All other Issue actions remain journaled under the same receipt-only rule.

The journal stores the stable comment ID, node ID, and observed `updated_at` timestamp, but never the comment body. The processor claims each delivery with a lease, reloads the comment by stable ID, validates that it still belongs to the verified repository and Issue, and then:

- resolves modern and supported legacy Issue references through the same compatibility contract, then upserts current comments into `task_external_comments` for the uniquely mapped task;
- removes the external projection only for a verified `deleted` event; a `404` while processing `created` or `edited` remains retryable because GitHub can also hide an existing private resource when access is missing;
- serializes projection changes per stable comment ID and ignores stale snapshots; a delete wins when two events carry the same GitHub `updated_at` version;
- ignores comments carrying a valid FounderOps marker for a local comment on the same task, preventing outbound comments from appearing twice;
- ignores unmapped Issues and fails closed on ambiguous task mappings;
- finalizes the journal row as `processed`, `ignored`, `retry_scheduled`, or `failed` with bounded attempts.

The processor never writes inbound content to `task_comments`, planning fields, or GitHub. GitHub emits `issue_comment` for both Issues and pull requests; deliveries whose Issue object contains `pull_request` are acknowledged without persistence.

Separate milestone-definition, project, pull-request, release, and workflow events are outside this Issue-only intake. Issue milestone attachment and removal already arrive through `issues`.

## Future GitHub-first processing

The comment projection is the first narrow processor using the reusable receipt boundary. Making Issue fields authoritative still belongs in separate processors and an approved source-of-truth plan; the public endpoint does not become a planning-domain writer.

The processor must:

1. Claim journal rows idempotently using the stored processing state.
2. Reload the current Issue with a GitHub App installation token instead of trusting event order or treating the webhook payload as current state.
3. Resolve resources by stable repository ID, Issue ID, and Issue node ID; use the Issue number only as a repository-local display identity.
4. Apply an explicit field-ownership matrix. GitHub-owned fields may be projected inbound, while FounderOps-only fields such as approval, scoring, and internal founder metadata stay protected.
5. Preserve outbound operation markers or equivalent origin metadata so FounderOps projections do not bounce back as blind write loops.
6. Mark the journal row `processed`, `ignored`, or retryable/failed with a processor version and bounded attempts.

The database grant intentionally excludes direct `UPDATE`. Comment processing uses service-role-only security-definer RPCs that expose only claim, compatibility mapping, atomic external-comment projection, and finalize transitions.

GitHub can deliver events out of order. The journal therefore separates quick HTTP receipt from reconciliation and gives operators a durable trigger identity without treating a stored payload as current state.

## Failed-delivery recovery

GitHub does not automatically redeliver failed webhook deliveries. The initial comment processor runs after the receipt response and records retryable or terminal failures, but no periodic retry worker exists yet. The operator must:

1. Check the GitHub App's **Advanced → Recent deliveries** after every production deployment and at least daily while the webhook is active.
2. Investigate every non-2xx delivery. Resolve configuration or storage failures before redelivery; treat `409` as a delivery-identity incident rather than retrying blindly.
3. Use GitHub's **Redeliver** action after the endpoint is healthy. Exact redelivery reuses the stored identity and can reclaim retryable, failed, or stale-processing rows without duplicating comments.

Before GitHub becomes authoritative, add automated failed-delivery monitoring through the GitHub App delivery API and a periodic full Issue reconciliation. Webhook receipt alone is not a correctness guarantee.

## Activation checklist

1. Before merging when possible, set a high-entropy `GITHUB_APP_WEBHOOK_SECRET` in Vercel Production only. If the merge already happened, set it and rerun the protected production workflow on `main`; Vercel environment changes require a new deployment.
2. Let the protected workflow apply the additive Supabase migration and deploy the application successfully.
3. Add a platform firewall or rate-limit rule for `/api/github/webhooks` before enabling public delivery.
4. Configure `https://founder-ops.findmydoc.eu/api/github/webhooks`, the same secret, JSON content type, and SSL verification in the GitHub App.
5. Grant only the GitHub App repository permissions needed to read Issues, subscribe only to Issues and Issue comment events for this phase, and keep the installation restricted to approved repositories.
6. Confirm the automatic `ping`, one controlled Issue edit, and controlled Issue comment create/edit/delete actions. Verify both journal completion and the matching external discussion state before relying on the processor operationally.

Preview must not receive the production webhook secret. A preview webhook requires a separate GitHub App, endpoint, and secret.
