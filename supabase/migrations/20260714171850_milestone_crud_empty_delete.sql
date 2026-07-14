-- Milestone CRUD keeps the FounderOps project boundary fixed, serializes
-- server-owned ordering, and rejects deletion while any child still refers
-- to the milestone.

ALTER TABLE public.team_task_intake_tokens
  DROP CONSTRAINT IF EXISTS team_task_intake_tokens_scopes_check;

ALTER TABLE public.team_task_intake_tokens
  ADD CONSTRAINT team_task_intake_tokens_scopes_check CHECK (
    array_position(scopes, NULL::text) IS NULL
    AND scopes <@ ARRAY[
      'read:planning-context',
      'write:planning-items:create',
      'write:planning-items:update',
      'write:planning-items:delete-empty'
    ]::text[]
    AND scopes @> ARRAY[
      'read:planning-context',
      'write:planning-items:create'
    ]::text[]
  );

ALTER TABLE public.team_planning_item_update_requests
  DROP CONSTRAINT IF EXISTS team_planning_item_update_requests_item_type_check;

ALTER TABLE public.team_planning_item_update_requests
  ADD CONSTRAINT team_planning_item_update_requests_item_type_check CHECK (
    item_type IN ('milestone', 'initiative', 'deliverable', 'sub_issue')
  );

ALTER TABLE public.packages
  DROP CONSTRAINT IF EXISTS packages_milestone_id_fkey;

ALTER TABLE public.packages
  ADD CONSTRAINT packages_milestone_id_fkey
  FOREIGN KEY (milestone_id)
  REFERENCES public.milestones(id)
  ON DELETE RESTRICT;

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_milestone_id_fkey;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_milestone_id_fkey
  FOREIGN KEY (milestone_id)
  REFERENCES public.milestones(id)
  ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.touch_milestone_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.create_team_planning_items_transaction(
  p_token_id uuid,
  p_profile_id text,
  p_idempotency_key uuid,
  p_request_hash text,
  p_items jsonb,
  p_request_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_batch public.team_task_intake_batches%rowtype;
  v_role text;
  v_item jsonb;
  v_index integer;
  v_item_type text;
  v_id text;
  v_parent public.tasks%rowtype;
  v_initiative public.packages%rowtype;
  v_created_milestone public.milestones%rowtype;
  v_created_initiative public.packages%rowtype;
  v_task_insert jsonb;
  v_result jsonb;
  v_entity jsonb;
  v_ids text[] := array[]::text[];
  v_entities jsonb := '[]'::jsonb;
begin
  if p_token_id is null or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or p_idempotency_key is null or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$'
     or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception using errcode = '22023', message = 'planning items create input is invalid';
  end if;

  select * into v_token from public.team_task_intake_tokens
  where id = p_token_id and profile_id = p_profile_id and revoked_at is null and expires_at > now()
  for update;
  if not found then raise exception using errcode = 'P0004', message = 'planning items token is inactive'; end if;
  if not ('write:planning-items:create' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning items create scope is missing';
  end if;

  select platform_role into v_role from public.profiles where id = p_profile_id for share;
  if not found or v_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'planning items profile role is not allowed';
  end if;
  if v_role not in ('ceo', 'deputy') and exists (
    select 1
    from jsonb_array_elements(p_items) as item
    where item->>'itemType' = 'milestone'
  ) then
    raise exception using errcode = 'P0006', message = 'milestone creation requires ceo or deputy';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('planning-items-create:' || p_token_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_batch from public.team_task_intake_batches
  where token_id = p_token_id and idempotency_key = p_idempotency_key;
  if found then
    if v_batch.request_hash <> p_request_hash then raise exception using errcode = 'P0003', message = 'idempotency key conflict'; end if;
    return jsonb_build_object('batchId', v_batch.id, 'replayed', true, 'items', v_batch.response_tasks);
  end if;

  for v_item, v_index in select value, ordinality::integer from jsonb_array_elements(p_items) with ordinality loop
    v_item_type := nullif(trim(v_item->>'itemType'), '');
    v_id := p_profile_id || '-planning-items-v1-' || replace(p_idempotency_key::text, '-', '') || '-' || v_index::text;

    if v_item_type = 'milestone' then
      if char_length(trim(coalesce(v_item->>'title', ''))) not between 3 and 240
         or char_length(coalesce(v_item->>'description', '')) > 4000
         or coalesce(nullif(v_item->>'status', ''), 'planned') not in ('planned', 'active', 'done')
         or (
           nullif(v_item->>'targetDate', '') is not null
           and (v_item->>'targetDate') !~ '^\d{4}-\d{2}-\d{2}$'
         ) then
        raise exception using errcode = '22023', message = 'milestone create input is invalid';
      end if;

      insert into public.milestones (
        id, project_id, title, description, target_date, status
      ) values (
        v_id,
        'findmydoc-founder-execution',
        trim(v_item->>'title'),
        coalesce(v_item->>'description', ''),
        nullif(v_item->>'targetDate', '')::date,
        coalesce(nullif(v_item->>'status', ''), 'planned')
      ) returning * into v_created_milestone;

      v_entity := to_jsonb(v_created_milestone);
      insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, after_data, request_ip, user_agent)
      values (p_profile_id, 'team.planning_items.milestone_create', 'milestone', v_id, v_entity, p_request_ip, p_user_agent);
    elsif v_item_type = 'initiative' then
      if v_role not in ('ceo', 'deputy') then
        raise exception using errcode = 'P0006', message = 'initiative proposal requires ceo or deputy';
      end if;
      insert into public.packages (
        id, project_id, milestone_id, owner_id, accountable_profile_id, responsible_profile_ids,
        consulted_profile_ids, informed_profile_ids, title, goal, priority, status, success_criteria,
        scope_constraints, sort_order, approval_status, approval_revision, proposed_by, proposed_at
      ) values (
        v_id, 'findmydoc-founder-execution', nullif(v_item->>'milestoneId', ''), nullif(v_item->>'ownerId', ''),
        nullif(v_item->>'accountableProfileId', ''), coalesce(array(select jsonb_array_elements_text(v_item->'responsibleProfileIds')), array[]::text[]),
        coalesce(array(select jsonb_array_elements_text(v_item->'consultedProfileIds')), array[]::text[]),
        coalesce(array(select jsonb_array_elements_text(v_item->'informedProfileIds')), array[]::text[]),
        trim(v_item->>'title'), coalesce(v_item->>'intendedOutcome', v_item->>'description', ''), coalesce(nullif(v_item->>'priority', ''), 'P2'),
        'planned', coalesce(v_item->>'acceptanceCriteria', ''), coalesce(v_item->>'scopeConstraints', ''),
        coalesce((select max(sort_order) + 1 from public.packages where project_id = 'findmydoc-founder-execution'), 1),
        'proposed', 1, p_profile_id, now()
      ) returning * into v_created_initiative;
      v_entity := to_jsonb(v_created_initiative);
      insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, after_data, request_ip, user_agent)
      values (p_profile_id, 'team.planning_items.initiative_create', 'initiative', v_id, v_entity, p_request_ip, p_user_agent);
    elsif v_item_type in ('deliverable', 'sub_issue') then
      if v_item_type = 'deliverable' then
        select * into v_initiative from public.packages
        where id = nullif(v_item->>'packageId', '') and trashed_at is null
        for share;
        if not found then raise exception using errcode = 'P0002', message = 'planning items initiative not found'; end if;
        if v_initiative.approval_status = 'rejected' then
          raise exception using errcode = 'P0003', message = 'planning items initiative is rejected';
        end if;
      else
        select * into v_parent from public.tasks
        where id = nullif(v_item->>'parentTaskId', '') and task_type = 'deliverable' and trashed_at is null
        for share;
        if not found then raise exception using errcode = 'P0002', message = 'planning items parent deliverable not found'; end if;
      end if;
      if coalesce(nullif(v_item->>'githubRepo', ''), 'findmydoc-platform/management') not in (
        'findmydoc-platform/management', 'findmydoc-platform/website', 'findmydoc-platform/clinic-dashboard'
      ) then raise exception using errcode = '22023', message = 'planning items github repository is not allowed'; end if;
      if v_item_type = 'deliverable'
         and coalesce(nullif(v_item->>'githubRepo', ''), 'findmydoc-platform/management') <> 'findmydoc-platform/management' then
        raise exception using errcode = '22023', message = 'planning items deliverables must use the management repository';
      end if;

      v_task_insert := jsonb_build_object(
        'id', v_id,
        'creation_request_id', 'planning-items:' || p_token_id::text || ':' || p_idempotency_key::text || ':' || v_index::text,
        'project_id', 'findmydoc-founder-execution',
        'package_id', case when v_item_type = 'sub_issue' then v_parent.package_id else v_initiative.id end,
        'milestone_id', case when v_item_type = 'sub_issue' then v_parent.milestone_id else v_initiative.milestone_id end,
        'title', trim(v_item->>'title'), 'description', coalesce(v_item->>'description', ''),
        'problem_statement', coalesce(v_item->>'problemStatement', ''), 'intended_outcome', coalesce(v_item->>'intendedOutcome', ''),
        'scope_constraints', coalesce(v_item->>'scopeConstraints', ''), 'acceptance_criteria', coalesce(v_item->>'acceptanceCriteria', ''),
        'evidence_required', coalesce(v_item->>'evidenceRequired', ''), 'definition_of_done', coalesce(v_item->>'definitionOfDone', ''),
        'status', 'Offen', 'priority', coalesce(nullif(v_item->>'priority', ''), 'P2'),
        'owner', nullif(v_item->>'ownerId', ''), 'assignee', nullif(v_item->>'ownerId', ''), 'created_by', p_profile_id,
        'workstream', coalesce(v_item->>'workstream', ''), 'sort_order', 0,
        'start_date', nullif(v_item->>'startDate', ''), 'end_date', nullif(v_item->>'endDate', ''),
        'deadline', nullif(v_item->>'deadline', ''), 'estimate_hours', coalesce((v_item->>'hours')::integer, 0),
        'sprint_id', null, 'review_status', 'not_requested', 'score_points', 0, 'score_final', false,
        'github_repo', case when v_item_type = 'sub_issue' then coalesce(nullif(v_item->>'githubRepo', ''), 'findmydoc-platform/management') else 'findmydoc-platform/management' end,
        'task_type', v_item_type, 'parent_task_id', case when v_item_type = 'sub_issue' then v_parent.id else null end,
        'approval_status', case when v_item_type = 'sub_issue' then null else 'proposed' end, 'approval_revision', 1,
        'proposed_by', case when v_item_type = 'deliverable' then p_profile_id else null end,
        'proposed_at', case when v_item_type = 'deliverable' then now() else null end,
        'score_relevant', false
      );
      v_result := public.create_planning_task_transaction(
        v_task_insert, null, null, null,
        case when v_item_type = 'sub_issue' then 'Sub-Issue über Planning Items API erstellt' else 'Deliverable über Planning Items API vorgeschlagen' end,
        null, '[]'::jsonb, p_profile_id, p_request_ip, p_user_agent, false
      );
      v_entity := v_result->'task';
    else
      raise exception using errcode = '22023', message = 'planning items item type is invalid';
    end if;
    v_ids := array_append(v_ids, v_id);
    v_entities := v_entities || jsonb_build_array(jsonb_build_object('itemType', v_item_type, 'item', v_entity));
  end loop;

  insert into public.team_task_intake_batches (token_id, profile_id, idempotency_key, request_hash, task_ids, response_tasks)
  values (p_token_id, p_profile_id, p_idempotency_key, p_request_hash, v_ids, v_entities)
  returning * into v_batch;
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, after_data, request_ip, user_agent)
  values (p_profile_id, 'team.planning_items.create', 'team_planning_items_batch', v_batch.id::text,
    jsonb_build_object('tokenId', p_token_id, 'entityIds', v_ids), p_request_ip, p_user_agent);
  return jsonb_build_object('batchId', v_batch.id, 'replayed', false, 'items', v_entities);
end;
$$;

DROP TRIGGER IF EXISTS milestones_touch_updated_at ON public.milestones;
CREATE TRIGGER milestones_touch_updated_at
BEFORE UPDATE ON public.milestones
FOR EACH ROW
EXECUTE FUNCTION public.touch_milestone_updated_at();

CREATE OR REPLACE FUNCTION public.allocate_milestone_sort_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('milestone-sort:' || new.project_id, 0)
  );

  select coalesce(max(milestone.sort_order) + 1, 1)
  into new.sort_order
  from public.milestones as milestone
  where milestone.project_id = new.project_id;

  return new;
end;
$$;

DROP TRIGGER IF EXISTS milestones_allocate_sort_order ON public.milestones;
CREATE TRIGGER milestones_allocate_sort_order
BEFORE INSERT ON public.milestones
FOR EACH ROW
EXECUTE FUNCTION public.allocate_milestone_sort_order();

CREATE TABLE IF NOT EXISTS public.team_planning_milestone_delete_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id uuid NOT NULL REFERENCES public.team_task_intake_tokens(id) ON DELETE CASCADE,
  profile_id text NOT NULL REFERENCES public.profiles(id),
  milestone_id text NOT NULL,
  expected_updated_at timestamptz NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (token_id, idempotency_key)
);

ALTER TABLE public.team_planning_milestone_delete_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.authenticate_team_planning_items_token(
  p_token_hash text,
  p_scope text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_profile public.profiles%rowtype;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_scope is null
     or p_scope not in (
       'read:planning-context',
       'write:planning-items:create',
       'write:planning-items:update',
       'write:planning-items:delete-empty'
     ) then
    raise exception using errcode = '22023', message = 'planning items authentication input is invalid';
  end if;

  select * into v_token
  from public.team_task_intake_tokens
  where token_hash = p_token_hash
    and revoked_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception using errcode = 'P0004', message = 'planning items token is inactive';
  end if;
  if not (p_scope = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning items scope is missing';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_token.profile_id
  for share;

  if not found or v_profile.platform_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'planning items profile role is not allowed';
  end if;
  if p_scope = 'write:planning-items:delete-empty'
     and v_profile.platform_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'milestone deletion requires ceo or deputy';
  end if;

  update public.team_task_intake_tokens
  set last_used_at = now()
  where id = v_token.id;

  return jsonb_build_object(
    'tokenId', v_token.id,
    'scopes', v_token.scopes,
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'name', v_profile.name,
      'platformRole', v_profile.platform_role,
      'githubLogin', coalesce(v_profile.github_login, '')
    )
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.create_team_planning_items_token_v2(
  p_profile_id text,
  p_label text,
  p_token_hash text,
  p_token_hint text,
  p_allow_updates boolean DEFAULT false,
  p_allow_empty_milestone_deletes boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
declare
  v_role text;
  v_token jsonb;
begin
  if coalesce(p_allow_empty_milestone_deletes, false) then
    select platform_role into v_role
    from public.profiles
    where id = p_profile_id
    for share;

    if not found or v_role not in ('ceo', 'deputy') then
      raise exception using errcode = 'P0006', message = 'milestone delete token requires ceo or deputy';
    end if;
  end if;

  v_token := public.create_team_planning_items_token(
    p_profile_id,
    p_label,
    p_token_hash,
    p_token_hint,
    coalesce(p_allow_updates, false)
  );

  if coalesce(p_allow_empty_milestone_deletes, false) then
    update public.team_task_intake_tokens
    set scopes = scopes || ARRAY['write:planning-items:delete-empty']::text[]
    where id = (v_token->>'id')::uuid
    returning to_jsonb(team_task_intake_tokens) - 'token_hash' into v_token;
  end if;

  return v_token;
end;
$$;

CREATE OR REPLACE FUNCTION public.update_team_planning_item_transaction(
  p_token_id uuid,
  p_profile_id text,
  p_item_type text,
  p_item_id text,
  p_expected_updated_at timestamptz,
  p_idempotency_key uuid,
  p_request_hash text,
  p_patch jsonb DEFAULT '{}'::jsonb,
  p_changed_fields jsonb DEFAULT '[]'::jsonb,
  p_system_effects jsonb DEFAULT '[]'::jsonb,
  p_request_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_role text;
  v_profile_name text;
  v_request public.team_planning_item_update_requests%rowtype;
  v_milestone public.milestones%rowtype;
  v_package public.packages%rowtype;
  v_task public.tasks%rowtype;
  v_initiative public.packages%rowtype;
  v_before jsonb;
  v_item jsonb;
  v_response jsonb;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_assignments text;
  v_material boolean := false;
  v_allowed_columns text[];
  v_audit_action text := 'team.planning_items.update';
begin
  if p_token_id is null
     or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or p_item_type is null
     or p_item_type not in ('milestone', 'initiative', 'deliverable', 'sub_issue')
     or nullif(trim(coalesce(p_item_id, '')), '') is null
     or p_expected_updated_at is null
     or p_idempotency_key is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(v_patch) <> 'object'
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

  select platform_role, name into v_role, v_profile_name from public.profiles where id = p_profile_id for share;
  if not found or v_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'planning items profile role is not allowed';
  end if;
  if p_item_type = 'milestone' and v_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'milestone update requires ceo or deputy';
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

  if p_item_type = 'milestone' then
    select * into v_milestone
    from public.milestones
    where id = p_item_id
      and project_id = 'findmydoc-founder-execution'
    for update;
    if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
    if v_milestone.updated_at is distinct from p_expected_updated_at then
      raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
    end if;

    v_allowed_columns := ARRAY['title', 'description', 'target_date', 'status']::text[];
    if exists (select 1 from jsonb_object_keys(v_patch) as key where not (key = any(v_allowed_columns))) then
      raise exception using errcode = '22023', message = 'milestone patch contains unsupported columns';
    end if;
    if (v_patch ? 'title' and char_length(trim(coalesce(v_patch->>'title', ''))) not between 3 and 240)
       or (v_patch ? 'description' and char_length(coalesce(v_patch->>'description', '')) > 4000)
       or (v_patch ? 'status' and coalesce(v_patch->>'status', '') not in ('planned', 'active', 'done'))
       or (
         v_patch ? 'target_date'
         and nullif(v_patch->>'target_date', '') is not null
         and (v_patch->>'target_date') !~ '^\d{4}-\d{2}-\d{2}$'
       ) then
      raise exception using errcode = '22023', message = 'milestone patch input is invalid';
    end if;
    if v_patch ? 'target_date' and nullif(v_patch->>'target_date', '') is null then
      v_patch := jsonb_set(v_patch, '{target_date}', 'null'::jsonb, true);
    end if;

    v_before := to_jsonb(v_milestone);
    if not exists (select 1 from jsonb_object_keys(v_patch)) then
      v_item := v_before;
    else
      select string_agg(
        format('%1$I = (jsonb_populate_record(null::public.milestones, to_jsonb(milestone) || $1)).%1$I', key),
        ', ' order by key
      ) into v_assignments from jsonb_object_keys(v_patch) as key;
      execute format(
        'update public.milestones as milestone set %s where milestone.project_id = ''findmydoc-founder-execution'' and milestone.id = $2 and milestone.updated_at = $3 returning to_jsonb(milestone)',
        v_assignments
      ) into v_item using v_patch, p_item_id, p_expected_updated_at;
      if v_item is null then raise exception using errcode = 'P0001', message = 'planning item was changed concurrently'; end if;
    end if;
    v_audit_action := 'team.planning_items.milestone_update';
  elsif p_item_type = 'initiative' then
    select * into v_package
    from public.packages
    where id = p_item_id and trashed_at is null
    for update;
    if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
    if v_package.updated_at is distinct from p_expected_updated_at then
      raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
    end if;

    v_allowed_columns := ARRAY[
      'title', 'goal', 'scope_constraints', 'success_criteria', 'milestone_id', 'owner_id',
      'accountable_profile_id', 'responsible_profile_ids', 'consulted_profile_ids',
      'informed_profile_ids', 'priority'
    ]::text[];
    if exists (select 1 from jsonb_object_keys(v_patch) as key where not (key = any(v_allowed_columns))) then
      raise exception using errcode = '22023', message = 'initiative patch contains unsupported columns';
    end if;
    if v_role = 'founder' then
      if v_package.owner_id is distinct from p_profile_id then
        raise exception using errcode = 'P0007', message = 'founder may only update own initiatives';
      end if;
      if exists (
        select 1 from jsonb_object_keys(v_patch) as key
        where key not in ('title', 'goal', 'scope_constraints', 'success_criteria', 'priority',
          'responsible_profile_ids', 'consulted_profile_ids', 'informed_profile_ids')
      ) then
        raise exception using errcode = 'P0007', message = 'initiative field is protected';
      end if;
    end if;

    if v_patch ? 'milestone_id' and not exists (
      select 1 from public.milestones where id = nullif(v_patch->>'milestone_id', '')
    ) then raise exception using errcode = 'P0002', message = 'milestone not found'; end if;
    if v_patch ? 'owner_id' and nullif(v_patch->>'owner_id', '') is not null and not exists (
      select 1 from public.profiles where id = v_patch->>'owner_id'
    ) then raise exception using errcode = 'P0002', message = 'owner profile not found'; end if;
    if v_patch ? 'accountable_profile_id' and nullif(v_patch->>'accountable_profile_id', '') is not null and not exists (
      select 1 from public.profiles where id = v_patch->>'accountable_profile_id'
    ) then raise exception using errcode = 'P0002', message = 'accountable profile not found'; end if;

    v_material := exists (
      select 1 from jsonb_object_keys(v_patch) as key
      where key in ('title', 'goal', 'scope_constraints', 'success_criteria', 'milestone_id')
    );
    if v_material then
      v_patch := v_patch || jsonb_build_object(
        'approval_status', 'proposed',
        'approval_revision', v_package.approval_revision + 1,
        'proposed_by', p_profile_id,
        'proposed_at', now(),
        'decided_by', null,
        'decided_at', null,
        'decision_note', null
      );
    end if;

    v_before := to_jsonb(v_package);
    if not exists (select 1 from jsonb_object_keys(v_patch)) then
      v_item := v_before;
    else
      select string_agg(
        format('%1$I = (jsonb_populate_record(null::public.packages, to_jsonb(package) || $1)).%1$I', key),
        ', ' order by key
      ) into v_assignments from jsonb_object_keys(v_patch) as key;
      execute format(
        'update public.packages as package set %s where package.id = $2 and package.updated_at = $3 returning to_jsonb(package)',
        v_assignments
      ) into v_item using v_patch, p_item_id, p_expected_updated_at;
      if v_item is null then raise exception using errcode = 'P0001', message = 'planning item was changed concurrently'; end if;
    end if;
  else
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

    if p_item_type = 'deliverable' then
      v_allowed_columns := ARRAY[
        'title', 'description', 'problem_statement', 'intended_outcome', 'scope_constraints',
        'acceptance_criteria', 'evidence_required', 'definition_of_done', 'package_id',
        'owner', 'assignee', 'priority', 'workstream', 'start_date', 'end_date', 'deadline', 'estimate_hours'
      ]::text[];
    else
      v_allowed_columns := ARRAY[
        'title', 'description', 'problem_statement', 'intended_outcome', 'scope_constraints',
        'acceptance_criteria', 'evidence_required', 'definition_of_done', 'parent_task_id',
        'owner', 'assignee', 'priority', 'workstream', 'start_date', 'end_date', 'deadline',
        'estimate_hours', 'github_repo'
      ]::text[];
    end if;
    if exists (select 1 from jsonb_object_keys(v_patch) as key where not (key = any(v_allowed_columns))) then
      raise exception using errcode = '22023', message = 'task patch contains unsupported columns';
    end if;
    if (v_patch ? 'owner') <> (v_patch ? 'assignee')
       or ((v_patch ? 'owner') and v_patch->>'owner' is distinct from v_patch->>'assignee') then
      raise exception using errcode = '22023', message = 'owner and assignee must be updated together';
    end if;
    if v_role = 'founder' then
      if coalesce(v_task.owner, '') not in (p_profile_id, coalesce(v_profile_name, ''))
         and coalesce(v_task.assignee, '') not in (p_profile_id, coalesce(v_profile_name, '')) then
        raise exception using errcode = 'P0007', message = 'founder may only update owned or assigned tasks';
      end if;
      if exists (
        select 1 from jsonb_object_keys(v_patch) as key
        where key not in (
          'title', 'description', 'problem_statement', 'intended_outcome', 'scope_constraints',
          'acceptance_criteria', 'evidence_required', 'definition_of_done', 'parent_task_id'
        )
      ) then raise exception using errcode = 'P0007', message = 'task field is protected'; end if;
    end if;
    if v_patch ? 'package_id' then
      select * into v_initiative from public.packages
      where id = nullif(v_patch->>'package_id', '') and trashed_at is null
      for share;
      if not found then raise exception using errcode = 'P0002', message = 'initiative not found'; end if;
      if v_initiative.approval_status = 'rejected' then
        raise exception using errcode = 'P0003', message = 'initiative is rejected';
      end if;
      v_patch := v_patch || jsonb_build_object('milestone_id', v_initiative.milestone_id);
    end if;
    if v_patch ? 'parent_task_id' then
      perform 1 from public.tasks
      where id = nullif(v_patch->>'parent_task_id', '')
        and task_type = 'deliverable'
        and trashed_at is null;
      if not found then raise exception using errcode = 'P0002', message = 'parent deliverable not found'; end if;
    end if;
    if v_patch ? 'github_repo' then
      if v_role not in ('ceo', 'deputy')
         or v_task.github_issue_number is not null
         or nullif(v_task.github_issue_url, '') is not null
         or v_task.github_issue_sync_status <> 'not_synced'
         or v_patch->>'github_repo' not in (
           'findmydoc-platform/management', 'findmydoc-platform/website', 'findmydoc-platform/clinic-dashboard'
         ) then
        raise exception using errcode = 'P0007', message = 'github repository cannot be changed';
      end if;
    end if;

    v_before := to_jsonb(v_task);
    if not exists (select 1 from jsonb_object_keys(v_patch)) then
      v_item := v_before;
    else
      v_patch := v_patch || jsonb_build_object(
        'github_issue_sync_status', 'not_synced',
        'github_issue_sync_error', null
      );
      perform set_config('app.actor_profile_id', p_profile_id, true);
      select string_agg(
        format('%1$I = (jsonb_populate_record(null::public.tasks, to_jsonb(task) || $1)).%1$I', key),
        ', ' order by key
      ) into v_assignments from jsonb_object_keys(v_patch) as key;
      execute format(
        'update public.tasks as task set %s, updated_at = clock_timestamp() where task.id = $2 and task.updated_at = $3 returning to_jsonb(task)',
        v_assignments
      ) into v_item using v_patch, p_item_id, p_expected_updated_at;
      if v_item is null then raise exception using errcode = 'P0001', message = 'planning item was changed concurrently'; end if;
    end if;
  end if;

  if exists (select 1 from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb))) then
    insert into public.audit_log (
      actor_profile_id, action, entity_type, entity_id, before_data, after_data, request_ip, user_agent
    ) values (
      p_profile_id, v_audit_action, p_item_type, p_item_id, v_before, v_item, p_request_ip, p_user_agent
    );
  end if;

  v_response := jsonb_build_object(
    'replayed', false,
    'itemType', p_item_type,
    'item', v_item,
    'changedFields', coalesce(p_changed_fields, '[]'::jsonb),
    'systemEffects', coalesce(p_system_effects, '[]'::jsonb)
  );
  insert into public.team_planning_item_update_requests (
    token_id, profile_id, item_type, item_id, expected_updated_at, idempotency_key, request_hash, response
  ) values (
    p_token_id, p_profile_id, p_item_type, p_item_id, p_expected_updated_at, p_idempotency_key, p_request_hash, v_response
  );
  return v_response;
end;
$$;

CREATE OR REPLACE FUNCTION public.delete_team_planning_milestone_transaction(
  p_token_id uuid,
  p_profile_id text,
  p_milestone_id text,
  p_expected_updated_at timestamptz,
  p_idempotency_key uuid,
  p_request_hash text,
  p_request_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_role text;
  v_request public.team_planning_milestone_delete_requests%rowtype;
  v_milestone public.milestones%rowtype;
  v_deleted public.milestones%rowtype;
  v_initiative_count bigint;
  v_task_count bigint;
  v_response jsonb;
begin
  if p_token_id is null
     or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or nullif(trim(coalesce(p_milestone_id, '')), '') is null
     or p_expected_updated_at is null
     or p_idempotency_key is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'milestone delete input is invalid';
  end if;

  select * into v_token
  from public.team_task_intake_tokens
  where id = p_token_id
    and profile_id = p_profile_id
    and revoked_at is null
    and expires_at > now()
  for update;
  if not found then
    raise exception using errcode = 'P0004', message = 'planning items token is inactive';
  end if;
  if not ('write:planning-items:delete-empty' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning items milestone delete scope is missing';
  end if;

  select platform_role into v_role
  from public.profiles
  where id = p_profile_id
  for share;
  if not found or v_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'milestone deletion requires ceo or deputy';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('planning-items-milestone-delete:' || p_token_id::text || ':' || p_idempotency_key::text, 0)
  );

  select * into v_request
  from public.team_planning_milestone_delete_requests
  where token_id = p_token_id
    and idempotency_key = p_idempotency_key;
  if found then
    if v_request.request_hash <> p_request_hash
       or v_request.milestone_id <> p_milestone_id
       or v_request.expected_updated_at is distinct from p_expected_updated_at then
      raise exception using errcode = 'P0003', message = 'idempotency key conflict';
    end if;
    return jsonb_set(v_request.response, '{replayed}', 'true'::jsonb, true);
  end if;

  select * into v_milestone
  from public.milestones
  where id = p_milestone_id
    and project_id = 'findmydoc-founder-execution'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_milestone.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;

  select count(*) into v_initiative_count
  from public.packages
  where milestone_id = p_milestone_id;

  select count(*) into v_task_count
  from public.tasks
  where milestone_id = p_milestone_id;

  if v_initiative_count > 0 or v_task_count > 0 then
    raise exception using
      errcode = 'P0008',
      message = 'milestone is not empty',
      detail = jsonb_build_object(
        'children', jsonb_build_object(
          'initiatives', v_initiative_count,
          'tasks', v_task_count
        )
      )::text;
  end if;

  delete from public.milestones
  where id = p_milestone_id
    and project_id = 'findmydoc-founder-execution'
    and updated_at = p_expected_updated_at
  returning * into v_deleted;
  if not found then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;

  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id, before_data, request_ip, user_agent
  ) values (
    p_profile_id,
    'team.planning_items.milestone_delete',
    'milestone',
    p_milestone_id,
    to_jsonb(v_milestone),
    p_request_ip,
    p_user_agent
  );

  v_response := jsonb_build_object(
    'replayed', false,
    'itemType', 'milestone',
    'item', to_jsonb(v_deleted),
    'children', jsonb_build_object('initiatives', 0, 'tasks', 0)
  );

  insert into public.team_planning_milestone_delete_requests (
    token_id,
    profile_id,
    milestone_id,
    expected_updated_at,
    idempotency_key,
    request_hash,
    response
  ) values (
    p_token_id,
    p_profile_id,
    p_milestone_id,
    p_expected_updated_at,
    p_idempotency_key,
    p_request_hash,
    v_response
  );

  return v_response;
end;
$$;

REVOKE ALL ON FUNCTION public.authenticate_team_planning_items_token(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_team_planning_items_token(text, text) TO service_role;

REVOKE ALL ON FUNCTION public.create_team_planning_items_transaction(uuid, text, uuid, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_team_planning_items_transaction(uuid, text, uuid, text, jsonb, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.update_team_planning_item_transaction(uuid, text, text, text, timestamptz, uuid, text, jsonb, jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_team_planning_item_transaction(uuid, text, text, text, timestamptz, uuid, text, jsonb, jsonb, jsonb, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.create_team_planning_items_token_v2(text, text, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_team_planning_items_token_v2(text, text, text, text, boolean, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.delete_team_planning_milestone_transaction(uuid, text, text, timestamptz, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_team_planning_milestone_transaction(uuid, text, text, timestamptz, uuid, text, text, text) TO service_role;

REVOKE ALL ON TABLE public.team_planning_milestone_delete_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.team_planning_milestone_delete_requests TO service_role;
