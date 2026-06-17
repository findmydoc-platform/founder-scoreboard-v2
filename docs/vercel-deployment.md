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
GOOGLE_CHAT_WEBHOOK_URL=
GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL=
GOOGLE_CHAT_PRIVATE_KEY=
GOOGLE_CHAT_DELIVERY_ENABLED=false
FOUNDEROPS_DELIVERY_SECRET=
```

For Phase 1, set `GOOGLE_CHAT_WEBHOOK_URL` to the incoming webhook of the renamed `FounderOps` Google Chat space and set `GOOGLE_CHAT_DELIVERY_ENABLED=true` only after a controlled test. Personal FounderOps DMs need `GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_CHAT_PRIVATE_KEY`, and `profiles.google_chat_dm_space` values in Supabase, and stay out of Phase 1.

For Phase 2, Sebastian's external pipeline calls `POST https://founder-ops.findmydoc.eu/api/notifications/deliver` on weekdays at `09:00 Europe/Berlin` with header `x-founderops-delivery-secret: <FOUNDEROPS_DELIVERY_SECRET>` and body `{ "limit": 20 }`.

For Phase 4, private FounderOps DMs use the Google Chat API and are limited to personal action items. Missing or invalid `profiles.google_chat_dm_space` values are logged as failed `direct_dm` deliveries and are not redirected into the group webhook.

For Phase 5, use the Settings delivery cockpit after every secret change or deployment. Check readiness, send `testDelivery=webhook_digest`, send `testDelivery=direct_dm` to one profile with a valid `spaces/...`, and use `eventIds` retry only for failed pending events. Rollback remains `GOOGLE_CHAT_DELIVERY_ENABLED=false`.

The repository also contains `.github/workflows/google-chat-digest.yml` for this job. It runs against the `production` GitHub Environment and requires `FOUNDEROPS_DELIVERY_SECRET` there. Vercel Production must use the same `FOUNDEROPS_DELIVERY_SECRET` plus `GOOGLE_CHAT_WEBHOOK_URL` and `GOOGLE_CHAT_DELIVERY_ENABLED=true`.

Operational event messages stay inside the application. If a Google Chat release channel is used later, it must stay separate and may only carry release details or deployment summaries.

Do not configure a shared `GITHUB_SYNC_TOKEN` for production. GitHub issue sync, comments, and attachments must use the logged-in user's GitHub OAuth provider token from the active Supabase session, so GitHub shows the real actor.

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

Production deploys are manual only through `workflow_dispatch`. A guard job rejects any run that is not on `refs/heads/main` before the protected `production` environment is requested.

GitHub Actions executes the production flow in this order:

- Pull production runtime variables with `vercel pull --yes --environment=production`.
- Build the production Vercel output from the GitHub Actions production job.
- Copy tracked project files with `git archive HEAD`, then add the prebuilt output, project metadata, Next.js build metadata, package manifests, and installed `node_modules` into a temporary runner directory that contains no `.git` folder.
- Deploy the prebuilt production output from that Git-metadata-free runner directory.
- Publish the deployment URL to the workflow summary and the `production` environment URL.

`npm run vercel:build` runs `npm run verify:deploy` before `npm run build`.

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
- Keep the runtime aligned with `docs/auth-flow.md`: Supabase session cookies are SSR-managed, planning data is loaded only after server-side role authorization, and GitHub provider tokens are not persisted.

## Verification

Run from the repository root:

```bash
npm test
npm run lint
npm run build
npm run verify:release
npm run verify:vercel-ready
npm run vercel:build
```

Run `npm run build` as its own command before `npm run verify:release` when diagnosing build failures, so Next.js compile errors are separated from release gate failures. The release gate also runs `npm audit --audit-level=moderate`.

If `npm run verify:vercel-ready` reports a readiness failure, inspect the GitHub Actions run logs, the workflow summary, and the configured GitHub Environment secrets. There is no local project-link step in this deployment path.

If production Supabase env is present locally, also run:

```bash
npm run verify:supabase
npm run verify:auth
```

## Post-Deploy Checks

Check after a successful deployment:

- Deployment URL opens.
- `/api/health` returns `200` and `status: "ready"`.
- GitHub login works.
- Reload with a valid session shows either the app or a loading shell, not the login gate.
- GitHub reconnect is available from the central header/notification area when a provider token is missing.
- CEO user can edit tasks.
- Founder user cannot edit CEO-only metadata.
- GitHub avatar images load.
- GitHub Actions job logs show no production errors.

Useful commands are not part of the operator flow anymore; use the GitHub Actions run and summary instead.
