-- Preserve the complete scalar option populations of the current Table basis.
-- This read supplies no Task membership, canonical fields, or mutation authority.
create function public.planning_structure_controls(p_actor_profile_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
with basis as materialized (
  select public.planning_source_version() as source_revision, statement_timestamp() as observed_at
), active as materialized (
  select id,title,task_type,sort_order,workstream from public.active_tasks
  where project_id='findmydoc-founder-execution'
)
select case
  when not exists(select 1 from public.profiles where id=p_actor_profile_id and platform_role in ('ceo','deputy','founder','viewer')) then jsonb_build_object('status','forbidden')
  else jsonb_build_object('status','ready','source_revision',basis.source_revision,'observed_at',basis.observed_at,
    'people',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from public.profiles),'[]'::jsonb),
    'sprints',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by start_date,id) from public.sprints),'[]'::jsonb),
    'initiatives',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title) order by sort_order,id) from active where task_type='initiative'),'[]'::jsonb),
    'workstreams',coalesce((select jsonb_agg(workstream order by workstream collate "de-x-icu") from (select distinct workstream from active where coalesce(workstream,'')<>'') choices),'[]'::jsonb))
end from basis;
$$;
revoke all on function public.planning_structure_controls(text) from public, anon, authenticated;
grant execute on function public.planning_structure_controls(text) to service_role;
