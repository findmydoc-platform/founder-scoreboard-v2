alter table tasks add column if not exists updated_at timestamptz not null default now();

create or replace function public.update_task_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_task_patch jsonb default '{}'::jsonb,
  p_note_present boolean default false,
  p_note text default null,
  p_dependency_present boolean default false,
  p_dependency_note text default null,
  p_activity_messages text[] default '{}',
  p_notifications jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patch jsonb := coalesce(p_task_patch, '{}'::jsonb);
  v_allowed_columns constant text[] := array[
    'acceptance_criteria',
    'assignee',
    'deadline',
    'definition_of_done',
    'end_date',
    'evidence_link',
    'evidence_required',
    'github_sync_error',
    'github_sync_status',
    'intended_outcome',
    'milestone_id',
    'owner',
    'package_id',
    'priority',
    'problem_statement',
    'review_owner_profile_id',
    'review_requested_at',
    'review_status',
    'score_final',
    'score_points',
    'score_relevant',
    'self_blockers_checked',
    'self_dod_checked',
    'self_documented_checked',
    'self_evidence_checked',
    'scope_constraints',
    'sprint_id',
    'start_date',
    'status',
    'task_type'
  ];
  v_assignments text;
  v_task jsonb;
  v_activities jsonb := '[]'::jsonb;
begin
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'expected task update timestamp is required';
  end if;

  if jsonb_typeof(v_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'task patch must be a JSON object';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(v_patch) as patch_key
    where not (patch_key = any(v_allowed_columns))
  ) then
    raise exception using errcode = '22023', message = 'task patch contains unsupported columns';
  end if;

  if jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'task notifications must be a JSON array';
  end if;

  if exists (select 1 from jsonb_object_keys(v_patch)) then
    select string_agg(
      format(
        '%1$I = (jsonb_populate_record(null::public.tasks, to_jsonb(task) || $1)).%1$I',
        patch_key
      ),
      ', '
      order by patch_key
    )
    into v_assignments
    from jsonb_object_keys(v_patch) as patch_key;

    execute format(
      'update public.tasks as task set %s, updated_at = clock_timestamp() where task.id = $2 and task.updated_at = $3 returning to_jsonb(task)',
      v_assignments
    )
    into v_task
    using v_patch, p_task_id, p_expected_updated_at;
  else
    update public.tasks as task
    set updated_at = clock_timestamp()
    where task.id = p_task_id
      and task.updated_at = p_expected_updated_at
    returning to_jsonb(task) into v_task;
  end if;

  if v_task is null then
    if exists (select 1 from public.tasks where id = p_task_id) then
      raise exception using errcode = 'P0001', message = 'task was changed concurrently';
    end if;
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  if p_note_present then
    insert into public.task_notes (task_id, note, updated_at)
    values (p_task_id, coalesce(p_note, ''), now())
    on conflict (task_id) do update
      set note = excluded.note,
          updated_at = excluded.updated_at;
  end if;

  if p_dependency_present then
    delete from public.task_dependencies where task_id = p_task_id;
    if nullif(trim(coalesce(p_dependency_note, '')), '') is not null then
      insert into public.task_dependencies (task_id, note)
      values (p_task_id, left(trim(p_dependency_note), 2000));
    end if;
  end if;

  with inserted as (
    insert into public.task_activity (task_id, message)
    select p_task_id, message
    from unnest(coalesce(p_activity_messages, '{}')) as message
    where nullif(trim(message), '') is not null
    returning id, task_id, message, created_at
  )
  select coalesce(jsonb_agg(to_jsonb(inserted) order by inserted.id), '[]'::jsonb)
  into v_activities
  from inserted;

  insert into public.notification_events (
    type,
    actor_profile_id,
    recipient_profile_id,
    entity_type,
    entity_id,
    title,
    body
  )
  select
    notification.type,
    notification.actor_profile_id,
    notification.recipient_profile_id,
    notification.entity_type,
    notification.entity_id,
    notification.title,
    notification.body
  from jsonb_to_recordset(coalesce(p_notifications, '[]'::jsonb)) as notification(
    type text,
    actor_profile_id text,
    recipient_profile_id text,
    entity_type text,
    entity_id text,
    title text,
    body text
  );

  return jsonb_build_object(
    'task', v_task,
    'activities', v_activities
  );
end;
$$;

revoke all on function public.update_task_transaction(text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb) from public, anon, authenticated;
grant execute on function public.update_task_transaction(text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb) to service_role;

comment on function public.update_task_transaction(text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb)
is 'Atomically applies a compare-and-set task update with notes, dependencies, activity, and notifications.';

notify pgrst, 'reload schema';
