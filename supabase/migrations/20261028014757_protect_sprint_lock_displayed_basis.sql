-- Preserve the existing action, receipt, role grants and scheduling policy.
CREATE OR REPLACE FUNCTION "public"."lock_sprint_with_review_window_transaction"("p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_updates" "jsonb", "p_accepted_blocker_task_ids" "text"[], "p_carryover_inserts" "jsonb", "p_notifications" "jsonb", "p_score_rows" "jsonb", "p_strike_state_rows" "jsonb", "p_strike_events" "jsonb", "p_result_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_project_id text;
  v_window_hours integer;
  v_review_due_at timestamptz;
  v_sprint public.sprints%rowtype;
  v_basis jsonb := p_result_data->'_planning_lock_basis';
  v_result_data jsonb := coalesce(p_result_data, '{}'::jsonb) - '_planning_lock_basis';
begin
  select project_id into v_project_id
  from public.sprints
  where id = p_sprint_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'sprint not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('founderops-review-window:' || v_project_id, 0));

  select review_objection_window_hours into v_window_hours
  from public.projects
  where id = v_project_id
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  select * into v_sprint
  from public.sprints
  where id = p_sprint_id and project_id = v_project_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'sprint not found';
  end if;
  if v_sprint.score_locked then
    return public.lock_sprint_transaction(
      p_sprint_id, p_expected_updated_at, p_task_updates, p_accepted_blocker_task_ids,
      p_carryover_inserts, p_notifications, p_score_rows, p_strike_state_rows,
      p_strike_events, v_result_data, p_actor_profile_id, p_request_ip, p_user_agent
    );
  end if;
  if v_sprint.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'sprint was changed concurrently';
  end if;
  if v_sprint.end_date is null then
    raise exception using errcode = '22023', message = 'sprint end date is required';
  end if;
  v_review_due_at := coalesce(
    v_sprint.review_due_at,
    ((v_sprint.end_date + time '23:59:59.999') at time zone 'Europe/Berlin')
      + make_interval(hours => v_window_hours)
  );
  if v_review_due_at > clock_timestamp() then
    raise exception using errcode = 'P0006', message = 'review and objection window is still open';
  end if;
  if exists (
    select 1
    from public.score_objections
    where sprint_id = p_sprint_id
      and (status = 'open' or (second_reviewer_profile_id is not null and second_reviewed_at is null))
  ) then
    raise exception using errcode = 'P0004', message = 'score objections are still unresolved';
  end if;

  if v_basis is not null then
    if jsonb_typeof(v_basis) <> 'array' or exists (
      select 1 from jsonb_array_elements(v_basis) expected
      where jsonb_typeof(expected) <> 'object'
        or nullif(expected->>'id', '') is null
        or nullif(expected->>'updatedAt', '') is null
    ) or (select count(*) from jsonb_array_elements(v_basis)) <>
      (select count(distinct expected->>'id') from jsonb_array_elements(v_basis) expected) then
      raise exception using errcode = '22023', message = 'displayed sprint task basis is invalid';
    end if;

    -- Supported membership admission locks the target Sprint FOR SHARE first.
    -- Lock every current task, including trash, before checking active membership.
    perform 1 from public.tasks task
    where task.sprint_id = p_sprint_id
    order by task.id
    for update;

    if exists (
      select 1
      from (select id, updated_at from public.active_tasks where sprint_id = p_sprint_id) current_task
      full join jsonb_to_recordset(v_basis) expected(id text, "updatedAt" timestamptz)
        on current_task.id = expected.id
      where current_task.id is null or expected.id is null
        or current_task.updated_at is distinct from expected."updatedAt"
    ) then
      raise exception using errcode = 'P0007', message = 'displayed sprint tasks changed concurrently';
    end if;
  end if;

  return public.lock_sprint_transaction(
    p_sprint_id, p_expected_updated_at, p_task_updates, p_accepted_blocker_task_ids,
    p_carryover_inserts, p_notifications, p_score_rows, p_strike_state_rows,
    p_strike_events, v_result_data, p_actor_profile_id, p_request_ip, p_user_agent
  );
end;
$$;


