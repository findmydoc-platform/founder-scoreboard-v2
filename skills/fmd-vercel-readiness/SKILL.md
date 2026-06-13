---
name: fmd-vercel-readiness
description: Prepare, verify, and inspect the findmydoc Founder Scoreboard deployment pipeline through GitHub Actions.
---

# FMD GitHub Actions Deployment Readiness

## Purpose

Keep the Founder Scoreboard deployment pipeline ready through GitHub Actions, without relying on Vercel Git auto-deploys or any local manual deploy flow. GitHub Actions owns deploy flow and observability for the `founder-ops` project.

## Core Rules

- Use GitHub Actions workflows for preview and production deploys.
- Use GitHub Environments named `preview` and `production`.
- Keep Vercel authentication secrets in the GitHub Environment, not repository-level secrets.
- Do not pre-validate deployment secrets in workflow scripts; let the workflow fail naturally.
- Do not add separate deploy helper scripts unless the workflow becomes materially more complex.
- Keep runtime app env in Vercel project environments and pull it with `vercel pull`.
- Deploy prebuilt output from a temporary GitHub Actions runner directory that contains `.vercel/output`, `.vercel/project.json`, package manifests, and installed `node_modules`, but no `.git` folder.
- Treat deleting the old Vercel project and moving domains as destructive production operations. Prepare commands and checks, but require explicit user confirmation before running them.
- Confirm the final cutover before modifying DNS or Vercel domains. The planned production domain is `founder-ops.findmydoc.eu`.
- Keep `REQUIRE_SUPABASE_AUTH=true` for production. Seed/local fallback is only for local development.
- Keep `GOOGLE_CHAT_DELIVERY_ENABLED=false` until the Google Chat rollout is explicitly enabled.
- Never instruct operators to use a local manual deploy flow; GitHub Actions owns the deployment flow and observability.
- Use GitHub Actions job logs and the deployment summary for deployment observability.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY`, Google Chat webhook URLs, Vercel tokens, or provider tokens in logs, docs, or client code.
- Do not move domains, change DNS, rename projects, or deploy production unless the user explicitly asks for that action.

## Pipeline Shape

1. Preview workflow:
   - File: `.github/workflows/deploy-preview.yml`
   - Trigger: internal pull requests to `main` and manual `workflow_dispatch`
   - Environment: `preview`
   - Pull env: `vercel pull --yes --environment=preview`
   - Build: GitHub Actions preview build step
   - Deploy: GitHub Actions prebuilt preview deployment step from a Git-metadata-free temporary directory
   - Environment URL: `steps.vercel_preview.outputs.deploymentUrl`
   - Deployment URL and inspection details are written by the shared deploy script.
   - Pull request jobs stay skipped when preview GitHub Environment secrets are not configured.

2. Production workflow:
   - File: `.github/workflows/deploy-production.yml`
   - Trigger: manual `workflow_dispatch`
   - Branch guard: `refs/heads/main`
   - Environment: `production`
   - Pull env: `vercel pull --yes --environment=production`
   - Build: GitHub Actions production build step
   - Deploy: GitHub Actions prebuilt production deployment step from a Git-metadata-free temporary directory
   - Environment URL: `steps.vercel_production.outputs.deploymentUrl`
   - Deployment URL and inspection details are written by the shared deploy script.

3. GitHub Actions build step:
   - `vercel.json` sets `installCommand` to `npm ci`.
   - `vercel.json` sets `buildCommand` to `npm run vercel:build`.
   - `npm run vercel:build` runs `npm run verify:deploy` before `npm run build`.

## Required GitHub Environment Secrets

Each GitHub Environment must provide:

```text
VERCEL_TOKEN=
VERCEL_ORG_ID=
VERCEL_PROJECT_ID=
```

## Runtime Environment Planning

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

The planned Google Chat app endpoint is `https://founderops.findmydoc.eu/api/google-chat/events`; keep it aligned with `docs/google-chat-rollout.md` before enabling delivery.

## Readiness Workflow

Run from the repository root:

```bash
npm test
npm run lint
npm run build
npm run verify:release
npm run verify:vercel-ready
npm run vercel:build
```

Run `npm run build` as its own command before `npm run verify:release` when diagnosing build failures. If `npm run verify:vercel-ready` reports a readiness failure, inspect the GitHub Actions run logs and the configured GitHub Environment secrets. There is no local project-link step in this deployment path.

## AI Guidance: Vercel Hobby Private Author Block

If Vercel blocks a GitHub Actions deployment because the commit author does not have access to the Vercel team, do not assume the token is wrong first. Check the workflow summary inspection fields: `readyStateReason`, `errorMessage`, and `seatBlock`.

For `TEAM_ACCESS_REQUIRED` or commit-author access messages, keep GitHub Actions as the only deploy path and verify that the shared deploy script stages `.vercel/output`, `.vercel/project.json`, package manifests, and installed `node_modules` under `$RUNNER_TEMP`, with no `.git` directory. Do not suggest local deployment, Git history rewriting, or metadata spoofing unless the artifact staging fix is already proven not to remove Vercel's Git attribution.

For production Supabase env validation, also run:

```bash
npm run verify:supabase
npm run verify:auth
```

## Post-Deploy Checks

- Open the deployment URL.
- Call `/api/health`.
- Check login with GitHub.
- Check task read/write as the CEO user.
- Check GitHub Actions job logs and the deployment summary for errors.

## References

- Read `docs/vercel-deployment.md` for the project-specific checklist and exact workflow behavior.
