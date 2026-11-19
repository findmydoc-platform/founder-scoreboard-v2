-- Extend the existing Planning source to independent Backlog support receipts.
create or replace function workspace_private.advance_planning_source_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  previous jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  following jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  relevant boolean := false;
begin
  if previous is not distinct from following then return null; end if;
  if tg_table_schema = 'public' and tg_table_name = 'tasks' then
    relevant := coalesce(previous->>'project_id' = 'findmydoc-founder-execution' and previous->>'trashed_at' is null, false)
      or coalesce(following->>'project_id' = 'findmydoc-founder-execution' and following->>'trashed_at' is null, false);
  elsif tg_table_schema = 'public' and tg_table_name = 'projects' then
    relevant := (previous->>'id' = 'findmydoc-founder-execution' or following->>'id' = 'findmydoc-founder-execution')
      and (previous is null or following is null or
        (previous->'name',previous->'range_label',previous->'review_objection_window_hours') is distinct from
        (following->'name',following->'range_label',following->'review_objection_window_hours'));
  elsif tg_table_schema = 'public' and tg_table_name = 'profiles' then
    relevant := previous is null or following is null or
      (previous->'id',previous->'auth_user_id',previous->'name',previous->'platform_role',previous->'org_role',previous->'github_login',previous->'deputy_for',previous->'deputy_active_from',previous->'deputy_active_until',previous->'focus',previous->'weekly_capacity',previous->'profile_color') is distinct from
      (following->'id',following->'auth_user_id',following->'name',following->'platform_role',following->'org_role',following->'github_login',following->'deputy_for',following->'deputy_active_from',following->'deputy_active_until',following->'focus',following->'weekly_capacity',following->'profile_color');
  elsif tg_table_schema = 'public' and tg_table_name = 'sprints' then
    -- Planning currently returns every team-readable Sprint, across projects.
    relevant := previous is null or following is null or
      (previous->'id',previous->'name',previous->'status',previous->'start_date',previous->'end_date',previous->'review_due_at',previous->'score_locked',previous->'updated_at') is distinct from
      (following->'id',following->'name',following->'status',following->'start_date',following->'end_date',following->'review_due_at',following->'score_locked',following->'updated_at');
  elsif tg_table_schema = 'public' and tg_table_name = 'sprint_commitments' then
    -- Backlog capacity is team-readable. Invalidate conservatively, in the same
    -- transaction; no write grant or admission rule changes with this clock.
    relevant := previous is null or following is null or
      (previous->'id',previous->'sprint_id',previous->'profile_id',previous->'commitment_level',previous->'weekly_hours',previous->'note',previous->'updated_at') is distinct from
      (following->'id',following->'sprint_id',following->'profile_id',following->'commitment_level',following->'weekly_hours',following->'note',following->'updated_at');
  elsif tg_table_name in ('identities','identity_bindings') then
    relevant := exists(select 1 from public.profiles profile
      where profile.auth_user_id::text in (previous->>'user_id',following->>'user_id'));
    if tg_table_name = 'identities' then
      relevant := relevant and (previous->>'provider' = 'google' or following->>'provider' = 'google')
        and (previous#>'{identity_data,sub}',previous#>'{identity_data,email}',previous#>'{identity_data,email_verified}',previous#>'{identity_data,iss}',previous#>'{identity_data,custom_claims,hd}',previous#>'{identity_data,picture}',previous->'user_id',previous->'provider') is distinct from
            (following#>'{identity_data,sub}',following#>'{identity_data,email}',following#>'{identity_data,email_verified}',following#>'{identity_data,iss}',following#>'{identity_data,custom_claims,hd}',following#>'{identity_data,picture}',following->'user_id',following->'provider');
    else
      relevant := relevant and (previous->'user_id',previous->'google_subject') is distinct from
        (following->'user_id',following->'google_subject');
    end if;
  elsif tg_table_name = 'task_relationship_edges' then
    relevant := exists(select 1 from (values(previous),(following)) as changed(row)
      join public.active_tasks item on item.id = changed.row->>'task_id' and item.project_id = 'findmydoc-founder-execution'
      join public.active_tasks related on related.id = changed.row->>'related_task_id' and related.project_id = item.project_id);
  else
    relevant := exists(select 1 from public.active_tasks item
      where item.project_id = 'findmydoc-founder-execution' and item.id in (previous->>'task_id',following->>'task_id'));
  end if;
  if relevant then
    update workspace_private.planning_source_revision set revision = revision + 1 where singleton;
  end if;
  return null;
end;
$$;
revoke all on function workspace_private.advance_planning_source_revision() from public, anon, authenticated, service_role;

create trigger planning_source_revision after insert or update or delete on public.sprint_commitments
for each row execute function workspace_private.advance_planning_source_revision();
comment on function public.planning_source_version() is 'Monotonic Planning selection and Backlog support source, including team-readable Sprint commitments; not discussion or Sprint assessment evidence.';

-- Scalar controls and exact Sprint aggregates are independent of selected Item
-- pages. No Task, directory role, relationship or complete workspace is returned.
create function public.planning_backlog_support(
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
  select id,title,task_type,status,sort_order,approval_status,sprint_id,estimate_hours
  from public.active_tasks where project_id='findmydoc-founder-execution'
), levels as (select unnest(array['epic','initiative','deliverable']) as kind), controls as (
  select jsonb_build_object(
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
