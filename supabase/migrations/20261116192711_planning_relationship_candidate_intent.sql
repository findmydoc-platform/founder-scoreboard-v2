-- Relationship scope is explicit and source-bound. Resolve effective assignee
-- names only for the selected page; parent intents retain their existing shape.
create function public.planning_item_candidates(
  p_actor_profile_id text, p_kind text, p_query text, p_limit integer,
  p_offset integer, p_source_revision text,
  p_evaluated_at timestamptz, p_valid_until timestamptz, p_source_id text
) returns jsonb language sql stable security definer set search_path = '' as $$
with basis as materialized (
  select public.planning_source_version() as source_revision,
    coalesce(p_evaluated_at,statement_timestamp()) as observed_at,
    lower(btrim(p_query)) as query
), boundaries as (
  select (current_date + 1)::timestamptz as at
  union all select deputy_active_from from public.profiles
  union all select deputy_active_until from public.profiles
), temporal as (
  select coalesce(p_valid_until,(select min(at) from boundaries where at>statement_timestamp())) as valid_until
), eligible as materialized (
  select item.id,item.title,item.task_type,item.parent_task_id,item.approval_status,item.updated_at,item.sort_order,item.status,coalesce(nullif(item.assignee,''),nullif(item.owner,'')) as effective_assignee_id
  from public.active_tasks item
  where item.project_id='findmydoc-founder-execution' and (item.task_type=p_kind or p_kind='relationship' and item.task_type<>'sub_issue')
    and (p_kind<>'relationship' or p_source_id is null or item.id<>p_source_id)
), matches as materialized (
  select item.* from eligible item cross join basis
  where strpos(lower(coalesce(item.title,'')),basis.query)>0
), selected as (
  select * from matches order by sort_order,id collate "en-x-icu"
  limit greatest(1,least(coalesce(p_limit,20),100)) offset greatest(coalesce(p_offset,0),0)
), default_epic as (
  select * from eligible where p_kind='epic'
  order by case when status='In Arbeit' then 0 else 1 end,sort_order,id collate "en-x-icu" limit 1
)
select case
  when not exists(select 1 from public.profiles where id=p_actor_profile_id and platform_role in ('ceo','deputy','founder','viewer'))
    then jsonb_build_object('status','forbidden')
  when p_kind not in ('initiative','epic','deliverable','relationship') or p_kind is null or p_query is null or length(p_query)>2048 or p_limit not between 1 and 100 or p_offset<0
    then jsonb_build_object('status','unavailable')
  when p_kind='relationship' and p_source_id is not null and not exists(
    select 1 from public.active_tasks source where source.id=p_source_id and source.project_id='findmydoc-founder-execution')
    then jsonb_build_object('status','forbidden')
  when p_source_revision is not null and (p_source_revision<>basis.source_revision or p_evaluated_at is null or p_valid_until is null)
    or temporal.valid_until<=statement_timestamp()
    then jsonb_build_object('status','staleContinuation')
  else jsonb_build_object('status','ready','source_revision',basis.source_revision,
    'observed_at',basis.observed_at,'valid_until',temporal.valid_until,
    'total',(select count(*) from matches),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',selected.id,'title',selected.title,'taskType',selected.task_type,
      'parentTaskId',coalesce(selected.parent_task_id,''),'approvalStatus',coalesce(selected.approval_status,'proposed'),'updatedAt',selected.updated_at)
      || case when p_kind='deliverable' then jsonb_build_object('parentTitle',parent.title) else '{}'::jsonb end
      || case when p_kind='relationship' then jsonb_build_object('assigneeLabel',coalesce(nullif(assignee.name,''),selected.effective_assignee_id,'Nicht zugeordnet')) else '{}'::jsonb end
      order by selected.sort_order,selected.id collate "en-x-icu") from selected
      left join public.active_tasks parent on p_kind='deliverable' and parent.id=selected.parent_task_id
        and parent.task_type='initiative' and parent.project_id='findmydoc-founder-execution'
      left join public.profiles assignee on p_kind='relationship' and assignee.id=selected.effective_assignee_id),'[]'::jsonb))
    || case when p_kind='epic' then jsonb_build_object('default_candidate',(select jsonb_build_object('id',id,'title',title,'taskType',task_type,
        'parentTaskId',coalesce(parent_task_id,''),'approvalStatus',coalesce(approval_status,'proposed'),'updatedAt',updated_at) from default_epic)) else '{}'::jsonb end
  end
from basis cross join temporal;
$$;
revoke all on function public.planning_item_candidates(text,text,text,integer,integer,text,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.planning_item_candidates(text,text,text,integer,integer,text,timestamptz,timestamptz,text) to service_role;

-- Keep existing service callers and the original Initiative wrapper compatible.
create or replace function public.planning_item_candidates(
  p_actor_profile_id text, p_kind text, p_query text, p_limit integer default 20,
  p_offset integer default 0, p_source_revision text default null,
  p_evaluated_at timestamptz default null, p_valid_until timestamptz default null
) returns jsonb language sql stable security definer set search_path = '' as $$
  select public.planning_item_candidates(p_actor_profile_id,p_kind,p_query,p_limit,p_offset,p_source_revision,p_evaluated_at,p_valid_until,null);
$$;
revoke all on function public.planning_item_candidates(text,text,text,integer,integer,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.planning_item_candidates(text,text,text,integer,integer,text,timestamptz,timestamptz) to service_role;
