create extension if not exists pgcrypto;

create table if not exists github_issue_sync_locks (
  resource_key text primary key,
  task_id text references tasks(id) on delete cascade,
  locked_by_profile_id text references profiles(id) on delete set null,
  lock_token uuid not null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint github_issue_sync_locks_resource_key_present check (length(trim(resource_key)) > 0),
  constraint github_issue_sync_locks_expires_after_locked check (expires_at > locked_at)
);

create index if not exists github_issue_sync_locks_task_idx on github_issue_sync_locks(task_id);
create index if not exists github_issue_sync_locks_expires_idx on github_issue_sync_locks(expires_at);

create or replace function public.try_acquire_github_issue_sync_lock(
  p_resource_key text,
  p_task_id text default null,
  p_locked_by_profile_id text default null,
  p_ttl_seconds integer default 600
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_token uuid := gen_random_uuid();
begin
  if p_resource_key is null or length(trim(p_resource_key)) = 0 then
    raise exception 'github sync resource key is required';
  end if;

  insert into public.github_issue_sync_locks (
    resource_key,
    task_id,
    locked_by_profile_id,
    lock_token,
    locked_at,
    expires_at
  )
  values (
    trim(p_resource_key),
    nullif(p_task_id, ''),
    nullif(p_locked_by_profile_id, ''),
    v_lock_token,
    now(),
    now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 600), 1))
  )
  on conflict (resource_key) do update
    set task_id = excluded.task_id,
        locked_by_profile_id = excluded.locked_by_profile_id,
        lock_token = excluded.lock_token,
        locked_at = excluded.locked_at,
        expires_at = excluded.expires_at
    where public.github_issue_sync_locks.expires_at <= now()
  returning lock_token into v_lock_token;

  if not found then
    return null;
  end if;

  return v_lock_token;
end;
$$;

create or replace function public.release_github_issue_sync_lock(
  p_resource_key text,
  p_lock_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  delete from public.github_issue_sync_locks
  where resource_key = trim(p_resource_key)
    and lock_token = p_lock_token;

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

grant select, insert, update, delete on github_issue_sync_locks to service_role;
revoke all on function public.try_acquire_github_issue_sync_lock(text, text, text, integer) from public;
revoke all on function public.release_github_issue_sync_lock(text, uuid) from public;
grant execute on function public.try_acquire_github_issue_sync_lock(text, text, text, integer) to service_role;
grant execute on function public.release_github_issue_sync_lock(text, uuid) to service_role;

alter table github_issue_sync_locks enable row level security;
