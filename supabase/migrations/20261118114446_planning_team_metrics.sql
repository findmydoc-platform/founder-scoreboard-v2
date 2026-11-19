-- Exact Team metrics, independent of the displayed directory and Task hydration.
create or replace function public.planning_team_metrics(
  p_actor_profile_id text, p_actor_user_id uuid, p_evaluated_at timestamptz default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
with basis as materialized (
  select public.planning_source_version() as revision, coalesce(p_evaluated_at,statement_timestamp()) as evaluated_at
),
-- mapTaskRow always supplies assigneeId from the nonempty assignee/owner FK.
-- This preserves taskBelongsToProfile's ID precedence over display names.
associated as materialized (
  select task.id, coalesce(nullif(task.assignee,''),nullif(task.owner,''),'') as profile_id,
    public.planning_selection_status(task.status,task.task_type='sub_issue') as status,
    task.priority, coalesce(task.estimate_hours,0) as hours
  from public.active_tasks task where task.project_id='findmydoc-founder-execution'
),
metrics as (
  select person.id,
    count(item.id) filter(where item.status<>'Erledigt') as open_tasks,
    count(item.id) filter(where item.status<>'Erledigt' and item.priority in ('P0','P1')) as high_priority_tasks,
    coalesce(sum(item.hours),0) as load_hours
  from public.profiles person left join associated item on item.profile_id=person.id group by person.id
)
select case when p_actor_user_id is null or not exists(select 1 from public.profiles
    where id=p_actor_profile_id and auth_user_id=p_actor_user_id and platform_role in ('ceo','deputy','founder','viewer'))
  then jsonb_build_object('status','forbidden')
  else jsonb_build_object('status','ready','source_revision',basis.revision,'evaluated_at',basis.evaluated_at,
    'valid_until',null,'coverage','complete','metrics_by_profile_id',coalesce((select jsonb_object_agg(id,
      jsonb_build_object('openTasks',open_tasks,'highPriorityTasks',high_priority_tasks,'loadHours',load_hours)) from metrics),'{}'::jsonb)) end
from basis;
$$;
revoke all on function public.planning_team_metrics(text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.planning_team_metrics(text,uuid,timestamptz) to service_role;
