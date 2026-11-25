-- Keep selected membership and its existing bounded hydration in one source snapshot.
-- Field projections match the existing Task/Profile/Sprint HTTP hydrator exactly.
create or replace function public.planning_backlog_selection(
  p_actor_profile_id text, p_filters jsonb, p_limit integer default 20,
  p_offset integer default 0, p_source_revision text default null,
  p_evaluated_at timestamptz default null, p_valid_until timestamptz default null
) returns jsonb language sql stable security definer set search_path = '' as $$
with recursive
basis as materialized (
  select public.planning_source_version() as source_revision,
    coalesce(p_evaluated_at,statement_timestamp()) as observed_at,p_filters as filters
), boundaries as (
  select (current_date+1)::timestamptz as at
  union all select deputy_active_from from public.profiles
  union all select deputy_active_until from public.profiles
), temporal as (
  select coalesce(p_valid_until,(select min(at) from boundaries where at>statement_timestamp())) as valid_until
), active as not materialized (
  select * from public.active_tasks where project_id='findmydoc-founder-execution'
), eligible as materialized (
  select item.*,public.planning_selection_status(item.status,false) as normalized,
    coalesce(nullif(item.assignee,''),nullif(item.owner,''),'') as assignee_id,
    coalesce(nullif(person.name,''),nullif(item.assignee,''),nullif(item.owner,''),'') as assignee_name,
    coalesce(initiative.title,'') as initiative_title,
    (coalesce(item.approval_status,'proposed')='approved'
      and (btrim(coalesce(item.assignee,''))<>'' or btrim(coalesce(item.owner,''))<>'')
      and initiative.id is not null) as structurally_ready,
    row_number() over(order by item.sort_order,
      (case when coalesce(p_filters->>'level','deliverable')<>'deliverable' then item.title end) collate "de-x-icu",
      item.id collate "de-x-icu") as global_rank
  from active item
  left join active initiative on initiative.id=item.parent_task_id and initiative.task_type='initiative'
  left join public.profiles person on person.id=coalesce(nullif(item.assignee,''),nullif(item.owner,''))
  where (coalesce(p_filters->>'section','level')='level'
    and item.task_type=coalesce(p_filters->>'level','deliverable')
    and (item.task_type in ('epic','initiative') or item.task_type='deliverable' and public.planning_selection_status(item.status,false)<>'Erledigt'))
    or (p_filters->>'section'='orphanInitiatives' and item.task_type='initiative' and coalesce(item.parent_task_id,'')='')
    or (p_filters->>'section'='orphanDeliverables' and item.task_type='deliverable' and coalesce(item.parent_task_id,'')='')
), classified as (
  select item.*,case when not structurally_ready then 2 when coalesce(sprint_id,'')<>'' then 1 else 0 end as readiness_rank,
    (structurally_ready and coalesce(sprint_id,'')='') as ready
  from eligible item
), matches as materialized (
  select item.* from classified item cross join basis
  where coalesce(filters->>'section','level')<>'level' or ((item.task_type in ('epic','initiative') or coalesce(filters->>'scope','all')='all'
    or filters->>'scope'='proposals' and coalesce(item.approval_status,'proposed')='proposed'
    or filters->>'scope'='ready' and item.ready
    or filters->>'scope'='unscheduled' and coalesce(item.sprint_id,'')='')
    and strpos(lower(coalesce(item.title,'')||' '||coalesce(item.description,'')||' '||coalesce(item.priority,'')||' '||item.assignee_name||' '||case when item.task_type in ('epic','initiative') then coalesce(item.workstream,'') else item.initiative_title end),coalesce(filters->>'query',''))>0
    and (coalesce(filters->>'status','Alle')='Alle' or item.normalized=filters->>'status')
    and (item.task_type in ('epic','initiative') or coalesce(filters->>'readiness','all')='all' or filters->>'readiness'='ready' and item.ready or filters->>'readiness'='incomplete' and not item.ready)
    and (coalesce(filters->>'priority','Alle')='Alle' or item.priority=filters->>'priority')
    and (item.task_type<>'deliverable' or coalesce(filters->>'initiative','Alle')='Alle' or item.parent_task_id=filters->>'initiative')
    and (item.task_type<>'initiative' or coalesce(filters->>'epic','Alle')='Alle' or item.parent_task_id=filters->>'epic')
    and (coalesce(filters->>'assignee','Alle')='Alle' or item.assignee_id=filters->>'assignee' or item.assignee_name=filters->>'assignee'))
), ordered as (
  select item.*,case when coalesce(filters->>'level','deliverable')<>'deliverable' then item.global_rank else case filters->>'sort'
    when 'priority' then case item.priority when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 when 'P3' then 3 when 'P4' then 4 else 9 end
    when 'approval' then case when coalesce(item.approval_status,'proposed')='proposed' then 1 else 0 end
    when 'readiness' then item.readiness_rank
    when 'rank' then item.global_rank else null end end as number_order,
    case when coalesce(filters->>'level','deliverable')<>'deliverable' then null else case filters->>'sort' when 'title' then coalesce(item.title,'') when 'initiative' then item.initiative_title
      when 'assignee' then item.assignee_name when 'status' then item.normalized else null end end as text_order,
    case when coalesce(filters->>'level','deliverable')<>'deliverable' then 'asc' else filters->>'direction' end as direction
  from matches item cross join basis
), selected as materialized (
  select *,row_number() over(order by
    case when direction='asc' then number_order end asc,case when direction='desc' then number_order end desc,
    (case when direction='asc' then text_order end) collate "de-x-icu" asc,
    (case when direction='desc' then text_order end) collate "de-x-icu" desc,global_rank) as position
  from ordered
  order by case when direction='asc' then number_order end asc,case when direction='desc' then number_order end desc,
    (case when direction='asc' then text_order end) collate "de-x-icu" asc,
    (case when direction='desc' then text_order end) collate "de-x-icu" desc,global_rank
  limit greatest(1,least(coalesce(p_limit,20),100)) offset greatest(coalesce(p_offset,0),0)
), ancestors(id,parent_task_id,path,depth) as (
  select parent.id,parent.parent_task_id,array[selected.id,parent.id],1
  from selected join active parent on parent.id=selected.parent_task_id
  union all
  select parent.id,parent.parent_task_id,ancestors.path||parent.id,ancestors.depth+1
  from ancestors join active parent on parent.id=ancestors.parent_task_id
  where ancestors.depth<3 and not parent.id=any(ancestors.path)
), hydration_ids as materialized (
  select id,position as ordinal from selected
  union all
  select id,(select count(*) from selected)+row_number() over(order by id collate "de-x-icu")
  from (select distinct id from ancestors where id not in(select id from selected)) contexts
), hydration_tasks as materialized (
  select item.*,requested.ordinal from hydration_ids requested join active item on item.id=requested.id
), hydration_people_ids as materialized (
  select distinct reference.id from hydration_tasks item
  cross join lateral (values(item.assignee),(item.owner),(item.created_by)) reference(id)
  where coalesce(reference.id,'')<>''
), hydration_sprint_ids as materialized (
  select distinct sprint_id as id from hydration_tasks where coalesce(sprint_id,'')<>''
)
select case
  when not exists(select 1 from public.profiles where id=p_actor_profile_id and platform_role in ('ceo','deputy','founder','viewer')) then jsonb_build_object('status','forbidden')
  when p_filters is null or p_filters->>'level' not in ('deliverable','initiative','epic')
    or coalesce(p_filters->>'section','level') not in ('level','orphanInitiatives','orphanDeliverables')
    or (coalesce(p_filters->>'section','level')<>'level' and p_filters->>'level'<>'epic') or p_limit not between 1 and 100 or p_offset<0 then jsonb_build_object('status','unavailable')
  when p_source_revision is not null and (p_source_revision<>basis.source_revision or p_evaluated_at is null or p_valid_until is null)
    or temporal.valid_until<=statement_timestamp() then jsonb_build_object('status','staleContinuation')
  else jsonb_build_object('status','ready','source_revision',basis.source_revision,'observed_at',basis.observed_at,'valid_until',temporal.valid_until,
    'hydrated_items',coalesce((select jsonb_agg((select to_jsonb(scalars) from (select item.id, item.sort_order, item.title, item.description, item.status, item.priority, item.owner, item.assignee, item.created_by, item.workstream, item.target_date, item.fixed_date, item.problem_statement, item.intended_outcome, item.scope_constraints, item.acceptance_criteria, item.evidence_required, item.dod_template_version, item.definition_of_done, item.evidence_link, item.issue_number, item.issue_url, item.watched, item.estimate_hours, item.sprint_id, item.review_status, item.review_owner_profile_id, item.review_requested_at, item.review_evidence_exception_note, item.score_points, item.score_final, item.github_repo, item.github_issue_number, item.github_issue_url, item.github_issue_sync_status, item.github_issue_last_synced_at, item.github_issue_sync_error, item.task_type, item.parent_task_id, item.approval_status, item.approval_revision, item.proposed_by, item.proposed_at, item.decided_by, item.decided_at, item.decision_note, item.trashed_at, item.trashed_by, item.trash_reason, item.trash_cause, item.purge_after, item.trash_root_type, item.trash_root_id, item.trash_revision, item.score_relevant, item.original_sprint_id, item.carried_from_task_id, item.carried_from_sprint_id, item.carryover_reason, item.carryover_count, item.sprint_outcome, item.self_dod_checked, item.self_evidence_checked, item.self_documented_checked, item.self_blockers_checked, item.updated_at, item.created_at) scalars)
      ||jsonb_build_object('task_dependencies',coalesce((select jsonb_agg(jsonb_build_object('note',dependency.note) order by dependency.id) from public.task_dependencies dependency where dependency.task_id=item.id),'[]'::jsonb),
        'task_notes',(select jsonb_build_object('note',note.note) from public.task_notes note where note.task_id=item.id)) order by item.ordinal) from hydration_tasks item),'[]'::jsonb),
    'hydrated_people',coalesce((select jsonb_agg(jsonb_build_object('id',person.id,'name',person.name,'platform_role',person.platform_role,'org_role',person.org_role,'github_login',person.github_login,'deputy_for',person.deputy_for,'deputy_active_from',person.deputy_active_from,'deputy_active_until',person.deputy_active_until,'focus',person.focus,'weekly_capacity',person.weekly_capacity,'profile_color',person.profile_color) order by person.id collate "de-x-icu") from public.profiles person join hydration_people_ids reference on reference.id=person.id),'[]'::jsonb),
    'hydrated_sprints',coalesce((select jsonb_agg(jsonb_build_object('id',sprint.id,'name',sprint.name,'status',sprint.status,'start_date',sprint.start_date,'end_date',sprint.end_date,'review_due_at',sprint.review_due_at,'score_locked',sprint.score_locked,'updated_at',sprint.updated_at) order by sprint.id collate "de-x-icu") from public.sprints sprint join hydration_sprint_ids reference on reference.id=sprint.id),'[]'::jsonb),
    'total',(select count(*) from matches),
    'item_ids',coalesce((select jsonb_agg(id order by position) from selected),'[]'::jsonb),
    'context_ids',coalesce((select jsonb_agg(id order by id collate "de-x-icu") from (select distinct id from ancestors where id not in(select id from selected)) contexts),'[]'::jsonb),
    'rank_by_id',coalesce((select jsonb_object_agg(id,global_rank) from selected),'{}'::jsonb),
    'parent_progress_by_id',coalesce((select jsonb_object_agg(parent_id,jsonb_build_object(
      'total',total,'completed',completed,'unfinished',total-completed,
      'percentage',case when total=0 then 0 else round(completed::numeric/total*100)::integer end))
      from (select parent.id as parent_id,count(child.id) as total,
        count(child.id) filter(where public.planning_selection_status(child.status,false)='Erledigt') as completed
        from (select distinct parent_task_id from selected where coalesce(parent_task_id,'')<>'') visible
        join active parent on parent.id=visible.parent_task_id
        left join active child on child.parent_task_id=parent.id
        where parent.id not in(select id from selected)
        group by parent.id) progress),'{}'::jsonb)) end
from basis cross join temporal;
$$;
revoke all on function public.planning_backlog_selection(text,jsonb,integer,integer,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.planning_backlog_selection(text,jsonb,integer,integer,text,timestamptz,timestamptz) to service_role;
