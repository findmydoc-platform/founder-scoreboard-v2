-- Planning readers share this project and the authorized team directory. The
-- counter changes in the source transaction, so rollback cannot publish a token.
create table if not exists workspace_private.planning_source_revision (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0 check (revision >= 0)
);
alter table workspace_private.planning_source_revision enable row level security;
revoke all on workspace_private.planning_source_revision from public, anon, authenticated, service_role;
insert into workspace_private.planning_source_revision(singleton) values(true) on conflict do nothing;

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

do $$
declare source text;
begin
  foreach source in array array['tasks','projects','profiles','sprints','planning_item_strategy','planning_item_raci_assignments','task_links','task_dependencies','task_relationship_edges','task_blockers'] loop
    execute format('create or replace trigger planning_source_revision after insert or update or delete on public.%I for each row execute function workspace_private.advance_planning_source_revision()', source);
  end loop;
end;
$$;
create or replace trigger planning_source_revision after insert or update or delete on auth.identities
for each row execute function workspace_private.advance_planning_source_revision();
create or replace trigger planning_source_revision after insert or update or delete on workspace_private.identity_bindings
for each row execute function workspace_private.advance_planning_source_revision();

-- Replaces the existing metadata read and serves the lightweight revision poll.
-- No user-selectable project, provider, verification mode or query is accepted.
create or replace function public.planning_workspace_snapshot()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', project.id, 'name', project.name, 'range_label', project.range_label,
    'review_objection_window_hours', project.review_objection_window_hours,
    'scope_revision', revision.revision::text,
    'active_task_count', summary.active_task_count,
    'latest_updated_at', summary.latest_updated_at
  ) from workspace_private.planning_source_revision revision
  left join public.projects project on project.id = 'findmydoc-founder-execution'
  cross join (select count(*) as active_task_count, max(updated_at) as latest_updated_at
    from public.active_tasks where project_id = 'findmydoc-founder-execution') summary
  where revision.singleton;
$$;
revoke all on function public.planning_workspace_snapshot() from public, anon, authenticated;
grant execute on function public.planning_workspace_snapshot() to service_role;
