# Supabase Migration Baseline and Cutover

## Repository contract

`supabase/migrations/20260827064853_current_schema_baseline.sql` is the current schema-only baseline. It replaces the previous 62-file migration chain without rewriting Git history. Historical backfills are not replayed. The `fmd-tool-previews` storage bucket is the sole bootstrap data in the baseline because Supabase schema dumps omit bucket rows.

`pnpm run verify:migrations` pins the baseline hash and requires one matching top-level integration test for every SQL migration. `pnpm run test:migrations` runs those tests serially against the real local Supabase/PostgreSQL stack. The dedicated `Migration Integration` CI job owns this suite.

For every later migration:

1. Create the timestamp migration with `pnpm run db:migration:new -- <clear_name>`.
2. Add `tests/migrations/<same-name>.test.mjs`.
3. Reset the local database to the preceding timestamp with `supabase db reset --local --version <previous-version> --no-seed`.
4. Insert representative existing rows, apply the target migration, and verify the intended schema or authorization behavior.
5. Compare primary keys, relevant values, and row counts before and after. Differences require an explicit transformation assertion.
6. For RLS, grant, or Auth changes, prove allowed and denied access for the affected roles, including an unmapped session.

Tests must not inspect migration source text or require production-only exports. External provider calls, time, and randomness may be replaced at the application boundary.

## Pre-cutover backup and restore gate

The production cutover is a separate, explicitly approved operation. Immediately before it, an authorized operator must:

1. Export roles, application schemas, data, and `supabase_migrations.schema_migrations` as separate artifacts using the pinned Supabase CLI and PostgreSQL 17 tools.
2. Generate a SHA-256 manifest covering every dump.
3. Package and encrypt the dumps and manifest with `age`. Store the encrypted archive only in the private findmydoc Google Drive area restricted to CEO and operators. Store the decryption key only in Keeper.
4. Restore the archive into a disposable local Supabase/PostgreSQL 17 instance.
5. Compare normalized schemas, table row counts, sequence values, and deterministic data checksums with the production snapshot. Every comparison must match.
6. Remove plaintext dumps and the disposable restore database immediately after verification.

Never place database URLs, passwords, keys, or tokens in command arguments, repository files, logs, screenshots, issues, or pull requests. Use the approved operator environment and secret handoff instead.

Run the manual `Supabase Baseline Cutover` workflow with operation `backup` and a newly generated public `age` recipient. The workflow uses the protected production environment, exports the split backup, records deterministic application and ledger snapshots, encrypts the archive before upload, and removes plaintext runner files. Download the encrypted artifact, place it in the restricted findmydoc Google Drive area, and complete the local restore gate before using the workflow's `repair` operation.

Supabase documents the split dump and restore flow in [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Production ledger cutover

After the squash pull request is merged, the production deploy guard refuses to run until version `20260827064853` exists exactly once as applied in the production migration ledger. It therefore cannot execute the baseline accidentally.

With separate production approval, the operator must mark all 62 superseded versions as reverted and mark only `20260827064853` as applied. `supabase migration repair` changes ledger state only; it does not execute the baseline SQL. The exact target and resulting ledger must be reviewed before the repair. The workflow's `repair` operation additionally requires the restore-tested application, ledger, and manifest hashes and refuses a changed production snapshot.

The next production migration dry run must report only `20260827083034_allow_all_mapped_profiles_team_workweek.sql` as pending. Before and after data checksums and row counts must still match. Only then may the protected production workflow apply that migration and continue with database-security and Auth verification.

Keep the encrypted archive and Keeper key for 14 days after the verified cutover. Delete both at the end of that window and record completion in the maintenance issue.

The repository change does not authorize or perform backups, Google Drive or Keeper writes, production ledger repair, production migration execution, or archive deletion.
