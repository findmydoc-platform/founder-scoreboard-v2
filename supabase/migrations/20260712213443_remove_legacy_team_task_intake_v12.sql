do $$
begin
  if exists (select 1 from public.tasks where task_type = 'proposal') then
    raise exception 'Cannot remove legacy Team Task Intake v1.2 while proposal tasks remain.';
  end if;
end
$$;

create or replace function public.normalize_task_approval_state()
returns trigger
language plpgsql
set search_path = public
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
  return new;
end;
$$;

alter table public.tasks drop constraint if exists tasks_task_type_check;
alter table public.tasks add constraint tasks_task_type_check
  check (task_type in ('deliverable', 'sub_issue'));

alter table public.tasks drop constraint if exists tasks_approval_status_by_type_check;
alter table public.tasks add constraint tasks_approval_status_by_type_check check (
  (task_type = 'sub_issue' and approval_status is null)
  or (task_type = 'deliverable' and approval_status in ('draft', 'proposed', 'approved', 'rejected'))
);

alter table public.tasks drop constraint if exists tasks_github_repo_allowed_check;
alter table public.tasks add constraint tasks_github_repo_allowed_check check (
  (task_type = 'sub_issue' and github_repo in ('findmydoc-platform/management', 'findmydoc-platform/website', 'findmydoc-platform/clinic-dashboard'))
  or (task_type = 'deliverable' and github_repo = 'findmydoc-platform/management')
);

drop index if exists public.tasks_legacy_proposal_unresolved_idx;
alter table public.tasks drop column if exists legacy_proposal_unresolved;

drop function if exists public.create_team_task_intake_batch_transaction(uuid, text, uuid, text, jsonb, text, text);

notify pgrst, 'reload schema';
