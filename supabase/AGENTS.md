# Supabase Rules

- Use `.agents/skills/supabase-migrations` for migration, RLS, grant, ledger, storage, or schema work. This repository workflow overrides conflicting generic Supabase skill instructions.
- Create timestamp migrations with `pnpm run db:migration:new -- <name>` and edit only the generated file.
- Keep `20260713120959_production_baseline.sql` immutable. Never replay it into an existing production database.
- Prefer additive and idempotent SQL. Database rollback is forward-only through a corrective migration by default.
- Enable RLS on exposed tables and review grants, policies, functions, triggers, and views together as one access-control boundary.
- Ask before drops, truncation, broad deletes, destructive updates, removing columns, disabling RLS, credential changes, or migration-ledger repair.
- Read the ordered migration corpus through `scripts/lib/supabase-migrations.mjs` in tests and verifiers.
- Run `pnpm run verify:migrations`, a disposable local `pnpm run db:reset`, and the relevant `verify:supabase` or `verify:auth` check.
- Production schema changes run only through `.github/workflows/deploy-production.yml`.
