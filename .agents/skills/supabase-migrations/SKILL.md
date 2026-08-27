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

Before broadening access, identify the real caller, app guard, database path, role or ownership boundary, and mutable fields. Treat exposed tables, grants, policies, functions, triggers, and views as one access-control boundary, and enable RLS on exposed tables. If there is no matching app action or the evidence is unclear, do not add user access.

## Workflow

1. Inspect `supabase/migrations/`, `tests/migrations/`, the affected API routes, authorization helpers, browser clients, server clients, and data access code before writing SQL.
2. For RLS, grants, or RPC execution, state the matching app action and identify both allowed and forbidden direct Data API calls.
3. Run `pnpm run db:migration:new <clear_name>` so the pinned CLI creates the timestamp filename. Do not pass a standalone `--`; Supabase CLI 2.109 treats it as the end of arguments and reports a missing migration name.
4. Edit only the generated file. Never add SQL directly under `supabase/`, recreate `supabase/schema.sql`, or reuse an existing timestamp.
5. Keep additive migrations idempotent where practical with `if not exists`, `on conflict`, and guarded `do $$` blocks.
6. Add `tests/migrations/<migration-name>.test.mjs`. Reset the real local database to the previous migration version, insert representative existing rows, apply the target migration, and assert the intended schema or permission change through PostgreSQL behavior.
7. Prove that primary keys, relevant values, and row counts survive unless the migration deliberately transforms them. For RLS, grants, or Auth changes, cover allowed and denied access with mapped and unmapped sessions and every affected app role. Do not inspect SQL source text or export production internals only for tests.
8. For RLS or grants, update `scripts/lib/database-security.mjs` when the production guard must fail closed on broad or missing policies.
9. Run `pnpm run verify:migrations`, start the disposable local stack, run `pnpm run test:migrations`, and finish with a fresh `pnpm run db:reset`.
10. Run `pnpm run verify:database-security -- --local` and `pnpm run verify:auth` for auth, RLS, grants, or identity mapping. Also run Supabase database lint and classify known service-only `RLS Enabled No Policy` results explicitly.
11. Let the production workflow run `pnpm run deploy:supabase-migrations`. It validates the current baseline ledger, refuses active GitHub sync locks, performs a dry run, pushes pending migrations with the pinned CLI, then verifies database security, Auth mappings, and the deployed app.

## Baseline and future squashes

- `20260827064853_current_schema_baseline.sql` is the immutable current-schema baseline. Its SHA-256 and matching integration test are enforced by `verify:migrations`.
- Never replay the baseline into an existing production database. The production deploy fails closed unless that version is already marked as applied in `supabase_migrations.schema_migrations`.
- Before a future squash, create separate private roles, schema, data, and ledger backups; add a SHA-256 manifest; encrypt the archive with `age`; restore-test it on disposable PostgreSQL 17; compare normalized schema, row counts, sequences, and deterministic data checksums; and repair the remote ledger only after explicit approval.
- Keep the encrypted backup and its Keeper-held key for 14 days after the verified cutover, then delete both. Remove plaintext dumps and the disposable restore database immediately after verification.
- Remove superseded migrations and their matching tests together in the same reviewed squash change. Historical backfills do not belong in the schema-only baseline; required storage bootstrap data must remain idempotent.
- Database rollback is forward-only by default: add a corrective migration. Restoring a backup or repairing migration history is an explicit incident action, not an automatic pipeline step.

## Output

Report whether SQL was applied locally, deployed through the production workflow, or only prepared. If it was not applied, state the exact blocker and the exact command to run.
