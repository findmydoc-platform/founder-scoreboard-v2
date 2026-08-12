create or replace function public.update_browser_planning_item_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_strategy jsonb,
  p_raci_assignments jsonb,
  p_actor_profile_id text,
  p_request_ip text default null,
  p_user_agent text default null,
  p_legacy_audit_action text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor_role text;
  v_task public.tasks%rowtype;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_result jsonb;
begin
  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  if not found or v_actor_role = 'viewer' then
    raise exception using errcode = 'P0006', message = 'planning revise actor is not allowed';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  if v_task.trashed_at is not null then raise exception using errcode = 'P0003', message = 'planning item is trashed'; end if;
  if v_task.task_type not in ('epic', 'initiative') then
    raise exception using errcode = '22023', message = 'strategic revise requires an Epic or Initiative';
  end if;
  if v_patch ? 'parent_task_id' then
    raise exception using errcode = '22023', message = 'parent changes require the planning parent command';
  end if;
  if v_task.task_type = 'epic' and v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'Epic revise requires an operational lead';
  end if;
  if v_task.task_type = 'initiative'
     and v_actor_role not in ('ceo', 'deputy')
     and p_actor_profile_id is distinct from v_task.owner
     and p_actor_profile_id is distinct from v_task.assignee then
    raise exception using errcode = 'P0006', message = 'Initiative revise requires ownership';
  end if;
  if v_actor_role not in ('ceo', 'deputy') and (
    v_patch ?| array['owner', 'assignee'] or p_raci_assignments is not null
  ) then
    raise exception using errcode = 'P0006', message = 'Owner and RACI changes require an operational lead';
  end if;

  v_result := public.update_planning_item_transaction(
    p_task_id,
    p_expected_updated_at,
    v_patch,
    p_strategy,
    p_raci_assignments,
    p_actor_profile_id
  );
  if nullif(trim(coalesce(p_legacy_audit_action, '')), '') is not null then
    insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data, request_ip, user_agent)
    values (p_actor_profile_id, p_legacy_audit_action, 'milestone', p_task_id, to_jsonb(v_task), v_result->'task', p_request_ip, p_user_agent);
  end if;
  return v_result;
end;
$$;

create or replace function public.update_browser_planning_task_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_task_patch jsonb,
  p_note_present boolean,
  p_note text,
  p_dependency_present boolean,
  p_dependency_note text,
  p_activity_messages text[],
  p_notifications jsonb,
  p_actor_profile_id text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor_role text;
  v_task public.tasks%rowtype;
  v_patch jsonb := coalesce(p_task_patch, '{}'::jsonb);
  v_core_patch jsonb;
  v_result jsonb;
  v_updated_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_target_sprint public.sprints%rowtype;
  v_source_sprint public.sprints%rowtype;
  v_target_sprint_id text;
  v_key text;
begin
  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  if not found or v_actor_role = 'viewer' then
    raise exception using errcode = 'P0006', message = 'planning revise actor is not allowed';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if v_task.trashed_at is not null then raise exception using errcode = 'P0003', message = 'task is trashed'; end if;
  if v_task.task_type not in ('deliverable', 'sub_issue') then
    raise exception using errcode = '22023', message = 'delivery revise requires a Deliverable or Sub-Issue';
  end if;
  if v_patch ? 'parent_task_id' then
    raise exception using errcode = '22023', message = 'parent changes require the planning parent command';
  end if;

  if (v_task.review_status = 'requested' and not coalesce(v_task.score_final, false))
     or (v_task.review_status = 'accepted' and coalesce(v_task.score_final, false)) then
    if coalesce(v_task.score_final, false)
       or p_note_present
       or p_dependency_present
       or exists (
         select 1 from jsonb_object_keys(v_patch) as patch_key(value)
         where patch_key.value <> 'review_owner_profile_id'
       ) then
      raise exception using errcode = 'P0010', message = 'planning item review is locked';
    end if;
  end if;

  if v_task.task_type = 'sub_issue' and v_task.parent_task_id is not null then
    select * into v_parent from public.tasks where id = v_task.parent_task_id for share;
    if found and (
      (v_parent.review_status = 'requested' and not coalesce(v_parent.score_final, false))
      or (v_parent.review_status = 'accepted' and coalesce(v_parent.score_final, false))
    ) then
      raise exception using errcode = 'P0010', message = 'parent planning item review is locked';
    end if;
  end if;

  if v_patch ? 'sprint_id' then
    if v_task.parent_task_id is not null then
      select * into v_parent from public.tasks where id = v_task.parent_task_id for share;
    end if;
    if v_task.task_type <> 'deliverable'
       or v_task.approval_status <> 'approved'
       or v_task.status = 'Erledigt'
       or coalesce(nullif(trim(v_task.assignee), ''), nullif(trim(v_task.owner), '')) is null
       or v_task.parent_task_id is null
       or v_parent.id is null
       or v_parent.task_type <> 'initiative'
       or v_parent.approval_status <> 'approved'
       or v_parent.trashed_at is not null then
      raise exception using errcode = 'P0015', message = 'planning item is not eligible for sprint assignment';
    end if;
    v_target_sprint_id := nullif(trim(coalesce(v_patch->>'sprint_id', '')), '');
    if v_target_sprint_id is not null then
      select * into v_target_sprint from public.sprints where id = v_target_sprint_id for share;
      if not found or v_target_sprint.score_locked then
        raise exception using errcode = 'P0015', message = 'target sprint is unavailable or locked';
      end if;
    end if;
    if v_task.sprint_id is not null and v_task.sprint_id is distinct from v_target_sprint_id then
      select * into v_source_sprint from public.sprints where id = v_task.sprint_id for share;
      if not found or v_source_sprint.score_locked then
        raise exception using errcode = 'P0015', message = 'source sprint is unavailable or locked';
      end if;
    end if;
  end if;

  if v_actor_role not in ('ceo', 'deputy')
     and p_actor_profile_id is distinct from v_task.owner
     and p_actor_profile_id is distinct from v_task.assignee then
    if v_task.task_type <> 'sub_issue' then
      raise exception using errcode = 'P0006', message = 'Deliverable revise requires ownership';
    end if;
    for v_key in select jsonb_object_keys(v_patch) loop
      if v_key not in ('status', 'score_final', 'review_status', 'review_requested_at', 'github_issue_sync_status', 'github_issue_sync_error') then
        raise exception using errcode = 'P0006', message = 'Unowned Sub-Issue revise is limited to status transitions';
      end if;
    end loop;
    if p_note_present or p_dependency_present then
      raise exception using errcode = 'P0006', message = 'Unowned Sub-Issue revise cannot change notes';
    end if;
  end if;

  v_core_patch := v_patch - array['title', 'description', 'workstream', 'estimate_hours', 'github_repo'];
  v_result := public.update_planning_task_transaction(
    p_task_id,
    p_expected_updated_at,
    v_core_patch,
    p_note_present,
    p_note,
    p_dependency_present,
    p_dependency_note,
    p_activity_messages,
    p_notifications,
    p_actor_profile_id
  );
  if v_patch ?| array['title', 'description', 'workstream', 'estimate_hours', 'github_repo'] then
    update public.tasks
    set title = case when v_patch ? 'title' then nullif(trim(v_patch->>'title'), '') else title end,
        description = case when v_patch ? 'description' then nullif(trim(coalesce(v_patch->>'description', '')), '') else description end,
        workstream = case when v_patch ? 'workstream' then nullif(trim(coalesce(v_patch->>'workstream', '')), '') else workstream end,
        estimate_hours = case when v_patch ? 'estimate_hours' then coalesce((v_patch->>'estimate_hours')::integer, 0) else estimate_hours end,
        github_repo = case when v_patch ? 'github_repo' then nullif(trim(coalesce(v_patch->>'github_repo', '')), '') else github_repo end,
        updated_at = clock_timestamp()
    where id = p_task_id
    returning * into v_updated_task;
    v_result := jsonb_set(v_result, '{task}', to_jsonb(v_updated_task), true);
  end if;
  return v_result;
end;
$$;

revoke all on function public.update_browser_planning_item_transaction(text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text) from public;
revoke all on function public.update_browser_planning_task_transaction(text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb, text) from public;
grant execute on function public.update_browser_planning_item_transaction(text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text) to service_role;
grant execute on function public.update_browser_planning_task_transaction(text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb, text) to service_role;
