-- Keeps the legacy-to-canonical backfill idempotent and executable by the
-- local upgrade verifier. The migration invokes the same routine that the
-- behavioral fixture exercises; browser sessions cannot execute it.
create or replace function public.backfill_unified_planning_hierarchy()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
  v_milestone public.milestones%rowtype;
  v_package public.packages%rowtype;
  v_task_id text;
  v_parent_id text;
begin
  if exists (
    select 1
    from public.packages package
    left join public.milestones milestone on milestone.id = package.milestone_id
    where package.approval_status = 'approved'
      and milestone.id is null
  ) then
    raise exception using errcode = '23514', message = 'approved legacy initiative is missing its milestone parent';
  end if;

  if exists (
    select 1
    from public.tasks task
    left join public.packages package on package.id = task.package_id
    where task.task_type = 'deliverable'
      and task.trashed_at is null
      and task.approval_status = 'approved'
      and task.parent_task_id is null
      and (package.id is null or package.approval_status <> 'approved')
  ) then
    raise exception using errcode = '23514', message = 'approved deliverable is missing an approved initiative parent';
  end if;

  if exists (
    select 1
    from public.packages package
    cross join lateral unnest(
      array_cat(
        array[package.accountable_profile_id],
        array_cat(
          coalesce(package.responsible_profile_ids, '{}'::text[]),
          array_cat(
            coalesce(package.consulted_profile_ids, '{}'::text[]),
            coalesce(package.informed_profile_ids, '{}'::text[])
          )
        )
      )
    ) as assignment(profile_id)
    left join public.profiles profile on profile.id = assignment.profile_id
    where assignment.profile_id is not null
      and profile.id is null
  ) then
    raise exception using errcode = '23503', message = 'legacy initiative RACI references an unknown profile';
  end if;

  perform set_config('app.planning_hierarchy_backfill', 'true', true);
  perform set_config('founderops.trash_lifecycle_write', 'on', true);

  for v_milestone in select * from public.milestones order by id loop
    select task_id into v_task_id
    from public.planning_item_legacy_ids
    where source_kind = 'milestone' and legacy_id = v_milestone.id;
    if not found then
      v_task_id := public.planning_legacy_item_id('epic', v_milestone.project_id, v_milestone.id);
    end if;

    insert into public.tasks (
      id, project_id, title, description, status, priority, sort_order,
      target_date, created_at, updated_at, task_type, parent_task_id,
      approval_status, approval_revision, github_issue_sync_status,
      score_relevant, review_status
    ) values (
      v_task_id,
      v_milestone.project_id,
      v_milestone.title,
      v_milestone.description,
      case v_milestone.status
        when 'active' then 'In Arbeit'
        when 'done' then 'Erledigt'
        else 'Offen'
      end,
      null,
      v_milestone.sort_order,
      v_milestone.target_date,
      v_milestone.created_at,
      v_milestone.updated_at,
      'epic',
      null,
      null,
      1,
      'not_applicable',
      false,
      'not_requested'
    ) on conflict (id) do nothing;

    insert into public.planning_item_legacy_ids (source_kind, legacy_id, task_id, project_id)
    values ('milestone', v_milestone.id, v_task_id, v_milestone.project_id)
    on conflict (source_kind, legacy_id) do nothing;
  end loop;

  for v_package in select * from public.packages order by id loop
    select task_id into v_parent_id
    from public.planning_item_legacy_ids
    where source_kind = 'milestone' and legacy_id = v_package.milestone_id;

    select task_id into v_task_id
    from public.planning_item_legacy_ids
    where source_kind = 'package' and legacy_id = v_package.id;
    if not found then
      v_task_id := public.planning_legacy_item_id('initiative', v_package.project_id, v_package.id);
    end if;

    insert into public.tasks (
      id, project_id, title, description, status, priority, owner, assignee,
      sort_order, target_date, created_at, updated_at, task_type, parent_task_id,
      milestone_id, approval_status, approval_revision, proposed_by, proposed_at,
      decided_by, decided_at, decision_note, trashed_at, trashed_by, trash_reason,
      trash_cause, purge_after, trash_root_type, trash_root_id, trash_revision,
      github_issue_sync_status, score_relevant, review_status
    ) values (
      v_task_id,
      v_package.project_id,
      v_package.title,
      v_package.goal,
      case v_package.status
        when 'active' then 'In Arbeit'
        when 'paused' then 'Pausiert'
        when 'done' then 'Erledigt'
        else 'Offen'
      end,
      coalesce(nullif(trim(v_package.priority), ''), 'P2'),
      v_package.owner_id,
      v_package.owner_id,
      v_package.sort_order,
      v_package.target_date,
      v_package.updated_at,
      v_package.updated_at,
      'initiative',
      v_parent_id,
      v_package.milestone_id,
      v_package.approval_status,
      v_package.approval_revision,
      v_package.proposed_by,
      v_package.proposed_at,
      v_package.decided_by,
      v_package.decided_at,
      v_package.decision_note,
      v_package.trashed_at,
      v_package.trashed_by,
      v_package.trash_reason,
      v_package.trash_cause,
      v_package.purge_after,
      v_package.trash_root_type,
      case when v_package.trashed_at is not null then v_task_id else null end,
      v_package.trash_revision,
      'not_applicable',
      false,
      'not_requested'
    ) on conflict (id) do nothing;

    insert into public.planning_item_legacy_ids (source_kind, legacy_id, task_id, project_id)
    values ('package', v_package.id, v_task_id, v_package.project_id)
    on conflict (source_kind, legacy_id) do nothing;
  end loop;

  insert into public.planning_item_strategy (task_id, goal, success_criteria, scope_constraints)
  select
    legacy.task_id,
    coalesce(package.goal, ''),
    coalesce(package.success_criteria, ''),
    coalesce(package.scope_constraints, '')
  from public.packages package
  join public.planning_item_legacy_ids legacy
    on legacy.source_kind = 'package'
   and legacy.legacy_id = package.id
  on conflict (task_id) do nothing;

  insert into public.planning_item_raci_assignments (task_id, profile_id, role, sort_order)
  select legacy.task_id, package.accountable_profile_id, 'accountable', 0
  from public.packages package
  join public.planning_item_legacy_ids legacy
    on legacy.source_kind = 'package' and legacy.legacy_id = package.id
  where package.accountable_profile_id is not null
  union all
  select legacy.task_id, assignment.profile_id, 'responsible', assignment.ordinality::integer
  from public.packages package
  join public.planning_item_legacy_ids legacy
    on legacy.source_kind = 'package' and legacy.legacy_id = package.id
  cross join lateral unnest(coalesce(package.responsible_profile_ids, '{}'::text[]))
    with ordinality as assignment(profile_id, ordinality)
  union all
  select legacy.task_id, assignment.profile_id, 'consulted', assignment.ordinality::integer
  from public.packages package
  join public.planning_item_legacy_ids legacy
    on legacy.source_kind = 'package' and legacy.legacy_id = package.id
  cross join lateral unnest(coalesce(package.consulted_profile_ids, '{}'::text[]))
    with ordinality as assignment(profile_id, ordinality)
  union all
  select legacy.task_id, assignment.profile_id, 'informed', assignment.ordinality::integer
  from public.packages package
  join public.planning_item_legacy_ids legacy
    on legacy.source_kind = 'package' and legacy.legacy_id = package.id
  cross join lateral unnest(coalesce(package.informed_profile_ids, '{}'::text[]))
    with ordinality as assignment(profile_id, ordinality)
  on conflict (task_id, profile_id, role) do nothing;

  update public.tasks task
  set parent_task_id = legacy.task_id
  from public.planning_item_legacy_ids legacy
  where task.task_type = 'deliverable'
    and task.package_id = legacy.legacy_id
    and legacy.source_kind = 'package'
    and task.parent_task_id is distinct from legacy.task_id;

  update public.tasks task
  set trash_root_id = legacy.task_id
  from public.planning_item_legacy_ids legacy
  where task.task_type in ('deliverable', 'sub_issue')
    and task.trashed_at is not null
    and task.trash_root_type = 'initiative'
    and task.trash_root_id = legacy.legacy_id
    and legacy.source_kind = 'package';

  update public.profile_ui_preferences preference
  set planning_filters = case
        when exists (
          select 1
          from public.planning_item_legacy_ids legacy
          where legacy.source_kind = 'package'
            and legacy.legacy_id = preference.planning_filters->>'packageId'
        ) then jsonb_set(
          preference.planning_filters,
          '{packageId}',
          to_jsonb((
            select legacy.task_id
            from public.planning_item_legacy_ids legacy
            where legacy.source_kind = 'package'
              and legacy.legacy_id = preference.planning_filters->>'packageId'
          )),
          true
        )
        else preference.planning_filters
      end,
      expanded_package_ids = array(
        select coalesce(legacy.task_id, expanded.package_id)
        from unnest(preference.expanded_package_ids)
          with ordinality as expanded(package_id, position)
        left join public.planning_item_legacy_ids legacy
          on legacy.source_kind = 'package'
         and legacy.legacy_id = expanded.package_id
        order by expanded.position
      )
  where exists (
      select 1
      from public.planning_item_legacy_ids legacy
      where legacy.source_kind = 'package'
        and legacy.legacy_id = preference.planning_filters->>'packageId'
    )
    or exists (
      select 1
      from unnest(preference.expanded_package_ids) expanded(package_id)
      join public.planning_item_legacy_ids legacy
        on legacy.source_kind = 'package'
       and legacy.legacy_id = expanded.package_id
    );

  if exists (
    select 1
    from public.milestones milestone
    left join public.planning_item_legacy_ids legacy
      on legacy.source_kind = 'milestone'
     and legacy.legacy_id = milestone.id
    left join public.tasks task
      on task.id = legacy.task_id
     and task.task_type = 'epic'
    where legacy.task_id is null or task.id is null
  ) then
    raise exception using errcode = '23514', message = 'milestone to epic backfill verification failed';
  end if;

  if exists (
    select 1
    from public.packages package
    left join public.planning_item_legacy_ids legacy
      on legacy.source_kind = 'package'
     and legacy.legacy_id = package.id
    left join public.tasks task
      on task.id = legacy.task_id
     and task.task_type = 'initiative'
    where legacy.task_id is null or task.id is null
  ) then
    raise exception using errcode = '23514', message = 'package to initiative backfill verification failed';
  end if;

  if exists (
    select 1
    from public.tasks task
    join public.planning_item_legacy_ids legacy
      on legacy.source_kind = 'package'
     and legacy.legacy_id = task.package_id
    where task.task_type = 'deliverable'
      and task.parent_task_id is distinct from legacy.task_id
  ) then
    raise exception using errcode = '23514', message = 'deliverable parent backfill verification failed';
  end if;

  if exists (
    select 1
    from public.profile_ui_preferences preference
    join public.planning_item_legacy_ids legacy
      on legacy.source_kind = 'package'
     and legacy.legacy_id = preference.planning_filters->>'packageId'
  ) or exists (
    select 1
    from public.profile_ui_preferences preference
    cross join lateral unnest(preference.expanded_package_ids) expanded(package_id)
    join public.planning_item_legacy_ids legacy
      on legacy.source_kind = 'package'
     and legacy.legacy_id = expanded.package_id
  ) then
    raise exception using errcode = '23514', message = 'planning preference package id migration verification failed';
  end if;

  perform set_config('app.planning_hierarchy_backfill', 'false', true);
  perform set_config('founderops.trash_lifecycle_write', 'off', true);

  select jsonb_build_object(
    'milestones', (select count(*) from public.planning_item_legacy_ids where source_kind = 'milestone'),
    'initiatives', (select count(*) from public.planning_item_legacy_ids where source_kind = 'package')
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.backfill_unified_planning_hierarchy() from public, anon, authenticated;
grant execute on function public.backfill_unified_planning_hierarchy() to service_role;

select public.backfill_unified_planning_hierarchy();
