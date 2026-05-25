---
name: fmd-vercel-readiness
description: Prepare, verify, deploy, inspect, and cut over the findmydoc Founder OPS / Founder Scoreboard project on Vercel using the Vercel CLI. Use when the user mentions Vercel readiness, CLI deploys, production env vars, Supabase Auth redirect URLs, project/domain migration, deleting the old Founder Scoreboard deployment, or assigning founder-ops.findmydoc.eu / founder-ops.findmydog.eu.
---

# FMD Vercel Readiness

## Purpose

Make this project production-ready for Vercel without relying on Git-push deployments. The expected deployment path is Vercel CLI from the `fmd-planning` project root.

## Core Rules

- Use Vercel CLI workflows, not Git integration, unless the user explicitly changes this decision.
- Treat deleting the old Vercel project and moving domains as destructive production operations. Prepare commands and checks, but require explicit user confirmation before running them.
- Confirm the exact domain spelling before modifying DNS or Vercel domains. The known candidates are `founder-ops.findmydoc.eu` and `founder-ops.findmydog.eu`.
- Keep `REQUIRE_SUPABASE_AUTH=true` for production. Seed/local fallback is only for local development.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY`, Google Chat webhook URLs, or Vercel tokens in logs, docs, or client code.
- Run `npm run verify:vercel-ready`, `npm run lint`, and `npm run build` before any deploy attempt.

## Readiness Workflow

1. Inspect the project root:
   - Work from `C:\Users\mehme\Documents\New project 2\fmd-planning`.
   - Verify `package.json` has `build`, `start`, `lint`, and `verify:vercel-ready`.
   - Verify `next.config.ts` has required external image domains.

2. Verify production env planning:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `REQUIRE_SUPABASE_AUTH=true`
   - `APP_URL=https://<production-domain>`
   - Optional: `GOOGLE_CHAT_WEBHOOK_URL`

3. Verify Supabase Auth:
   - GitHub provider enabled.
   - Production URL added to Supabase Auth Site URL / Redirect URLs.
   - Team profiles have `github_login` and valid `platform_role`.

4. Verify database readiness:
   - Run all Supabase migrations before production use.
   - `/api/health` must return `status: "ready"` after deployment.

5. Link and deploy with Vercel CLI:
   - Prefer explicit linking: `vercel link --yes --project founder-ops`
   - Pull env: `vercel pull --yes --environment=production`
   - Build with production env: `vercel build --prod`
   - Deploy prebuilt: `vercel deploy --prebuilt --prod`

6. Post-deploy checks:
   - Open the deployment URL.
   - Call `/api/health`.
   - Check login with GitHub.
   - Check task read/write as the CEO user.
   - Check Vercel logs for errors.

## Domain Cutover Workflow

Use only after the user confirms the exact domain.

1. List current projects and domains:
   - `vercel projects ls`
   - `vercel domains ls`
2. Identify old Founder Scoreboard project and new Founder OPS project.
3. Remove the old domain assignment only after confirming the old project name.
4. Add the chosen production domain to the new project.
5. Update `APP_URL` in Vercel Production env to the final domain.
6. Update Supabase Auth redirect URLs to include the final domain.
7. Redeploy or promote so generated URLs and auth redirects use the final domain.

## Deletion Safety

Never delete the old Vercel project in the same step as a new deployment. First deploy and verify Founder OPS, then move the domain, then wait for user confirmation before deleting the old project.

## References

- Read `docs/vercel-deployment.md` for the project-specific checklist and exact commands.
