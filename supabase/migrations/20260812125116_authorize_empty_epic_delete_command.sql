-- The PlanningItems command needs the existing empty-only delete and its audit
-- record to share one transaction. Keep the old RPC intact for rollback while
-- exposing request metadata only through the new command adapter.
create or replace function public.prepare_empty_epic_delete(
  p_item_id text
) returns jsonb
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_canonical_id text;
  v_epic public.tasks%rowtype;
  v_initiative_count bigint := 0;
  v_task_count bigint := 0;
  v_legacy_protected boolean := false;
begin
  if nullif(trim(coalesce(p_item_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'empty epic delete preparation input is invalid';
  end if;

  select id into v_canonical_id
  from public.tasks
  where id = p_item_id and task_type = 'epic';
  if not found then
    select task_id into v_canonical_id
    from public.planning_item_legacy_ids
    where source_kind = 'milestone' and legacy_id = p_item_id;
  end if;
  if v_canonical_id is null then
    return jsonb_build_object('item', null, 'children', jsonb_build_object('initiatives', 0, 'tasks', 0), 'legacyProtected', false);
  end if;

  select * into v_epic
  from public.tasks
  where id = v_canonical_id
    and project_id = 'findmydoc-founder-execution'
    and task_type = 'epic'
    and trashed_at is null;
  if not found then
    return jsonb_build_object('item', null, 'children', jsonb_build_object('initiatives', 0, 'tasks', 0), 'legacyProtected', false);
  end if;

  with recursive descendants as (
    select id, task_type
    from public.tasks
    where parent_task_id = v_canonical_id and trashed_at is null
    union all
    select child.id, child.task_type
    from public.tasks child
    join descendants parent on child.parent_task_id = parent.id
    where child.trashed_at is null
  )
  select
    count(*) filter (where task_type = 'initiative'),
    count(*) filter (where task_type in ('deliverable', 'sub_issue'))
  into v_initiative_count, v_task_count
  from descendants;

  select exists (
    select 1 from public.planning_item_legacy_ids where task_id = v_canonical_id
  ) into v_legacy_protected;

  return jsonb_build_object(
    'item', to_jsonb(v_epic),
    'children', jsonb_build_object('initiatives', v_initiative_count, 'tasks', v_task_count),
    'legacyProtected', v_legacy_protected
  );
end;
$$;

create or replace function public.delete_empty_epic_with_audit_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_actor_profile_id text,
  p_request_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
  v_task jsonb;
begin
  select public.delete_empty_epic_transaction(
    p_task_id,
    p_expected_updated_at,
    p_actor_profile_id
  ) into v_result;
  v_task := v_result->'task';
  if v_task is null then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    request_ip,
    user_agent
  ) values (
    p_actor_profile_id,
    'milestone.delete',
    'milestone',
    p_task_id,
    v_task,
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'replayed', false,
    'itemType', 'epic',
    'item', v_task,
    'children', jsonb_build_object('initiatives', 0, 'tasks', 0)
  );
end;
$$;

revoke all on function public.prepare_empty_epic_delete(text)
  from public, anon, authenticated;
revoke all on function public.delete_empty_epic_with_audit_transaction(text, timestamptz, text, text, text)
  from public, anon, authenticated;
grant execute on function public.prepare_empty_epic_delete(text)
  to service_role;
grant execute on function public.delete_empty_epic_with_audit_transaction(text, timestamptz, text, text, text)
  to service_role;
