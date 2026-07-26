---
name: supabase-migrations
description: Use only when creating, reviewing, applying, squashing, or verifying this repository's Supabase migrations, Authorization Parity, RLS policies, grants, indexes, storage configuration, or migration-ledger repairs. Prefer additive timestamp migrations and ask before destructive database changes.
---

# Supabase Migrations

## Default authority

Codex may create and apply additive Supabase SQL to the local stack when the task requires it. Production migrations run through `.github/workflows/deploy-production.yml`; do not bypass that path unless the user explicitly requests an incident repair. Do not ask the user to paste SQL manually unless credentials are missing, network access is blocked, or the user specifically wants manual execution.

## Allowed without extra confirmation

- `create table if not exists`
- `alter table add column if not exists`
- indexes, constraints, triggers, functions, views, grants, policies, comments, and bounded configuration upserts
- data backfills that preserve existing rows and can be reasoned about from current schema
- timestamp migrations created by the pinned Supabase CLI under `supabase/migrations/`
- local resets and migration verification against the disposable local Supabase stack

## Requires explicit user confirmation

- `drop table`, `drop schema`, `truncate`, broad `delete`, destructive `update`, or removing columns
- disabling RLS on protected tables
- rotating, exposing, or deleting credentials
- changing production source of truth semantics

## Authorization Parity

Follow the root `AGENTS.md` principle. Before broadening access, identify the real caller, app guard, database path, role or ownership boundary, and mutable fields. If there is no matching app action or the evidence is unclear, do not add user access.

## Workflow

1. Inspect `supabase/migrations/`, `scripts/verify-*.mjs`, API routes, authorization helpers, browser clients, server clients, and data access code before writing SQL.
2. For RLS, grants, or RPC execution, state the matching app action and identify both allowed and forbidden direct Data API calls.
3. Run `pnpm run db:migration:new <clear_name>` so the pinned CLI creates the timestamp filename. Do not pass a standalone `--`; Supabase CLI 2.109 treats it as the end of arguments and reports a missing migration name.
4. Edit only the generated file. Never add SQL directly under `supabase/`, recreate `supabase/schema.sql`, or reuse an existing timestamp.
5. Keep additive migrations idempotent where practical with `if not exists`, `on conflict`, and guarded `do $$` blocks.
6. Add or update the narrowest verification script or contract test. Contract tests must read the ordered migration corpus through `scripts/lib/supabase-migrations.mjs`.
7. For RLS or grants, update `scripts/lib/database-security.mjs` so production fails closed on broad or missing policies. Add local integration coverage with a mapped session, an unmapped session, every affected app role, and forbidden direct writes. Use same-value writes or disposable local rows when proving denial.
8. Run `pnpm run verify:migrations`, then `pnpm run db:reset` against the disposable local stack.
9. Run `pnpm run verify:database-security -- --local`, `pnpm run verify:supabase`, `pnpm run verify:auth`, and `pnpm run test:integration:local` for auth/RLS/grants. Also run Supabase database lint and security advisors; classify known service-only `RLS Enabled No Policy` results explicitly.
10. Let the production workflow run `pnpm run deploy:supabase-migrations`. It validates the production baseline ledger, refuses active GitHub sync locks, performs a dry run, pushes pending migrations with the pinned CLI, then verifies database security, schema, Auth mappings, and the deployed app.

## Baseline and future squashes

- `20260713120959_production_baseline.sql` is an immutable dump of the deployed production schema. Its SHA-256 is enforced by `verify:migrations`.
- Never replay the baseline into an existing production database. The production deploy fails closed unless that version is already marked as applied in `supabase_migrations.schema_migrations`.
- Before a future squash, create private roles, schema, data, and ledger backups; restore-test them; dump the current deployed schema; create a new CLI baseline; validate a fresh local reset; and repair the remote ledger only after explicit approval.
- Keep the previous backup for the agreed retention window. Remove superseded migrations and obsolete pipeline paths only in the same reviewed cutover change.
- Database rollback is forward-only by default: add a corrective migration. Restoring a backup or repairing migration history is an explicit incident action, not an automatic pipeline step.

## Output

Report whether SQL was applied locally, deployed through the production workflow, or only prepared. If it was not applied, state the exact blocker and the exact command to run.
