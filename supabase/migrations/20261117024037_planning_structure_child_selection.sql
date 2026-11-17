-- Reuse the existing approved Deliverable predicates and complete Planning filters.
-- A Structure parent scope is an additional conjunction before ordering/limit;
-- normal Board/Table requests do not carry this private adapter field.
create or replace function public.planning_deliverable_query_basis(
  p_actor_profile_id text, p_query jsonb, p_column text default null,
  p_offset integer default 0, p_limit integer default 20,
  p_source_revision text default null, p_evaluated_at timestamptz default null,
  p_plan_only boolean default false
) returns jsonb language sql stable security invoker set search_path = '' as $$
with recursive
basis as materialized (
  select public.planning_source_version() as revision,
    coalesce(p_evaluated_at,statement_timestamp()) as evaluated_at,
    coalesce(p_query->'filters','{}'::jsonb) as filters,
    coalesce(p_query->>'view','board')='table' as table_view
),
active as materialized (
  select task.*, public.planning_selection_status(task.status, task.task_type='sub_issue') as normalized,
    coalesce(nullif(task.assignee,''),nullif(task.owner,''),'') as assignee_id
  from public.active_tasks task where task.project_id='findmydoc-founder-execution'
),
edges as materialized (
  select edge.* from public.task_relationship_edges edge
  join active source on source.id=edge.task_id join active target on target.id=edge.related_task_id
),
personal as materialized (
  select parent_task_id,jsonb_agg(id order by id collate "en-x-icu") as children
  from active where task_type='sub_issue' and normalized<>'Erledigt' and assignee_id=p_actor_profile_id
  group by parent_task_id
),
waiting as materialized (
  select edge.task_id as id from edges edge join active other on other.id=edge.related_task_id
  where edge.relation_type='blocked_by' and edge.task_id<>edge.related_task_id
    and (case when other.task_type='sub_issue' then other.normalized else coalesce(other.status,'Offen') end)<>'Erledigt'
  union
  select edge.related_task_id from edges edge join active other on other.id=edge.task_id
  where edge.relation_type='blocks' and edge.task_id<>edge.related_task_id
    and (case when other.task_type='sub_issue' then other.normalized else coalesce(other.status,'Offen') end)<>'Erledigt'
),
dependencies as materialized (
  select dependency.task_id,string_agg(coalesce(dependency.note,''),'; ' order by dependency.id) as note
  from public.task_dependencies dependency join active scope on scope.id=dependency.task_id group by dependency.task_id
),
open_blockers as materialized (
  select distinct blocker.task_id from public.task_blockers blocker join active scope on scope.id=blocker.task_id where blocker.status='open'
),
evidence as materialized (
  select distinct on(link.task_id) link.task_id,link.url from public.task_links link join active scope on scope.id=link.task_id
  where link.type='evidence' and link.url ~* '^https?://[^/?#[:space:]]+' order by link.task_id,link.position,link.id
),
-- These intervals describe the existing rolling-week predicate. Reusing the
-- same interval does not renew the original credential deadline.
transitions as (
  select start_date::timestamptz - interval '7 days' as at from public.sprints where start_date is not null and end_date is not null
  union all select end_date::timestamptz + interval '1 millisecond' from public.sprints where start_date is not null and end_date is not null
),
temporal as (
  select case when basis.filters->'quick' ? 'week' then coalesce((select max(at)::text from transitions where at<=basis.evaluated_at),'before-first') else 'stable' end as temporal_key,
    case when basis.filters->'quick' ? 'week' then (select min(at) from transitions where at>basis.evaluated_at) end as valid_until
  from basis
),
attributes as materialized (
  select item.*, coalesce(nullif(person.name,''),item.assignee_id) as assignee_name,
    coalesce(parent.title,'') as initiative_title, coalesce(strategy.goal,'') as initiative_goal,
    coalesce(sprint.name,'') as sprint_name, coalesce(reviewer.name,'') as reviewer_name,
    waiting.id is not null as waiting,
    coalesce(dependencies.note,'') as dependency_note,
    open_blockers.task_id is not null as open_blocker,
    coalesce(evidence.url,nullif(item.evidence_link,''),'') as effective_evidence,
    case when not basis.table_view and item.task_type='deliverable' and item.assignee_id<>p_actor_profile_id then coalesce(personal.children,'[]'::jsonb) else '[]'::jsonb end as personal_children,
    sprint.start_date::timestamptz as sprint_start, sprint.end_date::timestamptz as sprint_end
  from active item cross join basis
  left join public.profiles person on person.id=item.assignee_id
  left join active parent on parent.id=item.parent_task_id and parent.task_type='initiative'
  left join public.planning_item_strategy strategy on strategy.task_id=parent.id
  left join public.sprints sprint on sprint.id=item.sprint_id
  left join public.profiles reviewer on reviewer.id=item.review_owner_profile_id
  left join personal on personal.parent_task_id=item.id
  left join waiting on waiting.id=item.id
  left join dependencies on dependencies.task_id=item.id
  left join open_blockers on open_blockers.task_id=item.id
  left join evidence on evidence.task_id=item.id
  where item.task_type=case when basis.table_view then 'deliverable' else coalesce(p_query->>'level','deliverable') end
    and (item.task_type<>'deliverable' or item.approval_status='approved')
),
predicates as materialized (
  select item.*,
    (item.task_type='deliverable' and item.priority='P0' and item.assignee_id='' or item.normalized='Blockiert' and not item.open_blocker or item.waiting or item.task_type='deliverable' and item.github_issue_sync_status='failed') as critical,
    (item.normalized='Blockiert' or item.dependency_note<>'' or item.waiting) as blocked,
    (item.task_type='deliverable' and coalesce(item.sprint_id,'')<>'' and item.normalized<>'Erledigt' and item.effective_evidence='' and coalesce(nullif(item.github_issue_url,''),item.issue_url,'')='' and coalesce(item.issue_url,'')='') as missing_evidence,
    (coalesce(item.github_issue_number,0)<>0 or coalesce(item.issue_number,'')<>''
      or coalesce(nullif(item.github_issue_url,''),item.issue_url,'') ~* '^https://github[.]com(:443)?/[^/]+/[^/]+/(issues|pull)/[1-9][0-9]*(/|[?#]|$)'
      or coalesce(item.issue_url,'') ~* '^https://github[.]com(:443)?/[^/]+/[^/]+/(issues|pull)/[1-9][0-9]*(/|[?#]|$)') as has_issue,
    lower(concat_ws(' ',
      lower(concat_ws(' ',coalesce(item.title,''),coalesce(item.description,''),item.assignee_name,coalesce(item.workstream,''),coalesce(item.priority,''),coalesce(item.definition_of_done,''),coalesce(item.fixed_date::text,''),coalesce(nullif(item.github_repo,''),'findmydoc-platform/management'),coalesce(nullif(item.github_issue_url,''),item.issue_url,''),coalesce(item.issue_url,''),coalesce(nullif(item.github_issue_number,0)::text,''),case when coalesce(item.github_issue_number,0)<>0 then '#'||item.github_issue_number::text else '' end,coalesce(item.issue_number,''),case when coalesce(item.issue_number,'')<>'' then '#'||item.issue_number else '' end)),
      item.normalized,item.initiative_title,item.initiative_goal,item.sprint_name,item.reviewer_name)) as search_text
  from attributes item
),
matches as materialized (
  select item.* from predicates item cross join basis
  where (basis.table_view or coalesce(p_query->>'parentId','all')='all' or coalesce(item.parent_task_id,'')=p_query->>'parentId')
    and (not (p_query ? 'structureParentId') or coalesce(item.parent_task_id,'')=p_query->>'structureParentId')
    and position(coalesce(basis.filters->>'query','') in item.search_text)>0
    and (coalesce(basis.filters->>'assignee','Alle')='Alle' or basis.filters->>'assignee' in (item.assignee_id,item.assignee_name))
    and (coalesce(basis.filters->>'status','Alle')='Alle' or item.normalized=basis.filters->>'status')
    and (coalesce(basis.filters->>'priority','Alle')='Alle' or item.priority=basis.filters->>'priority')
    and (coalesce(nullif(basis.filters->>'review',''),'Alle')='Alle' or coalesce(item.review_status,'not_requested')=basis.filters->>'review')
    and (coalesce(basis.filters->>'initiativeId','Alle')='Alle' or coalesce(item.parent_task_id,'')=basis.filters->>'initiativeId')
    and (coalesce(basis.filters->>'sprintId','Alle')='Alle' or coalesce(item.sprint_id,'')=basis.filters->>'sprintId')
    and (coalesce(basis.filters->>'workstream','Alle')='Alle' or coalesce(item.workstream,'')=basis.filters->>'workstream')
    and (coalesce(basis.filters->>'targetFrom','')='' or coalesce(item.target_date::text,item.fixed_date::text,'')>=basis.filters->>'targetFrom')
    and (coalesce(basis.filters->>'targetTo','')='' or coalesce(item.target_date::text,item.fixed_date::text,'')<=basis.filters->>'targetTo')
    and (coalesce(basis.filters->>'risk','Alle')='Alle'
      or basis.filters->>'risk'='critical' and item.critical
      or basis.filters->>'risk'='blocked' and item.blocked
      or basis.filters->>'risk'='evidence' and item.missing_evidence
      or basis.filters->>'risk'='github' and not item.has_issue)
    and (coalesce(basis.filters->'quick','[]'::jsonb)='[]'::jsonb
      or basis.filters->'quick' ? 'mine' and (item.assignee_id=p_actor_profile_id or jsonb_array_length(item.personal_children)>0)
      or basis.filters->'quick' ? 'my-reviews' and item.review_status='requested' and not item.score_final and item.review_owner_profile_id=p_actor_profile_id
      or basis.filters->'quick' ? 'open' and item.normalized='Offen'
      or basis.filters->'quick' ? 'critical' and item.critical
      or basis.filters->'quick' ? 'blocked' and item.blocked
      or basis.filters->'quick' ? 'week' and item.sprint_start<=basis.evaluated_at+interval '7 days' and item.sprint_end>=basis.evaluated_at
      or basis.filters->'quick' ? 'high' and item.priority in ('P0','P1')
      or basis.filters->'quick' ? 'evidence' and item.missing_evidence)
),
ordered as materialized (
  select item.id,item.normalized,row_number() over(
    partition by case when basis.table_view then '' else item.normalized end order by
    case when basis.table_view and basis.filters->>'sort'='priority' and basis.filters->>'direction'<>'desc' then case item.priority when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 when 'P3' then 3 when 'P4' then 4 else 9 end end,
    case when basis.table_view and basis.filters->>'sort'='priority' and basis.filters->>'direction'='desc' then case item.priority when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 when 'P3' then 3 when 'P4' then 4 else 9 end end desc,
    case when basis.table_view and basis.filters->>'direction'<>'desc' then case basis.filters->>'sort' when 'title' then coalesce(item.title,'') when 'status' then item.normalized when 'assignee' then item.assignee_name when 'sprint' then item.sprint_name when 'start' then coalesce(item.sprint_start::date::text,'') when 'fixedDate' then coalesce(item.fixed_date::text,'') end end collate public.planning_table_de,
    case when basis.table_view and basis.filters->>'direction'='desc' then case basis.filters->>'sort' when 'title' then coalesce(item.title,'') when 'status' then item.normalized when 'assignee' then item.assignee_name when 'sprint' then item.sprint_name when 'start' then coalesce(item.sprint_start::date::text,'') when 'fixedDate' then coalesce(item.fixed_date::text,'') end end collate public.planning_table_de desc,
    -- Board completion order remains independent of table sorting.
    case when not basis.table_view and item.normalized='Erledigt' then date_trunc('milliseconds',item.updated_at) end desc nulls last,
    case when not basis.table_view and item.normalized<>'Erledigt' then case item.priority when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 when 'P3' then 3 when 'P4' then 4 else 9 end else 0 end,
    coalesce(item.sort_order,0),
    -- Stable table sorting retains the complete source's prior priority/ID chain.
    case when basis.table_view then case item.priority when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 when 'P3' then 3 when 'P4' then 4 else 9 end else 0 end,
    case when basis.table_view then item.id end,
    case when not basis.table_view then item.id end collate "en-x-icu") as position
  from matches item cross join basis
),
cards as materialized (
  select * from ordered where (p_column is null or normalized=p_column)
    and (not p_plan_only or case when coalesce(p_query->>'level','deliverable')='deliverable'
      then normalized<>'Pausiert' else normalized not in ('Review','Nacharbeit') end)
    and position>greatest(0,p_offset) and position<=greatest(0,p_offset)+least(20,greatest(1,p_limit))
),
statuses(status,ordinal) as (values ('Offen',1),('In Arbeit',2),('Review',3),('Nacharbeit',4),('Blockiert',5),('Erledigt',6),('Pausiert',7)),
hydration as materialized (
  select case when p_plan_only then '{}'::jsonb else public.planning_deliverable_column(p_actor_profile_id,
    coalesce((select array_agg(cards.id order by case when basis.table_view then 0 else statuses.ordinal end,cards.position) from cards join statuses on statuses.status=cards.normalized),array[]::text[]),
    basis.revision,basis.evaluated_at,
    -- Initial legacy selection and hydration share this SQL snapshot. Its trusted
    -- evaluation time may be historical; later publication retains the live TTL.
    case when p_source_revision is null and p_offset=0 then null else temporal.valid_until end
  ) end as payload from basis cross join temporal
)
select case
  when not exists(select 1 from public.profiles where id=p_actor_profile_id and platform_role in ('ceo','deputy','founder','viewer')) then jsonb_build_object('status','forbidden')
  when p_query ? 'structureParentId' and not exists(select 1 from active where id=p_query->>'structureParentId' and task_type='initiative') then jsonb_build_object('status','forbidden')
  when p_offset<0 or basis.table_view and p_column is not null or p_column is not null and not exists(select 1 from statuses where status=p_column)
    or p_source_revision is not null and p_source_revision<>basis.revision
    or p_source_revision is not null and temporal.valid_until<=statement_timestamp()
    or p_offset>0 and p_offset> (select count(*) from matches where p_column is null or normalized=p_column)
    then jsonb_build_object('status','staleContinuation')
  when not p_plan_only and hydration.payload->>'status' is distinct from 'ready' then hydration.payload
  else jsonb_build_object(
    'status','ready','source_revision',basis.revision,'evaluated_at',basis.evaluated_at,'temporal_key',temporal.temporal_key,'valid_until',temporal.valid_until,
    'project',(select to_jsonb(project) from public.projects project where id='findmydoc-founder-execution'),
    'profiles',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'platform_role',platform_role,'org_role',org_role,'github_login',github_login,'deputy_for',deputy_for,'deputy_active_from',deputy_active_from,'deputy_active_until',deputy_active_until,'focus',focus,'weekly_capacity',weekly_capacity,'profile_color',profile_color) order by name,id) from public.profiles),'[]'::jsonb),
    'sprints',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'status',status,'start_date',start_date,'end_date',end_date,'review_due_at',review_due_at,'score_locked',score_locked,'updated_at',updated_at) order by start_date,id) from public.sprints),'[]'::jsonb),
    'preferences',coalesce((select jsonb_agg(to_jsonb(preference)) from public.profile_ui_preferences preference where profile_id=p_actor_profile_id),'[]'::jsonb),
    'columns',(select jsonb_object_agg(column_status.status,
      jsonb_build_object('total',(select count(*) from matches matched where matched.normalized=column_status.status))
      || case when p_plan_only then jsonb_build_object('ids',coalesce((select jsonb_agg(id order by position) from cards where normalized=column_status.status),'[]'::jsonb)) else '{}'::jsonb end
    ) from statuses column_status),
    'workstreams',coalesce((select jsonb_agg(workstream order by workstream collate "de-x-icu") from (select distinct workstream from active where coalesce(workstream,'')<>'') choices),'[]'::jsonb),
    'initiative_options',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title) order by sort_order,id) from active where task_type='initiative'),'[]'::jsonb),
    'epic_options',case when p_query->>'level'='initiative' and p_query->>'view'='board'
      then coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title) order by sort_order,id) from active where task_type='epic'),'[]'::jsonb)
      else '[]'::jsonb end,
    'metrics',(select jsonb_build_object('total',count(*),'open',count(*) filter(where normalized<>'Erledigt'),'done',count(*) filter(where normalized='Erledigt'),'blocked',count(*) filter(where blocked)) from matches),
    'level_totals',(select jsonb_build_object('epic',count(*) filter(where task_type='epic'),'initiative',count(*) filter(where task_type='initiative'),'deliverable',count(*) filter(where task_type='deliverable')) from active),
    'personal_children',coalesce((select jsonb_object_agg(matches.id,matches.personal_children) from matches join cards on cards.id=matches.id where jsonb_array_length(matches.personal_children)>0),'{}'::jsonb),
    'workspace_revision',(select jsonb_build_object('activeTaskCount',count(*),'latestUpdatedAt',coalesce(max(updated_at)::text,'')) from active)
  ) || case when p_plan_only then '{}'::jsonb else hydration.payload - 'status' - 'source_revision' - 'evaluated_at' end end
from basis cross join temporal cross join hydration;
$$;

revoke all on function public.planning_deliverable_query_basis(text,jsonb,text,integer,integer,text,timestamptz,boolean) from public, anon, authenticated;
grant execute on function public.planning_deliverable_query_basis(text,jsonb,text,integer,integer,text,timestamptz,boolean) to service_role;
