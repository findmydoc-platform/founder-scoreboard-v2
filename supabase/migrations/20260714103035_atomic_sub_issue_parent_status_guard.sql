create or replace function public.update_planning_task_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_task_patch jsonb default '{}'::jsonb,
  p_note_present boolean default false,
  p_note text default null,
  p_dependency_present boolean default false,
  p_dependency_note text default null,
  p_activity_messages text[] default '{}'::text[],
  p_notifications jsonb default '[]'::jsonb,
  p_actor_profile_id text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_patch jsonb := coalesce(p_task_patch, '{}'::jsonb);
  v_changes_parent boolean := v_patch ? 'parent_task_id';
  v_changes_status boolean := v_patch ? 'status';
  v_parent_id text;
  v_initial_parent_id text;
  v_initial_task_type text;
  v_before_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_updated_task public.tasks%rowtype;
  v_result jsonb;
begin
  perform set_config('app.actor_profile_id', coalesce(p_actor_profile_id, ''), true);

  if not v_changes_parent and not v_changes_status then
    return public.update_task_transaction(
      p_task_id, p_expected_updated_at, v_patch, p_note_present, p_note,
      p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
    );
  end if;

  select task_type, parent_task_id
  into v_initial_task_type, v_initial_parent_id
  from public.tasks
  where id = p_task_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  if v_changes_parent then
    if v_initial_task_type <> 'sub_issue' then
      raise exception using errcode = '22023', message = 'only sub-issues may change parent';
    end if;
    v_parent_id := nullif(trim(v_patch->>'parent_task_id'), '');
  elsif v_initial_task_type = 'sub_issue' then
    v_parent_id := v_initial_parent_id;
  else
    return public.update_task_transaction(
      p_task_id, p_expected_updated_at, v_patch, p_note_present, p_note,
      p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
    );
  end if;

  if v_parent_id is null then
    raise exception using errcode = '22023', message = 'sub-issue parent is required';
  end if;

  select * into v_parent
  from public.tasks
  where id = v_parent_id
    and task_type = 'deliverable'
    and trashed_at is null
  for share;
  if not found then
    raise exception using errcode = '22023', message = 'sub-issue parent must be an active deliverable';
  end if;
  if v_changes_status and v_parent.approval_status is distinct from 'approved' then
    raise exception using errcode = 'P0008', message = 'sub-issue parent is not approved';
  end if;

  select * into v_before_task
  from public.tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
  if v_before_task.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'task was changed concurrently';
  end if;
  if v_before_task.task_type <> 'sub_issue' then
    raise exception using errcode = '22023', message = 'only sub-issues may change parent';
  end if;
  if v_before_task.trashed_at is not null then
    raise exception using errcode = 'P0003', message = 'sub-issue is trashed';
  end if;
  if not v_changes_parent and v_before_task.parent_task_id is distinct from v_parent_id then
    raise exception using errcode = 'P0001', message = 'sub-issue parent changed concurrently';
  end if;

  if not v_changes_parent then
    v_result := public.update_task_transaction(
      p_task_id, p_expected_updated_at, v_patch, p_note_present, p_note,
      p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
    );
    return jsonb_set(
      v_result,
      '{parentApprovalStatus}',
      to_jsonb(v_parent.approval_status),
      true
    );
  end if;

  v_result := public.update_task_transaction(
    p_task_id, p_expected_updated_at, v_patch - 'parent_task_id', p_note_present, p_note,
    p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
  );

  update public.tasks
  set parent_task_id = v_parent_id,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning * into v_updated_task;

  if v_before_task.parent_task_id is distinct from v_updated_task.parent_task_id then
    insert into public.audit_log (
      actor_profile_id,
      action,
      entity_type,
      entity_id,
      before_data,
      after_data
    ) values (
      p_actor_profile_id,
      'task.parent_changed',
      'task',
      p_task_id,
      jsonb_build_object(
        'parentTaskId', v_before_task.parent_task_id,
        'packageId', v_before_task.package_id,
        'milestoneId', v_before_task.milestone_id
      ),
      jsonb_build_object(
        'parentTaskId', v_updated_task.parent_task_id,
        'packageId', v_updated_task.package_id,
        'milestoneId', v_updated_task.milestone_id
      )
    );
  end if;

  return jsonb_set(
    jsonb_set(v_result, '{task}', to_jsonb(v_updated_task), true),
    '{parentApprovalStatus}',
    to_jsonb(v_parent.approval_status),
    true
  );
end;
$$;

comment on function public.update_planning_task_transaction(
  text,
  timestamptz,
  jsonb,
  boolean,
  text,
  boolean,
  text,
  text[],
  jsonb,
  text
) is 'Atomically applies task updates and locks the active parent approval state for every Sub-Issue status mutation.';
