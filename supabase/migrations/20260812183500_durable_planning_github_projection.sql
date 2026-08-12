create sequence if not exists public.planning_github_delivery_sequence;

alter table public.planning_github_lifecycle_outbox
  add column if not exists delivery_sequence bigint not null
    default nextval('public.planning_github_delivery_sequence');

with ordered as (
  select id, row_number() over (order by created_at, id)::bigint as sequence
  from public.planning_github_lifecycle_outbox
)
update public.planning_github_lifecycle_outbox job
set delivery_sequence = ordered.sequence
from ordered
where job.id = ordered.id;

select setval(
  'public.planning_github_delivery_sequence',
  greatest(coalesce((select max(delivery_sequence) from public.planning_github_lifecycle_outbox), 0), 1),
  exists(select 1 from public.planning_github_lifecycle_outbox)
);

create table if not exists public.planning_github_projection_outbox (
  id uuid primary key default gen_random_uuid(),
  delivery_sequence bigint not null default nextval('public.planning_github_delivery_sequence'),
  planning_operation_id text not null,
  task_id text not null references public.tasks(id) on delete cascade,
  actor_profile_id text not null references public.profiles(id),
  source_revision_token text not null,
  create_if_missing boolean not null,
  receipt_kind text,
  receipt_token_id uuid,
  receipt_idempotency_key uuid,
  receipt_item_index integer,
  status text not null default 'pending',
  status_reason text,
  result jsonb,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planning_github_projection_operation_check
    check (nullif(trim(planning_operation_id), '') is not null),
  constraint planning_github_projection_source_revision_check
    check (nullif(trim(source_revision_token), '') is not null),
  constraint planning_github_projection_receipt_check check (
    (receipt_kind is null and receipt_token_id is null and receipt_idempotency_key is null and receipt_item_index is null)
    or (receipt_kind = 'team_create' and receipt_token_id is not null and receipt_idempotency_key is not null and receipt_item_index >= 0)
    or (receipt_kind = 'team_update' and receipt_token_id is not null and receipt_idempotency_key is not null and receipt_item_index is null)
  ),
  constraint planning_github_projection_status_check
    check (status in ('pending', 'processing', 'retry_scheduled', 'completed', 'failed')),
  constraint planning_github_projection_attempts_check check (attempts >= 0),
  constraint planning_github_projection_lock_check check (
    (status = 'processing' and locked_at is not null and lock_token is not null)
    or (status <> 'processing' and locked_at is null and lock_token is null)
  ),
  constraint planning_github_projection_completion_check check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  ),
  unique (planning_operation_id, task_id)
);

comment on table public.planning_github_projection_outbox is
  'Durable GitHub reconciliation requests. Claims share item ordering with planning lifecycle delivery through delivery_sequence.';

create index if not exists planning_github_projection_claim_idx
  on public.planning_github_projection_outbox(status, available_at, delivery_sequence)
  where status in ('pending', 'processing', 'retry_scheduled');

create index if not exists planning_github_projection_task_idx
  on public.planning_github_projection_outbox(task_id, delivery_sequence);

create index if not exists planning_github_lifecycle_delivery_sequence_idx
  on public.planning_github_lifecycle_outbox(task_id, delivery_sequence);

alter table public.planning_github_projection_outbox enable row level security;

create or replace function public.enqueue_planning_github_projection_request(
  p_planning_operation_id text,
  p_task_id text,
  p_actor_profile_id text,
  p_create_if_missing boolean,
  p_receipt_kind text default null,
  p_receipt_token_id uuid default null,
  p_receipt_idempotency_key uuid default null,
  p_receipt_item_index integer default null
) returns public.planning_github_projection_outbox
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_request public.planning_github_projection_outbox%rowtype;
begin
  if nullif(trim(coalesce(p_planning_operation_id, '')), '') is null
     or nullif(trim(coalesce(p_task_id, '')), '') is null
     or nullif(trim(coalesce(p_actor_profile_id, '')), '') is null
     or p_create_if_missing is null then
    raise exception using errcode = '22023', message = 'planning github projection input is invalid';
  end if;

  select * into v_task from public.tasks
  where id = p_task_id and trashed_at is null
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning github projection task was not found';
  end if;
  if v_task.task_type not in ('deliverable', 'sub_issue') then
    raise exception using errcode = 'P0014', message = 'planning github projection target is not eligible';
  end if;
  if v_task.task_type = 'deliverable' and v_task.approval_status is distinct from 'approved' then
    raise exception using errcode = 'P0014', message = 'planning github projection deliverable is not approved';
  end if;
  if v_task.task_type = 'sub_issue' then
    select * into v_parent from public.tasks
    where id = v_task.parent_task_id and task_type = 'deliverable' and trashed_at is null
    for share;
    if not found or v_parent.approval_status is distinct from 'approved' then
      raise exception using errcode = 'P0014', message = 'planning github projection parent is not approved';
    end if;
  end if;
  if not p_create_if_missing
     and v_task.github_issue_number is null
     and coalesce(trim(v_task.issue_number), '') !~ '^[1-9][0-9]*$' then
    raise exception using errcode = 'P0015', message = 'planning github projection requires an existing issue';
  end if;

  insert into public.planning_github_projection_outbox (
    planning_operation_id, task_id, actor_profile_id, source_revision_token,
    create_if_missing, receipt_kind, receipt_token_id, receipt_idempotency_key,
    receipt_item_index
  ) values (
    p_planning_operation_id, p_task_id, p_actor_profile_id, v_task.updated_at::text,
    p_create_if_missing, p_receipt_kind, p_receipt_token_id,
    p_receipt_idempotency_key, p_receipt_item_index
  )
  on conflict (planning_operation_id, task_id) do nothing
  returning * into v_request;

  if v_request.id is null then
    select * into v_request from public.planning_github_projection_outbox
    where planning_operation_id = p_planning_operation_id and task_id = p_task_id;
    if v_request.actor_profile_id is distinct from p_actor_profile_id
       or v_request.create_if_missing is distinct from p_create_if_missing then
      raise exception using errcode = 'P0003', message = 'planning github projection idempotency conflict';
    end if;
  end if;
  return v_request;
end;
$$;

create or replace function public.create_team_planning_items_with_projection_transaction(
  p_token_id uuid,
  p_profile_id text,
  p_idempotency_key uuid,
  p_request_hash text,
  p_items jsonb,
  p_projection_commands jsonb default '[]'::jsonb,
  p_request_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
  v_items jsonb;
  v_command jsonb;
  v_request public.planning_github_projection_outbox%rowtype;
  v_operation_id text := 'team-create:' || p_token_id::text || ':' || p_idempotency_key::text;
  v_index integer;
begin
  if jsonb_typeof(coalesce(p_projection_commands, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_projection_commands, '[]'::jsonb)) not in (0, jsonb_array_length(p_items)) then
    raise exception using errcode = '22023', message = 'planning github projection commands are invalid';
  end if;
  v_result := public.create_team_planning_items_transaction(
    p_token_id, p_profile_id, p_idempotency_key, p_request_hash, p_items,
    p_request_ip, p_user_agent
  );
  v_items := v_result->'items';
  if not coalesce((v_result->>'replayed')::boolean, false) then
    for v_command, v_index in
      select value, ordinality::integer - 1
      from jsonb_array_elements(coalesce(p_projection_commands, '[]'::jsonb)) with ordinality
    loop
      if jsonb_typeof(v_command) = 'object' then
        v_request := public.enqueue_planning_github_projection_request(
          v_operation_id,
          v_items->v_index->'item'->>'id',
          p_profile_id,
          coalesce((v_command->>'createIfMissing')::boolean, false),
          'team_create', p_token_id, p_idempotency_key, v_index
        );
        v_items := jsonb_set(v_items, array[v_index::text, 'githubSync'],
          jsonb_build_object('status', 'accepted'), true);
      end if;
    end loop;
    update public.team_task_intake_batches
    set response_tasks = v_items
    where token_id = p_token_id and idempotency_key = p_idempotency_key;
    v_result := jsonb_set(v_result, '{items}', v_items, true);
  end if;
  return v_result || jsonb_build_object('projectionOperationId', v_operation_id);
end;
$$;

create or replace function public.update_team_planning_item_with_projection_transaction(
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
  p_request_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
  v_request public.planning_github_projection_outbox%rowtype;
  v_operation_id text := 'team-update:' || p_token_id::text || ':' || p_idempotency_key::text;
begin
  v_result := public.update_team_planning_item_transaction(
    p_token_id, p_profile_id, p_item_type, p_item_id, p_expected_updated_at,
    p_idempotency_key, p_request_hash, p_patch, p_changed_fields, p_system_effects,
    p_request_ip, p_user_agent
  );
  if p_projection_command is not null and not coalesce((v_result->>'replayed')::boolean, false) then
    if jsonb_typeof(p_projection_command) <> 'object' then
      raise exception using errcode = '22023', message = 'planning github projection command is invalid';
    end if;
    v_request := public.enqueue_planning_github_projection_request(
      v_operation_id, p_item_id, p_profile_id,
      coalesce((p_projection_command->>'createIfMissing')::boolean, false),
      'team_update', p_token_id, p_idempotency_key, null
    );
    v_result := jsonb_set(v_result, '{githubSync}', jsonb_build_object('status', 'accepted'), true);
    update public.team_planning_item_update_requests
    set response = v_result
    where token_id = p_token_id and idempotency_key = p_idempotency_key;
  end if;
  return v_result || jsonb_build_object('projectionOperationId', v_operation_id);
end;
$$;

create or replace function public.mutate_team_planning_reparent_with_projection_transaction(
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
  p_projection_command jsonb default null,
  p_request_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
  v_request public.planning_github_projection_outbox%rowtype;
  v_operation_id text := 'team-update:' || p_token_id::text || ':' || p_idempotency_key::text;
begin
  v_result := public.mutate_team_planning_reparent_command_transaction(
    p_token_id, p_profile_id, p_item_id, p_item_type, p_expected_updated_at,
    p_parent_task_id, p_expected_parent_updated_at, p_idempotency_key,
    p_request_hash, p_changed_field, p_request_ip, p_user_agent
  );
  if p_projection_command is not null and not coalesce((v_result->>'replayed')::boolean, false) then
    v_request := public.enqueue_planning_github_projection_request(
      v_operation_id, p_item_id, p_profile_id,
      coalesce((p_projection_command->>'createIfMissing')::boolean, false),
      'team_update', p_token_id, p_idempotency_key, null
    );
    v_result := jsonb_set(v_result, '{githubSync}', jsonb_build_object('status', 'accepted'), true);
    update public.team_planning_item_update_requests
    set response = v_result
    where token_id = p_token_id and idempotency_key = p_idempotency_key;
  end if;
  return v_result || jsonb_build_object('projectionOperationId', v_operation_id);
end;
$$;

create or replace function public.enqueue_team_planning_github_projection_transaction(
  p_token_id uuid,
  p_profile_id text,
  p_item_id text,
  p_idempotency_key uuid,
  p_create_if_missing boolean
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_task public.tasks%rowtype;
  v_request public.planning_github_projection_outbox%rowtype;
  v_operation_id text := 'team-sync:' || p_token_id::text || ':' || p_idempotency_key::text;
begin
  if p_token_id is null or p_idempotency_key is null or p_create_if_missing is null then
    raise exception using errcode = '22023', message = 'planning github projection input is invalid';
  end if;
  select * into v_token from public.team_task_intake_tokens
  where id = p_token_id and profile_id = p_profile_id and revoked_at is null and expires_at > now()
  for update;
  if not found then raise exception using errcode = 'P0004', message = 'planning items token is inactive'; end if;
  if not ('write:planning-items:github-sync' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning github projection scope is missing';
  end if;
  if exists (
    select 1 from public.planning_github_projection_outbox request
    where request.planning_operation_id = v_operation_id
      and (request.task_id <> p_item_id or request.create_if_missing is distinct from p_create_if_missing)
  ) then
    raise exception using errcode = 'P0003', message = 'planning github projection idempotency conflict';
  end if;
  select * into v_task from public.tasks where id = p_item_id and trashed_at is null for share;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  v_request := public.enqueue_planning_github_projection_request(
    v_operation_id, p_item_id, p_profile_id, p_create_if_missing
  );
  return jsonb_build_object(
    'operationId', v_operation_id,
    'itemId', p_item_id,
    'itemType', v_task.task_type,
    'githubSync', coalesce(v_request.result, jsonb_build_object('status', 'accepted')),
    'replayed', v_request.attempts > 0 or v_request.status <> 'pending'
  );
end;
$$;

create or replace function public.claim_planning_github_projection_requests(
  p_lock_token uuid,
  p_limit integer default 25,
  p_lease_seconds integer default 120,
  p_operation_id text default null
) returns setof public.planning_github_projection_outbox
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_lock_token is null or p_limit not between 1 and 100 or p_lease_seconds not between 30 and 900 then
    raise exception using errcode = '22023', message = 'planning github projection claim input is invalid';
  end if;
  return query
  with candidates as (
    select request.id
    from public.planning_github_projection_outbox request
    where ((request.status in ('pending', 'retry_scheduled') and request.available_at <= now())
      or (request.status = 'processing' and request.locked_at < now() - make_interval(secs => p_lease_seconds)))
      and (p_operation_id is null or request.planning_operation_id = p_operation_id)
      and not exists (
        select 1 from public.planning_github_projection_outbox predecessor
        where predecessor.task_id = request.task_id
          and predecessor.status <> 'completed'
          and predecessor.delivery_sequence < request.delivery_sequence
      )
      and not exists (
        select 1 from public.planning_github_lifecycle_outbox predecessor
        where predecessor.task_id = request.task_id
          and predecessor.status <> 'completed'
          and predecessor.delivery_sequence < request.delivery_sequence
      )
    order by request.delivery_sequence
    for update skip locked
    limit p_limit
  )
  update public.planning_github_projection_outbox request
  set status = 'processing', attempts = attempts + 1, locked_at = clock_timestamp(),
      lock_token = p_lock_token, status_reason = null, last_error = null,
      updated_at = clock_timestamp()
  from candidates where request.id = candidates.id
  returning request.*;
end;
$$;

create or replace function public.finalize_planning_github_projection_request(
  p_request_id uuid,
  p_lock_token uuid,
  p_succeeded boolean,
  p_result jsonb,
  p_error_message text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_request public.planning_github_projection_outbox%rowtype;
  v_error text := left(nullif(trim(coalesce(p_error_message, '')), ''), 2000);
  v_next_status text;
begin
  select * into v_request from public.planning_github_projection_outbox
  where id = p_request_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'planning github projection request not found'; end if;
  if v_request.status <> 'processing' or v_request.lock_token is distinct from p_lock_token then
    raise exception using errcode = 'P0001', message = 'planning github projection lease changed';
  end if;
  if not p_succeeded and v_error is null then
    raise exception using errcode = '22023', message = 'planning github projection error is required';
  end if;
  v_next_status := case when p_succeeded then 'completed' when v_request.attempts >= 5 then 'failed' else 'retry_scheduled' end;
  update public.planning_github_projection_outbox
  set status = v_next_status,
      available_at = case when v_next_status = 'retry_scheduled'
        then clock_timestamp() + make_interval(secs => least(3600, (power(2, least(attempts, 6)) * 60)::integer))
        else available_at end,
      locked_at = null, lock_token = null,
      completed_at = case when v_next_status = 'completed' then clock_timestamp() else null end,
      status_reason = case when v_next_status = 'completed' then 'delivered' when v_next_status = 'failed' then 'delivery_failed' else 'retry_after_error' end,
      result = p_result, last_error = case when p_succeeded then null else v_error end,
      updated_at = clock_timestamp()
  where id = p_request_id returning * into v_request;

  if v_request.receipt_kind = 'team_create' then
    update public.team_task_intake_batches batch
    set response_tasks = jsonb_set(batch.response_tasks,
      array[v_request.receipt_item_index::text, 'githubSync'], p_result, true)
    where batch.token_id = v_request.receipt_token_id
      and batch.idempotency_key = v_request.receipt_idempotency_key;
  elsif v_request.receipt_kind = 'team_update' then
    update public.team_planning_item_update_requests receipt
    set response = jsonb_set(receipt.response, '{githubSync}', p_result, true)
    where receipt.token_id = v_request.receipt_token_id
      and receipt.idempotency_key = v_request.receipt_idempotency_key;
  end if;
  return to_jsonb(v_request);
end;
$$;

create or replace function public.claim_planning_github_lifecycle_jobs_transaction(
  p_lock_token uuid,
  p_limit integer,
  p_lease_seconds integer,
  p_root_type text,
  p_root_id text,
  p_task_ids text[]
) returns setof public.planning_github_lifecycle_outbox
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_lock_token is null or p_limit not between 1 and 100 or p_lease_seconds not between 30 and 900
     or (p_root_type is null and (p_root_id is not null or p_task_ids is not null))
     or (p_root_type is not null and (p_root_type not in ('initiative', 'deliverable')
       or nullif(trim(coalesce(p_root_id, '')), '') is null or p_task_ids is null
       or cardinality(p_task_ids) < 1 or exists (
         select 1 from unnest(p_task_ids) task_id where nullif(trim(coalesce(task_id, '')), '') is null
       ))) then
    raise exception using errcode = '22023', message = 'planning github lifecycle claim input is invalid';
  end if;
  return query
  with candidates as (
    select job.id
    from public.planning_github_lifecycle_outbox job
    where ((job.status in ('pending', 'retry_scheduled') and job.available_at <= now())
      or (job.status = 'processing' and job.locked_at < now() - make_interval(secs => p_lease_seconds)))
      and (p_root_type is null or (job.root_type = p_root_type and job.root_id = p_root_id and job.task_id = any(p_task_ids)))
      and not exists (
        select 1 from public.planning_github_lifecycle_outbox predecessor
        where predecessor.task_id = job.task_id and predecessor.status <> 'completed'
          and predecessor.delivery_sequence < job.delivery_sequence
      )
      and not exists (
        select 1 from public.planning_github_projection_outbox predecessor
        where predecessor.task_id = job.task_id and predecessor.status <> 'completed'
          and predecessor.delivery_sequence < job.delivery_sequence
      )
    order by job.delivery_sequence
    for update skip locked
    limit p_limit
  )
  update public.planning_github_lifecycle_outbox job
  set status = 'processing', attempts = attempts + 1, locked_at = clock_timestamp(),
      lock_token = p_lock_token, status_reason = null, last_error = null,
      updated_at = clock_timestamp()
  from candidates where job.id = candidates.id
  returning job.*;
end;
$$;

revoke all on table public.planning_github_projection_outbox from public, anon, authenticated;
grant select on table public.planning_github_projection_outbox to service_role;
revoke all on sequence public.planning_github_delivery_sequence from public, anon, authenticated;
grant usage, select on sequence public.planning_github_delivery_sequence to service_role;

revoke all on function public.enqueue_planning_github_projection_request(text,text,text,boolean,text,uuid,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.create_team_planning_items_with_projection_transaction(uuid,text,uuid,text,jsonb,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.update_team_planning_item_with_projection_transaction(uuid,text,text,text,timestamptz,uuid,text,jsonb,jsonb,jsonb,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.mutate_team_planning_reparent_with_projection_transaction(uuid,text,text,text,timestamptz,text,timestamptz,uuid,text,text,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.enqueue_team_planning_github_projection_transaction(uuid,text,text,uuid,boolean) from public,anon,authenticated;
revoke all on function public.claim_planning_github_projection_requests(uuid,integer,integer,text) from public,anon,authenticated;
revoke all on function public.finalize_planning_github_projection_request(uuid,uuid,boolean,jsonb,text) from public,anon,authenticated;

grant execute on function public.create_team_planning_items_with_projection_transaction(uuid,text,uuid,text,jsonb,jsonb,text,text) to service_role;
grant execute on function public.update_team_planning_item_with_projection_transaction(uuid,text,text,text,timestamptz,uuid,text,jsonb,jsonb,jsonb,jsonb,text,text) to service_role;
grant execute on function public.mutate_team_planning_reparent_with_projection_transaction(uuid,text,text,text,timestamptz,text,timestamptz,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.enqueue_team_planning_github_projection_transaction(uuid,text,text,uuid,boolean) to service_role;
grant execute on function public.claim_planning_github_projection_requests(uuid,integer,integer,text) to service_role;
grant execute on function public.finalize_planning_github_projection_request(uuid,uuid,boolean,jsonb,text) to service_role;

comment on function public.create_team_planning_items_with_projection_transaction(uuid,text,uuid,text,jsonb,jsonb,text,text) is
  'Atomically commits Team Planning Items and durable GitHub projection requests.';
comment on function public.update_team_planning_item_with_projection_transaction(uuid,text,text,text,timestamptz,uuid,text,jsonb,jsonb,jsonb,jsonb,text,text) is
  'Atomically revises a Team Planning Item and enqueues its durable GitHub projection request.';
