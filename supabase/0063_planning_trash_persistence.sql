-- Additive persistence and active read models for the FounderOps planning trash.

alter table public.packages add column if not exists trashed_at timestamptz;
alter table public.packages add column if not exists trashed_by text references public.profiles(id) on delete restrict;
alter table public.packages add column if not exists trash_reason text;
alter table public.packages add column if not exists trash_cause text;
alter table public.packages add column if not exists purge_after timestamptz;
alter table public.packages add column if not exists trash_root_type text;
alter table public.packages add column if not exists trash_root_id text;
alter table public.packages add column if not exists trash_revision integer not null default 0;

alter table public.tasks add column if not exists trashed_at timestamptz;
alter table public.tasks add column if not exists trashed_by text references public.profiles(id) on delete restrict;
alter table public.tasks add column if not exists trash_reason text;
alter table public.tasks add column if not exists trash_cause text;
alter table public.tasks add column if not exists purge_after timestamptz;
alter table public.tasks add column if not exists trash_root_type text;
alter table public.tasks add column if not exists trash_root_id text;
alter table public.tasks add column if not exists trash_revision integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'packages_trash_revision_check'
      and conrelid = 'public.packages'::regclass
  ) then
    alter table public.packages add constraint packages_trash_revision_check
      check (trash_revision >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'packages_trash_metadata_check'
      and conrelid = 'public.packages'::regclass
  ) then
    alter table public.packages add constraint packages_trash_metadata_check check (
      (
        trashed_at is null
        and trashed_by is null
        and trash_reason is null
        and trash_cause is null
        and purge_after is null
        and trash_root_type is null
        and trash_root_id is null
      )
      or (
        trashed_at is not null
        and trashed_by is not null
        and nullif(trim(trash_reason), '') is not null
        and trash_cause in ('withdrawn', 'rejected')
        and purge_after = trashed_at + interval '90 days'
        and trash_root_type = 'initiative'
        and trash_root_id = id
        and trash_revision >= 1
      )
    );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_trash_revision_check'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks add constraint tasks_trash_revision_check
      check (trash_revision >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_trash_metadata_check'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks add constraint tasks_trash_metadata_check check (
      (
        trashed_at is null
        and trashed_by is null
        and trash_reason is null
        and trash_cause is null
        and purge_after is null
        and trash_root_type is null
        and trash_root_id is null
      )
      or (
        trashed_at is not null
        and trashed_by is not null
        and nullif(trim(trash_reason), '') is not null
        and trash_cause in ('withdrawn', 'rejected')
        and purge_after = trashed_at + interval '90 days'
        and trash_root_type in ('initiative', 'deliverable')
        and nullif(trim(trash_root_id), '') is not null
        and trash_revision >= 1
      )
    );
  end if;
end
$$;

create index if not exists packages_trash_root_idx
  on public.packages(trash_root_type, trash_root_id)
  where trashed_at is not null;
create index if not exists packages_purge_after_idx
  on public.packages(purge_after, id)
  where trashed_at is not null;
create index if not exists tasks_trash_root_idx
  on public.tasks(trash_root_type, trash_root_id)
  where trashed_at is not null;
create index if not exists tasks_purge_after_idx
  on public.tasks(purge_after, id)
  where trashed_at is not null;

create or replace view public.active_packages
with (security_invoker = true)
as
select *
from public.packages
where trashed_at is null;

create or replace view public.active_tasks
with (security_invoker = true)
as
select *
from public.tasks
where trashed_at is null;

revoke all on public.active_packages from public, anon;
revoke all on public.active_tasks from public, anon;
grant select on public.active_packages to authenticated, service_role;
grant select on public.active_tasks to authenticated, service_role;

notify pgrst, 'reload schema';
