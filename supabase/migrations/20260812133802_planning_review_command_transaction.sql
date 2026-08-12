create or replace function public.prepare_planning_review_command(
  p_task_id text,
  p_requested_reviewer_profile_id text,
  p_actor_profile_id text
) returns jsonb
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_task public.tasks%rowtype;
  v_actor_name text;
  v_reviewer public.profiles%rowtype;
  v_default_reviewer public.profiles%rowtype;
  v_reviewer_profile_id text;
  v_default_reviewer_profile_id text;
  v_initiative_id text;
  v_initiative_owner_id text;
  v_accountable_profile_id text;
  v_sprint_locked boolean := false;
begin
  if nullif(trim(coalesce(p_task_id, '')), '') is null
     or nullif(trim(coalesce(p_actor_profile_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'planning review preparation input is invalid';
  end if;

  select name into v_actor_name
  from public.profiles
  where id = p_actor_profile_id;

  select * into v_task
  from public.tasks
  where id = p_task_id;

  if v_task.id is not null then
    if v_task.task_type = 'initiative' then
      v_initiative_id := v_task.id;
    elsif v_task.task_type = 'deliverable' then
      v_initiative_id := v_task.parent_task_id;
    end if;

    if v_initiative_id is not null then
      select owner into v_initiative_owner_id
      from public.tasks
      where id = v_initiative_id
        and task_type = 'initiative'
        and trashed_at is null;
      select profile_id into v_accountable_profile_id
      from public.planning_item_raci_assignments
      where task_id = v_initiative_id and role = 'accountable'
      order by sort_order, profile_id
      limit 1;
    end if;

    v_default_reviewer_profile_id := coalesce(
      nullif(trim(coalesce(v_task.review_owner_profile_id, '')), ''),
      nullif(trim(coalesce(v_accountable_profile_id, '')), ''),
      nullif(trim(coalesce(v_initiative_owner_id, '')), '')
    );
    v_reviewer_profile_id := coalesce(
      nullif(trim(coalesce(p_requested_reviewer_profile_id, '')), ''),
      v_default_reviewer_profile_id
    );
    if v_reviewer_profile_id is not null then
      select * into v_reviewer
      from public.profiles
      where id = v_reviewer_profile_id;
    end if;
    if v_default_reviewer_profile_id is not null then
      select * into v_default_reviewer
      from public.profiles
      where id = v_default_reviewer_profile_id;
    end if;
    if v_task.sprint_id is not null then
      select coalesce(score_locked, false) into v_sprint_locked
      from public.sprints
      where id = v_task.sprint_id;
    end if;
  end if;

  return jsonb_build_object(
    'task', case when v_task.id is null then null else to_jsonb(v_task) end,
    'actorName', coalesce(v_actor_name, ''),
    'reviewer', case when v_reviewer.id is null then null else jsonb_build_object(
      'id', v_reviewer.id,
      'contributor', v_reviewer.platform_role in ('ceo', 'deputy', 'founder')
    ) end,
    'defaultReviewer', case when v_default_reviewer.id is null then null else jsonb_build_object(
      'id', v_default_reviewer.id,
      'contributor', v_default_reviewer.platform_role in ('ceo', 'deputy', 'founder')
    ) end,
    'sprintLocked', v_sprint_locked
  );
end;
$$;

create or replace function public.mutate_planning_review_command_transaction(
  p_action text,
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_actor_profile_id text,
  p_reviewer_profile_id text,
  p_decision text,
  p_comment text,
  p_checklist jsonb,
  p_points integer,
  p_reason text,
  p_activity_messages text[],
  p_notifications jsonb,
  p_audit_after_data jsonb,
  p_request_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor public.profiles%rowtype;
  v_task public.tasks%rowtype;
  v_reviewer public.profiles%rowtype;
  v_sprint_locked boolean := false;
  v_operational boolean := false;
  v_owns_task boolean := false;
  v_initiative_id text;
  v_initiative_owner_id text;
  v_accountable_profile_id text;
  v_default_reviewer_profile_id text;
  v_result jsonb;
  v_patch jsonb;
begin
  if p_action not in ('request', 'decide', 'withdraw', 'reopen')
     or nullif(trim(coalesce(p_task_id, '')), '') is null
     or p_expected_updated_at is null
     or nullif(trim(coalesce(p_actor_profile_id, '')), '') is null
     or jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_checklist, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_audit_after_data, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'planning review command is invalid';
  end if;

  select * into v_actor
  from public.profiles
  where id = p_actor_profile_id
  for share;
  if not found or v_actor.platform_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'planning review actor is forbidden';
  end if;
  v_operational := v_actor.platform_role in ('ceo', 'deputy');

  select * into v_task
  from public.tasks
  where id = p_task_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_task.trashed_at is not null then
    raise exception using errcode = 'P0010', message = 'planning item is trashed';
  end if;
  if v_task.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;
  v_owns_task := v_task.assignee in (v_actor.id, v_actor.name)
    or v_task.owner in (v_actor.id, v_actor.name);

  if p_action in ('request', 'decide', 'reopen') and v_task.sprint_id is not null then
    select coalesce(score_locked, false) into v_sprint_locked
    from public.sprints
    where id = v_task.sprint_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'review sprint not found';
    end if;
    if v_sprint_locked then
      raise exception using errcode = 'P0003', message = 'sprint score is locked';
    end if;
  end if;

  if p_action = 'request' then
    if not v_operational and not (v_actor.platform_role = 'founder' and v_owns_task) then
      raise exception using errcode = 'P0006', message = 'planning review request is forbidden';
    end if;
    if v_task.task_type <> 'deliverable' or v_task.approval_status <> 'approved' then
      raise exception using errcode = 'P0004', message = 'only approved deliverables may request review';
    end if;
    if v_task.score_final or v_task.review_status = 'requested' or v_task.status = 'Review' then
      raise exception using errcode = 'P0004', message = 'review request state is invalid';
    end if;
    if nullif(trim(coalesce(p_reviewer_profile_id, '')), '') is null then
      raise exception using errcode = '22023', message = 'review owner is required';
    end if;
    v_initiative_id := case when v_task.task_type = 'deliverable' then v_task.parent_task_id else null end;
    if v_initiative_id is not null then
      select owner into v_initiative_owner_id
      from public.tasks
      where id = v_initiative_id
        and task_type = 'initiative'
        and trashed_at is null;
      select profile_id into v_accountable_profile_id
      from public.planning_item_raci_assignments
      where task_id = v_initiative_id and role = 'accountable'
      order by sort_order, profile_id
      limit 1;
    end if;
    v_default_reviewer_profile_id := coalesce(
      nullif(trim(coalesce(v_task.review_owner_profile_id, '')), ''),
      nullif(trim(coalesce(v_accountable_profile_id, '')), ''),
      nullif(trim(coalesce(v_initiative_owner_id, '')), '')
    );
    if v_actor.platform_role <> 'ceo'
       and p_reviewer_profile_id is distinct from v_default_reviewer_profile_id then
      raise exception using errcode = 'P0006', message = 'only the CEO may assign the review owner';
    end if;
    select * into v_reviewer
    from public.profiles
    where id = p_reviewer_profile_id
    for share;
    if not found or v_reviewer.platform_role not in ('ceo', 'deputy', 'founder') then
      raise exception using errcode = 'P0007', message = 'review owner must be a contributor';
    end if;

    v_patch := jsonb_build_object(
      'status', 'Review',
      'review_status', 'requested',
      'review_owner_profile_id', p_reviewer_profile_id,
      'review_requested_at', clock_timestamp(),
      'score_points', 0,
      'score_final', false,
      'github_issue_sync_status', 'not_synced',
      'github_issue_sync_error', null
    );
    v_result := public.update_task_transaction(
      p_task_id,
      p_expected_updated_at,
      v_patch,
      false,
      null,
      false,
      null,
      coalesce(p_activity_messages, '{}'::text[]),
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
      'task.review.request',
      'task',
      p_task_id,
      jsonb_build_object(
        'status', v_task.status,
        'reviewStatus', v_task.review_status,
        'reviewOwnerProfileId', v_task.review_owner_profile_id,
        'scoreFinal', v_task.score_final
      ),
      coalesce(p_audit_after_data, '{}'::jsonb),
      p_request_ip,
      p_user_agent
    );
    return v_result;
  end if;

  if p_action = 'withdraw' then
    if not v_operational and not (v_actor.platform_role = 'founder' and v_owns_task) then
      raise exception using errcode = 'P0006', message = 'planning review withdrawal is forbidden';
    end if;
    if v_task.review_status <> 'requested' or v_task.score_final then
      raise exception using errcode = 'P0004', message = 'review is not active';
    end if;
    if char_length(trim(coalesce(p_reason, ''))) < 2 then
      raise exception using errcode = '22023', message = 'withdraw reason is required';
    end if;
    return public.transition_task_review_transaction(
      p_task_id,
      p_expected_updated_at,
      'withdraw',
      p_actor_profile_id,
      p_reason,
      coalesce(p_activity_messages[1], 'Review zurückgezogen'),
      coalesce(p_notifications, '[]'::jsonb),
      coalesce(p_audit_after_data, '{}'::jsonb),
      p_request_ip,
      p_user_agent
    );
  end if;

  if not v_operational and v_task.review_owner_profile_id is distinct from p_actor_profile_id then
    raise exception using errcode = 'P0006', message = 'planning review decision is forbidden';
  end if;
  if v_task.task_type <> 'deliverable' or v_task.approval_status <> 'approved' then
    raise exception using errcode = 'P0004', message = 'only approved deliverables may be reviewed';
  end if;

  if p_action = 'decide' then
    if v_task.review_status <> 'requested' or v_task.status <> 'Review' or v_task.score_final then
      raise exception using errcode = 'P0004', message = 'review is not active';
    end if;
    if p_decision not in ('accepted', 'partial', 'changes_requested') then
      raise exception using errcode = '22023', message = 'review decision is invalid';
    end if;
    return public.review_task_transaction(
      p_task_id,
      v_task.sprint_id,
      p_expected_updated_at,
      '{}'::jsonb,
      p_actor_profile_id,
      p_decision,
      p_points,
      p_comment,
      coalesce(p_checklist, '{}'::jsonb),
      coalesce(p_activity_messages[1], 'Review finalisiert'),
      coalesce(p_notifications, '[]'::jsonb),
      coalesce(p_audit_after_data, '{}'::jsonb),
      p_request_ip,
      p_user_agent
    );
  end if;

  if v_task.review_status <> 'accepted' or not v_task.score_final then
    raise exception using errcode = 'P0004', message = 'only a final accepted review may be reopened';
  end if;
  if v_task.review_owner_profile_id is null then
    raise exception using errcode = '22023', message = 'review owner is required';
  end if;
  select * into v_reviewer
  from public.profiles
  where id = v_task.review_owner_profile_id
  for share;
  if not found or v_reviewer.platform_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0007', message = 'review owner must be a contributor';
  end if;
  return public.transition_task_review_transaction(
    p_task_id,
    p_expected_updated_at,
    'reopen',
    p_actor_profile_id,
    null,
    coalesce(p_activity_messages[1], 'Review wieder geöffnet'),
    coalesce(p_notifications, '[]'::jsonb),
    coalesce(p_audit_after_data, '{}'::jsonb),
    p_request_ip,
    p_user_agent
  );
end;
$$;

revoke all on function public.prepare_planning_review_command(text, text, text)
  from public, anon, authenticated;
revoke all on function public.mutate_planning_review_command_transaction(
  text, text, timestamptz, text, text, text, text, jsonb, integer, text, text[], jsonb, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.prepare_planning_review_command(text, text, text)
  to service_role;
grant execute on function public.mutate_planning_review_command_transaction(
  text, text, timestamptz, text, text, text, text, jsonb, integer, text, text[], jsonb, jsonb, text, text
) to service_role;
