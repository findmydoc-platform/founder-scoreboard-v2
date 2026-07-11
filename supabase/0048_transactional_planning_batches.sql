create or replace function public.update_backlog_order_transaction(
  p_updates jsonb,
  p_actor_profile_id text default null,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected_count integer;
  v_locked_count integer;
  v_before jsonb;
  v_updates jsonb;
begin
  if jsonb_typeof(p_updates) <> 'array' or jsonb_array_length(p_updates) = 0 or jsonb_array_length(p_updates) > 250 then
    raise exception using errcode = '22023', message = 'backlog updates must be a non-empty array with at most 250 entries';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_updates) as item
    where jsonb_typeof(item) <> 'object'
      or nullif(trim(item->>'id'), '') is null
      or case
        when coalesce(item->>'sortOrder', '') ~ '^\d{1,10}$'
          then (item->>'sortOrder')::numeric > 2147483647
        else true
      end
      or nullif(trim(item->>'expectedUpdatedAt'), '') is null
  ) then
    raise exception using errcode = '22023', message = 'backlog update entry is invalid';
  end if;

  select count(*) into v_expected_count from jsonb_array_elements(p_updates);
  if (
    select count(distinct item->>'id')
    from jsonb_array_elements(p_updates) as item
  ) <> v_expected_count then
    raise exception using errcode = '22023', message = 'backlog updates contain duplicate tasks';
  end if;

  perform 1
  from public.tasks as task
  join jsonb_to_recordset(p_updates) as requested(id text, "expectedUpdatedAt" timestamptz)
    on requested.id = task.id
  order by task.id
  for update of task;
  get diagnostics v_locked_count = row_count;

  if v_locked_count <> v_expected_count then
    raise exception using errcode = 'P0002', message = 'at least one task was not found';
  end if;

  if exists (
    select 1
    from public.tasks as task
    join jsonb_to_recordset(p_updates) as requested(id text, "expectedUpdatedAt" timestamptz)
      on requested.id = task.id
    where task.updated_at <> requested."expectedUpdatedAt"
  ) then
    raise exception using errcode = 'P0001', message = 'at least one task was changed concurrently';
  end if;

  select jsonb_agg(jsonb_build_object(
    'id', task.id,
    'sortOrder', task.sort_order,
    'updatedAt', task.updated_at
  ) order by task.id)
  into v_before
  from public.tasks as task
  join jsonb_to_recordset(p_updates) as requested(id text) on requested.id = task.id;

  with updated as (
    update public.tasks as task
    set sort_order = requested."sortOrder",
        updated_at = clock_timestamp()
    from jsonb_to_recordset(p_updates) as requested(id text, "sortOrder" integer)
    where task.id = requested.id
    returning task.id, task.sort_order, task.updated_at
  )
  select jsonb_agg(jsonb_build_object(
    'id', updated.id,
    'sortOrder', updated.sort_order,
    'updatedAt', updated.updated_at
  ) order by updated.sort_order, updated.id)
  into v_updates
  from updated;

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    request_ip,
    user_agent
  )
  values (
    p_actor_profile_id,
    'task.backlog_reorder',
    'task',
    'backlog',
    jsonb_build_object('tasks', coalesce(v_before, '[]'::jsonb)),
    jsonb_build_object('updates', coalesce(v_updates, '[]'::jsonb)),
    p_request_ip,
    p_user_agent
  );

  return coalesce(v_updates, '[]'::jsonb);
end;
$$;

create or replace function public.create_sprint_plan_transaction(
  p_sprints jsonb,
  p_meetings jsonb default '[]'::jsonb,
  p_audit_data jsonb default '{}'::jsonb,
  p_actor_profile_id text default null,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sprint jsonb;
  v_row jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_expected_updated_at timestamptz;
begin
  if jsonb_typeof(p_sprints) <> 'array' or jsonb_array_length(p_sprints) = 0 then
    raise exception using errcode = '22023', message = 'sprint plan must contain at least one sprint';
  end if;
  if jsonb_typeof(coalesce(p_meetings, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'sprint meetings must be a JSON array';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sprint-plan', 0));

  for v_sprint in select value from jsonb_array_elements(p_sprints)
  loop
    if nullif(trim(v_sprint->>'id'), '') is null then
      raise exception using errcode = '22023', message = 'sprint id is required';
    end if;
    v_expected_updated_at := nullif(v_sprint->>'expected_updated_at', '')::timestamptz;
    v_row := null;

    if v_expected_updated_at is null then
      insert into public.sprints (
        id,
        project_id,
        name,
        status,
        start_date,
        end_date,
        review_due_at,
        score_locked
      )
      values (
        v_sprint->>'id',
        v_sprint->>'project_id',
        v_sprint->>'name',
        v_sprint->>'status',
        nullif(v_sprint->>'start_date', '')::date,
        nullif(v_sprint->>'end_date', '')::date,
        nullif(v_sprint->>'review_due_at', '')::timestamptz,
        coalesce((v_sprint->>'score_locked')::boolean, false)
      )
      on conflict (id) do nothing
      returning to_jsonb(sprints) into v_row;
    else
      update public.sprints as sprint
      set name = v_sprint->>'name',
          status = v_sprint->>'status',
          start_date = nullif(v_sprint->>'start_date', '')::date,
          end_date = nullif(v_sprint->>'end_date', '')::date,
          review_due_at = nullif(v_sprint->>'review_due_at', '')::timestamptz,
          updated_at = clock_timestamp()
      where sprint.id = v_sprint->>'id'
        and sprint.updated_at = v_expected_updated_at
        and not sprint.score_locked
        and not exists (select 1 from public.tasks where sprint_id = sprint.id)
      returning to_jsonb(sprint) into v_row;
    end if;

    if v_row is null then
      raise exception using errcode = 'P0001', message = 'sprint plan changed concurrently or contains a protected sprint';
    end if;
    v_rows := v_rows || jsonb_build_array(v_row);
  end loop;

  insert into public.meetings (
    sprint_id,
    title,
    meeting_at,
    duration_minutes,
    status,
    agenda
  )
  select
    meeting.sprint_id,
    meeting.title,
    meeting.meeting_at,
    meeting.duration_minutes,
    meeting.status,
    meeting.agenda
  from jsonb_to_recordset(coalesce(p_meetings, '[]'::jsonb)) as meeting(
    sprint_id text,
    title text,
    meeting_at timestamptz,
    duration_minutes integer,
    status text,
    agenda text
  )
  where not exists (
    select 1
    from public.meetings as existing
    where existing.sprint_id = meeting.sprint_id
      and lower(existing.title) = lower(meeting.title)
  );

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    after_data,
    request_ip,
    user_agent
  )
  values (
    p_actor_profile_id,
    'sprint.plan_create',
    'sprint',
    'bulk',
    coalesce(p_audit_data, '{}'::jsonb) || jsonb_build_object('upserted', jsonb_array_length(v_rows)),
    p_request_ip,
    p_user_agent
  );

  return v_rows;
end;
$$;

revoke all on function public.update_backlog_order_transaction(jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.create_sprint_plan_transaction(jsonb, jsonb, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.update_backlog_order_transaction(jsonb, text, text, text) to service_role;
grant execute on function public.create_sprint_plan_transaction(jsonb, jsonb, jsonb, text, text, text) to service_role;

comment on function public.update_backlog_order_transaction(jsonb, text, text, text)
is 'Atomically applies a compare-and-set backlog reorder and its audit record.';

comment on function public.create_sprint_plan_transaction(jsonb, jsonb, jsonb, text, text, text)
is 'Atomically creates or updates an optimistic sprint plan with its weekly meetings and audit record.';

notify pgrst, 'reload schema';
