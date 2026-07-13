---
name: fmd-supabase-migrations
description: Use when creating, reviewing, applying, squashing, or verifying Founder Scoreboard Supabase migrations, RLS policies, grants, indexes, storage configuration, or migration-ledger repairs. Prefer additive timestamp migrations and ask before destructive database changes.
---

# FMD Supabase Migrations

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

## Workflow

1. Inspect `supabase/migrations/`, `scripts/verify-*.mjs`, API routes, and data access code before writing SQL.
2. Run `pnpm run db:migration:new -- <clear_name>` so the pinned CLI creates the timestamp filename.
3. Edit only the generated file. Never add SQL directly under `supabase/`, recreate `supabase/schema.sql`, or reuse an existing timestamp.
4. Keep additive migrations idempotent where practical with `if not exists`, `on conflict`, and guarded `do $$` blocks.
5. Add or update the narrowest verification script or contract test. Contract tests must read the ordered migration corpus through `scripts/lib/supabase-migrations.mjs`.
6. Run `pnpm run verify:migrations`, then `pnpm run db:reset` against the disposable local stack.
7. Run the relevant runtime verification command: usually `pnpm run verify:supabase`, plus `pnpm run verify:auth` for auth/RLS/grants.
8. Let the production workflow run `pnpm run deploy:supabase-migrations`. It validates the production baseline ledger, refuses active GitHub sync locks, performs a dry run, and then pushes pending migrations with the pinned CLI.

## Baseline and future squashes

- `20260713120959_production_baseline.sql` is an immutable dump of the deployed production schema. Its SHA-256 is enforced by `verify:migrations`.
- Never replay the baseline into an existing production database. The production deploy fails closed unless that version is already marked as applied in `supabase_migrations.schema_migrations`.
- Before a future squash, create private roles, schema, data, and ledger backups; restore-test them; dump the current deployed schema; create a new CLI baseline; validate a fresh local reset; and repair the remote ledger only after explicit approval.
- Keep the previous backup for the agreed retention window. Remove superseded migrations and obsolete pipeline paths only in the same reviewed cutover change.
- Database rollback is forward-only by default: add a corrective migration. Restoring a backup or repairing migration history is an explicit incident action, not an automatic pipeline step.

## Output

Report whether SQL was applied locally, deployed through the production workflow, or only prepared. If it was not applied, state the exact blocker and the exact command to run.
