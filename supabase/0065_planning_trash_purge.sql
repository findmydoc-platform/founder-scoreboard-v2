-- Bounded, fail-closed physical cleanup for expired planning trash roots.

create or replace function public.purge_expired_planning_trash_batch(
  p_limit integer default 25,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 25));
  v_candidate record;
  v_root_record record;
  v_task_ids text[];
  v_task_count integer;
  v_outbox_count integer;
  v_completed_outbox_count integer;
  v_resolved_count integer;
  v_purged_roots integer := 0;
  v_purged_tasks integer := 0;
  v_resolved_notifications integer := 0;
  v_eligible_roots integer := 0;
  v_eligible_tasks integer := 0;
  v_has_more boolean := false;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('planning-trash-purge', 0)) then
    return jsonb_build_object(
      'busy', true,
      'dryRun', coalesce(p_dry_run, false),
      'eligibleRoots', 0,
      'eligibleTasks', 0,
      'purgedRoots', 0,
      'purgedTasks', 0,
      'resolvedNotifications', 0,
      'hasMore', true
    );
  end if;

  perform set_config('founderops.trash_lifecycle_write', 'on', true);

  for v_candidate in
    select candidate.root_type, candidate.root_id, candidate.trash_revision, candidate.purge_after
    from (
      select 'initiative'::text as root_type, package.id as root_id,
        package.trash_revision, package.purge_after
      from public.packages package
      where package.trashed_at is not null
        and package.trash_root_type = 'initiative'
        and package.trash_root_id = package.id
        and package.purge_after <= now()
      union all
      select 'deliverable'::text as root_type, task.id as root_id,
        task.trash_revision, task.purge_after
      from public.tasks task
      where task.trashed_at is not null
        and task.task_type = 'deliverable'
        and task.trash_root_type = 'deliverable'
        and task.trash_root_id = task.id
        and task.purge_after <= now()
    ) candidate
    order by candidate.purge_after, candidate.root_type, candidate.root_id
  loop
    exit when v_purged_roots + v_eligible_roots >= v_limit;

    if v_candidate.root_type = 'initiative' then
      select package.id, package.trash_cause, package.trashed_at, package.purge_after,
        package.trash_revision
      into v_root_record
      from public.packages package
      where package.id = v_candidate.root_id
        and package.trashed_at is not null
        and package.trash_root_type = 'initiative'
        and package.trash_root_id = package.id
        and package.trash_revision = v_candidate.trash_revision
        and package.purge_after <= now()
      for update skip locked;
    else
      select task.id, task.trash_cause, task.trashed_at, task.purge_after,
        task.trash_revision
      into v_root_record
      from public.tasks task
      where task.id = v_candidate.root_id
        and task.trashed_at is not null
        and task.task_type = 'deliverable'
        and task.trash_root_type = 'deliverable'
        and task.trash_root_id = task.id
        and task.trash_revision = v_candidate.trash_revision
        and task.purge_after <= now()
      for update skip locked;
    end if;

    if v_root_record.id is null then
      continue;
    end if;

    if v_candidate.root_type = 'initiative' then
      if exists (
        select 1
        from public.tasks task
        where task.package_id = v_candidate.root_id
          and not (
            task.trashed_at is not null
            and task.trash_root_type = 'initiative'
            and task.trash_root_id = v_candidate.root_id
            and task.trash_revision = v_candidate.trash_revision
          )
      ) then
        continue;
      end if;

      select coalesce(array_agg(task.id order by task.id), '{}'::text[]), count(*)::integer
      into v_task_ids, v_task_count
      from public.tasks task
      where task.trash_root_type = 'initiative'
        and task.trash_root_id = v_candidate.root_id
        and task.trash_revision = v_candidate.trash_revision
        and task.trashed_at is not null;
    else
      if exists (
        select 1
        from public.tasks task
        where (task.id = v_candidate.root_id or task.parent_task_id = v_candidate.root_id)
          and not (
            task.trashed_at is not null
            and task.trash_root_type = 'deliverable'
            and task.trash_root_id = v_candidate.root_id
            and task.trash_revision = v_candidate.trash_revision
          )
      ) then
        continue;
      end if;

      select coalesce(array_agg(task.id order by task.id), '{}'::text[]), count(*)::integer
      into v_task_ids, v_task_count
      from public.tasks task
      where task.trash_root_type = 'deliverable'
        and task.trash_root_id = v_candidate.root_id
        and task.trash_revision = v_candidate.trash_revision
        and task.trashed_at is not null;
    end if;

    select count(*)::integer,
      count(*) filter (where lifecycle.status = 'completed')::integer
    into v_outbox_count, v_completed_outbox_count
    from public.planning_github_lifecycle_outbox lifecycle
    where lifecycle.root_type = v_candidate.root_type
      and lifecycle.root_id = v_candidate.root_id
      and lifecycle.root_trash_revision = v_candidate.trash_revision
      and lifecycle.action = 'close_not_planned';

    if v_outbox_count <> v_task_count or v_completed_outbox_count <> v_task_count then
      continue;
    end if;

    if coalesce(p_dry_run, false) then
      v_eligible_roots := v_eligible_roots + 1;
      v_eligible_tasks := v_eligible_tasks + v_task_count;
      continue;
    end if;

    update public.notification_events notification
    set status = 'resolved',
        resolved_at = coalesce(notification.resolved_at, now()),
        resolution_reason = coalesce(notification.resolution_reason, 'source_purged')
    where notification.status in ('pending', 'sent', 'failed')
      and (
        (notification.entity_type = 'initiative' and notification.entity_id = v_candidate.root_id)
        or (notification.entity_type = 'task' and notification.entity_id = any(v_task_ids))
      );
    get diagnostics v_resolved_count = row_count;
    v_resolved_notifications := v_resolved_notifications + v_resolved_count;

    if v_candidate.root_type = 'initiative' then
      update public.profile_ui_preferences preference
      set expanded_package_ids = array_remove(preference.expanded_package_ids, v_candidate.root_id),
          planning_filters = case
            when preference.planning_filters->>'packageId' = v_candidate.root_id
              then jsonb_set(preference.planning_filters, '{packageId}', '"Alle"'::jsonb, true)
            else preference.planning_filters
          end,
          updated_at = now()
      where v_candidate.root_id = any(preference.expanded_package_ids)
        or preference.planning_filters->>'packageId' = v_candidate.root_id;
    end if;

    insert into public.audit_log (
      action,
      entity_type,
      entity_id,
      before_data,
      after_data
    ) values (
      'planning_trash.purge',
      v_candidate.root_type,
      v_candidate.root_id,
      jsonb_build_object(
        'trashCause', v_root_record.trash_cause,
        'trashedAt', v_root_record.trashed_at,
        'purgeAfter', v_root_record.purge_after,
        'trashRevision', v_candidate.trash_revision
      ),
      jsonb_build_object(
        'purgedAt', now(),
        'taskCount', v_task_count,
        'completedGitHubLifecycleJobs', v_completed_outbox_count,
        'resolvedNotifications', v_resolved_count
      )
    );

    delete from public.planning_github_lifecycle_outbox lifecycle
    where lifecycle.root_type = v_candidate.root_type
      and lifecycle.root_id = v_candidate.root_id
      and lifecycle.root_trash_revision = v_candidate.trash_revision;

    delete from public.tasks task
    where task.id = any(v_task_ids)
      and task.trashed_at is not null
      and task.trash_root_type = v_candidate.root_type
      and task.trash_root_id = v_candidate.root_id
      and task.trash_revision = v_candidate.trash_revision;

    if v_candidate.root_type = 'initiative' then
      delete from public.packages package
      where package.id = v_candidate.root_id
        and package.trashed_at is not null
        and package.trash_root_type = 'initiative'
        and package.trash_root_id = package.id
        and package.trash_revision = v_candidate.trash_revision;
    end if;

    v_purged_roots := v_purged_roots + 1;
    v_purged_tasks := v_purged_tasks + v_task_count;
  end loop;

  select exists (
    select 1 from public.packages package
    where package.trashed_at is not null and package.purge_after <= now()
    union all
    select 1 from public.tasks task
    where task.trashed_at is not null
      and task.task_type = 'deliverable'
      and task.trash_root_type = 'deliverable'
      and task.trash_root_id = task.id
      and task.purge_after <= now()
  ) into v_has_more;

  return jsonb_build_object(
    'busy', false,
    'dryRun', coalesce(p_dry_run, false),
    'eligibleRoots', v_eligible_roots,
    'eligibleTasks', v_eligible_tasks,
    'purgedRoots', v_purged_roots,
    'purgedTasks', v_purged_tasks,
    'resolvedNotifications', v_resolved_notifications,
    'hasMore', v_has_more
  );
end;
$$;

revoke all on function public.purge_expired_planning_trash_batch(integer, boolean)
  from public, anon, authenticated;
grant execute on function public.purge_expired_planning_trash_batch(integer, boolean)
  to service_role;

comment on function public.purge_expired_planning_trash_batch(integer, boolean)
is 'Purges at most 25 expired planning trash roots after complete GitHub lifecycle processing while retaining audit and notification history.';

notify pgrst, 'reload schema';
