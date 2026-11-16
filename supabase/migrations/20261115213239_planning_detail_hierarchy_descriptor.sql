-- Reuse the bounded authoritative hierarchy from source observation for server-only hydration.
-- The user-bound publication certificate retains its existing scalar shape.
create or replace function public.planning_detail_source(p_item_id text, p_area text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_area not in ('target','discussion','timeline','complete') or p_item_id is null or length(p_item_id) > 512 then
    raise invalid_parameter_value using message = 'Invalid detail source scope';
  end if;
  with recursive hierarchy as (
    select id,parent_task_id,0 depth from public.active_tasks where id = p_item_id and project_id = 'findmydoc-founder-execution'
    union all
    select parent.id,parent.parent_task_id,child.depth+1 from hierarchy child
      join public.active_tasks parent on parent.id = child.parent_task_id and parent.project_id = 'findmydoc-founder-execution'
      where child.depth < 3
  ), boundaries as (
    select (current_date + 1)::timestamptz value
    union all select deputy_active_from from public.profiles
    union all select deputy_active_until from public.profiles
    union all select review_due_at from public.sprints
    union all select start_date::timestamptz from public.sprints
    union all select (end_date + 1)::timestamptz from public.sprints
  )
  select jsonb_build_object(
    'target_id', (select id from hierarchy where depth = 0),
    'ancestor_ids', coalesce((select jsonb_agg(id order by depth desc) from hierarchy where depth > 0),'[]'::jsonb),
    'source_revision', jsonb_build_array(public.planning_source_version(),
      coalesce((select sum(revision) from workspace_private.planning_detail_area_revision where area = 'notes' and item_id in (select id from hierarchy)),0)::text,
      case when p_area in ('discussion','complete') then coalesce((select revision from workspace_private.planning_detail_area_revision where area = 'discussion' and item_id = p_item_id),0)::text end,
      case when p_area in ('timeline','complete') then coalesce((select revision from workspace_private.planning_detail_area_revision where area = 'timeline' and item_id = p_item_id),0)::text end)::text,
    'observed_at', statement_timestamp(),
    'valid_until', (select min(value) from boundaries where value > statement_timestamp())
  ) into result;
  return result;
end;
$$;
revoke all on function public.planning_detail_source(text,text) from public, anon, authenticated;
grant execute on function public.planning_detail_source(text,text) to service_role;

-- Same authoritative original-user/session/role boundary as team-readable detail.
-- Only a scoped scalar certificate is exposed, never Item or discussion content.
create or replace function public.planning_detail_publication_context(p_item_id text, p_area text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.planning_board_publication_context() || (public.planning_detail_source(p_item_id,p_area) - 'target_id' - 'ancestor_ids');
$$;
revoke all on function public.planning_detail_publication_context(text,text) from public, anon, service_role;
grant execute on function public.planning_detail_publication_context(text,text) to authenticated;
