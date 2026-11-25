-- Release references historically cover all team Planning Items, not just the Board project.
create table workspace_private.release_reference_revision (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0 check (revision >= 0)
);
alter table workspace_private.release_reference_revision enable row level security;
revoke all on workspace_private.release_reference_revision from public, anon, authenticated, service_role;
insert into workspace_private.release_reference_revision(singleton) values (true);

create function workspace_private.advance_release_reference_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update workspace_private.release_reference_revision set revision = revision + 1 where singleton;
  return null;
end;
$$;
revoke all on function workspace_private.advance_release_reference_revision() from public, anon, authenticated, service_role;
create trigger release_reference_revision after insert or delete or update of
  id, title, task_type, parent_task_id, github_repo, github_issue_number, trashed_at
  on public.tasks for each statement execute function workspace_private.advance_release_reference_revision();
create trigger release_reference_revision after insert or delete or update of
  id, task_id, type, metadata on public.task_links for each statement execute function workspace_private.advance_release_reference_revision();
create trigger release_reference_revision after insert or delete or update of
  version, manifest_digest, manifest on public.platform_releases for each statement execute function workspace_private.advance_release_reference_revision();

create function public.platform_release_reference_publication_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor jsonb;
begin
  if not coalesce(public.workspace_request_admitted(), false) then
    raise insufficient_privilege using message = 'Release reference publication access denied';
  end if;
  actor := public.planning_board_publication_context();
  return actor || (select jsonb_build_object('source_revision', revision.revision::text)
    from workspace_private.release_reference_revision revision where revision.singleton);
end;
$$;
revoke all on function public.platform_release_reference_publication_context() from public, anon, service_role;
grant execute on function public.platform_release_reference_publication_context() to authenticated;

-- Stored PR identities have a numeric value, including decimal strings in older links.
create function workspace_private.release_reference_pr_number(value jsonb)
returns double precision language sql immutable security invoker set search_path = '' as $$
  select case when jsonb_typeof(value) in ('number', 'string')
    and pg_input_is_valid(value #>> '{}', 'double precision')
    then (value #>> '{}')::double precision
    when value = 'true'::jsonb then 1::double precision
  end
$$;
revoke all on function workspace_private.release_reference_pr_number(jsonb) from public, anon, authenticated, service_role;

create function public.planning_release_reference_snapshot(
  p_user_id uuid, p_session_id uuid, p_profile_id text, p_platform_role text,
  p_deadline timestamptz, p_release_keys jsonb
) returns jsonb language sql stable security definer set search_path = '' as $$
with recursive authority as materialized (
  select 1 from public.profiles profile
  join auth.sessions session on session.user_id = profile.auth_user_id and session.id = p_session_id
  where profile.auth_user_id = p_user_id and profile.id = p_profile_id and profile.platform_role = p_platform_role
    and profile.platform_role in ('ceo', 'deputy', 'founder', 'viewer')
    and (session.not_after is null or session.not_after > statement_timestamp())
    and p_deadline > statement_timestamp()
), source as materialized (
  select revision::text as revision from workspace_private.release_reference_revision where singleton
), requested as materialized (
  select item.key->>'version' as version, item.key->>'manifestDigest' as digest, item.ordinal
  from jsonb_array_elements(case when jsonb_typeof(p_release_keys) = 'array' then p_release_keys else '[]'::jsonb end)
    with ordinality item(key, ordinal)
  where exists(select 1 from authority) and case when jsonb_typeof(p_release_keys) = 'array' then jsonb_array_length(p_release_keys) else 0 end between 1 and 200
), releases as materialized (
  select release.version, release.manifest_digest, release.manifest, requested.ordinal
  from requested join public.platform_releases release
    on release.version = requested.version and release.manifest_digest = requested.digest
), listed_pull_requests as (
  select release.version, pull.value->>'repository' as repository,
    lower(btrim(pull.value->>'repository')) as normalized_repository,
    workspace_private.release_reference_pr_number(pull.value->'number') as number,
    pull.value->'issues' as issues, component.ordinal as component_order, pull.ordinal as pull_order
  from releases release
  cross join lateral jsonb_array_elements(release.manifest->'components') with ordinality component(value, ordinal)
  cross join lateral jsonb_array_elements(component.value->'pullRequests') with ordinality pull(value, ordinal)
), ordered_pull_requests as (
  select *, row_number() over (partition by version order by component_order, pull_order) as source_order
  from listed_pull_requests
), pull_requests as materialized (
  select distinct on (version, normalized_repository, number)
    version, repository, normalized_repository, number, issues,
    min(source_order) over (partition by version, normalized_repository, number) as first_order
  from ordered_pull_requests
  order by version, normalized_repository, number, source_order desc
), direct_seeds as materialized (
  select pull.version, pull.normalized_repository, pull.number, link.task_id, min(link.id) as first_link_id
  from pull_requests pull
  join public.task_links link on link.type = 'github_pull_request'
    and jsonb_typeof(link.metadata->'repository') = 'string'
    and lower(btrim(link.metadata->>'repository')) = pull.normalized_repository
    and workspace_private.release_reference_pr_number(link.metadata->'number') = pull.number
  group by pull.version, pull.normalized_repository, pull.number, link.task_id
), fallback_seeds as (
  select pull.version, pull.normalized_repository, pull.number, task.id as task_id, min(issue.ordinal) as first_issue
  from pull_requests pull
  cross join lateral jsonb_array_elements(coalesce(pull.issues, '[]'::jsonb)) with ordinality issue(value, ordinal)
  join public.active_tasks task on lower(btrim(task.github_repo)) = lower(btrim(issue.value->>'repository'))
    and task.github_issue_number = workspace_private.release_reference_pr_number(issue.value->'number')
  where not exists(select 1 from direct_seeds direct
    where direct.version = pull.version and direct.normalized_repository = pull.normalized_repository and direct.number = pull.number)
  group by pull.version, pull.normalized_repository, pull.number, task.id
), seeds as (
  select version, normalized_repository, number, task_id,
    row_number() over (partition by version, normalized_repository, number order by ordinal, task_id) as seed_order
  from (
    select version, normalized_repository, number, task_id, first_link_id as ordinal from direct_seeds
    union all
    select version, normalized_repository, number, task_id, first_issue as ordinal from fallback_seeds
  ) scope_seeds
), lineage as (
  select seed.version, seed.normalized_repository, seed.number, seed.seed_order,
    0 as depth, array[task.id] as visited, task.id, task.title, task.task_type, task.parent_task_id, task.github_issue_number
  from seeds seed join public.active_tasks task on task.id = seed.task_id
  union all
  select child.version, child.normalized_repository, child.number, child.seed_order,
    child.depth + 1, child.visited || parent.id, parent.id, parent.title, parent.task_type, parent.parent_task_id, parent.github_issue_number
  from lineage child join public.active_tasks parent on parent.id = child.parent_task_id
  where not parent.id = any(child.visited)
), links as (
  select distinct on (version, normalized_repository, number, id)
    version, normalized_repository, number, seed_order, depth, id, title, task_type, github_issue_number
  from lineage
  where task_type in ('initiative', 'deliverable', 'sub_issue')
  order by version, normalized_repository, number, id, seed_order, depth
), links_by_pull as (
  select version, normalized_repository, number, jsonb_agg(
    jsonb_build_object('id', id, 'title', title, 'type', task_type, 'issueNumber', nullif(github_issue_number,0))
    order by seed_order, depth, id) as task_links
  from links group by version, normalized_repository, number
), references_by_release as (
  select pull.version, jsonb_agg(
    jsonb_build_object('repository', pull.repository, 'pullRequestNumber', pull.number,
      'taskLinks', coalesce(match.task_links, '[]'::jsonb)) order by pull.first_order) as planning_references
  from pull_requests pull
  left join links_by_pull match using (version, normalized_repository, number)
  group by pull.version
)
select case
  when not exists(select 1 from authority) then jsonb_build_object('status', 'forbidden')
  when not exists(select 1 from source) then jsonb_build_object('status', 'unavailable')
  when not exists(select 1 from requested) then jsonb_build_object('status', 'unavailable')
  when (select count(*) from requested) <> (select count(*) from releases) then jsonb_build_object('status', 'stale')
  when exists(select 1 from releases where jsonb_typeof(manifest->'components') is distinct from 'array')
    or exists(select 1 from listed_pull_requests where coalesce(normalized_repository, '') = ''
      or number is null or number <= 0 or number <> trunc(number) or number > 9007199254740991
      or jsonb_typeof(issues) is distinct from 'array')
    then jsonb_build_object('status', 'unavailable')
  else jsonb_build_object('status', 'ready', 'source_revision', (select revision from source),
    'releases', (select jsonb_agg(jsonb_build_object('version', release.version, 'manifestDigest', release.manifest_digest,
      'planningReferences', coalesce(reference.planning_references, '[]'::jsonb)) order by release.ordinal)
      from releases release left join references_by_release reference using (version)))
end;
$$;
revoke all on function public.planning_release_reference_snapshot(uuid,uuid,text,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.planning_release_reference_snapshot(uuid,uuid,text,text,timestamptz,jsonb) to service_role;
