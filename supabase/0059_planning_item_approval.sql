alter table public.packages add column if not exists approval_status text;
alter table public.packages add column if not exists approval_revision integer not null default 1;
alter table public.packages add column if not exists proposed_by text references public.profiles(id) on delete set null;
alter table public.packages add column if not exists proposed_at timestamptz;
alter table public.packages add column if not exists decided_by text references public.profiles(id) on delete set null;
alter table public.packages add column if not exists decided_at timestamptz;
alter table public.packages add column if not exists decision_note text;

alter table public.tasks add column if not exists approval_status text;
alter table public.tasks add column if not exists approval_revision integer not null default 1;
alter table public.tasks add column if not exists proposed_by text references public.profiles(id) on delete set null;
alter table public.tasks add column if not exists proposed_at timestamptz;
alter table public.tasks add column if not exists decided_by text references public.profiles(id) on delete set null;
alter table public.tasks add column if not exists decided_at timestamptz;
alter table public.tasks add column if not exists decision_note text;
alter table public.tasks add column if not exists legacy_proposal_unresolved boolean not null default false;

update public.packages
set approval_status = coalesce(approval_status, 'approved'),
    approval_revision = greatest(approval_revision, 1),
    decided_at = coalesce(decided_at, now())
where approval_status is null or approval_revision < 1;

update public.tasks as child
set task_type = 'sub_issue',
    status = case when child.status = 'Vorschlag' then 'Offen' else child.status end,
    package_id = parent.package_id,
    milestone_id = parent.milestone_id,
    sprint_id = null,
    score_relevant = false,
    approval_status = null,
    legacy_proposal_unresolved = false
from public.tasks as parent
where child.task_type = 'proposal'
  and child.parent_task_id = parent.id
  and parent.task_type = 'deliverable';

update public.tasks
set task_type = 'deliverable',
    status = case when status = 'Vorschlag' then 'Offen' else status end,
    approval_status = 'proposed',
    approval_revision = greatest(approval_revision, 1),
    proposed_at = coalesce(proposed_at, now()),
    sprint_id = null,
    score_relevant = false,
    legacy_proposal_unresolved = false
where task_type = 'proposal'
  and package_id is not null
  and exists (select 1 from public.packages where packages.id = tasks.package_id);

update public.tasks
set approval_status = case
      when task_type = 'sub_issue' then null
      when task_type = 'proposal' then 'proposed'
      else coalesce(approval_status, 'approved')
    end,
    approval_revision = greatest(approval_revision, 1),
    proposed_at = case when task_type = 'proposal' then coalesce(proposed_at, now()) else proposed_at end,
    legacy_proposal_unresolved = task_type = 'proposal',
    sprint_id = case when task_type in ('proposal', 'sub_issue') then null else sprint_id end,
    score_relevant = task_type = 'deliverable'
      and coalesce(approval_status, 'approved') = 'approved'
      and sprint_id is not null;

update public.tasks
set github_repo = 'findmydoc-platform/management'
where task_type <> 'sub_issue'
  or github_repo is null
  or trim(github_repo) = '';

alter table public.packages alter column approval_status set default 'proposed';
alter table public.packages alter column approval_status set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'packages_approval_status_check') then
    alter table public.packages add constraint packages_approval_status_check
      check (approval_status in ('draft', 'proposed', 'approved', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'packages_approval_revision_check') then
    alter table public.packages add constraint packages_approval_revision_check check (approval_revision >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_approval_status_by_type_check') then
    alter table public.tasks add constraint tasks_approval_status_by_type_check check (
      (task_type = 'sub_issue' and approval_status is null)
      or (task_type in ('deliverable', 'proposal') and approval_status in ('draft', 'proposed', 'approved', 'rejected'))
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_approval_revision_check') then
    alter table public.tasks add constraint tasks_approval_revision_check check (approval_revision >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_approval_sprint_check') then
    alter table public.tasks add constraint tasks_approval_sprint_check check (
      task_type = 'deliverable' and approval_status = 'approved'
      or sprint_id is null
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_score_relevance_approval_check') then
    alter table public.tasks add constraint tasks_score_relevance_approval_check check (
      score_relevant = (
        task_type = 'deliverable'
        and approval_status = 'approved'
        and sprint_id is not null
      )
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_github_repo_allowed_check') then
    alter table public.tasks add constraint tasks_github_repo_allowed_check check (
      (task_type = 'sub_issue' and github_repo in ('findmydoc-platform/management', 'findmydoc-platform/website', 'findmydoc-platform/clinic-dashboard'))
      or (task_type in ('deliverable', 'proposal') and github_repo = 'findmydoc-platform/management')
    );
  end if;
end
$$;

create index if not exists packages_approval_status_idx on public.packages(approval_status);
create index if not exists tasks_approval_status_idx on public.tasks(approval_status);
create index if not exists tasks_legacy_proposal_unresolved_idx
  on public.tasks(legacy_proposal_unresolved) where legacy_proposal_unresolved;

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

  if new.task_type = 'proposal' then
    new.approval_status := 'proposed';
    new.legacy_proposal_unresolved := true;
  elsif new.approval_status is null then
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

drop trigger if exists tasks_normalize_approval_state on public.tasks;
create trigger tasks_normalize_approval_state
before insert or update on public.tasks
for each row execute function public.normalize_task_approval_state();

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
begin
  if p_action not in ('approve', 'reject', 'return_to_draft') or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'initiative approval input is invalid';
  end if;

  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  if not found then raise exception using errcode = 'P0006', message = 'approval actor not found'; end if;

  select * into v_initiative from public.packages where id = p_initiative_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'initiative not found'; end if;
  if v_initiative.approval_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'initiative approval revision changed';
  end if;

  if p_action in ('approve', 'reject') and v_actor_role <> 'ceo' then
    raise exception using errcode = 'P0006', message = 'only ceo may decide initiative approval';
  end if;
  if p_action = 'return_to_draft' and v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'initiative may only be returned by operational lead';
  end if;
  if p_action in ('approve', 'reject') and v_initiative.approval_status <> 'proposed' then
    raise exception using errcode = 'P0003', message = 'initiative is not proposed';
  end if;

  v_before_status := v_initiative.approval_status;
  v_next_status := case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'draft' end;
  update public.packages
  set approval_status = v_next_status,
      approval_revision = approval_revision + 1,
      decided_by = case when p_action in ('approve', 'reject') then p_actor_profile_id else null end,
      decided_at = case when p_action in ('approve', 'reject') then now() else null end,
      decision_note = nullif(trim(coalesce(p_note, '')), ''),
      proposed_by = case when p_action = 'return_to_draft' then p_actor_profile_id else proposed_by end,
      proposed_at = case when p_action = 'return_to_draft' then now() else proposed_at end
  where id = p_initiative_id
  returning * into v_initiative;

  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_profile_id, 'initiative.approval_' || p_action, 'initiative', p_initiative_id,
    jsonb_build_object('approvalStatus', v_before_status, 'revision', p_expected_revision),
    jsonb_build_object('approvalStatus', v_next_status, 'revision', v_initiative.approval_revision, 'note', p_note));

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
begin
  if p_action not in ('approve', 'reject', 'return_to_draft') or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'deliverable approval input is invalid';
  end if;

  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  if not found then raise exception using errcode = 'P0006', message = 'approval actor not found'; end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'deliverable not found'; end if;
  if v_task.task_type <> 'deliverable' then raise exception using errcode = '22023', message = 'task is not a deliverable'; end if;
  if v_task.approval_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'deliverable approval revision changed';
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
  if p_action in ('approve', 'reject') and v_task.approval_status <> 'proposed' then
    raise exception using errcode = 'P0003', message = 'deliverable is not proposed';
  end if;
  if p_action = 'approve' and v_initiative.approval_status <> 'approved' then
    raise exception using errcode = 'P0003', message = 'initiative must be approved first';
  end if;

  v_before_status := v_task.approval_status;
  v_next_status := case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'draft' end;
  update public.tasks
  set approval_status = v_next_status,
      approval_revision = approval_revision + 1,
      decided_by = case when p_action in ('approve', 'reject') then p_actor_profile_id else null end,
      decided_at = case when p_action in ('approve', 'reject') then now() else null end,
      decision_note = nullif(trim(coalesce(p_note, '')), ''),
      proposed_by = case when p_action = 'return_to_draft' then p_actor_profile_id else proposed_by end,
      proposed_at = case when p_action = 'return_to_draft' then now() else proposed_at end,
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
    when 'approve' then 'Deliverable freigegeben'
    when 'reject' then 'Deliverable abgelehnt'
    else 'Deliverable zur Überarbeitung zurückgegeben'
  end);
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_profile_id, 'task.approval_' || p_action, 'task', p_task_id,
    jsonb_build_object('approvalStatus', v_before_status, 'revision', p_expected_revision),
    jsonb_build_object('approvalStatus', v_next_status, 'revision', v_task.approval_revision, 'note', p_note));

  return to_jsonb(v_task);
end;
$$;

create or replace function public.create_planning_task_transaction(
  p_task_insert jsonb,
  p_relation_type text default null,
  p_related_task_id text default null,
  p_relation_note text default null,
  p_activity_message text default 'Task created',
  p_relation_activity_message text default null,
  p_notifications jsonb default '[]'::jsonb,
  p_actor_profile_id text default null,
  p_request_ip text default null,
  p_user_agent text default null,
  p_approve_now boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_task jsonb;
  v_clean_insert jsonb := coalesce(p_task_insert, '{}'::jsonb)
    - 'approval_status' - 'approval_revision' - 'proposed_by' - 'proposed_at'
    - 'decided_by' - 'decided_at' - 'decision_note';
  v_requested_approval_status text := nullif(p_task_insert->>'approval_status', '');
  v_requested_sprint_id text := nullif(p_task_insert->>'sprint_id', '');
begin
  perform set_config('app.actor_profile_id', coalesce(p_actor_profile_id, ''), true);
  v_result := public.create_task_transaction(
    v_clean_insert, p_relation_type, p_related_task_id, p_relation_note,
    p_activity_message, p_relation_activity_message, p_notifications,
    p_actor_profile_id, p_request_ip, p_user_agent
  );
  v_task := v_result->'task';

  if coalesce((v_result->>'replayed')::boolean, false) = false and v_task->>'task_type' = 'deliverable' then
    if v_requested_approval_status = 'approved' and not p_approve_now then
      update public.tasks as updated_task
      set approval_status = 'approved',
          approval_revision = greatest(coalesce((p_task_insert->>'approval_revision')::integer, 1), 1),
          sprint_id = v_requested_sprint_id,
          score_relevant = v_requested_sprint_id is not null
      where id = v_task->>'id'
      returning to_jsonb(updated_task.*) into v_task;
    else
      update public.tasks
      set proposed_by = coalesce(nullif(p_task_insert->>'proposed_by', ''), p_actor_profile_id),
          proposed_at = coalesce((p_task_insert->>'proposed_at')::timestamptz, proposed_at, now())
      where id = v_task->>'id';
    end if;
    if p_approve_now then
      v_task := public.decide_deliverable_approval_transaction(
        v_task->>'id', coalesce((v_task->>'approval_revision')::integer, 1),
        'approve', p_actor_profile_id, 'Bei Erstellung durch CEO freigegeben.'
      );
    elsif v_requested_approval_status <> 'approved' or v_requested_approval_status is null then
      select to_jsonb(task) into v_task from public.tasks as task where task.id = v_task->>'id';
    end if;
    v_result := jsonb_set(v_result, '{task}', v_task);
  end if;
  return v_result;
end;
$$;

create or replace function public.update_planning_task_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_task_patch jsonb default '{}'::jsonb,
  p_note_present boolean default false,
  p_note text default null,
  p_dependency_present boolean default false,
  p_dependency_note text default null,
  p_activity_messages text[] default '{}',
  p_notifications jsonb default '[]'::jsonb,
  p_actor_profile_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.actor_profile_id', coalesce(p_actor_profile_id, ''), true);
  return public.update_task_transaction(
    p_task_id, p_expected_updated_at, p_task_patch, p_note_present, p_note,
    p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
  );
end;
$$;

revoke all on function public.decide_initiative_approval_transaction(text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.decide_deliverable_approval_transaction(text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.create_planning_task_transaction(jsonb, text, text, text, text, text, jsonb, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.update_planning_task_transaction(text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb, text) from public, anon, authenticated;
grant execute on function public.decide_initiative_approval_transaction(text, integer, text, text, text) to service_role;
grant execute on function public.decide_deliverable_approval_transaction(text, integer, text, text, text) to service_role;
grant execute on function public.create_planning_task_transaction(jsonb, text, text, text, text, text, jsonb, text, text, text, boolean) to service_role;
grant execute on function public.update_planning_task_transaction(text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb, text) to service_role;

create or replace function public.create_team_task_intake_v2_transaction(
  p_token_id uuid,
  p_profile_id text,
  p_idempotency_key uuid,
  p_request_hash text,
  p_items jsonb,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_batch public.team_task_intake_batches%rowtype;
  v_role text;
  v_item jsonb;
  v_index integer;
  v_item_type text;
  v_id text;
  v_parent public.tasks%rowtype;
  v_initiative public.packages%rowtype;
  v_created_initiative public.packages%rowtype;
  v_task_insert jsonb;
  v_result jsonb;
  v_entity jsonb;
  v_ids text[] := array[]::text[];
  v_entities jsonb := '[]'::jsonb;
begin
  if p_token_id is null or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or p_idempotency_key is null or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception using errcode = '22023', message = 'team intake v2 input is invalid';
  end if;

  select * into v_token from public.team_task_intake_tokens
  where id = p_token_id and profile_id = p_profile_id and revoked_at is null and expires_at > now()
  for update;
  if not found then raise exception using errcode = 'P0004', message = 'team intake token is inactive'; end if;
  if not ('write:task-intake' = any(v_token.scopes)) then raise exception using errcode = 'P0005', message = 'team intake write scope is missing'; end if;

  select platform_role into v_role from public.profiles where id = p_profile_id for share;
  if not found or v_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'team intake profile role is not allowed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('team-intake-batch:' || p_token_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_batch from public.team_task_intake_batches
  where token_id = p_token_id and idempotency_key = p_idempotency_key;
  if found then
    if v_batch.request_hash <> p_request_hash then raise exception using errcode = 'P0003', message = 'idempotency key conflict'; end if;
    return jsonb_build_object('batchId', v_batch.id, 'replayed', true, 'items', v_batch.response_tasks);
  end if;

  for v_item, v_index in select value, ordinality::integer from jsonb_array_elements(p_items) with ordinality loop
    v_item_type := nullif(trim(v_item->>'itemType'), '');
    v_id := p_profile_id || '-team-intake-v2-' || replace(p_idempotency_key::text, '-', '') || '-' || v_index::text;
    if v_item_type = 'initiative' then
      if v_role not in ('ceo', 'deputy') then raise exception using errcode = 'P0006', message = 'initiative proposal requires ceo or deputy'; end if;
      insert into public.packages (
        id, project_id, milestone_id, owner_id, accountable_profile_id, responsible_profile_ids,
        consulted_profile_ids, informed_profile_ids, title, goal, priority, status, success_criteria,
        scope_constraints, sort_order, approval_status, approval_revision, proposed_by, proposed_at
      ) values (
        v_id, 'findmydoc-founder-execution', nullif(v_item->>'milestoneId', ''), nullif(v_item->>'ownerId', ''),
        nullif(v_item->>'accountableProfileId', ''), coalesce(array(select jsonb_array_elements_text(v_item->'responsibleProfileIds')), array[]::text[]),
        coalesce(array(select jsonb_array_elements_text(v_item->'consultedProfileIds')), array[]::text[]),
        coalesce(array(select jsonb_array_elements_text(v_item->'informedProfileIds')), array[]::text[]),
        trim(v_item->>'title'), coalesce(v_item->>'intendedOutcome', v_item->>'description', ''), coalesce(nullif(v_item->>'priority', ''), 'P2'),
        'planned', coalesce(v_item->>'acceptanceCriteria', ''), coalesce(v_item->>'scopeConstraints', ''),
        coalesce((select max(sort_order) + 1 from public.packages where project_id = 'findmydoc-founder-execution'), 1),
        'proposed', 1, p_profile_id, now()
      ) returning * into v_created_initiative;
      v_entity := to_jsonb(v_created_initiative);
      insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, after_data, request_ip, user_agent)
      values (p_profile_id, 'team.task_intake_v2.initiative_create', 'initiative', v_id, v_entity, p_request_ip, p_user_agent);
    elsif v_item_type in ('deliverable', 'sub_issue') then
      if v_item_type = 'deliverable' then
        select * into v_initiative from public.packages where id = nullif(v_item->>'packageId', '') for share;
        if not found then raise exception using errcode = 'P0002', message = 'team intake v2 initiative not found'; end if;
        if v_initiative.approval_status = 'rejected' then raise exception using errcode = 'P0003', message = 'team intake v2 initiative is rejected'; end if;
      else
        select * into v_parent from public.tasks where id = nullif(v_item->>'parentTaskId', '') and task_type = 'deliverable' for share;
        if not found then raise exception using errcode = 'P0002', message = 'team intake v2 parent deliverable not found'; end if;
      end if;
      if coalesce(nullif(v_item->>'githubRepo', ''), 'findmydoc-platform/management') not in (
        'findmydoc-platform/management', 'findmydoc-platform/website', 'findmydoc-platform/clinic-dashboard'
      ) then raise exception using errcode = '22023', message = 'team intake v2 github repository is not allowed'; end if;
      if v_item_type = 'deliverable'
         and coalesce(nullif(v_item->>'githubRepo', ''), 'findmydoc-platform/management') <> 'findmydoc-platform/management' then
        raise exception using errcode = '22023', message = 'team intake v2 deliverables must use the management repository';
      end if;

      v_task_insert := jsonb_build_object(
        'id', v_id, 'creation_request_id', 'team-v2:' || p_token_id::text || ':' || p_idempotency_key::text || ':' || v_index::text,
        'project_id', 'findmydoc-founder-execution', 'package_id', case when v_item_type = 'sub_issue' then v_parent.package_id else v_initiative.id end,
        'milestone_id', case when v_item_type = 'sub_issue' then v_parent.milestone_id else v_initiative.milestone_id end,
        'title', trim(v_item->>'title'), 'description', coalesce(v_item->>'description', ''),
        'problem_statement', coalesce(v_item->>'problemStatement', ''), 'intended_outcome', coalesce(v_item->>'intendedOutcome', ''),
        'scope_constraints', coalesce(v_item->>'scopeConstraints', ''), 'acceptance_criteria', coalesce(v_item->>'acceptanceCriteria', ''),
        'evidence_required', coalesce(v_item->>'evidenceRequired', ''), 'definition_of_done', coalesce(v_item->>'definitionOfDone', ''),
        'status', 'Offen', 'priority', coalesce(nullif(v_item->>'priority', ''), 'P2'),
        'owner', nullif(v_item->>'ownerId', ''), 'assignee', nullif(v_item->>'ownerId', ''), 'created_by', p_profile_id,
        'workstream', coalesce(v_item->>'workstream', ''), 'sort_order', 0, 'start_date', nullif(v_item->>'startDate', ''),
        'end_date', nullif(v_item->>'endDate', ''), 'deadline', nullif(v_item->>'deadline', ''), 'estimate_hours', coalesce((v_item->>'hours')::integer, 0),
        'sprint_id', null, 'review_status', 'not_requested', 'score_points', 0, 'score_final', false,
        'github_repo', case when v_item_type = 'sub_issue'
          then coalesce(nullif(v_item->>'githubRepo', ''), 'findmydoc-platform/management')
          else 'findmydoc-platform/management' end,
        'task_type', v_item_type, 'parent_task_id', case when v_item_type = 'sub_issue' then v_parent.id else null end,
        'approval_status', case when v_item_type = 'sub_issue' then null else 'proposed' end, 'approval_revision', 1,
        'proposed_by', case when v_item_type = 'deliverable' then p_profile_id else null end,
        'proposed_at', case when v_item_type = 'deliverable' then now() else null end, 'score_relevant', false
      );
      v_result := public.create_planning_task_transaction(v_task_insert, null, null, null,
        case when v_item_type = 'sub_issue' then 'Sub-Issue über Team Intake v2 erstellt' else 'Deliverable über Team Intake v2 vorgeschlagen' end,
        null, '[]'::jsonb, p_profile_id, p_request_ip, p_user_agent, false);
      v_entity := v_result->'task';
    else
      raise exception using errcode = '22023', message = 'team intake v2 item type is invalid';
    end if;
    v_ids := array_append(v_ids, v_id);
    v_entities := v_entities || jsonb_build_array(jsonb_build_object('itemType', v_item_type, 'item', v_entity));
  end loop;

  insert into public.team_task_intake_batches (token_id, profile_id, idempotency_key, request_hash, task_ids, response_tasks)
  values (p_token_id, p_profile_id, p_idempotency_key, p_request_hash, v_ids, v_entities) returning * into v_batch;
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, after_data, request_ip, user_agent)
  values (p_profile_id, 'team.task_intake_v2.commit', 'team_task_intake_batch', v_batch.id::text,
    jsonb_build_object('tokenId', p_token_id, 'entityIds', v_ids), p_request_ip, p_user_agent);
  return jsonb_build_object('batchId', v_batch.id, 'replayed', false, 'items', v_entities);
end;
$$;

revoke all on function public.create_team_task_intake_v2_transaction(uuid, text, uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.create_team_task_intake_v2_transaction(uuid, text, uuid, text, jsonb, text, text) to service_role;

notify pgrst, 'reload schema';
