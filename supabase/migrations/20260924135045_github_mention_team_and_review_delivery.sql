alter table public.projects
  add column if not exists github_mention_team_slug text;

alter table public.projects
  drop constraint if exists projects_github_mention_team_slug_check;
alter table public.projects
  add constraint projects_github_mention_team_slug_check
  check (
    github_mention_team_slug is null
    or github_mention_team_slug ~ '^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$'
  );

comment on column public.projects.github_mention_team_slug is
  'GitHub organization team slug used to project the local @all mention.';

create table if not exists public.task_review_github_deliveries (
  task_review_id bigint primary key references public.task_reviews(id) on delete cascade,
  task_id text not null references public.tasks(id) on delete cascade,
  author_profile_id text references public.profiles(id) on delete set null,
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

comment on table public.task_review_github_deliveries is
  'Service-only transactional outbox for author-attributed GitHub review comments.';

alter table public.task_review_github_deliveries enable row level security;
revoke all on table public.task_review_github_deliveries from public, anon, authenticated;
grant all on table public.task_review_github_deliveries to service_role;

create or replace function public.enqueue_task_review_github_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_review_github_deliveries (
    task_review_id,
    task_id,
    author_profile_id,
    status
  ) values (
    new.id,
    new.task_id,
    new.reviewer_profile_id,
    'pending'
  )
  on conflict (task_review_id) do nothing;
  return new;
end;
$$;

revoke all on function public.enqueue_task_review_github_delivery() from public, anon, authenticated;

drop trigger if exists task_reviews_enqueue_github_delivery on public.task_reviews;
create trigger task_reviews_enqueue_github_delivery
after insert on public.task_reviews
for each row execute function public.enqueue_task_review_github_delivery();

create or replace function public.mutate_planning_review_command_transaction_v3(
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
  p_evidence_links jsonb default '[]'::jsonb,
  p_evidence_exception_note text default null,
  p_activity_messages text[] default '{}'::text[],
  p_notifications jsonb default '[]'::jsonb,
  p_mention_recipient_profile_ids text[] default '{}'::text[],
  p_audit_after_data jsonb default '{}'::jsonb,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_review_id bigint;
  v_activity_id bigint;
  v_recipient_id text;
  v_mention_body text;
  v_mention_title text;
  v_target_path text;
  v_dedupe_scope text;
begin
  v_result := public.mutate_planning_review_command_transaction_v2(
    p_action,
    p_task_id,
    p_expected_updated_at,
    p_actor_profile_id,
    p_reviewer_profile_id,
    p_decision,
    p_comment,
    p_checklist,
    p_points,
    p_reason,
    p_evidence_links,
    p_evidence_exception_note,
    p_activity_messages,
    p_notifications,
    p_audit_after_data,
    p_request_ip,
    p_user_agent
  );

  if cardinality(coalesce(p_mention_recipient_profile_ids, '{}'::text[])) > 0 then
    v_review_id := nullif(v_result -> 'review' ->> 'id', '')::bigint;
    v_activity_id := nullif(v_result -> 'activities' -> 0 ->> 'id', '')::bigint;
    if p_action = 'withdraw' and v_activity_id is null then
      select audit.id into v_activity_id
      from public.audit_log audit
      where audit.entity_type = 'task'
        and audit.entity_id = p_task_id
        and audit.action = 'task.review.withdraw'
        and audit.actor_profile_id is not distinct from nullif(trim(coalesce(p_actor_profile_id, '')), '')
      order by audit.id desc
      limit 1;
    end if;
    if p_action = 'decide' and v_review_id is not null then
      v_mention_title := 'Im Review erwähnt';
      v_mention_body := coalesce(p_comment, '');
      v_target_path := '/tasks/' || p_task_id || '?focus=review:' || v_review_id;
      v_dedupe_scope := 'review:' || v_review_id;
    elsif p_action in ('request', 'reopen') then
      v_mention_title := 'In Review-Nachweis erwähnt';
      v_mention_body := coalesce(p_evidence_exception_note, '');
      v_target_path := '/tasks/' || p_task_id || '?focus=field:review-evidence-exception';
      v_dedupe_scope := 'review-' || p_action || ':' || coalesce(v_activity_id::text, extract(epoch from p_expected_updated_at)::text);
    elsif p_action = 'withdraw' and v_activity_id is not null then
      v_mention_title := 'Beim Zurückziehen einer Review erwähnt';
      v_mention_body := coalesce(p_reason, '');
      v_target_path := '/tasks/' || p_task_id || '?focus=activity:' || v_activity_id;
      v_dedupe_scope := 'review-withdraw:' || v_activity_id;
    end if;

    if v_target_path is null then
      return v_result;
    end if;
    for v_recipient_id in
      select distinct trim(recipient_id)
      from unnest(coalesce(p_mention_recipient_profile_ids, '{}'::text[])) as recipients(recipient_id)
      join public.profiles profile on profile.id = trim(recipients.recipient_id)
      where nullif(trim(recipients.recipient_id), '') is not null
    loop
      insert into public.notification_events (
        type,
        actor_profile_id,
        recipient_profile_id,
        entity_type,
        entity_id,
        title,
        body,
        dedupe_key,
        target_path
      ) values (
        'task.mention',
        nullif(trim(coalesce(p_actor_profile_id, '')), ''),
        v_recipient_id,
        'task',
        p_task_id,
        v_mention_title,
        v_mention_body,
        'task.mention:' || v_dedupe_scope || ':' || v_recipient_id,
        v_target_path
      )
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end loop;
  end if;

  return v_result;
end;
$$;

revoke all on function public.mutate_planning_review_command_transaction_v3(
  text, text, timestamptz, text, text, text, text, jsonb, integer, text,
  jsonb, text, text[], jsonb, text[], jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.mutate_planning_review_command_transaction_v3(
  text, text, timestamptz, text, text, text, text, jsonb, integer, text,
  jsonb, text, text[], jsonb, text[], jsonb, text, text
) to service_role;

create or replace function public.update_administration_github_project_transaction_v2(
  p_project_id text,
  p_expected_owner text,
  p_expected_number integer,
  p_expected_team_slug text,
  p_github_project_owner text,
  p_github_project_number integer,
  p_github_mention_team_slug text,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_profile_id text;
  v_project public.projects%rowtype;
begin
  if p_expected_owner is null
    or p_expected_number is null
    or p_github_project_owner is null
    or p_github_project_number is null
    or p_github_project_number <= 0
    or p_github_project_owner <> trim(p_github_project_owner)
    or p_github_project_owner !~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
    or (
      nullif(trim(coalesce(p_github_mention_team_slug, '')), '') is not null
      and (
        p_github_mention_team_slug <> lower(trim(p_github_mention_team_slug))
        or p_github_mention_team_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$'
      )
    ) then
    raise exception using errcode = '22023', message = 'GitHub Project or mention team settings are invalid';
  end if;

  v_actor_profile_id := public.require_active_administrator_profile();
  perform pg_advisory_xact_lock(hashtextextended('founderops-github-project:' || p_project_id, 0));

  select * into v_project
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;
  if v_project.github_project_owner <> p_expected_owner
    or v_project.github_project_number <> p_expected_number
    or coalesce(v_project.github_mention_team_slug, '') <> coalesce(p_expected_team_slug, '') then
    raise exception using errcode = 'P0001', message = 'FounderOps GitHub Project settings changed concurrently';
  end if;

  v_actor_profile_id := public.require_active_administrator_profile();

  update public.projects
  set github_project_owner = p_github_project_owner,
      github_project_number = p_github_project_number,
      github_mention_team_slug = nullif(trim(coalesce(p_github_mention_team_slug, '')), '')
  where id = p_project_id;

  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id,
    before_data, after_data, request_ip, user_agent
  ) values (
    v_actor_profile_id,
    'founderops.github_project.update',
    'project',
    p_project_id,
    jsonb_build_object(
      'githubProjectOwner', v_project.github_project_owner,
      'githubProjectNumber', v_project.github_project_number,
      'githubMentionTeamSlug', v_project.github_mention_team_slug
    ),
    jsonb_build_object(
      'githubProjectOwner', p_github_project_owner,
      'githubProjectNumber', p_github_project_number,
      'githubMentionTeamSlug', nullif(trim(coalesce(p_github_mention_team_slug, '')), '')
    ),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'project', jsonb_build_object(
      'id', p_project_id,
      'githubProjectOwner', p_github_project_owner,
      'githubProjectNumber', p_github_project_number,
      'githubMentionTeamSlug', nullif(trim(coalesce(p_github_mention_team_slug, '')), '')
    )
  );
end;
$$;

revoke all on function public.update_administration_github_project_transaction_v2(
  text, text, integer, text, text, integer, text, text, text
) from public, anon, authenticated;
grant execute on function public.update_administration_github_project_transaction_v2(
  text, text, integer, text, text, integer, text, text, text
) to authenticated, service_role;

create or replace function public.claim_task_review_github_deliveries(
  p_lock_token text,
  p_task_id text default null,
  p_author_profile_id text default null,
  p_limit integer default 20,
  p_lease_seconds integer default 120
)
returns table(
  task_review_id bigint,
  task_id text,
  author_profile_id text,
  github_issue_number integer,
  status text,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select delivery.task_review_id
    from public.task_review_github_deliveries delivery
    where (p_task_id is null or delivery.task_id = p_task_id)
      and (p_author_profile_id is null or delivery.author_profile_id = p_author_profile_id)
      and (
        delivery.status in ('pending', 'waiting_for_issue', 'waiting_for_author_connection', 'retry_scheduled', 'failed')
        or (delivery.status = 'processing' and delivery.locked_at <= clock_timestamp() - make_interval(secs => greatest(30, p_lease_seconds)))
      )
      and (delivery.next_attempt_at is null or delivery.next_attempt_at <= clock_timestamp())
    order by delivery.created_at, delivery.task_review_id
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  )
  update public.task_review_github_deliveries delivery
  set status = 'processing',
      lock_token = p_lock_token,
      locked_at = clock_timestamp(),
      last_attempted_at = clock_timestamp(),
      updated_at = clock_timestamp()
  from candidates
  where delivery.task_review_id = candidates.task_review_id
  returning delivery.task_review_id, delivery.task_id, delivery.author_profile_id,
    delivery.github_issue_number, delivery.status, delivery.attempts;
end;
$$;

revoke all on function public.claim_task_review_github_deliveries(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_task_review_github_deliveries(text, text, text, integer, integer) to service_role;

create or replace function public.finalize_task_review_github_delivery(
  p_task_review_id bigint,
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
set search_path = ''
as $$
declare
  v_updated bigint;
begin
  if p_status not in ('pending', 'waiting_for_issue', 'waiting_for_author_connection', 'retry_scheduled', 'delivered', 'failed') then
    raise exception using errcode = '22023', message = 'invalid github review delivery status';
  end if;

  update public.task_review_github_deliveries
  set status = p_status,
      status_reason = p_status_reason,
      github_issue_number = coalesce(p_github_issue_number, github_issue_number),
      github_comment_id = coalesce(p_github_comment_id, github_comment_id),
      github_comment_url = coalesce(p_github_comment_url, github_comment_url),
      attempts = attempts + case when p_status in ('retry_scheduled', 'delivered', 'failed') then 1 else 0 end,
      last_error = case when p_status in ('retry_scheduled', 'failed') then left(p_last_error, 4000) else null end,
      next_attempt_at = p_next_attempt_at,
      delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, clock_timestamp()) else delivered_at end,
      lock_token = null,
      locked_at = null,
      updated_at = clock_timestamp()
  where task_review_id = p_task_review_id
    and lock_token = p_lock_token;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.finalize_task_review_github_delivery(bigint, text, text, text, integer, bigint, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.finalize_task_review_github_delivery(bigint, text, text, text, integer, bigint, text, text, timestamptz) to service_role;

create or replace function public.insert_task_mention_notifications(
  p_notifications jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'mention notifications must be an array';
  end if;

  insert into public.notification_events (
    type,
    actor_profile_id,
    recipient_profile_id,
    entity_type,
    entity_id,
    title,
    body,
    dedupe_key,
    target_path
  )
  select
    notification.type,
    notification.actor_profile_id,
    notification.recipient_profile_id,
    notification.entity_type,
    notification.entity_id,
    notification.title,
    notification.body,
    notification.dedupe_key,
    notification.target_path
  from jsonb_to_recordset(coalesce(p_notifications, '[]'::jsonb)) as notification(
    type text,
    actor_profile_id text,
    recipient_profile_id text,
    entity_type text,
    entity_id text,
    title text,
    body text,
    dedupe_key text,
    target_path text
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
end;
$$;

revoke all on function public.insert_task_mention_notifications(jsonb) from public, anon, authenticated;

create or replace function public.canonicalize_administrator_task_mention_notifications(
  p_notifications jsonb,
  p_task_id text,
  p_actor_profile_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_title text;
begin
  if jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'mention notifications must be an array';
  end if;
  select title into v_task_title from public.tasks where id = p_task_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_notifications, '[]'::jsonb)) as notification(
      type text,
      actor_profile_id text,
      recipient_profile_id text,
      entity_type text,
      entity_id text,
      title text,
      body text,
      dedupe_key text,
      target_path text
    )
    cross join lateral (
      select split_part(notification.target_path, '?focus=field:', 2) as field_key
    ) parsed
    where notification.recipient_profile_id is null
      or not exists (
        select 1 from public.profiles profile where profile.id = notification.recipient_profile_id
      )
      or parsed.field_key not in (
        'description', 'problem', 'outcome', 'scope', 'acceptance',
        'evidence-required', 'definition-of-done',
        'strategy-goal', 'strategy-success', 'strategy-scope'
      )
      or notification.target_path is distinct from '/tasks/' || p_task_id || '?focus=field:' || parsed.field_key
      or nullif(notification.body, '') is null
      or char_length(notification.body) > 4000
      or position(
        'task.mention:field:' || p_task_id || ':' || parsed.field_key || ':'
        in coalesce(notification.dedupe_key, '')
      ) <> 1
      or right(coalesce(notification.dedupe_key, ''), char_length(':' || notification.recipient_profile_id))
        is distinct from ':' || notification.recipient_profile_id
  ) then
    raise exception using errcode = '22023', message = 'administrator mention notification is invalid';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'type', 'task.mention',
      'actor_profile_id', p_actor_profile_id,
      'recipient_profile_id', notification.recipient_profile_id,
      'entity_type', 'task',
      'entity_id', p_task_id,
      'title', 'In einem Aufgabenfeld erwähnt: ' || v_task_title,
      'body', notification.body,
      'dedupe_key', notification.dedupe_key,
      'target_path', notification.target_path
    )), '[]'::jsonb)
    from jsonb_to_recordset(coalesce(p_notifications, '[]'::jsonb)) as notification(
      recipient_profile_id text,
      body text,
      dedupe_key text,
      target_path text
    )
  );
end;
$$;

revoke all on function public.canonicalize_administrator_task_mention_notifications(jsonb, text, text) from public, anon, authenticated;

create or replace function public.create_browser_planning_item_transaction_v2(
  p_item jsonb,
  p_strategy jsonb,
  p_raci_assignments jsonb,
  p_notifications jsonb,
  p_actor_profile_id text,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := public.create_browser_planning_item_transaction(
    p_item,
    p_strategy,
    p_raci_assignments,
    p_actor_profile_id,
    p_request_ip,
    p_user_agent
  );
  perform public.insert_task_mention_notifications(p_notifications);
  return v_result;
end;
$$;

revoke all on function public.create_browser_planning_item_transaction_v2(
  jsonb, jsonb, jsonb, jsonb, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_browser_planning_item_transaction_v2(
  jsonb, jsonb, jsonb, jsonb, text, text, text
) to service_role;

create or replace function public.update_browser_planning_item_transaction_v2(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_strategy jsonb,
  p_raci_assignments jsonb,
  p_notifications jsonb,
  p_actor_profile_id text,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := public.update_browser_planning_item_transaction(
    p_task_id,
    p_expected_updated_at,
    p_patch,
    p_strategy,
    p_raci_assignments,
    p_actor_profile_id,
    p_request_ip,
    p_user_agent
  );
  perform public.insert_task_mention_notifications(p_notifications);
  return v_result;
end;
$$;

revoke all on function public.update_browser_planning_item_transaction_v2(
  text, timestamptz, jsonb, jsonb, jsonb, jsonb, text, text, text
) from public, anon, authenticated;
grant execute on function public.update_browser_planning_item_transaction_v2(
  text, timestamptz, jsonb, jsonb, jsonb, jsonb, text, text, text
) to service_role;

create or replace function public.update_administrator_planning_item_transaction_v2(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_strategy jsonb,
  p_raci_assignments jsonb,
  p_notifications jsonb,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_actor_profile_id text;
  v_notifications jsonb;
begin
  v_actor_profile_id := public.require_active_administrator_profile();
  v_result := public.update_administrator_planning_item_transaction(
    p_task_id,
    p_expected_updated_at,
    p_patch,
    p_strategy,
    p_raci_assignments,
    p_request_ip,
    p_user_agent
  );
  v_notifications := public.canonicalize_administrator_task_mention_notifications(
    p_notifications,
    p_task_id,
    v_actor_profile_id
  );
  perform public.insert_task_mention_notifications(v_notifications);
  return v_result;
end;
$$;

revoke all on function public.update_administrator_planning_item_transaction_v2(
  text, timestamptz, jsonb, jsonb, jsonb, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.update_administrator_planning_item_transaction_v2(
  text, timestamptz, jsonb, jsonb, jsonb, jsonb, text, text
) to authenticated, service_role;

create or replace function public.mutate_planning_relationship_transaction_v2(
  p_operation text,
  p_task_id text,
  p_related_task_id text,
  p_relation_type text,
  p_relation_id bigint,
  p_note text,
  p_expected_updated_at timestamptz,
  p_actor_profile_id text,
  p_mention_recipient_profile_ids text[] default '{}'::text[],
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_relation_id bigint;
  v_task_title text;
begin
  v_result := public.mutate_planning_relationship_transaction(
    p_operation, p_task_id, p_related_task_id, p_relation_type, p_relation_id,
    p_note, p_expected_updated_at, p_actor_profile_id, p_request_ip, p_user_agent
  );
  v_relation_id := nullif(v_result -> 'relation' ->> 'id', '')::bigint;
  select title into v_task_title from public.tasks where id = p_task_id;

  if p_operation = 'add' and v_relation_id is not null then
    insert into public.notification_events (
      type, actor_profile_id, recipient_profile_id, entity_type, entity_id,
      title, body, dedupe_key, target_path
    )
    select
      'task.mention', p_actor_profile_id, profile.id, 'task', p_task_id,
      'In einem Beziehungshinweis erwähnt: ' || coalesce(v_task_title, p_task_id),
      coalesce(p_note, ''),
      'task.mention:relation:' || v_relation_id || ':' || profile.id,
      '/tasks/' || p_task_id || '?focus=relation:' || v_relation_id
    from public.profiles profile
    where profile.id = any(coalesce(p_mention_recipient_profile_ids, '{}'::text[]))
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return v_result;
end;
$$;

revoke all on function public.mutate_planning_relationship_transaction_v2(
  text, text, text, text, bigint, text, timestamptz, text, text[], text, text
) from public, anon, authenticated;
grant execute on function public.mutate_planning_relationship_transaction_v2(
  text, text, text, text, bigint, text, timestamptz, text, text[], text, text
) to service_role;

create or replace function public.mutate_administrator_planning_relationship_transaction_v2(
  p_operation text,
  p_task_id text,
  p_related_task_id text,
  p_relation_type text,
  p_relation_id bigint,
  p_note text,
  p_expected_updated_at timestamptz,
  p_actor_profile_id text,
  p_mention_recipient_profile_ids text[] default '{}'::text[],
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_relation_id bigint;
  v_task_title text;
begin
  v_result := public.mutate_administrator_planning_relationship_transaction(
    p_operation, p_task_id, p_related_task_id, p_relation_type, p_relation_id,
    p_note, p_expected_updated_at, p_actor_profile_id, p_request_ip, p_user_agent
  );
  v_relation_id := nullif(v_result -> 'relation' ->> 'id', '')::bigint;
  select title into v_task_title from public.tasks where id = p_task_id;

  if p_operation = 'add' and v_relation_id is not null then
    insert into public.notification_events (
      type, actor_profile_id, recipient_profile_id, entity_type, entity_id,
      title, body, dedupe_key, target_path
    )
    select
      'task.mention', p_actor_profile_id, profile.id, 'task', p_task_id,
      'In einem Beziehungshinweis erwähnt: ' || coalesce(v_task_title, p_task_id),
      coalesce(p_note, ''),
      'task.mention:relation:' || v_relation_id || ':' || profile.id,
      '/tasks/' || p_task_id || '?focus=relation:' || v_relation_id
    from public.profiles profile
    where profile.id = any(coalesce(p_mention_recipient_profile_ids, '{}'::text[]))
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return v_result;
end;
$$;

revoke all on function public.mutate_administrator_planning_relationship_transaction_v2(
  text, text, text, text, bigint, text, timestamptz, text, text[], text, text
) from public, anon, authenticated;
grant execute on function public.mutate_administrator_planning_relationship_transaction_v2(
  text, text, text, text, bigint, text, timestamptz, text, text[], text, text
) to authenticated, service_role;

create or replace function public.report_task_blocker_transaction_v2(
  p_task_id text,
  p_actor_profile_id text,
  p_reason text,
  p_impact text,
  p_needs_help_from text,
  p_notifications jsonb default '[]'::jsonb,
  p_mention_recipient_profile_ids text[] default '{}'::text[],
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_blocker public.task_blockers%rowtype;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null
    or char_length(trim(p_reason)) < 5
    or char_length(coalesce(p_reason, '')) > 2000
    or char_length(coalesce(p_impact, '')) > 2000
    or char_length(coalesce(p_needs_help_from, '')) > 500 then
    raise exception using errcode = '22023', message = 'blocker input is invalid';
  end if;

  select * into v_actor
  from public.profiles
  where id = p_actor_profile_id;
  if not found or v_actor.platform_role not in ('ceo', 'founder', 'deputy') then
    raise exception using errcode = '42501', message = 'blocker actor is forbidden';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found or v_task.trashed_at is not null then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
  if v_task.status = 'Erledigt'
    or (v_task.review_status = 'requested' and not coalesce(v_task.score_final, false))
    or (v_task.review_status = 'accepted' and coalesce(v_task.score_final, false)) then
    raise exception using errcode = 'P0010', message = 'task is locked';
  end if;
  if v_task.task_type = 'sub_issue' and v_task.parent_task_id is not null then
    select * into v_parent
    from public.tasks
    where id = v_task.parent_task_id
    for update;
    if not found
      or v_parent.trashed_at is not null
      or v_parent.status = 'Erledigt'
      or (v_parent.review_status = 'requested' and not coalesce(v_parent.score_final, false))
      or (v_parent.review_status = 'accepted' and coalesce(v_parent.score_final, false)) then
      raise exception using errcode = 'P0010', message = 'task parent is locked';
    end if;
  end if;
  if v_actor.platform_role = 'founder'
    and not (
      coalesce(v_task.owner in (v_actor.id, v_actor.name), false)
      or coalesce(v_task.assignee in (v_actor.id, v_actor.name), false)
    ) then
    raise exception using errcode = '42501', message = 'blocker actor does not own task';
  end if;

  insert into public.task_blockers (
    task_id, profile_id, reason, impact, needs_help_from, status
  ) values (
    p_task_id, p_actor_profile_id, trim(p_reason),
    nullif(trim(coalesce(p_impact, '')), ''),
    nullif(trim(coalesce(p_needs_help_from, '')), ''),
    'open'
  ) returning * into v_blocker;

  update public.tasks
  set status = 'Blockiert',
      github_issue_sync_status = 'not_synced',
      github_issue_sync_error = null,
      updated_at = clock_timestamp()
  where id = p_task_id;

  perform public.insert_task_mention_notifications(p_notifications);

  insert into public.notification_events (
    type, actor_profile_id, recipient_profile_id, entity_type, entity_id,
    title, body, dedupe_key, target_path
  )
  select
    'task.mention', p_actor_profile_id, profile.id, 'task', p_task_id,
    'In einem Blocker erwähnt: ' || v_task.title,
    concat_ws(E'\n', trim(p_reason), nullif(trim(coalesce(p_impact, '')), ''), nullif(trim(coalesce(p_needs_help_from, '')), '')),
    'task.mention:blocker:' || v_blocker.id || ':' || profile.id,
    '/tasks/' || p_task_id || '?focus=blocker:' || v_blocker.id
  from public.profiles profile
  where profile.id = any(coalesce(p_mention_recipient_profile_ids, '{}'::text[]))
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id,
    after_data, request_ip, user_agent
  ) values (
    p_actor_profile_id, 'task.blocker_reported', 'task', p_task_id,
    jsonb_build_object(
      'reason', trim(p_reason),
      'impact', trim(coalesce(p_impact, '')),
      'needsHelpFrom', trim(coalesce(p_needs_help_from, '')),
      'status', 'Blockiert'
    ),
    p_request_ip, p_user_agent
  );

  return jsonb_build_object(
    'blocker', to_jsonb(v_blocker),
    'task', jsonb_build_object('id', p_task_id, 'status', 'Blockiert')
  );
end;
$$;

revoke all on function public.report_task_blocker_transaction_v2(
  text, text, text, text, text, jsonb, text[], text, text
) from public, anon, authenticated;
grant execute on function public.report_task_blocker_transaction_v2(
  text, text, text, text, text, jsonb, text[], text, text
) to service_role;

create or replace function public.update_browser_planning_task_transaction_v2(
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
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := public.update_browser_planning_task_transaction(
    p_task_id,
    p_expected_updated_at,
    p_task_patch,
    p_note_present,
    p_note,
    p_dependency_present,
    p_dependency_note,
    p_activity_messages,
    '[]'::jsonb,
    p_actor_profile_id
  );

  insert into public.notification_events (
    type,
    actor_profile_id,
    recipient_profile_id,
    entity_type,
    entity_id,
    title,
    body,
    dedupe_key,
    target_path
  )
  select
    notification.type,
    notification.actor_profile_id,
    notification.recipient_profile_id,
    notification.entity_type,
    notification.entity_id,
    notification.title,
    notification.body,
    notification.dedupe_key,
    notification.target_path
  from jsonb_to_recordset(coalesce(p_notifications, '[]'::jsonb)) as notification(
    type text,
    actor_profile_id text,
    recipient_profile_id text,
    entity_type text,
    entity_id text,
    title text,
    body text,
    dedupe_key text,
    target_path text
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  return v_result;
end;
$$;

revoke all on function public.update_browser_planning_task_transaction_v2(
  text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb, text
) from public, anon, authenticated;
grant execute on function public.update_browser_planning_task_transaction_v2(
  text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb, text
) to service_role;

create or replace function public.update_administrator_planning_task_transaction_v2(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_task_patch jsonb,
  p_note_present boolean,
  p_note text,
  p_dependency_present boolean,
  p_dependency_note text,
  p_activity_messages text[],
  p_notifications jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_profile_id text;
  v_result jsonb;
  v_notifications jsonb;
begin
  v_actor_profile_id := public.require_active_administrator_profile();
  v_result := public.update_administrator_planning_task_transaction(
    p_task_id,
    p_expected_updated_at,
    p_task_patch,
    p_note_present,
    p_note,
    p_dependency_present,
    p_dependency_note,
    p_activity_messages,
    '[]'::jsonb
  );
  v_notifications := public.canonicalize_administrator_task_mention_notifications(
    p_notifications,
    p_task_id,
    v_actor_profile_id
  );
  perform public.insert_task_mention_notifications(v_notifications);
  return v_result;
end;
$$;

revoke all on function public.update_administrator_planning_task_transaction_v2(
  text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb
) from public, anon, authenticated;
grant execute on function public.update_administrator_planning_task_transaction_v2(
  text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb
) to authenticated, service_role;
