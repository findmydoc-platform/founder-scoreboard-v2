create table if not exists public.team_task_intake_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id text not null references public.profiles(id) on delete cascade,
  label text not null,
  token_hash text not null unique,
  token_hint text not null,
  scopes text[] not null default array['read:task-context', 'write:task-intake'],
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint team_task_intake_tokens_label_check check (char_length(label) between 1 and 80),
  constraint team_task_intake_tokens_hash_check check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint team_task_intake_tokens_hint_check check (char_length(token_hint) between 4 and 16),
  constraint team_task_intake_tokens_scopes_check check (
    array_position(scopes, null) is null
    and scopes <@ array['read:task-context', 'write:task-intake']
    and scopes @> array['read:task-context', 'write:task-intake']
  ),
  constraint team_task_intake_tokens_expiry_check check (expires_at > created_at)
);

create index if not exists team_task_intake_tokens_profile_id_idx
  on public.team_task_intake_tokens(profile_id);

create index if not exists team_task_intake_tokens_active_profile_idx
  on public.team_task_intake_tokens(profile_id, expires_at)
  where revoked_at is null;

create table if not exists public.team_task_intake_batches (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references public.team_task_intake_tokens(id) on delete restrict,
  profile_id text not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  task_ids text[] not null,
  created_at timestamptz not null default now(),
  constraint team_task_intake_batches_request_hash_check check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint team_task_intake_batches_task_ids_check check (cardinality(task_ids) between 1 and 30),
  constraint team_task_intake_batches_token_key_unique unique (token_id, idempotency_key)
);

create index if not exists team_task_intake_batches_token_id_idx
  on public.team_task_intake_batches(token_id);

create index if not exists team_task_intake_batches_profile_id_idx
  on public.team_task_intake_batches(profile_id);

alter table public.team_task_intake_tokens enable row level security;
alter table public.team_task_intake_batches enable row level security;

revoke all on table public.team_task_intake_tokens from public, anon, authenticated;
revoke all on table public.team_task_intake_batches from public, anon, authenticated;
grant select, insert, update on table public.team_task_intake_tokens to service_role;
grant select, insert on table public.team_task_intake_batches to service_role;

comment on table public.team_task_intake_tokens
is 'Hashed personal tokens for task-centered team context and guarded task intake.';

comment on column public.team_task_intake_tokens.token_hash
is 'SHA-256 hash of the one-time visible personal intake token.';

comment on table public.team_task_intake_batches
is 'Immutable idempotency records for atomic Team Task Intake commits.';

create or replace function public.create_team_task_intake_token(
  p_profile_id text,
  p_label text,
  p_token_hash text,
  p_token_hint text,
  p_expires_at timestamptz
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
     or char_length(coalesce(p_token_hint, '')) not between 4 and 16
     or p_expires_at is null
     or p_expires_at <= now() then
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
    p_expires_at
  )
  returning * into v_token;

  return to_jsonb(v_token) - 'token_hash';
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
  v_batch public.team_task_intake_batches%rowtype;
  v_item jsonb;
  v_result jsonb;
  v_task jsonb;
  v_task_ids text[] := array[]::text[];
  v_tasks jsonb := '[]'::jsonb;
  v_item_count integer;
begin
  if p_token_id is null
     or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or p_idempotency_key is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'team intake batch input is invalid';
  end if;

  v_item_count := jsonb_array_length(p_items);
  if v_item_count < 1 or v_item_count > 30 then
    raise exception using errcode = '22023', message = 'team intake batch size is invalid';
  end if;

  if not exists (
    select 1
    from public.team_task_intake_tokens
    where id = p_token_id
      and profile_id = p_profile_id
      and revoked_at is null
      and expires_at > now()
  ) then
    raise exception using errcode = 'P0004', message = 'team intake token is inactive';
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

    select coalesce(jsonb_agg(to_jsonb(task_row) order by requested.ordinality), '[]'::jsonb)
    into v_tasks
    from unnest(v_batch.task_ids) with ordinality as requested(task_id, ordinality)
    join public.tasks as task_row on task_row.id = requested.task_id;

    return jsonb_build_object(
      'batchId', v_batch.id,
      'replayed', true,
      'tasks', v_tasks
    );
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item->'taskInsert') <> 'object'
       or jsonb_typeof(coalesce(v_item->'notifications', '[]'::jsonb)) <> 'array' then
      raise exception using errcode = '22023', message = 'team intake batch item is invalid';
    end if;

    v_result := public.create_task_transaction(
      v_item->'taskInsert',
      null,
      null,
      null,
      coalesce(v_item->>'activityMessage', 'Task via Team Intake created'),
      null,
      coalesce(v_item->'notifications', '[]'::jsonb),
      p_profile_id,
      p_request_ip,
      p_user_agent
    );
    v_task := v_result->'task';
    if v_task is null or nullif(v_task->>'id', '') is null then
      raise exception using errcode = 'P0001', message = 'team intake task creation returned no task';
    end if;
    v_task_ids := array_append(v_task_ids, v_task->>'id');
  end loop;

  insert into public.team_task_intake_batches (
    token_id,
    profile_id,
    idempotency_key,
    request_hash,
    task_ids
  ) values (
    p_token_id,
    p_profile_id,
    p_idempotency_key,
    p_request_hash,
    v_task_ids
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

  select coalesce(jsonb_agg(to_jsonb(task_row) order by requested.ordinality), '[]'::jsonb)
  into v_tasks
  from unnest(v_task_ids) with ordinality as requested(task_id, ordinality)
  join public.tasks as task_row on task_row.id = requested.task_id;

  return jsonb_build_object(
    'batchId', v_batch.id,
    'replayed', false,
    'tasks', v_tasks
  );
end;
$$;

revoke all on function public.create_team_task_intake_token(text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.create_team_task_intake_batch_transaction(uuid, text, uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.create_team_task_intake_token(text, text, text, text, timestamptz) to service_role;
grant execute on function public.create_team_task_intake_batch_transaction(uuid, text, uuid, text, jsonb, text, text) to service_role;

comment on function public.create_team_task_intake_token(text, text, text, text, timestamptz)
is 'Creates one expiring personal Team Task Intake token while enforcing the active-token limit.';

comment on function public.create_team_task_intake_batch_transaction(uuid, text, uuid, text, jsonb, text, text)
is 'Atomically and idempotently creates a Team Task Intake batch through the guarded task transaction.';

notify pgrst, 'reload schema';
