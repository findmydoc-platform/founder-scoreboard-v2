-- Detail-only contributors do not change the established Planning Board clock.
-- Keep tombstone counters so delete/reinsert cannot restore an earlier token.
create table if not exists workspace_private.planning_detail_area_revision (
  item_id text not null,
  area text not null check (area in ('notes','discussion','timeline')),
  revision bigint not null default 1 check (revision > 0),
  primary key (item_id, area)
);
alter table workspace_private.planning_detail_area_revision enable row level security;
revoke all on workspace_private.planning_detail_area_revision from public, anon, authenticated, service_role;

create or replace function workspace_private.advance_detail_area_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  previous jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  following jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  item text;
  changed_area text := tg_argv[0];
begin
  if previous is not distinct from following then return null; end if;
  for item in select distinct case when tg_table_name = 'audit_log' then row->>'entity_id' else row->>'task_id' end
    from (values(previous),(following)) changed(row)
    where row is not null and (tg_table_name <> 'audit_log' or row->>'entity_type' = 'task')
  loop
    if item is not null then
      insert into workspace_private.planning_detail_area_revision(item_id, area) values(item, changed_area)
      on conflict(item_id, area) do update set revision = planning_detail_area_revision.revision + 1;
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function workspace_private.advance_detail_area_revision() from public, anon, authenticated, service_role;

do $$
declare source text;
begin
  create or replace trigger detail_area_revision after insert or update or delete on public.task_notes
    for each row execute function workspace_private.advance_detail_area_revision('notes');
  foreach source in array array['task_comments','task_external_comments','task_comment_submissions','task_comment_github_deliveries'] loop
    execute format('create or replace trigger detail_area_revision after insert or update or delete on public.%I for each row execute function workspace_private.advance_detail_area_revision(''discussion'')',source);
  end loop;
  foreach source in array array['audit_log','task_reviews','task_review_github_deliveries'] loop
    execute format('create or replace trigger detail_area_revision after insert or update or delete on public.%I for each row execute function workspace_private.advance_detail_area_revision(''timeline'')',source);
  end loop;
end;
$$;

create function public.planning_detail_source(p_item_id text, p_area text)
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
create function public.planning_detail_publication_context(p_item_id text, p_area text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.planning_board_publication_context() || public.planning_detail_source(p_item_id,p_area);
$$;
revoke all on function public.planning_detail_publication_context(text,text) from public, anon, service_role;
grant execute on function public.planning_detail_publication_context(text,text) to authenticated;
