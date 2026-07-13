CREATE OR REPLACE FUNCTION public.decide_deliverable_approval_transaction(
  p_task_id text,
  p_expected_revision integer,
  p_action text,
  p_actor_profile_id text,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_task public.tasks%rowtype;
  v_initiative public.packages%rowtype;
  v_actor_role text;
  v_next_status text;
  v_before_status text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_notification_recipient_id text;
  v_trash_result jsonb;
  v_package_id text;
begin
  if p_action is null
     or p_action not in ('approve', 'reject', 'return_to_draft')
     or p_expected_revision is null
     or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'deliverable approval input is invalid';
  end if;
  if char_length(v_note) > 2000 then
    raise exception using errcode = '22023', message = 'approval decision note exceeds 2000 characters';
  end if;
  if p_action in ('reject', 'return_to_draft') and v_note is null then
    raise exception using errcode = '22023', message = 'approval decision note is required';
  end if;

  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  if not found then raise exception using errcode = 'P0006', message = 'approval actor not found'; end if;

  select package_id into v_package_id from public.tasks where id = p_task_id;
  if not found then raise exception using errcode = 'P0002', message = 'deliverable not found'; end if;

  select * into v_initiative from public.packages where id = v_package_id for share;
  if not found or v_initiative.trashed_at is not null then
    raise exception using errcode = 'P0003', message = 'deliverable requires an active initiative';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'deliverable not found'; end if;
  if v_task.package_id is distinct from v_package_id then
    raise exception using errcode = 'P0001', message = 'deliverable initiative changed';
  end if;
  if v_task.task_type <> 'deliverable' then raise exception using errcode = '22023', message = 'task is not a deliverable'; end if;
  if v_task.trashed_at is not null then raise exception using errcode = 'P0003', message = 'deliverable is trashed'; end if;
  if v_task.approval_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'deliverable approval revision changed';
  end if;
  if v_task.approval_status <> 'proposed' then
    raise exception using errcode = 'P0003', message = 'deliverable is not proposed';
  end if;
  if p_action in ('approve', 'reject')
     and v_actor_role not in ('ceo', 'deputy')
     and coalesce(v_initiative.accountable_profile_id, '') <> p_actor_profile_id then
    raise exception using errcode = 'P0006', message = 'deliverable approval requires ceo, deputy, or initiative accountable';
  end if;
  if p_action = 'return_to_draft'
     and v_actor_role not in ('ceo', 'deputy')
     and coalesce(v_initiative.accountable_profile_id, '') <> p_actor_profile_id then
    raise exception using errcode = 'P0006', message = 'deliverable may only be returned by operational lead or accountable';
  end if;
  if p_action = 'approve' and v_initiative.approval_status <> 'approved' then
    raise exception using errcode = 'P0003', message = 'initiative must be approved first';
  end if;

  if p_action = 'reject' then
    v_trash_result := public.trash_planning_item_tree_transaction(
      'deliverable', p_task_id, p_expected_revision, p_actor_profile_id, v_note, 'rejected', null, null
    );
    return v_trash_result->'item';
  end if;

  v_before_status := v_task.approval_status;
  v_notification_recipient_id := v_task.proposed_by;
  v_next_status := case p_action when 'approve' then 'approved' else 'draft' end;
  update public.tasks
  set approval_status = v_next_status,
      approval_revision = approval_revision + 1,
      decided_by = case when p_action = 'approve' then p_actor_profile_id else null end,
      decided_at = case when p_action = 'approve' then now() else null end,
      decision_note = v_note,
      sprint_id = case when p_action = 'approve' then sprint_id else null end,
      review_status = case when p_action = 'approve' then review_status else 'not_requested' end,
      review_requested_at = case when p_action = 'approve' then review_requested_at else null end,
      score_points = case when p_action = 'approve' then score_points else 0 end,
      score_final = case when p_action = 'approve' then score_final else false end,
      github_issue_sync_status = 'not_synced',
      github_issue_sync_error = null,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning * into v_task;

  insert into public.task_activity (task_id, message)
  values (p_task_id, case p_action
    when 'approve' then 'Deliverable freigegeben · Revision ' || v_task.approval_revision
    else 'Deliverable zur Überarbeitung zurückgegeben · Revision ' || v_task.approval_revision || ' · Begründung: ' || v_note
  end);
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_profile_id, 'task.approval_' || p_action, 'task', p_task_id,
    jsonb_build_object('approvalStatus', v_before_status, 'revision', p_expected_revision),
    jsonb_build_object('approvalStatus', v_next_status, 'revision', v_task.approval_revision, 'note', v_note));

  if p_action = 'approve' then
    insert into public.planning_github_lifecycle_outbox (
      root_type, root_id, root_trash_revision, task_id, github_repo, github_issue_number,
      action, source_type, source_revision, reason
    )
    select
      'deliverable',
      p_task_id,
      v_task.trash_revision,
      linked.id,
      prior.github_repo,
      prior.github_issue_number,
      'reopen',
      'approval',
      v_task.approval_revision,
      null
    from public.tasks linked
    join lateral (
      select closed.github_repo, closed.github_issue_number
      from public.planning_github_lifecycle_outbox closed
      where closed.task_id = linked.id and closed.action = 'close_not_planned'
      order by closed.created_at desc, closed.id desc
      limit 1
    ) prior on true
    where (linked.id = p_task_id or linked.parent_task_id = p_task_id)
      and linked.trashed_at is null
      and linked.trash_revision > 0
      and prior.github_repo is not null
      and prior.github_issue_number is not null
    on conflict (root_type, root_id, root_trash_revision, task_id, action) do nothing;
  end if;

  if p_action = 'return_to_draft' and v_notification_recipient_id is not null then
    insert into public.notification_events (
      type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body, dedupe_key
    ) values (
      'planning_item.returned', p_actor_profile_id, v_notification_recipient_id, 'task', p_task_id,
      'Deliverable zur Überarbeitung: ' || v_task.title,
      'Begründung: ' || v_note,
      'planning-item-returned:task:' || p_task_id || ':' || v_task.approval_revision
    );
  end if;

  return to_jsonb(v_task);
end;
$$;

ALTER FUNCTION public.decide_deliverable_approval_transaction(text, integer, text, text, text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.decide_initiative_approval_transaction(
  p_initiative_id text,
  p_expected_revision integer,
  p_action text,
  p_actor_profile_id text,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_initiative public.packages%rowtype;
  v_actor_role text;
  v_next_status text;
  v_before_status text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_notification_recipient_id text;
  v_trash_result jsonb;
begin
  if p_action is null
     or p_action not in ('approve', 'reject', 'return_to_draft')
     or p_expected_revision is null
     or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'initiative approval input is invalid';
  end if;
  if char_length(v_note) > 2000 then
    raise exception using errcode = '22023', message = 'approval decision note exceeds 2000 characters';
  end if;
  if p_action in ('reject', 'return_to_draft') and v_note is null then
    raise exception using errcode = '22023', message = 'approval decision note is required';
  end if;

  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  if not found then raise exception using errcode = 'P0006', message = 'approval actor not found'; end if;

  select * into v_initiative from public.packages where id = p_initiative_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'initiative not found'; end if;
  if v_initiative.trashed_at is not null then raise exception using errcode = 'P0003', message = 'initiative is trashed'; end if;
  if v_initiative.approval_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'initiative approval revision changed';
  end if;
  if v_initiative.approval_status <> 'proposed' then
    raise exception using errcode = 'P0003', message = 'initiative is not proposed';
  end if;

  if p_action in ('approve', 'reject') and v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'only ceo or deputy may decide initiative approval';
  end if;
  if p_action = 'return_to_draft' and v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'initiative may only be returned by operational lead';
  end if;

  if p_action = 'reject' then
    v_trash_result := public.trash_planning_item_tree_transaction(
      'initiative', p_initiative_id, p_expected_revision, p_actor_profile_id, v_note, 'rejected', null, null
    );
    return v_trash_result->'item';
  end if;

  v_before_status := v_initiative.approval_status;
  v_notification_recipient_id := v_initiative.proposed_by;
  v_next_status := case p_action when 'approve' then 'approved' else 'draft' end;
  update public.packages
  set approval_status = v_next_status,
      approval_revision = approval_revision + 1,
      decided_by = case when p_action = 'approve' then p_actor_profile_id else null end,
      decided_at = case when p_action = 'approve' then now() else null end,
      decision_note = v_note
  where id = p_initiative_id
  returning * into v_initiative;

  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_profile_id, 'initiative.approval_' || p_action, 'initiative', p_initiative_id,
    jsonb_build_object('approvalStatus', v_before_status, 'revision', p_expected_revision),
    jsonb_build_object('approvalStatus', v_next_status, 'revision', v_initiative.approval_revision, 'note', v_note));

  if p_action = 'return_to_draft' and v_notification_recipient_id is not null then
    insert into public.notification_events (
      type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body, dedupe_key
    ) values (
      'planning_item.returned', p_actor_profile_id, v_notification_recipient_id, 'initiative', p_initiative_id,
      'Initiative zur Überarbeitung: ' || v_initiative.title,
      'Begründung: ' || v_note,
      'planning-item-returned:initiative:' || p_initiative_id || ':' || v_initiative.approval_revision
    );
  end if;

  return to_jsonb(v_initiative);
end;
$$;

ALTER FUNCTION public.decide_initiative_approval_transaction(text, integer, text, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.decide_deliverable_approval_transaction(text, integer, text, text, text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.decide_deliverable_approval_transaction(text, integer, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.decide_initiative_approval_transaction(text, integer, text, text, text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.decide_initiative_approval_transaction(text, integer, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION "public"."trash_planning_item_tree_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_revision" integer, "p_actor_profile_id" "text", "p_reason" "text", "p_cause" "text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor_role text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_trashed_at timestamptz := clock_timestamp();
  v_initiative public.packages%rowtype;
  v_task public.tasks%rowtype;
  v_root_task public.tasks%rowtype;
  v_task_ids text[] := array[]::text[];
  v_event_ids bigint[] := array[]::bigint[];
  v_notification_id bigint;
  v_root_trash_revision integer;
  v_package_id text;
  v_before_data jsonb;
  v_item jsonb;
begin
  if p_root_type is null
     or p_root_type not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_root_id, '')), '') is null
     or p_expected_revision is null
     or p_expected_revision < 1
     or p_cause is null
     or p_cause not in ('withdrawn', 'rejected') then
    raise exception using errcode = '22023', message = 'planning trash input is invalid';
  end if;
  if v_reason is null then
    raise exception using errcode = '22023', message = 'planning trash reason is required';
  end if;
  if char_length(v_reason) > 2000 then
    raise exception using errcode = '22023', message = 'planning trash reason exceeds 2000 characters';
  end if;

  select platform_role into v_actor_role
  from public.profiles
  where id = p_actor_profile_id;
  if not found then
    raise exception using errcode = 'P0006', message = 'planning trash actor not found';
  end if;

  if p_root_type = 'initiative' then
    select * into v_initiative
    from public.packages
    where id = p_root_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'initiative not found';
    end if;
    if v_initiative.trashed_at is not null then
      raise exception using errcode = 'P0003', message = 'initiative is already trashed';
    end if;
    if v_initiative.approval_revision <> p_expected_revision then
      raise exception using errcode = 'P0001', message = 'initiative approval revision changed';
    end if;
    if p_cause = 'withdrawn' then
      if v_initiative.approval_status not in ('draft', 'proposed') then
        raise exception using errcode = 'P0003', message = 'only draft or proposed initiatives may be withdrawn';
      end if;
      if v_actor_role not in ('ceo', 'deputy')
         and coalesce(v_initiative.proposed_by, '') <> p_actor_profile_id then
        raise exception using errcode = 'P0006', message = 'initiative withdrawal requires proposer or operational lead';
      end if;
    else
      if v_initiative.approval_status <> 'proposed' then
        raise exception using errcode = 'P0003', message = 'initiative is not proposed';
      end if;
      if v_actor_role not in ('ceo', 'deputy') then
        raise exception using errcode = 'P0006', message = 'only ceo or deputy may decide initiative approval';
      end if;
    end if;

    perform id
    from public.tasks
    where package_id = p_root_id and trashed_at is null
    order by id
    for update;

    v_before_data := jsonb_build_object(
      'approvalStatus', v_initiative.approval_status,
      'approvalRevision', v_initiative.approval_revision,
      'trashRevision', v_initiative.trash_revision
    );
    perform set_config('founderops.trash_lifecycle_write', 'on', true);

    update public.packages
    set approval_status = case when p_cause = 'rejected' then 'rejected' else approval_status end,
        approval_revision = case when p_cause = 'rejected' then approval_revision + 1 else approval_revision end,
        decided_by = case when p_cause = 'rejected' then p_actor_profile_id else decided_by end,
        decided_at = case when p_cause = 'rejected' then v_trashed_at else decided_at end,
        decision_note = case when p_cause = 'rejected' then v_reason else decision_note end,
        trashed_at = v_trashed_at,
        trashed_by = p_actor_profile_id,
        trash_reason = v_reason,
        trash_cause = p_cause,
        purge_after = v_trashed_at + interval '90 days',
        trash_root_type = 'initiative',
        trash_root_id = p_root_id,
        trash_revision = trash_revision + 1
    where id = p_root_id
    returning * into v_initiative;

    with updated as (
      update public.tasks
      set trashed_at = v_trashed_at,
          trashed_by = p_actor_profile_id,
          trash_reason = v_reason,
          trash_cause = p_cause,
          purge_after = v_trashed_at + interval '90 days',
          trash_root_type = 'initiative',
          trash_root_id = p_root_id,
          trash_revision = v_initiative.trash_revision,
          updated_at = clock_timestamp()
      where package_id = p_root_id and trashed_at is null
      returning id
    )
    select coalesce(array_agg(id order by id), array[]::text[]) into v_task_ids from updated;

    v_root_trash_revision := v_initiative.trash_revision;
    v_item := to_jsonb(v_initiative);
  else
    select package_id into v_package_id
    from public.tasks
    where id = p_root_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'deliverable not found';
    end if;

    select * into v_initiative
    from public.packages
    where id = v_package_id
    for share;
    if not found or v_initiative.trashed_at is not null then
      raise exception using errcode = 'P0003', message = 'deliverable requires an active initiative';
    end if;

    select * into v_task
    from public.tasks
    where id = p_root_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'deliverable not found';
    end if;
    if v_task.package_id is distinct from v_package_id then
      raise exception using errcode = 'P0001', message = 'deliverable initiative changed';
    end if;
    if v_task.task_type <> 'deliverable' then
      raise exception using errcode = '22023', message = 'only deliverables may be trashed as task roots';
    end if;
    if v_task.trashed_at is not null then
      raise exception using errcode = 'P0003', message = 'deliverable is already trashed';
    end if;
    if v_task.approval_revision <> p_expected_revision then
      raise exception using errcode = 'P0001', message = 'deliverable approval revision changed';
    end if;
    if p_cause = 'withdrawn' then
      if v_task.approval_status not in ('draft', 'proposed') then
        raise exception using errcode = 'P0003', message = 'only draft or proposed deliverables may be withdrawn';
      end if;
      if v_actor_role not in ('ceo', 'deputy')
         and coalesce(v_task.proposed_by, '') <> p_actor_profile_id then
        raise exception using errcode = 'P0006', message = 'deliverable withdrawal requires proposer or operational lead';
      end if;
    else
      if v_task.approval_status <> 'proposed' then
        raise exception using errcode = 'P0003', message = 'deliverable is not proposed';
      end if;
      if v_actor_role not in ('ceo', 'deputy')
         and coalesce(v_initiative.accountable_profile_id, '') <> p_actor_profile_id then
        raise exception using errcode = 'P0006', message = 'deliverable rejection requires ceo, deputy, or initiative accountable';
      end if;
    end if;

    perform id
    from public.tasks
    where parent_task_id = p_root_id and trashed_at is null
    order by id
    for update;

    v_before_data := jsonb_build_object(
      'approvalStatus', v_task.approval_status,
      'approvalRevision', v_task.approval_revision,
      'trashRevision', v_task.trash_revision
    );
    v_root_trash_revision := v_task.trash_revision + 1;
    perform set_config('founderops.trash_lifecycle_write', 'on', true);

    with updated as (
      update public.tasks
      set approval_status = case
            when id = p_root_id and p_cause = 'rejected' then 'rejected'
            else approval_status
          end,
          approval_revision = case
            when id = p_root_id and p_cause = 'rejected' then approval_revision + 1
            else approval_revision
          end,
          decided_by = case
            when id = p_root_id and p_cause = 'rejected' then p_actor_profile_id
            else decided_by
          end,
          decided_at = case
            when id = p_root_id and p_cause = 'rejected' then v_trashed_at
            else decided_at
          end,
          decision_note = case
            when id = p_root_id and p_cause = 'rejected' then v_reason
            else decision_note
          end,
          sprint_id = case when id = p_root_id then null else sprint_id end,
          review_status = case when id = p_root_id then 'not_requested' else review_status end,
          review_requested_at = case when id = p_root_id then null else review_requested_at end,
          score_points = case when id = p_root_id then 0 else score_points end,
          score_final = case when id = p_root_id then false else score_final end,
          trashed_at = v_trashed_at,
          trashed_by = p_actor_profile_id,
          trash_reason = v_reason,
          trash_cause = p_cause,
          purge_after = v_trashed_at + interval '90 days',
          trash_root_type = 'deliverable',
          trash_root_id = p_root_id,
          trash_revision = v_root_trash_revision,
          updated_at = clock_timestamp()
      where (id = p_root_id or parent_task_id = p_root_id) and trashed_at is null
      returning *
    ), collected as (
      select coalesce(array_agg(id order by id), array[]::text[]) as ids from updated
    )
    select ids into v_task_ids from collected;

    select * into v_root_task from public.tasks where id = p_root_id;
    v_item := to_jsonb(v_root_task);

    insert into public.task_activity (task_id, message)
    values (
      p_root_id,
      case p_cause
        when 'rejected' then 'Deliverable abgelehnt und in den Papierkorb verschoben · Revision ' || v_root_task.approval_revision || ' · Begründung: ' || v_reason
        else 'Deliverable zurückgezogen und in den Papierkorb verschoben · Begründung: ' || v_reason
      end
    );
  end if;

  insert into public.planning_github_lifecycle_outbox (
    root_type,
    root_id,
    root_trash_revision,
    task_id,
    github_repo,
    github_issue_number,
    action,
    source_type,
    source_revision,
    reason,
    status,
    status_reason,
    last_error
  )
  select
    p_root_type,
    p_root_id,
    v_root_trash_revision,
    task.id,
    issue_reference.normalized_repo,
    issue_reference.normalized_issue_number,
    'close_not_planned',
    p_cause,
    v_root_trash_revision,
    v_reason,
    case when issue_reference.reference_status = 'invalid' then 'failed' else 'pending' end,
    case when issue_reference.reference_status = 'invalid' then 'invalid_issue_reference' end,
    case when issue_reference.reference_status = 'invalid' then issue_reference.error_message end
  from public.tasks task
  cross join lateral public.normalize_planning_github_issue_reference(
    task.task_type,
    task.github_repo,
    task.github_issue_number,
    task.issue_number,
    task.github_issue_url,
    task.issue_url
  ) issue_reference
  where task.id = any(v_task_ids)
  on conflict (root_type, root_id, root_trash_revision, task_id, action) do nothing;

  perform set_config('founderops.trash_lifecycle_write', 'off', true);

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    request_ip,
    user_agent
  ) values (
    p_actor_profile_id,
    case
      when p_cause = 'rejected' and p_root_type = 'initiative' then 'initiative.approval_reject'
      when p_cause = 'rejected' then 'task.approval_reject'
      when p_root_type = 'initiative' then 'initiative.withdrawn'
      else 'task.withdrawn'
    end,
    case when p_root_type = 'initiative' then 'initiative' else 'task' end,
    p_root_id,
    v_before_data,
    jsonb_build_object(
      'trashCause', p_cause,
      'trashReason', v_reason,
      'trashRevision', v_root_trash_revision,
      'affectedTaskIds', to_jsonb(v_task_ids),
      'approvalStatus', v_item->'approval_status',
      'approvalRevision', v_item->'approval_revision'
    ),
    p_request_ip,
    p_user_agent
  );

  if p_cause = 'rejected' then
    if p_root_type = 'initiative' then
      if v_initiative.proposed_by is not null then
        insert into public.notification_events (
          type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body, dedupe_key
        ) values (
          'planning_item.rejected', p_actor_profile_id, v_initiative.proposed_by, 'initiative', p_root_id,
          'Initiative abgelehnt: ' || v_initiative.title,
          'Begründung: ' || v_reason,
          'planning-item-rejected:initiative:' || p_root_id || ':' || v_initiative.approval_revision
        ) returning id into v_notification_id;
      end if;
    elsif v_root_task.proposed_by is not null then
      insert into public.notification_events (
        type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body, dedupe_key
      ) values (
        'planning_item.rejected', p_actor_profile_id, v_root_task.proposed_by, 'task', p_root_id,
        'Deliverable abgelehnt: ' || v_root_task.title,
        'Begründung: ' || v_reason,
        'planning-item-rejected:task:' || p_root_id || ':' || v_root_task.approval_revision
      ) returning id into v_notification_id;
    end if;
    if v_notification_id is not null then
      v_event_ids := array_append(v_event_ids, v_notification_id);
    end if;
  end if;

  return jsonb_build_object(
    'rootType', p_root_type,
    'rootId', p_root_id,
    'affectedTaskIds', to_jsonb(v_task_ids),
    'trashRevision', v_root_trash_revision,
    'item', v_item,
    'eventIds', to_jsonb(v_event_ids)
  );
end;
$$;


ALTER FUNCTION "public"."trash_planning_item_tree_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_revision" integer, "p_actor_profile_id" "text", "p_reason" "text", "p_cause" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.trash_planning_item_tree_transaction(text, text, integer, text, text, text, text, text) FROM PUBLIC;
