alter table public.sprints add column if not exists lock_result jsonb;

create or replace function public.lock_sprint_transaction(
  p_sprint_id text,
  p_expected_updated_at timestamptz,
  p_task_updates jsonb default '[]'::jsonb,
  p_accepted_blocker_task_ids text[] default '{}',
  p_carryover_inserts jsonb default '[]'::jsonb,
  p_notifications jsonb default '[]'::jsonb,
  p_score_rows jsonb default '[]'::jsonb,
  p_strike_state_rows jsonb default '[]'::jsonb,
  p_strike_events jsonb default '[]'::jsonb,
  p_result_data jsonb default '{}'::jsonb,
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
  v_sprint public.sprints%rowtype;
  v_result jsonb;
  v_insert jsonb;
  v_columns text;
  v_values text;
  v_allowed_columns constant text[] := array[
    'acceptance_criteria', 'assignee', 'carryover_count', 'carryover_reason',
    'carried_from_sprint_id', 'carried_from_task_id', 'created_by', 'creation_request_id',
    'deadline', 'definition_of_done', 'description', 'dod_template_version', 'end_date',
    'estimate_hours', 'evidence_link', 'evidence_required', 'github_issue_number',
    'github_issue_url', 'github_repo', 'github_sync_status', 'id', 'intended_outcome',
    'issue_number', 'issue_url', 'milestone_id', 'original_sprint_id', 'owner',
    'package_id', 'parent_task_id', 'priority', 'problem_statement', 'project_id',
    'review_owner_profile_id', 'review_status', 'score_final', 'score_points',
    'score_relevant', 'scope_constraints', 'sort_order', 'sprint_id', 'start_date',
    'status', 'task_type', 'title', 'workstream'
  ];
begin
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'expected sprint update timestamp is required';
  end if;
  if jsonb_typeof(coalesce(p_task_updates, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_carryover_inserts, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_score_rows, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_strike_state_rows, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_strike_events, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'sprint finalization batches must be JSON arrays';
  end if;

  select * into v_sprint
  from public.sprints
  where id = p_sprint_id
  for update;

  if v_sprint.id is null then
    raise exception using errcode = 'P0002', message = 'sprint not found';
  end if;
  if v_sprint.score_locked then
    return coalesce(v_sprint.lock_result, '{}'::jsonb) || jsonb_build_object('replayed', true);
  end if;
  if v_sprint.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'sprint was changed concurrently';
  end if;

  update public.tasks as task
  set score_points = requested.score_points,
      score_final = requested.score_final,
      sprint_outcome = requested.sprint_outcome,
      carryover_reason = requested.carryover_reason,
      github_sync_status = requested.github_sync_status,
      github_sync_error = requested.github_sync_error,
      updated_at = clock_timestamp()
  from jsonb_to_recordset(coalesce(p_task_updates, '[]'::jsonb)) as requested(
    id text,
    score_points integer,
    score_final boolean,
    sprint_outcome text,
    carryover_reason text,
    github_sync_status text,
    github_sync_error text
  )
  where task.id = requested.id
    and task.sprint_id = p_sprint_id;

  update public.task_blockers
  set status = 'accepted_carryover',
      resolved_at = coalesce(resolved_at, clock_timestamp())
  where task_id = any(coalesce(p_accepted_blocker_task_ids, '{}'))
    and status = 'open';

  for v_insert in select value from jsonb_array_elements(coalesce(p_carryover_inserts, '[]'::jsonb))
  loop
    if jsonb_typeof(v_insert) <> 'object' or exists (
      select 1
      from jsonb_object_keys(v_insert) as insert_key
      where not (insert_key = any(v_allowed_columns))
    ) then
      raise exception using errcode = '22023', message = 'carryover task insert is invalid';
    end if;

    select
      string_agg(format('%I', insert_key), ', ' order by insert_key),
      string_agg(
        format('(jsonb_populate_record(null::public.tasks, $1)).%I', insert_key),
        ', '
        order by insert_key
      )
    into v_columns, v_values
    from jsonb_object_keys(v_insert) as insert_key;

    execute format(
      'insert into public.tasks (%s) select %s',
      v_columns,
      v_values
    ) using v_insert;
  end loop;

  insert into public.notification_events (
    type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body
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

  update public.tasks
  set score_points = 0,
      score_final = true,
      sprint_outcome = 'missed_uncommunicated',
      updated_at = clock_timestamp()
  where sprint_id = p_sprint_id
    and score_final = false;

  insert into public.founder_sprint_scores (
    sprint_id, profile_id, delivery_points, form_points, weekly_points, total_points,
    fulfilled, away_neutral, finalized_at, finalized_by, reason_summary
  )
  select
    score.sprint_id, score.profile_id, score.delivery_points, score.form_points,
    score.weekly_points, score.total_points, score.fulfilled, score.away_neutral,
    score.finalized_at, score.finalized_by, score.reason_summary
  from jsonb_to_recordset(coalesce(p_score_rows, '[]'::jsonb)) as score(
    sprint_id text, profile_id text, delivery_points integer, form_points integer,
    weekly_points integer, total_points integer, fulfilled boolean, away_neutral boolean,
    finalized_at timestamptz, finalized_by text, reason_summary text
  )
  on conflict (sprint_id, profile_id) do update
  set delivery_points = excluded.delivery_points,
      form_points = excluded.form_points,
      weekly_points = excluded.weekly_points,
      total_points = excluded.total_points,
      fulfilled = excluded.fulfilled,
      away_neutral = excluded.away_neutral,
      finalized_at = excluded.finalized_at,
      finalized_by = excluded.finalized_by,
      reason_summary = excluded.reason_summary;

  insert into public.founder_strike_state (
    profile_id, strike_level, fulfilled_reset_streak, last_evaluated_sprint_id, updated_at
  )
  select
    state.profile_id, state.strike_level, state.fulfilled_reset_streak,
    state.last_evaluated_sprint_id, state.updated_at
  from jsonb_to_recordset(coalesce(p_strike_state_rows, '[]'::jsonb)) as state(
    profile_id text, strike_level integer, fulfilled_reset_streak integer,
    last_evaluated_sprint_id text, updated_at timestamptz
  )
  on conflict (profile_id) do update
  set strike_level = excluded.strike_level,
      fulfilled_reset_streak = excluded.fulfilled_reset_streak,
      last_evaluated_sprint_id = excluded.last_evaluated_sprint_id,
      updated_at = excluded.updated_at;

  insert into public.strike_events (
    profile_id, sprint_id, event_type, previous_strike_level,
    next_strike_level, reason, created_by
  )
  select
    event.profile_id, event.sprint_id, event.event_type, event.previous_strike_level,
    event.next_strike_level, event.reason, event.created_by
  from jsonb_to_recordset(coalesce(p_strike_events, '[]'::jsonb)) as event(
    profile_id text, sprint_id text, event_type text, previous_strike_level integer,
    next_strike_level integer, reason text, created_by text
  );

  v_result := coalesce(p_result_data, '{}'::jsonb) || jsonb_build_object(
    'sprint', jsonb_build_object('id', p_sprint_id, 'status', 'closed', 'scoreLocked', true),
    'replayed', false
  );

  update public.sprints
  set score_locked = true,
      status = 'closed',
      lock_result = v_result,
      updated_at = clock_timestamp()
  where id = p_sprint_id;

  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id, after_data, request_ip, user_agent
  )
  values (
    p_actor_profile_id, 'sprint.lock_score', 'sprint', p_sprint_id,
    v_result, p_request_ip, p_user_agent
  );

  return v_result;
end;
$$;

revoke all on function public.lock_sprint_transaction(text, timestamptz, jsonb, text[], jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.lock_sprint_transaction(text, timestamptz, jsonb, text[], jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text) to service_role;

comment on function public.lock_sprint_transaction(text, timestamptz, jsonb, text[], jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text)
is 'Atomically finalizes sprint tasks, carryover, scoring, strikes, notifications, audit, and the sprint lock with idempotent replay.';

notify pgrst, 'reload schema';
