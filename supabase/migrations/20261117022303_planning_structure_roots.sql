-- Structure roots are the unfiltered Initiative class, including completed and
-- proposed records, in the complete source's existing order/ID sequence.
create function public.planning_structure_selection(
  p_actor_profile_id text, p_limit integer default 20,
  p_offset integer default 0, p_source_revision text default null,
  p_evaluated_at timestamptz default null, p_valid_until timestamptz default null
) returns jsonb language sql stable security definer set search_path = '' as $$
with recursive
basis as materialized (
  select public.planning_source_version() as source_revision,
    coalesce(p_evaluated_at,statement_timestamp()) as observed_at
), boundaries as (
  select (current_date+1)::timestamptz as at
  union all select deputy_active_from from public.profiles
  union all select deputy_active_until from public.profiles
), temporal as (
  select coalesce(p_valid_until,(select min(at) from boundaries where at>statement_timestamp())) as valid_until
), active as not materialized (
  select * from public.active_tasks where project_id='findmydoc-founder-execution'
), selected as materialized (
  select item.*,row_number() over(order by sort_order,id) as position
  from active item where task_type='initiative'
  order by sort_order,id
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
  when p_limit not between 1 and 100 or p_offset<0 then jsonb_build_object('status','unavailable')
  when p_source_revision is not null and (p_source_revision<>basis.source_revision or p_evaluated_at is null or p_valid_until is null)
    or temporal.valid_until<=statement_timestamp() then jsonb_build_object('status','staleContinuation')
  else jsonb_build_object('status','ready','source_revision',basis.source_revision,'observed_at',basis.observed_at,'valid_until',temporal.valid_until,
    'total',(select count(*) from active where task_type='initiative'),
    'item_ids',coalesce((select jsonb_agg(id order by position) from selected),'[]'::jsonb),
    'context_ids',coalesce((select jsonb_agg(id order by id collate "de-x-icu") from (select distinct id from ancestors where id not in(select id from selected)) contexts),'[]'::jsonb)) end
from basis cross join temporal;
$$;
revoke all on function public.planning_structure_selection(text,integer,integer,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.planning_structure_selection(text,integer,integer,text,timestamptz,timestamptz) to service_role;
