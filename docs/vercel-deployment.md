# GitHub Actions Deployment Workflow

This project deploys only through GitHub Actions workflows. Operators do not run a local manual deploy flow. GitHub Actions drives the Vercel CLI directly.

## Target

- GitHub repository: `findmydoc-platform/founder-scoreboard-v2`
- Vercel project: `founder-ops`
- Root directory: `.`
- Current production URL: `https://founder-ops.findmydoc.eu`
- GitHub Environments: `preview` and `production`

## GitHub Environment Secrets

Configure these secrets on GitHub Environments, not as repository-level secrets. Production deployment requires them on `production`; the existing preview workflow requires the same set on `preview` if preview deployments are enabled.

```text
VERCEL_TOKEN=
VERCEL_ORG_ID=
VERCEL_PROJECT_ID=
```

The workflows intentionally do not pre-validate these secrets. If a required secret is missing, the Vercel CLI step fails naturally.

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
GOOGLE_CHAT_DELIVERY_ENABLED=false
```

`GOOGLE_CHAT_WEBHOOK_URL` is optional until Google Chat notifications should go live. Keep `GOOGLE_CHAT_DELIVERY_ENABLED=false` until the rollout in `docs/google-chat-rollout.md` is completed and tested.

Operational event messages stay inside the application. If a Google Chat release channel is used later, it must stay separate and may only carry release details or deployment summaries.

Do not configure a shared `GITHUB_SYNC_TOKEN` for production. GitHub issue sync, comments, and attachments must use the logged-in user's GitHub OAuth provider token from the active Supabase session, so GitHub shows the real actor.

## GitHub Actions Workflow Shape

Workflow: `.github/workflows/deploy-preview.yml`

Preview deploys run for internal pull requests targeting `main` and for manual `workflow_dispatch` runs.

The preview workflow remains in the repository, but preview is not part of the first `founder-ops` rollout unless the `preview` GitHub Environment and Vercel Preview runtime variables are configured separately.

GitHub Actions executes the preview flow in this order:

- Pull preview runtime variables with `vercel pull --yes --environment=preview`.
- Build the preview deployment with `vercel deploy --target preview`.
- Publish the deployment URL to the workflow summary and the `preview` environment URL.

Workflow: `.github/workflows/deploy-production.yml`

Production deploys are manual only through `workflow_dispatch`. A guard job rejects any run that is not on `refs/heads/main` before the protected `production` environment is requested.

GitHub Actions executes the production flow in this order:

- Pull production runtime variables with `vercel pull --yes --environment=production`.
- Build the Vercel output with `vercel build --prod`.
- Deploy the prebuilt output with `vercel deploy --prebuilt --prod`.
- Publish the deployment URL to the workflow summary and the `production` environment URL.

`npm run vercel:build` runs `npm run verify:deploy` before `npm run build`.

## Observability

Use GitHub Actions job logs and the deployment summary to inspect deployment status. The workflow output URL is the operational source of truth for the deployed environment.

## Supabase Auth

Before production login works, configure Supabase Auth:

- Enable GitHub provider.
- Add the production app URL as Site URL.
- Add the production app URL as an allowed redirect URL.
- Keep the GitHub OAuth App owned by `findmydoc-platform`, not a personal account.
- The GitHub OAuth App callback remains the Supabase callback URL, for example `https://<supabase-project-ref>.supabase.co/auth/v1/callback`.
- Ensure every team profile has `github_login`.
- Ensure `profiles.platform_role` is one of `ceo`, `founder`, `deputy`, or `viewer`.

## Local Readiness

Run from the repository root:

```bash
npm test
npm run lint
npm run build
npm run verify:vercel-ready
npm run vercel:build
```

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
- CEO user can edit tasks.
- Founder user cannot edit CEO-only metadata.
- GitHub avatar images load.
- GitHub Actions job logs show no production errors.

Useful commands are not part of the operator flow anymore; use the GitHub Actions run and summary instead.
