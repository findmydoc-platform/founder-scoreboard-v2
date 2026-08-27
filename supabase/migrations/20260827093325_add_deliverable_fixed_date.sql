alter table public.tasks
  add column if not exists fixed_date date;

create temporary table deliverable_schedule_normalization on commit drop as
select
  task.id,
  task.project_id,
  task.task_type,
  task.start_date,
  task.end_date,
  task.deadline,
  case
    when trim(coalesce(task.deadline, '')) ~ '^\d{4}-\d{2}-\d{2}$'
      and pg_input_is_valid(trim(task.deadline), 'date')
      then trim(task.deadline)
    else null
  end as candidate_text
from public.tasks as task
where task.start_date is not null
   or task.end_date is not null
   or task.deadline is not null;

alter table deliverable_schedule_normalization
  add column candidate_date date;

update deliverable_schedule_normalization
set candidate_date = candidate_text::date
where candidate_text is not null;

alter table deliverable_schedule_normalization
  add column is_sprint_boundary boolean not null default false,
  add column is_sprint_reference boolean not null default false,
  add column classification text,
  add column reason text,
  add column migrated_fixed_date date;

update deliverable_schedule_normalization as legacy
set is_sprint_boundary = exists (
      select 1
      from public.sprints as sprint
      where sprint.project_id = legacy.project_id
        and legacy.candidate_date in (sprint.start_date, sprint.end_date)
    ),
    is_sprint_reference = exists (
      select 1
      from public.sprints as sprint
      where sprint.project_id = legacy.project_id
        and lower(trim(coalesce(legacy.deadline, ''))) in (lower(sprint.id), lower(sprint.name))
    );

update deliverable_schedule_normalization
set classification = case
      when task_type <> 'deliverable' then 'non_deliverable_legacy_value'
      when candidate_date is not null and is_sprint_boundary then 'sprint_boundary_date'
      when candidate_date is not null then 'fixed_date_migrated'
      when is_sprint_reference then 'sprint_reference'
      when nullif(trim(coalesce(deadline, '')), '') is not null
        and lower(trim(deadline)) ~ '(sprint|woche|kw|heute|morgen|gestern|vorher|nachher|relativ)'
        then 'relative_value'
      when nullif(trim(coalesce(deadline, '')), '') is not null then 'ambiguous_text'
      else 'legacy_period_removed'
    end,
    reason = case
      when task_type <> 'deliverable' then 'Only deliverables may have a fixed date.'
      when candidate_date is not null and is_sprint_boundary then 'The date matches a sprint boundary and is not an unambiguous fixed date.'
      when candidate_date is not null then 'The valid ISO calendar date was migrated to fixed_date.'
      when is_sprint_reference then 'Sprint references are not calendar dates.'
      when nullif(trim(coalesce(deadline, '')), '') is not null
        and lower(trim(deadline)) ~ '(sprint|woche|kw|heute|morgen|gestern|vorher|nachher|relativ)'
        then 'Relative schedule text is not a calendar date.'
      when nullif(trim(coalesce(deadline, '')), '') is not null then 'The legacy value is not an unambiguous ISO calendar date.'
      else 'Deliverable execution periods now come exclusively from the assigned sprint.'
    end,
    migrated_fixed_date = case
      when task_type = 'deliverable' and candidate_date is not null and not is_sprint_boundary
        then candidate_date
      else null
    end;

insert into public.audit_log (
  entity_type,
  entity_id,
  action,
  before_data,
  after_data
)
select
  'task',
  legacy.id,
  'task.schedule_legacy_normalized',
  jsonb_build_object(
    'startDate', legacy.start_date,
    'endDate', legacy.end_date,
    'deadline', legacy.deadline
  ),
  jsonb_strip_nulls(jsonb_build_object(
    'classification', legacy.classification,
    'reason', legacy.reason,
    'fixedDate', legacy.migrated_fixed_date,
    'suggestedFixedDate', case when legacy.classification = 'sprint_boundary_date' then legacy.candidate_date end
  ))
from deliverable_schedule_normalization as legacy;

select set_config('founderops.trash_lifecycle_write', 'on', true);

update public.tasks as task
set fixed_date = legacy.migrated_fixed_date,
    start_date = null,
    end_date = null,
    deadline = null,
    updated_at = clock_timestamp()
from deliverable_schedule_normalization as legacy
where task.id = legacy.id;

alter table public.tasks
  drop constraint if exists tasks_fixed_date_deliverable_check,
  add constraint tasks_fixed_date_deliverable_check
    check (fixed_date is null or task_type = 'deliverable'),
  drop constraint if exists tasks_legacy_schedule_empty_check,
  add constraint tasks_legacy_schedule_empty_check
    check (start_date is null and end_date is null and deadline is null);

comment on column public.tasks.fixed_date is
  'Optional fixed calendar date for a Deliverable. Its execution period is derived exclusively from the assigned Sprint.';

alter table public.team_task_intake_batches
  alter column contract_version set default 3,
  drop constraint if exists team_task_intake_batches_contract_version_check,
  add constraint team_task_intake_batches_contract_version_check
    check (contract_version = any (array[1, 2, 3]));

alter table public.team_planning_item_update_requests
  alter column contract_version set default 3,
  drop constraint if exists team_planning_item_update_requests_contract_version_check,
  add constraint team_planning_item_update_requests_contract_version_check
    check (contract_version = any (array[1, 2, 3]));

alter table public.team_planning_item_delete_requests
  alter column contract_version set default 3,
  drop constraint if exists team_planning_item_delete_requests_contract_version_check,
  add constraint team_planning_item_delete_requests_contract_version_check
    check (contract_version = any (array[1, 2, 3]));

-- Keep every task write path on the canonical Deliverable Schedule persistence seam.
CREATE OR REPLACE FUNCTION "public"."create_task_transaction"("p_task_insert" "jsonb", "p_relation_type" "text" DEFAULT NULL::"text", "p_related_task_id" "text" DEFAULT NULL::"text", "p_relation_note" "text" DEFAULT NULL::"text", "p_activity_message" "text" DEFAULT 'Task created'::"text", "p_relation_activity_message" "text" DEFAULT NULL::"text", "p_notifications" "jsonb" DEFAULT '[]'::"jsonb", "p_actor_profile_id" "text" DEFAULT NULL::"text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
    'fixed_date',
    'definition_of_done',
    'description',
    'dod_template_version',
    'estimate_hours',
    'evidence_link',
    'evidence_required',
    'github_issue_number',
    'github_issue_url',
    'github_repo',
    'github_issue_sync_status',
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
        'githubIssueSyncStatus', related.github_issue_sync_status,
        'githubIssueSyncError', coalesce(related.github_issue_sync_error, ''),
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
    set github_issue_sync_status = 'not_synced',
        github_issue_sync_error = null,
        updated_at = clock_timestamp()
    where id = p_related_task_id
    returning jsonb_build_object(
      'id', related.id,
      'githubIssueSyncStatus', related.github_issue_sync_status,
      'githubIssueSyncError', coalesce(related.github_issue_sync_error, ''),
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
$_$;

CREATE OR REPLACE FUNCTION "public"."create_team_planning_items_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_idempotency_key" "uuid", "p_request_hash" "text", "p_items" "jsonb", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_batch public.team_task_intake_batches%rowtype;
  v_role text;
  v_item jsonb;
  v_index integer;
  v_type text;
  v_id text;
  v_title text;
  v_owner text;
  v_parent_id text;
  v_parent public.tasks%rowtype;
  v_status text;
  v_sort_order integer;
  v_raci jsonb := '[]'::jsonb;
  v_result jsonb;
  v_entity jsonb;
  v_task_insert jsonb;
  v_ids text[] := array[]::text[];
  v_entities jsonb := '[]'::jsonb;
begin
  if p_token_id is null
     or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or p_idempotency_key is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$'
     or p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception using errcode = '22023', message = 'planning items create input is invalid';
  end if;

  select * into v_token
  from public.team_task_intake_tokens
  where id = p_token_id
    and profile_id = p_profile_id
    and revoked_at is null
    and expires_at > now()
  for update;
  if not found then raise exception using errcode = 'P0004', message = 'planning items token is inactive'; end if;
  if not ('write:planning-items:create' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning items create scope is missing';
  end if;

  select platform_role into v_role from public.profiles where id = p_profile_id for share;
  if not found or v_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'planning items profile role is not allowed';
  end if;
  if v_role not in ('ceo', 'deputy') and exists (
    select 1
    from jsonb_array_elements(p_items) item(value)
    where item.value->>'itemType' in ('epic', 'milestone', 'initiative')
  ) then
    raise exception using errcode = 'P0006', message = 'strategic planning item creation requires ceo or deputy';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('planning-items-create:' || p_token_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_batch
  from public.team_task_intake_batches
  where token_id = p_token_id and idempotency_key = p_idempotency_key;
  if found then
    if v_batch.request_hash <> p_request_hash then
      raise exception using errcode = 'P0003', message = 'idempotency key conflict';
    end if;
    return jsonb_build_object('batchId', v_batch.id, 'replayed', true, 'items', v_batch.response_tasks);
  end if;

  for v_item, v_index in
    select value, ordinality::integer from jsonb_array_elements(p_items) with ordinality
  loop
    v_type := case nullif(trim(v_item->>'itemType'), '') when 'milestone' then 'epic' else nullif(trim(v_item->>'itemType'), '') end;
    v_id := p_profile_id || '-planning-items-v1-' || replace(p_idempotency_key::text, '-', '') || '-' || v_index::text;
    v_title := nullif(trim(coalesce(v_item->>'title', '')), '');
    v_owner := nullif(trim(coalesce(v_item->>'ownerId', '')), '');
    v_parent_id := nullif(trim(coalesce(v_item->>'parentTaskId', '')), '');
    v_status := coalesce(nullif(trim(v_item->>'status'), ''), 'Offen');

    if v_type not in ('epic', 'initiative', 'deliverable', 'sub_issue')
       or v_title is null then
      raise exception using errcode = '22023', message = 'planning items item type or title is invalid';
    end if;
    if v_type in ('epic', 'initiative') and v_owner is null then
      raise exception using errcode = '22023', message = 'strategic planning item owner is required';
    end if;
    if v_owner is null then v_owner := p_profile_id; end if;
    if not exists (select 1 from public.profiles where id = v_owner) then
      raise exception using errcode = '23503', message = 'planning item owner was not found';
    end if;
    if (v_type in ('epic', 'initiative') and v_status not in ('Offen', 'In Arbeit', 'Pausiert', 'Blockiert', 'Erledigt'))
       or (v_type = 'deliverable' and v_status not in ('Offen', 'In Arbeit', 'Review', 'Nacharbeit', 'Blockiert', 'Erledigt'))
       or (v_type = 'sub_issue' and v_status not in ('Offen', 'In Arbeit', 'Blockiert', 'Erledigt')) then
      raise exception using errcode = '22023', message = 'planning item status is invalid';
    end if;
    if v_type in ('epic', 'initiative') and v_item ? 'githubSync' then
      raise exception using errcode = '22023', message = 'strategic planning items do not support GitHub sync';
    end if;

    if v_type = 'epic' and v_parent_id is not null then
      raise exception using errcode = '23514', message = 'epic cannot have a parent';
    end if;
    if v_type = 'initiative' and v_parent_id is not null then
      select * into v_parent from public.tasks where id = v_parent_id and trashed_at is null for share;
      if not found or v_parent.task_type <> 'epic' then
        raise exception using errcode = '23514', message = 'initiative parent must be an active epic';
      end if;
    end if;
    if v_type = 'deliverable' and v_parent_id is not null then
      select * into v_parent from public.tasks where id = v_parent_id and trashed_at is null for share;
      if not found or v_parent.task_type <> 'initiative' then
        raise exception using errcode = '23514', message = 'deliverable parent must be an active initiative';
      end if;
      if v_parent.approval_status = 'rejected' then
        raise exception using errcode = '23514', message = 'deliverable parent initiative is rejected';
      end if;
    end if;
    if v_type = 'sub_issue' then
      if v_parent_id is null then
        raise exception using errcode = '23514', message = 'sub-issue requires a deliverable parent';
      end if;
      select * into v_parent from public.tasks where id = v_parent_id and trashed_at is null for share;
      if not found or v_parent.task_type <> 'deliverable' or v_parent.approval_status <> 'approved' then
        raise exception using errcode = '23514', message = 'sub-issue parent must be an approved deliverable';
      end if;
    end if;

    perform pg_advisory_xact_lock(hashtextextended('planning-sort:' || v_type, 0));
    select coalesce(max(sort_order) + 1, 1) into v_sort_order
    from public.tasks
    where project_id = 'findmydoc-founder-execution'
      and task_type = v_type
      and trashed_at is null;

    if v_type in ('epic', 'initiative') then
      select coalesce(jsonb_agg(assignment order by assignment->>'role', (assignment->>'sortOrder')::integer), '[]'::jsonb)
      into v_raci
      from (
        select jsonb_build_object('profileId', nullif(v_item->>'accountableProfileId', ''), 'role', 'accountable', 'sortOrder', 0) as assignment
        where nullif(v_item->>'accountableProfileId', '') is not null
        union all
        select jsonb_build_object('profileId', value, 'role', 'responsible', 'sortOrder', ordinality::integer - 1)
        from jsonb_array_elements_text(coalesce(v_item->'responsibleProfileIds', '[]'::jsonb)) with ordinality
        union all
        select jsonb_build_object('profileId', value, 'role', 'consulted', 'sortOrder', ordinality::integer - 1)
        from jsonb_array_elements_text(coalesce(v_item->'consultedProfileIds', '[]'::jsonb)) with ordinality
        union all
        select jsonb_build_object('profileId', value, 'role', 'informed', 'sortOrder', ordinality::integer - 1)
        from jsonb_array_elements_text(coalesce(v_item->'informedProfileIds', '[]'::jsonb)) with ordinality
      ) assignments;
      v_result := public.create_planning_item_transaction(
        jsonb_build_object(
          'id', v_id,
          'project_id', 'findmydoc-founder-execution',
          'task_type', v_type,
          'title', v_title,
          'description', coalesce(v_item->>'description', ''),
          'status', v_status,
          'priority', case when v_type = 'initiative' then coalesce(nullif(v_item->>'priority', ''), 'P2') else null end,
          'owner', v_owner,
          'assignee', v_owner,
          'parent_task_id', v_parent_id,
          'target_date', nullif(v_item->>'targetDate', ''),
          'sort_order', v_sort_order
        ),
        case when v_type = 'initiative' then jsonb_build_object(
          'goal', coalesce(nullif(v_item->>'intendedOutcome', ''), v_item->>'description', ''),
          'successCriteria', coalesce(v_item->>'acceptanceCriteria', ''),
          'scopeConstraints', coalesce(v_item->>'scopeConstraints', '')
        ) else null end,
        case when v_type = 'initiative' then v_raci else '[]'::jsonb end,
        p_profile_id
      );
      v_entity := v_result->'task';
      if v_type = 'initiative' then
        v_entity := v_entity || jsonb_build_object(
          'goal', coalesce(nullif(v_item->>'intendedOutcome', ''), v_item->>'description', ''),
          'success_criteria', coalesce(v_item->>'acceptanceCriteria', ''),
          'scope_constraints', coalesce(v_item->>'scopeConstraints', ''),
          'raci_assignments', v_raci
        );
      end if;
    else
      v_task_insert := jsonb_build_object(
        'id', v_id,
        'creation_request_id', 'planning-items:' || p_token_id::text || ':' || p_idempotency_key::text || ':' || v_index::text,
        'project_id', 'findmydoc-founder-execution',
        'title', v_title,
        'description', coalesce(v_item->>'description', ''),
        'problem_statement', coalesce(v_item->>'problemStatement', ''),
        'intended_outcome', coalesce(v_item->>'intendedOutcome', ''),
        'scope_constraints', coalesce(v_item->>'scopeConstraints', ''),
        'acceptance_criteria', coalesce(v_item->>'acceptanceCriteria', ''),
        'evidence_required', coalesce(v_item->>'evidenceRequired', ''),
        'definition_of_done', coalesce(v_item->>'definitionOfDone', ''),
        'status', v_status,
        'priority', case when v_type = 'sub_issue' then 'P2' else coalesce(nullif(v_item->>'priority', ''), 'P2') end,
        'owner', v_owner,
        'assignee', v_owner,
        'created_by', p_profile_id,
        'workstream', coalesce(v_item->>'workstream', ''),
        'sort_order', v_sort_order,
        'fixed_date', nullif(v_item->>'fixedDate', ''),
        'estimate_hours', case when coalesce(v_item->>'hours', '') ~ '^[0-9]+$' then (v_item->>'hours')::integer else 0 end,
        'sprint_id', null,
        'review_status', 'not_requested',
        'score_points', 0,
        'score_final', false,
        'github_repo', coalesce(nullif(v_item->>'githubRepo', ''), 'findmydoc-platform/management'),
        'task_type', v_type,
        'parent_task_id', v_parent_id,
        'approval_status', case when v_type = 'deliverable' then 'proposed' else null end,
        'approval_revision', 1,
        'proposed_by', case when v_type = 'deliverable' then p_profile_id else null end,
        'proposed_at', case when v_type = 'deliverable' then now() else null end,
        'score_relevant', false
      );
      v_result := public.create_planning_task_transaction(
        v_task_insert, null, null, null,
        case when v_type = 'sub_issue' then 'Sub-Issue created through Planning Items API' else 'Deliverable proposed through Planning Items API' end,
        null, '[]'::jsonb, p_profile_id, p_request_ip, p_user_agent, false
      );
      v_entity := v_result->'task';
    end if;

    v_ids := array_append(v_ids, v_id);
    v_entities := v_entities || jsonb_build_array(jsonb_build_object('itemType', v_type, 'item', v_entity));
  end loop;

  insert into public.team_task_intake_batches (token_id, profile_id, idempotency_key, request_hash, task_ids, response_tasks)
  values (p_token_id, p_profile_id, p_idempotency_key, p_request_hash, v_ids, v_entities)
  returning * into v_batch;
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, after_data, request_ip, user_agent)
  values (p_profile_id, 'team.planning_items.create', 'team_planning_items_batch', v_batch.id::text,
    jsonb_build_object('tokenId', p_token_id, 'entityIds', v_ids), p_request_ip, p_user_agent);
  return jsonb_build_object('batchId', v_batch.id, 'replayed', false, 'items', v_entities);
end;
$_$;

CREATE OR REPLACE FUNCTION "public"."lock_sprint_transaction"("p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_updates" "jsonb" DEFAULT '[]'::"jsonb", "p_accepted_blocker_task_ids" "text"[] DEFAULT '{}'::"text"[], "p_carryover_inserts" "jsonb" DEFAULT '[]'::"jsonb", "p_notifications" "jsonb" DEFAULT '[]'::"jsonb", "p_score_rows" "jsonb" DEFAULT '[]'::"jsonb", "p_strike_state_rows" "jsonb" DEFAULT '[]'::"jsonb", "p_strike_events" "jsonb" DEFAULT '[]'::"jsonb", "p_result_data" "jsonb" DEFAULT '{}'::"jsonb", "p_actor_profile_id" "text" DEFAULT NULL::"text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_sprint public.sprints%rowtype;
  v_result jsonb;
  v_insert jsonb;
  v_columns text;
  v_values text;
  v_allowed_columns constant text[] := array[
    'acceptance_criteria', 'assignee', 'carryover_count', 'carryover_reason',
    'carried_from_sprint_id', 'carried_from_task_id', 'created_by', 'creation_request_id',
    'fixed_date', 'definition_of_done', 'description', 'dod_template_version',
    'estimate_hours', 'evidence_link', 'evidence_required', 'github_issue_number',
    'github_issue_url', 'github_repo', 'github_issue_sync_status', 'id', 'intended_outcome',
    'issue_number', 'issue_url', 'milestone_id', 'original_sprint_id', 'owner',
    'package_id', 'parent_task_id', 'priority', 'problem_statement', 'project_id',
    'review_owner_profile_id', 'review_status', 'score_final', 'score_points',
    'score_relevant', 'scope_constraints', 'sort_order', 'sprint_id',
    'status', 'task_type', 'title', 'workstream'
  ];
begin
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'expected sprint update timestamp is required';
  end if;
  if jsonb_typeof(coalesce(p_task_updates, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_carryover_inserts, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_score_rows, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_strike_state_rows, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_strike_events, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'sprint finalization batches must be JSON arrays';
  end if;

  select * into v_sprint
  from public.sprints
  where id = p_sprint_id
  for update;

  if v_sprint.id is null then
    raise exception using errcode = 'P0002', message = 'sprint not found';
  end if;
  if v_sprint.score_locked then
    return coalesce(v_sprint.lock_result, '{}'::jsonb) || jsonb_build_object('replayed', true);
  end if;
  if v_sprint.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'sprint was changed concurrently';
  end if;

  update public.tasks as task
  set score_points = requested.score_points,
      score_final = requested.score_final,
      sprint_outcome = requested.sprint_outcome,
      carryover_reason = requested.carryover_reason,
      github_issue_sync_status = requested.github_issue_sync_status,
      github_issue_sync_error = requested.github_issue_sync_error,
      updated_at = clock_timestamp()
  from jsonb_to_recordset(coalesce(p_task_updates, '[]'::jsonb)) as requested(
    id text,
    score_points integer,
    score_final boolean,
    sprint_outcome text,
    carryover_reason text,
    github_issue_sync_status text,
    github_issue_sync_error text
  )
  where task.id = requested.id
    and task.sprint_id = p_sprint_id;

  update public.task_blockers
  set status = 'accepted_carryover',
      resolved_at = coalesce(resolved_at, clock_timestamp())
  where task_id = any(coalesce(p_accepted_blocker_task_ids, '{}'))
    and status = 'open';

  for v_insert in select value from jsonb_array_elements(coalesce(p_carryover_inserts, '[]'::jsonb))
  loop
    if jsonb_typeof(v_insert) <> 'object' or exists (
      select 1
      from jsonb_object_keys(v_insert) as insert_key
      where not (insert_key = any(v_allowed_columns))
    ) then
      raise exception using errcode = '22023', message = 'carryover task insert is invalid';
    end if;

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
      'insert into public.tasks (%s) select %s',
      v_columns,
      v_values
    ) using v_insert;
  end loop;

  insert into public.notification_events (
    type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body
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

  update public.tasks
  set score_points = 0,
      score_final = true,
      sprint_outcome = 'missed_uncommunicated',
      updated_at = clock_timestamp()
  where sprint_id = p_sprint_id
    and score_final = false;

  insert into public.founder_sprint_scores (
    sprint_id, profile_id, delivery_points, form_points, weekly_points, total_points,
    fulfilled, away_neutral, finalized_at, finalized_by, reason_summary
  )
  select
    score.sprint_id, score.profile_id, score.delivery_points, score.form_points,
    score.weekly_points, score.total_points, score.fulfilled, score.away_neutral,
    score.finalized_at, score.finalized_by, score.reason_summary
  from jsonb_to_recordset(coalesce(p_score_rows, '[]'::jsonb)) as score(
    sprint_id text, profile_id text, delivery_points integer, form_points integer,
    weekly_points integer, total_points integer, fulfilled boolean, away_neutral boolean,
    finalized_at timestamptz, finalized_by text, reason_summary text
  )
  on conflict (sprint_id, profile_id) do update
  set delivery_points = excluded.delivery_points,
      form_points = excluded.form_points,
      weekly_points = excluded.weekly_points,
      total_points = excluded.total_points,
      fulfilled = excluded.fulfilled,
      away_neutral = excluded.away_neutral,
      finalized_at = excluded.finalized_at,
      finalized_by = excluded.finalized_by,
      reason_summary = excluded.reason_summary;

  insert into public.founder_strike_state (
    profile_id, strike_level, fulfilled_reset_streak, last_evaluated_sprint_id, updated_at
  )
  select
    state.profile_id, state.strike_level, state.fulfilled_reset_streak,
    state.last_evaluated_sprint_id, state.updated_at
  from jsonb_to_recordset(coalesce(p_strike_state_rows, '[]'::jsonb)) as state(
    profile_id text, strike_level integer, fulfilled_reset_streak integer,
    last_evaluated_sprint_id text, updated_at timestamptz
  )
  on conflict (profile_id) do update
  set strike_level = excluded.strike_level,
      fulfilled_reset_streak = excluded.fulfilled_reset_streak,
      last_evaluated_sprint_id = excluded.last_evaluated_sprint_id,
      updated_at = excluded.updated_at;

  insert into public.strike_events (
    profile_id, sprint_id, event_type, previous_strike_level,
    next_strike_level, reason, created_by
  )
  select
    event.profile_id, event.sprint_id, event.event_type, event.previous_strike_level,
    event.next_strike_level, event.reason, event.created_by
  from jsonb_to_recordset(coalesce(p_strike_events, '[]'::jsonb)) as event(
    profile_id text, sprint_id text, event_type text, previous_strike_level integer,
    next_strike_level integer, reason text, created_by text
  );

  v_result := coalesce(p_result_data, '{}'::jsonb) || jsonb_build_object(
    'sprint', jsonb_build_object('id', p_sprint_id, 'status', 'closed', 'scoreLocked', true),
    'replayed', false
  );

  update public.sprints
  set score_locked = true,
      status = 'closed',
      lock_result = v_result,
      updated_at = clock_timestamp()
  where id = p_sprint_id;

  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id, after_data, request_ip, user_agent
  )
  values (
    p_actor_profile_id, 'sprint.lock_score', 'sprint', p_sprint_id,
    v_result, p_request_ip, p_user_agent
  );

  return v_result;
end;
$_$;

CREATE OR REPLACE FUNCTION "public"."update_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb" DEFAULT '{}'::"jsonb", "p_note_present" boolean DEFAULT false, "p_note" "text" DEFAULT NULL::"text", "p_dependency_present" boolean DEFAULT false, "p_dependency_note" "text" DEFAULT NULL::"text", "p_activity_messages" "text"[] DEFAULT '{}'::"text"[], "p_notifications" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_patch jsonb := coalesce(p_task_patch, '{}'::jsonb);
  v_allowed_columns constant text[] := array[
    'acceptance_criteria',
    'assignee',
    'fixed_date',
    'definition_of_done',
    'evidence_link',
    'evidence_required',
    'github_issue_sync_error',
    'github_issue_sync_status',
    'intended_outcome',
    'milestone_id',
    'owner',
    'package_id',
    'priority',
    'problem_statement',
    'review_owner_profile_id',
    'review_requested_at',
    'review_status',
    'score_final',
    'score_points',
    'score_relevant',
    'self_blockers_checked',
    'self_dod_checked',
    'self_documented_checked',
    'self_evidence_checked',
    'scope_constraints',
    'sprint_id',
    'status',
    'task_type'
  ];
  v_assignments text;
  v_task jsonb;
  v_activities jsonb := '[]'::jsonb;
begin
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'expected task update timestamp is required';
  end if;

  if jsonb_typeof(v_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'task patch must be a JSON object';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(v_patch) as patch_key
    where not (patch_key = any(v_allowed_columns))
  ) then
    raise exception using errcode = '22023', message = 'task patch contains unsupported columns';
  end if;

  if jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'task notifications must be a JSON array';
  end if;

  if exists (select 1 from jsonb_object_keys(v_patch)) then
    select string_agg(
      format(
        '%1$I = (jsonb_populate_record(null::public.tasks, to_jsonb(task) || $1)).%1$I',
        patch_key
      ),
      ', '
      order by patch_key
    )
    into v_assignments
    from jsonb_object_keys(v_patch) as patch_key;

    execute format(
      'update public.tasks as task set %s, updated_at = clock_timestamp() where task.id = $2 and task.updated_at = $3 returning to_jsonb(task)',
      v_assignments
    )
    into v_task
    using v_patch, p_task_id, p_expected_updated_at;
  else
    update public.tasks as task
    set updated_at = clock_timestamp()
    where task.id = p_task_id
      and task.updated_at = p_expected_updated_at
    returning to_jsonb(task) into v_task;
  end if;

  if v_task is null then
    if exists (select 1 from public.tasks where id = p_task_id) then
      raise exception using errcode = 'P0001', message = 'task was changed concurrently';
    end if;
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  if p_note_present then
    insert into public.task_notes (task_id, note, updated_at)
    values (p_task_id, coalesce(p_note, ''), now())
    on conflict (task_id) do update
      set note = excluded.note,
          updated_at = excluded.updated_at;
  end if;

  if p_dependency_present then
    delete from public.task_dependencies where task_id = p_task_id;
    if nullif(trim(coalesce(p_dependency_note, '')), '') is not null then
      insert into public.task_dependencies (task_id, note)
      values (p_task_id, left(trim(p_dependency_note), 2000));
    end if;
  end if;

  with inserted as (
    insert into public.task_activity (task_id, message)
    select p_task_id, message
    from unnest(coalesce(p_activity_messages, '{}')) as message
    where nullif(trim(message), '') is not null
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

  return jsonb_build_object(
    'task', v_task,
    'activities', v_activities
  );
end;
$_$;

CREATE OR REPLACE FUNCTION "public"."update_team_planning_item_transaction_without_completed_guard"("p_token_id" "uuid", "p_profile_id" "text", "p_item_type" "text", "p_item_id" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_patch" "jsonb" DEFAULT '{}'::"jsonb", "p_changed_fields" "jsonb" DEFAULT '[]'::"jsonb", "p_system_effects" "jsonb" DEFAULT '[]'::"jsonb", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_request public.team_planning_item_update_requests%rowtype;
  v_role text;
  v_type text := case nullif(trim(coalesce(p_item_type, '')), '') when 'milestone' then 'epic' else nullif(trim(coalesce(p_item_type, '')), '') end;
  v_task public.tasks%rowtype;
  v_updated_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_review_owner text;
  v_review_owner_role text;
  v_review_status text;
  v_review_requested_at timestamptz;
  v_score_points integer;
  v_score_final boolean;
  v_sprint_locked boolean := false;
  v_parent_review_locked boolean := false;
  v_review_request_started boolean := false;
  v_response jsonb;
  v_before jsonb;
  v_strategy jsonb;
  v_raci jsonb;
  v_allowed text[];
  v_status text;
begin
  if p_token_id is null
     or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or v_type not in ('epic', 'initiative', 'deliverable', 'sub_issue')
     or nullif(trim(coalesce(p_item_id, '')), '') is null
     or p_expected_updated_at is null
     or p_idempotency_key is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_changed_fields, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_system_effects, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'planning items update input is invalid';
  end if;

  select * into v_token from public.team_task_intake_tokens
  where id = p_token_id and profile_id = p_profile_id and revoked_at is null and expires_at > now()
  for update;
  if not found then raise exception using errcode = 'P0004', message = 'planning items token is inactive'; end if;
  if not ('write:planning-items:update' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning items update scope is missing';
  end if;
  select platform_role into v_role from public.profiles where id = p_profile_id for share;
  if not found or v_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'planning items profile role is not allowed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('planning-items-update:' || p_token_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_request from public.team_planning_item_update_requests
  where token_id = p_token_id and idempotency_key = p_idempotency_key;
  if found then
    if v_request.request_hash <> p_request_hash then
      raise exception using errcode = 'P0003', message = 'idempotency key conflict';
    end if;
    return jsonb_set(v_request.response, '{replayed}', 'true'::jsonb, true);
  end if;

  select * into v_task from public.tasks
  where id = p_item_id and project_id = 'findmydoc-founder-execution' and trashed_at is null
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  if v_task.task_type <> v_type then raise exception using errcode = '22023', message = 'planning item type does not match'; end if;
  if v_task.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;
  if v_type = 'epic' and v_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'epic update requires ceo or deputy';
  end if;
  if v_role = 'founder' and v_type = 'initiative' and v_task.owner <> p_profile_id then
    raise exception using errcode = 'P0007', message = 'founder may only update owned initiatives';
  end if;
  if v_role = 'founder' and v_type in ('deliverable', 'sub_issue')
     and v_task.owner <> p_profile_id and v_task.assignee <> p_profile_id
     and not (v_type = 'sub_issue' and p_patch ? 'status' and p_patch - 'status' = '{}'::jsonb) then
    raise exception using errcode = 'P0007', message = 'founder may only update owned planning tasks';
  end if;

  v_allowed := case v_type
    when 'epic' then array['title', 'description', 'status', 'target_date']
    when 'initiative' then array['title', 'description', 'status', 'priority', 'owner', 'assignee', 'target_date', 'parent_task_id', 'strategy', 'raciAssignments']
    when 'deliverable' then array['title', 'description', 'status', 'priority', 'owner', 'assignee', 'parent_task_id', 'workstream', 'fixed_date', 'estimate_hours', 'problem_statement', 'intended_outcome', 'scope_constraints', 'acceptance_criteria', 'evidence_required', 'definition_of_done']
    else array['title', 'description', 'status', 'owner', 'assignee', 'parent_task_id', 'problem_statement', 'intended_outcome', 'scope_constraints', 'acceptance_criteria', 'evidence_required', 'definition_of_done', 'github_repo']
  end;
  if exists (select 1 from jsonb_object_keys(p_patch) key where not (key = any(v_allowed))) then
    raise exception using errcode = '22023', message = 'planning item patch contains an unsupported field';
  end if;
  if v_type in ('deliverable', 'sub_issue') and p_patch ? 'parent_task_id'
     and (select count(*) from jsonb_object_keys(p_patch)) > 1 then
    raise exception using errcode = '23514', message = 'planning item parent must be changed separately';
  end if;
  if p_patch ? 'status' then
    v_status := nullif(trim(p_patch->>'status'), '');
    if (v_type in ('epic', 'initiative') and v_status not in ('Offen', 'In Arbeit', 'Pausiert', 'Blockiert', 'Erledigt'))
       or (v_type = 'deliverable' and v_status not in ('Offen', 'In Arbeit', 'Review', 'Nacharbeit', 'Blockiert', 'Erledigt'))
       or (v_type = 'sub_issue' and v_status not in ('Offen', 'In Arbeit', 'Blockiert', 'Erledigt')) then
      raise exception using errcode = '22023', message = 'planning item status is invalid';
    end if;
    if v_status is distinct from v_task.status and v_type = 'deliverable' then
      if v_status = 'Erledigt' and v_role <> 'ceo' then
        raise exception using errcode = 'P0007', message = 'only ceo may complete a deliverable finally';
      end if;
      if v_task.status = 'Erledigt' and v_status <> 'Erledigt' and v_role <> 'ceo' then
        raise exception using errcode = 'P0007', message = 'only ceo may reopen a completed deliverable';
      end if;
      if v_role = 'founder' and v_task.status = 'Nacharbeit' and v_status not in ('In Arbeit', 'Review', 'Blockiert') then
        raise exception using errcode = 'P0007', message = 'founder may only resume, block, or review rework';
      end if;
    end if;
  end if;
  if p_patch ? 'parent_task_id' and nullif(trim(coalesce(p_patch->>'parent_task_id', '')), '') is not null then
    select * into v_parent from public.tasks where id = nullif(trim(p_patch->>'parent_task_id'), '') and trashed_at is null for share;
    if not found
       or (v_type = 'initiative' and v_parent.task_type <> 'epic')
       or (v_type = 'deliverable' and (v_parent.task_type <> 'initiative' or v_parent.approval_status = 'rejected'))
       or (v_type = 'sub_issue' and (v_parent.task_type <> 'deliverable' or v_parent.approval_status <> 'approved')) then
      raise exception using errcode = '23514', message = 'planning item parent has the wrong type or approval state';
    end if;
  elsif v_type = 'sub_issue' and p_patch ? 'parent_task_id' then
    raise exception using errcode = '23514', message = 'sub-issue requires a deliverable parent';
  end if;

  if v_type = 'sub_issue' then
    select * into v_parent
    from public.tasks
    where id = coalesce(nullif(trim(coalesce(p_patch->>'parent_task_id', '')), ''), v_task.parent_task_id)
      and trashed_at is null
    for share;
    if not found or v_parent.task_type <> 'deliverable' or v_parent.approval_status <> 'approved' then
      raise exception using errcode = 'P0008', message = 'sub-issue parent must be an approved deliverable';
    end if;
    v_parent_review_locked := (v_parent.review_status = 'requested' and not coalesce(v_parent.score_final, false))
      or (v_parent.review_status = 'accepted' and coalesce(v_parent.score_final, false));
    if v_parent_review_locked and p_patch <> '{}'::jsonb then
      raise exception using errcode = '23514', message = 'parent deliverable review is locked';
    end if;
  end if;

  if v_type = 'deliverable'
     and p_patch <> '{}'::jsonb
     and ((v_task.review_status = 'requested' and not coalesce(v_task.score_final, false))
       or (v_task.review_status = 'accepted' and coalesce(v_task.score_final, false))) then
    raise exception using errcode = '23514', message = 'deliverable review is locked';
  end if;

  v_review_owner := v_task.review_owner_profile_id;
  v_review_status := v_task.review_status;
  v_review_requested_at := v_task.review_requested_at;
  v_score_points := v_task.score_points;
  v_score_final := v_task.score_final;
  if v_type = 'deliverable' and p_patch ? 'status' and p_patch->>'status' = 'Review' then
    if v_task.approval_status <> 'approved' then
      raise exception using errcode = '23514', message = 'only approved deliverables can enter review';
    end if;
    if v_task.score_final then
      raise exception using errcode = '23514', message = 'final deliverable must use review reopen';
    end if;
    if v_task.sprint_id is not null then
      select coalesce(score_locked, false) into v_sprint_locked from public.sprints where id = v_task.sprint_id;
      if v_sprint_locked then
        raise exception using errcode = '23514', message = 'sprint score is locked';
      end if;
    end if;
    if v_review_owner is null and v_task.parent_task_id is not null then
      select profile_id into v_review_owner
      from public.planning_item_raci_assignments
      where task_id = v_task.parent_task_id and role = 'accountable'
      order by sort_order, profile_id
      limit 1;
    end if;
    if v_review_owner is null and v_task.parent_task_id is not null then
      select owner into v_review_owner from public.tasks where id = v_task.parent_task_id;
    end if;
    if v_review_owner is null then
      raise exception using errcode = '23514', message = 'review owner is required';
    end if;
    select platform_role into v_review_owner_role from public.profiles where id = v_review_owner for share;
    if v_review_owner_role is null or v_review_owner_role = 'viewer' then
      raise exception using errcode = '23514', message = 'review owner must have a contributor role';
    end if;
    v_review_status := 'requested';
    v_review_requested_at := clock_timestamp();
    v_score_points := 0;
    v_score_final := false;
    v_review_request_started := true;
  elsif v_type = 'deliverable' and p_patch ? 'status' and v_task.status = 'Erledigt' and p_patch->>'status' <> 'Erledigt' then
    v_review_status := 'not_requested';
    v_review_requested_at := null;
    v_score_final := false;
  elsif v_type = 'deliverable' and p_patch ? 'status' and v_task.status = 'Review' and p_patch->>'status' <> 'Review' then
    v_review_status := 'not_requested';
    v_review_requested_at := null;
  end if;

  v_before := to_jsonb(v_task);
  perform set_config('app.actor_profile_id', p_profile_id, true);
  if p_patch <> '{}'::jsonb then
    update public.tasks
    set title = case when p_patch ? 'title' then nullif(trim(p_patch->>'title'), '') else v_task.title end,
        description = case when p_patch ? 'description' then nullif(trim(coalesce(p_patch->>'description', '')), '') else v_task.description end,
        status = case when p_patch ? 'status' then nullif(trim(p_patch->>'status'), '') else v_task.status end,
        priority = case when v_type = 'epic' then null when p_patch ? 'priority' then nullif(trim(p_patch->>'priority'), '') else v_task.priority end,
        owner = case when p_patch ? 'owner' then nullif(trim(p_patch->>'owner'), '') else v_task.owner end,
        assignee = case when p_patch ? 'assignee' then nullif(trim(p_patch->>'assignee'), '') else v_task.assignee end,
        target_date = case when p_patch ? 'target_date' then nullif(trim(coalesce(p_patch->>'target_date', '')), '')::date else v_task.target_date end,
        parent_task_id = case when p_patch ? 'parent_task_id' then nullif(trim(coalesce(p_patch->>'parent_task_id', '')), '') else v_task.parent_task_id end,
        workstream = case when p_patch ? 'workstream' then nullif(trim(coalesce(p_patch->>'workstream', '')), '') else v_task.workstream end,
        fixed_date = case when p_patch ? 'fixed_date' then nullif(trim(coalesce(p_patch->>'fixed_date', '')), '')::date else v_task.fixed_date end,
        estimate_hours = case when p_patch ? 'estimate_hours' then coalesce((p_patch->>'estimate_hours')::integer, 0) else v_task.estimate_hours end,
        problem_statement = case when p_patch ? 'problem_statement' then nullif(trim(coalesce(p_patch->>'problem_statement', '')), '') else v_task.problem_statement end,
        intended_outcome = case when p_patch ? 'intended_outcome' then nullif(trim(coalesce(p_patch->>'intended_outcome', '')), '') else v_task.intended_outcome end,
        scope_constraints = case when p_patch ? 'scope_constraints' then nullif(trim(coalesce(p_patch->>'scope_constraints', '')), '') else v_task.scope_constraints end,
        acceptance_criteria = case when p_patch ? 'acceptance_criteria' then nullif(trim(coalesce(p_patch->>'acceptance_criteria', '')), '') else v_task.acceptance_criteria end,
        evidence_required = case when p_patch ? 'evidence_required' then nullif(trim(coalesce(p_patch->>'evidence_required', '')), '') else v_task.evidence_required end,
        definition_of_done = case when p_patch ? 'definition_of_done' then nullif(trim(coalesce(p_patch->>'definition_of_done', '')), '') else v_task.definition_of_done end,
        github_repo = case when p_patch ? 'github_repo' then nullif(trim(coalesce(p_patch->>'github_repo', '')), '') else v_task.github_repo end,
        review_status = v_review_status,
        review_owner_profile_id = v_review_owner,
        review_requested_at = v_review_requested_at,
        score_points = v_score_points,
        score_final = v_score_final,
        github_issue_sync_status = case when v_type in ('deliverable', 'sub_issue') then 'not_synced' else v_task.github_issue_sync_status end,
        github_issue_sync_error = case when v_type in ('deliverable', 'sub_issue') then null else v_task.github_issue_sync_error end,
        updated_at = clock_timestamp()
    where id = p_item_id
    returning * into v_updated_task;
  else
    v_updated_task := v_task;
  end if;

  if v_type = 'initiative' and p_patch ? 'strategy' then
    if jsonb_typeof(p_patch->'strategy') <> 'object' then
      raise exception using errcode = '22023', message = 'initiative strategy is invalid';
    end if;
    insert into public.planning_item_strategy (task_id, goal, success_criteria, scope_constraints)
    values (p_item_id, coalesce(p_patch->'strategy'->>'goal', ''), coalesce(p_patch->'strategy'->>'successCriteria', ''), coalesce(p_patch->'strategy'->>'scopeConstraints', ''))
    on conflict (task_id) do update set
      goal = excluded.goal,
      success_criteria = excluded.success_criteria,
      scope_constraints = excluded.scope_constraints;
  end if;
  if v_type = 'initiative' and p_patch ? 'raciAssignments' then
    perform public.replace_planning_item_raci_assignments(p_item_id, p_patch->'raciAssignments');
  end if;

  if p_patch ? 'status' and v_updated_task.status is distinct from v_task.status then
    insert into public.task_activity (task_id, message)
    values (p_item_id, 'Status geändert: ' || v_task.status || ' → ' || v_updated_task.status);
  end if;
  if v_review_request_started then
    insert into public.notification_events (
      type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body, dedupe_key
    ) values (
      'task.review_requested', p_profile_id, v_review_owner, 'task', p_item_id,
      'Review angefragt: ' || v_updated_task.title,
      'Diese Aufgabe wartet auf deine Accountable-Review.',
      'team-planning-review:' || p_item_id || ':' || v_review_requested_at::text
    );
  end if;
  if v_type = 'initiative' then
    select jsonb_build_object('goal', goal, 'successCriteria', success_criteria, 'scopeConstraints', scope_constraints)
    into v_strategy from public.planning_item_strategy where task_id = p_item_id;
    select coalesce(jsonb_agg(jsonb_build_object('profileId', profile_id, 'role', role, 'sortOrder', sort_order) order by role, sort_order), '[]'::jsonb)
    into v_raci from public.planning_item_raci_assignments where task_id = p_item_id;
  end if;
  v_response := jsonb_build_object(
    'replayed', false,
    'itemType', v_type,
    'item', to_jsonb(v_updated_task)
      || case when v_type = 'initiative' then jsonb_build_object(
        'goal', coalesce(v_strategy->>'goal', ''),
        'success_criteria', coalesce(v_strategy->>'successCriteria', ''),
        'scope_constraints', coalesce(v_strategy->>'scopeConstraints', ''),
        'raci_assignments', coalesce(v_raci, '[]'::jsonb)
      ) else '{}'::jsonb end,
    'changedFields', coalesce(p_changed_fields, '[]'::jsonb),
    'systemEffects', coalesce(p_system_effects, '[]'::jsonb)
  );
  insert into public.team_planning_item_update_requests (token_id, profile_id, item_type, item_id, expected_updated_at, idempotency_key, request_hash, response)
  values (p_token_id, p_profile_id, v_type, p_item_id, p_expected_updated_at, p_idempotency_key, p_request_hash, v_response);
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data, request_ip, user_agent)
  values (p_profile_id, 'team.planning_items.update', 'task', p_item_id, v_before, v_response->'item', p_request_ip, p_user_agent);
  return v_response;
end;
$_$;

CREATE OR REPLACE VIEW "public"."active_tasks" WITH ("security_invoker"='true') AS
 SELECT "id",
    "project_id",
    "title",
    "description",
    "status",
    "priority",
    "owner",
    "assignee",
    "workstream",
    "sort_order",
    "start_date",
    "end_date",
    "deadline",
    "estimate_hours",
    "definition_of_done",
    "evidence_link",
    "issue_number",
    "issue_url",
    "watched",
    "updated_at",
    "sprint_id",
    "review_status",
    "score_points",
    "score_final",
    "github_repo",
    "github_issue_number",
    "github_issue_url",
    "github_issue_sync_status",
    "github_issue_last_synced_at",
    "github_issue_sync_error",
    "task_type",
    "parent_task_id",
    "score_relevant",
    "original_sprint_id",
    "carried_from_task_id",
    "carried_from_sprint_id",
    "carryover_reason",
    "carryover_count",
    "sprint_outcome",
    "self_dod_checked",
    "self_evidence_checked",
    "self_documented_checked",
    "self_blockers_checked",
    "problem_statement",
    "intended_outcome",
    "scope_constraints",
    "acceptance_criteria",
    "evidence_required",
    "dod_template_version",
    "created_by",
    "review_owner_profile_id",
    "review_requested_at",
    "intake_source",
    "intake_status",
    "intake_decided_by",
    "intake_decided_at",
    "intake_decision_note",
    "creation_request_id",
    "creation_request_payload",
    "approval_status",
    "approval_revision",
    "proposed_by",
    "proposed_at",
    "decided_by",
    "decided_at",
    "decision_note",
    "trashed_at",
    "trashed_by",
    "trash_reason",
    "trash_cause",
    "purge_after",
    "trash_root_type",
    "trash_root_id",
    "trash_revision",
    "target_date",
    "created_at",
    "fixed_date"
   FROM "public"."tasks" "task"
  WHERE ("trashed_at" IS NULL);
