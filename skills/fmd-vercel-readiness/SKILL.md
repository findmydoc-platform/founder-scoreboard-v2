---
name: fmd-vercel-readiness
description: Prepare, verify, and inspect the findmydoc Founder Scoreboard deployment pipeline through GitHub Actions and Vercel CLI.
---

# FMD Vercel Readiness

## Purpose

Keep the Founder Scoreboard deployment pipeline ready through GitHub Actions, without relying on Vercel Git auto-deploys or any local manual deploy flow. GitHub Actions runs Vercel CLI commands directly for the `founder-ops` project.

## Core Rules

- Use GitHub Actions workflows for preview and production deploys.
- Use GitHub Environments named `preview` and `production`.
- Keep Vercel authentication secrets in the GitHub Environment, not repository-level secrets.
- Do not pre-validate Vercel secrets in workflow scripts; let the Vercel CLI fail naturally.
- Do not add separate deploy helper scripts unless the workflow becomes materially more complex.
- Keep runtime app env in Vercel project environments and pull it with `vercel pull`.
- Keep `REQUIRE_SUPABASE_AUTH=true` for production. Seed/local fallback is only for local development.
- Keep `GOOGLE_CHAT_DELIVERY_ENABLED=false` until the Google Chat rollout is explicitly enabled.
- Never instruct operators to use a local manual deploy flow; GitHub Actions owns the deployment flow and observability.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY`, Google Chat webhook URLs, Vercel tokens, or provider tokens in logs, docs, or client code.
- Do not move domains, change DNS, rename projects, or deploy production unless the user explicitly asks for that action.

## Pipeline Shape

1. Preview workflow:
   - File: `.github/workflows/deploy-preview.yml`
   - Trigger: internal pull requests to `main` and manual `workflow_dispatch`
   - Environment: `preview`
   - Pull env: `vercel pull --yes --environment=preview`
   - Deploy: `vercel deploy --target preview`
   - Environment URL: `steps.vercel_preview.outputs.deploymentUrl`
   - Deployment URL is parsed inline from Vercel CLI output.

2. Production workflow:
   - File: `.github/workflows/deploy-production.yml`
   - Trigger: manual `workflow_dispatch`
   - Branch guard: `refs/heads/main`
   - Environment: `production`
   - Pull env: `vercel pull --yes --environment=production`
   - Build: `vercel build --prod`
   - Deploy: `vercel deploy --prebuilt --prod`
   - Environment URL: `steps.vercel_production.outputs.deploymentUrl`
   - Deployment URL is parsed inline from Vercel CLI output.

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

## Readiness Workflow

Run from the repository root:

```bash
npm test
npm run lint
npm run build
npm run verify:vercel-ready
npm run vercel:build
```

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
