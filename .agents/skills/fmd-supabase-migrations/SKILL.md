---
name: fmd-supabase-migrations
description: Use when creating, reviewing, applying, or verifying Founder Scoreboard Supabase SQL migrations, RLS policies, grants, indexes, seed data, schema.sql updates, or database repair scripts. Prefer additive migrations and apply them directly with project tooling when credentials are available; ask before destructive database changes.
---

# FMD Supabase Migrations

## Default authority

Codex may create and apply additive Supabase SQL for this project when the task requires it and `.env.local` provides the database credentials. Do not ask the user to paste SQL manually unless credentials are missing, network access is blocked, or the user specifically wants manual execution.

## Allowed without extra confirmation

- `create table if not exists`
- `alter table add column if not exists`
- indexes, constraints, triggers, functions, views, grants, policies, comments, and seed inserts or upserts
- data backfills that preserve existing rows and can be reasoned about from current schema
- updates to `supabase/schema.sql`, numbered migration files, and verification scripts

## Requires explicit user confirmation

- `drop table`, `drop schema`, `truncate`, broad `delete`, destructive `update`, or removing columns
- disabling RLS on protected tables
- rotating, exposing, or deleting credentials
- changing production source of truth semantics

## Workflow

1. Inspect existing `supabase/*.sql`, `scripts/verify-*.mjs`, API routes, and data access code before writing SQL.
2. Create a numbered migration under `supabase/` using the next available number and a clear suffix.
3. Keep migrations idempotent where practical with `if not exists`, `on conflict`, and guarded `do $$` blocks.
4. Update `supabase/schema.sql` when the baseline schema should reflect the new structure.
5. Add or update the narrowest verification script or contract test.
6. Apply SQL with `npm run apply:sql -- supabase/<file>.sql` when credentials and network access are available.
7. Run the relevant verification command: usually `npm run verify:supabase`, plus `npm run verify:auth` for auth/RLS/grants.

## Output

Report whether SQL was applied or only prepared. If it was not applied, state the exact blocker and the exact command to run.
