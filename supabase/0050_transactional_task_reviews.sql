alter table public.task_reviews add column if not exists checklist jsonb not null default '{}'::jsonb;

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
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sprint_locked boolean;
  v_update_result jsonb;
  v_review jsonb;
begin
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'expected task update timestamp is required';
  end if;
  if p_decision not in ('accepted', 'partial', 'changes_requested') then
    raise exception using errcode = '22023', message = 'invalid review decision';
  end if;
  if p_points < 0 or p_points > 10 then
    raise exception using errcode = '22023', message = 'review points must be between 0 and 10';
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

  v_update_result := public.update_task_transaction(
    p_task_id,
    p_expected_updated_at,
    coalesce(p_task_patch, '{}'::jsonb),
    false,
    null,
    false,
    null,
    array[p_activity_message],
    coalesce(p_notifications, '[]'::jsonb)
  );

  if (v_update_result -> 'task' ->> 'sprint_id') is distinct from p_sprint_id then
    raise exception using errcode = '22023', message = 'task sprint changed during review';
  end if;

  insert into public.task_reviews (
    task_id,
    sprint_id,
    reviewer_profile_id,
    decision,
    points,
    comment,
    checklist
  )
  values (
    p_task_id,
    p_sprint_id,
    p_reviewer_profile_id,
    p_decision,
    p_points,
    p_comment,
    coalesce(p_checklist, '{}'::jsonb)
  )
  returning to_jsonb(task_reviews) into v_review;

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
    p_reviewer_profile_id,
    'task.review',
    'task',
    p_task_id,
    coalesce(p_audit_after_data, '{}'::jsonb),
    p_request_ip,
    p_user_agent
  );

  return v_update_result || jsonb_build_object('review', v_review);
end;
$$;

revoke all on function public.review_task_transaction(text, text, timestamptz, jsonb, text, text, integer, text, jsonb, text, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.review_task_transaction(text, text, timestamptz, jsonb, text, text, integer, text, jsonb, text, jsonb, jsonb, text, text) to service_role;

comment on function public.review_task_transaction(text, text, timestamptz, jsonb, text, text, integer, text, jsonb, text, jsonb, jsonb, text, text)
is 'Atomically applies a task review with compare-and-set task state, immutable review history, activity, notification, and audit.';

notify pgrst, 'reload schema';
