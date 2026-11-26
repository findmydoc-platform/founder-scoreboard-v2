-- The old Completion endpoint can address non-FounderOps Sprints too. Advance
-- the shared revision for their additional task/blocker and window inputs.
create function workspace_private.advance_external_sprint_completion_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  previous jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  following jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  changed boolean := false;
begin
  if previous is not distinct from following then return null; end if;
  case tg_table_name
    when 'tasks' then
      changed := exists (select 1 from (values (previous),(following)) as rows(item)
        where item->>'project_id' <> 'findmydoc-founder-execution'
          and item->>'sprint_id' is not null and item->>'trashed_at' is null);
    when 'task_blockers' then
      changed := exists (select 1 from public.active_tasks task
        where task.project_id <> 'findmydoc-founder-execution' and task.sprint_id is not null
          and task.id in (previous->>'task_id',following->>'task_id'));
    when 'projects' then
      changed := previous->>'id' <> 'findmydoc-founder-execution'
        and (previous->'review_objection_window_hours') is distinct from (following->'review_objection_window_hours');
  end case;
  if changed then update workspace_private.planning_source_revision set revision = revision + 1 where singleton; end if;
  return null;
end;
$$;
revoke all on function workspace_private.advance_external_sprint_completion_revision() from public, anon, authenticated, service_role;
create trigger planning_external_sprint_completion_revision after insert or update or delete on public.tasks
for each row execute function workspace_private.advance_external_sprint_completion_revision();
create trigger planning_external_sprint_completion_revision after insert or update or delete on public.task_blockers
for each row execute function workspace_private.advance_external_sprint_completion_revision();
create trigger planning_external_sprint_completion_revision after update of review_objection_window_hours on public.projects
for each row execute function workspace_private.advance_external_sprint_completion_revision();
create trigger planning_external_sprint_completion_project_scope after update of project_id on public.sprints
for each row when (old.project_id is distinct from new.project_id
  and old.project_id <> 'findmydoc-founder-execution' and new.project_id <> 'findmydoc-founder-execution')
execute function workspace_private.advance_planning_sprint_support_revision();

-- Publication remains an independent original-JWT check with the same CEO
-- action policy and per-request Workspace admission as Completion itself.
create function public.planning_sprint_completion_publication_context(p_sprint_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor jsonb;
begin
  if not coalesce(public.workspace_request_admitted(), false) then
    raise insufficient_privilege using message = 'Sprint completion access denied';
  end if;
  actor := public.planning_board_publication_context();
  if actor->>'platform_role' is distinct from 'ceo' then
    raise insufficient_privilege using message = 'Sprint completion access denied';
  end if;
  if not exists(select 1 from public.sprints where id = p_sprint_id) then
    return jsonb_build_object('status','notFound');
  end if;
  return actor || jsonb_build_object('status','ready');
end;
$$;
revoke all on function public.planning_sprint_completion_publication_context(text) from public, anon, service_role;
grant execute on function public.planning_sprint_completion_publication_context(text) to authenticated;

create function public.planning_sprint_completion_snapshot(
  p_sprint_id text, p_actor_profile_id text, p_actor_user_id uuid, p_session_id uuid, p_deadline timestamptz
) returns jsonb language sql stable security definer set search_path = '' as $$
with admission as materialized (
  select statement_timestamp() as evaluated_at
  from public.profiles profile
  join auth.sessions session on session.id=p_session_id and session.user_id=profile.auth_user_id
  where profile.id=p_actor_profile_id and profile.auth_user_id=p_actor_user_id and profile.platform_role='ceo'
    and (session.not_after is null or session.not_after>statement_timestamp()) and p_deadline>statement_timestamp()
), sprint as materialized (
  select sprint.id,sprint.project_id,sprint.name,sprint.status,sprint.start_date,sprint.end_date,sprint.review_due_at,
    sprint.score_locked,sprint.updated_at,sprint.lock_result
  from public.sprints sprint cross join admission where sprint.id=p_sprint_id
), timing as materialized (
  select evaluated_at,public.planning_source_version() as revision,
    least(p_deadline,case when due_at>evaluated_at then due_at end) as valid_until,due_at
  from admission cross join lateral (
    select coalesce(sprint.review_due_at,
      ((sprint.end_date+time '23:59:59.999') at time zone 'Europe/Berlin')
        + make_interval(hours=>coalesce(project.review_objection_window_hours,48))) as due_at
    from sprint join public.projects project on project.id=sprint.project_id
  ) as boundaries
), outstanding as (
  select count(*) as total
  from public.score_objections objection join sprint on sprint.id=objection.sprint_id
  where objection.status='open' or (objection.second_reviewer_profile_id is not null and objection.second_reviewed_at is null)
), next_sprint as (
  select candidate.id from public.sprints candidate, sprint
  where candidate.id<>sprint.id and candidate.start_date>coalesce(sprint.start_date,date '1900-01-01')
  order by candidate.start_date,candidate.id limit 1
), tasks as materialized (
  select item.id,item.project_id,item.parent_task_id,item.title,item.description,item.status,item.priority,item.owner,item.assignee,
    item.workstream,item.sort_order,item.estimate_hours,item.definition_of_done,item.evidence_link,item.issue_number,item.issue_url,
    item.github_issue_number,item.github_issue_url,item.sprint_id,item.review_status,item.score_points,item.score_final,item.task_type,
    item.approval_status,item.score_relevant,item.carryover_count,item.original_sprint_id,item.problem_statement,item.intended_outcome,
    item.scope_constraints,item.acceptance_criteria,item.evidence_required,item.dod_template_version,item.sprint_outcome,item.updated_at
  from public.active_tasks item join sprint on sprint.id=item.sprint_id
  where not sprint.score_locked
), meetings as materialized (
  select meeting.id,meeting.sprint_id,meeting.title,meeting.meeting_at,meeting.duration_minutes,meeting.status,meeting.agenda
  from public.meetings meeting join sprint on sprint.id=meeting.sprint_id
)
select case
  when not exists(select 1 from admission) then jsonb_build_object('status','forbidden')
  when not exists(select 1 from sprint) then jsonb_build_object('status','notFound')
  when not exists(select 1 from timing where revision is not null and valid_until>statement_timestamp())
    then jsonb_build_object('status','unavailable')
  else jsonb_build_object(
    'status','ready',
    'source_revision',(select revision from timing),
    'evaluated_at',(select evaluated_at from timing),
    'valid_until',(select valid_until from timing),
    'review_due_at',(select due_at from timing),
    'open_objections',(select total from outstanding),
    'next_sprint_id',(select id from next_sprint),
    'sprint',(select to_jsonb(sprint) from sprint),
    'tasks',(select coalesce(jsonb_agg(to_jsonb(tasks) order by tasks.id),'[]'::jsonb) from tasks)
  ) || case when (select score_locked from sprint) then '{}'::jsonb else jsonb_build_object(
    'accepted_adjustments',(select coalesce(jsonb_agg(jsonb_build_object('profile_id',objection.profile_id,
      'resolved_delivery_points',objection.resolved_delivery_points,'resolved_form_points',objection.resolved_form_points,
      'resolved_weekly_points',objection.resolved_weekly_points) order by objection.reviewed_at desc,objection.id),'[]'::jsonb)
      from public.score_objections objection join sprint on sprint.id=objection.sprint_id
      where objection.status='accepted' and objection.resolved_delivery_points is not null),
    'blocker_task_ids',(select coalesce(jsonb_agg(distinct blocker.task_id),'[]'::jsonb)
      from public.task_blockers blocker join tasks on tasks.id=blocker.task_id where blocker.status='open'),
    'profiles',(select coalesce(jsonb_agg(jsonb_build_object('id',profile.id,'name',profile.name,
      'platform_role',profile.platform_role,'weekly_capacity',profile.weekly_capacity) order by profile.id),'[]'::jsonb) from public.profiles profile),
    'commitments',(select coalesce(jsonb_agg(to_jsonb(commitment) order by commitment.profile_id,commitment.id),'[]'::jsonb)
      from public.sprint_commitments commitment join sprint on sprint.id=commitment.sprint_id),
    'meetings',(select coalesce(jsonb_agg(to_jsonb(meetings) order by meetings.meeting_at,meetings.id),'[]'::jsonb) from meetings),
    'attendance',(select coalesce(jsonb_agg(to_jsonb(attendance) order by attendance.meeting_id,attendance.profile_id,attendance.id),'[]'::jsonb)
      from public.meeting_attendance attendance join meetings on meetings.id=attendance.meeting_id),
    'strike_states',(select coalesce(jsonb_agg(to_jsonb(state) order by state.profile_id),'[]'::jsonb) from public.founder_strike_state state)
  ) end end;
$$;
revoke all on function public.planning_sprint_completion_snapshot(text,text,uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.planning_sprint_completion_snapshot(text,text,uuid,uuid,timestamptz) to service_role;

-- Acquire the legacy project/Sprint/task locks first. The Planning revision
-- fences all current support inputs and preserves the existing stored replay.
create function public.commit_sprint_completion_basis(
  p_sprint_id text, p_expected_updated_at timestamptz, p_task_updates jsonb, p_accepted_blocker_task_ids text[],
  p_carryover_inserts jsonb, p_notifications jsonb, p_score_rows jsonb, p_strike_state_rows jsonb,
  p_strike_events jsonb, p_result_data jsonb, p_actor_profile_id text, p_request_ip text, p_user_agent text,
  p_actor_user_id uuid, p_session_id uuid, p_deadline timestamptz, p_valid_until timestamptz, p_source_revision text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target public.sprints;
  locked_project_id text;
  revision text;
begin
  select sprint.project_id into locked_project_id from public.sprints sprint where sprint.id=p_sprint_id;
  if not found then raise sqlstate 'P0002' using message='Sprint not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('founderops-review-window:' || locked_project_id,0));
  perform 1 from public.projects project where project.id=locked_project_id for share;
  if not found then raise sqlstate 'P0002' using message='Sprint project not found'; end if;
  select * into target from public.sprints sprint where sprint.id=p_sprint_id and sprint.project_id=locked_project_id for update;
  if not found then raise sqlstate 'P0002' using message='Sprint not found'; end if;
  perform 1 from public.profiles profile where profile.id=p_actor_profile_id and profile.auth_user_id=p_actor_user_id
    and profile.platform_role='ceo' for share;
  if not found then raise insufficient_privilege using message='Sprint completion permission changed'; end if;
  perform 1 from auth.sessions session where session.id=p_session_id and session.user_id=p_actor_user_id
    and (session.not_after is null or session.not_after>clock_timestamp()) for share;
  if not found then raise insufficient_privilege using message='Sprint completion session changed'; end if;

  if not target.score_locked then
    if target.updated_at is distinct from p_expected_updated_at then
      raise sqlstate 'P0001' using message='Sprint changed concurrently';
    end if;
    begin
      perform 1 from public.tasks task where task.sprint_id=p_sprint_id order by task.id for update nowait;
      select source.revision::text into revision from workspace_private.planning_source_revision source
      where source.singleton for update nowait;
    exception when lock_not_available then
      raise sqlstate 'P0021' using message='Sprint completion inputs changed concurrently';
    end;
    if revision is null or revision is distinct from p_source_revision
      or p_deadline is null or p_deadline<=clock_timestamp() or p_valid_until is null or p_valid_until<=clock_timestamp()
      or jsonb_typeof(p_result_data->'_planning_lock_basis') is distinct from 'array' then
      raise sqlstate 'P0021' using message='Sprint completion basis is stale';
    end if;
  end if;
  return public.lock_sprint_with_review_window_transaction(p_sprint_id,p_expected_updated_at,p_task_updates,
    p_accepted_blocker_task_ids,p_carryover_inserts,p_notifications,p_score_rows,p_strike_state_rows,p_strike_events,
    p_result_data,p_actor_profile_id,p_request_ip,p_user_agent);
end;
$$;
revoke all on function public.commit_sprint_completion_basis(
  text,timestamptz,jsonb,text[],jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,text,uuid,uuid,timestamptz,timestamptz,text
) from public, anon, authenticated;
grant execute on function public.commit_sprint_completion_basis(
  text,timestamptz,jsonb,text[],jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,text,uuid,uuid,timestamptz,timestamptz,text
) to service_role;
