-- Preserve existing actors, effects and function grants. Optional target revisions
-- are checked while holding the same Sprint lock used by scheduling changes.

create or replace function public.update_browser_planning_task_transaction_v2(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_task_patch jsonb,
  p_note_present boolean,
  p_note text,
  p_dependency_present boolean,
  p_dependency_note text,
  p_activity_messages text[],
  p_notifications jsonb,
  p_actor_profile_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_task_patch jsonb := p_task_patch;
  v_target_updated_at timestamptz;
begin
  if v_task_patch ? '__expected_sprint_updated_at' then
    if jsonb_typeof(v_task_patch->'__expected_sprint_updated_at') is distinct from 'string'
       or nullif(btrim(v_task_patch->>'__expected_sprint_updated_at'), '') is null
       or nullif(btrim(v_task_patch->>'sprint_id'), '') is null then
      raise exception using errcode = '22023', message = 'expected target sprint revision requires a target sprint';
    end if;
    select sprint.updated_at into v_target_updated_at
    from public.sprints sprint
    where sprint.id = btrim(v_task_patch->>'sprint_id')
    for share;
    if not found then
      raise exception using errcode = 'P0015', message = 'target sprint is unavailable or locked';
    end if;
    if v_target_updated_at is distinct from (v_task_patch->>'__expected_sprint_updated_at')::timestamptz then
      raise exception using errcode = 'P0018', message = 'target sprint was changed concurrently';
    end if;
    v_task_patch := v_task_patch - '__expected_sprint_updated_at';
  end if;

  v_result := public.update_browser_planning_task_transaction(
    p_task_id,
    p_expected_updated_at,
    v_task_patch,
    p_note_present,
    p_note,
    p_dependency_present,
    p_dependency_note,
    p_activity_messages,
    '[]'::jsonb,
    p_actor_profile_id
  );

  insert into public.notification_events (
    type,
    actor_profile_id,
    recipient_profile_id,
    entity_type,
    entity_id,
    title,
    body,
    dedupe_key,
    target_path
  )
  select
    notification.type,
    notification.actor_profile_id,
    notification.recipient_profile_id,
    notification.entity_type,
    notification.entity_id,
    notification.title,
    notification.body,
    notification.dedupe_key,
    notification.target_path
  from jsonb_to_recordset(coalesce(p_notifications, '[]'::jsonb)) as notification(
    type text,
    actor_profile_id text,
    recipient_profile_id text,
    entity_type text,
    entity_id text,
    title text,
    body text,
    dedupe_key text,
    target_path text
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  return v_result;
end;
$$;

create or replace function public.update_administrator_planning_task_transaction_v2(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_task_patch jsonb,
  p_note_present boolean,
  p_note text,
  p_dependency_present boolean,
  p_dependency_note text,
  p_activity_messages text[],
  p_notifications jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_profile_id text;
  v_result jsonb;
  v_task_patch jsonb := p_task_patch;
  v_target_updated_at timestamptz;
  v_notifications jsonb;
begin
  v_actor_profile_id := public.require_active_administrator_profile();

  if v_task_patch ? '__expected_sprint_updated_at' then
    if jsonb_typeof(v_task_patch->'__expected_sprint_updated_at') is distinct from 'string'
       or nullif(btrim(v_task_patch->>'__expected_sprint_updated_at'), '') is null
       or nullif(btrim(v_task_patch->>'sprint_id'), '') is null then
      raise exception using errcode = '22023', message = 'expected target sprint revision requires a target sprint';
    end if;
    select sprint.updated_at into v_target_updated_at
    from public.sprints sprint
    where sprint.id = btrim(v_task_patch->>'sprint_id')
    for share;
    if not found then
      raise exception using errcode = 'P0015', message = 'target sprint is unavailable or locked';
    end if;
    if v_target_updated_at is distinct from (v_task_patch->>'__expected_sprint_updated_at')::timestamptz then
      raise exception using errcode = 'P0018', message = 'target sprint was changed concurrently';
    end if;
    v_task_patch := v_task_patch - '__expected_sprint_updated_at';
  end if;

  v_result := public.update_administrator_planning_task_transaction(
    p_task_id,
    p_expected_updated_at,
    v_task_patch,
    p_note_present,
    p_note,
    p_dependency_present,
    p_dependency_note,
    p_activity_messages,
    '[]'::jsonb
  );
  v_notifications := public.canonicalize_administrator_task_mention_notifications(
    p_notifications,
    p_task_id,
    v_actor_profile_id
  );
  perform public.insert_task_mention_notifications(v_notifications);
  return v_result;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."assign_backlog_tasks_to_sprint_transaction"("p_assignments" "jsonb", "p_sprint_id" "text", "p_actor_profile_id" "text" DEFAULT NULL::"text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_assignment jsonb;
  v_assignment_count integer;
  v_task_ids text[];
  v_actor_role text;
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

  select profile.platform_role into v_actor_role
  from public.profiles as profile
  where profile.id = nullif(trim(coalesce(p_actor_profile_id, '')), '');
  if not found or v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0015', message = 'sprint assignment requires ceo or deputy';
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

  if exists (
    select 1 from jsonb_array_elements(p_assignments) assignment(value)
    where assignment.value ? 'expectedSprintUpdatedAt'
      and (jsonb_typeof(assignment.value->'expectedSprintUpdatedAt') is distinct from 'string'
        or nullif(btrim(assignment.value->>'expectedSprintUpdatedAt'), '') is null)
  ) then
    raise exception using errcode = '22023', message = 'expected target sprint revision is invalid';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_assignments) assignment(value)
    where assignment.value ? 'expectedSprintUpdatedAt'
      and (assignment.value->>'expectedSprintUpdatedAt')::timestamptz is distinct from v_target_sprint.updated_at
  ) then
    raise exception using errcode = 'P0018', message = 'target sprint was changed concurrently';
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
