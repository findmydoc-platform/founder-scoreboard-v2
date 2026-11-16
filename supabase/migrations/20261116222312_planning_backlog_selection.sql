-- Backlog ranks belong to the complete unfinished Deliverable scope. Filters
-- and ordering precede paging; returned identities alone constrain hydration.
create function public.planning_backlog_selection(
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
    row_number() over(order by item.sort_order,item.id collate "de-x-icu") as global_rank
  from active item
  left join active initiative on initiative.id=item.parent_task_id and initiative.task_type='initiative'
  left join public.profiles person on person.id=coalesce(nullif(item.assignee,''),nullif(item.owner,''))
  where item.task_type='deliverable' and public.planning_selection_status(item.status,false)<>'Erledigt'
), classified as (
  select item.*,case when not structurally_ready then 2 when coalesce(sprint_id,'')<>'' then 1 else 0 end as readiness_rank,
    (structurally_ready and coalesce(sprint_id,'')='') as ready
  from eligible item
), matches as materialized (
  select item.* from classified item cross join basis
  where (coalesce(filters->>'scope','all')='all'
    or filters->>'scope'='proposals' and coalesce(item.approval_status,'proposed')='proposed'
    or filters->>'scope'='ready' and item.ready
    or filters->>'scope'='unscheduled' and coalesce(item.sprint_id,'')='')
    and strpos(lower(coalesce(item.title,'')||' '||coalesce(item.description,'')||' '||coalesce(item.priority,'')||' '||item.assignee_name||' '||item.initiative_title),coalesce(filters->>'query',''))>0
    and (coalesce(filters->>'status','Alle')='Alle' or item.normalized=filters->>'status')
    and (coalesce(filters->>'readiness','all')='all' or filters->>'readiness'='ready' and item.ready or filters->>'readiness'='incomplete' and not item.ready)
    and (coalesce(filters->>'priority','Alle')='Alle' or item.priority=filters->>'priority')
    and (coalesce(filters->>'initiative','Alle')='Alle' or item.parent_task_id=filters->>'initiative')
    and (coalesce(filters->>'assignee','Alle')='Alle' or item.assignee_id=filters->>'assignee' or item.assignee_name=filters->>'assignee')
), ordered as (
  select item.*,case filters->>'sort'
    when 'priority' then case item.priority when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 when 'P3' then 3 when 'P4' then 4 else 9 end
    when 'approval' then case when coalesce(item.approval_status,'proposed')='proposed' then 1 else 0 end
    when 'readiness' then item.readiness_rank
    when 'rank' then item.global_rank else null end as number_order,
    case filters->>'sort' when 'title' then coalesce(item.title,'') when 'initiative' then item.initiative_title
      when 'assignee' then item.assignee_name when 'status' then item.normalized else null end as text_order,
    filters->>'direction' as direction
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
)
select case
  when not exists(select 1 from public.profiles where id=p_actor_profile_id and platform_role in ('ceo','deputy','founder','viewer')) then jsonb_build_object('status','forbidden')
  when p_filters is null or p_filters->>'level'<>'deliverable' or p_limit not between 1 and 100 or p_offset<0 then jsonb_build_object('status','unavailable')
  when p_source_revision is not null and (p_source_revision<>basis.source_revision or p_evaluated_at is null or p_valid_until is null)
    or temporal.valid_until<=statement_timestamp() then jsonb_build_object('status','staleContinuation')
  else jsonb_build_object('status','ready','source_revision',basis.source_revision,'observed_at',basis.observed_at,'valid_until',temporal.valid_until,
    'total',(select count(*) from matches),
    'item_ids',coalesce((select jsonb_agg(id order by position) from selected),'[]'::jsonb),
    'context_ids',coalesce((select jsonb_agg(id order by id collate "de-x-icu") from (select distinct id from ancestors where id not in(select id from selected)) contexts),'[]'::jsonb),
    'rank_by_id',coalesce((select jsonb_object_agg(id,global_rank) from selected),'{}'::jsonb)) end
from basis cross join temporal;
$$;
revoke all on function public.planning_backlog_selection(text,jsonb,integer,integer,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.planning_backlog_selection(text,jsonb,integer,integer,text,timestamptz,timestamptz) to service_role;
