begin;

create table if not exists public.task_comment_github_deliveries (
  task_comment_id bigint primary key references public.task_comments(id) on delete cascade,
  task_id text not null references public.tasks(id) on delete cascade,
  author_profile_id text,
  github_issue_number integer,
  status text not null default 'pending'
    check (status in ('pending', 'waiting_for_issue', 'waiting_for_author_connection', 'processing', 'retry_scheduled', 'delivered', 'failed')),
  status_reason text,
  attempts integer not null default 0 check (attempts >= 0),
  last_attempted_at timestamptz,
  next_attempt_at timestamptz,
  github_comment_id bigint,
  github_comment_url text,
  locked_at timestamptz,
  lock_token text,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists task_comment_github_deliveries_task_status_idx
  on public.task_comment_github_deliveries(task_id, status, next_attempt_at);
create index if not exists task_comment_github_deliveries_author_status_idx
  on public.task_comment_github_deliveries(author_profile_id, status, next_attempt_at);

alter table public.task_comment_github_deliveries enable row level security;
revoke all on public.task_comment_github_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.task_comment_github_deliveries to service_role;

comment on table public.task_comment_github_deliveries is
  'Transactional outbox for author-attributed GitHub comments. Tokens never leave the server-side GitHub App vault.';

create or replace function public.create_task_comment_with_github_delivery(
  p_task_id text,
  p_profile_id text,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks%rowtype;
  v_comment public.task_comments%rowtype;
  v_status text;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  insert into public.task_comments (task_id, profile_id, comment)
  values (p_task_id, nullif(p_profile_id, ''), p_comment)
  returning * into v_comment;

  v_status := case
    when v_task.github_issue_number is null and coalesce(trim(v_task.issue_number), '') !~ '^[1-9][0-9]*$' then 'waiting_for_issue'
    when nullif(p_profile_id, '') is null then 'waiting_for_author_connection'
    else 'pending'
  end;

  insert into public.task_comment_github_deliveries (
    task_comment_id,
    task_id,
    author_profile_id,
    github_issue_number,
    status,
    status_reason
  ) values (
    v_comment.id,
    p_task_id,
    nullif(p_profile_id, ''),
    coalesce(
      v_task.github_issue_number,
      case when coalesce(trim(v_task.issue_number), '') ~ '^[1-9][0-9]*$' then trim(v_task.issue_number)::integer end
    ),
    v_status,
    case
      when v_status = 'waiting_for_issue' then 'github_issue_missing'
      when v_status = 'waiting_for_author_connection' then 'author_profile_missing'
      else null
    end
  );

  insert into public.task_activity (task_id, message)
  values (p_task_id, 'Kommentar hinzugefügt: ' || left(p_comment, 160));

  return jsonb_build_object(
    'comment', to_jsonb(v_comment),
    'deliveryStatus', v_status
  );
end;
$$;

create or replace function public.claim_task_comment_github_deliveries(
  p_lock_token text,
  p_task_id text default null,
  p_author_profile_id text default null,
  p_limit integer default 20,
  p_lease_seconds integer default 120
)
returns table (
  task_comment_id bigint,
  task_id text,
  author_profile_id text,
  github_issue_number integer,
  status text,
  attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select delivery.task_comment_id
    from public.task_comment_github_deliveries delivery
    where (p_task_id is null or delivery.task_id = p_task_id)
      and (p_author_profile_id is null or delivery.author_profile_id = p_author_profile_id)
      and (
        delivery.status in ('pending', 'waiting_for_issue', 'waiting_for_author_connection', 'retry_scheduled', 'failed')
        or (delivery.status = 'processing' and delivery.locked_at <= now() - make_interval(secs => greatest(30, p_lease_seconds)))
      )
      and (delivery.next_attempt_at is null or delivery.next_attempt_at <= now())
    order by delivery.created_at, delivery.task_comment_id
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  )
  update public.task_comment_github_deliveries delivery
  set status = 'processing',
      lock_token = p_lock_token,
      locked_at = now(),
      last_attempted_at = now(),
      updated_at = now()
  from candidates
  where delivery.task_comment_id = candidates.task_comment_id
  returning delivery.task_comment_id, delivery.task_id, delivery.author_profile_id,
    delivery.github_issue_number, delivery.status, delivery.attempts;
end;
$$;

create or replace function public.finalize_task_comment_github_delivery(
  p_task_comment_id bigint,
  p_lock_token text,
  p_status text,
  p_status_reason text default null,
  p_github_issue_number integer default null,
  p_github_comment_id bigint default null,
  p_github_comment_url text default null,
  p_last_error text default null,
  p_next_attempt_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated bigint;
begin
  if p_status not in ('pending', 'waiting_for_issue', 'waiting_for_author_connection', 'retry_scheduled', 'delivered', 'failed') then
    raise exception using errcode = '22023', message = 'invalid github comment delivery status';
  end if;

  update public.task_comment_github_deliveries
  set status = p_status,
      status_reason = p_status_reason,
      github_issue_number = coalesce(p_github_issue_number, github_issue_number),
      github_comment_id = coalesce(p_github_comment_id, github_comment_id),
      github_comment_url = coalesce(p_github_comment_url, github_comment_url),
      attempts = attempts + case when p_status in ('retry_scheduled', 'delivered', 'failed') then 1 else 0 end,
      last_error = case when p_status in ('retry_scheduled', 'failed') then left(p_last_error, 4000) else null end,
      next_attempt_at = p_next_attempt_at,
      delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
      lock_token = null,
      locked_at = null,
      updated_at = now()
  where task_comment_id = p_task_comment_id
    and lock_token = p_lock_token;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.create_task_comment_with_github_delivery(text, text, text) from public, anon, authenticated;
revoke all on function public.claim_task_comment_github_deliveries(text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.finalize_task_comment_github_delivery(bigint, text, text, text, integer, bigint, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_task_comment_with_github_delivery(text, text, text) to service_role;
grant execute on function public.claim_task_comment_github_deliveries(text, text, text, integer, integer) to service_role;
grant execute on function public.finalize_task_comment_github_delivery(bigint, text, text, text, integer, bigint, text, text, timestamptz) to service_role;

insert into public.task_comment_github_deliveries (
  task_comment_id,
  task_id,
  author_profile_id,
  github_issue_number,
  status,
  status_reason
)
select
  comment.id,
  comment.task_id,
  comment.profile_id,
  coalesce(
    task.github_issue_number,
    case when coalesce(trim(task.issue_number), '') ~ '^[1-9][0-9]*$' then trim(task.issue_number)::integer end
  ),
  case
    when task.github_issue_number is null and coalesce(trim(task.issue_number), '') !~ '^[1-9][0-9]*$' then 'waiting_for_issue'
    when comment.profile_id is null then 'waiting_for_author_connection'
    else 'pending'
  end,
  case
    when task.github_issue_number is null and coalesce(trim(task.issue_number), '') !~ '^[1-9][0-9]*$' then 'github_issue_missing'
    when comment.profile_id is null then 'author_profile_missing'
    else 'legacy_reconciliation'
  end
from public.task_comments comment
join public.tasks task on task.id = comment.task_id
on conflict (task_comment_id) do nothing;

commit;
