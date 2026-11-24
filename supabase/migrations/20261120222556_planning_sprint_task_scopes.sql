-- Sprint has independent membership and assignment-discovery reads. A selected
-- membership receipt does not certify a Sprint assessment or completion basis.
create function workspace_private.advance_planning_sprint_support_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update workspace_private.planning_source_revision set revision=revision+1 where singleton;
  return null;
end
$$;
revoke all on function workspace_private.advance_planning_sprint_support_revision() from public, anon, authenticated, service_role;
do $$
declare source text;
begin
  foreach source in array array['task_notes','founder_sprint_scores','founder_strike_state','strike_events','score_objections','meetings','meeting_attendance'] loop
    execute format('create trigger planning_sprint_support_revision after insert or update or delete on public.%I for each statement execute function workspace_private.advance_planning_sprint_support_revision()',source);
  end loop;
end
$$;

create function public.planning_sprint_task_scope(
  p_actor_profile_id text, p_actor_user_id uuid, p_session_id uuid, p_platform_role text, p_deadline timestamptz,
  p_scope text, p_sprint_id text, p_filters jsonb, p_offset integer default 0,
  p_source_revision text default null, p_evaluated_at timestamptz default null
) returns jsonb language sql stable security definer set search_path = '' as $$
with recursive
admission as materialized (
  select profile.* from public.profiles profile
  join auth.sessions session on session.user_id=profile.auth_user_id and session.id=p_session_id
  where profile.auth_user_id=p_actor_user_id and profile.id=p_actor_profile_id and profile.platform_role=p_platform_role
    and profile.platform_role in ('ceo','deputy','founder','viewer')
    and (session.not_after is null or session.not_after>statement_timestamp()) and p_deadline>statement_timestamp()
), basis as materialized (
  select public.planning_source_version() as revision, coalesce(p_evaluated_at,statement_timestamp()) as evaluated_at,
    coalesce(p_filters,'{}'::jsonb) as filters from admission
), temporal as materialized (
  select basis.*,(basis.evaluated_at at time zone 'Europe/Berlin')::date as today,
    least(((basis.evaluated_at at time zone 'Europe/Berlin')::date + 1)::timestamp at time zone 'Europe/Berlin',
      case when admission.deputy_active_from>basis.evaluated_at then admission.deputy_active_from end,
      case when admission.deputy_active_until>basis.evaluated_at then admission.deputy_active_until end) as valid_until
  from basis cross join admission
), directory as materialized (
  select sprint.* from public.sprints sprint cross join admission
  where sprint.project_id='findmydoc-founder-execution'
), chosen as materialized (
  select sprint.id, sprint.review_due_at from directory sprint cross join temporal
  where p_sprint_id is null or sprint.id=p_sprint_id
  order by case when sprint.start_date<=temporal.today and sprint.end_date>=temporal.today then 0
    when sprint.status='active' then 1 when sprint.status in ('planning','review') then 2 else 3 end,
    sprint.start_date nulls last,sprint.id limit 1
), scoped as materialized (
  select task.id, task.task_type, task.parent_task_id,
    case when task.task_type='deliverable' then task.sprint_id end as sprint_id,
    coalesce(task.sort_order,0) as sort_order,coalesce(task.title,'') as title,
    public.planning_selection_status(task.status,task.task_type='sub_issue') as normalized_status,
    case when task.task_type='sub_issue' and btrim(coalesce(task.description,''))='' then coalesce(task.problem_statement,'') else coalesce(task.description,'') end as description,
    coalesce(nullif(task.assignee,''),nullif(task.owner,''),'') as assignee_id,
    coalesce(nullif(person.name,''),nullif(task.assignee,''),nullif(task.owner,''),'') as assignee_name,
    coalesce(sprint.name,'') as sprint_name,coalesce(task.workstream,'') as workstream,coalesce(task.priority,'') as priority,
    case task.priority when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 when 'P3' then 3 when 'P4' then 4 else 9 end as priority_rank,
    case when task.task_type='deliverable' then coalesce(task.review_status,'not_requested') else 'not_requested' end as review_status,
    case when task.task_type='deliverable' then coalesce(task.score_points,0) else 0 end as score_points,
    task.task_type='deliverable' and coalesce(task.score_final,false) as score_final,
    task.task_type='deliverable' and task.carried_from_sprint_id is not null and task.carried_from_sprint_id<>'' as carried,
    task.task_type='deliverable' and task.sprint_outcome is not null and task.sprint_outcome<>'' as outcome,
    (task.task_type in ('deliverable','sub_issue') and coalesce(task.github_issue_number,0)<>0
      or coalesce(task.issue_number,'')<>''
      or task.task_type in ('deliverable','sub_issue') and coalesce(task.github_issue_url,'') ~* '^https://github[.]com(:[0-9]+)?/[^/]+/[^/]+/(issues|pull)/[1-9][0-9]*(/|[?#]|$)'
      or coalesce(task.issue_url,'') ~* '^https://github[.]com(:[0-9]+)?/[^/]+/[^/]+/(issues|pull)/[1-9][0-9]*(/|[?#]|$)') as has_issue
  from public.active_tasks task cross join admission
  left join public.profiles person on person.id=coalesce(nullif(task.assignee,''),nullif(task.owner,''))
  left join directory sprint on task.task_type='deliverable' and sprint.id=task.sprint_id
  where task.project_id='findmydoc-founder-execution'
    and (p_scope='selected' and task.task_type='deliverable' and task.sprint_id=(select id from chosen)
      or p_scope='assignment' and (task.task_type<>'deliverable' or task.sprint_id is distinct from (select id from chosen)))
), matches as materialized (
  select scoped.*,
    case temporal.filters->>'sort' when 'title' then scoped.title when 'status' then scoped.normalized_status
      when 'assignee' then scoped.assignee_name when 'sprint' then scoped.sprint_name end as text_sort,
    case temporal.filters->>'sort' when 'score' then scoped.score_points when 'priority' then scoped.priority_rank end as number_sort,
    temporal.filters->>'direction'='desc' as descending
  from scoped cross join temporal
  where position(coalesce(temporal.filters->>'query','') in lower(concat_ws(' ',title,description,assignee_name,workstream,priority) collate "de-x-icu"))>0
    and (coalesce(temporal.filters->>'status','Alle')='Alle' or temporal.filters->>'status'=normalized_status)
    and (coalesce(temporal.filters->>'assignee','Alle')='Alle' or temporal.filters->>'assignee' in (assignee_id,assignee_name))
    and (coalesce(temporal.filters->>'risk','all')='all' or temporal.filters->>'risk'='github' and not has_issue
      or temporal.filters->>'risk'='carryover' and carried or temporal.filters->>'risk'='outcome' and outcome)
    and (coalesce(temporal.filters->>'review','all')='all' or temporal.filters->>'review'=review_status)
    and (coalesce(temporal.filters->>'score','all')='all' or temporal.filters->>'score'='final' and score_final
      or temporal.filters->>'score'='open' and not score_final)
), ordered as (
  select id,row_number() over(order by
    case when not descending then text_sort end collate public.planning_table_de,
    case when descending then text_sort end collate public.planning_table_de desc,
    case when not descending then number_sort end,
    case when descending then number_sort end desc,
    case when not descending then sort_order end,
    case when descending then sort_order end desc,
    id collate "C") as position from matches
), page as materialized (
  select id,position from ordered where p_scope='selected' or position>p_offset and position<=p_offset+20
), members as materialized (
  select id from scoped where p_scope='selected' union select id from page
), hierarchy(id,parent_task_id) as (
  select task.id,task.parent_task_id from public.active_tasks task join members on members.id=task.id
  union
  select parent.id,parent.parent_task_id from hierarchy child join public.active_tasks parent on parent.id=child.parent_task_id
  where parent.project_id='findmydoc-founder-execution'
), hydrated as materialized (
  select task.id,task.sort_order,to_jsonb(task) || jsonb_build_object(
    'task_dependencies',coalesce((select jsonb_agg(jsonb_build_object('note',dependency.note) order by dependency.id) from public.task_dependencies dependency where dependency.task_id=task.id),'[]'::jsonb),
    'task_notes',(select jsonb_build_object('note',note.note) from public.task_notes note where note.task_id=task.id),
    'links',coalesce((select jsonb_agg(to_jsonb(link) order by link.position,link.id) from public.task_links link where link.task_id=task.id),'[]'::jsonb),
    'strategy',(select to_jsonb(strategy) from public.planning_item_strategy strategy where strategy.task_id=task.id),
    'assignments',coalesce((select jsonb_agg(to_jsonb(assignment) order by assignment.sort_order,assignment.profile_id) from public.planning_item_raci_assignments assignment where assignment.task_id=task.id),'[]'::jsonb)
  ) as document from public.active_tasks task join hierarchy using(id)
), eligibility as materialized (
  select item.id,(select coalesce(jsonb_agg(target.id order by target.start_date,target.id),'[]'::jsonb)
    from directory target where not target.score_locked and target.id is distinct from item.sprint_id) as targets
  from page join public.active_tasks item using(id) cross join admission
  left join directory prior on prior.id=item.sprint_id
  where p_scope='assignment' and admission.platform_role in ('ceo','deputy') and item.task_type='deliverable'
    and item.approval_status='approved' and coalesce(item.owner,'')<>'' and item.status<>'Erledigt'
    and not (item.review_status='requested' and not item.score_final or item.review_status='accepted' and item.score_final)
    and (item.sprint_id is null or prior.id is not null and not prior.score_locked)
    and exists(select 1 from public.active_tasks parent where parent.id=item.parent_task_id and parent.task_type='initiative' and parent.approval_status='approved')
), sprint_counts as (
  select case when task.task_type='deliverable' then task.sprint_id end as sprint_id,count(*) as total
  from public.active_tasks task where p_scope='selected' and task.project_id='findmydoc-founder-execution'
  group by 1
), selected_model as (
  select jsonb_build_object(
    'project',(select jsonb_build_object('id',project.id,'name',project.name,'range_label',project.range_label,'review_objection_window_hours',project.review_objection_window_hours)
      from public.projects project where project.id='findmydoc-founder-execution'),
    'sprints',(select coalesce(jsonb_agg(to_jsonb(sprint)-'lock_result' order by sprint.start_date,sprint.id),'[]'::jsonb) from directory sprint),
    'commitments',(select coalesce(jsonb_agg(to_jsonb(commitment) order by commitment.profile_id,commitment.id),'[]'::jsonb) from public.sprint_commitments commitment join chosen on chosen.id=commitment.sprint_id),
    'scores',(select coalesce(jsonb_agg(to_jsonb(score) order by score.finalized_at desc,score.id),'[]'::jsonb) from public.founder_sprint_scores score join chosen on chosen.id=score.sprint_id),
    'strike_states',(select coalesce(jsonb_agg(to_jsonb(state) order by state.profile_id),'[]'::jsonb) from public.founder_strike_state state),
    'strike_events',(select coalesce(jsonb_agg(to_jsonb(event) order by event.created_at desc,event.id),'[]'::jsonb) from public.strike_events event join chosen on chosen.id=event.sprint_id),
    'objections',(select coalesce(jsonb_agg(to_jsonb(objection) order by objection.created_at desc,objection.id),'[]'::jsonb) from public.score_objections objection join chosen on chosen.id=objection.sprint_id),
    'meetings',(select coalesce(jsonb_agg(to_jsonb(meeting) order by meeting.meeting_at desc,meeting.id),'[]'::jsonb) from public.meetings meeting join chosen on chosen.id=meeting.sprint_id),
    'attendance',(select coalesce(jsonb_agg(to_jsonb(attendance) order by attendance.updated_at desc,attendance.id),'[]'::jsonb)
      from public.meeting_attendance attendance join public.meetings meeting on meeting.id=attendance.meeting_id join chosen on chosen.id=meeting.sprint_id)
  ) as document
  where p_scope='selected' and exists(select 1 from admission)
)
select case
  when not exists(select 1 from admission) then jsonb_build_object('status','forbidden')
  when p_scope not in ('selected','assignment') or p_scope='assignment' and p_sprint_id is null
    or p_offset<0 or p_offset>10000000 or p_scope='selected' and p_offset<>0 then jsonb_build_object('status','unavailable')
  when p_sprint_id is not null and not exists(select 1 from chosen) then jsonb_build_object('status','notFound')
  when p_source_revision is not null and p_source_revision is distinct from (select revision from temporal)
    or (select valid_until from temporal)<=statement_timestamp() or p_offset>(select count(*) from matches)
    then jsonb_build_object('status','staleContinuation')
  else jsonb_build_object(
    'status','ready','sprint_id',(select id from chosen),'source_revision',(select revision from temporal),
    'evaluated_at',(select evaluated_at from temporal),
    'valid_until',(select least(temporal.valid_until,(select review_due_at from chosen where review_due_at>temporal.evaluated_at)) from temporal),
    'scope_total',(select count(*) from scoped),'matched_total',(select count(*) from matches),
    'member_ids',(select coalesce(jsonb_agg(id order by coalesce(sort_order,0),id collate "C"),'[]'::jsonb) from scoped where p_scope='selected'),
    'page_ids',(select coalesce(jsonb_agg(id order by position),'[]'::jsonb) from page),
    'rows',(select coalesce(jsonb_agg(hydrated.document order by hydrated.id),'[]'::jsonb) from hydrated),
    'profiles',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'platform_role',platform_role,'org_role',org_role,'github_login',github_login,'deputy_for',deputy_for,'deputy_active_from',deputy_active_from,'deputy_active_until',deputy_active_until,'focus',focus,'weekly_capacity',weekly_capacity,'profile_color',profile_color) order by name,id),'[]'::jsonb)
      from public.profiles where p_scope='selected' or exists(select 1 from hydrated where public.profiles.id in (hydrated.document->>'assignee',hydrated.document->>'owner',hydrated.document->>'created_by',hydrated.document->>'review_owner_profile_id'))),
    'unassigned_total',case when p_scope='selected' then coalesce((select total from sprint_counts where sprint_id is null),0) end,
    'sprint_counts',case when p_scope='selected' then (select coalesce(jsonb_object_agg(sprint_id,total),'{}'::jsonb) from sprint_counts where sprint_id is not null) end,
    'assignment_targets',(select coalesce(jsonb_object_agg(id,targets),'{}'::jsonb) from eligibility),
    'model',(select document from selected_model)
  ) end;
$$;
revoke all on function public.planning_sprint_task_scope(text,uuid,uuid,text,timestamptz,text,text,jsonb,integer,text,timestamptz) from public, anon, authenticated;
grant execute on function public.planning_sprint_task_scope(text,uuid,uuid,text,timestamptz,text,text,jsonb,integer,text,timestamptz) to service_role;
