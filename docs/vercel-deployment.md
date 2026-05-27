# Vercel Deployment

This project is intended to be deployed through the Vercel CLI from the `fmd-planning` directory. Do not rely on Git-push auto-deploy for the current Hobby setup.

## Target

- Project name: `founder-ops`
- Root directory: `fmd-planning`
- Production domain: confirm exact spelling before assigning
  - likely: `founder-ops.findmydoc.eu`
  - user also mentioned: `founder-ops.findmydog.eu`

## Required Production Environment

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

## Supabase Auth

Before production login works, configure Supabase Auth:

- Enable GitHub provider.
- Add the production app URL as Site URL.
- Add the production app URL as an allowed redirect URL.
- Ensure every team profile has `github_login`.
- Ensure `profiles.platform_role` is one of `ceo`, `founder`, `deputy`, or `viewer`.

## Local Readiness

Run from `fmd-planning`:

```bash
npm run build
npm run verify:release
```

`npm run verify:release` is the bundled local gate for non-build checks. It runs contract tests, lint, Vercel readiness, Google Chat rollout readiness, and `npm audit --audit-level=moderate`. Run `npm run build` as its own command before deployment, because `next build` starts worker processes on Windows and is more reliable as a standalone npm script. `verify:release` also does not run `verify:operational`, because that check needs a reachable local or deployed app.

If production Supabase env is present locally, also run:

```bash
npm run verify:supabase
npm run verify:auth
```

`npm run verify:vercel-ready` reports `localProjectLinked: false` until `.vercel/project.json` exists. That is expected before the first CLI link and means the next manual step is still `vercel login` followed by `vercel link --yes --project founder-ops`.

## CLI Deploy

Use the Vercel CLI from this directory:

```bash
vercel login
vercel link --yes --project founder-ops
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
```

If the project belongs to a team, include the explicit scope:

```bash
vercel link --yes --project founder-ops --scope <team-or-user-scope>
vercel pull --yes --environment=production --scope <team-or-user-scope>
vercel build --prod
vercel deploy --prebuilt --prod --scope <team-or-user-scope>
```

## Post-Deploy

Check:

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

## Domain Cutover

Do this only after the new deployment is verified.

1. Confirm exact domain spelling.
2. Confirm old Vercel project name.
3. Remove the old project domain assignment.
4. Add the domain to `founder-ops`.
5. Set `APP_URL` to the final domain.
6. Add the final domain to Supabase Auth redirect URLs.
7. Redeploy with `vercel deploy --prebuilt --prod`.

Do not delete the old Founder Scoreboard project until the new domain, login, health check, and core write flows are verified.
