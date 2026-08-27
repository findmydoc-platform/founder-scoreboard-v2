# Supabase Rules

- Use `.agents/skills/supabase-migrations` for migration, RLS, grant, ledger, storage, or schema work. This repository workflow overrides conflicting generic Supabase skill instructions.
- Create timestamp migrations with `pnpm run db:migration:new -- <name>` and edit only the generated file.
- Keep `20260827064853_current_schema_baseline.sql` immutable. Never replay it into an existing production database.
- Prefer additive and idempotent SQL. Database rollback is forward-only through a corrective migration by default.
- Enable RLS on exposed tables and review grants, policies, functions, triggers, and views together as one access-control boundary.
- Ask before drops, truncation, broad deletes, destructive updates, removing columns, disabling RLS, credential changes, or migration-ledger repair.
- Add a matching `tests/migrations/<migration-name>.test.mjs` for every migration. Exercise the real local database; do not assert SQL source text.
- Reset to the previous timestamp, seed representative rows, apply the target migration, and prove both the intended change and preservation of unrelated IDs, values, and row counts.
- Run `pnpm run verify:migrations`, `pnpm run test:migrations`, a disposable local `pnpm run db:reset`, and `verify:auth` when the migration changes authentication or identity mapping.
- Production schema changes run only through `.github/workflows/deploy-production.yml`.
