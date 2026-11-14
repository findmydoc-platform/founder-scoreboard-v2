-- Read complete direct-child sets for one selected identity batch without
-- repeating query selection or transmitting child content. Admission and
-- original-user checks remain in the credential-bound Board capability.
create or replace function public.planning_deliverable_summaries(
  p_actor_profile_id text, p_selected_ids text[], p_source_revision text,
  p_evaluated_at timestamptz, p_valid_until timestamptz default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
with
basis as (select public.planning_source_version() as revision),
chosen as materialized (
  select item.id from public.active_tasks item
  where item.project_id='findmydoc-founder-execution' and item.task_type='deliverable'
    and item.id=any(p_selected_ids)
),
progress as (
  select chosen.id,count(child.id) as total,
    count(child.id) filter(where public.planning_selection_status(child.status,child.task_type='sub_issue')='Erledigt') as completed
  from chosen left join public.active_tasks child on child.parent_task_id=chosen.id
    and child.project_id='findmydoc-founder-execution'
  group by chosen.id
)
select case
  when not exists(select 1 from public.profiles where id=p_actor_profile_id and platform_role in ('ceo','deputy','founder','viewer'))
    then jsonb_build_object('status','forbidden')
  when p_source_revision is null or p_source_revision<>basis.revision or p_evaluated_at is null
    or p_valid_until<=statement_timestamp() or cardinality(p_selected_ids) is null
    or (select count(*) from chosen)<>cardinality(p_selected_ids)
    then jsonb_build_object('status','staleContinuation')
  else jsonb_build_object(
    'status','ready','source_revision',basis.revision,'evaluated_at',p_evaluated_at,
    'child_progress',coalesce((select jsonb_object_agg(id,jsonb_build_object(
      'completed',completed,'total',total,'unfinished',total-completed,
      'percentage',case when total=0 then 0 else round(completed::numeric*100/total) end
    )) from progress),'{}'::jsonb)
  ) end from basis;
$$;
revoke all on function public.planning_deliverable_summaries(text,text[],text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.planning_deliverable_summaries(text,text[],text,timestamptz,timestamptz) to service_role;
comment on function public.planning_deliverable_summaries(text,text[],text,timestamptz,timestamptz) is
  'Complete direct-child progress for one selected Deliverable batch on its original source and temporal basis.';
