-- Sprint assessment uses the existing transactional Planning revision. The
-- Sprint support triggers already advance it for meetings, attendance,
-- persisted scores, strike state and objections.
create trigger planning_sprint_project_scope_revision after update of project_id on public.sprints
for each row when (old.project_id is distinct from new.project_id
  and (old.project_id = 'findmydoc-founder-execution' or new.project_id = 'findmydoc-founder-execution'))
execute function workspace_private.advance_planning_sprint_support_revision();

-- Original-user publication and refresh observation: check live admission and
-- the chosen Sprint's scope with only identity and revision metadata.
create function public.planning_sprint_assessment_publication_context(p_sprint_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor jsonb;
begin
  if not coalesce(public.workspace_request_admitted(), false) then
    raise insufficient_privilege using message = 'Sprint assessment access denied';
  end if;
  actor := public.planning_board_publication_context();
  if not exists(select 1 from public.sprints where id = p_sprint_id and project_id = 'findmydoc-founder-execution') then
    return jsonb_build_object('status','notFound');
  end if;
  return actor || jsonb_build_object('status','ready');
end;
$$;
revoke all on function public.planning_sprint_assessment_publication_context(text) from public, anon, service_role;
grant execute on function public.planning_sprint_assessment_publication_context(text) to authenticated;

-- A single snapshot reads complete sets for one Sprint. Only fields used by
-- the existing score view model and its established mappers cross to the server.
create function public.planning_sprint_assessment_snapshot(
  p_sprint_id text, p_actor_profile_id text, p_actor_user_id uuid, p_session_id uuid,
  p_platform_role text, p_deadline timestamptz
) returns jsonb language sql stable security definer set search_path = '' as $$
with admission as materialized (
  select profile.deputy_active_from,profile.deputy_active_until,statement_timestamp() as evaluated_at
  from public.profiles profile
  join auth.sessions session on session.user_id=profile.auth_user_id and session.id=p_session_id
  where profile.id=p_actor_profile_id and profile.auth_user_id=p_actor_user_id and profile.platform_role=p_platform_role
    and profile.platform_role in ('ceo','deputy','founder','viewer')
    and (session.not_after is null or session.not_after>statement_timestamp()) and p_deadline>statement_timestamp()
), sprint as materialized (
  select selected.id,selected.project_id,selected.name,selected.status,selected.start_date,selected.end_date,
    selected.review_due_at,selected.score_locked,selected.updated_at
  from public.sprints selected cross join admission
  where selected.id=p_sprint_id and selected.project_id='findmydoc-founder-execution'
), project as materialized (
  select project.id,project.name,project.range_label,project.review_objection_window_hours
  from public.projects project join sprint on sprint.project_id=project.id
), boundaries as (
  select admission.*, public.planning_source_version() as source,
    ((admission.evaluated_at at time zone 'Europe/Berlin')::date+1)::timestamp at time zone 'Europe/Berlin' as midnight,
    sprint.start_date::timestamp at time zone 'Europe/Berlin' as sprint_start,
    (sprint.end_date+time '23:59:59.999') at time zone 'Europe/Berlin' as sprint_end,
    coalesce(sprint.review_due_at, ((sprint.end_date+time '23:59:59.999') at time zone 'Europe/Berlin')
      + make_interval(hours=>coalesce(project.review_objection_window_hours,48))) as review_due
  from admission cross join sprint cross join project
), assessment_time as materialized (
  select evaluated_at,source,least(p_deadline,midnight,
    case when sprint_start>evaluated_at then sprint_start end,
    case when sprint_end>evaluated_at then sprint_end end,
    case when review_due>evaluated_at then review_due end,
    case when deputy_active_from>evaluated_at then deputy_active_from end,
    case when deputy_active_until>evaluated_at then deputy_active_until end) as valid_until
  from boundaries
), items as materialized (
  select item.id,item.task_type,item.sprint_id,item.owner,item.assignee,item.definition_of_done,item.evidence_link,item.issue_url,
    item.github_issue_url,item.review_status,item.status,item.sprint_outcome,item.score_final,item.score_points,item.estimate_hours,
    item.approval_status,item.score_relevant
  from public.active_tasks item join sprint on sprint.id=item.sprint_id and sprint.project_id=item.project_id
  where item.task_type='deliverable'
), profiles as (
  select person.id,person.name,person.platform_role,person.org_role,person.github_login,person.deputy_for,
    person.deputy_active_from,person.deputy_active_until,person.focus,person.weekly_capacity,person.profile_color
  from public.profiles person cross join assessment_time
), meetings as materialized (
  select meeting.id,meeting.sprint_id,meeting.title,meeting.meeting_at,meeting.duration_minutes,meeting.status,meeting.agenda
  from public.meetings meeting join sprint on sprint.id=meeting.sprint_id
)
select case
  when not exists(select 1 from admission) then jsonb_build_object('status','forbidden')
  when not exists(select 1 from sprint) then jsonb_build_object('status','notFound')
  when not exists(select 1 from assessment_time where source is not null and valid_until>statement_timestamp())
    then jsonb_build_object('status','unavailable')
  else jsonb_build_object(
    'status','ready','sprint_id',p_sprint_id,
    'source_revision',(select source from assessment_time),
    'evaluated_at',(select evaluated_at from assessment_time),
    'valid_until',(select valid_until from assessment_time),
    'sprint',(select to_jsonb(sprint) from sprint),
    'project',(select to_jsonb(project) from project),
    'profiles',(select coalesce(jsonb_agg(to_jsonb(profiles) order by profiles.name,profiles.id),'[]'::jsonb) from profiles),
    'items',(select coalesce(jsonb_agg(to_jsonb(items) order by items.id),'[]'::jsonb) from items),
    'links',(select coalesce(jsonb_agg(jsonb_build_object('id',link.id,'task_id',link.task_id,'type',link.type,
      'label',link.label,'url',link.url,'position',link.position) order by link.task_id,link.position,link.id),'[]'::jsonb)
      from public.task_links link join items on items.id=link.task_id where link.type='evidence'),
    'commitments',(select coalesce(jsonb_agg(to_jsonb(commitment) order by commitment.profile_id,commitment.id),'[]'::jsonb)
      from public.sprint_commitments commitment join sprint on sprint.id=commitment.sprint_id),
    'scores',(select coalesce(jsonb_agg(to_jsonb(score) order by score.finalized_at desc,score.id),'[]'::jsonb)
      from public.founder_sprint_scores score join sprint on sprint.id=score.sprint_id),
    'strike_states',(select coalesce(jsonb_agg(to_jsonb(state) order by state.profile_id,state.id),'[]'::jsonb)
      from public.founder_strike_state state cross join assessment_time),
    'objections',(select coalesce(jsonb_agg(to_jsonb(objection) order by objection.created_at desc,objection.id),'[]'::jsonb)
      from public.score_objections objection join sprint on sprint.id=objection.sprint_id),
    'meetings',(select coalesce(jsonb_agg(to_jsonb(meetings) order by meetings.meeting_at desc,meetings.id),'[]'::jsonb) from meetings),
    'attendance',(select coalesce(jsonb_agg(to_jsonb(attendance) order by attendance.updated_at desc,attendance.id),'[]'::jsonb)
      from public.meeting_attendance attendance join meetings on meetings.id=attendance.meeting_id)
  ) end;
$$;
revoke all on function public.planning_sprint_assessment_snapshot(text,text,uuid,uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.planning_sprint_assessment_snapshot(text,text,uuid,uuid,text,timestamptz) to service_role;
