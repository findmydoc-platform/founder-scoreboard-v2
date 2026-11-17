-- Preserve the complete global unfinished-class counts on every scoped Backlog page.
-- These overlapping counters are independent of selected filters and planned hours.
create or replace function public.planning_backlog_support(
  p_actor_profile_id text, p_area text, p_day date,
  p_evaluated_at timestamptz default null, p_valid_until timestamptz default null
) returns jsonb language sql stable security definer set search_path = '' as $$
with basis as materialized (
  select public.planning_source_version() as source_revision,coalesce(p_evaluated_at,statement_timestamp()) as observed_at
), boundaries as (
  select (current_date+1)::timestamptz as at
  union all select deputy_active_from from public.profiles
  union all select deputy_active_until from public.profiles
), temporal as (
  select coalesce(p_valid_until,(select min(at) from boundaries where at>statement_timestamp())) as valid_until
), items as materialized (
  select id,title,task_type,status,sort_order,approval_status,sprint_id,estimate_hours,parent_task_id,owner,assignee
  from public.active_tasks where project_id='findmydoc-founder-execution'
), levels as (select unnest(array['epic','initiative','deliverable']) as kind), controls as (
  select jsonb_build_object(
    'scopeCounts',(select jsonb_build_object('all',count(*),
      'proposals',count(*) filter(where coalesce(item.approval_status,'proposed')='proposed'),
      'ready',count(*) filter(where item.approval_status='approved'
        and (btrim(coalesce(item.assignee,''))<>'' or btrim(coalesce(item.owner,''))<>'')
        and exists(select 1 from items parent where parent.id=item.parent_task_id and parent.task_type='initiative')
        and btrim(coalesce(item.sprint_id,''))=''),
      'unscheduled',count(*) filter(where coalesce(item.sprint_id,'')=''))
      from items item where task_type='deliverable' and public.planning_selection_status(status,false)<>'Erledigt'),
    'levelTotals',(select jsonb_object_agg(kind,(select count(*) from items where task_type=kind)) from levels),
    'statuses',(select jsonb_object_agg(kind,coalesce((select jsonb_agg(normalized order by first_rank) from (
      select public.planning_selection_status(status,false) as normalized,min(position) as first_rank
      from (select status,row_number() over(order by sort_order,id collate "de-x-icu") as position from items where task_type=kind) ordered
      group by public.planning_selection_status(status,false)) statuses),'[]'::jsonb)) from levels),
    'assignees',coalesce((select jsonb_agg(jsonb_build_object('value',id,'label',name) order by name,id) from public.profiles),'[]'::jsonb),
    'epics',coalesce((select jsonb_agg(jsonb_build_object('value',id,'label',title) order by sort_order,id) from items where task_type='epic'),'[]'::jsonb),
    'initiatives',coalesce((select jsonb_agg(jsonb_build_object('value',id,'label',title) order by sort_order,id) from items where task_type='initiative'),'[]'::jsonb)
  ) as value
), ordered_sprints as materialized (
  select sprint.*,row_number() over(order by coalesce(start_date::text,''),id) as position
  from public.sprints sprint where status<>'closed'
), current_sprint as (
  select position from ordered_sprints order by
    case when coalesce(start_date::text,'')<=p_day::text and coalesce(end_date::text,'')>=p_day::text then 0
      when status='active' then 1 when status in ('planning','review') then 2 else 3 end,position limit 1
), chosen as (
  select * from ordered_sprints where position>=coalesce((select position from current_sprint),1) order by position limit 5
), bucket_inputs as (
  select sprint.*,
    coalesce((select sum(estimate_hours) from items where task_type='deliverable' and approval_status='approved'
      and public.planning_selection_status(status,false)<>'Erledigt' and sprint_id=sprint.id),0) as planned_hours,
    case when exists(select 1 from public.sprint_commitments where sprint_id=sprint.id) then
      (select case when bool_and(weekly_hours>=0) then sum(weekly_hours) end from public.sprint_commitments where sprint_id=sprint.id)
      else (select case when coalesce(bool_and(weekly_capacity>=0),true) then coalesce(sum(weekly_capacity),0) end from public.profiles) end as weekly_hours
  from chosen sprint
), buckets as (
  select sprint.*,case when start_date is not null and end_date>=start_date and weekly_hours is not null
    then floor(weekly_hours*(end_date-start_date+1)/7.0+0.5) end as capacity_hours from bucket_inputs sprint
)
select case
  when not exists(select 1 from public.profiles where id=p_actor_profile_id and platform_role in ('ceo','deputy','founder','viewer')) then jsonb_build_object('status','forbidden')
  when p_area not in ('controls','sprints') or p_area is null or p_day is null then jsonb_build_object('status','unavailable')
  when temporal.valid_until<=statement_timestamp() then jsonb_build_object('status','unavailable')
  else jsonb_build_object('status','ready','source_revision',basis.source_revision,'observed_at',basis.observed_at,'valid_until',temporal.valid_until,
    'controls',case when p_area='controls' then (select value from controls) end,
    'buckets',case when p_area='sprints' then coalesce((select jsonb_agg(jsonb_build_object(
      'sprint',jsonb_build_object('id',id,'name',name,'status',status,'startDate',coalesce(start_date::text,''),'endDate',coalesce(end_date::text,''),
        'reviewDueAt',coalesce(review_due_at::text,''),'scoreLocked',score_locked,'updatedAt',updated_at),
      'capacityHours',capacity_hours,'capacityUnavailable',capacity_hours is null,'isCurrent',position=(select position from current_sprint),
      'locked',score_locked,'plannedHours',planned_hours,'plannedHoursComplete',true,
      'overCapacityHours',case when capacity_hours is null then 0 else greatest(planned_hours-capacity_hours,0) end,
      'overCapacity',capacity_hours is not null and planned_hours>capacity_hours,
      'utilization',case when capacity_hours>0 then planned_hours/capacity_hours else 0 end) order by position) from buckets),'[]'::jsonb) end) end
from basis cross join temporal;
$$;
revoke all on function public.planning_backlog_support(text,text,date,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.planning_backlog_support(text,text,date,timestamptz,timestamptz) to service_role;
