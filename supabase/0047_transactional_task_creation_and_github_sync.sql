alter table public.tasks add column if not exists creation_request_id text;
alter table public.tasks add column if not exists creation_request_payload jsonb;

create unique index if not exists tasks_creation_request_id_unique_idx
  on public.tasks(creation_request_id)
  where creation_request_id is not null;

comment on column public.tasks.creation_request_payload
is 'Stores only an MD5 fingerprint of the normalized create request for idempotency comparison.';

create or replace function public.create_task_transaction(
  p_task_insert jsonb,
  p_relation_type text default null,
  p_related_task_id text default null,
  p_relation_note text default null,
  p_activity_message text default 'Task created',
  p_relation_activity_message text default null,
  p_notifications jsonb default '[]'::jsonb,
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
  v_insert jsonb := coalesce(p_task_insert, '{}'::jsonb);
  v_allowed_columns constant text[] := array[
    'acceptance_criteria',
    'assignee',
    'carryover_count',
    'carryover_reason',
    'carried_from_sprint_id',
    'carried_from_task_id',
    'created_by',
    'creation_request_id',
    'deadline',
    'definition_of_done',
    'description',
    'dod_template_version',
    'end_date',
    'estimate_hours',
    'evidence_link',
    'evidence_required',
    'github_issue_number',
    'github_issue_url',
    'github_repo',
    'github_sync_status',
    'id',
    'intended_outcome',
    'issue_number',
    'issue_url',
    'milestone_id',
    'original_sprint_id',
    'owner',
    'package_id',
    'parent_task_id',
    'priority',
    'problem_statement',
    'project_id',
    'review_owner_profile_id',
    'review_status',
    'score_final',
    'score_points',
    'score_relevant',
    'scope_constraints',
    'sort_order',
    'sprint_id',
    'start_date',
    'status',
    'task_type',
    'title',
    'workstream'
  ];
  v_task_id text := nullif(trim(v_insert->>'id'), '');
  v_creation_request_id text := nullif(trim(v_insert->>'creation_request_id'), '');
  v_request_payload jsonb;
  v_request_fingerprint jsonb;
  v_columns text;
  v_values text;
  v_task jsonb;
  v_relation jsonb := null;
  v_related_task jsonb := null;
  v_activities jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(v_insert) <> 'object' or v_task_id is null or v_creation_request_id is null then
    raise exception using errcode = '22023', message = 'task insert, task id, and creation request id are required';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(v_insert) as insert_key
    where not (insert_key = any(v_allowed_columns))
  ) then
    raise exception using errcode = '22023', message = 'task insert contains unsupported columns';
  end if;

  if jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'task notifications must be a JSON array';
  end if;

  v_request_payload := jsonb_build_object(
    'task', v_insert - 'sort_order',
    'relation', jsonb_build_object(
      'type', nullif(trim(coalesce(p_relation_type, '')), ''),
      'relatedTaskId', nullif(trim(coalesce(p_related_task_id, '')), ''),
      'note', nullif(trim(coalesce(p_relation_note, '')), '')
    )
  );
  v_request_fingerprint := to_jsonb(md5(v_request_payload::text));

  perform pg_advisory_xact_lock(hashtextextended('task-create:' || v_creation_request_id, 0));
  select to_jsonb(task) into v_task
  from public.tasks as task
  where task.creation_request_id = v_creation_request_id;

  if v_task is not null then
    if (v_task->'creation_request_payload') is distinct from v_request_fingerprint then
      raise exception using errcode = 'P0003', message = 'creation request id was reused with different task data';
    end if;

    select to_jsonb(relation) into v_relation
    from public.task_relationship_edges as relation
    where relation.task_id = v_task->>'id'
    order by relation.id
    limit 1;

    if v_relation is not null then
      select jsonb_build_object(
        'id', related.id,
        'githubSyncStatus', related.github_sync_status,
        'githubSyncError', coalesce(related.github_sync_error, ''),
        'updatedAt', related.updated_at
      )
      into v_related_task
      from public.tasks as related
      where related.id = v_relation->>'related_task_id';
    end if;

    return jsonb_build_object(
      'task', v_task,
      'relation', v_relation,
      'relatedTask', v_related_task,
      'activities', '[]'::jsonb,
      'replayed', true
    );
  end if;

  if nullif(trim(coalesce(p_related_task_id, '')), '') is not null then
    if p_related_task_id = v_task_id then
      raise exception using errcode = '22023', message = 'task cannot relate to itself';
    end if;
    if p_relation_type not in ('blocked_by', 'blocks', 'relates_to') then
      raise exception using errcode = '22023', message = 'task relation type is invalid';
    end if;
    if not exists (select 1 from public.tasks where id = p_related_task_id) then
      raise exception using errcode = 'P0002', message = 'related task not found';
    end if;
  elsif nullif(trim(coalesce(p_relation_type, '')), '') is not null then
    raise exception using errcode = '22023', message = 'related task id is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tasks:sort-order', 0));
  v_insert := v_insert || jsonb_build_object(
    'sort_order', coalesce((select max(sort_order) from public.tasks), 0) + 1,
    'creation_request_payload', v_request_fingerprint
  );

  select
    string_agg(format('%I', insert_key), ', ' order by insert_key),
    string_agg(
      format('(jsonb_populate_record(null::public.tasks, $1)).%I', insert_key),
      ', '
      order by insert_key
    )
  into v_columns, v_values
  from jsonb_object_keys(v_insert) as insert_key;

  execute format(
    'insert into public.tasks (%s) select %s returning to_jsonb(tasks)',
    v_columns,
    v_values
  )
  into v_task
  using v_insert;

  if nullif(trim(coalesce(p_related_task_id, '')), '') is not null then
    insert into public.task_relationship_edges (
      task_id,
      related_task_id,
      relation_type,
      note,
      created_by
    )
    values (
      v_task_id,
      p_related_task_id,
      p_relation_type,
      nullif(trim(coalesce(p_relation_note, '')), ''),
      p_actor_profile_id
    )
    returning to_jsonb(task_relationship_edges) into v_relation;

    update public.tasks as related
    set github_sync_status = 'not_synced',
        github_sync_error = null,
        updated_at = clock_timestamp()
    where id = p_related_task_id
    returning jsonb_build_object(
      'id', related.id,
      'githubSyncStatus', related.github_sync_status,
      'githubSyncError', coalesce(related.github_sync_error, ''),
      'updatedAt', related.updated_at
    ) into v_related_task;
  end if;

  with inserted as (
    insert into public.task_activity (task_id, message)
    select v_task_id, message
    from unnest(array[p_activity_message, p_relation_activity_message]) as message
    where nullif(trim(coalesce(message, '')), '') is not null
    returning id, task_id, message, created_at
  )
  select coalesce(jsonb_agg(to_jsonb(inserted) order by inserted.id), '[]'::jsonb)
  into v_activities
  from inserted;

  insert into public.notification_events (
    type,
    actor_profile_id,
    recipient_profile_id,
    entity_type,
    entity_id,
    title,
    body
  )
  select
    notification.type,
    notification.actor_profile_id,
    notification.recipient_profile_id,
    notification.entity_type,
    notification.entity_id,
    notification.title,
    notification.body
  from jsonb_to_recordset(coalesce(p_notifications, '[]'::jsonb)) as notification(
    type text,
    actor_profile_id text,
    recipient_profile_id text,
    entity_type text,
    entity_id text,
    title text,
    body text
  );

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    after_data,
    request_ip,
    user_agent
  )
  values (
    p_actor_profile_id,
    'task.create',
    'task',
    v_task_id,
    v_insert,
    p_request_ip,
    p_user_agent
  );

  if v_relation is not null then
    insert into public.audit_log (
      actor_profile_id,
      action,
      entity_type,
      entity_id,
      after_data,
      request_ip,
      user_agent
    )
    values (
      p_actor_profile_id,
      'task.relationship_created',
      'task',
      v_task_id,
      v_relation,
      p_request_ip,
      p_user_agent
    );
  end if;

  return jsonb_build_object(
    'task', v_task,
    'relation', v_relation,
    'relatedTask', v_related_task,
    'activities', v_activities,
    'replayed', false
  );
end;
$$;

create or replace function public.begin_github_issue_sync_transaction(p_task_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task jsonb;
begin
  update public.tasks
  set github_sync_status = 'pending',
      github_sync_error = null,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning to_jsonb(tasks) into v_task;

  if v_task is null then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  return v_task;
end;
$$;

create or replace function public.finalize_github_issue_sync_transaction(
  p_task_id text,
  p_github_repo text,
  p_github_issue_number integer,
  p_github_issue_url text,
  p_synced_at timestamptz,
  p_activity_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task jsonb;
begin
  if p_github_issue_number is null or p_github_issue_number <= 0 then
    raise exception using errcode = '22023', message = 'github issue number is invalid';
  end if;

  update public.tasks
  set github_repo = p_github_repo,
      github_issue_number = p_github_issue_number,
      github_issue_url = p_github_issue_url,
      github_sync_status = 'synced',
      github_last_synced_at = p_synced_at,
      github_sync_error = null,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning to_jsonb(tasks) into v_task;

  if v_task is null then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  insert into public.task_activity (task_id, message)
  values (p_task_id, p_activity_message);

  return v_task;
end;
$$;

create or replace function public.fail_github_issue_sync_transaction(
  p_task_id text,
  p_error_message text,
  p_activity_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task jsonb;
begin
  update public.tasks
  set github_sync_status = 'failed',
      github_sync_error = left(coalesce(p_error_message, 'GitHub sync failed'), 4000),
      updated_at = clock_timestamp()
  where id = p_task_id
  returning to_jsonb(tasks) into v_task;

  if v_task is null then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  insert into public.task_activity (task_id, message)
  values (p_task_id, p_activity_message);

  return v_task;
end;
$$;

revoke all on function public.create_task_transaction(jsonb, text, text, text, text, text, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.begin_github_issue_sync_transaction(text) from public, anon, authenticated;
revoke all on function public.finalize_github_issue_sync_transaction(text, text, integer, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.fail_github_issue_sync_transaction(text, text, text) from public, anon, authenticated;
grant execute on function public.create_task_transaction(jsonb, text, text, text, text, text, jsonb, text, text, text) to service_role;
grant execute on function public.begin_github_issue_sync_transaction(text) to service_role;
grant execute on function public.finalize_github_issue_sync_transaction(text, text, integer, text, timestamptz, text) to service_role;
grant execute on function public.fail_github_issue_sync_transaction(text, text, text) to service_role;

comment on function public.create_task_transaction(jsonb, text, text, text, text, text, jsonb, text, text, text)
is 'Atomically creates a task with its optional first relationship, activity, notifications, and audit records.';

comment on function public.finalize_github_issue_sync_transaction(text, text, integer, text, timestamptz, text)
is 'Atomically persists a successful GitHub issue sync and its activity record.';

notify pgrst, 'reload schema';
