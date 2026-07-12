begin;

alter table public.tasks rename column github_issue_sync_status to github_sync_status;
alter table public.tasks rename column github_issue_last_synced_at to github_last_synced_at;
alter table public.tasks rename column github_issue_sync_error to github_sync_error;
alter index public.tasks_github_issue_sync_status_idx rename to tasks_github_sync_status_idx;

create or replace function public.begin_github_issue_sync_transaction(p_task_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task jsonb;
begin
  update public.tasks
  set github_sync_status = 'pending',
      github_sync_error = null,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning to_jsonb(tasks) into v_task;

  if v_task is null then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
  return v_task;
end;
$$;

create or replace function public.finalize_github_issue_sync_transaction(
  p_task_id text,
  p_github_repo text,
  p_github_issue_number integer,
  p_github_issue_url text,
  p_synced_at timestamptz,
  p_activity_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task jsonb;
begin
  if p_github_issue_number is null or p_github_issue_number <= 0 then
    raise exception using errcode = '22023', message = 'github issue number is invalid';
  end if;

  update public.tasks
  set github_repo = p_github_repo,
      github_issue_number = p_github_issue_number,
      github_issue_url = p_github_issue_url,
      github_sync_status = 'synced',
      github_last_synced_at = p_synced_at,
      github_sync_error = null,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning to_jsonb(tasks) into v_task;

  if v_task is null then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  insert into public.task_activity (task_id, message)
  values (p_task_id, p_activity_message);
  return v_task;
end;
$$;

create or replace function public.fail_github_issue_sync_transaction(
  p_task_id text,
  p_error_message text,
  p_activity_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task jsonb;
begin
  update public.tasks
  set github_sync_status = 'failed',
      github_sync_error = left(coalesce(p_error_message, 'GitHub issue sync failed'), 4000),
      updated_at = clock_timestamp()
  where id = p_task_id
  returning to_jsonb(tasks) into v_task;

  if v_task is null then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  insert into public.task_activity (task_id, message)
  values (p_task_id, p_activity_message);
  return v_task;
end;
$$;

revoke all on function public.begin_github_issue_sync_transaction(text) from public, anon, authenticated;
revoke all on function public.finalize_github_issue_sync_transaction(text, text, integer, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.fail_github_issue_sync_transaction(text, text, text) from public, anon, authenticated;
grant execute on function public.begin_github_issue_sync_transaction(text) to service_role;
grant execute on function public.finalize_github_issue_sync_transaction(text, text, integer, text, timestamptz, text) to service_role;
grant execute on function public.fail_github_issue_sync_transaction(text, text, text) to service_role;

commit;
