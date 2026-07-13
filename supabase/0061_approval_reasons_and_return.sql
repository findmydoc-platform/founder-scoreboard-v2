create or replace function public.decide_initiative_approval_transaction(
  p_initiative_id text,
  p_expected_revision integer,
  p_action text,
  p_actor_profile_id text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_initiative public.packages%rowtype;
  v_actor_role text;
  v_next_status text;
  v_before_status text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_notification_recipient_id text;
begin
  if p_action not in ('approve', 'reject', 'return_to_draft') or p_expected_revision < 1 then
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
  if v_initiative.approval_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'initiative approval revision changed';
  end if;
  if v_initiative.approval_status <> 'proposed' then
    raise exception using errcode = 'P0003', message = 'initiative is not proposed';
  end if;

  if p_action in ('approve', 'reject') and v_actor_role <> 'ceo' then
    raise exception using errcode = 'P0006', message = 'only ceo may decide initiative approval';
  end if;
  if p_action = 'return_to_draft' and v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'initiative may only be returned by operational lead';
  end if;

  v_before_status := v_initiative.approval_status;
  v_notification_recipient_id := v_initiative.proposed_by;
  v_next_status := case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'draft' end;
  update public.packages
  set approval_status = v_next_status,
      approval_revision = approval_revision + 1,
      decided_by = case when p_action in ('approve', 'reject') then p_actor_profile_id else null end,
      decided_at = case when p_action in ('approve', 'reject') then now() else null end,
      decision_note = v_note
  where id = p_initiative_id
  returning * into v_initiative;

  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_profile_id, 'initiative.approval_' || p_action, 'initiative', p_initiative_id,
    jsonb_build_object('approvalStatus', v_before_status, 'revision', p_expected_revision),
    jsonb_build_object('approvalStatus', v_next_status, 'revision', v_initiative.approval_revision, 'note', v_note));

  if p_action = 'return_to_draft' and v_notification_recipient_id is not null then
    insert into public.notification_events (
      type,
      actor_profile_id,
      recipient_profile_id,
      entity_type,
      entity_id,
      title,
      body,
      dedupe_key
    ) values (
      'planning_item.returned',
      p_actor_profile_id,
      v_notification_recipient_id,
      'initiative',
      p_initiative_id,
      'Initiative zur Überarbeitung: ' || v_initiative.title,
      'Begründung: ' || v_note,
      'planning-item-returned:initiative:' || p_initiative_id || ':' || v_initiative.approval_revision
    );
  end if;

  return to_jsonb(v_initiative);
end;
$$;

create or replace function public.decide_deliverable_approval_transaction(
  p_task_id text,
  p_expected_revision integer,
  p_action text,
  p_actor_profile_id text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks%rowtype;
  v_initiative public.packages%rowtype;
  v_actor_role text;
  v_next_status text;
  v_before_status text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_notification_recipient_id text;
begin
  if p_action not in ('approve', 'reject', 'return_to_draft') or p_expected_revision < 1 then
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

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'deliverable not found'; end if;
  if v_task.task_type <> 'deliverable' then raise exception using errcode = '22023', message = 'task is not a deliverable'; end if;
  if v_task.approval_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'deliverable approval revision changed';
  end if;
  if v_task.approval_status <> 'proposed' then
    raise exception using errcode = 'P0003', message = 'deliverable is not proposed';
  end if;

  select * into v_initiative from public.packages where id = v_task.package_id for share;
  if not found then raise exception using errcode = 'P0002', message = 'initiative not found'; end if;

  if p_action in ('approve', 'reject')
     and v_actor_role <> 'ceo'
     and coalesce(v_initiative.accountable_profile_id, '') <> p_actor_profile_id then
    raise exception using errcode = 'P0006', message = 'deliverable approval requires ceo or initiative accountable';
  end if;
  if p_action = 'return_to_draft'
     and v_actor_role not in ('ceo', 'deputy')
     and coalesce(v_initiative.accountable_profile_id, '') <> p_actor_profile_id then
    raise exception using errcode = 'P0006', message = 'deliverable may only be returned by operational lead or accountable';
  end if;
  if p_action = 'approve' and v_initiative.approval_status <> 'approved' then
    raise exception using errcode = 'P0003', message = 'initiative must be approved first';
  end if;

  v_before_status := v_task.approval_status;
  v_notification_recipient_id := v_task.proposed_by;
  v_next_status := case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'draft' end;
  update public.tasks
  set approval_status = v_next_status,
      approval_revision = approval_revision + 1,
      decided_by = case when p_action in ('approve', 'reject') then p_actor_profile_id else null end,
      decided_at = case when p_action in ('approve', 'reject') then now() else null end,
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
    when 'reject' then 'Deliverable abgelehnt · Revision ' || v_task.approval_revision || ' · Begründung: ' || v_note
    else 'Deliverable zur Überarbeitung zurückgegeben · Revision ' || v_task.approval_revision || ' · Begründung: ' || v_note
  end);
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_profile_id, 'task.approval_' || p_action, 'task', p_task_id,
    jsonb_build_object('approvalStatus', v_before_status, 'revision', p_expected_revision),
    jsonb_build_object('approvalStatus', v_next_status, 'revision', v_task.approval_revision, 'note', v_note));

  if p_action = 'return_to_draft' and v_notification_recipient_id is not null then
    insert into public.notification_events (
      type,
      actor_profile_id,
      recipient_profile_id,
      entity_type,
      entity_id,
      title,
      body,
      dedupe_key
    ) values (
      'planning_item.returned',
      p_actor_profile_id,
      v_notification_recipient_id,
      'task',
      p_task_id,
      'Deliverable zur Überarbeitung: ' || v_task.title,
      'Begründung: ' || v_note,
      'planning-item-returned:task:' || p_task_id || ':' || v_task.approval_revision
    );
  end if;

  return to_jsonb(v_task);
end;
$$;

revoke all on function public.decide_initiative_approval_transaction(text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.decide_deliverable_approval_transaction(text, integer, text, text, text) from public, anon, authenticated;

grant execute on function public.decide_initiative_approval_transaction(text, integer, text, text, text) to service_role;
grant execute on function public.decide_deliverable_approval_transaction(text, integer, text, text, text) to service_role;
