-- The credential-bound service owns admission, the original JWT and per-read
-- live checks. No user role can call this selection or choose another project.
create or replace function public.planning_selection_status(p_status text, p_child boolean default false)
returns text language sql immutable security invoker set search_path = '' as $$
  select case when p_child and normalized in ('Review','Nacharbeit','Pausiert') then 'In Arbeit' else normalized end
  from (select case
    when lower(coalesce(p_status,'')) ~ '(vorschlag|draft|idee)' then 'Offen'
    when lower(coalesce(p_status,'')) ~ '(nacharbeit|rework|changes_requested)' then 'Nacharbeit'
    when lower(coalesce(p_status,'')) ~ '(erledigt|done|beendet)' then 'Erledigt'
    when lower(coalesce(p_status,'')) like '%review%' then 'Review'
    when lower(coalesce(p_status,'')) like '%paus%' then 'Pausiert'
    when lower(coalesce(p_status,'')) like '%block%' then 'Blockiert'
    when lower(coalesce(p_status,'')) ~ '(arbeit|aktiv|progress)' then 'In Arbeit'
    else 'Offen' end as normalized) status;
$$;
revoke all on function public.planning_selection_status(text,boolean) from public, anon, authenticated;
grant execute on function public.planning_selection_status(text,boolean) to service_role;

-- Hydration is service-only and receives identities selected by the shared query.
-- It reads only those cards and scoped relationship/ancestor context.
create or replace function public.planning_deliverable_column(
  p_actor_profile_id text, p_selected_ids text[], p_source_revision text,
  p_evaluated_at timestamptz, p_valid_until timestamptz default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
with recursive
basis as (select public.planning_source_version() as revision),
active as not materialized (
  select task.* from public.active_tasks task where task.project_id='findmydoc-founder-execution'
),
chosen as materialized (
  select item.id,requested.ordinal from unnest(p_selected_ids) with ordinality requested(id,ordinal)
  join active item on item.id=requested.id and item.task_type='deliverable'
),
selected_edges as materialized (
  select edge.* from public.task_relationship_edges edge
  join active source on source.id=edge.task_id join active target on target.id=edge.related_task_id
  where exists(select 1 from chosen where chosen.id in (edge.task_id,edge.related_task_id))
),
context(id) as (
  select id from chosen union select task_id from selected_edges union select related_task_id from selected_edges
  union select parent.id from active item join context child on child.id=item.id join active parent on parent.id=item.parent_task_id
)
select case
  when not exists(select 1 from public.profiles where id=p_actor_profile_id and platform_role in ('ceo','deputy','founder','viewer')) then jsonb_build_object('status','forbidden')
  when p_source_revision is null or p_source_revision<>basis.revision or p_evaluated_at is null
    or p_valid_until<=statement_timestamp() or cardinality(p_selected_ids) is null
    or (select count(*) from chosen)<>cardinality(p_selected_ids)
    or (select count(distinct id) from chosen)<>cardinality(p_selected_ids)
    then jsonb_build_object('status','staleContinuation')
  else jsonb_build_object(
    'status','ready','source_revision',basis.revision,'evaluated_at',p_evaluated_at,
    'card_ids',coalesce((select jsonb_agg(id order by ordinal) from chosen),'[]'::jsonb),
    'context_ids',coalesce((select jsonb_agg(id order by id) from context),'[]'::jsonb),
    'rows',coalesce((select jsonb_agg((jsonb_build_object(
      'id',item.id,'sort_order',item.sort_order,'title',item.title,'status',item.status,
      'priority',item.priority,'owner',item.owner,'assignee',item.assignee,'created_by',item.created_by,
      'workstream',item.workstream,'target_date',item.target_date,'fixed_date',item.fixed_date,'dod_template_version',item.dod_template_version,
      'evidence_link',item.evidence_link,'issue_number',item.issue_number,'issue_url',item.issue_url,'watched',item.watched,
      'estimate_hours',item.estimate_hours,'sprint_id',item.sprint_id,'review_status',item.review_status,'review_owner_profile_id',item.review_owner_profile_id,
      'review_requested_at',item.review_requested_at,'score_points',item.score_points,'score_final',item.score_final,'github_repo',item.github_repo,
      'github_issue_number',item.github_issue_number,'github_issue_url',item.github_issue_url,'github_issue_sync_status',item.github_issue_sync_status,'github_issue_last_synced_at',item.github_issue_last_synced_at
    ) || jsonb_build_object(
      'task_type',item.task_type,'parent_task_id',item.parent_task_id,'approval_status',item.approval_status,'approval_revision',item.approval_revision,
      'proposed_by',item.proposed_by,'proposed_at',item.proposed_at,'decided_by',item.decided_by,'decided_at',item.decided_at,
      'trashed_at',item.trashed_at,'trashed_by',item.trashed_by,'trash_reason',item.trash_reason,'trash_cause',item.trash_cause,
      'purge_after',item.purge_after,'trash_root_type',item.trash_root_type,'trash_root_id',item.trash_root_id,'trash_revision',item.trash_revision,
      'score_relevant',item.score_relevant,'original_sprint_id',item.original_sprint_id,'carried_from_task_id',item.carried_from_task_id,'carried_from_sprint_id',item.carried_from_sprint_id,
      'carryover_count',item.carryover_count,'sprint_outcome',item.sprint_outcome,'self_dod_checked',item.self_dod_checked,'self_evidence_checked',item.self_evidence_checked,
      'self_documented_checked',item.self_documented_checked,'self_blockers_checked',item.self_blockers_checked,'updated_at',item.updated_at,'created_at',item.created_at
    )) order by item.id) from active item join context on context.id=item.id),'[]'::jsonb),
    'relationships',coalesce((select jsonb_agg(to_jsonb(edge) order by edge.id) from selected_edges edge),'[]'::jsonb)
  ) end from basis;
$$;
revoke all on function public.planning_deliverable_column(text,text[],text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.planning_deliverable_column(text,text[],text,timestamptz,timestamptz) to service_role;

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
    coalesce(p_query->'filters','{}'::jsonb) as filters
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
    case when item.assignee_id<>p_actor_profile_id then coalesce(personal.children,'[]'::jsonb) else '[]'::jsonb end as personal_children,
    sprint.start_date::timestamptz as sprint_start, sprint.end_date::timestamptz as sprint_end
  from active item
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
  where item.task_type='deliverable' and item.approval_status='approved'
),
predicates as materialized (
  select item.*,
    (item.priority='P0' and item.assignee_id='' or item.normalized='Blockiert' and not item.open_blocker or item.waiting or item.github_issue_sync_status='failed') as critical,
    (item.normalized='Blockiert' or item.dependency_note<>'' or item.waiting) as blocked,
    (coalesce(item.sprint_id,'')<>'' and item.normalized<>'Erledigt' and item.effective_evidence='' and coalesce(nullif(item.github_issue_url,''),item.issue_url,'')='' and coalesce(item.issue_url,'')='') as missing_evidence,
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
  where (coalesce(p_query->>'parentId','all')='all' or coalesce(item.parent_task_id,'')=p_query->>'parentId')
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
  select item.id,item.normalized,row_number() over(partition by item.normalized order by
    -- The complete TypeScript comparator uses Date.parse millisecond precision.
    case when item.normalized='Erledigt' then date_trunc('milliseconds',item.updated_at) end desc nulls last,
    case when item.normalized<>'Erledigt' then case item.priority when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 when 'P3' then 3 when 'P4' then 4 else 9 end else 0 end,
    coalesce(item.sort_order,0),item.id collate "en-x-icu") as position from matches item
),
cards as materialized (
  select * from ordered where (p_column is null or normalized=p_column)
    and (not p_plan_only or normalized<>'Pausiert')
    and position>greatest(0,p_offset) and position<=greatest(0,p_offset)+least(20,greatest(1,p_limit))
),
statuses(status,ordinal) as (values ('Offen',1),('In Arbeit',2),('Review',3),('Nacharbeit',4),('Blockiert',5),('Erledigt',6),('Pausiert',7)),
hydration as materialized (
  select case when p_plan_only then '{}'::jsonb else public.planning_deliverable_column(p_actor_profile_id,
    coalesce((select array_agg(cards.id order by statuses.ordinal,cards.position) from cards join statuses on statuses.status=cards.normalized),array[]::text[]),
    basis.revision,basis.evaluated_at,
    -- Initial legacy selection and hydration share this SQL snapshot. Its trusted
    -- evaluation time may be historical; later publication retains the live TTL.
    case when p_source_revision is null and p_offset=0 then null else temporal.valid_until end
  ) end as payload from basis cross join temporal
)
select case
  when not exists(select 1 from public.profiles where id=p_actor_profile_id and platform_role in ('ceo','deputy','founder','viewer')) then jsonb_build_object('status','forbidden')
  when p_offset<0 or p_column is not null and not exists(select 1 from statuses where status=p_column)
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
    'metrics',(select jsonb_build_object('total',count(*),'open',count(*) filter(where normalized<>'Erledigt'),'done',count(*) filter(where normalized='Erledigt'),'blocked',count(*) filter(where blocked)) from matches),
    'level_totals',(select jsonb_build_object('epic',count(*) filter(where task_type='epic'),'initiative',count(*) filter(where task_type='initiative'),'deliverable',count(*) filter(where task_type='deliverable')) from active),
    'personal_children',coalesce((select jsonb_object_agg(matches.id,matches.personal_children) from matches join cards on cards.id=matches.id where jsonb_array_length(matches.personal_children)>0),'{}'::jsonb),
    'workspace_revision',(select jsonb_build_object('activeTaskCount',count(*),'latestUpdatedAt',coalesce(max(updated_at)::text,'')) from active)
  ) || case when p_plan_only then '{}'::jsonb else hydration.payload - 'status' - 'source_revision' - 'evaluated_at' end end
from basis cross join temporal cross join hydration;
$$;

revoke all on function public.planning_deliverable_query_basis(text,jsonb,text,integer,integer,text,timestamptz,boolean) from public, anon, authenticated;
grant execute on function public.planning_deliverable_query_basis(text,jsonb,text,integer,integer,text,timestamptz,boolean) to service_role;

create or replace function public.planning_deliverable_query_plan(
  p_actor_profile_id text, p_query jsonb, p_limit integer default 20, p_evaluated_at timestamptz default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select public.planning_deliverable_query_basis(p_actor_profile_id,p_query,null,0,p_limit,null,p_evaluated_at,true);
$$;
revoke all on function public.planning_deliverable_query_plan(text,jsonb,integer,timestamptz) from public, anon, authenticated;
grant execute on function public.planning_deliverable_query_plan(text,jsonb,integer,timestamptz) to service_role;

-- The established JSON/page contract retains its signature and the same selector.
create or replace function public.planning_deliverable_selection(
  p_actor_profile_id text, p_query jsonb, p_column text default null,
  p_offset integer default 0, p_limit integer default 20,
  p_source_revision text default null, p_evaluated_at timestamptz default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select public.planning_deliverable_query_basis(p_actor_profile_id,p_query,p_column,p_offset,p_limit,p_source_revision,p_evaluated_at,false);
$$;
revoke all on function public.planning_deliverable_selection(text,jsonb,text,integer,integer,text,timestamptz) from public, anon, authenticated;
grant execute on function public.planning_deliverable_selection(text,jsonb,text,integer,integer,text,timestamptz) to service_role;
comment on function public.planning_deliverable_query_plan(text,jsonb,integer,timestamptz) is
  'One complete query basis with bounded selected identities and required discovery; no card-content hydration.';
comment on function public.planning_deliverable_column(text,text[],text,timestamptz,timestamptz) is
  'Selected Deliverable summaries and necessary scoped context on an unchanged query source and temporal basis.';
comment on function public.planning_deliverable_selection(text,jsonb,text,integer,integer,text,timestamptz) is
  'Compatible JSON column selection and selected-only hydration. Deferred child and attention summaries remain separate contracts.';
