CREATE OR REPLACE FUNCTION public.move_backlog_task_transaction(
  p_task_id text,
  p_target_task_id text,
  p_placement text,
  p_expected_task_updated_at timestamptz,
  p_expected_target_updated_at timestamptz,
  p_actor_profile_id text DEFAULT NULL,
  p_request_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_task_id text := nullif(trim(coalesce(p_task_id, '')), '');
  v_target_task_id text := nullif(trim(coalesce(p_target_task_id, '')), '');
  v_project_id text;
  v_task public.tasks%rowtype;
  v_target_task public.tasks%rowtype;
  v_insert_position integer;
  v_before jsonb := '[]'::jsonb;
  v_updates jsonb := '[]'::jsonb;
begin
  if v_task_id is null
     or v_target_task_id is null
     or v_task_id = v_target_task_id
     or p_placement is null
     or p_placement not in ('before', 'after')
     or p_expected_task_updated_at is null
     or p_expected_target_updated_at is null then
    raise exception using errcode = '22023', message = 'backlog move input is invalid';
  end if;

  select task.project_id into v_project_id
  from public.tasks as task
  where task.id = v_task_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'backlog task was not found';
  end if;

  -- Every valid move locks the project backlog in one stable order. This keeps
  -- relative insertion and re-numbering serializable without a bulk client payload.
  perform 1
  from public.tasks as task
  where task.project_id = v_project_id
    and task.trashed_at is null
    and task.task_type = 'deliverable'
    and task.status <> 'Erledigt'
  order by task.id
  for update of task;

  select * into v_task
  from public.tasks as task
  where task.id = v_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'backlog task was not found';
  end if;

  select * into v_target_task
  from public.tasks as task
  where task.id = v_target_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'backlog target was not found';
  end if;

  if v_task.project_id is distinct from v_project_id then
    raise exception using errcode = 'P0001', message = 'backlog task was changed concurrently';
  end if;

  if v_task.project_id is distinct from v_target_task.project_id then
    raise exception using errcode = '22023', message = 'backlog tasks must belong to the same project';
  end if;

  if v_task.trashed_at is not null
     or v_target_task.trashed_at is not null
     or v_task.task_type <> 'deliverable'
     or v_target_task.task_type <> 'deliverable'
     or v_task.status = 'Erledigt'
     or v_target_task.status = 'Erledigt' then
    raise exception using errcode = 'P0003', message = 'backlog tasks must be active deliverables';
  end if;

  if v_task.updated_at is distinct from p_expected_task_updated_at
     or v_target_task.updated_at is distinct from p_expected_target_updated_at then
    raise exception using errcode = 'P0001', message = 'backlog task was changed concurrently';
  end if;

  with remaining as (
    select
      task.id,
      row_number() over (order by task.sort_order, task.id)::integer as position
    from public.tasks as task
    where task.project_id = v_task.project_id
      and task.trashed_at is null
      and task.task_type = 'deliverable'
      and task.status <> 'Erledigt'
      and task.id <> v_task.id
  )
  select case p_placement
    when 'before' then remaining.position
    else remaining.position + 1
  end
  into v_insert_position
  from remaining
  where remaining.id = v_target_task.id;

  if v_insert_position is null then
    raise exception using errcode = 'P0003', message = 'backlog target is not active';
  end if;

  with remaining as (
    select
      task.id,
      row_number() over (order by task.sort_order, task.id)::integer as position
    from public.tasks as task
    where task.project_id = v_task.project_id
      and task.trashed_at is null
      and task.task_type = 'deliverable'
      and task.status <> 'Erledigt'
      and task.id <> v_task.id
  ), positioned as (
    select
      remaining.id,
      case when remaining.position >= v_insert_position then remaining.position + 1 else remaining.position end as position
    from remaining
    union all
    select v_task.id, v_insert_position
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', task.id,
    'sortOrder', task.sort_order,
    'updatedAt', task.updated_at
  ) order by task.sort_order, task.id), '[]'::jsonb)
  into v_before
  from public.tasks as task
  join positioned on positioned.id = task.id
  where task.sort_order is distinct from positioned.position * 10;

  with remaining as (
    select
      task.id,
      row_number() over (order by task.sort_order, task.id)::integer as position
    from public.tasks as task
    where task.project_id = v_task.project_id
      and task.trashed_at is null
      and task.task_type = 'deliverable'
      and task.status <> 'Erledigt'
      and task.id <> v_task.id
  ), positioned as (
    select
      remaining.id,
      case when remaining.position >= v_insert_position then remaining.position + 1 else remaining.position end as position
    from remaining
    union all
    select v_task.id, v_insert_position
  ), updated as (
    update public.tasks as task
    set
      sort_order = positioned.position * 10,
      updated_at = clock_timestamp()
    from positioned
    where task.id = positioned.id
      and task.sort_order is distinct from positioned.position * 10
    returning task.id, task.sort_order, task.updated_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', updated.id,
    'sortOrder', updated.sort_order,
    'updatedAt', updated.updated_at
  ) order by updated.sort_order, updated.id), '[]'::jsonb)
  into v_updates
  from updated;

  if jsonb_array_length(v_updates) > 0 then
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
      'task.backlog_reorder',
      'task',
      'backlog',
      jsonb_build_object('tasks', v_before),
      jsonb_build_object(
        'taskId', v_task.id,
        'targetTaskId', v_target_task.id,
        'placement', p_placement,
        'updates', v_updates
      ),
      p_request_ip,
      p_user_agent
    );
  end if;

  return v_updates;
end;
$$;

ALTER FUNCTION public.move_backlog_task_transaction(text, text, text, timestamptz, timestamptz, text, text, text) OWNER TO postgres;

COMMENT ON FUNCTION public.move_backlog_task_transaction(text, text, text, timestamptz, timestamptz, text, text, text) IS 'Atomically moves one active backlog Deliverable relative to another with compare-and-set timestamps and an audit record.';

REVOKE ALL ON FUNCTION public.move_backlog_task_transaction(text, text, text, timestamptz, timestamptz, text, text, text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.move_backlog_task_transaction(text, text, text, timestamptz, timestamptz, text, text, text) TO service_role;
