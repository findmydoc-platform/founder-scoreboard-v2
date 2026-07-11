alter table public.team_task_intake_batches
  add column if not exists response_tasks jsonb not null default '[]'::jsonb;

update public.team_task_intake_batches as batch
set response_tasks = coalesce((
  select jsonb_agg(to_jsonb(task_row) order by requested.ordinality)
  from unnest(batch.task_ids) with ordinality as requested(task_id, ordinality)
  join public.tasks as task_row on task_row.id = requested.task_id
), '[]'::jsonb)
where batch.response_tasks = '[]'::jsonb
  and cardinality(batch.task_ids) > 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'team_task_intake_batches_response_tasks_check'
      and conrelid = 'public.team_task_intake_batches'::regclass
  ) then
    alter table public.team_task_intake_batches
      add constraint team_task_intake_batches_response_tasks_check
      check (jsonb_typeof(response_tasks) = 'array');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'team_task_intake_tokens_max_expiry_check'
      and conrelid = 'public.team_task_intake_tokens'::regclass
  ) then
    alter table public.team_task_intake_tokens
      add constraint team_task_intake_tokens_max_expiry_check
      check (expires_at <= created_at + interval '90 days');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'team_task_intake_tokens_id_profile_unique'
      and conrelid = 'public.team_task_intake_tokens'::regclass
  ) then
    alter table public.team_task_intake_tokens
      add constraint team_task_intake_tokens_id_profile_unique unique (id, profile_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'team_task_intake_batches_token_profile_fk'
      and conrelid = 'public.team_task_intake_batches'::regclass
  ) then
    alter table public.team_task_intake_batches
      add constraint team_task_intake_batches_token_profile_fk
      foreign key (token_id, profile_id)
      references public.team_task_intake_tokens(id, profile_id)
      on delete restrict;
  end if;
end
$$;

drop index if exists public.team_task_intake_batches_token_id_idx;

create or replace function public.create_team_task_intake_token(
  p_profile_id text,
  p_label text,
  p_token_hash text,
  p_token_hint text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active_count integer;
  v_token public.team_task_intake_tokens%rowtype;
begin
  if nullif(trim(coalesce(p_profile_id, '')), '') is null
     or char_length(trim(coalesce(p_label, ''))) not between 1 and 80
     or coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or char_length(coalesce(p_token_hint, '')) not between 4 and 16 then
    raise exception using errcode = '22023', message = 'team intake token input is invalid';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_profile_id
      and platform_role in ('ceo', 'deputy', 'founder')
  ) then
    raise exception using errcode = 'P0002', message = 'operational profile not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('team-intake-token:' || p_profile_id, 0));

  select count(*)
  into v_active_count
  from public.team_task_intake_tokens
  where profile_id = p_profile_id
    and revoked_at is null
    and expires_at > now();

  if v_active_count >= 3 then
    raise exception using errcode = 'P0003', message = 'active team intake token limit reached';
  end if;

  insert into public.team_task_intake_tokens (
    profile_id,
    label,
    token_hash,
    token_hint,
    expires_at
  ) values (
    p_profile_id,
    trim(p_label),
    p_token_hash,
    p_token_hint,
    now() + interval '90 days'
  )
  returning * into v_token;

  return to_jsonb(v_token) - 'token_hash';
end;
$$;

create or replace function public.authenticate_team_task_intake_token(
  p_token_hash text,
  p_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_profile public.profiles%rowtype;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_scope not in ('read:task-context', 'write:task-intake') then
    raise exception using errcode = '22023', message = 'team intake authentication input is invalid';
  end if;

  select *
  into v_token
  from public.team_task_intake_tokens
  where token_hash = p_token_hash
    and revoked_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception using errcode = 'P0004', message = 'team intake token is inactive';
  end if;
  if not (p_scope = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'team intake scope is missing';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_token.profile_id
  for share;

  if not found or v_profile.platform_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'team intake profile role is not allowed';
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

create or replace function public.revoke_team_task_intake_token(
  p_token_id uuid,
  p_profile_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_id uuid;
begin
  update public.team_task_intake_tokens
  set revoked_at = now()
  where id = p_token_id
    and profile_id = p_profile_id
    and revoked_at is null
  returning id into v_token_id;

  return v_token_id;
end;
$$;

create or replace function public.create_team_task_intake_batch_transaction(
  p_token_id uuid,
  p_profile_id text,
  p_idempotency_key uuid,
  p_request_hash text,
  p_items jsonb,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed_item_keys constant text[] := array[
    'acceptanceCriteria',
    'deadline',
    'definitionOfDone',
    'description',
    'endDate',
    'evidenceRequired',
    'hours',
    'intendedOutcome',
    'milestoneId',
    'ownerId',
    'packageId',
    'parentTaskId',
    'priority',
    'problemStatement',
    'scopeConstraints',
    'startDate',
    'status',
    'taskType',
    'title',
    'workstream'
  ];
  v_batch public.team_task_intake_batches%rowtype;
  v_token public.team_task_intake_tokens%rowtype;
  v_profile_role text;
  v_parent public.tasks%rowtype;
  v_item jsonb;
  v_item_index integer;
  v_item_count integer;
  v_task_type text;
  v_task_id text;
  v_creation_request_id text;
  v_owner_id text;
  v_package_id text;
  v_milestone_id text;
  v_package_milestone_id text;
  v_status text;
  v_priority text;
  v_task_insert jsonb;
  v_notifications jsonb;
  v_result jsonb;
  v_task jsonb;
  v_task_ids text[] := array[]::text[];
  v_tasks jsonb := '[]'::jsonb;
begin
  if p_token_id is null
     or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or p_idempotency_key is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'team intake batch input is invalid';
  end if;

  select *
  into v_token
  from public.team_task_intake_tokens
  where id = p_token_id
    and profile_id = p_profile_id
    and revoked_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception using errcode = 'P0004', message = 'team intake token is inactive';
  end if;
  if not ('write:task-intake' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'team intake write scope is missing';
  end if;

  select platform_role
  into v_profile_role
  from public.profiles
  where id = p_profile_id
  for share;

  if not found or v_profile_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'team intake profile role is not allowed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('team-intake-batch:' || p_token_id::text || ':' || p_idempotency_key::text, 0));

  select *
  into v_batch
  from public.team_task_intake_batches
  where token_id = p_token_id
    and idempotency_key = p_idempotency_key;

  if found then
    if v_batch.request_hash <> p_request_hash then
      raise exception using errcode = 'P0003', message = 'idempotency key was reused with different team intake data';
    end if;
    return jsonb_build_object(
      'batchId', v_batch.id,
      'replayed', true,
      'tasks', v_batch.response_tasks
    );
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'team intake items must be an array';
  end if;
  v_item_count := jsonb_array_length(p_items);
  if v_item_count < 1 or v_item_count > 30 then
    raise exception using errcode = '22023', message = 'team intake batch size is invalid';
  end if;

  for v_item, v_item_index in
    select value, ordinality::integer
    from jsonb_array_elements(p_items) with ordinality
  loop
    if jsonb_typeof(v_item) <> 'object'
       or exists (
         select 1
         from jsonb_object_keys(v_item) as item_key
         where not (item_key = any(v_allowed_item_keys))
       ) then
      raise exception using errcode = '22023', message = 'team intake item is invalid';
    end if;

    v_task_type := nullif(trim(v_item->>'taskType'), '');
    if v_task_type not in ('proposal', 'sub_issue')
       or char_length(trim(coalesce(v_item->>'title', ''))) not between 3 and 240 then
      raise exception using errcode = '22023', message = 'team intake task type or title is invalid';
    end if;

    v_owner_id := nullif(trim(v_item->>'ownerId'), '');
    if v_owner_id is not null and not exists (select 1 from public.profiles where id = v_owner_id) then
      raise exception using errcode = 'P0002', message = 'team intake owner profile not found';
    end if;

    v_task_id := p_profile_id || '-team-intake-' || replace(p_idempotency_key::text, '-', '') || '-' || v_item_index::text;
    v_creation_request_id := 'team:' || p_token_id::text || ':' || p_idempotency_key::text || ':' || v_item_index::text;
    v_package_id := nullif(trim(v_item->>'packageId'), '');
    v_milestone_id := nullif(trim(v_item->>'milestoneId'), '');

    if v_task_type = 'proposal' then
      if v_package_id is not null then
        select milestone_id into v_package_milestone_id
        from public.packages
        where id = v_package_id;
        if not found then
          raise exception using errcode = 'P0002', message = 'team intake initiative not found';
        end if;
        v_milestone_id := coalesce(v_milestone_id, v_package_milestone_id);
      end if;
      if v_milestone_id is not null and not exists (select 1 from public.milestones where id = v_milestone_id) then
        raise exception using errcode = 'P0002', message = 'team intake milestone not found';
      end if;
      v_status := 'Vorschlag';
    else
      select *
      into v_parent
      from public.tasks
      where id = nullif(trim(v_item->>'parentTaskId'), '')
        and task_type = 'deliverable'
      for share;

      if not found then
        raise exception using errcode = 'P0002', message = 'team intake parent deliverable not found';
      end if;
      if v_profile_role = 'founder' and coalesce(v_parent.assignee, v_parent.owner, '') <> p_profile_id then
        raise exception using errcode = 'P0006', message = 'founder may refine only own deliverables';
      end if;
      v_package_id := v_parent.package_id;
      v_milestone_id := v_parent.milestone_id;
      v_owner_id := coalesce(v_owner_id, p_profile_id);
      v_status := nullif(trim(v_item->>'status'), '');
      if v_status not in ('Offen', 'In Arbeit', 'Review', 'Nacharbeit', 'Blockiert', 'Erledigt') then
        v_status := 'Offen';
      end if;
    end if;

    v_priority := nullif(trim(v_item->>'priority'), '');
    if v_priority not in ('P0', 'P1', 'P2', 'P3', 'P4') then
      v_priority := 'P2';
    end if;

    v_task_insert := jsonb_build_object(
      'id', v_task_id,
      'creation_request_id', v_creation_request_id,
      'project_id', 'findmydoc-founder-execution',
      'title', trim(v_item->>'title'),
      'description', coalesce(v_item->>'description', ''),
      'problem_statement', coalesce(v_item->>'problemStatement', ''),
      'intended_outcome', coalesce(v_item->>'intendedOutcome', ''),
      'scope_constraints', coalesce(v_item->>'scopeConstraints', ''),
      'acceptance_criteria', coalesce(v_item->>'acceptanceCriteria', ''),
      'evidence_required', coalesce(v_item->>'evidenceRequired', ''),
      'definition_of_done', coalesce(v_item->>'definitionOfDone', ''),
      'status', v_status,
      'priority', v_priority,
      'owner', v_owner_id,
      'assignee', v_owner_id,
      'created_by', p_profile_id,
      'workstream', coalesce(v_item->>'workstream', ''),
      'sort_order', 0,
      'start_date', nullif(v_item->>'startDate', ''),
      'end_date', nullif(v_item->>'endDate', ''),
      'deadline', nullif(v_item->>'deadline', ''),
      'estimate_hours', greatest(0, least(200, coalesce((v_item->>'hours')::integer, 0))),
      'package_id', v_package_id,
      'milestone_id', v_milestone_id,
      'sprint_id', null,
      'review_owner_profile_id', null,
      'score_points', 0,
      'score_final', false,
      'task_type', v_task_type,
      'parent_task_id', case when v_task_type = 'sub_issue' then v_parent.id else null end,
      'score_relevant', false
    );

    if v_task_type = 'proposal' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'type', 'task.proposed',
        'actor_profile_id', p_profile_id,
        'recipient_profile_id', lead.id,
        'entity_type', 'task',
        'entity_id', v_task_id,
        'title', 'Aufgabenvorschlag: ' || trim(v_item->>'title'),
        'body', coalesce(nullif(v_item->>'description', ''), 'Ein neuer Aufgabenvorschlag wurde über Team Intake eingereicht.')
      )), '[]'::jsonb)
      into v_notifications
      from public.profiles as lead
      where lead.platform_role in ('ceo', 'deputy')
        and lead.id <> p_profile_id;
    else
      v_notifications := '[]'::jsonb;
    end if;

    v_result := public.create_task_transaction(
      v_task_insert,
      null,
      null,
      null,
      case when v_task_type = 'proposal'
        then 'Aufgabenvorschlag über Team Intake erstellt'
        else 'Sub-Issue über Team Intake erstellt'
      end,
      null,
      v_notifications,
      p_profile_id,
      p_request_ip,
      p_user_agent
    );
    v_task := v_result->'task';
    if v_task is null or nullif(v_task->>'id', '') is null then
      raise exception using errcode = 'P0001', message = 'team intake task creation returned no task';
    end if;
    v_task_ids := array_append(v_task_ids, v_task->>'id');
    v_tasks := v_tasks || jsonb_build_array(v_task);
  end loop;

  insert into public.team_task_intake_batches (
    token_id,
    profile_id,
    idempotency_key,
    request_hash,
    task_ids,
    response_tasks
  ) values (
    p_token_id,
    p_profile_id,
    p_idempotency_key,
    p_request_hash,
    v_task_ids,
    v_tasks
  )
  returning * into v_batch;

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    after_data,
    request_ip,
    user_agent
  ) values (
    p_profile_id,
    'team.task_intake.commit',
    'team_task_intake_batch',
    v_batch.id::text,
    jsonb_build_object('tokenId', p_token_id, 'taskIds', v_task_ids),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'batchId', v_batch.id,
    'replayed', false,
    'tasks', v_tasks
  );
end;
$$;

revoke all on table public.team_task_intake_tokens from public, anon, authenticated;
revoke all on table public.team_task_intake_batches from public, anon, authenticated;
revoke insert, update, delete on table public.team_task_intake_tokens from service_role;
revoke insert, update, delete on table public.team_task_intake_batches from service_role;
grant select on table public.team_task_intake_tokens to service_role;
grant select on table public.team_task_intake_batches to service_role;

revoke all on function public.create_team_task_intake_token(text, text, text, text) from public, anon, authenticated;
revoke all on function public.authenticate_team_task_intake_token(text, text) from public, anon, authenticated;
revoke all on function public.revoke_team_task_intake_token(uuid, text) from public, anon, authenticated;
revoke all on function public.create_team_task_intake_batch_transaction(uuid, text, uuid, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.create_team_task_intake_token(text, text, text, text, timestamptz) from service_role;

grant execute on function public.create_team_task_intake_token(text, text, text, text) to service_role;
grant execute on function public.authenticate_team_task_intake_token(text, text) to service_role;
grant execute on function public.revoke_team_task_intake_token(uuid, text) to service_role;
grant execute on function public.create_team_task_intake_batch_transaction(uuid, text, uuid, text, jsonb, text, text) to service_role;

comment on column public.team_task_intake_batches.response_tasks
is 'Immutable task-row snapshots returned for deterministic idempotent replays.';

comment on function public.authenticate_team_task_intake_token(text, text)
is 'Atomically validates a personal token, current profile role and scope while recording last use.';

comment on function public.revoke_team_task_intake_token(uuid, text)
is 'Revokes one active personal Team Task Intake token owned by the current profile.';

comment on function public.create_team_task_intake_batch_transaction(uuid, text, uuid, text, jsonb, text, text)
is 'Atomically revalidates Team Task Intake authority and creates a deterministic replayable batch from a narrow intent.';

notify pgrst, 'reload schema';
