create or replace function public.update_planning_task_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_task_patch jsonb default '{}'::jsonb,
  p_note_present boolean default false,
  p_note text default null,
  p_dependency_present boolean default false,
  p_dependency_note text default null,
  p_activity_messages text[] default '{}',
  p_notifications jsonb default '[]'::jsonb,
  p_actor_profile_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patch jsonb := coalesce(p_task_patch, '{}'::jsonb);
  v_parent_id text;
  v_before_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_updated_task public.tasks%rowtype;
  v_result jsonb;
begin
  perform set_config('app.actor_profile_id', coalesce(p_actor_profile_id, ''), true);

  if not (v_patch ? 'parent_task_id') then
    return public.update_task_transaction(
      p_task_id, p_expected_updated_at, v_patch, p_note_present, p_note,
      p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
    );
  end if;

  v_parent_id := nullif(trim(v_patch->>'parent_task_id'), '');
  if v_parent_id is null then
    raise exception using errcode = '22023', message = 'sub-issue parent is required';
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

  select * into v_parent
  from public.tasks
  where id = v_parent_id
    and task_type = 'deliverable'
  for share;
  if not found then
    raise exception using errcode = '22023', message = 'sub-issue parent must be a deliverable';
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

revoke all on function public.update_planning_task_transaction(text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb, text) from public, anon, authenticated;
grant execute on function public.update_planning_task_transaction(text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb, text) to service_role;

comment on function public.update_planning_task_transaction(text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb, text)
is 'Atomically applies approval-aware task updates and controlled Sub-Issue parent changes with compare-and-set protection and audit history.';

notify pgrst, 'reload schema';
