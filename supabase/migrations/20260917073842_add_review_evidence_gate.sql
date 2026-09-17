alter table public.tasks
  add column if not exists review_evidence_exception_note text,
  add column if not exists review_evidence_exception_confirmed_at timestamptz;

alter table public.tasks
  drop constraint if exists tasks_review_evidence_exception_check;

alter table public.tasks
  add constraint tasks_review_evidence_exception_check check (
    (review_evidence_exception_note is null and review_evidence_exception_confirmed_at is null)
    or (
      nullif(trim(review_evidence_exception_note), '') is not null
      and char_length(review_evidence_exception_note) <= 2000
      and review_evidence_exception_confirmed_at is not null
    )
  );

comment on column public.tasks.review_evidence_exception_note is
  'Required explanation for the current review request when no manual evidence link or linked pull request exists.';

comment on column public.tasks.review_evidence_exception_confirmed_at is
  'Timestamp of the explicit no-link confirmation for the current review request.';

create or replace function public.has_valid_planning_review_evidence(p_task_id text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.tasks
    where id = p_task_id
      and evidence_link ~* '^https?://'
  ) or exists (
    select 1
    from public.task_links
    where task_id = p_task_id
      and type in ('evidence', 'github_pull_request')
      and url ~* '^https?://'
      and (
        type = 'evidence'
        or (
          nullif(trim(metadata->>'repository'), '') is not null
          and metadata->>'number' ~ '^[1-9][0-9]*$'
          and metadata->>'status' in ('open', 'merged', 'closed')
        )
      )
  );
$$;

revoke all on function public.has_valid_planning_review_evidence(text) from public;
grant execute on function public.has_valid_planning_review_evidence(text) to service_role;

create or replace function public.enforce_task_review_evidence_gate()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_enters_review boolean;
  v_leaves_review boolean;
  v_has_evidence boolean;
begin
  if new.task_type <> 'deliverable' then
    return new;
  end if;

  v_enters_review := (
    (new.status = 'Review' and old.status is distinct from 'Review')
    or (new.review_status = 'requested' and old.review_status is distinct from 'requested')
  );
  v_leaves_review := (
    (old.status = 'Review' or old.review_status = 'requested')
    and new.status is distinct from 'Review'
    and new.review_status is distinct from 'requested'
  );
  v_has_evidence := public.has_valid_planning_review_evidence(new.id)
    or coalesce(new.evidence_link, '') ~* '^https?://';

  if v_enters_review
     and not v_has_evidence
     and (
       nullif(trim(coalesce(new.review_evidence_exception_note, '')), '') is null
       or new.review_evidence_exception_confirmed_at is null
     ) then
    raise exception using
      errcode = 'P0017',
      message = 'review evidence or an explicit exception note is required';
  end if;

  if v_enters_review and v_has_evidence then
    new.review_evidence_exception_note := null;
    new.review_evidence_exception_confirmed_at := null;
  elsif v_leaves_review then
    new.review_evidence_exception_note := null;
    new.review_evidence_exception_confirmed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_review_evidence_gate on public.tasks;
create trigger tasks_review_evidence_gate
before update of status, review_status on public.tasks
for each row
execute function public.enforce_task_review_evidence_gate();

create or replace function public.mutate_planning_review_command_transaction_v2(
  p_action text,
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_actor_profile_id text,
  p_reviewer_profile_id text,
  p_decision text,
  p_comment text,
  p_checklist jsonb,
  p_points integer,
  p_reason text,
  p_evidence_links jsonb default '[]'::jsonb,
  p_evidence_exception_note text default null,
  p_activity_messages text[] default '{}'::text[],
  p_notifications jsonb default '[]'::jsonb,
  p_audit_after_data jsonb default '{}'::jsonb,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_evidence boolean;
begin
  if jsonb_typeof(coalesce(p_evidence_links, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'review evidence links must be an array';
  end if;

  if p_action in ('request', 'reopen') and jsonb_array_length(coalesce(p_evidence_links, '[]'::jsonb)) > 0 then
    perform public.replace_task_evidence_links(p_task_id, p_evidence_links);
  end if;

  if p_action in ('request', 'reopen') then
    v_has_evidence := public.has_valid_planning_review_evidence(p_task_id);
    if not v_has_evidence and nullif(trim(coalesce(p_evidence_exception_note, '')), '') is null then
      raise exception using errcode = 'P0017', message = 'review evidence or an explicit exception note is required';
    end if;
    update public.tasks
    set review_evidence_exception_note = case when v_has_evidence then null else trim(p_evidence_exception_note) end,
        review_evidence_exception_confirmed_at = case when v_has_evidence then null else clock_timestamp() end
    where id = p_task_id;
  end if;

  return public.mutate_planning_review_command_transaction(
    p_action,
    p_task_id,
    p_expected_updated_at,
    p_actor_profile_id,
    p_reviewer_profile_id,
    p_decision,
    p_comment,
    p_checklist,
    p_points,
    p_reason,
    p_activity_messages,
    p_notifications,
    p_audit_after_data,
    p_request_ip,
    p_user_agent
  );
end;
$$;

revoke all on function public.mutate_planning_review_command_transaction_v2(
  text, text, timestamptz, text, text, text, text, jsonb, integer, text,
  jsonb, text, text[], jsonb, jsonb, text, text
) from public;
grant execute on function public.mutate_planning_review_command_transaction_v2(
  text, text, timestamptz, text, text, text, text, jsonb, integer, text,
  jsonb, text, text[], jsonb, jsonb, text, text
) to service_role;

create or replace function public.update_team_planning_item_with_review_evidence_transaction_v1(
  p_token_id uuid,
  p_profile_id text,
  p_item_type text,
  p_item_id text,
  p_expected_updated_at timestamptz,
  p_idempotency_key uuid,
  p_request_hash text,
  p_patch jsonb default '{}'::jsonb,
  p_changed_fields jsonb default '[]'::jsonb,
  p_system_effects jsonb default '[]'::jsonb,
  p_projection_command jsonb default null,
  p_evidence_exception_note text default null,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_evidence boolean;
begin
  if p_item_type = 'deliverable' and p_patch->>'status' = 'Review' then
    v_has_evidence := public.has_valid_planning_review_evidence(p_item_id)
      or coalesce(p_patch->>'evidenceLink', '') ~* '^https?://';
    if not v_has_evidence
       and nullif(trim(coalesce(p_evidence_exception_note, '')), '') is null then
      raise exception using errcode = 'P0017', message = 'review evidence or an explicit exception note is required';
    end if;
    update public.tasks
    set review_evidence_exception_note = case
          when v_has_evidence then null
          else trim(p_evidence_exception_note)
        end,
        review_evidence_exception_confirmed_at = case
          when v_has_evidence then null
          else clock_timestamp()
        end
    where id = p_item_id
      and updated_at = p_expected_updated_at
      and status is distinct from 'Review';
  end if;

  return public.update_team_planning_item_with_projection_transaction(
    p_token_id,
    p_profile_id,
    p_item_type,
    p_item_id,
    p_expected_updated_at,
    p_idempotency_key,
    p_request_hash,
    p_patch,
    p_changed_fields,
    p_system_effects,
    p_projection_command,
    p_request_ip,
    p_user_agent
  );
end;
$$;

revoke all on function public.update_team_planning_item_with_review_evidence_transaction_v1(
  uuid, text, text, text, timestamptz, uuid, text, jsonb, jsonb, jsonb, jsonb, text, text, text
) from public;
grant execute on function public.update_team_planning_item_with_review_evidence_transaction_v1(
  uuid, text, text, text, timestamptz, uuid, text, jsonb, jsonb, jsonb, jsonb, text, text, text
) to service_role;

create or replace view public.active_tasks with (security_invoker = true) as
select
  id,
  project_id,
  title,
  description,
  status,
  priority,
  owner,
  assignee,
  workstream,
  sort_order,
  start_date,
  end_date,
  deadline,
  estimate_hours,
  definition_of_done,
  evidence_link,
  issue_number,
  issue_url,
  watched,
  updated_at,
  sprint_id,
  review_status,
  score_points,
  score_final,
  github_repo,
  github_issue_number,
  github_issue_url,
  github_issue_sync_status,
  github_issue_last_synced_at,
  github_issue_sync_error,
  task_type,
  parent_task_id,
  score_relevant,
  original_sprint_id,
  carried_from_task_id,
  carried_from_sprint_id,
  carryover_reason,
  carryover_count,
  sprint_outcome,
  self_dod_checked,
  self_evidence_checked,
  self_documented_checked,
  self_blockers_checked,
  problem_statement,
  intended_outcome,
  scope_constraints,
  acceptance_criteria,
  evidence_required,
  dod_template_version,
  created_by,
  review_owner_profile_id,
  review_requested_at,
  intake_source,
  intake_status,
  intake_decided_by,
  intake_decided_at,
  intake_decision_note,
  creation_request_id,
  creation_request_payload,
  approval_status,
  approval_revision,
  proposed_by,
  proposed_at,
  decided_by,
  decided_at,
  decision_note,
  trashed_at,
  trashed_by,
  trash_reason,
  trash_cause,
  purge_after,
  trash_root_type,
  trash_root_id,
  trash_revision,
  target_date,
  created_at,
  fixed_date,
  review_evidence_exception_note,
  review_evidence_exception_confirmed_at
from public.tasks task
where task.trashed_at is null;
