create table if not exists public.task_deletion_operations (
  id uuid primary key default gen_random_uuid(),
  task_id text not null unique,
  status text not null default 'prepared' check (status in ('prepared', 'completed')),
  task_updated_at timestamptz not null,
  task_snapshot jsonb not null,
  task_snapshots jsonb not null default '[]'::jsonb,
  deleted_task_ids text[] not null default '{}',
  github_closed boolean not null default false,
  actor_profile_id text references public.profiles(id) on delete set null,
  request_ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.task_deletion_operations
  add column if not exists task_snapshots jsonb not null default '[]'::jsonb;

create index if not exists task_deletion_operations_status_idx
  on public.task_deletion_operations(status, updated_at);

alter table public.task_deletion_operations enable row level security;
revoke all on table public.task_deletion_operations from public, anon, authenticated;
grant select, insert, update, delete on table public.task_deletion_operations to service_role;

create or replace function public.prepare_task_deletion_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_actor_profile_id text default null,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.task_deletion_operations%rowtype;
  v_task public.tasks%rowtype;
  v_deleted_task_ids text[];
  v_task_snapshots jsonb;
begin
  if nullif(trim(coalesce(p_task_id, '')), '') is null or p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'task id and expected update timestamp are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_task_id, 0));

  select * into v_operation
  from public.task_deletion_operations
  where task_id = p_task_id;

  if v_operation.id is not null then
    if v_operation.status = 'completed' then
      select * into v_task from public.tasks where id = p_task_id for update;
      if v_task.id is null then
        return jsonb_build_object(
          'operationId', v_operation.id,
          'status', v_operation.status,
          'task', v_operation.task_snapshot,
          'tasks', v_operation.task_snapshots,
          'deletedTaskIds', to_jsonb(v_operation.deleted_task_ids),
          'githubClosed', v_operation.github_closed
        );
      end if;
      delete from public.task_deletion_operations where id = v_operation.id;
      v_operation := null;
    else
      select * into v_task from public.tasks where id = p_task_id for update;
      if v_task.id is null then
        raise exception using errcode = 'P0002', message = 'task not found';
      end if;

      if v_task.updated_at = v_operation.task_updated_at then
        return jsonb_build_object(
          'operationId', v_operation.id,
          'status', v_operation.status,
          'task', v_operation.task_snapshot,
          'tasks', v_operation.task_snapshots,
          'deletedTaskIds', to_jsonb(v_operation.deleted_task_ids),
          'githubClosed', v_operation.github_closed
        );
      end if;

      delete from public.task_deletion_operations where id = v_operation.id;
      v_operation := null;
    end if;
  end if;

  select * into v_task
  from public.tasks
  where id = p_task_id
    and updated_at = p_expected_updated_at
  for update;

  if v_task.id is null then
    if exists (select 1 from public.tasks where id = p_task_id) then
      raise exception using errcode = 'P0001', message = 'task was changed concurrently';
    end if;
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  with recursive deletion_tree as (
    select id from public.tasks where id = p_task_id
    union
    select child.id
    from public.tasks as child
    join deletion_tree as parent on child.parent_task_id = parent.id
  )
  select coalesce(array_agg(id order by id), '{}'::text[])
  into v_deleted_task_ids
  from deletion_tree;

  select coalesce(jsonb_agg(to_jsonb(task) order by task.id), '[]'::jsonb)
  into v_task_snapshots
  from public.tasks as task
  where task.id = any(v_deleted_task_ids);

  insert into public.task_deletion_operations (
    task_id,
    task_updated_at,
    task_snapshot,
    task_snapshots,
    deleted_task_ids,
    actor_profile_id,
    request_ip,
    user_agent
  )
  values (
    p_task_id,
    v_task.updated_at,
    to_jsonb(v_task),
    v_task_snapshots,
    v_deleted_task_ids,
    p_actor_profile_id,
    p_request_ip,
    p_user_agent
  )
  returning * into v_operation;

  return jsonb_build_object(
    'operationId', v_operation.id,
    'status', v_operation.status,
    'task', v_operation.task_snapshot,
    'tasks', v_operation.task_snapshots,
    'deletedTaskIds', to_jsonb(v_operation.deleted_task_ids),
    'githubClosed', v_operation.github_closed
  );
end;
$$;

create or replace function public.finalize_task_deletion_transaction(
  p_operation_id uuid,
  p_github_closed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.task_deletion_operations%rowtype;
  v_task public.tasks%rowtype;
begin
  select * into v_operation
  from public.task_deletion_operations
  where id = p_operation_id
  for update;

  if v_operation.id is null then
    raise exception using errcode = 'P0002', message = 'task deletion operation not found';
  end if;

  if v_operation.status = 'completed' then
    return jsonb_build_object(
      'operationId', v_operation.id,
      'status', v_operation.status,
      'deletedTaskIds', to_jsonb(v_operation.deleted_task_ids),
      'githubClosed', v_operation.github_closed
    );
  end if;

  select * into v_task
  from public.tasks
  where id = v_operation.task_id
  for update;

  if v_task.id is null then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  if v_task.updated_at <> v_operation.task_updated_at then
    raise exception using errcode = 'P0001', message = 'task was changed concurrently';
  end if;

  delete from public.tasks where id = v_operation.task_id;

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    request_ip,
    user_agent
  )
  values (
    v_operation.actor_profile_id,
    'task.delete',
    'task',
    v_operation.task_id,
    v_operation.task_snapshot,
    jsonb_build_object(
      'deleted', true,
      'deletedTaskIds', to_jsonb(v_operation.deleted_task_ids),
      'githubClosed', coalesce(p_github_closed, false)
    ),
    v_operation.request_ip,
    v_operation.user_agent
  );

  update public.task_deletion_operations
  set status = 'completed',
      github_closed = coalesce(p_github_closed, false),
      updated_at = clock_timestamp(),
      completed_at = clock_timestamp()
  where id = v_operation.id
  returning * into v_operation;

  return jsonb_build_object(
    'operationId', v_operation.id,
    'status', v_operation.status,
    'deletedTaskIds', to_jsonb(v_operation.deleted_task_ids),
    'githubClosed', v_operation.github_closed
  );
end;
$$;

create or replace function public.cancel_task_deletion_transaction(p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.task_deletion_operations%rowtype;
begin
  select * into v_operation
  from public.task_deletion_operations
  where id = p_operation_id
  for update;

  if v_operation.id is null then
    return jsonb_build_object('cancelled', true);
  end if;

  if v_operation.status = 'completed' then
    return jsonb_build_object(
      'cancelled', false,
      'status', v_operation.status,
      'task', v_operation.task_snapshot
    );
  end if;

  delete from public.task_deletion_operations where id = v_operation.id;

  return jsonb_build_object(
    'cancelled', true,
    'status', 'cancelled',
    'task', v_operation.task_snapshot
  );
end;
$$;

revoke all on function public.prepare_task_deletion_transaction(text, timestamptz, text, text, text) from public, anon, authenticated;
revoke all on function public.finalize_task_deletion_transaction(uuid, boolean) from public, anon, authenticated;
revoke all on function public.cancel_task_deletion_transaction(uuid) from public, anon, authenticated;
grant execute on function public.prepare_task_deletion_transaction(text, timestamptz, text, text, text) to service_role;
grant execute on function public.finalize_task_deletion_transaction(uuid, boolean) to service_role;
grant execute on function public.cancel_task_deletion_transaction(uuid) to service_role;

comment on table public.task_deletion_operations
is 'Durable saga state for idempotent task deletion across GitHub and PostgreSQL.';

comment on function public.prepare_task_deletion_transaction(text, timestamptz, text, text, text)
is 'Validates task deletion with compare-and-set and stores a durable deletion snapshot.';

comment on function public.finalize_task_deletion_transaction(uuid, boolean)
is 'Atomically deletes a prepared task tree, writes its audit record, and completes the deletion operation.';

comment on function public.cancel_task_deletion_transaction(uuid)
is 'Cancels an unfinished task deletion operation after an external side-effect failure.';

notify pgrst, 'reload schema';
