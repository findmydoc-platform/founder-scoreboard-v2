alter table public.score_objections
  add column if not exists resolved_delivery_points integer check (resolved_delivery_points between 0 and 12),
  add column if not exists resolved_form_points integer check (resolved_form_points between 0 and 4),
  add column if not exists resolved_weekly_points integer check (resolved_weekly_points between 0 and 4);

create or replace function public.resolve_score_objection_transaction(
  p_sprint_id text,
  p_objection_id bigint,
  p_actor_profile_id text,
  p_action text,
  p_status text default null,
  p_resolution_comment text default null,
  p_delivery_points integer default null,
  p_form_points integer default null,
  p_weekly_points integer default null,
  p_second_review_decision text default null,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sprint_locked boolean;
  v_objection public.score_objections%rowtype;
  v_before jsonb;
  v_score jsonb := null;
  v_score_id bigint;
  v_total integer;
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

  select * into v_objection
  from public.score_objections
  where id = p_objection_id
    and sprint_id = p_sprint_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'score objection not found';
  end if;

  v_before := to_jsonb(v_objection);

  if p_action = 'resolve' then
    if v_objection.status <> 'open' then
      raise exception using errcode = 'P0004', message = 'score objection is already resolved';
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
        sprint_id,
        profile_id,
        delivery_points,
        form_points,
        weekly_points,
        total_points,
        fulfilled,
        away_neutral,
        finalized_at,
        finalized_by,
        reason_summary
      )
      values (
        p_sprint_id,
        v_objection.profile_id,
        p_delivery_points,
        p_form_points,
        p_weekly_points,
        v_total,
        v_total >= 12,
        false,
        clock_timestamp(),
        p_actor_profile_id,
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
  elsif p_action = 'second_review' then
    if v_objection.status = 'open' or v_objection.reviewed_by is null then
      raise exception using errcode = 'P0004', message = 'score objection must be resolved before second review';
    end if;
    if v_objection.second_reviewed_at is not null then
      raise exception using errcode = 'P0006', message = 'second review is already complete';
    end if;
    if v_objection.reviewed_by = p_actor_profile_id then
      raise exception using errcode = 'P0005', message = 'second reviewer must differ from first reviewer';
    end if;
    if nullif(trim(coalesce(p_second_review_decision, '')), '') is null then
      raise exception using errcode = '22023', message = 'second review decision is required';
    end if;

    update public.score_objections
    set second_reviewer_profile_id = p_actor_profile_id,
        second_review_decision = trim(p_second_review_decision),
        second_reviewed_at = clock_timestamp()
    where id = p_objection_id
    returning * into v_objection;

    if v_objection.founder_sprint_score_id is not null then
      select to_jsonb(score) into v_score
      from public.founder_sprint_scores as score
      where id = v_objection.founder_sprint_score_id;
    end if;
  else
    raise exception using errcode = '22023', message = 'invalid score objection action';
  end if;

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
    case when p_action = 'second_review' then 'score_objection.second_review' else 'score_objection.review' end,
    'score_objection',
    p_objection_id::text,
    v_before,
    to_jsonb(v_objection),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'objection', to_jsonb(v_objection),
    'score', v_score
  );
end;
$$;

revoke all on function public.resolve_score_objection_transaction(text, bigint, text, text, text, text, integer, integer, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.resolve_score_objection_transaction(text, bigint, text, text, text, text, integer, integer, integer, text, text, text) to service_role;

comment on function public.resolve_score_objection_transaction(text, bigint, text, text, text, text, integer, integer, integer, text, text, text)
is 'Atomically resolves score objections, persists accepted score corrections, and enforces one independent second review.';

notify pgrst, 'reload schema';
