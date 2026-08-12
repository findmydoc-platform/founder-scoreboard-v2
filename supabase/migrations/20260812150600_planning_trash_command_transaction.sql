create or replace function public.prepare_planning_trash_command(
  p_item_id text,
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
  v_actor_role text;
  v_item_id text := nullif(trim(coalesce(p_item_id, '')), '');
  v_affected_task_ids text[] := array[]::text[];
begin
  if v_item_id is null
     or p_expected_kind not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_actor_profile_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'planning trash preparation input is invalid';
  end if;

  select * into v_task from public.tasks where id = v_item_id;
  if v_task.id is not null and v_task.parent_task_id is not null then
    select * into v_parent from public.tasks where id = v_task.parent_task_id;
  end if;
  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;

  if v_task.id is not null then
    if v_task.trashed_at is null then
      with recursive planning_tree as (
        select task.id
        from public.tasks task
        where task.id = v_task.id
        union all
        select child.id
        from public.tasks child
        join planning_tree parent on child.parent_task_id = parent.id
        where child.trashed_at is null
      )
      select coalesce(array_agg(id order by id), array[]::text[])
      into v_affected_task_ids
      from planning_tree;
    else
      select coalesce(array_agg(id order by id), array[]::text[])
      into v_affected_task_ids
      from public.tasks
      where trash_root_type = v_task.trash_root_type
        and trash_root_id = v_task.trash_root_id
        and trash_revision = v_task.trash_revision
        and trashed_at is not null;
    end if;
  end if;

  return jsonb_build_object(
    'task', case when v_task.id is null then null else to_jsonb(v_task) end,
    'parent', case when v_parent.id is null then null else to_jsonb(v_parent) end,
    'actorRole', coalesce(v_actor_role, ''),
    'affectedTaskIds', to_jsonb(v_affected_task_ids)
  );
end;
$$;

-- Restore parents before their children so row-level hierarchy guards observe a
-- valid tree throughout the statement. The prior set-based update could visit a
-- Sub-Issue before its Deliverable and abort an otherwise valid whole-tree restore.
create or replace function public.restore_planning_item_transaction(
  p_root_type text,
  p_root_id text,
  p_expected_trash_revision integer,
  p_actor_profile_id text,
  p_request_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor_role text;
  v_root public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_updated_root public.tasks%rowtype;
  v_task_ids text[] := array[]::text[];
  v_task_id text;
begin
  if p_root_type not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_root_id, '')), '') is null
     or p_expected_trash_revision is null
     or p_expected_trash_revision < 1 then
    raise exception using errcode = '22023', message = 'planning restore input is invalid';
  end if;
  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id for share;
  if not found or v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'planning restore requires operational lead';
  end if;

  select * into v_root from public.tasks where id = p_root_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_root.task_type <> p_root_type
     or v_root.trashed_at is null
     or v_root.trash_root_type <> p_root_type
     or v_root.trash_root_id <> p_root_id then
    raise exception using errcode = 'P0003', message = 'planning item is not a trash root';
  end if;
  if v_root.trash_revision <> p_expected_trash_revision then
    raise exception using errcode = 'P0001', message = 'planning trash revision changed';
  end if;
  if v_root.parent_task_id is not null then
    select * into v_parent from public.tasks where id = v_root.parent_task_id for share;
    if not found or v_parent.trashed_at is not null then
      raise exception using errcode = 'P0003', message = 'parent planning item must be restored first';
    end if;
  end if;

  select coalesce(array_agg(id order by
    case task_type when 'initiative' then 0 when 'deliverable' then 1 else 2 end,
    id
  ), array[]::text[])
  into v_task_ids
  from public.tasks
  where trash_root_type = p_root_type
    and trash_root_id = p_root_id
    and trash_revision = p_expected_trash_revision
    and trashed_at is not null;
  perform id from public.tasks where id = any(v_task_ids) order by id for update;
  perform set_config('founderops.trash_lifecycle_write', 'on', true);

  foreach v_task_id in array v_task_ids loop
    update public.tasks
    set approval_status = case when task_type in ('initiative', 'deliverable') then 'proposed' else null end,
        approval_revision = case when task_type in ('initiative', 'deliverable') then approval_revision + 1 else approval_revision end,
        proposed_by = case when task_type in ('initiative', 'deliverable') then p_actor_profile_id else proposed_by end,
        proposed_at = case when task_type in ('initiative', 'deliverable') then clock_timestamp() else proposed_at end,
        decided_by = null,
        decided_at = null,
        decision_note = null,
        sprint_id = case when task_type = 'deliverable' then null else sprint_id end,
        review_status = case when task_type = 'deliverable' then 'not_requested' else review_status end,
        review_owner_profile_id = case when task_type = 'deliverable' then null else review_owner_profile_id end,
        review_requested_at = case when task_type = 'deliverable' then null else review_requested_at end,
        score_points = case when task_type = 'deliverable' then 0 else score_points end,
        score_final = case when task_type = 'deliverable' then false else score_final end,
        score_relevant = false,
        trashed_at = null,
        trashed_by = null,
        trash_reason = null,
        trash_cause = null,
        purge_after = null,
        trash_root_type = null,
        trash_root_id = null,
        updated_at = clock_timestamp()
    where id = v_task_id;
  end loop;

  select * into v_updated_root from public.tasks where id = p_root_id;
  insert into public.planning_github_lifecycle_outbox (
    root_type, root_id, root_trash_revision, task_id, github_repo,
    github_issue_number, action, source_type, source_revision, reason,
    status, status_reason, last_error
  )
  select
    p_root_type,
    p_root_id,
    p_expected_trash_revision,
    task.id,
    closed.github_repo,
    closed.github_issue_number,
    'reopen',
    'approval',
    p_expected_trash_revision,
    null,
    case when closed.github_issue_number is null then 'failed' else 'pending' end,
    case when closed.github_issue_number is null then 'missing_close_target' end,
    case when closed.github_issue_number is null then 'No durable close target is available for the restored planning item.' end
  from public.tasks task
  left join lateral (
    select prior.github_repo, prior.github_issue_number
    from public.planning_github_lifecycle_outbox prior
    where prior.task_id = task.id
      and prior.action = 'close_not_planned'
      and prior.root_type = p_root_type
      and prior.root_id = p_root_id
      and prior.root_trash_revision = p_expected_trash_revision
    order by prior.created_at desc, prior.id desc
    limit 1
  ) closed on true
  where task.id = any(v_task_ids)
    and task.task_type in ('deliverable', 'sub_issue')
  on conflict (root_type, root_id, root_trash_revision, task_id, action) do nothing;

  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  insert into public.task_activity (task_id, message)
  values (p_root_id, case when p_root_type = 'initiative' then 'Initiative aus dem Papierkorb wiederhergestellt · erneut vorgeschlagen' else 'Deliverable aus dem Papierkorb wiederhergestellt · erneut vorgeschlagen' end);
  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id, before_data, after_data, request_ip, user_agent
  ) values (
    p_actor_profile_id,
    'planning_item.restored',
    'task',
    p_root_id,
    jsonb_build_object('trashRevision', p_expected_trash_revision),
    jsonb_build_object('affectedTaskIds', to_jsonb(v_task_ids), 'approvalStatus', v_updated_root.approval_status),
    p_request_ip,
    p_user_agent
  );
  return jsonb_build_object(
    'rootType', p_root_type,
    'rootId', p_root_id,
    'affectedTaskIds', to_jsonb(v_task_ids),
    'trashRevision', p_expected_trash_revision,
    'item', to_jsonb(v_updated_root),
    'eventIds', '[]'::jsonb
  );
end;
$$;

create or replace function public.mutate_planning_trash_command_transaction(
  p_action text,
  p_root_type text,
  p_root_id text,
  p_expected_revision integer,
  p_actor_profile_id text,
  p_reason text default null,
  p_request_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_root public.tasks%rowtype;
begin
  if p_action not in ('withdraw', 'restore')
     or p_root_type not in ('initiative', 'deliverable') then
    raise exception using errcode = '22023', message = 'planning trash action is invalid';
  end if;

  select * into v_root
  from public.tasks
  where id = p_root_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_root.task_type <> p_root_type then
    raise exception using errcode = '22023', message = 'planning trash root type is invalid';
  end if;

  if p_action = 'withdraw' then
    if v_root.task_type = 'deliverable' and v_root.review_status = 'accepted' and v_root.score_final then
      raise exception using errcode = 'P0009', message = 'planning item final review state is locked';
    end if;
    if v_root.task_type = 'deliverable' and (v_root.review_status = 'requested' or v_root.score_final) then
      raise exception using errcode = 'P0009', message = 'planning item active review state is locked';
    end if;
    return public.withdraw_planning_item_transaction(
      p_root_type,
      p_root_id,
      p_expected_revision,
      p_actor_profile_id,
      p_reason,
      p_request_ip,
      p_user_agent
    );
  end if;
  if p_action = 'restore' then
    if nullif(trim(coalesce(p_reason, '')), '') is not null then
      raise exception using errcode = '22023', message = 'planning restore reason is invalid';
    end if;
    return public.restore_planning_item_transaction(
      p_root_type,
      p_root_id,
      p_expected_revision,
      p_actor_profile_id,
      p_request_ip,
      p_user_agent
    );
  end if;
  raise exception using errcode = '22023', message = 'planning trash action is invalid';
end;
$$;

revoke all on function public.prepare_planning_trash_command(text, text, text) from public, anon, authenticated;
revoke all on function public.mutate_planning_trash_command_transaction(text, text, text, integer, text, text, text, text) from public, anon, authenticated;
grant execute on function public.prepare_planning_trash_command(text, text, text) to service_role;
grant execute on function public.mutate_planning_trash_command_transaction(text, text, text, integer, text, text, text, text) to service_role;
