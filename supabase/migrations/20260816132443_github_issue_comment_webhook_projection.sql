alter table public.github_webhook_deliveries
  add column if not exists status_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'github_webhook_deliveries_status_reason_check'
      and conrelid = 'public.github_webhook_deliveries'::regclass
  ) then
    alter table public.github_webhook_deliveries
      add constraint github_webhook_deliveries_status_reason_check
      check (
        status_reason is null
        or (
          nullif(trim(status_reason), '') is not null
          and length(status_reason) <= 128
        )
      );
  end if;
end
$$;

comment on column public.github_webhook_deliveries.status_reason is
  'Stable processor outcome or retry reason without payload or credential data.';

create or replace function public.claim_github_issue_comment_webhook_delivery(
  p_delivery_id text,
  p_lock_token uuid,
  p_lease_seconds integer default 120
) returns table (
  delivery_id text,
  action text,
  repository_full_name text,
  issue_number integer,
  comment_id bigint,
  comment_updated_at timestamptz,
  attempts integer
)
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
  update public.github_webhook_deliveries delivery
  set status = 'processing',
      status_reason = null,
      attempts = delivery.attempts + 1,
      locked_at = clock_timestamp(),
      lock_token = p_lock_token,
      processed_at = null,
      last_error = null,
      updated_at = clock_timestamp()
  where delivery.delivery_id = p_delivery_id
    and delivery.event_name = 'issue_comment'
    and (
      delivery.status in ('received', 'retry_scheduled', 'failed')
      or (
        delivery.status = 'processing'
        and delivery.locked_at < clock_timestamp() - v_lease
      )
    )
  returning
    delivery.delivery_id,
    delivery.action,
    delivery.repository_full_name,
    delivery.issue_number,
    delivery.comment_id,
    delivery.comment_updated_at,
    delivery.attempts;
end;
$$;

comment on function public.claim_github_issue_comment_webhook_delivery(text, uuid, integer) is
  'Claims one verified Issue comment delivery for idempotent projection. Exact redelivery can recover retryable, failed, or stale processing rows.';

create or replace function public.resolve_github_issue_comment_webhook_tasks(
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
  where issue_reference.reference_status = 'valid'
    and issue_reference.normalized_repo = v_repository_full_name
    and issue_reference.normalized_issue_number = p_issue_number
  order by task.id
  limit 2;
end;
$$;

comment on function public.resolve_github_issue_comment_webhook_tasks(text, integer) is
  'Resolves at most two tasks through the shared modern and legacy GitHub Issue reference contract so the processor can fail closed on ambiguity.';

create or replace function public.apply_github_issue_comment_webhook_projection(
  p_delivery_id text,
  p_lock_token uuid,
  p_operation text,
  p_task_id text,
  p_comment_updated_at timestamptz,
  p_author_login text,
  p_author_avatar_url text,
  p_body text,
  p_html_url text,
  p_created_at timestamptz,
  p_imported_at timestamptz
) returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_delivery public.github_webhook_deliveries%rowtype;
  v_is_stale boolean := false;
  v_mapping_count integer := 0;
  v_mapping_task_id text;
begin
  if p_operation not in ('upsert', 'suppress', 'delete') then
    raise exception using errcode = '22023', message = 'invalid Issue comment projection operation';
  end if;
  if nullif(trim(coalesce(p_task_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'task id is required';
  end if;

  select delivery.*
  into v_delivery
  from public.github_webhook_deliveries delivery
  where delivery.delivery_id = p_delivery_id
    and delivery.event_name = 'issue_comment'
    and delivery.status = 'processing'
    and delivery.lock_token = p_lock_token
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'active Issue comment delivery lock was not found';
  end if;

  if p_operation = 'delete' then
    if v_delivery.action <> 'deleted'
       or p_comment_updated_at is distinct from v_delivery.comment_updated_at then
      raise exception using errcode = '22023', message = 'only the matching deleted event can remove a GitHub comment projection';
    end if;
  elsif v_delivery.action not in ('created', 'edited')
        or p_comment_updated_at is null
        or p_comment_updated_at < v_delivery.comment_updated_at then
    raise exception using errcode = '22023', message = 'comment snapshot is older than its GitHub delivery';
  end if;

  if p_operation = 'upsert' and (
    nullif(trim(coalesce(p_author_login, '')), '') is null
    or nullif(trim(coalesce(p_body, '')), '') is null
    or nullif(trim(coalesce(p_html_url, '')), '') is null
    or p_created_at is null
    or p_imported_at is null
  ) then
    raise exception using errcode = '22023', message = 'complete comment content is required for projection';
  end if;

  select count(*)::integer, min(mapping.task_id)
  into v_mapping_count, v_mapping_task_id
  from public.resolve_github_issue_comment_webhook_tasks(
    v_delivery.repository_full_name,
    v_delivery.issue_number
  ) mapping;

  if v_mapping_count <> 1 or v_mapping_task_id <> p_task_id then
    raise exception using errcode = 'P0003', message = 'GitHub Issue task mapping changed before projection';
  end if;

  perform pg_advisory_xact_lock(v_delivery.comment_id);

  select exists (
    select 1
    from public.github_webhook_deliveries newer
    where newer.event_name = 'issue_comment'
      and newer.comment_id = v_delivery.comment_id
      and newer.delivery_id <> v_delivery.delivery_id
      and (
        newer.comment_updated_at > p_comment_updated_at
        or (
          newer.comment_updated_at = p_comment_updated_at
          and newer.action = 'deleted'
          and p_operation <> 'delete'
        )
        or (
          newer.comment_updated_at = p_comment_updated_at
          and (newer.action = 'deleted') = (p_operation = 'delete')
          and (
            newer.received_at > v_delivery.received_at
            or (
              newer.received_at = v_delivery.received_at
              and newer.delivery_id > v_delivery.delivery_id
            )
          )
        )
      )
  ) into v_is_stale;

  if v_is_stale then
    return 'stale';
  end if;

  if p_operation = 'upsert' then
    insert into public.task_external_comments (
      task_id,
      source,
      external_id,
      author_login,
      author_avatar_url,
      body,
      html_url,
      created_at,
      imported_at
    ) values (
      p_task_id,
      'github',
      v_delivery.comment_id::text,
      trim(p_author_login),
      nullif(trim(coalesce(p_author_avatar_url, '')), ''),
      trim(p_body),
      trim(p_html_url),
      p_created_at,
      p_imported_at
    )
    on conflict (source, external_id) do update
    set task_id = excluded.task_id,
        author_login = excluded.author_login,
        author_avatar_url = excluded.author_avatar_url,
        body = excluded.body,
        html_url = excluded.html_url,
        created_at = excluded.created_at,
        imported_at = excluded.imported_at;
  else
    delete from public.task_external_comments external_comment
    where external_comment.source = 'github'
      and external_comment.external_id = v_delivery.comment_id::text;
  end if;

  return 'applied';
end;
$$;

comment on function public.apply_github_issue_comment_webhook_projection(text, uuid, text, text, timestamptz, text, text, text, text, timestamptz, timestamptz) is
  'Atomically applies the latest verified GitHub comment state. The durable delivery journal orders concurrent snapshots, and a deleted event wins at the same GitHub version.';

create or replace function public.finalize_github_issue_comment_webhook_delivery(
  p_delivery_id text,
  p_lock_token uuid,
  p_status text,
  p_status_reason text default null,
  p_last_error text default null,
  p_available_at timestamptz default null
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_updated_count integer := 0;
begin
  if p_status not in ('processed', 'ignored', 'retry_scheduled', 'failed') then
    raise exception using errcode = '22023', message = 'invalid webhook delivery final status';
  end if;
  if p_status = 'retry_scheduled' and p_available_at is null then
    raise exception using errcode = '22023', message = 'retry availability is required';
  end if;

  update public.github_webhook_deliveries delivery
  set status = p_status,
      status_reason = nullif(trim(coalesce(p_status_reason, '')), ''),
      available_at = case
        when p_status = 'retry_scheduled' then p_available_at
        else delivery.available_at
      end,
      locked_at = null,
      lock_token = null,
      processed_at = case
        when p_status = 'processed' then clock_timestamp()
        else null
      end,
      last_error = case
        when p_status in ('retry_scheduled', 'failed')
          then nullif(left(coalesce(p_last_error, ''), 2000), '')
        else null
      end,
      updated_at = clock_timestamp()
  where delivery.delivery_id = p_delivery_id
    and delivery.event_name = 'issue_comment'
    and delivery.status = 'processing'
    and delivery.lock_token = p_lock_token;

  get diagnostics v_updated_count = row_count;
  return v_updated_count = 1;
end;
$$;

comment on function public.finalize_github_issue_comment_webhook_delivery(text, uuid, text, text, text, timestamptz) is
  'Finalizes a claimed Issue comment projection only for the active lock owner.';

revoke all on function public.claim_github_issue_comment_webhook_delivery(text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.resolve_github_issue_comment_webhook_tasks(text, integer)
  from public, anon, authenticated;
revoke all on function public.apply_github_issue_comment_webhook_projection(text, uuid, text, text, timestamptz, text, text, text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.finalize_github_issue_comment_webhook_delivery(text, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.claim_github_issue_comment_webhook_delivery(text, uuid, integer)
  to service_role;
grant execute on function public.resolve_github_issue_comment_webhook_tasks(text, integer)
  to service_role;
grant execute on function public.apply_github_issue_comment_webhook_projection(text, uuid, text, text, timestamptz, text, text, text, text, timestamptz, timestamptz)
  to service_role;
grant execute on function public.finalize_github_issue_comment_webhook_delivery(text, uuid, text, text, text, timestamptz)
  to service_role;
