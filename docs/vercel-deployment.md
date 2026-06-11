# Vercel Deployment Pipeline

This project deploys through lean GitHub Actions workflows using the Vercel CLI directly. The repository does not rely on Vercel Git auto-deploys, helper deploy scripts, domain moves, DNS changes, or project renames.

## Target

- GitHub repository: `findmydoc-platform/founder-scoreboard-v2`
- Vercel project: `founder-ops`
- Root directory: `.`
- Current production URL: `https://founder-ops.findmydoc.eu`
- Planned Google Chat app URL: `https://founderops.findmydoc.eu/api/google-chat/events`
- GitHub Environments: `preview` and `production`

## GitHub Environment Secrets

Configure these secrets on GitHub Environments, not as repository-level secrets. Production deployment requires them on `production`; the existing preview workflow requires the same set on `preview` if preview deployments are enabled.

```text
VERCEL_TOKEN=
VERCEL_ORG_ID=
VERCEL_PROJECT_ID=
```

The workflows intentionally do not pre-validate these secrets. If a required secret is missing, the Vercel CLI step fails naturally.

## Vercel Runtime Environment

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
```

`GOOGLE_CHAT_WEBHOOK_URL` is optional as a Space-Digest fallback. Personal FounderOps DMs need `GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_CHAT_PRIVATE_KEY`, and `profiles.google_chat_dm_space` values in Supabase. Keep `GOOGLE_CHAT_DELIVERY_ENABLED=false` until the rollout in `docs/google-chat-rollout.md` is completed and tested.

Do not configure a shared `GITHUB_SYNC_TOKEN` for production. GitHub issue sync, comments, and attachments must use the logged-in user's GitHub OAuth provider token from the active Supabase session, so GitHub shows the real actor.

## Vercel Build

Vercel uses `vercel.json` from the repository root:

```json
{
  "framework": "nextjs",
  "installCommand": "npm ci",
  "buildCommand": "npm run vercel:build"
}
```

`npm run vercel:build` runs `npm run verify:deploy` before `npm run build`. `verify:deploy` runs tests, Vercel readiness, Google Chat readiness, and lint.

## Preview Pipeline

Workflow: `.github/workflows/deploy-preview.yml`

Preview deploys run for internal pull requests targeting `main` and for manual `workflow_dispatch` runs.

The preview workflow remains in the repository, but preview is not part of the first `founder-ops` rollout unless the `preview` GitHub Environment and Vercel Preview runtime variables are configured separately.

Core commands:

```bash
vercel pull --yes --environment=preview
vercel deploy --target preview
```

Fork pull requests are skipped so environment secrets are not exposed. The workflow parses the deployment URL from the Vercel CLI output, writes it to `deploymentUrl`, and uses it as the GitHub Environment URL for `preview`.

## Production Pipeline

Workflow: `.github/workflows/deploy-production.yml`

Production deploys are manual only through `workflow_dispatch`. A guard job rejects any run that is not on `refs/heads/main` before the protected `production` environment is requested.

Core commands:

```bash
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
```

The workflow parses the deployment URL from the Vercel CLI output, writes it to `deploymentUrl`, and uses it as the GitHub Environment URL for `production`.

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
npm run verify:release
npm run verify:vercel-ready
npm run vercel:build
```

Run `npm run build` as its own command before `npm run verify:release` when diagnosing build failures, so Next.js compile errors are separated from release gate failures. The release gate also runs `npm audit --audit-level=moderate`.

If `npm run verify:vercel-ready` reports `localProjectLinked: false`, link the local checkout to the Vercel project:

```bash
vercel link --yes --project founder-ops
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
- Vercel logs show no production errors.

Useful commands:

```bash
vercel inspect <deployment-url>
vercel logs <deployment-url> --since 1h --level error
```
