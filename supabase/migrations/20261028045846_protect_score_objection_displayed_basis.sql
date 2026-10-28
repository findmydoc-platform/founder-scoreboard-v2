create or replace function public.process_score_objection_with_basis_transaction(
  p_sprint_id text, p_objection_id bigint, p_actor_profile_id text,
  p_action text, p_status text, p_resolution_comment text,
  p_delivery_points integer, p_form_points integer, p_weekly_points integer,
  p_second_reviewer_profile_id text, p_second_review_decision text,
  p_request_ip text, p_user_agent text,
  p_expected_objection jsonb, p_expected_score jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_objection public.score_objections%rowtype;
  v_expected_objection public.score_objections%rowtype;
  v_score public.founder_sprint_scores%rowtype;
  v_expected_score public.founder_sprint_scores%rowtype;
  v_score_exists boolean;
  v_locked boolean;
  v_objection_keys text[] := array['id','sprint_id','profile_id','founder_sprint_score_id','status','comment','resolution_comment','reviewed_by','reviewed_at','resolved_delivery_points','resolved_form_points','resolved_weekly_points','second_reviewer_profile_id','second_review_decision','second_reviewed_at','created_at'];
  v_score_keys text[] := array['id','sprint_id','profile_id','delivery_points','form_points','weekly_points','total_points','fulfilled','away_neutral','finalized_at','finalized_by','reason_summary'];
begin
  if p_expected_objection is null or jsonb_typeof(p_expected_objection) <> 'object'
    or not (p_expected_objection ?& v_objection_keys) or p_expected_objection - v_objection_keys <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'original score objection basis is required';
  end if;
  begin
    v_expected_objection := jsonb_populate_record(null::public.score_objections, p_expected_objection);
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'original score objection basis is invalid';
  end;
  if p_action = 'resolve' and p_status = 'accepted' and p_expected_score is not null and p_expected_score <> 'null'::jsonb then
    if jsonb_typeof(p_expected_score) <> 'object' or not (p_expected_score ?& v_score_keys) or p_expected_score - v_score_keys <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'original persisted score basis is invalid';
    end if;
    begin
      v_expected_score := jsonb_populate_record(null::public.founder_sprint_scores, p_expected_score);
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'original persisted score basis is invalid';
    end;
  end if;
  select score_locked into v_locked from public.sprints where id = p_sprint_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'sprint not found'; end if;
  if v_locked then raise exception using errcode = 'P0003', message = 'sprint score is locked'; end if;
  select * into v_objection from public.score_objections where id = p_objection_id and sprint_id = p_sprint_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'score objection not found'; end if;
  if v_objection is distinct from v_expected_objection then
    raise exception using errcode = 'P0007', message = 'score objection editing basis changed';
  end if;
  if p_action = 'resolve' and p_status = 'accepted' then
    select * into v_score from public.founder_sprint_scores where sprint_id = p_sprint_id and profile_id = v_objection.profile_id for update;
    v_score_exists := found;
    if (v_score_exists and (p_expected_score is null or p_expected_score = 'null'::jsonb))
      or (not v_score_exists and p_expected_score is not null and p_expected_score <> 'null'::jsonb)
      or (v_score_exists and v_score is distinct from v_expected_score) then
      raise exception using errcode = 'P0007', message = 'persisted score editing basis changed';
    end if;
  end if;
  return public.process_score_objection_transaction(
    p_sprint_id,p_objection_id,p_actor_profile_id,p_action,p_status,p_resolution_comment,
    p_delivery_points,p_form_points,p_weekly_points,p_second_reviewer_profile_id,p_second_review_decision,
    p_request_ip,p_user_agent
  );
end;
$$;
revoke all on function public.process_score_objection_with_basis_transaction(text,bigint,text,text,text,text,integer,integer,integer,text,text,text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.process_score_objection_with_basis_transaction(text,bigint,text,text,text,text,integer,integer,integer,text,text,text,text,jsonb,jsonb) to service_role;
comment on function public.process_score_objection_with_basis_transaction(text,bigint,text,text,text,text,integer,integer,integer,text,text,text,text,jsonb,jsonb) is 'Compare the original displayed objection and accepted-score tuples before the existing service-only decision transaction.';

-- Score mutations use the existing Sprint-locking service transactions.
revoke insert, update, delete on table public.founder_sprint_scores from authenticated;
