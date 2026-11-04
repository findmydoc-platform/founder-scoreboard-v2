-- Keep personal Planning evidence in the same transaction as its task revision.
create or replace function public.has_valid_planning_review_evidence(
  p_task_id text,
  p_evidence_link_override text
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  with parent as (
    select id, task_type, project_id
    from public.tasks
    where id = p_task_id and trashed_at is null
  ), evidence_tasks as (
    select task.id,
           case when task.id = parent.id then p_evidence_link_override else task.evidence_link end as evidence_link
    from public.tasks task
    join parent on task.id = parent.id
      or (
        parent.task_type = 'deliverable'
        and task.task_type = 'sub_issue'
        and task.parent_task_id = parent.id
        and task.project_id = parent.project_id
      )
    where task.trashed_at is null
  )
  select exists (
    select 1 from evidence_tasks where evidence_link ~* '^https?://'
  ) or exists (
    select 1
    from public.task_links link
    join evidence_tasks task on task.id = link.task_id
    where link.type in ('evidence', 'github_pull_request')
      and not (link.task_id = p_task_id and link.type = 'evidence')
      and link.url ~* '^https?://'
      and (
        link.type = 'evidence'
        or (
          nullif(trim(link.metadata->>'repository'), '') is not null
          and link.metadata->>'number' ~ '^[1-9][0-9]*$'
          and link.metadata->>'status' in ('open', 'merged', 'closed')
        )
      )
  );
$$;

revoke all on function public.has_valid_planning_review_evidence(text, text) from public;
grant execute on function public.has_valid_planning_review_evidence(text, text) to service_role;

CREATE OR REPLACE FUNCTION "public"."update_team_planning_item_transaction_without_completed_guard"("p_token_id" "uuid", "p_profile_id" "text", "p_item_type" "text", "p_item_id" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_patch" "jsonb" DEFAULT '{}'::"jsonb", "p_changed_fields" "jsonb" DEFAULT '[]'::"jsonb", "p_system_effects" "jsonb" DEFAULT '[]'::"jsonb", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_request public.team_planning_item_update_requests%rowtype;
  v_role text;
  v_type text := case nullif(trim(coalesce(p_item_type, '')), '') when 'milestone' then 'epic' else nullif(trim(coalesce(p_item_type, '')), '') end;
  v_task public.tasks%rowtype;
  v_updated_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_review_owner text;
  v_review_owner_role text;
  v_review_status text;
  v_review_requested_at timestamptz;
  v_score_points integer;
  v_score_final boolean;
  v_sprint_locked boolean := false;
  v_parent_review_locked boolean := false;
  v_review_request_started boolean := false;
  v_response jsonb;
  v_before jsonb;
  v_strategy jsonb;
  v_raci jsonb;
  v_allowed text[];
  v_status text;
begin
  if p_token_id is null
     or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or v_type not in ('epic', 'initiative', 'deliverable', 'sub_issue')
     or nullif(trim(coalesce(p_item_id, '')), '') is null
     or p_expected_updated_at is null
     or p_idempotency_key is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_changed_fields, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_system_effects, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'planning items update input is invalid';
  end if;

  select * into v_token from public.team_task_intake_tokens
  where id = p_token_id and profile_id = p_profile_id and revoked_at is null and expires_at > now()
  for update;
  if not found then raise exception using errcode = 'P0004', message = 'planning items token is inactive'; end if;
  if not ('write:planning-items:update' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning items update scope is missing';
  end if;
  select platform_role into v_role from public.profiles where id = p_profile_id for share;
  if not found or v_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'planning items profile role is not allowed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('planning-items-update:' || p_token_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_request from public.team_planning_item_update_requests
  where token_id = p_token_id and idempotency_key = p_idempotency_key;
  if found then
    if v_request.request_hash <> p_request_hash then
      raise exception using errcode = 'P0003', message = 'idempotency key conflict';
    end if;
    return jsonb_set(v_request.response, '{replayed}', 'true'::jsonb, true);
  end if;

  select * into v_task from public.tasks
  where id = p_item_id and project_id = 'findmydoc-founder-execution' and trashed_at is null
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  if v_task.task_type <> v_type then raise exception using errcode = '22023', message = 'planning item type does not match'; end if;
  if v_task.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;
  if v_type = 'epic' and v_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'epic update requires ceo or deputy';
  end if;
  if v_role = 'founder' and v_type = 'initiative' and v_task.owner <> p_profile_id then
    raise exception using errcode = 'P0007', message = 'founder may only update owned initiatives';
  end if;
  if v_role = 'founder' and v_type in ('deliverable', 'sub_issue')
     and v_task.owner <> p_profile_id and v_task.assignee <> p_profile_id
     and not (v_type = 'sub_issue' and p_patch ? 'status' and p_patch - 'status' = '{}'::jsonb) then
    raise exception using errcode = 'P0007', message = 'founder may only update owned planning tasks';
  end if;

  v_allowed := case v_type
    when 'epic' then array['title', 'description', 'status', 'target_date']
    when 'initiative' then array['title', 'description', 'status', 'priority', 'owner', 'assignee', 'target_date', 'parent_task_id', 'strategy', 'raciAssignments']
    when 'deliverable' then array['title', 'description', 'status', 'priority', 'owner', 'assignee', 'parent_task_id', 'workstream', 'fixed_date', 'estimate_hours', 'problem_statement', 'intended_outcome', 'scope_constraints', 'acceptance_criteria', 'evidence_required', 'definition_of_done', 'evidence_link', 'review_evidence_exception_note', 'review_evidence_exception_confirmed_at']
    else array['title', 'description', 'status', 'owner', 'assignee', 'parent_task_id', 'problem_statement', 'intended_outcome', 'scope_constraints', 'acceptance_criteria', 'evidence_required', 'definition_of_done', 'github_repo']
  end;
  if exists (select 1 from jsonb_object_keys(p_patch) key where not (key = any(v_allowed))) then
    raise exception using errcode = '22023', message = 'planning item patch contains an unsupported field';
  end if;
  if p_patch ?| array['review_evidence_exception_note', 'review_evidence_exception_confirmed_at']
     and coalesce(p_patch->>'status', '') <> 'Review' then
    raise exception using errcode = '22023', message = 'review evidence exceptions require a review request';
  end if;
  if v_type in ('deliverable', 'sub_issue') and p_patch ? 'parent_task_id'
     and (select count(*) from jsonb_object_keys(p_patch)) > 1 then
    raise exception using errcode = '23514', message = 'planning item parent must be changed separately';
  end if;
  if p_patch ? 'status' then
    v_status := nullif(trim(p_patch->>'status'), '');
    if (v_type in ('epic', 'initiative') and v_status not in ('Offen', 'In Arbeit', 'Pausiert', 'Blockiert', 'Erledigt'))
       or (v_type = 'deliverable' and v_status not in ('Offen', 'In Arbeit', 'Review', 'Nacharbeit', 'Blockiert', 'Erledigt'))
       or (v_type = 'sub_issue' and v_status not in ('Offen', 'In Arbeit', 'Blockiert', 'Erledigt')) then
      raise exception using errcode = '22023', message = 'planning item status is invalid';
    end if;
    if v_status is distinct from v_task.status and v_type = 'deliverable' then
      if v_status = 'Erledigt' and v_role <> 'ceo' then
        raise exception using errcode = 'P0007', message = 'only ceo may complete a deliverable finally';
      end if;
      if v_task.status = 'Erledigt' and v_status <> 'Erledigt' and v_role <> 'ceo' then
        raise exception using errcode = 'P0007', message = 'only ceo may reopen a completed deliverable';
      end if;
      if v_role = 'founder' and v_task.status = 'Nacharbeit' and v_status not in ('In Arbeit', 'Review', 'Blockiert') then
        raise exception using errcode = 'P0007', message = 'founder may only resume, block, or review rework';
      end if;
    end if;
  end if;
  if p_patch ? 'parent_task_id' and nullif(trim(coalesce(p_patch->>'parent_task_id', '')), '') is not null then
    select * into v_parent from public.tasks where id = nullif(trim(p_patch->>'parent_task_id'), '') and trashed_at is null for share;
    if not found
       or (v_type = 'initiative' and v_parent.task_type <> 'epic')
       or (v_type = 'deliverable' and (v_parent.task_type <> 'initiative' or v_parent.approval_status = 'rejected'))
       or (v_type = 'sub_issue' and (v_parent.task_type <> 'deliverable' or v_parent.approval_status <> 'approved')) then
      raise exception using errcode = '23514', message = 'planning item parent has the wrong type or approval state';
    end if;
  elsif v_type = 'sub_issue' and p_patch ? 'parent_task_id' then
    raise exception using errcode = '23514', message = 'sub-issue requires a deliverable parent';
  end if;

  if v_type = 'sub_issue' then
    select * into v_parent
    from public.tasks
    where id = coalesce(nullif(trim(coalesce(p_patch->>'parent_task_id', '')), ''), v_task.parent_task_id)
      and trashed_at is null
    for share;
    if not found or v_parent.task_type <> 'deliverable' or v_parent.approval_status <> 'approved' then
      raise exception using errcode = 'P0008', message = 'sub-issue parent must be an approved deliverable';
    end if;
    v_parent_review_locked := (v_parent.review_status = 'requested' and not coalesce(v_parent.score_final, false))
      or (v_parent.review_status = 'accepted' and coalesce(v_parent.score_final, false));
    if v_parent_review_locked and p_patch <> '{}'::jsonb then
      raise exception using errcode = '23514', message = 'parent deliverable review is locked';
    end if;
  end if;

  if v_type = 'deliverable'
     and p_patch <> '{}'::jsonb
     and ((v_task.review_status = 'requested' and not coalesce(v_task.score_final, false))
       or (v_task.review_status = 'accepted' and coalesce(v_task.score_final, false))) then
    raise exception using errcode = '23514', message = 'deliverable review is locked';
  end if;

  v_review_owner := v_task.review_owner_profile_id;
  v_review_status := v_task.review_status;
  v_review_requested_at := v_task.review_requested_at;
  v_score_points := v_task.score_points;
  v_score_final := v_task.score_final;
  if v_type = 'deliverable' and p_patch ? 'status' and p_patch->>'status' = 'Review' then
    if v_task.approval_status <> 'approved' then
      raise exception using errcode = '23514', message = 'only approved deliverables can enter review';
    end if;
    if v_task.score_final then
      raise exception using errcode = '23514', message = 'final deliverable must use review reopen';
    end if;
    if v_task.sprint_id is not null then
      select coalesce(score_locked, false) into v_sprint_locked from public.sprints where id = v_task.sprint_id;
      if v_sprint_locked then
        raise exception using errcode = '23514', message = 'sprint score is locked';
      end if;
    end if;
    if v_review_owner is null and v_task.parent_task_id is not null then
      select profile_id into v_review_owner
      from public.planning_item_raci_assignments
      where task_id = v_task.parent_task_id and role = 'accountable'
      order by sort_order, profile_id
      limit 1;
    end if;
    if v_review_owner is null and v_task.parent_task_id is not null then
      select owner into v_review_owner from public.tasks where id = v_task.parent_task_id;
    end if;
    if v_review_owner is null then
      raise exception using errcode = '23514', message = 'review owner is required';
    end if;
    select platform_role into v_review_owner_role from public.profiles where id = v_review_owner for share;
    if v_review_owner_role is null or v_review_owner_role = 'viewer' then
      raise exception using errcode = '23514', message = 'review owner must have a contributor role';
    end if;
    v_review_status := 'requested';
    v_review_requested_at := clock_timestamp();
    v_score_points := 0;
    v_score_final := false;
    v_review_request_started := true;
  elsif v_type = 'deliverable' and p_patch ? 'status' and v_task.status = 'Erledigt' and p_patch->>'status' <> 'Erledigt' then
    v_review_status := 'not_requested';
    v_review_requested_at := null;
    v_score_final := false;
  elsif v_type = 'deliverable' and p_patch ? 'status' and v_task.status = 'Review' and p_patch->>'status' <> 'Review' then
    v_review_status := 'not_requested';
    v_review_requested_at := null;
  end if;

  v_before := to_jsonb(v_task);
  perform set_config('app.actor_profile_id', p_profile_id, true);
  if p_patch ? 'evidence_link' then
    perform public.replace_task_evidence_links(
      p_item_id,
      case when nullif(trim(coalesce(p_patch->>'evidence_link', '')), '') is null
        then '[]'::jsonb
        else jsonb_build_array(trim(p_patch->>'evidence_link'))
      end
    );
    -- The existing review gate must observe the resulting legacy link as well.
    -- Authorization, the revision check and the row lock already succeeded.
    update public.tasks
    set evidence_link = nullif(trim(coalesce(p_patch->>'evidence_link', '')), '')
    where id = p_item_id;
  end if;

  if p_patch <> '{}'::jsonb then
    update public.tasks
    set title = case when p_patch ? 'title' then nullif(trim(p_patch->>'title'), '') else v_task.title end,
        description = case when p_patch ? 'description' then nullif(trim(coalesce(p_patch->>'description', '')), '') else v_task.description end,
        status = case when p_patch ? 'status' then nullif(trim(p_patch->>'status'), '') else v_task.status end,
        priority = case when v_type = 'epic' then null when p_patch ? 'priority' then nullif(trim(p_patch->>'priority'), '') else v_task.priority end,
        owner = case when p_patch ? 'owner' then nullif(trim(p_patch->>'owner'), '') else v_task.owner end,
        assignee = case when p_patch ? 'assignee' then nullif(trim(p_patch->>'assignee'), '') else v_task.assignee end,
        target_date = case when p_patch ? 'target_date' then nullif(trim(coalesce(p_patch->>'target_date', '')), '')::date else v_task.target_date end,
        parent_task_id = case when p_patch ? 'parent_task_id' then nullif(trim(coalesce(p_patch->>'parent_task_id', '')), '') else v_task.parent_task_id end,
        workstream = case when p_patch ? 'workstream' then nullif(trim(coalesce(p_patch->>'workstream', '')), '') else v_task.workstream end,
        fixed_date = case when p_patch ? 'fixed_date' then nullif(trim(coalesce(p_patch->>'fixed_date', '')), '')::date else v_task.fixed_date end,
        estimate_hours = case when p_patch ? 'estimate_hours' then coalesce((p_patch->>'estimate_hours')::integer, 0) else v_task.estimate_hours end,
        problem_statement = case when p_patch ? 'problem_statement' then nullif(trim(coalesce(p_patch->>'problem_statement', '')), '') else v_task.problem_statement end,
        intended_outcome = case when p_patch ? 'intended_outcome' then nullif(trim(coalesce(p_patch->>'intended_outcome', '')), '') else v_task.intended_outcome end,
        scope_constraints = case when p_patch ? 'scope_constraints' then nullif(trim(coalesce(p_patch->>'scope_constraints', '')), '') else v_task.scope_constraints end,
        acceptance_criteria = case when p_patch ? 'acceptance_criteria' then nullif(trim(coalesce(p_patch->>'acceptance_criteria', '')), '') else v_task.acceptance_criteria end,
        evidence_required = case when p_patch ? 'evidence_required' then nullif(trim(coalesce(p_patch->>'evidence_required', '')), '') else v_task.evidence_required end,
        definition_of_done = case when p_patch ? 'definition_of_done' then nullif(trim(coalesce(p_patch->>'definition_of_done', '')), '') else v_task.definition_of_done end,
        evidence_link = case when p_patch ? 'evidence_link' then nullif(trim(coalesce(p_patch->>'evidence_link', '')), '') else v_task.evidence_link end,
        review_evidence_exception_note = case when p_patch ? 'review_evidence_exception_note' then nullif(trim(p_patch->>'review_evidence_exception_note'), '') else v_task.review_evidence_exception_note end,
        review_evidence_exception_confirmed_at = case when p_patch ? 'review_evidence_exception_confirmed_at' then (p_patch->>'review_evidence_exception_confirmed_at')::timestamptz else v_task.review_evidence_exception_confirmed_at end,
        github_repo = case when p_patch ? 'github_repo' then nullif(trim(coalesce(p_patch->>'github_repo', '')), '') else v_task.github_repo end,
        review_status = v_review_status,
        review_owner_profile_id = v_review_owner,
        review_requested_at = v_review_requested_at,
        score_points = v_score_points,
        score_final = v_score_final,
        github_issue_sync_status = case when v_type in ('deliverable', 'sub_issue') then 'not_synced' else v_task.github_issue_sync_status end,
        github_issue_sync_error = case when v_type in ('deliverable', 'sub_issue') then null else v_task.github_issue_sync_error end,
        updated_at = clock_timestamp()
    where id = p_item_id
    returning * into v_updated_task;
  else
    v_updated_task := v_task;
  end if;

  if v_type = 'initiative' and p_patch ? 'strategy' then
    if jsonb_typeof(p_patch->'strategy') <> 'object' then
      raise exception using errcode = '22023', message = 'initiative strategy is invalid';
    end if;
    insert into public.planning_item_strategy (task_id, goal, success_criteria, scope_constraints)
    values (p_item_id, coalesce(p_patch->'strategy'->>'goal', ''), coalesce(p_patch->'strategy'->>'successCriteria', ''), coalesce(p_patch->'strategy'->>'scopeConstraints', ''))
    on conflict (task_id) do update set
      goal = excluded.goal,
      success_criteria = excluded.success_criteria,
      scope_constraints = excluded.scope_constraints;
  end if;
  if v_type = 'initiative' and p_patch ? 'raciAssignments' then
    perform public.replace_planning_item_raci_assignments(p_item_id, p_patch->'raciAssignments');
  end if;

  if p_patch ? 'status' and v_updated_task.status is distinct from v_task.status then
    insert into public.task_activity (task_id, message)
    values (p_item_id, 'Status geändert: ' || v_task.status || ' → ' || v_updated_task.status);
  end if;
  if v_review_request_started then
    insert into public.notification_events (
      type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body, dedupe_key
    ) values (
      'task.review_requested', p_profile_id, v_review_owner, 'task', p_item_id,
      'Review angefragt: ' || v_updated_task.title,
      'Diese Aufgabe wartet auf deine Accountable-Review.',
      'team-planning-review:' || p_item_id || ':' || v_review_requested_at::text
    );
  end if;
  if v_type = 'initiative' then
    select jsonb_build_object('goal', goal, 'successCriteria', success_criteria, 'scopeConstraints', scope_constraints)
    into v_strategy from public.planning_item_strategy where task_id = p_item_id;
    select coalesce(jsonb_agg(jsonb_build_object('profileId', profile_id, 'role', role, 'sortOrder', sort_order) order by role, sort_order), '[]'::jsonb)
    into v_raci from public.planning_item_raci_assignments where task_id = p_item_id;
  end if;
  v_response := jsonb_build_object(
    'replayed', false,
    'itemType', v_type,
    'item', to_jsonb(v_updated_task)
      || case when v_type = 'initiative' then jsonb_build_object(
        'goal', coalesce(v_strategy->>'goal', ''),
        'success_criteria', coalesce(v_strategy->>'successCriteria', ''),
        'scope_constraints', coalesce(v_strategy->>'scopeConstraints', ''),
        'raci_assignments', coalesce(v_raci, '[]'::jsonb)
      ) else '{}'::jsonb end,
    'changedFields', coalesce(p_changed_fields, '[]'::jsonb),
    'systemEffects', coalesce(p_system_effects, '[]'::jsonb)
  );
  insert into public.team_planning_item_update_requests (token_id, profile_id, item_type, item_id, expected_updated_at, idempotency_key, request_hash, response)
  values (p_token_id, p_profile_id, v_type, p_item_id, p_expected_updated_at, p_idempotency_key, p_request_hash, v_response);
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data, request_ip, user_agent)
  values (p_profile_id, 'team.planning_items.update', 'task', p_item_id, v_before, v_response->'item', p_request_ip, p_user_agent);
  return v_response;
end;
$_$;

create or replace function public.update_team_planning_item_with_review_evidence_transaction_v1(
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
  p_projection_command jsonb default null,
  p_evidence_exception_note text default null,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_note text := nullif(trim(coalesce(p_evidence_exception_note, '')), '');
begin
  if p_item_type = 'deliverable' and v_patch->>'status' = 'Review' then
    -- Carry review evidence into the guarded revision rather than writing ahead
    -- of its token, ownership, idempotency and optimistic concurrency checks.
    v_patch := v_patch || jsonb_build_object(
      'review_evidence_exception_note', v_note,
      'review_evidence_exception_confirmed_at', case when v_note is not null then clock_timestamp() else null end
    );
  end if;

  return public.update_team_planning_item_with_projection_transaction(
    p_token_id,
    p_profile_id,
    p_item_type,
    p_item_id,
    p_expected_updated_at,
    p_idempotency_key,
    p_request_hash,
    v_patch,
    p_changed_fields,
    p_system_effects,
    p_projection_command,
    p_request_ip,
    p_user_agent
  );
end;
$$;
