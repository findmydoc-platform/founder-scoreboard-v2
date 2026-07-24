alter table public.task_links
  add column if not exists position integer not null default 0,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.task_links
  add constraint task_links_metadata_object_check
  check (jsonb_typeof(metadata) = 'object') not valid;

alter table public.task_links
  validate constraint task_links_metadata_object_check;

create index if not exists task_links_task_type_position_idx
  on public.task_links (task_id, type, position, id);

comment on column public.task_links.position
  is 'Stable zero-based display order within a task link type.';
comment on column public.task_links.metadata
  is 'Provider-owned metadata for projected task links. Manual evidence URLs remain URL-only.';

insert into public.task_links (task_id, type, label, url, position, metadata)
select
  task.id,
  'evidence',
  task.evidence_link,
  task.evidence_link,
  0,
  jsonb_build_object('source', 'legacy_evidence_link')
from public.tasks as task
where task.evidence_link ~* '^https?://'
  and not exists (
    select 1
    from public.task_links as task_link
    where task_link.task_id = task.id
      and task_link.type = 'evidence'
      and task_link.url = task.evidence_link
  );

create or replace function public.replace_task_evidence_links(
  p_task_id text,
  p_evidence_links jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_links jsonb := coalesce(p_evidence_links, '[]'::jsonb);
begin
  if jsonb_typeof(v_links) <> 'array' or jsonb_array_length(v_links) > 20 then
    raise exception using errcode = '22023', message = 'evidence links must be an array with at most 20 entries';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_links) as entry(value)
    where jsonb_typeof(entry.value) <> 'string'
      or nullif(trim(entry.value #>> '{}'), '') is null
      or length(trim(entry.value #>> '{}')) > 2048
      or trim(entry.value #>> '{}') !~* '^https?://'
  ) then
    raise exception using errcode = '22023', message = 'evidence links must contain valid HTTP or HTTPS URLs';
  end if;

  if (
    select count(distinct lower(trim(entry.value #>> '{}')))
    from jsonb_array_elements(v_links) as entry(value)
  ) <> jsonb_array_length(v_links) then
    raise exception using errcode = '22023', message = 'evidence links must not contain duplicates';
  end if;

  delete from public.task_links
  where task_id = p_task_id
    and type = 'evidence';

  insert into public.task_links (task_id, type, label, url, position, metadata)
  select
    p_task_id,
    'evidence',
    trim(entry.value),
    trim(entry.value),
    entry.ordinality::integer - 1,
    '{}'::jsonb
  from jsonb_array_elements_text(v_links) with ordinality as entry(value, ordinality);

  return v_links;
end;
$$;

alter function public.replace_task_evidence_links(text, jsonb) owner to postgres;
comment on function public.replace_task_evidence_links(text, jsonb)
  is 'Replaces only the manual evidence URL projection for one task.';
revoke all on function public.replace_task_evidence_links(text, jsonb) from public;
grant execute on function public.replace_task_evidence_links(text, jsonb) to service_role;

create or replace function public.update_planning_task_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_task_patch jsonb default '{}'::jsonb,
  p_note_present boolean default false,
  p_note text default null,
  p_dependency_present boolean default false,
  p_dependency_note text default null,
  p_activity_messages text[] default '{}'::text[],
  p_notifications jsonb default '[]'::jsonb,
  p_actor_profile_id text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_patch jsonb := coalesce(p_task_patch, '{}'::jsonb);
  v_evidence_links_present boolean := v_patch ? 'evidence_links';
  v_evidence_links jsonb := v_patch->'evidence_links';
  v_changes_parent boolean := v_patch ? 'parent_task_id';
  v_changes_status boolean := v_patch ? 'status';
  v_parent_id text;
  v_initial_parent_id text;
  v_initial_task_type text;
  v_before_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_updated_task public.tasks%rowtype;
  v_result jsonb;
begin
  perform set_config('app.actor_profile_id', coalesce(p_actor_profile_id, ''), true);

  v_patch := v_patch - 'evidence_links';

  if not v_changes_parent and not v_changes_status then
    v_result := public.update_task_transaction(
      p_task_id, p_expected_updated_at, v_patch, p_note_present, p_note,
      p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
    );
    if v_evidence_links_present then
      perform public.replace_task_evidence_links(p_task_id, v_evidence_links);
    end if;
    return v_result;
  end if;

  select task_type, parent_task_id
  into v_initial_task_type, v_initial_parent_id
  from public.tasks
  where id = p_task_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  if v_changes_parent then
    if v_initial_task_type <> 'sub_issue' then
      raise exception using errcode = '22023', message = 'only sub-issues may change parent';
    end if;
    v_parent_id := nullif(trim(v_patch->>'parent_task_id'), '');
  elsif v_initial_task_type = 'sub_issue' then
    v_parent_id := v_initial_parent_id;
  else
    v_result := public.update_task_transaction(
      p_task_id, p_expected_updated_at, v_patch, p_note_present, p_note,
      p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
    );
    if v_evidence_links_present then
      perform public.replace_task_evidence_links(p_task_id, v_evidence_links);
    end if;
    return v_result;
  end if;

  if v_parent_id is null then
    raise exception using errcode = '22023', message = 'sub-issue parent is required';
  end if;

  select * into v_parent
  from public.tasks
  where id = v_parent_id
    and task_type = 'deliverable'
    and trashed_at is null
  for share;
  if not found then
    raise exception using errcode = '22023', message = 'sub-issue parent must be an active deliverable';
  end if;
  if v_changes_status and v_parent.approval_status is distinct from 'approved' then
    raise exception using errcode = 'P0008', message = 'sub-issue parent is not approved';
  end if;

  select * into v_before_task
  from public.tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
  if v_before_task.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'task was changed concurrently';
  end if;
  if v_before_task.task_type <> 'sub_issue' then
    raise exception using errcode = '22023', message = 'only sub-issues may change parent';
  end if;
  if v_before_task.trashed_at is not null then
    raise exception using errcode = 'P0003', message = 'sub-issue is trashed';
  end if;
  if not v_changes_parent and v_before_task.parent_task_id is distinct from v_parent_id then
    raise exception using errcode = 'P0001', message = 'sub-issue parent changed concurrently';
  end if;

  if not v_changes_parent then
    v_result := public.update_task_transaction(
      p_task_id, p_expected_updated_at, v_patch, p_note_present, p_note,
      p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
    );
    if v_evidence_links_present then
      perform public.replace_task_evidence_links(p_task_id, v_evidence_links);
    end if;
    return jsonb_set(
      v_result,
      '{parentApprovalStatus}',
      to_jsonb(v_parent.approval_status),
      true
    );
  end if;

  v_result := public.update_task_transaction(
    p_task_id, p_expected_updated_at, v_patch - 'parent_task_id', p_note_present, p_note,
    p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
  );

  update public.tasks
  set parent_task_id = v_parent_id,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning * into v_updated_task;

  if v_evidence_links_present then
    perform public.replace_task_evidence_links(p_task_id, v_evidence_links);
  end if;

  if v_before_task.parent_task_id is distinct from v_updated_task.parent_task_id then
    insert into public.audit_log (
      actor_profile_id,
      action,
      entity_type,
      entity_id,
      before_data,
      after_data
    ) values (
      p_actor_profile_id,
      'task.parent_changed',
      'task',
      p_task_id,
      jsonb_build_object(
        'parentTaskId', v_before_task.parent_task_id,
        'packageId', v_before_task.package_id,
        'milestoneId', v_before_task.milestone_id
      ),
      jsonb_build_object(
        'parentTaskId', v_updated_task.parent_task_id,
        'packageId', v_updated_task.package_id,
        'milestoneId', v_updated_task.milestone_id
      )
    );
  end if;

  return jsonb_set(
    jsonb_set(v_result, '{task}', to_jsonb(v_updated_task), true),
    '{parentApprovalStatus}',
    to_jsonb(v_parent.approval_status),
    true
  );
end;
$$;

comment on function public.update_planning_task_transaction(
  text,
  timestamptz,
  jsonb,
  boolean,
  text,
  boolean,
  text,
  text[],
  jsonb,
  text
) is 'Atomically applies task updates, evidence links, and locked Sub-Issue parent approval state.';

create or replace function public.finalize_github_issue_sync_with_pull_requests_v1(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_github_repo text,
  p_github_issue_number integer,
  p_github_issue_url text,
  p_synced_at timestamptz,
  p_activity_message text,
  p_linked_pull_requests jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task jsonb;
begin
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'expected task revision is required';
  end if;
  if p_github_issue_number is null or p_github_issue_number <= 0 then
    raise exception using errcode = '22023', message = 'github issue number is invalid';
  end if;
  if p_linked_pull_requests is not null
    and (jsonb_typeof(p_linked_pull_requests) <> 'array' or jsonb_array_length(p_linked_pull_requests) > 100) then
    raise exception using errcode = '22023', message = 'linked pull requests must be a JSON array with at most 100 entries';
  end if;
  if p_linked_pull_requests is not null and exists (
    select 1
    from jsonb_array_elements(p_linked_pull_requests) as entry(value)
    where jsonb_typeof(entry.value) <> 'object'
      or nullif(trim(entry.value->>'title'), '') is null
      or length(trim(entry.value->>'title')) > 500
      or coalesce(entry.value->>'repository', '') !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
      or coalesce(entry.value->>'number', '') !~ '^[1-9][0-9]*$'
      or coalesce(entry.value->>'url', '') !~ '^https://github\.com/'
      or coalesce(entry.value->>'status', '') not in ('open', 'merged', 'closed')
  ) then
    raise exception using errcode = '22023', message = 'linked pull request metadata is invalid';
  end if;

  update public.tasks
  set github_repo = p_github_repo,
      github_issue_number = p_github_issue_number,
      github_issue_url = p_github_issue_url,
      github_issue_sync_status = 'synced',
      github_issue_last_synced_at = p_synced_at,
      github_issue_sync_error = null,
      updated_at = clock_timestamp()
  where id = p_task_id
    and updated_at = p_expected_updated_at
    and github_issue_sync_status = 'pending'
  returning to_jsonb(tasks) into v_task;

  if v_task is null then
    if exists (select 1 from public.tasks where id = p_task_id) then
      raise exception using errcode = 'P0001', message = 'task was changed concurrently';
    end if;
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  if p_linked_pull_requests is not null then
    delete from public.task_links
    where task_id = p_task_id
      and type = 'github_pull_request';

    insert into public.task_links (task_id, type, label, url, position, metadata)
    select
      p_task_id,
      'github_pull_request',
      trim(entry.value->>'title'),
      entry.value->>'url',
      entry.ordinality::integer - 1,
      jsonb_build_object(
        'repository', entry.value->>'repository',
        'number', (entry.value->>'number')::integer,
        'status', entry.value->>'status',
        'mergedAt', nullif(entry.value->>'mergedAt', '')
      )
    from jsonb_array_elements(p_linked_pull_requests) with ordinality as entry(value, ordinality);
  end if;

  insert into public.task_activity (task_id, message)
  values (p_task_id, p_activity_message);

  return v_task;
end;
$$;

alter function public.finalize_github_issue_sync_with_pull_requests_v1(
  text,
  timestamptz,
  text,
  integer,
  text,
  timestamptz,
  text,
  jsonb
) owner to postgres;
comment on function public.finalize_github_issue_sync_with_pull_requests_v1(
  text,
  timestamptz,
  text,
  integer,
  text,
  timestamptz,
  text,
  jsonb
) is 'Finalizes GitHub issue sync and replaces linked PRs only when GitHub returned a complete projection.';
revoke all on function public.finalize_github_issue_sync_with_pull_requests_v1(
  text,
  timestamptz,
  text,
  integer,
  text,
  timestamptz,
  text,
  jsonb
) from public;
grant execute on function public.finalize_github_issue_sync_with_pull_requests_v1(
  text,
  timestamptz,
  text,
  integer,
  text,
  timestamptz,
  text,
  jsonb
) to service_role;
