create or replace function public.prepare_planning_relationship_command(
  p_task_id text,
  p_related_task_id text,
  p_relation_id bigint,
  p_relation_type text,
  p_actor_profile_id text
) returns jsonb
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_source public.tasks%rowtype;
  v_related public.tasks%rowtype;
  v_relation public.task_relationship_edges%rowtype;
  v_existing public.task_relationship_edges%rowtype;
  v_actor_name text;
  v_initiative_id text;
  v_initiative public.tasks%rowtype;
  v_accountable_profile_id text;
  v_other_task_id text;
  v_review_locked boolean := false;
  v_final_review_locked boolean := false;
begin
  if nullif(trim(coalesce(p_task_id, '')), '') is null
     or nullif(trim(coalesce(p_actor_profile_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'planning relationship preparation input is invalid';
  end if;

  select name into v_actor_name
  from public.profiles
  where id = p_actor_profile_id;

  select * into v_source
  from public.tasks
  where id = p_task_id;

  if p_relation_id is not null then
    select * into v_relation
    from public.task_relationship_edges
    where id = p_relation_id;
    if found then
      v_other_task_id := case
        when v_relation.task_id = p_task_id then v_relation.related_task_id
        when v_relation.related_task_id = p_task_id then v_relation.task_id
        else null
      end;
    end if;
  else
    v_other_task_id := nullif(trim(coalesce(p_related_task_id, '')), '');
  end if;

  if v_other_task_id is not null then
    select * into v_related
    from public.tasks
    where id = v_other_task_id;
  end if;

  if p_relation_id is null and v_source.id is not null and v_related.id is not null then
    select * into v_existing
    from public.task_relationship_edges
    where task_id = v_source.id
      and related_task_id = v_related.id
      and relation_type = p_relation_type
    order by id
    limit 1;
  end if;

  if v_source.task_type = 'initiative' then
    v_initiative_id := v_source.id;
  elsif v_source.task_type = 'deliverable' then
    v_initiative_id := v_source.parent_task_id;
  elsif v_source.task_type = 'sub_issue' and v_source.parent_task_id is not null then
    select parent_task_id into v_initiative_id
    from public.tasks
    where id = v_source.parent_task_id and task_type = 'deliverable';
  end if;

  if v_initiative_id is not null then
    select * into v_initiative
    from public.tasks
    where id = v_initiative_id and task_type = 'initiative' and trashed_at is null;
    select profile_id into v_accountable_profile_id
    from public.planning_item_raci_assignments
    where task_id = v_initiative_id and role = 'accountable'
    order by sort_order, profile_id
    limit 1;
  end if;

  if v_source.id is not null then
    select exists (
      select 1
      from public.tasks candidate
      where candidate.id = any(array[
        v_source.id,
        v_source.parent_task_id,
        v_related.id,
        v_related.parent_task_id
      ])
        and (
          (candidate.review_status = 'requested' and not coalesce(candidate.score_final, false))
          or (candidate.review_status = 'accepted' and coalesce(candidate.score_final, false))
        )
    ) into v_review_locked;
    select exists (
      select 1
      from public.tasks candidate
      where candidate.id = any(array[
        v_source.id,
        v_source.parent_task_id,
        v_related.id,
        v_related.parent_task_id
      ])
        and candidate.review_status = 'accepted'
        and coalesce(candidate.score_final, false)
    ) into v_final_review_locked;
  end if;

  return jsonb_build_object(
    'source', case when v_source.id is null then null else to_jsonb(v_source) end,
    'related', case when v_related.id is null then null else to_jsonb(v_related) end,
    'relation', case when v_relation.id is null then null else to_jsonb(v_relation) end,
    'existingRelation', case when v_existing.id is null then null else to_jsonb(v_existing) end,
    'actorName', coalesce(v_actor_name, ''),
    'initiative', case when v_initiative.id is null then null else jsonb_build_object(
      'id', v_initiative.id,
      'ownerId', coalesce(v_initiative.owner, ''),
      'accountableProfileId', coalesce(v_accountable_profile_id, v_initiative.owner, '')
    ) end,
    'reviewLocked', v_review_locked,
    'finalReviewLocked', v_final_review_locked
  );
end;
$$;

create or replace function public.mutate_planning_relationship_transaction(
  p_operation text,
  p_task_id text,
  p_related_task_id text,
  p_relation_type text,
  p_relation_id bigint,
  p_note text,
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
  v_actor public.profiles%rowtype;
  v_source public.tasks%rowtype;
  v_related public.tasks%rowtype;
  v_relation public.task_relationship_edges%rowtype;
  v_initiative_id text;
  v_initiative public.tasks%rowtype;
  v_accountable_profile_id text;
  v_other_task_id text;
  v_can_manage_all boolean := false;
  v_can_manage_blocked_by boolean := false;
  v_review_locked boolean := false;
begin
  if p_operation not in ('add', 'remove')
     or nullif(trim(coalesce(p_task_id, '')), '') is null
     or nullif(trim(coalesce(p_actor_profile_id, '')), '') is null
     or (p_operation = 'add' and (
       nullif(trim(coalesce(p_related_task_id, '')), '') is null
       or p_relation_type not in ('blocked_by', 'blocks', 'relates_to')
       or p_relation_id is not null
     ))
     or (p_operation = 'remove' and (p_relation_id is null or p_relation_id <= 0))
     or char_length(coalesce(p_note, '')) > 500 then
    raise exception using errcode = '22023', message = 'planning relationship command is invalid';
  end if;

  select * into v_actor
  from public.profiles
  where id = p_actor_profile_id
  for share;
  if not found or v_actor.platform_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'planning relationship actor is forbidden';
  end if;
  v_can_manage_all := v_actor.platform_role in ('ceo', 'deputy');

  if p_operation = 'remove' then
    select * into v_relation
    from public.task_relationship_edges
    where id = p_relation_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'planning relationship not found';
    end if;
    if v_relation.task_id <> p_task_id and v_relation.related_task_id <> p_task_id then
      raise exception using errcode = 'P0006', message = 'planning relationship does not belong to task';
    end if;
    v_other_task_id := case
      when v_relation.task_id = p_task_id then v_relation.related_task_id
      else v_relation.task_id
    end;
  else
    if p_related_task_id = p_task_id then
      raise exception using errcode = '22023', message = 'planning item cannot relate to itself';
    end if;
    v_other_task_id := p_related_task_id;
  end if;

  perform 1
  from public.tasks
  where id = any(array[p_task_id, v_other_task_id])
  order by id
  for update;

  select * into v_source
  from public.tasks
  where id = p_task_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_source.trashed_at is not null then
    raise exception using errcode = 'P0010', message = 'planning item is trashed';
  end if;
  select * into v_related
  from public.tasks
  where id = v_other_task_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'related planning item not found';
  end if;
  if v_related.trashed_at is not null then
    raise exception using errcode = 'P0011', message = 'related planning item is trashed';
  end if;
  if p_expected_updated_at is not null and v_source.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;

  if v_source.task_type = 'initiative' then
    v_initiative_id := v_source.id;
  elsif v_source.task_type = 'deliverable' then
    v_initiative_id := v_source.parent_task_id;
  elsif v_source.task_type = 'sub_issue' and v_source.parent_task_id is not null then
    select parent_task_id into v_initiative_id
    from public.tasks
    where id = v_source.parent_task_id and task_type = 'deliverable';
  end if;
  if v_initiative_id is not null then
    select * into v_initiative
    from public.tasks
    where id = v_initiative_id and task_type = 'initiative' and trashed_at is null;
    select profile_id into v_accountable_profile_id
    from public.planning_item_raci_assignments
    where task_id = v_initiative_id and role = 'accountable'
    order by sort_order, profile_id
    limit 1;
  end if;

  v_can_manage_blocked_by := v_actor.platform_role = 'founder'
    and v_source.task_type in ('deliverable', 'sub_issue')
    and (
      v_source.assignee in (v_actor.id, v_actor.name)
      or v_source.owner in (v_actor.id, v_actor.name)
      or coalesce(v_accountable_profile_id, v_initiative.owner, '') = v_actor.id
    );

  if p_operation = 'add' then
    if not v_can_manage_all and not (v_can_manage_blocked_by and p_relation_type = 'blocked_by') then
      raise exception using errcode = 'P0006', message = 'planning relationship mutation is forbidden';
    end if;
  elsif not v_can_manage_all and not (
    v_can_manage_blocked_by
    and v_relation.task_id = p_task_id
    and v_relation.relation_type = 'blocked_by'
  ) then
    raise exception using errcode = 'P0006', message = 'planning relationship removal is forbidden';
  end if;

  select exists (
    select 1
    from public.tasks candidate
    where candidate.id = any(array[
      v_source.id,
      v_source.parent_task_id,
      v_related.id,
      v_related.parent_task_id
    ])
      and (
        (candidate.review_status = 'requested' and not coalesce(candidate.score_final, false))
        or (candidate.review_status = 'accepted' and coalesce(candidate.score_final, false))
      )
  ) into v_review_locked;
  if v_review_locked then
    raise exception using errcode = 'P0008', message = 'planning relationship is review locked';
  end if;

  if p_operation = 'add' then
    if exists (
      select 1
      from public.task_relationship_edges
      where task_id = p_task_id
        and related_task_id = p_related_task_id
        and relation_type = p_relation_type
    ) then
      raise exception using errcode = 'P0003', message = 'planning relationship already exists';
    end if;
    insert into public.task_relationship_edges (
      task_id,
      related_task_id,
      relation_type,
      note,
      created_by
    ) values (
      p_task_id,
      p_related_task_id,
      p_relation_type,
      nullif(trim(coalesce(p_note, '')), ''),
      p_actor_profile_id
    )
    returning * into v_relation;
  else
    delete from public.task_relationship_edges
    where id = p_relation_id
    returning * into v_relation;
    if not found then
      raise exception using errcode = 'P0002', message = 'planning relationship not found';
    end if;
  end if;

  update public.tasks
  set github_issue_sync_status = 'not_synced',
      github_issue_sync_error = null,
      updated_at = clock_timestamp()
  where id = any(array[v_relation.task_id, v_relation.related_task_id])
    and task_type in ('deliverable', 'sub_issue');

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
    case when p_operation = 'add' then 'task.relationship_created' else 'task.relationship_deleted' end,
    'task',
    p_task_id,
    case when p_operation = 'remove' then to_jsonb(v_relation) else null end,
    case when p_operation = 'add' then jsonb_build_object(
      'relationType', v_relation.relation_type,
      'relatedTaskId', v_relation.related_task_id,
      'note', coalesce(v_relation.note, '')
    ) else null end,
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'operation', p_operation,
    'relation', to_jsonb(v_relation),
    'affectedItemIds', jsonb_build_array(v_relation.task_id, v_relation.related_task_id)
  );
end;
$$;

revoke all on function public.prepare_planning_relationship_command(text, text, bigint, text, text)
  from public, anon, authenticated;
revoke all on function public.mutate_planning_relationship_transaction(text, text, text, text, bigint, text, timestamptz, text, text, text)
  from public, anon, authenticated;
grant execute on function public.prepare_planning_relationship_command(text, text, bigint, text, text)
  to service_role;
grant execute on function public.mutate_planning_relationship_transaction(text, text, text, text, bigint, text, timestamptz, text, text, text)
  to service_role;

-- Browser mutations now go through the atomic command transaction. Keep reads
-- available to mapped sessions but close the former direct-write bypass.
revoke insert, update, delete on table public.task_relationship_edges from authenticated;
revoke update on sequence public.task_relationship_edges_id_seq from authenticated;
