alter function public.update_team_planning_item_transaction(
  uuid, text, text, text, timestamptz, uuid, text, jsonb, jsonb, jsonb, text, text
) rename to update_team_planning_item_transaction_without_task_status;

create or replace function public.update_team_planning_item_transaction(
  p_token_id uuid,
  p_profile_id text,
  p_item_type text,
  p_item_id text,
  p_expected_updated_at timestamptz,
  p_idempotency_key uuid,
  p_request_hash text,
  p_patch jsonb default '{}'::jsonb,
  p_changed_fields jsonb default '[]'::jsonb,
  p_system_effects jsonb default '[]'::jsonb,
  p_request_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to public
as $$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_request public.team_planning_item_update_requests%rowtype;
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_role text;
  v_profile_name text;
  v_next_status text;
  v_review_owner_profile_id text;
  v_review_owner_role text;
  v_legacy_patch jsonb;
  v_status_patch jsonb;
  v_legacy_response jsonb;
  v_response jsonb;
  v_item jsonb;
  v_legacy_updated_at timestamptz;
  v_audit_before_id bigint;
  v_owned boolean := false;
  v_sub_issue_final_transition boolean := false;
  v_status_message text;
begin
  if p_item_type not in ('deliverable', 'sub_issue') or not coalesce(p_patch, '{}'::jsonb) ? 'status' then
    return public.update_team_planning_item_transaction_without_task_status(
      p_token_id, p_profile_id, p_item_type, p_item_id, p_expected_updated_at,
      p_idempotency_key, p_request_hash, p_patch, p_changed_fields, p_system_effects,
      p_request_ip, p_user_agent
    );
  end if;

  if p_token_id is null
     or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or nullif(trim(coalesce(p_item_id, '')), '') is null
     or p_expected_updated_at is null
     or p_idempotency_key is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_changed_fields, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_system_effects, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'planning items update input is invalid';
  end if;

  select * into v_token
  from public.team_task_intake_tokens
  where id = p_token_id
    and profile_id = p_profile_id
    and revoked_at is null
    and expires_at > now()
  for update;
  if not found then raise exception using errcode = 'P0004', message = 'planning items token is inactive'; end if;
  if not ('write:planning-items:update' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning items update scope is missing';
  end if;

  select platform_role, name into v_role, v_profile_name
  from public.profiles
  where id = p_profile_id
  for share;
  if not found or v_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'planning items profile role is not allowed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('planning-items-update:' || p_token_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_request
  from public.team_planning_item_update_requests
  where token_id = p_token_id and idempotency_key = p_idempotency_key;
  if found then
    if v_request.request_hash <> p_request_hash then
      raise exception using errcode = 'P0003', message = 'idempotency key conflict';
    end if;
    return jsonb_set(v_request.response, '{replayed}', 'true'::jsonb, true);
  end if;

  select * into v_task
  from public.tasks
  where id = p_item_id and trashed_at is null
  for update;
  if not found or v_task.task_type <> p_item_type then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_task.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;
  if (v_task.review_status = 'requested' and not v_task.score_final)
     or (v_task.review_status = 'accepted' and v_task.score_final) then
    raise exception using errcode = 'P0010', message = 'task review is locked';
  end if;

  v_next_status := p_patch->>'status';
  if v_next_status not in ('Offen', 'In Arbeit', 'Review', 'Nacharbeit', 'Blockiert', 'Erledigt') then
    raise exception using errcode = '22023', message = 'task status is invalid';
  end if;
  if v_task.status is not distinct from v_next_status then
    raise exception using errcode = '22023', message = 'unchanged status must not reach the transaction';
  end if;

  v_owned := coalesce(v_task.owner, '') in (p_profile_id, coalesce(v_profile_name, ''))
    or coalesce(v_task.assignee, '') in (p_profile_id, coalesce(v_profile_name, ''));
  v_sub_issue_final_transition := p_item_type = 'sub_issue' and (
    (v_task.status <> 'Erledigt' and v_next_status = 'Erledigt')
    or (v_task.status = 'Erledigt' and v_next_status = 'Offen')
  );

  if v_role = 'founder' and not v_owned and not v_sub_issue_final_transition then
    raise exception using errcode = 'P0007', message = 'founder may only update owned or assigned task status';
  end if;
  if v_role <> 'ceo' and p_item_type = 'deliverable'
     and (v_next_status = 'Erledigt' or v_task.status = 'Erledigt') then
    raise exception using errcode = 'P0007', message = 'deliverable final status requires ceo';
  end if;
  if v_role = 'founder' and v_owned and v_task.status = 'Nacharbeit'
     and v_next_status not in ('In Arbeit', 'Review', 'Blockiert') then
    raise exception using errcode = 'P0007', message = 'rework status transition is not allowed';
  end if;
  if v_role <> 'ceo' and v_next_status = 'Erledigt' and not v_sub_issue_final_transition then
    raise exception using errcode = 'P0007', message = 'final status transition is not allowed';
  end if;
  if v_role <> 'ceo' and v_task.status = 'Erledigt' and not v_sub_issue_final_transition then
    raise exception using errcode = 'P0007', message = 'final task may not be reopened';
  end if;

  v_legacy_patch := coalesce(p_patch, '{}'::jsonb) - array[
    'status', 'review_status', 'review_owner_profile_id', 'review_requested_at',
    'score_points', 'score_final', 'github_issue_sync_status', 'github_issue_sync_error'
  ];

  if p_item_type = 'sub_issue' then
    select * into v_parent
    from public.tasks
    where id = coalesce(nullif(v_legacy_patch->>'parent_task_id', ''), v_task.parent_task_id)
      and task_type = 'deliverable'
      and trashed_at is null
    for share;
    if not found or v_parent.approval_status is distinct from 'approved' then
      raise exception using errcode = 'P0008', message = 'sub-issue parent is not approved';
    end if;
    if (v_parent.review_status = 'requested' and not v_parent.score_final)
       or (v_parent.review_status = 'accepted' and v_parent.score_final) then
      raise exception using errcode = 'P0010', message = 'parent task review is locked';
    end if;
  end if;

  if v_next_status = 'Review' then
    if p_item_type <> 'deliverable' or v_task.approval_status is distinct from 'approved' then
      raise exception using errcode = 'P0010', message = 'review requires approved deliverable';
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(coalesce(p_changed_fields, '[]'::jsonb)) as field
      where field in ('title', 'problemStatement', 'intendedOutcome', 'scopeConstraints', 'acceptanceCriteria', 'definitionOfDone', 'packageId')
    ) then
      raise exception using errcode = 'P0010', message = 'review status cannot be combined with approval-resetting changes';
    end if;
    if v_task.score_final then
      raise exception using errcode = 'P0010', message = 'final score must be reopened through review workflow';
    end if;
    if v_task.sprint_id is not null and exists (
      select 1 from public.sprints where id = v_task.sprint_id and score_locked
    ) then
      raise exception using errcode = 'P0010', message = 'sprint score is locked';
    end if;

    v_review_owner_profile_id := v_task.review_owner_profile_id;
    if v_review_owner_profile_id is null and v_task.package_id is not null then
      select coalesce(accountable_profile_id, owner_id) into v_review_owner_profile_id
      from public.packages
      where id = v_task.package_id and trashed_at is null;
    end if;
    if v_review_owner_profile_id is null then
      raise exception using errcode = 'P0010', message = 'review owner is required';
    end if;
    select platform_role into v_review_owner_role
    from public.profiles
    where id = v_review_owner_profile_id
    for share;
    if not found or v_review_owner_role is null or v_review_owner_role = 'viewer' then
      raise exception using errcode = 'P0010', message = 'review owner must have a contributor role';
    end if;
  end if;

  if v_role = 'founder' and not v_owned and exists (select 1 from jsonb_object_keys(v_legacy_patch)) then
    raise exception using errcode = 'P0007', message = 'unassigned founder status transition cannot include other fields';
  end if;

  select coalesce(max(id), 0) into v_audit_before_id from public.audit_log;
  if v_role = 'founder' and not v_owned then
    v_legacy_response := jsonb_build_object(
      'replayed', false,
      'itemType', p_item_type,
      'item', to_jsonb(v_task),
      'changedFields', coalesce(p_changed_fields, '[]'::jsonb),
      'systemEffects', coalesce(p_system_effects, '[]'::jsonb)
    );
  else
    v_legacy_response := public.update_team_planning_item_transaction_without_task_status(
      p_token_id, p_profile_id, p_item_type, p_item_id, p_expected_updated_at,
      p_idempotency_key, p_request_hash, v_legacy_patch, p_changed_fields, p_system_effects,
      p_request_ip, p_user_agent
    );
  end if;

  v_legacy_updated_at := (v_legacy_response->'item'->>'updated_at')::timestamptz;
  v_status_patch := jsonb_build_object(
    'status', v_next_status,
    'github_issue_sync_status', 'not_synced',
    'github_issue_sync_error', null
  );
  if v_task.status = 'Erledigt' and v_next_status <> 'Erledigt' then
    v_status_patch := v_status_patch || jsonb_build_object('score_final', false);
    if v_next_status <> 'Review' then
      v_status_patch := v_status_patch || jsonb_build_object(
        'review_status', 'not_requested',
        'review_requested_at', null
      );
    end if;
  end if;
  if v_next_status = 'Review' then
    v_status_patch := v_status_patch || jsonb_build_object(
      'review_status', 'requested',
      'review_owner_profile_id', v_review_owner_profile_id,
      'review_requested_at', clock_timestamp(),
      'score_points', 0,
      'score_final', false
    );
  end if;

  perform set_config('app.actor_profile_id', p_profile_id, true);
  update public.tasks as task
  set status = (jsonb_populate_record(null::public.tasks, to_jsonb(task) || v_status_patch)).status,
      review_status = (jsonb_populate_record(null::public.tasks, to_jsonb(task) || v_status_patch)).review_status,
      review_owner_profile_id = (jsonb_populate_record(null::public.tasks, to_jsonb(task) || v_status_patch)).review_owner_profile_id,
      review_requested_at = (jsonb_populate_record(null::public.tasks, to_jsonb(task) || v_status_patch)).review_requested_at,
      score_points = (jsonb_populate_record(null::public.tasks, to_jsonb(task) || v_status_patch)).score_points,
      score_final = (jsonb_populate_record(null::public.tasks, to_jsonb(task) || v_status_patch)).score_final,
      github_issue_sync_status = 'not_synced',
      github_issue_sync_error = null,
      updated_at = clock_timestamp()
  where task.id = p_item_id and task.updated_at = v_legacy_updated_at
  returning to_jsonb(task) into v_item;
  if v_item is null then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;

  v_status_message := 'Status geändert: ' || v_task.status || ' → ' || v_next_status;
  insert into public.task_activity (task_id, message) values (p_item_id, v_status_message);

  if v_next_status = 'Review' then
    insert into public.notification_events (
      type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body
    ) values (
      'task.review_requested', p_profile_id, v_review_owner_profile_id, 'task', p_item_id,
      'Review angefragt: ' || v_task.title,
      'Diese Aufgabe wartet auf deine Accountable-Review.'
    );
  end if;

  if exists (select 1 from jsonb_object_keys(v_legacy_patch)) then
    update public.audit_log
    set after_data = v_item
    where id > v_audit_before_id
      and actor_profile_id = p_profile_id
      and action = 'team.planning_items.update'
      and entity_id = p_item_id;
  else
    insert into public.audit_log (
      actor_profile_id, action, entity_type, entity_id, before_data, after_data, request_ip, user_agent
    ) values (
      p_profile_id, 'team.planning_items.update', p_item_type, p_item_id,
      to_jsonb(v_task), v_item, p_request_ip, p_user_agent
    );
  end if;

  v_response := jsonb_set(v_legacy_response, '{item}', v_item, true);
  v_response := jsonb_set(v_response, '{changedFields}', coalesce(p_changed_fields, '[]'::jsonb), true);
  v_response := jsonb_set(v_response, '{systemEffects}', coalesce(p_system_effects, '[]'::jsonb), true);

  if v_role = 'founder' and not v_owned then
    insert into public.team_planning_item_update_requests (
      token_id, profile_id, item_type, item_id, expected_updated_at, idempotency_key, request_hash, response
    ) values (
      p_token_id, p_profile_id, p_item_type, p_item_id, p_expected_updated_at,
      p_idempotency_key, p_request_hash, v_response
    );
  else
    update public.team_planning_item_update_requests
    set response = v_response
    where token_id = p_token_id and idempotency_key = p_idempotency_key;
  end if;

  return v_response;
end;
$$;

revoke all on function public.update_team_planning_item_transaction_without_task_status(
  uuid, text, text, text, timestamptz, uuid, text, jsonb, jsonb, jsonb, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.update_team_planning_item_transaction(
  uuid, text, text, text, timestamptz, uuid, text, jsonb, jsonb, jsonb, text, text
) from public, anon, authenticated;

grant execute on function public.update_team_planning_item_transaction(
  uuid, text, text, text, timestamptz, uuid, text, jsonb, jsonb, jsonb, text, text
) to service_role;

comment on function public.update_team_planning_item_transaction(
  uuid, text, text, text, timestamptz, uuid, text, jsonb, jsonb, jsonb, text, text
) is 'Atomically updates Planning Items, including role-guarded task status and review transitions.';
