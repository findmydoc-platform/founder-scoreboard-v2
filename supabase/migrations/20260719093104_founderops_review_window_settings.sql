alter table public.projects
  add column if not exists review_objection_window_hours integer not null default 48;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_review_objection_window_hours_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_review_objection_window_hours_check
      check (review_objection_window_hours between 1 and 336);
  end if;
end;
$$;

comment on column public.projects.review_objection_window_hours is
  'CEO-managed combined review and score-objection window in exact hours after the sprint day ends in Europe/Berlin.';

revoke update on table public.projects from authenticated;
grant update (id, name, range_label) on table public.projects to authenticated;
revoke insert, update on table public.sprints from authenticated;

create or replace function public.update_founderops_review_window_transaction(
  p_project_id text,
  p_expected_hours integer,
  p_review_objection_window_hours integer,
  p_actor_profile_id text,
  p_request_ip text,
  p_user_agent text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor_role text;
  v_project public.projects%rowtype;
  v_updated_sprints jsonb;
begin
  if p_expected_hours is null
    or p_review_objection_window_hours is null
    or p_review_objection_window_hours not between 1 and 336 then
    raise exception using errcode = '22023', message = 'review and objection window must be between 1 and 336 hours';
  end if;

  select platform_role into v_actor_role
  from public.profiles
  where id = p_actor_profile_id;

  if not found or v_actor_role <> 'ceo' then
    raise exception using errcode = 'P0005', message = 'only CEO may update FounderOps process settings';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('founderops-review-window:' || p_project_id, 0));

  select * into v_project
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;
  if v_project.review_objection_window_hours <> p_expected_hours then
    raise exception using errcode = 'P0001', message = 'FounderOps process settings changed concurrently';
  end if;

  update public.projects
  set review_objection_window_hours = p_review_objection_window_hours
  where id = p_project_id;

  update public.sprints
  set review_due_at = ((end_date::date + time '23:59:59.999') at time zone 'Europe/Berlin')
      + make_interval(hours => p_review_objection_window_hours),
      updated_at = clock_timestamp()
  where project_id = p_project_id
    and score_locked is false
    and end_date is not null;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', sprint.id,
        'reviewDueAt', sprint.review_due_at
      )
      order by sprint.start_date, sprint.id
    ),
    '[]'::jsonb
  ) into v_updated_sprints
  from public.sprints as sprint
  where sprint.project_id = p_project_id
    and sprint.score_locked is false;

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
    'founderops.review_window.update',
    'project',
    p_project_id,
    jsonb_build_object('reviewObjectionWindowHours', v_project.review_objection_window_hours),
    jsonb_build_object('reviewObjectionWindowHours', p_review_objection_window_hours),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'project', jsonb_build_object(
      'id', p_project_id,
      'reviewObjectionWindowHours', p_review_objection_window_hours
    ),
    'sprints', v_updated_sprints
  );
end;
$$;

revoke all on function public.update_founderops_review_window_transaction(text, integer, integer, text, text, text) from public;
grant all on function public.update_founderops_review_window_transaction(text, integer, integer, text, text, text) to service_role;

create or replace function public.create_sprint_plan_with_review_window_transaction(
  p_project_id text,
  p_sprints jsonb,
  p_meetings jsonb,
  p_audit_data jsonb,
  p_actor_profile_id text,
  p_request_ip text,
  p_user_agent text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_window_hours integer;
  v_sprint jsonb;
  v_end_date date;
  v_review_due_at timestamptz;
  v_adjusted_sprints jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_sprints) <> 'array' or jsonb_array_length(p_sprints) = 0 then
    raise exception using errcode = '22023', message = 'sprint plan must contain at least one sprint';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('founderops-review-window:' || p_project_id, 0));

  select review_objection_window_hours into v_window_hours
  from public.projects
  where id = p_project_id
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  for v_sprint in select value from jsonb_array_elements(p_sprints)
  loop
    if nullif(trim(v_sprint->>'project_id'), '') is distinct from p_project_id then
      raise exception using errcode = '22023', message = 'sprint project does not match process settings project';
    end if;
    v_end_date := nullif(v_sprint->>'end_date', '')::date;
    if v_end_date is null then
      raise exception using errcode = '22023', message = 'sprint end date is required';
    end if;
    v_review_due_at := ((v_end_date + time '23:59:59.999') at time zone 'Europe/Berlin')
      + make_interval(hours => v_window_hours);
    v_adjusted_sprints := v_adjusted_sprints || jsonb_build_array(
      jsonb_set(v_sprint, '{review_due_at}', to_jsonb(v_review_due_at), true)
    );
  end loop;

  return public.create_sprint_plan_transaction(
    v_adjusted_sprints,
    coalesce(p_meetings, '[]'::jsonb),
    coalesce(p_audit_data, '{}'::jsonb) || jsonb_build_object('reviewObjectionWindowHours', v_window_hours),
    p_actor_profile_id,
    p_request_ip,
    p_user_agent
  );
end;
$$;

revoke all on function public.create_sprint_plan_with_review_window_transaction(text, jsonb, jsonb, jsonb, text, text, text) from public;
grant all on function public.create_sprint_plan_with_review_window_transaction(text, jsonb, jsonb, jsonb, text, text, text) to service_role;

create or replace function public.update_sprint_schedule_transaction(
  p_sprint_id text,
  p_expected_updated_at timestamptz,
  p_sprint_patch jsonb,
  p_actor_profile_id text,
  p_request_ip text,
  p_user_agent text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_project_id text;
  v_window_hours integer;
  v_sprint public.sprints%rowtype;
  v_updated public.sprints%rowtype;
  v_before jsonb;
  v_next_name text;
  v_next_status text;
  v_next_start_date date;
  v_next_end_date date;
  v_next_review_due_at timestamptz;
  v_timeline_changed boolean;
begin
  if p_expected_updated_at is null or jsonb_typeof(coalesce(p_sprint_patch, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'expected sprint revision and patch are required';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(coalesce(p_sprint_patch, '{}'::jsonb)) as patch_key
    where patch_key not in ('name', 'status', 'start_date', 'end_date')
  ) then
    raise exception using errcode = '22023', message = 'sprint patch contains unsupported fields';
  end if;

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
    raise exception using errcode = 'P0003', message = 'locked sprint cannot be changed';
  end if;
  if v_sprint.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'sprint changed concurrently';
  end if;

  v_next_name := case when p_sprint_patch ? 'name' then nullif(trim(p_sprint_patch->>'name'), '') else v_sprint.name end;
  v_next_status := case when p_sprint_patch ? 'status' then nullif(p_sprint_patch->>'status', '') else v_sprint.status end;
  v_next_start_date := case when p_sprint_patch ? 'start_date' then nullif(p_sprint_patch->>'start_date', '')::date else v_sprint.start_date end;
  v_next_end_date := case when p_sprint_patch ? 'end_date' then nullif(p_sprint_patch->>'end_date', '')::date else v_sprint.end_date end;

  if v_next_name is null or v_next_status not in ('planning', 'active', 'review', 'closed') then
    raise exception using errcode = '22023', message = 'sprint name or status is invalid';
  end if;
  if v_next_start_date is not null and v_next_end_date is not null and v_next_start_date > v_next_end_date then
    raise exception using errcode = '22023', message = 'sprint start must not be after sprint end';
  end if;

  v_timeline_changed := v_next_name is distinct from v_sprint.name
    or v_next_start_date is distinct from v_sprint.start_date
    or v_next_end_date is distinct from v_sprint.end_date;
  if v_timeline_changed and exists (select 1 from public.tasks where sprint_id = p_sprint_id) then
    raise exception using errcode = 'P0004', message = 'sprint timeline is protected by assigned tasks';
  end if;

  v_next_review_due_at := case
    when v_next_end_date is null then null
    else ((v_next_end_date + time '23:59:59.999') at time zone 'Europe/Berlin')
      + make_interval(hours => v_window_hours)
  end;
  v_before := to_jsonb(v_sprint);

  update public.sprints
  set name = v_next_name,
      status = v_next_status,
      start_date = v_next_start_date,
      end_date = v_next_end_date,
      review_due_at = v_next_review_due_at,
      updated_at = clock_timestamp()
  where id = p_sprint_id
  returning * into v_updated;

  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id, before_data, after_data, request_ip, user_agent
  ) values (
    p_actor_profile_id, 'sprint.update', 'sprint', p_sprint_id,
    v_before, to_jsonb(v_updated), p_request_ip, p_user_agent
  );

  return to_jsonb(v_updated);
end;
$$;

revoke all on function public.update_sprint_schedule_transaction(text, timestamptz, jsonb, text, text, text) from public;
grant all on function public.update_sprint_schedule_transaction(text, timestamptz, jsonb, text, text, text) to service_role;

create or replace function public.create_score_objection_transaction(
  p_sprint_id text,
  p_profile_id text,
  p_comment text,
  p_request_ip text,
  p_user_agent text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_project_id text;
  v_window_hours integer;
  v_actor_role text;
  v_sprint public.sprints%rowtype;
  v_sprint_end timestamptz;
  v_review_due_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_score_id bigint;
  v_objection public.score_objections%rowtype;
begin
  if nullif(trim(coalesce(p_comment, '')), '') is null then
    raise exception using errcode = '22023', message = 'score objection comment is required';
  end if;

  select platform_role into v_actor_role
  from public.profiles
  where id = p_profile_id;
  if not found or v_actor_role not in ('ceo', 'founder', 'deputy') then
    raise exception using errcode = 'P0005', message = 'contributor profile is required';
  end if;

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
    raise exception using errcode = 'P0003', message = 'sprint score is locked';
  end if;
  if v_sprint.end_date is null then
    raise exception using errcode = '22023', message = 'sprint end date is required';
  end if;

  v_sprint_end := ((v_sprint.end_date + time '23:59:59.999') at time zone 'Europe/Berlin');
  v_review_due_at := coalesce(
    v_sprint.review_due_at,
    v_sprint_end + make_interval(hours => v_window_hours)
  );
  if v_now <= v_sprint_end then
    raise exception using errcode = 'P0004', message = 'score objection window has not started';
  end if;
  if v_now > v_review_due_at then
    raise exception using errcode = 'P0006', message = 'score objection window has expired';
  end if;

  select id into v_score_id
  from public.founder_sprint_scores
  where sprint_id = p_sprint_id and profile_id = p_profile_id;

  insert into public.score_objections (
    sprint_id, profile_id, founder_sprint_score_id, status, comment
  ) values (
    p_sprint_id, p_profile_id, v_score_id, 'open', trim(p_comment)
  ) returning * into v_objection;

  insert into public.audit_log (
    entity_type, entity_id, action, actor_profile_id, after_data, request_ip, user_agent
  ) values (
    'score_objection', v_objection.id::text, 'score_objection.create', p_profile_id,
    to_jsonb(v_objection), p_request_ip, p_user_agent
  );

  return to_jsonb(v_objection);
end;
$$;

revoke all on function public.create_score_objection_transaction(text, text, text, text, text) from public;
grant all on function public.create_score_objection_transaction(text, text, text, text, text) to service_role;

create or replace function public.lock_sprint_with_review_window_transaction(
  p_sprint_id text,
  p_expected_updated_at timestamptz,
  p_task_updates jsonb,
  p_accepted_blocker_task_ids text[],
  p_carryover_inserts jsonb,
  p_notifications jsonb,
  p_score_rows jsonb,
  p_strike_state_rows jsonb,
  p_strike_events jsonb,
  p_result_data jsonb,
  p_actor_profile_id text,
  p_request_ip text,
  p_user_agent text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_project_id text;
  v_window_hours integer;
  v_review_due_at timestamptz;
  v_sprint public.sprints%rowtype;
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
      p_strike_events, p_result_data, p_actor_profile_id, p_request_ip, p_user_agent
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

  return public.lock_sprint_transaction(
    p_sprint_id, p_expected_updated_at, p_task_updates, p_accepted_blocker_task_ids,
    p_carryover_inserts, p_notifications, p_score_rows, p_strike_state_rows,
    p_strike_events, p_result_data, p_actor_profile_id, p_request_ip, p_user_agent
  );
end;
$$;

revoke all on function public.lock_sprint_with_review_window_transaction(text, timestamptz, jsonb, text[], jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text) from public;
grant all on function public.lock_sprint_with_review_window_transaction(text, timestamptz, jsonb, text[], jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text) to service_role;
