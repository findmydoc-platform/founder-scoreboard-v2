# Planning Legacy Cutover Runbook

This runbook prepares the destructive Planning Legacy cutover. It does not authorize or apply a production migration. Issue #317 owns the maintenance window, production snapshot, data migration, destructive SQL, deployment, and recovery decision.

## Current safe boundary

- Active planning state remains authoritative in `public.tasks`, `public.planning_item_strategy`, and `public.planning_item_raci_assignments`.
- GitHub remains a one-way projection and is not a recovery source.
- `pnpm run verify:planning-legacy-cutover -- --local --parity` is read-only and must pass before a snapshot.
- `pnpm run verify:planning-legacy-cutover -- --local --ready-to-drop` adds replay-removal gates. It must fail while legacy replay snapshots or the special Epic-delete replay table still contain rows.
- Historical migrations and `supabase/baseline.sql` remain immutable.
- `CASCADE`, broad deletes, truncation, and direct production execution are forbidden.

The verifier checks row and field parity for Milestones/Epics and Packages/Initiatives; parent relationships; approval and trash state; strategy; RACI; derived legacy columns; saved preferences; idempotency contract versions; and legacy replay storage. It prints at most twenty concrete IDs per failed check and exits non-zero on every unknown difference.

## Required application cutover before maintenance

All items below must be absent from active application code before the destructive migration is approved:

1. [x] `/api/milestones` and legacy Initiative HTTP response/request shapes.
2. [x] Browser hierarchy fields `packageId` and `milestoneId` are removed from active create, update, task projections, Backlog state, and local seed data; `parentTaskId` is authoritative. Browser create and update requests use only `ownerId` for responsibility and reject the old `assignee` and `owner` aliases.
3. [x] New Team v1 context, create, update, token, delete-error, and OpenAPI contracts expose only canonical Epic and `parentTaskId` forms. Legacy-shaped commit payloads are parsed only after an idempotency key is present and can return only an exact immutable stored receipt; they cannot create or update state. Removing the replay-only parser, response mapper, compatibility hashes, and special Epic-delete receipt table remains blocked on the #317 receipt migration and replay proof.
4. [x] `Package`, `Milestone`, `packages`, and `milestones` in active UI state. Planning, Projects, Gantt, trash, and task-detail surfaces now derive Epic and Initiative state exclusively from canonical Planning Items and `parentTaskId`. Saved Planning filters use `initiativeId` and `expanded_item_ids`; the additive preparation migration preserves existing values before active readers switch. The old column remains unused until #317 drops it.
5. [x] Active application reads from `active_packages`, `packages`, and `milestones` are removed. `planning_item_legacy_ids` is read only by the isolated stored-replay adapter and the cutover verifier; removing it remains blocked on #317 replay migration.
6. Writes to `tasks.package_id`, `tasks.milestone_id`, and special Milestone-delete receipts.

Compatibility code may remain only in the cutover migration and this runbook. Tests must prove the canonical contract instead of preserving the retired contract.

## Snapshot and restore drill

Production work must use the protected workflow and a provider snapshot. The logical dump below is a second, independently restorable artifact. The operator records artifact paths and SHA-256 checksums in the private maintenance log; credentials and dump contents never enter Git or issue comments.

Before the snapshot:

1. Activate the approved maintenance window and freeze Planning writes.
2. Stop new queue claims and wait for claimed Planning projection/lifecycle jobs to settle.
3. Run the parity preflight in one repeatable-read transaction.
4. Record counts for every table named by the verifier and for both projection outboxes.

Disposable local restore drill, tested on 2026-08-12:

```bash
docker exec supabase_db_founder-scoreboard pg_dump \
  -U supabase_admin -d postgres --format=custom \
  --file=/tmp/founderops-cutover-full.dump
docker exec supabase_db_founder-scoreboard createdb \
  -U supabase_admin founderops_cutover_restore_test
docker exec supabase_db_founder-scoreboard pg_restore \
  -U supabase_admin -d founderops_cutover_restore_test \
  --exit-on-error /tmp/founderops-cutover-full.dump
PLANNING_CUTOVER_LOCAL_DATABASE=founderops_cutover_restore_test \
  pnpm run verify:planning-legacy-cutover -- --local --parity
```

The drill is successful only when the restore completes, parity passes on the restored database, and source/restored counts match for:

- `milestones`, `packages`, `tasks`, and `planning_item_legacy_ids`;
- `planning_item_strategy` and `planning_item_raci_assignments`;
- `profile_ui_preferences`;
- `team_task_intake_batches`, `team_planning_item_update_requests`, and `team_planning_milestone_delete_requests`.

The rejected `public`-only dump method is not a valid backup: Planning tables reference `auth`, and task/profile data includes cyclic foreign keys. Use a full custom-format database dump or the provider snapshot.

After verification, remove only the explicitly created scratch database and dump:

```bash
docker exec supabase_db_founder-scoreboard dropdb \
  -U supabase_admin --force founderops_cutover_restore_test
docker exec supabase_db_founder-scoreboard rm -f \
  /tmp/founderops-cutover-full.dump
```

## Object-by-object `RESTRICT` manifest

The approved #317 migration must be a new timestamp migration. Immediately before authoring it, query `pg_depend`, `pg_proc`, `pg_trigger`, `pg_constraint`, `pg_policies`, and grants again. Any object not listed below aborts the cutover and requires a manifest update.

### A. Replace retained canonical objects

These retained objects currently reference legacy IDs, columns, tables, or response shapes. Replace each with a canonical-only definition before dropping dependencies:

- `normalize_task_approval_state()` — stop deriving `package_id` and `milestone_id`.
- `prepare_empty_epic_delete(text)`, `delete_empty_epic_transaction(text,timestamptz,text)` — remove legacy-ID protection.
- `prepare_planning_approval_command(text,text,text)` — remove legacy-ID resolution.
- `prepare_planning_reparent_command(text,text,text,text)` and its commit RPC — accept canonical IDs only.
- Planning create/update RPCs — remove Package/Milestone aliases and legacy column writes.
- trash guard, purge, and restore functions — operate only on task-rooted Planning Items.
- replay readers/writers — use one general Planning command receipt table and canonical response payload.

Every replacement is verified before any drop. A missing replacement is a hard abort.

### B. Remove public compatibility entry points

Execute one statement at a time and stop on the first error:

```sql
revoke all on table public.active_packages from authenticated, service_role;
drop view public.active_packages restrict;

drop function public.delete_team_planning_milestone_transaction(
  uuid, text, text, timestamp with time zone, uuid, text, text, text
) restrict;
drop function public.backfill_unified_planning_hierarchy() restrict;
drop function public.planning_legacy_item_id(text, text, text) restrict;
```

### C. Remove legacy trigger-only behavior

```sql
drop trigger milestones_allocate_sort_order on public.milestones;
drop trigger milestones_touch_updated_at on public.milestones;
drop trigger packages_guard_trash_mutation on public.packages;
drop trigger packages_touch_updated_at on public.packages;

drop function public.allocate_milestone_sort_order() restrict;
drop function public.touch_milestone_updated_at() restrict;
drop function public.touch_package_updated_at() restrict;
```

Do not drop shared trigger functions such as `guard_planning_trash_mutation()` until their canonical task trigger has a replacement.

### D. Remove replay-specific storage and mapping

Only after all immutable receipts have been copied to the general receipt structure, fingerprinted, and replay-tested:

```sql
drop table public.team_planning_milestone_delete_requests restrict;

revoke all on table public.planning_item_legacy_ids from authenticated, service_role;
drop policy planning_item_legacy_ids_select_team on public.planning_item_legacy_ids;
drop table public.planning_item_legacy_ids restrict;
```

The receipt copy must preserve token/principal, idempotency key, request hash, command kind, original response, contract version, and creation time. Same key plus same fingerprint must replay the original receipt; same key plus a different fingerprint must conflict.

### E. Remove derived columns and indexes

Only after canonical-only functions are installed and the ready-to-drop preflight passes:

```sql
alter table public.tasks drop constraint tasks_package_id_fkey restrict;
drop index public.tasks_package_id_idx restrict;
alter table public.tasks drop column package_id restrict;

alter table public.tasks drop constraint tasks_milestone_id_fkey restrict;
drop index public.tasks_milestone_id_idx restrict;
alter table public.tasks drop column milestone_id restrict;

alter table public.profile_ui_preferences
  drop column expanded_package_ids restrict;
```

The preparatory migration `20260812231305_canonical_planning_preferences.sql` adds and populates `expanded_item_ids`, moves the `planning_filters.packageId` value to `initiativeId`, moves `owner` to `assignee`, and preserves unknown filter keys. #317 only removes the now-unused legacy column.

### F. Remove legacy root tables last

Revoke grants and remove policies before the tables. Drop `packages` before `milestones` because the Package parent foreign key points to Milestones.

```sql
revoke all on table public.packages from authenticated, service_role;
drop policy packages_select_team on public.packages;
drop table public.packages restrict;

revoke all on table public.milestones from authenticated, service_role;
drop policy milestones_select_team on public.milestones;
drop policy milestones_write_operational on public.milestones;
drop table public.milestones restrict;
```

## Go/no-go and rollback

Go requires all of the following:

- application-reference scan is zero outside historical migrations and this runbook;
- parity and ready-to-drop preflights pass on the frozen source and restored snapshot;
- queue counts and table checksums match the maintenance record;
- every manifest statement succeeds with `RESTRICT` in staging restored from the production snapshot;
- focused auth/security tests, migration verification, local integration, test, lint, and build are green;
- the CEO explicitly approves the exact migration manifest and maintenance window.

Abort immediately on an unknown ID, row/field difference, unresolved replay, extra dependent object, queue change, checksum mismatch, failed `RESTRICT`, or failed verification. Before destructive SQL, rollback means release the write freeze. After destructive SQL, do not improvise forward fixes: stop application traffic and restore the provider snapshot/full dump according to the approved #317 recovery decision.
