do $$
declare
  v_task public.tasks%rowtype;
  v_actor_profile_id text;
  v_decided_at timestamptz := clock_timestamp();
begin
  select *
  into v_task
  from public.tasks
  where id = 'sebastian-team-intake-f913a6437be042019ba8d3f5a95737e3-bb71383e2eaf4cd4b282b27ceaacc3fc-1'
  for update;

  if not found then
    return;
  end if;

  if v_task.task_type <> 'deliverable'
     or v_task.status <> 'In Arbeit'
     or v_task.approval_status <> 'draft'
     or v_task.approval_revision <> 3
     or v_task.review_status <> 'not_requested'
     or v_task.score_final then
    raise exception using
      errcode = 'P0001',
      message = 'Founder Intake approval repair precondition failed';
  end if;

  select audit.actor_profile_id
  into v_actor_profile_id
  from public.audit_log audit
  join public.profiles profile on profile.id = audit.actor_profile_id
  where audit.entity_type = 'task'
    and audit.entity_id = v_task.id
    and audit.action in ('task.approval_return_to_draft', 'task.approval_approve')
  order by audit.created_at desc, audit.id desc
  limit 1;

  if v_actor_profile_id is null then
    raise exception using
      errcode = 'P0006',
      message = 'Founder Intake approval repair actor not found';
  end if;

  update public.tasks
  set approval_status = 'approved',
      approval_revision = approval_revision + 1,
      decided_by = v_actor_profile_id,
      decided_at = v_decided_at,
      decision_note = null,
      github_issue_sync_status = 'not_synced',
      github_issue_sync_error = null,
      updated_at = v_decided_at
  where id = v_task.id;

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    created_at
  ) values (
    v_actor_profile_id,
    'task.approval_approve',
    'task',
    v_task.id,
    jsonb_build_object(
      'approvalStatus', v_task.approval_status,
      'revision', v_task.approval_revision
    ),
    jsonb_build_object(
      'approvalStatus', 'approved',
      'revision', v_task.approval_revision + 1,
      'message', 'Deliverable freigegeben · Revision ' || (v_task.approval_revision + 1),
      'reason', 'invalid_review_workflow_state_repaired'
    ),
    v_decided_at
  );
end;
$$;
