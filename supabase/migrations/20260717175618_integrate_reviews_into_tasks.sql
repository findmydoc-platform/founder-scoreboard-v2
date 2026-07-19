update public.tasks
set
  status = 'Erledigt',
  score_final = true,
  github_issue_sync_status = 'not_synced',
  github_issue_sync_error = null,
  updated_at = clock_timestamp()
where review_status = 'accepted'
  and (status is distinct from 'Erledigt' or score_final is false)
  and trashed_at is null;

update public.tasks
set
  status = 'Nacharbeit',
  score_points = case
    when review_status = 'changes_requested' then 0
    else greatest(0, least(10, coalesce(score_points, 0)))
  end,
  score_final = false,
  github_issue_sync_status = 'not_synced',
  github_issue_sync_error = null,
  updated_at = clock_timestamp()
where review_status in ('partial', 'changes_requested')
  and (
    status is distinct from 'Nacharbeit'
    or score_final is true
    or (review_status = 'changes_requested' and score_points is distinct from 0)
  )
  and trashed_at is null;

update public.tasks as task
set
  status = 'Review',
  score_points = 0,
  score_final = false,
  github_issue_sync_status = 'not_synced',
  github_issue_sync_error = null,
  updated_at = clock_timestamp()
where task.review_status = 'requested'
  and (
    task.sprint_id is null
    or not exists (
      select 1
      from public.sprints as sprint
      where sprint.id = task.sprint_id
        and sprint.score_locked is true
    )
  )
  and (task.status is distinct from 'Review' or task.score_final is true or task.score_points is distinct from 0)
  and task.trashed_at is null;

update public.profile_ui_preferences
set
  default_workspace = 'planning',
  updated_at = clock_timestamp()
where default_workspace = 'reviews';

update public.sprints
set
  review_due_at = ((end_date::date + time '23:59:59.999') at time zone 'Europe/Berlin') + interval '48 hours',
  updated_at = clock_timestamp()
where score_locked is false
  and end_date is not null
  and review_due_at is distinct from ((end_date::date + time '23:59:59.999') at time zone 'Europe/Berlin') + interval '48 hours';

revoke insert on table public.task_reviews from authenticated;
revoke insert, update on table public.score_objections from authenticated;

create or replace function public.review_task_transaction(
  p_task_id text,
  p_sprint_id text,
  p_expected_updated_at timestamptz,
  p_task_patch jsonb,
  p_reviewer_profile_id text,
  p_decision text,
  p_points integer,
  p_comment text,
  p_checklist jsonb,
  p_activity_message text,
  p_notifications jsonb,
  p_audit_after_data jsonb,
  p_request_ip text,
  p_user_agent text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sprint_locked boolean;
  v_task public.tasks%rowtype;
  v_update_result jsonb;
  v_review jsonb;
  v_checked_count integer;
  v_expected_points integer;
  v_status text;
  v_score_final boolean;
  v_patch jsonb;
begin
  if p_expected_updated_at is null or p_reviewer_profile_id is null then
    raise exception using errcode = '22023', message = 'review revision and reviewer are required';
  end if;
  if p_decision not in ('accepted', 'partial', 'changes_requested') then
    raise exception using errcode = '22023', message = 'invalid review decision';
  end if;
  if jsonb_typeof(coalesce(p_checklist, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'review checklist must be a JSON object';
  end if;
  if jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'review notifications must be a JSON array';
  end if;

  if p_sprint_id is not null then
    select score_locked into v_sprint_locked
    from public.sprints
    where id = p_sprint_id
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'sprint not found';
    end if;
    if v_sprint_locked then
      raise exception using errcode = 'P0003', message = 'sprint score is locked';
    end if;
  end if;

  select * into v_task
  from public.tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
  if v_task.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'task was changed concurrently';
  end if;
  if v_task.sprint_id is distinct from p_sprint_id then
    raise exception using errcode = '22023', message = 'task sprint changed during review';
  end if;
  if v_task.status <> 'Review' or v_task.review_status <> 'requested' or v_task.score_final then
    raise exception using errcode = 'P0004', message = 'task is not in active review';
  end if;

  v_checked_count :=
    case when coalesce(p_checklist->'acceptanceCriteriaMet', p_checklist->'dodMet', 'false'::jsonb) = 'true'::jsonb then 1 else 0 end
    + case when coalesce(p_checklist->'evidenceProvided', 'false'::jsonb) = 'true'::jsonb then 1 else 0 end
    + case when coalesce(p_checklist->'communicationClear', 'false'::jsonb) = 'true'::jsonb then 1 else 0 end
    + case when coalesce(p_checklist->'blockerHandled', 'false'::jsonb) = 'true'::jsonb then 1 else 0 end;
  v_expected_points := round((v_checked_count::numeric / 4) * 10)::integer;

  if p_decision = 'accepted' then
    if v_checked_count <> 4 or p_points <> 10 then
      raise exception using errcode = '22023', message = 'accepted review requires four checks and ten points';
    end if;
    v_status := 'Erledigt';
    v_score_final := true;
  elsif p_decision = 'partial' then
    if v_checked_count not between 1 and 3 or p_points <> v_expected_points then
      raise exception using errcode = '22023', message = 'partial review requires one to three checks and derived points';
    end if;
    if nullif(trim(coalesce(p_comment, '')), '') is null then
      raise exception using errcode = '22023', message = 'partial review comment is required';
    end if;
    v_status := 'Nacharbeit';
    v_score_final := false;
  else
    if p_points <> 0 or nullif(trim(coalesce(p_comment, '')), '') is null then
      raise exception using errcode = '22023', message = 'rework requires zero points and a comment';
    end if;
    v_status := 'Nacharbeit';
    v_score_final := false;
  end if;

  v_patch := jsonb_build_object(
    'status', v_status,
    'review_status', p_decision,
    'score_points', case when p_decision = 'changes_requested' then 0 else v_expected_points end,
    'score_final', v_score_final,
    'review_requested_at', null,
    'github_issue_sync_status', 'not_synced',
    'github_issue_sync_error', null
  );

  v_update_result := public.update_task_transaction(
    p_task_id,
    p_expected_updated_at,
    v_patch,
    false,
    null,
    false,
    null,
    array[p_activity_message],
    coalesce(p_notifications, '[]'::jsonb)
  );

  insert into public.task_reviews (
    task_id,
    sprint_id,
    reviewer_profile_id,
    decision,
    points,
    comment,
    checklist
  ) values (
    p_task_id,
    p_sprint_id,
    p_reviewer_profile_id,
    p_decision,
    case when p_decision = 'changes_requested' then 0 else v_expected_points end,
    trim(coalesce(p_comment, '')),
    coalesce(p_checklist, '{}'::jsonb)
  ) returning to_jsonb(task_reviews) into v_review;

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
    p_reviewer_profile_id,
    'task.review',
    'task',
    p_task_id,
    jsonb_build_object('status', v_task.status, 'reviewStatus', v_task.review_status, 'scorePoints', v_task.score_points, 'scoreFinal', v_task.score_final),
    coalesce(p_audit_after_data, '{}'::jsonb) || jsonb_build_object('status', v_status, 'scoreFinal', v_score_final, 'points', case when p_decision = 'changes_requested' then 0 else v_expected_points end),
    p_request_ip,
    p_user_agent
  );

  return v_update_result || jsonb_build_object('review', v_review);
end;
$$;

create or replace function public.transition_task_review_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_action text,
  p_actor_profile_id text,
  p_reason text,
  p_activity_message text,
  p_notifications jsonb,
  p_audit_after_data jsonb,
  p_request_ip text,
  p_user_agent text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_task public.tasks%rowtype;
  v_patch jsonb;
  v_result jsonb;
begin
  if p_expected_updated_at is null or p_action not in ('withdraw', 'reopen') then
    raise exception using errcode = '22023', message = 'invalid review transition';
  end if;
  if jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'review notifications must be a JSON array';
  end if;

  select * into v_task
  from public.tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
  if v_task.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'task was changed concurrently';
  end if;

  if p_action = 'withdraw' then
    if v_task.review_status <> 'requested' or v_task.score_final then
      raise exception using errcode = 'P0004', message = 'review is not active';
    end if;
    if nullif(trim(coalesce(p_reason, '')), '') is null then
      raise exception using errcode = '22023', message = 'withdraw reason is required';
    end if;
    v_patch := jsonb_build_object(
      'status', 'In Arbeit',
      'review_status', 'not_requested',
      'score_points', 0,
      'score_final', false,
      'review_requested_at', null,
      'github_issue_sync_status', 'not_synced',
      'github_issue_sync_error', null
    );
  else
    if v_task.review_status <> 'accepted' or not v_task.score_final then
      raise exception using errcode = 'P0004', message = 'only a final accepted review may be reopened';
    end if;
    if v_task.review_owner_profile_id is null then
      raise exception using errcode = '22023', message = 'review owner is required';
    end if;
    v_patch := jsonb_build_object(
      'status', 'Review',
      'review_status', 'requested',
      'score_points', 0,
      'score_final', false,
      'review_requested_at', clock_timestamp(),
      'github_issue_sync_status', 'not_synced',
      'github_issue_sync_error', null
    );
  end if;

  v_result := public.update_task_transaction(
    p_task_id,
    p_expected_updated_at,
    v_patch,
    false,
    null,
    false,
    null,
    array[p_activity_message],
    coalesce(p_notifications, '[]'::jsonb)
  );

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
    case when p_action = 'withdraw' then 'task.review.withdraw' else 'task.review.reopen' end,
    'task',
    p_task_id,
    jsonb_build_object('status', v_task.status, 'reviewStatus', v_task.review_status, 'scorePoints', v_task.score_points, 'scoreFinal', v_task.score_final),
    coalesce(p_audit_after_data, '{}'::jsonb),
    p_request_ip,
    p_user_agent
  );

  return v_result;
end;
$$;

create or replace function public.process_score_objection_transaction(
  p_sprint_id text,
  p_objection_id bigint,
  p_actor_profile_id text,
  p_action text,
  p_status text,
  p_resolution_comment text,
  p_delivery_points integer,
  p_form_points integer,
  p_weekly_points integer,
  p_second_reviewer_profile_id text,
  p_second_review_decision text,
  p_request_ip text,
  p_user_agent text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sprint_locked boolean;
  v_objection public.score_objections%rowtype;
  v_before jsonb;
  v_score jsonb := null;
  v_score_id bigint;
  v_total integer;
  v_actor_role text;
  v_second_reviewer_role text;
begin
  select score_locked into v_sprint_locked
  from public.sprints
  where id = p_sprint_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'sprint not found';
  end if;
  if v_sprint_locked then
    raise exception using errcode = 'P0003', message = 'sprint score is locked';
  end if;

  select platform_role into v_actor_role
  from public.profiles
  where id = p_actor_profile_id;
  if not found or v_actor_role not in ('ceo', 'founder', 'deputy') then
    raise exception using errcode = 'P0005', message = 'contributor profile is required';
  end if;

  select * into v_objection
  from public.score_objections
  where id = p_objection_id and sprint_id = p_sprint_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'score objection not found';
  end if;
  v_before := to_jsonb(v_objection);

  if p_action = 'assign_second_review' then
    if v_actor_role <> 'ceo' then
      raise exception using errcode = 'P0005', message = 'only CEO may assign second review';
    end if;
    if v_objection.status <> 'open' or v_objection.second_reviewed_at is not null then
      raise exception using errcode = 'P0006', message = 'second review can no longer be assigned';
    end if;
    if p_second_reviewer_profile_id is null
      or p_second_reviewer_profile_id = p_actor_profile_id
      or p_second_reviewer_profile_id = v_objection.profile_id then
      raise exception using errcode = 'P0005', message = 'second reviewer must be independent';
    end if;
    select platform_role into v_second_reviewer_role
    from public.profiles
    where id = p_second_reviewer_profile_id;
    if not found or v_second_reviewer_role not in ('ceo', 'founder', 'deputy') then
      raise exception using errcode = 'P0005', message = 'second reviewer must be a contributor';
    end if;

    update public.score_objections
    set second_reviewer_profile_id = p_second_reviewer_profile_id,
        second_review_decision = null,
        second_reviewed_at = null
    where id = p_objection_id
    returning * into v_objection;
  elsif p_action = 'second_review' then
    if v_objection.status <> 'open' then
      raise exception using errcode = 'P0004', message = 'score objection is already resolved';
    end if;
    if v_objection.second_reviewer_profile_id is distinct from p_actor_profile_id then
      raise exception using errcode = 'P0005', message = 'only assigned second reviewer may submit';
    end if;
    if v_objection.second_reviewed_at is not null then
      raise exception using errcode = 'P0006', message = 'second review is already complete';
    end if;
    if nullif(trim(coalesce(p_second_review_decision, '')), '') is null then
      raise exception using errcode = '22023', message = 'second review decision is required';
    end if;

    update public.score_objections
    set second_review_decision = trim(p_second_review_decision),
        second_reviewed_at = clock_timestamp()
    where id = p_objection_id
    returning * into v_objection;
  elsif p_action = 'resolve' then
    if v_actor_role <> 'ceo' then
      raise exception using errcode = 'P0005', message = 'only CEO may resolve score objection';
    end if;
    if v_objection.status <> 'open' then
      raise exception using errcode = 'P0004', message = 'score objection is already resolved';
    end if;
    if v_objection.second_reviewer_profile_id is not null and v_objection.second_reviewed_at is null then
      raise exception using errcode = 'P0004', message = 'assigned second review is pending';
    end if;
    if v_objection.profile_id = p_actor_profile_id and v_objection.second_reviewed_at is null then
      raise exception using errcode = 'P0005', message = 'CEO own objection requires independent second review';
    end if;
    if p_status not in ('reviewed', 'dismissed', 'accepted') then
      raise exception using errcode = '22023', message = 'invalid score objection status';
    end if;
    if nullif(trim(coalesce(p_resolution_comment, '')), '') is null then
      raise exception using errcode = '22023', message = 'resolution comment is required';
    end if;

    if p_status = 'accepted' then
      if p_delivery_points is null or p_delivery_points not between 0 and 12
        or p_form_points is null or p_form_points not between 0 and 4
        or p_weekly_points is null or p_weekly_points not between 0 and 4 then
        raise exception using errcode = '22023', message = 'accepted objection requires valid score components';
      end if;
      v_total := p_delivery_points + p_form_points + p_weekly_points;
      insert into public.founder_sprint_scores (
        sprint_id, profile_id, delivery_points, form_points, weekly_points, total_points,
        fulfilled, away_neutral, finalized_at, finalized_by, reason_summary
      ) values (
        p_sprint_id, v_objection.profile_id, p_delivery_points, p_form_points, p_weekly_points, v_total,
        v_total >= 12, false, clock_timestamp(), p_actor_profile_id,
        format('Korrigiert nach angenommenem Score-Einwand #%s.', p_objection_id)
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
          reason_summary = excluded.reason_summary
      returning id, to_jsonb(founder_sprint_scores) into v_score_id, v_score;
    end if;

    update public.score_objections
    set status = p_status,
        resolution_comment = trim(p_resolution_comment),
        reviewed_by = p_actor_profile_id,
        reviewed_at = clock_timestamp(),
        founder_sprint_score_id = coalesce(v_score_id, founder_sprint_score_id),
        resolved_delivery_points = case when p_status = 'accepted' then p_delivery_points else null end,
        resolved_form_points = case when p_status = 'accepted' then p_form_points else null end,
        resolved_weekly_points = case when p_status = 'accepted' then p_weekly_points else null end
    where id = p_objection_id
    returning * into v_objection;
  else
    raise exception using errcode = '22023', message = 'invalid score objection action';
  end if;

  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id, before_data, after_data, request_ip, user_agent
  ) values (
    p_actor_profile_id,
    case
      when p_action = 'assign_second_review' then 'score_objection.second_review_assigned'
      when p_action = 'second_review' then 'score_objection.second_review'
      else 'score_objection.review'
    end,
    'score_objection',
    p_objection_id::text,
    v_before,
    to_jsonb(v_objection),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object('objection', to_jsonb(v_objection), 'score', v_score);
end;
$$;

revoke all on function public.review_task_transaction(text, text, timestamptz, jsonb, text, text, integer, text, jsonb, text, jsonb, jsonb, text, text) from public;
grant all on function public.review_task_transaction(text, text, timestamptz, jsonb, text, text, integer, text, jsonb, text, jsonb, jsonb, text, text) to service_role;

revoke all on function public.transition_task_review_transaction(text, timestamptz, text, text, text, text, jsonb, jsonb, text, text) from public;
grant all on function public.transition_task_review_transaction(text, timestamptz, text, text, text, text, jsonb, jsonb, text, text) to service_role;

revoke all on function public.process_score_objection_transaction(text, bigint, text, text, text, text, integer, integer, integer, text, text, text, text) from public;
grant all on function public.process_score_objection_transaction(text, bigint, text, text, text, text, integer, integer, integer, text, text, text, text) to service_role;
