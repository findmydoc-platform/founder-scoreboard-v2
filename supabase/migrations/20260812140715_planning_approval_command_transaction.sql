create or replace function public.prepare_planning_approval_command(
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
  v_accountable_count integer := 0;
  v_responsible_count integer := 0;
  v_canonical_id text := nullif(trim(coalesce(p_item_id, '')), '');
begin
  if v_canonical_id is null
     or p_expected_kind not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_actor_profile_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'planning approval preparation input is invalid';
  end if;

  if p_expected_kind = 'initiative' and not exists (
    select 1 from public.tasks where id = v_canonical_id and task_type = 'initiative'
  ) then
    select task_id into v_canonical_id
    from public.planning_item_legacy_ids
    where source_kind = 'package' and legacy_id = v_canonical_id;
  end if;

  select * into v_task from public.tasks where id = v_canonical_id;
  if v_task.id is not null and v_task.parent_task_id is not null then
    select * into v_parent from public.tasks where id = v_task.parent_task_id;
  end if;
  if v_task.task_type = 'initiative' then
    select count(*) filter (where role = 'accountable'), count(*) filter (where role = 'responsible')
    into v_accountable_count, v_responsible_count
    from public.planning_item_raci_assignments
    where task_id = v_task.id;
  end if;
  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;

  return jsonb_build_object(
    'task', case when v_task.id is null then null else to_jsonb(v_task) end,
    'parent', case when v_parent.id is null then null else to_jsonb(v_parent) end,
    'actorRole', coalesce(v_actor_role, ''),
    'accountableCount', v_accountable_count,
    'responsibleCount', v_responsible_count,
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object('id', profile.id, 'name', profile.name))
      from public.profiles profile
      where profile.id in (v_task.owner, v_task.assignee, v_task.created_by)
    ), '[]'::jsonb),
    'strategy', (select to_jsonb(strategy) from public.planning_item_strategy strategy where strategy.task_id = v_task.id),
    'raciAssignments', coalesce((
      select jsonb_agg(to_jsonb(raci) order by raci.sort_order, raci.profile_id)
      from public.planning_item_raci_assignments raci where raci.task_id = v_task.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.mutate_planning_approval_command_transaction(
  p_task_id text,
  p_expected_kind text,
  p_expected_revision integer,
  p_action text,
  p_actor_profile_id text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_task public.tasks%rowtype;
begin
  if p_expected_kind not in ('initiative', 'deliverable') then
    raise exception using errcode = '22023', message = 'planning approval kind is invalid';
  end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_task.task_type <> p_expected_kind then
    raise exception using errcode = '22023', message = 'planning item has no requested approval lifecycle';
  end if;
  if v_task.trashed_at is not null then
    raise exception using errcode = 'P0003', message = 'planning item is trashed';
  end if;
  if v_task.task_type = 'deliverable' and v_task.score_final then
    raise exception using errcode = 'P0009', message = 'planning item final review state is locked';
  end if;
  if v_task.task_type = 'deliverable' and v_task.review_status = 'requested' then
    raise exception using errcode = 'P0009', message = 'planning item active review state is locked';
  end if;
  return public.decide_planning_item_approval_transaction(
    p_task_id,
    p_expected_revision,
    p_action,
    p_actor_profile_id,
    p_note
  );
end;
$$;

revoke all on function public.prepare_planning_approval_command(text, text, text) from public, anon, authenticated;
revoke all on function public.mutate_planning_approval_command_transaction(text, text, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.prepare_planning_approval_command(text, text, text) to service_role;
grant execute on function public.mutate_planning_approval_command_transaction(text, text, integer, text, text, text) to service_role;
