do $$
declare
  v_duplicates text;
begin
  select string_agg(
    format('%s blocked_by %s [%s]', blocked_item_id, blocking_item_id, relationship_ids),
    '; '
    order by blocked_item_id, blocking_item_id
  )
  into v_duplicates
  from (
    select
      case when relation_type = 'blocked_by' then task_id else related_task_id end as blocked_item_id,
      case when relation_type = 'blocked_by' then related_task_id else task_id end as blocking_item_id,
      string_agg(id::text, ',' order by id) as relationship_ids
    from public.task_relationship_edges
    where relation_type in ('blocked_by', 'blocks')
    group by 1, 2
    having count(*) > 1
  ) duplicates;

  if v_duplicates is not null then
    raise exception using
      errcode = '23505',
      message = 'semantic planning dependency duplicates must be resolved before migration',
      detail = v_duplicates;
  end if;
end;
$$;

create unique index if not exists task_relationship_edges_unique_directional_dependency
on public.task_relationship_edges (
  (case when relation_type = 'blocked_by' then task_id else related_task_id end),
  (case when relation_type = 'blocked_by' then related_task_id else task_id end)
)
where relation_type in ('blocked_by', 'blocks');

comment on index public.task_relationship_edges_unique_directional_dependency is
  'Prevents duplicate directional dependencies, including inverse blocked_by and blocks storage.';

create or replace function public.prepare_team_planning_dependency_command(
  p_task_id text,
  p_related_task_id text,
  p_relation_id bigint,
  p_relation_type text,
  p_actor_profile_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state jsonb;
  v_existing public.task_relationship_edges%rowtype;
  v_source_id text;
  v_source_parent_id text;
  v_related_id text;
  v_related_parent_id text;
begin
  v_state := public.prepare_planning_relationship_command(
    p_task_id,
    p_related_task_id,
    p_relation_id,
    p_relation_type,
    p_actor_profile_id
  );
  v_state := jsonb_set(v_state, '{teamDependency}', 'true'::jsonb, true);

  if coalesce(v_state->'source'->>'project_id', '') <> 'findmydoc-founder-execution' then
    v_state := jsonb_set(v_state, '{source}', 'null'::jsonb, true);
  end if;
  if coalesce(v_state->'related'->>'project_id', '') <> 'findmydoc-founder-execution' then
    v_state := jsonb_set(v_state, '{related}', 'null'::jsonb, true);
  end if;
  if p_relation_id is not null
     and coalesce(v_state->'relation'->>'relation_type', '') not in ('blocked_by', 'blocks') then
    v_state := jsonb_set(v_state, '{relation}', 'null'::jsonb, true);
    v_state := jsonb_set(v_state, '{related}', 'null'::jsonb, true);
  end if;

  if p_relation_id is null and p_relation_type in ('blocked_by', 'blocks') then
    select * into v_existing
    from public.task_relationship_edges relation
    where (
      relation.task_id = p_task_id
      and relation.related_task_id = p_related_task_id
      and relation.relation_type = p_relation_type
    ) or (
      p_relation_type = 'blocked_by'
      and relation.task_id = p_related_task_id
      and relation.related_task_id = p_task_id
      and relation.relation_type = 'blocks'
    ) or (
      p_relation_type = 'blocks'
      and relation.task_id = p_related_task_id
      and relation.related_task_id = p_task_id
      and relation.relation_type = 'blocked_by'
    )
    order by relation.id
    limit 1;
    if found then
      v_state := jsonb_set(v_state, '{existingRelation}', to_jsonb(v_existing), true);
    end if;
  end if;

  v_source_id := nullif(v_state->'source'->>'id', '');
  v_source_parent_id := nullif(v_state->'source'->>'parent_task_id', '');
  v_related_id := nullif(v_state->'related'->>'id', '');
  v_related_parent_id := nullif(v_state->'related'->>'parent_task_id', '');
  if exists (
    select 1
    from public.tasks task
    where task.id = any(array[v_source_id, v_source_parent_id, v_related_id, v_related_parent_id])
      and task.status = 'Erledigt'
  ) then
    v_state := jsonb_set(v_state, '{completedLocked}', 'true'::jsonb, true);
  end if;

  return v_state;
end;
$$;

revoke all on function public.prepare_team_planning_dependency_command(text, text, bigint, text, text) from public;
revoke all on function public.prepare_team_planning_dependency_command(text, text, bigint, text, text) from anon;
revoke all on function public.prepare_team_planning_dependency_command(text, text, bigint, text, text) from authenticated;
grant execute on function public.prepare_team_planning_dependency_command(text, text, bigint, text, text) to service_role;

create or replace function public.mutate_team_planning_dependency_transaction(
  p_token_id uuid,
  p_idempotency_key uuid,
  p_request_hash text,
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
set search_path = ''
as $$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_request public.team_planning_item_update_requests%rowtype;
  v_source public.tasks%rowtype;
  v_related public.tasks%rowtype;
  v_relation public.task_relationship_edges%rowtype;
  v_role text;
  v_other_task_id text;
  v_result jsonb;
  v_response jsonb;
  v_dependency jsonb;
  v_system_effects jsonb := '[]'::jsonb;
  v_changed boolean;
  v_strategy jsonb;
  v_raci jsonb;
  v_item jsonb;
  v_source_type text;
  v_related_type text;
  v_source_sync_status text;
  v_related_sync_status text;
  v_mutation_expected_updated_at timestamptz;
begin
  if p_token_id is null
     or p_idempotency_key is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$'
     or p_operation not in ('add', 'remove')
     or nullif(trim(coalesce(p_task_id, '')), '') is null
     or p_expected_updated_at is null
     or nullif(trim(coalesce(p_actor_profile_id, '')), '') is null
     or char_length(coalesce(p_note, '')) > 500
     or (p_operation = 'add' and (
       nullif(trim(coalesce(p_related_task_id, '')), '') is null
       or p_relation_type not in ('blocked_by', 'blocks')
       or p_relation_id is not null
     ))
     or (p_operation = 'remove' and (p_relation_id is null or p_relation_id <= 0)) then
    raise exception using errcode = '22023', message = 'team planning dependency input is invalid';
  end if;

  select * into v_token
  from public.team_task_intake_tokens token
  where token.id = p_token_id
    and token.profile_id = p_actor_profile_id
    and token.revoked_at is null
    and token.expires_at > now()
  for update;
  if not found then
    raise exception using errcode = 'P0004', message = 'planning items token is inactive';
  end if;
  if not ('write:planning-items:update' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning items update scope is missing';
  end if;
  select profile.platform_role into v_role
  from public.profiles profile
  where profile.id = p_actor_profile_id
  for share;
  if not found or v_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'planning items profile role is not allowed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'planning-items-update:' || p_token_id::text || ':' || p_idempotency_key::text,
    0
  ));
  select * into v_request
  from public.team_planning_item_update_requests request
  where request.token_id = p_token_id
    and request.idempotency_key = p_idempotency_key;
  if found then
    if v_request.request_hash <> p_request_hash then
      raise exception using errcode = 'P0003', message = 'idempotency key conflict';
    end if;
    return jsonb_set(v_request.response, '{replayed}', 'true'::jsonb, true);
  end if;

  select * into v_source
  from public.tasks task
  where task.id = p_task_id
    and task.project_id = 'findmydoc-founder-execution';
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;

  if p_operation = 'remove' then
    select * into v_relation
    from public.task_relationship_edges relation
    where relation.id = p_relation_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'planning relationship not found';
    end if;
    if v_relation.relation_type not in ('blocked_by', 'blocks') then
      raise exception using errcode = 'P0002', message = 'planning dependency not found';
    end if;
    if v_relation.task_id <> p_task_id and v_relation.related_task_id <> p_task_id then
      raise exception using errcode = 'P0006', message = 'planning relationship does not belong to task';
    end if;
    v_other_task_id := case
      when v_relation.task_id = p_task_id then v_relation.related_task_id
      else v_relation.task_id
    end;
  else
    v_other_task_id := p_related_task_id;
  end if;

  select * into v_related
  from public.tasks task
  where task.id = v_other_task_id
    and task.project_id = 'findmydoc-founder-execution';
  if not found then
    raise exception using errcode = 'P0002', message = 'related planning item not found';
  end if;

  perform 1
  from public.tasks task
  where task.id = any(array[p_task_id, v_other_task_id])
  order by task.id
  for update;
  select * into v_source
  from public.tasks task
  where task.id = p_task_id
    and task.project_id = 'findmydoc-founder-execution';
  select * into v_related
  from public.tasks task
  where task.id = v_other_task_id
    and task.project_id = 'findmydoc-founder-execution';
  v_source_type := v_source.task_type;
  v_related_type := v_related.task_type;
  v_source_sync_status := v_source.github_issue_sync_status;
  v_related_sync_status := v_related.github_issue_sync_status;
  v_mutation_expected_updated_at := p_expected_updated_at;
  if p_operation = 'add' then
    select * into v_relation
    from public.task_relationship_edges relation
    where (
      relation.task_id = p_task_id
      and relation.related_task_id = p_related_task_id
      and relation.relation_type = p_relation_type
    ) or (
      p_relation_type = 'blocked_by'
      and relation.task_id = p_related_task_id
      and relation.related_task_id = p_task_id
      and relation.relation_type = 'blocks'
    ) or (
      p_relation_type = 'blocks'
      and relation.task_id = p_related_task_id
      and relation.related_task_id = p_task_id
      and relation.relation_type = 'blocked_by'
    )
    order by relation.id
    limit 1;
    if found then
      v_mutation_expected_updated_at := v_source.updated_at;
    end if;
  end if;

  begin
    v_result := public.mutate_planning_relationship_transaction(
      p_operation,
      p_task_id,
      p_related_task_id,
      p_relation_type,
      p_relation_id,
      p_note,
      v_mutation_expected_updated_at,
      p_actor_profile_id,
      p_request_ip,
      p_user_agent
    );
    v_changed := true;
  exception
    when sqlstate 'P0003' or unique_violation then
      if p_operation <> 'add' then raise; end if;
      select * into v_relation
      from public.task_relationship_edges relation
      where (
        relation.task_id = p_task_id
        and relation.related_task_id = p_related_task_id
        and relation.relation_type = p_relation_type
      ) or (
        p_relation_type = 'blocked_by'
        and relation.task_id = p_related_task_id
        and relation.related_task_id = p_task_id
        and relation.relation_type = 'blocks'
      ) or (
        p_relation_type = 'blocks'
        and relation.task_id = p_related_task_id
        and relation.related_task_id = p_task_id
        and relation.relation_type = 'blocked_by'
      )
      order by relation.id
      limit 1;
      if not found then raise; end if;
      v_result := jsonb_build_object(
        'operation', p_operation,
        'relation', to_jsonb(v_relation),
        'affectedItemIds', jsonb_build_array(v_relation.task_id, v_relation.related_task_id)
      );
      v_changed := false;
  end;
  select * into v_relation
  from jsonb_populate_record(null::public.task_relationship_edges, v_result->'relation');
  if v_relation.id is null then
    raise exception using errcode = 'P0002', message = 'planning relationship result is incomplete';
  end if;
  if v_changed then
    update public.tasks
    set updated_at = clock_timestamp()
    where id = any(array[v_relation.task_id, v_relation.related_task_id])
      and task_type in ('epic', 'initiative');
  end if;
  select * into v_source from public.tasks where id = p_task_id;

  v_dependency := jsonb_build_object(
    'relationshipId', v_relation.id,
    'blockedItemId', case when v_relation.relation_type = 'blocked_by' then v_relation.task_id else v_relation.related_task_id end,
    'blockingItemId', case when v_relation.relation_type = 'blocked_by' then v_relation.related_task_id else v_relation.task_id end,
    'note', v_relation.note
  );
  if v_changed then
    v_system_effects := jsonb_build_array(
      jsonb_build_object(
        'field', 'dependencies',
        'before', case when p_operation = 'remove' then v_dependency else null end,
        'after', case when p_operation = 'add' then v_dependency else null end,
        'reason', case when p_operation = 'add' then 'Aufgabenabhängigkeit wird hinzugefügt.' else 'Aufgabenabhängigkeit wird entfernt.' end
      )
    );
    if v_source_type in ('deliverable', 'sub_issue')
       and v_source_sync_status is distinct from 'not_synced' then
      v_system_effects := v_system_effects || jsonb_build_array(
        jsonb_build_object(
          'field', 'githubIssueSyncStatus:' || p_task_id,
          'before', v_source_sync_status,
          'after', 'not_synced',
          'reason', 'Die GitHub-Projektion dieses Planungselements wird als nicht synchron markiert.'
        )
      );
    end if;
    if v_related_type in ('deliverable', 'sub_issue')
       and v_related_sync_status is distinct from 'not_synced' then
      v_system_effects := v_system_effects || jsonb_build_array(
        jsonb_build_object(
          'field', 'githubIssueSyncStatus:' || v_other_task_id,
          'before', v_related_sync_status,
          'after', 'not_synced',
          'reason', 'Die GitHub-Projektion dieses Planungselements wird als nicht synchron markiert.'
        )
      );
    end if;
  end if;

  v_item := to_jsonb(v_source);
  if v_source.task_type = 'initiative' then
    select jsonb_build_object(
      'goal', coalesce(strategy.goal, ''),
      'successCriteria', coalesce(strategy.success_criteria, ''),
      'scopeConstraints', coalesce(strategy.scope_constraints, '')
    ) into v_strategy
    from public.planning_item_strategy strategy
    where strategy.task_id = p_task_id;
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'profileId', assignment.profile_id,
        'role', assignment.role,
        'sortOrder', assignment.sort_order
      ) order by assignment.role, assignment.sort_order
    ), '[]'::jsonb) into v_raci
    from public.planning_item_raci_assignments assignment
    where assignment.task_id = p_task_id;
    v_item := v_item || jsonb_build_object(
      'goal', coalesce(v_strategy->>'goal', ''),
      'success_criteria', coalesce(v_strategy->>'successCriteria', ''),
      'scope_constraints', coalesce(v_strategy->>'scopeConstraints', ''),
      'raci_assignments', coalesce(v_raci, '[]'::jsonb)
    );
  end if;

  v_response := jsonb_build_object(
    'commandKind', 'dependency',
    'replayed', false,
    'itemType', v_source.task_type,
    'item', v_item,
    'changedFields', case when v_changed then jsonb_build_array('dependencies') else '[]'::jsonb end,
    'systemEffects', v_system_effects,
    'warnings', case when v_changed then '[]'::jsonb else jsonb_build_array('Die Aufgabenabhängigkeit besteht bereits und bleibt unverändert.') end,
    'dependencyChange', jsonb_build_object(
      'operation', p_operation,
      'changed', v_changed,
      'relationship', v_dependency
    ),
    'relation', to_jsonb(v_relation),
    'changed', v_changed
  );

  insert into public.team_planning_item_update_requests (
    token_id,
    profile_id,
    item_type,
    item_id,
    expected_updated_at,
    idempotency_key,
    request_hash,
    response,
    contract_version
  ) values (
    p_token_id,
    p_actor_profile_id,
    v_source.task_type,
    p_task_id,
    p_expected_updated_at,
    p_idempotency_key,
    p_request_hash,
    v_response,
    3
  );

  return v_response;
end;
$$;

revoke all on function public.mutate_team_planning_dependency_transaction(uuid, uuid, text, text, text, text, text, bigint, text, timestamptz, text, text, text) from public;
revoke all on function public.mutate_team_planning_dependency_transaction(uuid, uuid, text, text, text, text, text, bigint, text, timestamptz, text, text, text) from anon;
revoke all on function public.mutate_team_planning_dependency_transaction(uuid, uuid, text, text, text, text, text, bigint, text, timestamptz, text, text, text) from authenticated;
grant execute on function public.mutate_team_planning_dependency_transaction(uuid, uuid, text, text, text, text, text, bigint, text, timestamptz, text, text, text) to service_role;

comment on function public.mutate_team_planning_dependency_transaction(uuid, uuid, text, text, text, text, text, bigint, text, timestamptz, text, text, text) is
  'Atomically mutates a Planning Items API dependency and stores its idempotent update response.';
