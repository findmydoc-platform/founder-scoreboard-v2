create or replace function public.assign_backlog_tasks_to_sprint_transaction(
  p_assignments jsonb,
  p_sprint_id text,
  p_actor_profile_id text default null,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_assignment jsonb;
  v_assignment_count integer;
  v_task_ids text[];
  v_task public.tasks%rowtype;
  v_before public.tasks%rowtype;
  v_updated public.tasks%rowtype;
  v_target_sprint public.sprints%rowtype;
  v_source_locked boolean;
  v_updates jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_assignments) <> 'array' then
    raise exception using errcode = '22023', message = 'assignments must be an array';
  end if;

  v_assignment_count := jsonb_array_length(p_assignments);
  if v_assignment_count < 1 or v_assignment_count > 100 then
    raise exception using errcode = '22023', message = 'assignments must contain between 1 and 100 tasks';
  end if;
  if nullif(trim(p_sprint_id), '') is null then
    raise exception using errcode = '22023', message = 'target sprint is required';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_assignments) as assignment(value)
    where jsonb_typeof(assignment.value) <> 'object'
      or nullif(trim(assignment.value ->> 'taskId'), '') is null
      or nullif(trim(assignment.value ->> 'expectedUpdatedAt'), '') is null
  ) then
    raise exception using errcode = '22023', message = 'assignment entries are invalid';
  end if;

  select array_agg(task_id order by task_id)
  into v_task_ids
  from (
    select distinct assignment.value ->> 'taskId' as task_id
    from jsonb_array_elements(p_assignments) as assignment(value)
  ) as distinct_tasks;
  if cardinality(v_task_ids) <> v_assignment_count then
    raise exception using errcode = '22023', message = 'assignment task ids must be unique';
  end if;

  select sprint.*
  into v_target_sprint
  from public.sprints as sprint
  where sprint.id = p_sprint_id
  for share;
  if not found then
    raise exception using errcode = 'P0004', message = 'target sprint not found';
  end if;
  if v_target_sprint.score_locked then
    raise exception using errcode = 'P0005', message = 'target sprint is locked';
  end if;

  perform 1
  from public.tasks as task
  where task.id = any(v_task_ids)
  order by task.id
  for update;

  for v_assignment in
    select assignment.value
    from jsonb_array_elements(p_assignments) as assignment(value)
    order by assignment.value ->> 'taskId'
  loop
    select task.*
    into v_task
    from public.tasks as task
    where task.id = v_assignment ->> 'taskId';
    if not found or v_task.trashed_at is not null then
      raise exception using errcode = 'P0002', message = 'task not found';
    end if;
    if v_task.updated_at <> (v_assignment ->> 'expectedUpdatedAt')::timestamptz then
      raise exception using errcode = 'P0001', message = 'task was changed concurrently';
    end if;
    if v_task.task_type <> 'deliverable' then
      raise exception using errcode = 'P0010', message = 'only deliverables may be assigned to sprints';
    end if;
    if v_task.approval_status <> 'approved' then
      raise exception using errcode = 'P0011', message = 'deliverable approval is required';
    end if;
    if v_task.status = 'Erledigt' then
      raise exception using errcode = 'P0012', message = 'completed deliverables cannot be assigned';
    end if;
    if coalesce(nullif(trim(v_task.assignee), ''), nullif(trim(v_task.owner), '')) is null then
      raise exception using errcode = 'P0013', message = 'deliverable owner is required';
    end if;
    if v_task.parent_task_id is null or not exists (
      select 1
      from public.tasks as parent
      where parent.id = v_task.parent_task_id
        and parent.task_type = 'initiative'
        and parent.approval_status = 'approved'
        and parent.trashed_at is null
    ) then
      raise exception using errcode = 'P0014', message = 'approved deliverable initiative is required';
    end if;

    if v_task.sprint_id is not null and v_task.sprint_id <> p_sprint_id then
      select sprint.score_locked
      into v_source_locked
      from public.sprints as sprint
      where sprint.id = v_task.sprint_id
      for share;
      if not found then
        raise exception using errcode = 'P0006', message = 'source sprint not found';
      end if;
      if v_source_locked then
        raise exception using errcode = 'P0007', message = 'source sprint is locked';
      end if;
    end if;
  end loop;

  for v_assignment in
    select assignment.value
    from jsonb_array_elements(p_assignments) as assignment(value)
    order by assignment.value ->> 'taskId'
  loop
    select task.*
    into v_before
    from public.tasks as task
    where task.id = v_assignment ->> 'taskId';

    if v_before.sprint_id is distinct from p_sprint_id then
      update public.tasks as task
      set sprint_id = p_sprint_id,
          score_relevant = true,
          updated_at = clock_timestamp()
      where task.id = v_before.id
      returning task.* into v_updated;

      insert into public.audit_log (
        actor_profile_id,
        action,
        entity_type,
        entity_id,
        before_data,
        after_data,
        request_ip,
        user_agent
      ) values (
        p_actor_profile_id,
        'task.sprint.bulk_assigned',
        'task',
        v_before.id,
        jsonb_build_object(
          'sprintId', v_before.sprint_id,
          'scoreRelevant', v_before.score_relevant,
          'updatedAt', v_before.updated_at
        ),
        jsonb_build_object(
          'sprintId', v_updated.sprint_id,
          'scoreRelevant', v_updated.score_relevant,
          'updatedAt', v_updated.updated_at
        ),
        p_request_ip,
        p_user_agent
      );
    else
      v_updated := v_before;
    end if;

    v_updates := v_updates || jsonb_build_array(jsonb_build_object(
      'id', v_updated.id,
      'sprintId', v_updated.sprint_id,
      'scoreRelevant', v_updated.score_relevant,
      'updatedAt', v_updated.updated_at
    ));
  end loop;

  return v_updates;
end;
$$;

comment on function public.assign_backlog_tasks_to_sprint_transaction(jsonb, text, text, text, text)
is 'Atomically assigns up to 100 eligible Deliverables to one unlocked Sprint with compare-and-set protection and per-item audit history.';

revoke all on function public.assign_backlog_tasks_to_sprint_transaction(jsonb, text, text, text, text) from public;
revoke all on function public.assign_backlog_tasks_to_sprint_transaction(jsonb, text, text, text, text) from anon;
revoke all on function public.assign_backlog_tasks_to_sprint_transaction(jsonb, text, text, text, text) from authenticated;
grant execute on function public.assign_backlog_tasks_to_sprint_transaction(jsonb, text, text, text, text) to service_role;
