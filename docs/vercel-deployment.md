# GitHub Actions Deployment Workflow

This project deploys only through GitHub Actions workflows. Operators do not run a local manual deploy flow. GitHub Actions owns the deployment workflow directly.

## Target

- GitHub repository: `findmydoc-platform/founder-scoreboard-v2`
- Vercel project: `founder-ops`
- Root directory: `.`
- Current production URL: `https://founder-ops.findmydoc.eu`
- Google Chat app URL: `https://founder-ops.findmydoc.eu/api/google-chat/events`
- GitHub Environments: `preview` and `production`
- Do not assign or move a domain before the user explicitly confirms the final cutover.

## GitHub Environment Secrets

Configure these secrets on GitHub Environments, not as repository-level secrets. Production deployment requires them on `production`; the existing preview workflow requires the same set on `preview` if preview deployments are enabled.

```text
VERCEL_TOKEN=
VERCEL_ORG_ID=
VERCEL_PROJECT_ID=
```

Production also requires this GitHub Environment secret for the schema deploy step:

```text
SUPABASE_DB_HOST=
SUPABASE_DB_USER=
SUPABASE_DB_PASSWORD=
```

Use the Supabase shared session pooler on port `5432`: `SUPABASE_DB_HOST` is the pooler host and `SUPABASE_DB_USER` is the pooler user shown under **Connect > Session pooler** in Supabase. GitHub Actions cannot reach the IPv6-only direct database host. These database values are not Vercel runtime environment variables. Keep them only in the GitHub `production` Environment and in local `.env.local` for operator repair work.

The workflows intentionally do not pre-validate these secrets. If a required secret is missing, the workflow step fails naturally.

## Runtime Environment

Runtime app environment variables stay in the Vercel project environment and are pulled by the workflow with `vercel pull`.

Set these in Vercel Production:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
REQUIRE_SUPABASE_AUTH=true
APP_URL=https://founder-ops.findmydoc.eu
GITHUB_SYNC_OWNER=findmydoc-platform
GITHUB_SYNC_REPO=management
GITHUB_APP_ID=
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_PRIVATE_KEY=
GITHUB_APP_INSTALLATION_ID=
GITHUB_TOKEN_ENCRYPTION_KEY=
GOOGLE_CHAT_WEBHOOK_URL=
GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL=
GOOGLE_CHAT_PRIVATE_KEY=
GOOGLE_CHAT_DELIVERY_ENABLED=false
FOUNDEROPS_DELIVERY_SECRET=
```

For operational in-app delivery, set `GOOGLE_CHAT_WEBHOOK_URL` to the incoming webhook of the renamed `FounderOps` Google Chat space and set `GOOGLE_CHAT_DELIVERY_ENABLED=true` only after a controlled test. Personal FounderOps DMs need `GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_CHAT_PRIVATE_KEY`, and `profiles.google_chat_dm_space` values in Supabase, and stay out of the release channel.

The GitHub Actions release channel uses `.github/workflows/send-release-google-chat.yml`. It accepts `message_payload_json`, reads the `GOOGLE_CHAT_WEBHOOK_URL` repository secret, and posts release details or deployment summaries only.

For Phase 4, private FounderOps DMs use the Google Chat API and are limited to personal action items. Missing or invalid `profiles.google_chat_dm_space` values are logged as failed `direct_dm` deliveries and are not redirected into the group webhook.

For Phase 5, use the Settings delivery cockpit after every secret change or deployment. Check readiness, send `testDelivery=webhook_digest`, send `testDelivery=direct_dm` to one profile with a valid `spaces/...`, and use `eventIds` retry only for failed pending events. Rollback remains `GOOGLE_CHAT_DELIVERY_ENABLED=false`.

Operational delivery endpoints still accept `FOUNDEROPS_DELIVERY_SECRET`, but the GitHub Actions release workflow must not call `/api/notifications/generate-digest` or `/api/notifications/deliver`.

Operational event messages stay inside the application. The Google Chat release channel stays separate and may only carry release details or deployment summaries.

Do not configure a shared `GITHUB_SYNC_TOKEN` for production. GitHub issue sync, dependency sync, GitHub comment import, private asset proxying, and issue archival use the configured GitHub App installation token. User-authored comments use the original author's encrypted GitHub App user token; attachments use the uploader's token. Both are stored server-side in Supabase with refresh rotation. Raw GitHub tokens must never be sent to the browser, logged, or returned from API responses.

## GitHub Actions Workflow Shape

Workflow: `.github/workflows/deploy-preview.yml`

Preview deploys run for internal pull requests targeting `main` and for manual `workflow_dispatch` runs.

The preview workflow remains in the repository, but preview is not part of the first `founder-ops` rollout unless the `preview` GitHub Environment and Vercel Preview runtime variables are configured separately.
If those preview secrets are missing, the pull request job stays skipped instead of failing the branch.

GitHub Actions executes the preview flow in this order:

- Pull preview runtime variables with `vercel pull --yes --environment=preview`.
- Build the preview Vercel output from the GitHub Actions preview job.
- Copy tracked project files with `git archive HEAD`, then add the prebuilt output, project metadata, Next.js build metadata, package manifests, and installed `node_modules` into a temporary runner directory that contains no `.git` folder.
- Deploy the prebuilt preview output from that Git-metadata-free runner directory.
- Publish the deployment URL to the workflow summary and the `preview` environment URL.

Workflow: `.github/workflows/deploy-production.yml`

Production deploys start automatically on every push to `main`, which includes merges into `main`. Manual `workflow_dispatch` remains available. A guard job rejects any run that is not on `refs/heads/main` before the protected `production` environment is requested.

GitHub Actions executes the production flow in this order:

- Pull production runtime variables with `vercel pull --yes --environment=production`.
- Build the production Vercel output from the GitHub Actions production job.
- Refuse the cutover while an active GitHub issue sync lock exists, then apply `0057_rename_github_issue_sync_fields.sql` and `0058_task_comment_github_delivery_outbox.sql`.
- Deploy the current Supabase baseline schema with `pnpm run deploy:supabase-schema`, guarded by `SCHEMA_DEPLOY_TARGET=production`.
- Verify the production Supabase schema, auth mapping, GitHub sync contract, and planning hierarchy.
- Copy tracked project files with `git archive HEAD`, then add the prebuilt output, project metadata, Next.js build metadata, package manifests, and installed `node_modules` into a temporary runner directory that contains no `.git` folder.
- Deploy the prebuilt production output from that Git-metadata-free runner directory.
- Reconcile the existing comment outbox idempotently through the protected canonical production endpoint. Do not call the Vercel deployment URL because deployment protection redirects that URL to Vercel SSO.
- If schema verification or the Vercel switch fails before a new production deployment is active, restore the previous issue-sync column names automatically.
- Publish the deployment URL to the workflow summary and the `production` environment URL.

`pnpm run vercel:build` runs `pnpm run verify:deploy` before `pnpm run build`.

The baseline production schema deploy applies `supabase/schema.sql` only. The explicit GitHub sync cutover step immediately before it applies exactly migrations `0057` and `0058`; it never runs `supabase/*.sql` as a glob because historical migration files include duplicate numbering and legacy cleanup scripts that are not safe as a repeated automatic deploy set.

Configure all three production database secrets from the values shown under **Connect > Session pooler** in Supabase. To update the password from local `.env.local` without printing it, run from the repository root:

```bash
node --input-type=module -e 'import { readFile } from "node:fs/promises"; import { parseEnvLine } from "./scripts/lib/env.mjs"; const rows = (await readFile(".env.local", "utf8")).split(/\r?\n/).map(parseEnvLine).filter(Boolean); const pair = rows.find(([key]) => key === "SUPABASE_DB_PASSWORD"); if (!pair?.[1]) process.exit(1); process.stdout.write(pair[1]);' | gh secret set SUPABASE_DB_PASSWORD --env production --repo findmydoc-platform/founder-scoreboard-v2
```

## Vercel Hobby Private Repository Author Block

For private repositories on the Vercel Hobby plan, Vercel can block deployments when it attributes the deployment to a Git commit author who does not have access to the Vercel team. If this happens, do not rotate `VERCEL_TOKEN`, do not rewrite Git history, and do not introduce a local deploy workaround. The pipeline must keep using GitHub Actions and deploy from the temporary prebuilt artifact directory that intentionally excludes Git metadata.

AI agents handling this repository must inspect the GitHub Actions summary and the deployment inspection fields (`readyStateReason`, `errorMessage`, and `seatBlock`) before proposing changes. A `TEAM_ACCESS_REQUIRED` or commit-author access message is an artifact-staging problem unless the temporary directory is already proven to be Git-metadata-free.

## Observability

Use GitHub Actions job logs and the deployment summary to inspect deployment status. The workflow output URL is the operational source of truth for the deployed environment.

## Supabase Auth

Before production login works, configure Supabase Auth:

- Enable GitHub provider.
- Add the production app URL as Site URL.
- Add the production app URL and `/auth/callback` as allowed redirect URLs.
- Keep the GitHub OAuth App owned by `findmydoc-platform`, not a personal account.
- The GitHub OAuth App callback remains the Supabase callback URL, for example `https://<supabase-project-ref>.supabase.co/auth/v1/callback`.
- Ensure every team profile has `github_login`.
- Ensure `profiles.platform_role` is one of `ceo`, `founder`, `deputy`, or `viewer`.
- Keep the runtime aligned with `docs/auth-flow.md`: Supabase session cookies are SSR-managed, planning data is loaded only after server-side role authorization, and GitHub API credentials come from the GitHub App layer, not browser-provided provider tokens.

## GitHub App Runtime

Before production GitHub features work, configure the GitHub App owned by `findmydoc-platform`:

- Install the app on `findmydoc-platform/management`.
- Set `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_INSTALLATION_ID`, and either `GITHUB_APP_PRIVATE_KEY` or `GITHUB_APP_PRIVATE_KEY_PATH`.
- Set `GITHUB_TOKEN_ENCRYPTION_KEY` to a base64 value that decodes to exactly 32 bytes.
- Configure the GitHub App user authorization callback URL as `https://founder-ops.findmydoc.eu/api/github-app/callback`.
- Keep the webhook secret reserved for the later inbound webhook phase; the current runtime does not require `GITHUB_APP_WEBHOOK_SECRET`.
- Run the additive Supabase migration that creates `github_app_user_tokens` before enabling the connect button for users.

## Planning Trash Maintenance

`.github/workflows/purge-planning-trash.yml` is the bounded production maintenance path for expired planning trash. It is scheduled for `03:15 UTC`, waits 45 seconds before the first network request, checks `/api/health`, and calls exactly one batch of at most 25 roots through `/api/maintenance/planning-trash/purge`. Network failures retry with bounded backoff; a second concurrent run is not cancelled into the first one.

The endpoint accepts only `x-founderops-maintenance-secret` backed by `FOUNDEROPS_MAINTENANCE_SECRET`. It has no user-session, bearer-token, or Supabase-anon fallback. The database operation requires the explicit service-role client and remains fail-closed while any matching GitHub lifecycle job is missing or incomplete.

Publishing the workflow does not activate physical cleanup. Before enabling it, separately approve and complete all of the following:

- apply `0065_planning_trash_purge.sql` after the planning trash lifecycle migration;
- configure the same `FOUNDEROPS_MAINTENANCE_SECRET` in the GitHub `production` environment and the production Vercel runtime;
- run the rollback-based purge verification against the target Supabase project;
- explicitly approve the first manual production run.

The maintenance job never deletes GitHub Issues. It retains FounderOps audit records and notification delivery history.

## Verification

Run from the repository root:

```bash
pnpm test
pnpm run lint
pnpm run build
pnpm run verify:release
pnpm run verify:vercel-ready
pnpm run vercel:build
```

Run `pnpm run build` as its own command before `pnpm run verify:release` when diagnosing build failures, so Next.js compile errors are separated from release gate failures. The release gate also runs `pnpm audit --audit-level=moderate`.

If `pnpm run verify:vercel-ready` reports a readiness failure, inspect the GitHub Actions run logs, the workflow summary, and the configured GitHub Environment secrets. There is no local project-link step in this deployment path.

If production Supabase env is present locally, also run:

```bash
pnpm run verify:supabase
pnpm run verify:auth
```

## Post-Deploy Checks

Check after a successful deployment:

- Deployment URL opens.
- `/api/health` returns `200` and `status: "ready"` for base Supabase readiness.
- `pnpm run verify:supabase`, `pnpm run verify:auth`, and `pnpm run verify:operational` pass when production Supabase env is available locally.
- GitHub login works.
- Reload with a valid session shows either the app or a loading shell, not the login gate.
- GitHub App status stays connected after reload and the central header action reconnects when the encrypted user token is missing, revoked, expired beyond refresh, or mapped to a different GitHub login.
- CEO user can edit tasks.
- Founder user cannot edit CEO-only metadata.
- GitHub avatar images load.
- GitHub Actions job logs show no production errors.

Useful commands are not part of the operator flow anymore; use the GitHub Actions run and summary instead.
