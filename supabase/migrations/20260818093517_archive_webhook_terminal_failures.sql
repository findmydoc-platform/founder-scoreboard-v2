alter table public.github_planning_webhook_deliveries
  add column if not exists archived_at timestamptz;

alter table public.github_planning_webhook_deliveries
  add column if not exists archive_reason text;

alter table public.github_webhook_deliveries
  add column if not exists archived_at timestamptz;

alter table public.github_webhook_deliveries
  add column if not exists archive_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'github_planning_webhook_deliveries_archive_check'
      and conrelid = 'public.github_planning_webhook_deliveries'::regclass
  ) then
    alter table public.github_planning_webhook_deliveries
      add constraint github_planning_webhook_deliveries_archive_check
      check (
        (archived_at is null and archive_reason is null)
        or (
          archived_at is not null
          and nullif(trim(archive_reason), '') is not null
          and length(archive_reason) <= 120
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'github_webhook_deliveries_archive_check'
      and conrelid = 'public.github_webhook_deliveries'::regclass
  ) then
    alter table public.github_webhook_deliveries
      add constraint github_webhook_deliveries_archive_check
      check (
        (archived_at is null and archive_reason is null)
        or (
          archived_at is not null
          and nullif(trim(archive_reason), '') is not null
          and length(archive_reason) <= 120
        )
      );
  end if;
end;
$$;

comment on column public.github_planning_webhook_deliveries.archived_at is
  'Operator acknowledgement timestamp for an unreplayable terminal delivery. The failed delivery metadata remains retained.';
comment on column public.github_planning_webhook_deliveries.archive_reason is
  'Stable operator acknowledgement reason for an archived terminal delivery.';
comment on column public.github_webhook_deliveries.archived_at is
  'Operator acknowledgement timestamp for an unreplayable terminal delivery. The failed delivery metadata remains retained.';
comment on column public.github_webhook_deliveries.archive_reason is
  'Stable operator acknowledgement reason for an archived terminal delivery.';

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
    and delivery.archived_at is null
    and (
      (delivery.status in ('received', 'retry_scheduled') and delivery.available_at <= clock_timestamp())
      or (delivery.status = 'processing' and delivery.locked_at < clock_timestamp() - v_lease)
    )
  returning delivery.*;
end;
$$;

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
    and delivery.archived_at is null
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
  'Claims one verified Issue comment delivery for idempotent projection. Exact redelivery can recover retryable, failed, or stale processing rows unless an operator archived the delivery; archived failures remain retained and are never reclaimed.';

do $$
declare
  v_planning_count integer;
  v_comment_count integer;
begin
  select count(*)
  into v_planning_count
  from public.github_planning_webhook_deliveries delivery
  where delivery.status = 'failed'
    and delivery.archived_at is null
    and delivery.event_name = 'issues'
    and delivery.action = 'edited'
    and delivery.repository_full_name = 'findmydoc-platform/website'
    and delivery.issue_number = 1712
    and delivery.last_error like 'FounderOps planning task could not be loaded: column tasks.evidence_links does not exist%';

  if v_planning_count not in (0, 3) then
    raise exception using errcode = 'P0001', message = 'unexpected planning webhook archive target count';
  end if;

  select count(*)
  into v_comment_count
  from public.github_webhook_deliveries delivery
  where delivery.status = 'failed'
    and delivery.archived_at is null
    and delivery.event_name = 'issue_comment'
    and delivery.action = 'created'
    and delivery.repository_full_name = 'findmydoc-platform/website'
    and delivery.issue_number = 1619
    and delivery.last_error like 'GitHub Kommentar konnte nicht geladen werden: 404%';

  if v_comment_count not in (0, 1) then
    raise exception using errcode = 'P0001', message = 'unexpected comment webhook archive target count';
  end if;

  update public.github_planning_webhook_deliveries delivery
  set archived_at = clock_timestamp(),
      archive_reason = 'superseded_test_failure_task_links_fixed',
      updated_at = clock_timestamp()
  where delivery.status = 'failed'
    and delivery.archived_at is null
    and delivery.event_name = 'issues'
    and delivery.action = 'edited'
    and delivery.repository_full_name = 'findmydoc-platform/website'
    and delivery.issue_number = 1712
    and delivery.last_error like 'FounderOps planning task could not be loaded: column tasks.evidence_links does not exist%';

  update public.github_webhook_deliveries delivery
  set archived_at = clock_timestamp(),
      archive_reason = 'source_comment_unavailable_without_projection',
      updated_at = clock_timestamp()
  where delivery.status = 'failed'
    and delivery.archived_at is null
    and delivery.event_name = 'issue_comment'
    and delivery.action = 'created'
    and delivery.repository_full_name = 'findmydoc-platform/website'
    and delivery.issue_number = 1619
    and delivery.last_error like 'GitHub Kommentar konnte nicht geladen werden: 404%';
end;
$$;
