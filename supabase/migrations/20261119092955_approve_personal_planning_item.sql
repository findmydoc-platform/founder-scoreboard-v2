create table if not exists public.team_planning_item_approval_requests (
  token_id uuid not null references public.team_task_intake_tokens(id) on delete cascade,
  profile_id text not null references public.profiles(id),
  idempotency_key uuid not null,
  item_id text not null,
  expected_revision integer not null check (expected_revision > 0),
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  primary key (token_id, idempotency_key)
);

alter table public.team_planning_item_approval_requests enable row level security;
revoke all on table public.team_planning_item_approval_requests from public, anon, authenticated;
grant all on table public.team_planning_item_approval_requests to service_role;

create or replace function public.approve_team_planning_item_transaction(
  p_token_id uuid,
  p_profile_id text,
  p_item_id text,
  p_expected_revision integer,
  p_idempotency_key uuid
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_request public.team_planning_item_approval_requests%rowtype;
  v_token public.team_task_intake_tokens%rowtype;
  v_role text;
  v_user_id uuid;
  v_task public.tasks%rowtype;
  v_result jsonb;
begin
  if p_token_id is null or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or nullif(trim(coalesce(p_item_id, '')), '') is null
     or p_expected_revision is null or p_expected_revision < 1
     or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'planning approval input is invalid';
  end if;

  select * into v_token from public.team_task_intake_tokens
  where id = p_token_id and profile_id = p_profile_id
  for update;
  if not found or v_token.revoked_at is not null or v_token.expires_at <= clock_timestamp() then
    raise exception using errcode = 'P0004', message = 'planning items token is inactive';
  end if;

  select platform_role, auth_user_id into v_role, v_user_id
  from public.profiles where id = p_profile_id for share;
  if not found or v_user_id is null or v_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'planning items profile role is not allowed';
  end if;

  if v_token.expires_at <= clock_timestamp() then
    raise exception using errcode = 'P0004', message = 'planning items token is inactive';
  end if;

  select * into v_request from public.team_planning_item_approval_requests
  where token_id = p_token_id and idempotency_key = p_idempotency_key;
  if found then
    if v_request.profile_id <> p_profile_id or v_request.item_id <> p_item_id
       or v_request.expected_revision <> p_expected_revision then
      raise exception using errcode = 'P0020', message = 'idempotency key conflict';
    end if;
    return jsonb_set(v_request.response, '{replayed}', 'true'::jsonb);
  end if;

  select * into v_task from public.tasks
  where id = p_item_id and project_id = 'findmydoc-founder-execution'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_task.task_type not in ('initiative', 'deliverable') then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;

  if v_token.expires_at <= clock_timestamp() then
    raise exception using errcode = 'P0004', message = 'planning items token is inactive';
  end if;

  v_result := public.mutate_planning_approval_command_transaction(
    p_item_id, v_task.task_type, p_expected_revision, 'approve', p_profile_id, null
  ) || jsonb_build_object('replayed', false);
  if v_task.task_type = 'initiative' then
    v_result := jsonb_set(v_result, '{task}', (v_result->'task')
      || coalesce((select jsonb_build_object(
        'goal', strategy.goal,
        'success_criteria', strategy.success_criteria,
        'scope_constraints', strategy.scope_constraints
      ) from public.planning_item_strategy strategy where strategy.task_id = p_item_id), '{}'::jsonb)
      || jsonb_build_object('raci_assignments', coalesce((
        select jsonb_agg(to_jsonb(raci) order by raci.sort_order, raci.profile_id)
        from public.planning_item_raci_assignments raci where raci.task_id = p_item_id
      ), '[]'::jsonb)));
  end if;
  insert into public.team_planning_item_approval_requests
    (token_id, profile_id, idempotency_key, item_id, expected_revision, response)
  values (p_token_id, p_profile_id, p_idempotency_key, p_item_id, p_expected_revision, v_result);
  return v_result;
end;
$$;

revoke all on function public.approve_team_planning_item_transaction(uuid, text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.approve_team_planning_item_transaction(uuid, text, text, integer, uuid) to service_role;
