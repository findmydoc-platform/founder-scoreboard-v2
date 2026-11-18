-- Resolve an explicit relative action against the complete unfinished class.
-- No filtered/page-local identity list, fresh source replacement or write is used.
create function public.planning_backlog_rank_target(
  p_actor_profile_id text,p_source_id text,p_source_updated_at timestamptz,p_source_revision text,p_action text
) returns jsonb language sql stable security definer set search_path = '' as $$
with basis as materialized (
  select public.planning_source_version() as source_revision,statement_timestamp() as observed_at
), boundaries as (
  select (current_date+1)::timestamptz as at
  union all select deputy_active_from from public.profiles
  union all select deputy_active_until from public.profiles
), temporal as (select min(at) as valid_until from boundaries where at>statement_timestamp()), ordered as materialized (
  select id,updated_at,row_number() over(order by coalesce(sort_order,0),id collate "de-x-icu") as position
  from public.active_tasks where project_id='findmydoc-founder-execution' and task_type='deliverable'
    and public.planning_selection_status(status,false)<>'Erledigt'
), source as (select * from ordered where id=p_source_id), target as (
  select * from ordered where position=case p_action when 'top' then 1 when 'bottom' then (select count(*) from ordered)
    when 'up' then (select position-1 from source) when 'down' then (select position+1 from source) end
    and id<>p_source_id
)
select case
  when not exists(select 1 from public.profiles where id=p_actor_profile_id and platform_role in ('ceo','deputy','founder','viewer')) then jsonb_build_object('status','forbidden')
  when not exists(select 1 from source) then jsonb_build_object('status','forbidden')
  when p_action is null or p_action not in ('up','down','top','bottom') then jsonb_build_object('status','unavailable')
  when p_source_revision is distinct from basis.source_revision or p_source_updated_at is distinct from (select updated_at from source)
    then jsonb_build_object('status','staleContinuation')
  else jsonb_build_object('status','ready','source_revision',basis.source_revision,'observed_at',basis.observed_at,'valid_until',temporal.valid_until,
    'target_id',(select id from target),'noop',not exists(select 1 from target),
    'placement',case when not exists(select 1 from target) then null when p_action in ('up','top') then 'before' else 'after' end) end
from basis cross join temporal;
$$;
revoke all on function public.planning_backlog_rank_target(text,text,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.planning_backlog_rank_target(text,text,timestamptz,text,text) to service_role;
