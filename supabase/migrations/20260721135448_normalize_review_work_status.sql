create or replace function public.normalize_task_approval_state()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_actor_profile_id text := nullif(current_setting('app.actor_profile_id', true), '');
  v_material_change boolean := false;
  v_parent public.tasks%rowtype;
begin
  if new.task_type = 'sub_issue' then
    if new.parent_task_id is null then
      raise exception using errcode = '23514', message = 'sub-issue requires a parent deliverable';
    end if;
    select * into v_parent from public.tasks where id = new.parent_task_id;
    if not found or v_parent.task_type <> 'deliverable' then
      raise exception using errcode = '23514', message = 'sub-issue parent must be a deliverable';
    end if;
    new.package_id := v_parent.package_id;
    new.milestone_id := v_parent.milestone_id;
    new.approval_status := null;
    new.sprint_id := null;
    new.score_relevant := false;
    return new;
  end if;

  if new.approval_status is null then
    new.approval_status := 'proposed';
  end if;

  new.github_repo := 'findmydoc-platform/management';

  if tg_op = 'UPDATE' and old.task_type = 'deliverable' then
    v_material_change :=
      new.package_id is distinct from old.package_id
      or new.title is distinct from old.title
      or new.problem_statement is distinct from old.problem_statement
      or new.intended_outcome is distinct from old.intended_outcome
      or new.scope_constraints is distinct from old.scope_constraints
      or new.acceptance_criteria is distinct from old.acceptance_criteria
      or new.definition_of_done is distinct from old.definition_of_done;
    if v_material_change then
      new.approval_status := 'proposed';
      new.approval_revision := old.approval_revision + 1;
      new.proposed_by := v_actor_profile_id;
      new.proposed_at := now();
      new.decided_by := null;
      new.decided_at := null;
      new.decision_note := null;
      new.sprint_id := null;
      new.review_status := 'not_requested';
      new.review_requested_at := null;
      new.score_points := 0;
      new.score_final := false;
      insert into public.task_activity (task_id, message)
      values (new.id, case old.approval_status
        when 'approved' then 'Materielle Änderung: neue Freigabe erforderlich'
        when 'proposed' then 'Freigabeantrag mit neuer Revision aktualisiert'
        else 'Deliverable erneut zur Freigabe eingereicht' end);
      insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
      values (v_actor_profile_id,
        case old.approval_status
          when 'approved' then 'task.approval_reset'
          when 'proposed' then 'task.approval_revised'
          else 'task.approval_resubmitted' end,
        'task', new.id,
        jsonb_build_object('approvalStatus', old.approval_status, 'revision', old.approval_revision),
        jsonb_build_object('approvalStatus', 'proposed', 'revision', new.approval_revision));
    end if;
  end if;

  if new.approval_status <> 'approved' then
    new.sprint_id := null;
    new.score_relevant := false;
  else
    new.score_relevant := new.sprint_id is not null;
  end if;

  if new.status = 'Review'
     and (
       new.approval_status is distinct from 'approved'
       or new.review_status is distinct from 'requested'
     ) then
    new.status := 'In Arbeit';
    if tg_op = 'UPDATE' and old.status is distinct from new.status then
      insert into public.audit_log (
        actor_profile_id,
        action,
        entity_type,
        entity_id,
        before_data,
        after_data
      ) values (
        v_actor_profile_id,
        'task.status_changed',
        'task',
        new.id,
        jsonb_build_object('status', old.status),
        jsonb_build_object(
          'status', new.status,
          'message', 'Status geändert: Review → In Arbeit',
          'reason', 'invalid_review_workflow_state_normalized'
        )
      );
    end if;
  end if;

  return new;
end;
$$;

comment on function public.normalize_task_approval_state()
is 'Keeps deliverable approval, review, sprint, score, and working status state aligned.';

update public.tasks
set updated_at = clock_timestamp()
where id = 'sebastian-team-intake-f913a6437be042019ba8d3f5a95737e3-bb71383e2eaf4cd4b282b27ceaacc3fc-1'
  and task_type = 'deliverable'
  and status = 'Review'
  and (
    approval_status is distinct from 'approved'
    or review_status is distinct from 'requested'
  );
