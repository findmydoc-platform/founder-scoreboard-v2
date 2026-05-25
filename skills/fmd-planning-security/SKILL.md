---
name: fmd-planning-security
description: Use when changing or reviewing Founder Scoreboard authentication, logout, Supabase sessions, API authorization guards, role mapping, provider tokens, RLS policies, SQL grants, or any code path that could expose planning data without a valid team session.
---

# FMD Planning Security

Canonical discoverable copy: `.agents/skills/fmd-planning-security/SKILL.md`.

## Goal

Keep Founder Scoreboard data private to mapped team users and make security-relevant gaps visible before they ship.

## Required workflow

1. Identify the trust boundary first: browser session, API route, Supabase service role, anon client, GitHub provider token, or RLS policy.
2. Fail closed when `REQUIRE_SUPABASE_AUTH=true`: do not render, serialize, cache, or fetch planning data until a valid Supabase session has been checked.
3. Treat logout as a security transition: revoke or clear the session, clear local protected state, close sensitive panels, and show a visible German status message.
4. Check every write API for `requireFounder`, `requireOperationalLead`, `requireCEO`, or an equally explicit role guard.
5. Never persist or log Supabase access tokens, refresh tokens, GitHub `provider_token`, or Authorization headers.
6. Add or update a focused contract test for any auth, role, guard, logout, RLS, grant, or data-loading change.

## Project checks

Run after meaningful security changes:

```bash
npm test
npm run lint
npm run build
```

Run when Supabase setup or auth mapping changes:

```bash
npm run verify:auth
npm run verify:supabase
```

## Red flags

- Server components returning Supabase data while strict auth is enabled but no request session has been verified.
- Client UI hiding data while the same data is still serialized into the initial page payload.
- API routes accepting missing bearer tokens because local development auth is disabled without a clear environment gate.
- Role checks using profile names, emails, or UI state instead of `profiles.platform_role`.
- Logout only changing button text while protected state remains in memory.
