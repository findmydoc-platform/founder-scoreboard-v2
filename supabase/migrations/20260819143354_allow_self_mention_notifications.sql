create or replace function public.create_task_comment_with_notifications(
  p_task_id text,
  p_profile_id text,
  p_comment text,
  p_deliver_to_github boolean,
  p_mention_recipient_profile_ids text[] default '{}',
  p_comment_recipient_profile_ids text[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_task public.tasks%rowtype;
  v_comment public.task_comments%rowtype;
  v_status text := 'not_applicable';
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
  if nullif(trim(coalesce(p_comment, '')), '') is null then
    raise exception using errcode = '22023', message = 'comment is required';
  end if;
  if p_deliver_to_github = (v_task.task_type in ('epic', 'initiative')) then
    raise exception using errcode = '22023', message = 'comment delivery mode does not match task capability';
  end if;

  insert into public.task_comments (task_id, profile_id, comment, github_delivery_applicable)
  values (p_task_id, nullif(p_profile_id, ''), trim(p_comment), p_deliver_to_github)
  returning * into v_comment;

  if p_deliver_to_github then
    v_status := case
      when v_task.github_issue_number is null and coalesce(trim(v_task.issue_number), '') !~ '^[1-9][0-9]*$' then 'waiting_for_issue'
      when nullif(p_profile_id, '') is null then 'waiting_for_author_connection'
      else 'pending'
    end;

    insert into public.task_comment_github_deliveries (
      task_comment_id, task_id, author_profile_id, github_issue_number, status, status_reason
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
  end if;

  insert into public.notification_events (
    type, actor_profile_id, recipient_profile_id, entity_type, entity_id,
    title, body, dedupe_key, target_path
  )
  select
    'task.mention', nullif(p_profile_id, ''), recipient_id, 'task', p_task_id,
    'Du wurdest erwähnt: ' || v_task.title, trim(p_comment),
    'task.mention:founderops:' || v_comment.id || ':' || recipient_id,
    '/tasks/' || p_task_id || '?comment=local:' || v_comment.id
  from unnest(coalesce(p_mention_recipient_profile_ids, '{}')) recipient_id
  where nullif(trim(recipient_id), '') is not null
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  insert into public.notification_events (
    type, actor_profile_id, recipient_profile_id, entity_type, entity_id,
    title, body, dedupe_key, target_path
  )
  select
    'task.comment', nullif(p_profile_id, ''), recipient_id, 'task', p_task_id,
    'Neuer Kommentar: ' || v_task.title, trim(p_comment),
    'task.comment:founderops:' || v_comment.id || ':' || recipient_id,
    '/tasks/' || p_task_id || '?comment=local:' || v_comment.id
  from unnest(coalesce(p_comment_recipient_profile_ids, '{}')) recipient_id
  where nullif(trim(recipient_id), '') is not null
    and recipient_id is distinct from nullif(p_profile_id, '')
    and not (recipient_id = any(coalesce(p_mention_recipient_profile_ids, '{}')))
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  return jsonb_build_object(
    'comment', to_jsonb(v_comment),
    'deliveryStatus', v_status
  );
end;
$$;

create or replace function public.import_github_task_comments_with_mentions(
  p_task_id text,
  p_comments jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_task public.tasks%rowtype;
  v_comment jsonb;
  v_external_id text;
  v_actor_profile_id text;
  v_author_login text;
  v_source_updated_at timestamptz;
  v_baseline_source_updated_at timestamptz;
  v_existing public.task_external_comments%rowtype;
  v_previous_recipient_profile_ids text[];
  v_current_recipient_profile_ids text[];
  v_imported integer := 0;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
  if jsonb_typeof(coalesce(p_comments, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'comments must be an array';
  end if;

  for v_comment in select value from jsonb_array_elements(coalesce(p_comments, '[]'::jsonb)) loop
    v_external_id := nullif(trim(v_comment ->> 'externalId'), '');
    v_author_login := nullif(trim(v_comment ->> 'authorLogin'), '');
    v_actor_profile_id := nullif(trim(v_comment ->> 'actorProfileId'), '');
    v_source_updated_at := (v_comment ->> 'sourceUpdatedAt')::timestamptz;
    v_baseline_source_updated_at := nullif(v_comment ->> 'baselineSourceUpdatedAt', '')::timestamptz;
    select coalesce(array_agg(recipient_id order by recipient_id), '{}')
    into v_current_recipient_profile_ids
    from (
      select distinct nullif(trim(value), '') as recipient_id
      from jsonb_array_elements_text(coalesce(v_comment -> 'mentionRecipientProfileIds', '[]'::jsonb))
    ) recipients
    where recipient_id is not null;
    if v_external_id is null or v_author_login is null or nullif(trim(v_comment ->> 'body'), '') is null then
      raise exception using errcode = '22023', message = 'complete GitHub comment content is required';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('github:' || v_external_id, 0));
    select * into v_existing
    from public.task_external_comments
    where source = 'github' and external_id = v_external_id
    for update;

    if found and v_source_updated_at < v_existing.source_updated_at then
      continue;
    end if;

    if not found then
      v_imported := v_imported + 1;
      v_previous_recipient_profile_ids := '{}';
    elsif v_existing.mention_recipients_initialized then
      v_previous_recipient_profile_ids := v_existing.mention_recipient_profile_ids;
    else
      if v_baseline_source_updated_at is distinct from v_existing.source_updated_at then
        raise exception using errcode = '40001', message = 'GitHub comment mention baseline changed before import';
      end if;
      select coalesce(array_agg(recipient_id order by recipient_id), '{}')
      into v_previous_recipient_profile_ids
      from (
        select distinct nullif(trim(value), '') as recipient_id
        from jsonb_array_elements_text(coalesce(v_comment -> 'baselineMentionRecipientProfileIds', '[]'::jsonb))
      ) recipients
      where recipient_id is not null;
    end if;

    insert into public.task_external_comments (
      task_id, source, external_id, author_login, author_avatar_url, body,
      html_url, created_at, source_updated_at, imported_at,
      mention_recipient_profile_ids, mention_recipients_initialized
    ) values (
      p_task_id, 'github', v_external_id, v_author_login,
      nullif(trim(v_comment ->> 'authorAvatarUrl'), ''), trim(v_comment ->> 'body'),
      nullif(trim(v_comment ->> 'htmlUrl'), ''), (v_comment ->> 'createdAt')::timestamptz,
      v_source_updated_at, (v_comment ->> 'importedAt')::timestamptz,
      v_current_recipient_profile_ids, true
    )
    on conflict (source, external_id) do update
    set task_id = excluded.task_id,
        author_login = excluded.author_login,
        author_avatar_url = excluded.author_avatar_url,
        body = excluded.body,
        html_url = excluded.html_url,
        created_at = excluded.created_at,
        source_updated_at = excluded.source_updated_at,
        imported_at = excluded.imported_at,
        mention_recipient_profile_ids = excluded.mention_recipient_profile_ids,
        mention_recipients_initialized = true;

    if v_task.github_comment_notifications_after is not null
      and v_source_updated_at >= v_task.github_comment_notifications_after
    then
      insert into public.notification_events (
        type, actor_profile_id, actor_label, recipient_profile_id, entity_type, entity_id,
        title, body, dedupe_key, target_path
      )
      select
        'task.mention', v_actor_profile_id, v_author_login, recipient_id, 'task', p_task_id,
        '@' || v_author_login || ' hat dich erwähnt: ' || v_task.title, trim(v_comment ->> 'body'),
        'task.mention:github:' || v_external_id || ':' || recipient_id,
        '/tasks/' || p_task_id || '?comment=github:' || v_external_id
      from unnest(v_current_recipient_profile_ids) recipient_id
      where recipient_id is not null
        and not (recipient_id = any(v_previous_recipient_profile_ids))
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end loop;

  return jsonb_build_object('imported', v_imported);
end;
$$;

create or replace function public.apply_github_issue_comment_webhook_projection_with_mentions(
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
  p_imported_at timestamptz,
  p_actor_profile_id text default null,
  p_mention_recipient_profile_ids text[] default '{}',
  p_baseline_mention_recipient_profile_ids text[] default '{}',
  p_baseline_source_updated_at timestamptz default null
) returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_delivery public.github_webhook_deliveries%rowtype;
  v_task public.tasks%rowtype;
  v_is_stale boolean := false;
  v_mapping_count integer := 0;
  v_mapping_task_id text;
  v_existing public.task_external_comments%rowtype;
  v_existing_found boolean;
  v_previous_recipient_profile_ids text[];
  v_current_recipient_profile_ids text[];
begin
  if p_operation not in ('upsert', 'suppress', 'delete') then
    raise exception using errcode = '22023', message = 'invalid Issue comment projection operation';
  end if;
  if nullif(trim(coalesce(p_task_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'task id is required';
  end if;

  select delivery.* into v_delivery
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
    if v_delivery.action <> 'deleted' or p_comment_updated_at is distinct from v_delivery.comment_updated_at then
      raise exception using errcode = '22023', message = 'only the matching deleted event can remove a GitHub comment projection';
    end if;
  elsif v_delivery.action not in ('created', 'edited')
    or p_comment_updated_at is null
    or p_comment_updated_at < v_delivery.comment_updated_at
  then
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
  from public.resolve_github_issue_comment_webhook_tasks(v_delivery.repository_full_name, v_delivery.issue_number) mapping;
  if v_mapping_count <> 1 or v_mapping_task_id <> p_task_id then
    raise exception using errcode = 'P0003', message = 'GitHub Issue task mapping changed before projection';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  perform pg_advisory_xact_lock(hashtextextended('github:' || v_delivery.comment_id::text, 0));

  select exists (
    select 1 from public.github_webhook_deliveries newer
    where newer.event_name = 'issue_comment'
      and newer.comment_id = v_delivery.comment_id
      and newer.delivery_id <> v_delivery.delivery_id
      and (
        newer.comment_updated_at > p_comment_updated_at
        or (newer.comment_updated_at = p_comment_updated_at and newer.action = 'deleted' and p_operation <> 'delete')
        or (
          newer.comment_updated_at = p_comment_updated_at
          and (newer.action = 'deleted') = (p_operation = 'delete')
          and (newer.received_at > v_delivery.received_at
            or (newer.received_at = v_delivery.received_at and newer.delivery_id > v_delivery.delivery_id))
        )
      )
  ) into v_is_stale;
  if v_is_stale then return 'stale'; end if;

  select * into v_existing
  from public.task_external_comments
  where source = 'github' and external_id = v_delivery.comment_id::text
  for update;
  v_existing_found := found;
  if v_existing_found and p_comment_updated_at < v_existing.source_updated_at then
    return 'stale';
  end if;

  if p_operation = 'upsert' then
    select coalesce(array_agg(recipient_id order by recipient_id), '{}')
    into v_current_recipient_profile_ids
    from (
      select distinct nullif(trim(recipient_id), '') as recipient_id
      from unnest(coalesce(p_mention_recipient_profile_ids, '{}')) recipient_id
    ) recipients
    where recipient_id is not null;

    if not v_existing_found then
      v_previous_recipient_profile_ids := '{}';
    elsif v_existing.mention_recipients_initialized then
      v_previous_recipient_profile_ids := v_existing.mention_recipient_profile_ids;
    else
      if p_baseline_source_updated_at is distinct from v_existing.source_updated_at then
        raise exception using errcode = '40001', message = 'GitHub comment mention baseline changed before webhook projection';
      end if;
      select coalesce(array_agg(recipient_id order by recipient_id), '{}')
      into v_previous_recipient_profile_ids
      from (
        select distinct nullif(trim(recipient_id), '') as recipient_id
        from unnest(coalesce(p_baseline_mention_recipient_profile_ids, '{}')) recipient_id
      ) recipients
      where recipient_id is not null;
    end if;

    insert into public.task_external_comments (
      task_id, source, external_id, author_login, author_avatar_url, body,
      html_url, created_at, source_updated_at, imported_at,
      mention_recipient_profile_ids, mention_recipients_initialized
    ) values (
      p_task_id, 'github', v_delivery.comment_id::text, trim(p_author_login),
      nullif(trim(coalesce(p_author_avatar_url, '')), ''), trim(p_body), trim(p_html_url),
      p_created_at, p_comment_updated_at, p_imported_at,
      v_current_recipient_profile_ids, true
    )
    on conflict (source, external_id) do update
    set task_id = excluded.task_id,
        author_login = excluded.author_login,
        author_avatar_url = excluded.author_avatar_url,
        body = excluded.body,
        html_url = excluded.html_url,
        created_at = excluded.created_at,
        source_updated_at = excluded.source_updated_at,
        imported_at = excluded.imported_at,
        mention_recipient_profile_ids = excluded.mention_recipient_profile_ids,
        mention_recipients_initialized = true;

    if v_task.github_comment_notifications_after is not null
      and p_comment_updated_at >= v_task.github_comment_notifications_after
    then
      insert into public.notification_events (
        type, actor_profile_id, actor_label, recipient_profile_id, entity_type, entity_id,
        title, body, dedupe_key, target_path
      )
      select
        'task.mention', nullif(trim(coalesce(p_actor_profile_id, '')), ''), trim(p_author_login),
        recipient_id, 'task', p_task_id,
        '@' || trim(p_author_login) || ' hat dich erwähnt: ' || v_task.title, trim(p_body),
        'task.mention:github:' || v_delivery.comment_id || ':' || recipient_id,
        '/tasks/' || p_task_id || '?comment=github:' || v_delivery.comment_id
      from unnest(v_current_recipient_profile_ids) recipient_id
      where nullif(trim(recipient_id), '') is not null
        and not (recipient_id = any(v_previous_recipient_profile_ids))
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
  else
    delete from public.task_external_comments external_comment
    where external_comment.source = 'github'
      and external_comment.external_id = v_delivery.comment_id::text;
  end if;

  return 'applied';
end;
$$;
