create unique index if not exists github_app_user_tokens_active_user_id_uidx
  on public.github_app_user_tokens(github_user_id)
  where github_user_id is not null and revoked_at is null;

comment on index public.github_app_user_tokens_active_user_id_uidx is
  'One active FounderOps identity per stable GitHub user id. Logins remain display metadata only.';

create table if not exists public.github_planning_webhook_deliveries (
  delivery_id text primary key,
  event_name text not null,
  action text not null,
  installation_id bigint,
  organization_id bigint,
  organization_login text,
  repository_id bigint,
  repository_full_name text,
  issue_id bigint,
  issue_node_id text,
  issue_number integer,
  issue_updated_at timestamptz,
  related_repository_id bigint,
  related_repository_full_name text,
  related_issue_id bigint,
  related_issue_node_id text,
  related_issue_number integer,
  related_issue_updated_at timestamptz,
  project_node_id text,
  project_item_node_id text,
  project_item_updated_at timestamptz,
  project_content_node_id text,
  project_content_type text,
  project_field_node_id text,
  changed_fields text[] not null default '{}',
  target_user_id bigint,
  target_user_login text,
  sender_id bigint,
  sender_login text,
  sender_type text,
  payload_sha256 text not null,
  status text not null default 'received',
  status_reason text,
  processing_version integer not null default 1,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  processed_at timestamptz,
  last_error text,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint github_planning_webhook_deliveries_delivery_id_check
    check (nullif(trim(delivery_id), '') is not null and length(delivery_id) <= 128),
  constraint github_planning_webhook_deliveries_event_name_check
    check (event_name in ('issues', 'sub_issues', 'issue_dependencies', 'projects_v2_item')),
  constraint github_planning_webhook_deliveries_action_check
    check (nullif(trim(action), '') is not null and length(action) <= 64),
  constraint github_planning_webhook_deliveries_installation_id_check
    check (installation_id is null or installation_id > 0),
  constraint github_planning_webhook_deliveries_organization_id_check
    check (organization_id is null or organization_id > 0),
  constraint github_planning_webhook_deliveries_organization_login_check
    check (organization_login is null or (nullif(trim(organization_login), '') is not null and length(organization_login) <= 255)),
  constraint github_planning_webhook_deliveries_repository_id_check
    check (repository_id is null or repository_id > 0),
  constraint github_planning_webhook_deliveries_repository_check
    check (repository_full_name is null or (nullif(trim(repository_full_name), '') is not null and length(repository_full_name) <= 255)),
  constraint github_planning_webhook_deliveries_issue_id_check check (issue_id is null or issue_id > 0),
  constraint github_planning_webhook_deliveries_issue_node_id_check
    check (issue_node_id is null or (nullif(trim(issue_node_id), '') is not null and length(issue_node_id) <= 255)),
  constraint github_planning_webhook_deliveries_issue_number_check check (issue_number is null or issue_number > 0),
  constraint github_planning_webhook_deliveries_related_repository_id_check
    check (related_repository_id is null or related_repository_id > 0),
  constraint github_planning_webhook_deliveries_related_repository_check
    check (related_repository_full_name is null or (nullif(trim(related_repository_full_name), '') is not null and length(related_repository_full_name) <= 255)),
  constraint github_planning_webhook_deliveries_related_issue_id_check check (related_issue_id is null or related_issue_id > 0),
  constraint github_planning_webhook_deliveries_related_issue_node_id_check
    check (related_issue_node_id is null or (nullif(trim(related_issue_node_id), '') is not null and length(related_issue_node_id) <= 255)),
  constraint github_planning_webhook_deliveries_related_issue_number_check check (related_issue_number is null or related_issue_number > 0),
  constraint github_planning_webhook_deliveries_project_node_id_check
    check (project_node_id is null or (nullif(trim(project_node_id), '') is not null and length(project_node_id) <= 255)),
  constraint github_planning_webhook_deliveries_project_item_node_id_check
    check (project_item_node_id is null or (nullif(trim(project_item_node_id), '') is not null and length(project_item_node_id) <= 255)),
  constraint github_planning_webhook_deliveries_project_content_node_id_check
    check (project_content_node_id is null or (nullif(trim(project_content_node_id), '') is not null and length(project_content_node_id) <= 255)),
  constraint github_planning_webhook_deliveries_project_content_type_check
    check (project_content_type is null or project_content_type = 'Issue'),
  constraint github_planning_webhook_deliveries_project_field_node_id_check
    check (project_field_node_id is null or (nullif(trim(project_field_node_id), '') is not null and length(project_field_node_id) <= 255)),
  constraint github_planning_webhook_deliveries_changed_fields_check
    check (cardinality(changed_fields) between 0 and 20),
  constraint github_planning_webhook_deliveries_target_user_check
    check ((target_user_id is null and target_user_login is null) or (
      target_user_id > 0 and nullif(trim(target_user_login), '') is not null and length(target_user_login) <= 255
    )),
  constraint github_planning_webhook_deliveries_sender_id_check check (sender_id is null or sender_id > 0),
  constraint github_planning_webhook_deliveries_sender_login_check
    check (sender_login is null or (nullif(trim(sender_login), '') is not null and length(sender_login) <= 255)),
  constraint github_planning_webhook_deliveries_sender_type_check
    check (sender_type is null or (nullif(trim(sender_type), '') is not null and length(sender_type) <= 64)),
  constraint github_planning_webhook_deliveries_payload_sha256_check
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint github_planning_webhook_deliveries_status_check
    check (status in ('received', 'processing', 'retry_scheduled', 'processed', 'ignored', 'failed')),
  constraint github_planning_webhook_deliveries_status_reason_check
    check (status_reason is null or (nullif(trim(status_reason), '') is not null and length(status_reason) <= 120)),
  constraint github_planning_webhook_deliveries_processing_version_check check (processing_version >= 1),
  constraint github_planning_webhook_deliveries_attempts_check check (attempts >= 0),
  constraint github_planning_webhook_deliveries_lock_check check (
    (status = 'processing' and locked_at is not null and lock_token is not null)
    or (status <> 'processing' and locked_at is null and lock_token is null)
  ),
  constraint github_planning_webhook_deliveries_processed_check check (
    (status = 'processed' and processed_at is not null)
    or (status <> 'processed' and processed_at is null)
  ),
  constraint github_planning_webhook_deliveries_resource_shape_check check (
    (
      event_name = 'issues'
      and installation_id is not null
      and repository_id is not null and repository_full_name is not null
      and issue_id is not null and issue_node_id is not null and issue_number is not null and issue_updated_at is not null
      and related_issue_id is null and related_issue_updated_at is null
      and project_item_node_id is null and project_item_updated_at is null and project_content_node_id is null
    )
    or (
      event_name in ('sub_issues', 'issue_dependencies')
      and installation_id is not null
      and repository_id is not null and repository_full_name is not null
      and issue_id is not null and issue_node_id is not null and issue_number is not null
      and issue_updated_at is not null
      and related_repository_id is not null and related_repository_full_name is not null
      and related_issue_id is not null and related_issue_node_id is not null and related_issue_number is not null
      and related_issue_updated_at is not null
      and project_item_node_id is null and project_item_updated_at is null and project_content_node_id is null
    )
    or (
      event_name = 'projects_v2_item'
      and organization_id is not null and organization_login is not null
      and project_node_id is not null and project_item_node_id is not null
      and project_item_updated_at is not null
      and project_content_node_id is not null and project_content_type = 'Issue'
      and (
        (action = 'edited' and project_field_node_id is not null)
        or (action <> 'edited' and project_field_node_id is null)
      )
    )
  )
);

comment on table public.github_planning_webhook_deliveries is
  'Verified GitHub planning change journal. Stores stable resource identities, changed field names, and a payload hash, never Issue content.';
comment on column public.github_planning_webhook_deliveries.sender_id is
  'Stable GitHub user id proposed as the human actor. GitHub App identity is never authorization.';
comment on column public.github_planning_webhook_deliveries.changed_fields is
  'Bounded names of fields reported as changed. Values are reloaded from GitHub before processing.';

create index if not exists github_planning_webhook_deliveries_claim_idx
  on public.github_planning_webhook_deliveries(status, available_at, received_at)
  where status in ('received', 'processing', 'retry_scheduled');

create index if not exists github_planning_webhook_deliveries_issue_idx
  on public.github_planning_webhook_deliveries(repository_full_name, issue_number, received_at desc)
  where repository_full_name is not null and issue_number is not null;

create index if not exists github_planning_webhook_deliveries_project_item_idx
  on public.github_planning_webhook_deliveries(project_item_node_id, received_at desc)
  where project_item_node_id is not null;

alter table public.github_planning_webhook_deliveries enable row level security;

revoke all on table public.github_planning_webhook_deliveries from public, anon, authenticated, service_role;
grant select, insert on table public.github_planning_webhook_deliveries to service_role;

alter table public.planning_github_projection_outbox
  alter column actor_profile_id drop not null,
  add column if not exists source_kind text not null default 'command',
  add column if not exists source_delivery_id text references public.github_planning_webhook_deliveries(delivery_id);

alter table public.planning_github_projection_outbox
  drop constraint if exists planning_github_projection_source_kind_check;
alter table public.planning_github_projection_outbox
  add constraint planning_github_projection_source_kind_check
    check (
      (source_kind = 'command' and source_delivery_id is null and actor_profile_id is not null)
      or (source_kind = 'github_webhook' and source_delivery_id is not null)
    );

create index if not exists planning_github_projection_source_delivery_idx
  on public.planning_github_projection_outbox(source_delivery_id)
  where source_delivery_id is not null;

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
          and predecessor.status in ('pending', 'processing', 'retry_scheduled')
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
        where predecessor.task_id = job.task_id
          and predecessor.status in ('pending', 'processing', 'retry_scheduled')
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

comment on column public.planning_github_projection_outbox.actor_profile_id is
  'Human actor for authorized commands; null for corrective webhook reconciliation without an authorized FounderOps identity.';
comment on column public.planning_github_projection_outbox.source_delivery_id is
  'Verified inbound delivery that caused an automatic desired-state reconciliation.';

create or replace function public.claim_github_planning_webhook_delivery(
  p_delivery_id text,
  p_lock_token uuid,
  p_lease_seconds integer default 120
) returns setof public.github_planning_webhook_deliveries
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lease interval := make_interval(
    secs => least(greatest(coalesce(p_lease_seconds, 120), 30), 900)
  );
begin
  if nullif(trim(coalesce(p_delivery_id, '')), '') is null or p_lock_token is null then
    raise exception using errcode = '22023', message = 'delivery id and lock token are required';
  end if;

  return query
  update public.github_planning_webhook_deliveries delivery
  set status = 'processing',
      status_reason = null,
      attempts = delivery.attempts + 1,
      locked_at = clock_timestamp(),
      lock_token = p_lock_token,
      processed_at = null,
      last_error = null,
      updated_at = clock_timestamp()
  where delivery.delivery_id = p_delivery_id
    and (
      (delivery.status in ('received', 'retry_scheduled') and delivery.available_at <= clock_timestamp())
      or (delivery.status = 'processing' and delivery.locked_at < clock_timestamp() - v_lease)
    )
  returning delivery.*;
end;
$$;

create or replace function public.resolve_github_planning_webhook_tasks(
  p_repository_full_name text,
  p_issue_number integer
) returns table (task_id text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_repository_full_name text := lower(nullif(trim(coalesce(p_repository_full_name, '')), ''));
begin
  if v_repository_full_name is null or p_issue_number is null or p_issue_number < 1 then
    raise exception using errcode = '22023', message = 'repository and Issue number are required';
  end if;

  return query
  select task.id
  from public.tasks task
  cross join lateral public.normalize_planning_github_issue_reference(
    task.task_type,
    task.github_repo,
    task.github_issue_number,
    task.issue_number,
    task.github_issue_url,
    task.issue_url
  ) issue_reference
  where task.trashed_at is null
    and issue_reference.reference_status = 'valid'
    and issue_reference.normalized_repo = v_repository_full_name
    and issue_reference.normalized_issue_number = p_issue_number
  order by task.id
  limit 2;
end;
$$;

create or replace function public.resolve_github_planning_webhook_actor(
  p_github_user_id bigint
) returns table (
  profile_id text,
  profile_name text,
  platform_role text
)
language sql
security definer
stable
set search_path to 'public'
as $$
  select profile.id, profile.name, profile.platform_role
  from public.github_app_user_tokens token
  join public.profiles profile on profile.id = token.profile_id
  where token.github_user_id = p_github_user_id
    and token.revoked_at is null
    and profile.auth_user_id is not null
    and profile.platform_role in ('ceo', 'deputy', 'founder')
  limit 1
$$;

create or replace function public.enqueue_github_webhook_planning_projection(
  p_delivery_id text,
  p_lock_token uuid,
  p_task_id text,
  p_observed_repository_full_name text default null,
  p_observed_issue_number integer default null
) returns public.planning_github_projection_outbox
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_delivery public.github_planning_webhook_deliveries%rowtype;
  v_task public.tasks%rowtype;
  v_actor_profile_id text;
  v_mapping_count integer;
  v_mapping_task_id text;
  v_related_mapping_count integer := 0;
  v_related_mapping_task_id text;
  v_observed_repository_full_name text := lower(nullif(trim(coalesce(p_observed_repository_full_name, '')), ''));
  v_task_reference record;
  v_request public.planning_github_projection_outbox%rowtype;
begin
  select * into v_delivery
  from public.github_planning_webhook_deliveries
  where delivery_id = p_delivery_id and status = 'processing' and lock_token = p_lock_token
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'active GitHub planning delivery lock was not found';
  end if;

  select * into v_task from public.tasks
  where id = p_task_id and trashed_at is null
  for share;
  if not found or v_task.task_type not in ('deliverable', 'sub_issue') then
    raise exception using errcode = 'P0014', message = 'GitHub planning projection target is not eligible';
  end if;

  if v_delivery.event_name = 'projects_v2_item' then
    if v_observed_repository_full_name is null or p_observed_issue_number is null or p_observed_issue_number < 1 then
      raise exception using errcode = '22023', message = 'observed Project Issue identity is required';
    end if;
    select * into v_task_reference
    from public.normalize_planning_github_issue_reference(
      v_task.task_type,
      v_task.github_repo,
      v_task.github_issue_number,
      v_task.issue_number,
      v_task.github_issue_url,
      v_task.issue_url
    );
    if v_task_reference.reference_status <> 'valid'
       or v_task_reference.normalized_repo <> v_observed_repository_full_name
       or v_task_reference.normalized_issue_number <> p_observed_issue_number then
      raise exception using errcode = 'P0003', message = 'GitHub Project Issue task mapping changed before projection';
    end if;
  else
    if v_delivery.repository_full_name is null or v_delivery.issue_number is null then
      raise exception using errcode = '22023', message = 'GitHub planning delivery has no Issue identity';
    end if;
    select count(*)::integer, min(mapping.task_id)
    into v_mapping_count, v_mapping_task_id
    from public.resolve_github_planning_webhook_tasks(
      v_delivery.repository_full_name,
      v_delivery.issue_number
    ) mapping;
    if v_delivery.related_repository_full_name is not null and v_delivery.related_issue_number is not null then
      select count(*)::integer, min(mapping.task_id)
      into v_related_mapping_count, v_related_mapping_task_id
      from public.resolve_github_planning_webhook_tasks(
        v_delivery.related_repository_full_name,
        v_delivery.related_issue_number
      ) mapping;
    end if;
    if not (
      (v_mapping_count = 1 and v_mapping_task_id = p_task_id)
      or (v_related_mapping_count = 1 and v_related_mapping_task_id = p_task_id)
    ) then
      raise exception using errcode = 'P0003', message = 'GitHub Issue task mapping changed before projection';
    end if;
  end if;

  select actor.profile_id into v_actor_profile_id
  from public.resolve_github_planning_webhook_actor(v_delivery.sender_id) actor;

  insert into public.planning_github_projection_outbox (
    planning_operation_id,
    task_id,
    actor_profile_id,
    source_revision_token,
    create_if_missing,
    source_kind,
    source_delivery_id
  ) values (
    'github-webhook:' || v_delivery.delivery_id,
    v_task.id,
    v_actor_profile_id,
    v_task.updated_at::text,
    false,
    'github_webhook',
    v_delivery.delivery_id
  )
  on conflict (planning_operation_id, task_id) do nothing
  returning * into v_request;

  if v_request.id is null then
    select * into v_request from public.planning_github_projection_outbox
    where planning_operation_id = 'github-webhook:' || v_delivery.delivery_id
      and task_id = v_task.id;
  end if;
  return v_request;
end;
$$;

create or replace function public.finalize_github_planning_webhook_delivery(
  p_delivery_id text,
  p_lock_token uuid,
  p_status text,
  p_status_reason text,
  p_last_error text default null,
  p_available_at timestamptz default null
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_updated integer;
  v_error text := left(nullif(trim(coalesce(p_last_error, '')), ''), 2000);
begin
  if p_status not in ('processed', 'ignored', 'retry_scheduled', 'failed')
     or nullif(trim(coalesce(p_status_reason, '')), '') is null
     or length(p_status_reason) > 120
     or (p_status = 'retry_scheduled' and p_available_at is null)
     or (p_status <> 'retry_scheduled' and p_available_at is not null) then
    raise exception using errcode = '22023', message = 'invalid GitHub planning delivery final status';
  end if;

  update public.github_planning_webhook_deliveries delivery
  set status = p_status,
      status_reason = p_status_reason,
      available_at = coalesce(p_available_at, delivery.available_at),
      locked_at = null,
      lock_token = null,
      processed_at = case when p_status = 'processed' then clock_timestamp() else null end,
      last_error = case when p_status in ('retry_scheduled', 'failed') then v_error else null end,
      updated_at = clock_timestamp()
  where delivery.delivery_id = p_delivery_id
    and delivery.status = 'processing'
    and delivery.lock_token = p_lock_token;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.claim_github_planning_webhook_delivery(text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.resolve_github_planning_webhook_tasks(text, integer)
  from public, anon, authenticated;
revoke all on function public.resolve_github_planning_webhook_actor(bigint)
  from public, anon, authenticated;
revoke all on function public.enqueue_github_webhook_planning_projection(text, uuid, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.finalize_github_planning_webhook_delivery(text, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.claim_github_planning_webhook_delivery(text, uuid, integer)
  to service_role;
grant execute on function public.resolve_github_planning_webhook_tasks(text, integer)
  to service_role;
grant execute on function public.resolve_github_planning_webhook_actor(bigint)
  to service_role;
grant execute on function public.enqueue_github_webhook_planning_projection(text, uuid, text, text, integer)
  to service_role;
grant execute on function public.finalize_github_planning_webhook_delivery(text, uuid, text, text, text, timestamptz)
  to service_role;

comment on function public.claim_github_planning_webhook_delivery(text, uuid, integer) is
  'Claims one verified planning delivery. Authorization is resolved later from the stable GitHub sender id.';
comment on function public.enqueue_github_webhook_planning_projection(text, uuid, text, text, integer) is
  'Durably restores the FounderOps desired state for one linked GitHub Issue without treating the App identity as a human actor.';

alter function public.update_team_planning_item_transaction(
  uuid, text, text, text, timestamptz, uuid, text, jsonb, jsonb, jsonb, text, text
) rename to update_team_planning_item_transaction_without_completed_guard;

create or replace function public.update_team_planning_item_transaction(
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
  p_request_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_completed_reopen boolean := false;
begin
  if exists (
    select 1 from public.team_planning_item_update_requests request
    where request.token_id = p_token_id and request.idempotency_key = p_idempotency_key
  ) then
    return public.update_team_planning_item_transaction_without_completed_guard(
      p_token_id, p_profile_id, p_item_type, p_item_id, p_expected_updated_at,
      p_idempotency_key, p_request_hash, p_patch, p_changed_fields, p_system_effects,
      p_request_ip, p_user_agent
    );
  end if;

  select * into v_task from public.tasks where id = p_item_id for update;
  if found and v_task.task_type in ('deliverable', 'sub_issue') and v_patch <> '{}'::jsonb then
    v_completed_reopen := v_task.status = 'Erledigt'
      and v_patch->>'status' = 'Offen'
      and (select count(*) from jsonb_object_keys(v_patch)) = 1;
    if v_task.status = 'Erledigt' and not v_completed_reopen then
      raise exception using errcode = 'P0016', message = 'completed planning item is locked';
    end if;
    if v_task.task_type = 'sub_issue' and v_task.parent_task_id is not null then
      select * into v_parent from public.tasks where id = v_task.parent_task_id for share;
      if found and v_parent.status = 'Erledigt' then
        raise exception using errcode = 'P0016', message = 'completed parent planning item is locked';
      end if;
    end if;
  end if;

  return public.update_team_planning_item_transaction_without_completed_guard(
    p_token_id, p_profile_id, p_item_type, p_item_id, p_expected_updated_at,
    p_idempotency_key, p_request_hash, p_patch, p_changed_fields, p_system_effects,
    p_request_ip, p_user_agent
  );
end;
$$;

revoke all on function public.update_team_planning_item_transaction_without_completed_guard(
  uuid, text, text, text, timestamptz, uuid, text, jsonb, jsonb, jsonb, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.update_team_planning_item_transaction(
  uuid, text, text, text, timestamptz, uuid, text, jsonb, jsonb, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.update_team_planning_item_transaction(
  uuid, text, text, text, timestamptz, uuid, text, jsonb, jsonb, jsonb, text, text
) to service_role;

alter function public.mutate_planning_review_command_transaction(
  text, text, timestamptz, text, text, text, text, jsonb, integer, text, text[], jsonb, jsonb, text, text
) rename to mutate_planning_review_command_transaction_without_completed_guard;

create or replace function public.mutate_planning_review_command_transaction(
  p_action text,
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_actor_profile_id text,
  p_reviewer_profile_id text,
  p_decision text,
  p_comment text,
  p_checklist jsonb,
  p_points integer,
  p_reason text,
  p_activity_messages text[],
  p_notifications jsonb,
  p_audit_after_data jsonb,
  p_request_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_task public.tasks%rowtype;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if found and v_task.status = 'Erledigt' and p_action <> 'reopen' then
    raise exception using errcode = 'P0016', message = 'completed planning item review is locked';
  end if;
  return public.mutate_planning_review_command_transaction_without_completed_guard(
    p_action, p_task_id, p_expected_updated_at, p_actor_profile_id,
    p_reviewer_profile_id, p_decision, p_comment, p_checklist, p_points,
    p_reason, p_activity_messages, p_notifications, p_audit_after_data,
    p_request_ip, p_user_agent
  );
end;
$$;

revoke all on function public.mutate_planning_review_command_transaction_without_completed_guard(
  text, text, timestamptz, text, text, text, text, jsonb, integer, text, text[], jsonb, jsonb, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.mutate_planning_review_command_transaction(
  text, text, timestamptz, text, text, text, text, jsonb, integer, text, text[], jsonb, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.mutate_planning_review_command_transaction(
  text, text, timestamptz, text, text, text, text, jsonb, integer, text, text[], jsonb, jsonb, text, text
) to service_role;

alter function public.update_browser_planning_task_transaction(
  text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb, text
) rename to update_browser_planning_task_transaction_without_completed_guard;

create or replace function public.update_browser_planning_task_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_task_patch jsonb,
  p_note_present boolean,
  p_note text,
  p_dependency_present boolean,
  p_dependency_note text,
  p_activity_messages text[],
  p_notifications jsonb,
  p_actor_profile_id text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_patch jsonb := coalesce(p_task_patch, '{}'::jsonb);
  v_completed_reopen boolean := false;
  v_actor_role text;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;

  v_completed_reopen := v_task.status = 'Erledigt'
    and v_patch->>'status' = 'Offen'
    and not coalesce(p_note_present, false)
    and not coalesce(p_dependency_present, false)
    and not exists (
      select 1 from jsonb_object_keys(v_patch) as patch_key(value)
      where patch_key.value not in (
        'status', 'score_final', 'score_points', 'review_status', 'review_owner_profile_id',
        'review_requested_at', 'github_issue_sync_status', 'github_issue_sync_error'
      )
    );
  if v_task.status = 'Erledigt' and not v_completed_reopen then
    raise exception using errcode = 'P0016', message = 'completed planning item is locked';
  end if;

  if v_task.task_type = 'sub_issue' and v_task.parent_task_id is not null then
    select * into v_parent from public.tasks where id = v_task.parent_task_id for share;
    if found and v_parent.status = 'Erledigt' then
      raise exception using errcode = 'P0016', message = 'completed parent planning item is locked';
    end if;
  end if;

  if v_completed_reopen then
    select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id for share;
    if not found
       or (v_task.task_type = 'deliverable' and v_actor_role <> 'ceo')
       or (v_task.task_type = 'sub_issue' and v_actor_role not in ('ceo', 'deputy', 'founder')) then
      raise exception using errcode = 'P0006', message = 'completed planning item reopen is not allowed';
    end if;
    return public.update_planning_task_transaction(
      p_task_id,
      p_expected_updated_at,
      v_patch,
      false,
      null,
      false,
      null,
      p_activity_messages,
      p_notifications,
      p_actor_profile_id
    );
  end if;

  return public.update_browser_planning_task_transaction_without_completed_guard(
    p_task_id,
    p_expected_updated_at,
    p_task_patch,
    p_note_present,
    p_note,
    p_dependency_present,
    p_dependency_note,
    p_activity_messages,
    p_notifications,
    p_actor_profile_id
  );
end;
$$;

revoke all on function public.update_browser_planning_task_transaction_without_completed_guard(
  text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function public.update_browser_planning_task_transaction(
  text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb, text
) from public, anon, authenticated;
grant execute on function public.update_browser_planning_task_transaction(
  text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb, text
) to service_role;

alter function public.mutate_planning_reparent_command_transaction(
  text, text, timestamptz, text, timestamptz, text
) rename to mutate_planning_reparent_command_transaction_without_completed_guard;

create or replace function public.mutate_planning_reparent_command_transaction(
  p_task_id text,
  p_expected_kind text,
  p_expected_updated_at timestamptz,
  p_parent_task_id text,
  p_expected_parent_updated_at timestamptz,
  p_actor_profile_id text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_task public.tasks%rowtype;
  v_old_parent public.tasks%rowtype;
  v_parent public.tasks%rowtype;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  if v_task.status = 'Erledigt' then
    raise exception using errcode = 'P0016', message = 'completed planning item is locked';
  end if;
  if v_task.parent_task_id is not null then
    select * into v_old_parent from public.tasks where id = v_task.parent_task_id for share;
    if found and v_old_parent.status = 'Erledigt' then
      raise exception using errcode = 'P0016', message = 'completed current parent planning item is locked';
    end if;
  end if;
  if nullif(trim(coalesce(p_parent_task_id, '')), '') is not null then
    select * into v_parent from public.tasks where id = p_parent_task_id for share;
    if found and v_parent.status = 'Erledigt' then
      raise exception using errcode = 'P0016', message = 'completed target parent planning item is locked';
    end if;
  end if;
  return public.mutate_planning_reparent_command_transaction_without_completed_guard(
    p_task_id,
    p_expected_kind,
    p_expected_updated_at,
    p_parent_task_id,
    p_expected_parent_updated_at,
    p_actor_profile_id
  );
end;
$$;

revoke all on function public.mutate_planning_reparent_command_transaction_without_completed_guard(
  text, text, timestamptz, text, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function public.mutate_planning_reparent_command_transaction(
  text, text, timestamptz, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.mutate_planning_reparent_command_transaction(
  text, text, timestamptz, text, timestamptz, text
) to service_role;

alter function public.mutate_planning_relationship_transaction(
  text, text, text, text, bigint, text, timestamptz, text, text, text
) rename to mutate_planning_relationship_transaction_without_completed_guard;

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
  v_relation public.task_relationship_edges%rowtype;
  v_other_task_id text;
begin
  if p_operation = 'remove' then
    select * into v_relation from public.task_relationship_edges where id = p_relation_id for share;
    if found then
      v_other_task_id := case
        when v_relation.task_id = p_task_id then v_relation.related_task_id
        when v_relation.related_task_id = p_task_id then v_relation.task_id
        else null
      end;
    end if;
  else
    v_other_task_id := p_related_task_id;
  end if;

  if exists (
    select 1
    from public.tasks source
    left join public.tasks source_parent on source_parent.id = source.parent_task_id
    left join public.tasks related on related.id = v_other_task_id
    left join public.tasks related_parent on related_parent.id = related.parent_task_id
    where source.id = p_task_id
      and 'Erledigt' = any(array[
        source.status,
        source_parent.status,
        related.status,
        related_parent.status
      ])
  ) then
    raise exception using errcode = 'P0016', message = 'completed relationship planning item is locked';
  end if;

  return public.mutate_planning_relationship_transaction_without_completed_guard(
    p_operation,
    p_task_id,
    p_related_task_id,
    p_relation_type,
    p_relation_id,
    p_note,
    p_expected_updated_at,
    p_actor_profile_id,
    p_request_ip,
    p_user_agent
  );
end;
$$;

revoke all on function public.mutate_planning_relationship_transaction_without_completed_guard(
  text, text, text, text, bigint, text, timestamptz, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.mutate_planning_relationship_transaction(
  text, text, text, text, bigint, text, timestamptz, text, text, text
) from public, anon, authenticated;
grant execute on function public.mutate_planning_relationship_transaction(
  text, text, text, text, bigint, text, timestamptz, text, text, text
) to service_role;

create or replace function public.guard_locked_sub_issue_parent()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_parent public.tasks%rowtype;
begin
  if new.task_type <> 'sub_issue' or new.parent_task_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.parent_task_id is not distinct from old.parent_task_id then
    return new;
  end if;
  select * into v_parent from public.tasks where id = new.parent_task_id for share;
  if found and v_parent.status = 'Erledigt' then
    raise exception using errcode = 'P0016', message = 'completed parent planning item is locked';
  end if;
  if found and (
    (v_parent.review_status = 'requested' and not coalesce(v_parent.score_final, false))
    or (v_parent.review_status = 'accepted' and coalesce(v_parent.score_final, false))
  ) then
    raise exception using errcode = 'P0009', message = 'parent planning item review is locked';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_guard_locked_sub_issue_parent on public.tasks;
create trigger tasks_guard_locked_sub_issue_parent
before insert or update of parent_task_id on public.tasks
for each row execute function public.guard_locked_sub_issue_parent();

revoke all on function public.guard_locked_sub_issue_parent()
  from public, anon, authenticated, service_role;
