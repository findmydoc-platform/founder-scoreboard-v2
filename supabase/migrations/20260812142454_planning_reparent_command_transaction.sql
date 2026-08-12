create or replace function public.prepare_planning_reparent_command(
  p_item_id text,
  p_parent_id text,
  p_expected_kind text,
  p_actor_profile_id text
) returns jsonb
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_old_parent public.tasks%rowtype;
  v_actor public.profiles%rowtype;
  v_item_id text := nullif(trim(coalesce(p_item_id, '')), '');
  v_parent_id text := nullif(trim(coalesce(p_parent_id, '')), '');
  v_requested_parent_id text := nullif(trim(coalesce(p_parent_id, '')), '');
  v_parent_legacy_kind text;
begin
  if v_item_id is null or p_expected_kind not in ('initiative', 'deliverable', 'sub_issue', 'any') then
    raise exception using errcode = '22023', message = 'planning reparent preparation input is invalid';
  end if;
  if p_expected_kind = 'initiative' and not exists (
    select 1 from public.tasks where id = v_item_id and task_type = 'initiative'
  ) then
    select task_id into v_item_id from public.planning_item_legacy_ids
    where source_kind = 'package' and legacy_id = v_item_id;
  end if;
  select * into v_task from public.tasks where id = v_item_id;
  if v_task.id is not null and v_task.parent_task_id is not null then
    select * into v_old_parent from public.tasks where id = v_task.parent_task_id;
  end if;
  if v_parent_id is not null and not exists (select 1 from public.tasks where id = v_parent_id) then
    v_parent_legacy_kind := case p_expected_kind when 'initiative' then 'milestone' when 'deliverable' then 'package' else null end;
    if v_parent_legacy_kind is not null then
      v_parent_id := coalesce((
        select task_id from public.planning_item_legacy_ids
        where source_kind = v_parent_legacy_kind and legacy_id = v_requested_parent_id
      ), v_requested_parent_id);
    end if;
    if p_expected_kind = 'any' then
      v_parent_id := coalesce((
        select task_id from public.planning_item_legacy_ids
        where legacy_id = v_requested_parent_id and source_kind in ('milestone','package')
        order by case source_kind when 'milestone' then 0 else 1 end limit 1
      ), v_requested_parent_id);
    end if;
  end if;
  if v_parent_id is not null then
    select * into v_parent from public.tasks where id = v_parent_id;
  end if;
  select * into v_actor from public.profiles where id = p_actor_profile_id;
  return jsonb_build_object(
    'task', case when v_task.id is null then null else to_jsonb(v_task) end,
    'parent', case when v_parent.id is null then null else to_jsonb(v_parent) end,
    'oldParent', case when v_old_parent.id is null then null else to_jsonb(v_old_parent) end,
    'requestedParentId', v_parent_id,
    'actor', case when v_actor.id is null then null else jsonb_build_object('id',v_actor.id,'name',v_actor.name,'role',v_actor.platform_role) end,
    'profiles', coalesce((select jsonb_agg(jsonb_build_object('id',profile.id,'name',profile.name)) from public.profiles profile where profile.id in (v_task.owner,v_task.assignee,v_task.created_by)), '[]'::jsonb),
    'strategy', (select to_jsonb(strategy) from public.planning_item_strategy strategy where strategy.task_id = v_task.id),
    'raciAssignments', coalesce((select jsonb_agg(to_jsonb(raci) order by raci.sort_order,raci.profile_id) from public.planning_item_raci_assignments raci where raci.task_id = v_task.id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.mutate_planning_reparent_command_transaction(
  p_task_id text,
  p_expected_kind text,
  p_expected_updated_at timestamptz,
  p_parent_task_id text,
  p_expected_parent_updated_at timestamptz,
  p_actor_profile_id text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_old_parent public.tasks%rowtype;
  v_actor public.profiles%rowtype;
  v_parent_id text := nullif(trim(coalesce(p_parent_task_id, '')), '');
  v_operational boolean;
  v_owns_task boolean;
  v_result jsonb;
  v_updated_task public.tasks%rowtype;
begin
  select * into v_actor from public.profiles where id = p_actor_profile_id for share;
  if not found or v_actor.platform_role not in ('ceo','deputy','founder') then
    raise exception using errcode = 'P0006', message = 'planning reparent actor is forbidden';
  end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  if v_task.task_type <> p_expected_kind then raise exception using errcode = '22023', message = 'planning item kind changed'; end if;
  if v_task.trashed_at is not null then raise exception using errcode = 'P0003', message = 'planning item is trashed'; end if;
  if v_task.updated_at is distinct from p_expected_updated_at then raise exception using errcode = 'P0001', message = 'planning item was changed concurrently'; end if;
  v_operational := v_actor.platform_role in ('ceo','deputy');
  v_owns_task := v_task.owner in (v_actor.id,v_actor.name) or v_task.assignee in (v_actor.id,v_actor.name);
  if v_task.task_type in ('initiative','deliverable') and not v_operational then
    raise exception using errcode = 'P0006', message = 'planning reparent requires ceo or deputy';
  end if;
  if v_task.task_type = 'sub_issue' and not v_operational and not v_owns_task then
    raise exception using errcode = 'P0006', message = 'sub-issue reparent requires ownership';
  end if;
  if v_task.task_type = 'deliverable' and v_task.review_status = 'accepted' and v_task.score_final then
    raise exception using errcode = 'P0009', message = 'planning item final review state is locked';
  end if;
  if v_task.task_type = 'deliverable' and (v_task.review_status = 'requested' or v_task.score_final) then
    raise exception using errcode = 'P0009', message = 'planning item active review state is locked';
  end if;
  if v_task.parent_task_id is not null then
    select * into v_old_parent from public.tasks where id = v_task.parent_task_id for share;
    if found and v_old_parent.review_status = 'accepted' and v_old_parent.score_final then
      raise exception using errcode = 'P0009', message = 'current parent final review state is locked';
    end if;
    if found and (v_old_parent.review_status = 'requested' or v_old_parent.score_final) then
      raise exception using errcode = 'P0009', message = 'current parent active review state is locked';
    end if;
  end if;
  if v_parent_id is not null then
    select * into v_parent from public.tasks where id = v_parent_id for share;
    if not found or v_parent.trashed_at is not null then raise exception using errcode = 'P0012', message = 'planning item parent changed concurrently'; end if;
    if p_expected_parent_updated_at is null or v_parent.updated_at is distinct from p_expected_parent_updated_at then
      raise exception using errcode = 'P0012', message = 'planning item parent changed concurrently';
    end if;
    if v_task.task_type = 'deliverable' and v_parent.approval_status = 'rejected' then
      raise exception using errcode = '23514', message = 'deliverable parent initiative is rejected';
    end if;
  end if;
  if v_parent_id is not distinct from v_task.parent_task_id then
    return jsonb_build_object('task', to_jsonb(v_task));
  end if;
  v_result := public.reparent_planning_item_transaction(p_task_id,p_expected_updated_at,v_parent_id,p_actor_profile_id);
  if v_task.task_type in ('deliverable','sub_issue') then
    update public.tasks
    set github_issue_sync_status = 'not_synced',
        github_issue_sync_error = null,
        updated_at = clock_timestamp()
    where id = p_task_id
    returning * into v_updated_task;
    v_result := jsonb_set(v_result, '{task}', to_jsonb(v_updated_task), true);
  end if;
  return v_result;
end;
$$;

create or replace function public.mutate_team_planning_reparent_command_transaction(
  p_token_id uuid,
  p_profile_id text,
  p_item_id text,
  p_item_type text,
  p_expected_updated_at timestamptz,
  p_parent_task_id text,
  p_expected_parent_updated_at timestamptz,
  p_idempotency_key uuid,
  p_request_hash text,
  p_changed_field text,
  p_request_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_request public.team_planning_item_update_requests%rowtype;
  v_result jsonb;
  v_response jsonb;
  v_before public.tasks%rowtype;
  v_after jsonb;
  v_effects jsonb := '[]'::jsonb;
begin
  if p_token_id is null or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or nullif(trim(coalesce(p_item_id, '')), '') is null
     or p_item_type not in ('initiative','deliverable','sub_issue')
     or p_expected_updated_at is null or p_idempotency_key is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$'
     or p_changed_field not in ('parentTaskId','packageId','milestoneId') then
    raise exception using errcode = '22023', message = 'team planning reparent input is invalid';
  end if;
  select * into v_token from public.team_task_intake_tokens
  where id = p_token_id and profile_id = p_profile_id and revoked_at is null and expires_at > now()
  for update;
  if not found then raise exception using errcode = 'P0004', message = 'planning items token is inactive'; end if;
  if not ('write:planning-items:update' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning items update scope is missing';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('planning-items-update:' || p_token_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_request from public.team_planning_item_update_requests
  where token_id = p_token_id and idempotency_key = p_idempotency_key;
  if found then
    if v_request.request_hash <> p_request_hash then
      raise exception using errcode = 'P0013', message = 'idempotency key conflict';
    end if;
    return jsonb_set(v_request.response, '{replayed}', 'true'::jsonb, true);
  end if;
  select * into v_before from public.tasks where id = p_item_id for update;
  v_result := public.mutate_planning_reparent_command_transaction(
    p_item_id,p_item_type,p_expected_updated_at,p_parent_task_id,p_expected_parent_updated_at,p_profile_id
  );
  v_after := v_result->'task';
  if v_before.approval_status is distinct from v_after->>'approval_status' then
    v_effects := v_effects || jsonb_build_array(jsonb_build_object('field','approvalStatus','before',v_before.approval_status,'after',v_after->>'approval_status','reason','Parent-Wechsel benötigt eine neue Freigabe.'));
  end if;
  if v_before.approval_revision is distinct from (v_after->>'approval_revision')::integer then
    v_effects := v_effects || jsonb_build_array(jsonb_build_object('field','approvalRevision','before',v_before.approval_revision,'after',(v_after->>'approval_revision')::integer,'reason','Neue Freigabe-Revision.'));
  end if;
  if v_before.sprint_id is distinct from nullif(v_after->>'sprint_id','') then
    v_effects := v_effects || jsonb_build_array(jsonb_build_object('field','sprintId','before',coalesce(v_before.sprint_id,''),'after',coalesce(v_after->>'sprint_id',''),'reason','Freigabewechsel entfernt die Sprint-Zuordnung.'));
  end if;
  if v_before.review_status is distinct from v_after->>'review_status' then
    v_effects := v_effects || jsonb_build_array(jsonb_build_object('field','reviewStatus','before',v_before.review_status,'after',v_after->>'review_status','reason','Freigabewechsel beendet den laufenden Review-Zustand.'));
  end if;
  if v_before.score_points is distinct from (v_after->>'score_points')::integer then
    v_effects := v_effects || jsonb_build_array(jsonb_build_object('field','scorePoints','before',v_before.score_points,'after',(v_after->>'score_points')::integer,'reason','Freigabewechsel setzt den Score zurück.'));
  end if;
  if v_before.score_final is distinct from (v_after->>'score_final')::boolean then
    v_effects := v_effects || jsonb_build_array(jsonb_build_object('field','scoreFinal','before',v_before.score_final,'after',(v_after->>'score_final')::boolean,'reason','Freigabewechsel setzt den finalen Score zurück.'));
  end if;
  if p_item_type in ('deliverable','sub_issue') and v_before.parent_task_id is distinct from nullif(v_after->>'parent_task_id','') then
    v_effects := v_effects || jsonb_build_array(jsonb_build_object('field','githubIssueSyncStatus','before',v_before.github_issue_sync_status,'after',v_after->>'github_issue_sync_status','reason','Planungsänderung markiert die GitHub-Projektion als erneut zu synchronisieren.'));
  end if;
  v_response := jsonb_build_object(
    'replayed', false,
    'commandKind', 'changeParent',
    'itemType', p_item_type,
    'item', v_result->'task',
    'changedFields', case when v_before.parent_task_id is distinct from nullif(v_after->>'parent_task_id','') then jsonb_build_array(p_changed_field) else '[]'::jsonb end,
    'systemEffects', v_effects
  );
  insert into public.team_planning_item_update_requests (
    token_id,profile_id,item_type,item_id,expected_updated_at,idempotency_key,request_hash,response
    ,contract_version
  ) values (
    p_token_id,p_profile_id,p_item_type,p_item_id,p_expected_updated_at,p_idempotency_key,p_request_hash,v_response,2
  );
  return v_response;
end;
$$;

revoke all on function public.prepare_planning_reparent_command(text,text,text,text) from public,anon,authenticated;
revoke all on function public.mutate_planning_reparent_command_transaction(text,text,timestamptz,text,timestamptz,text) from public,anon,authenticated;
revoke all on function public.mutate_team_planning_reparent_command_transaction(uuid,text,text,text,timestamptz,text,timestamptz,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.prepare_planning_reparent_command(text,text,text,text) to service_role;
grant execute on function public.mutate_planning_reparent_command_transaction(text,text,timestamptz,text,timestamptz,text) to service_role;
grant execute on function public.mutate_team_planning_reparent_command_transaction(uuid,text,text,text,timestamptz,text,timestamptz,uuid,text,text,text,text) to service_role;
