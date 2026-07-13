create or replace function public.begin_github_issue_sync_transaction_v2(
  p_task_id text,
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task jsonb;
begin
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'expected task revision is required';
  end if;

  update public.tasks
  set github_issue_sync_status = 'pending',
      github_issue_sync_error = null,
      updated_at = clock_timestamp()
  where id = p_task_id
    and updated_at = p_expected_updated_at
  returning to_jsonb(tasks) into v_task;

  if v_task is null then
    if exists (select 1 from public.tasks where id = p_task_id) then
      raise exception using errcode = 'P0001', message = 'task was changed concurrently';
    end if;
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  return v_task;
end;
$$;

alter function public.begin_github_issue_sync_transaction_v2(text, timestamptz) owner to postgres;
comment on function public.begin_github_issue_sync_transaction_v2(text, timestamptz)
  is 'Starts GitHub issue sync only when the task revision still matches.';
revoke all on function public.begin_github_issue_sync_transaction_v2(text, timestamptz) from public;
grant execute on function public.begin_github_issue_sync_transaction_v2(text, timestamptz) to service_role;

create or replace function public.finalize_github_issue_sync_transaction_v2(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_github_repo text,
  p_github_issue_number integer,
  p_github_issue_url text,
  p_synced_at timestamptz,
  p_activity_message text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task jsonb;
begin
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'expected task revision is required';
  end if;
  if p_github_issue_number is null or p_github_issue_number <= 0 then
    raise exception using errcode = '22023', message = 'github issue number is invalid';
  end if;

  update public.tasks
  set github_repo = p_github_repo,
      github_issue_number = p_github_issue_number,
      github_issue_url = p_github_issue_url,
      github_issue_sync_status = 'synced',
      github_issue_last_synced_at = p_synced_at,
      github_issue_sync_error = null,
      updated_at = clock_timestamp()
  where id = p_task_id
    and updated_at = p_expected_updated_at
    and github_issue_sync_status = 'pending'
  returning to_jsonb(tasks) into v_task;

  if v_task is null then
    if exists (select 1 from public.tasks where id = p_task_id) then
      raise exception using errcode = 'P0001', message = 'task was changed concurrently';
    end if;
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  insert into public.task_activity (task_id, message)
  values (p_task_id, p_activity_message);

  return v_task;
end;
$$;

alter function public.finalize_github_issue_sync_transaction_v2(text, timestamptz, text, integer, text, timestamptz, text) owner to postgres;
comment on function public.finalize_github_issue_sync_transaction_v2(text, timestamptz, text, integer, text, timestamptz, text)
  is 'Finalizes GitHub issue sync only when no task change occurred after sync started.';
revoke all on function public.finalize_github_issue_sync_transaction_v2(text, timestamptz, text, integer, text, timestamptz, text) from public;
grant execute on function public.finalize_github_issue_sync_transaction_v2(text, timestamptz, text, integer, text, timestamptz, text) to service_role;
