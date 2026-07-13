-- Bounded, fail-closed physical cleanup for expired planning trash roots.

create or replace function public.planning_trash_root_is_purge_eligible(
  p_root_type text,
  p_root_id text,
  p_trash_revision integer
)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_root_package_id text;
  v_root_trashed_at timestamptz;
  v_root_purge_after timestamptz;
  v_root_trash_cause text;
begin
  if p_root_type is null
     or p_root_type not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_root_id, '')), '') is null
     or p_trash_revision is null
     or p_trash_revision < 1 then
    return false;
  end if;

  if p_root_type = 'initiative' then
    select package.trashed_at, package.purge_after, package.trash_cause
    into v_root_trashed_at, v_root_purge_after, v_root_trash_cause
    from public.packages package
    where package.id = p_root_id
      and package.trashed_at is not null
      and package.trash_root_type = 'initiative'
      and package.trash_root_id = package.id
      and package.trash_revision = p_trash_revision
      and package.purge_after <= now();
    if not found then
      return false;
    end if;

    if exists (
      select 1
      from public.tasks task
      where task.package_id = p_root_id
        and not (
          task.trashed_at is not distinct from v_root_trashed_at
          and task.purge_after is not distinct from v_root_purge_after
          and task.trash_cause is not distinct from v_root_trash_cause
          and task.trash_root_type = 'initiative'
          and task.trash_root_id = p_root_id
          and task.trash_revision = p_trash_revision
        )
    ) or exists (
      select 1
      from public.tasks task
      where task.trashed_at is not null
        and task.trash_root_type = 'initiative'
        and task.trash_root_id = p_root_id
        and task.trash_revision = p_trash_revision
        and task.package_id is distinct from p_root_id
    ) or exists (
      select 1
      from public.tasks task
      where task.package_id = p_root_id
        and not (
          (task.task_type = 'deliverable' and task.parent_task_id is null)
          or (
            task.task_type = 'sub_issue'
            and exists (
              select 1
              from public.tasks parent
              where parent.id = task.parent_task_id
                and parent.task_type = 'deliverable'
                and parent.package_id = p_root_id
            )
          )
        )
    ) or exists (
      select 1
      from public.tasks external_task
      where external_task.parent_task_id in (
        select member.id
        from public.tasks member
        where member.package_id = p_root_id
      )
        and external_task.package_id is distinct from p_root_id
    ) then
      return false;
    end if;
  else
    select task.package_id, task.trashed_at, task.purge_after, task.trash_cause
    into v_root_package_id, v_root_trashed_at, v_root_purge_after, v_root_trash_cause
    from public.tasks task
    where task.id = p_root_id
      and task.task_type = 'deliverable'
      and task.parent_task_id is null
      and task.package_id is not null
      and task.trashed_at is not null
      and task.trash_root_type = 'deliverable'
      and task.trash_root_id = task.id
      and task.trash_revision = p_trash_revision
      and task.purge_after <= now();
    if not found then
      return false;
    end if;

    if exists (
      select 1
      from public.tasks task
      where (task.id = p_root_id or task.parent_task_id = p_root_id)
        and not (
          task.trashed_at is not distinct from v_root_trashed_at
          and task.purge_after is not distinct from v_root_purge_after
          and task.trash_cause is not distinct from v_root_trash_cause
          and task.trash_root_type = 'deliverable'
          and task.trash_root_id = p_root_id
          and task.trash_revision = p_trash_revision
        )
    ) or exists (
      select 1
      from public.tasks task
      where task.trashed_at is not null
        and task.trash_root_type = 'deliverable'
        and task.trash_root_id = p_root_id
        and task.trash_revision = p_trash_revision
        and task.id is distinct from p_root_id
        and task.parent_task_id is distinct from p_root_id
    ) or exists (
      select 1
      from public.tasks child
      where child.parent_task_id = p_root_id
        and (
          child.task_type <> 'sub_issue'
          or child.package_id is distinct from v_root_package_id
        )
    ) or exists (
      select 1
      from public.tasks descendant
      where descendant.parent_task_id in (
        select child.id
        from public.tasks child
        where child.parent_task_id = p_root_id
      )
    ) then
      return false;
    end if;
  end if;

  if exists (
    select 1
    from public.tasks task
    where task.trashed_at is not null
      and task.trash_root_type = p_root_type
      and task.trash_root_id = p_root_id
      and task.trash_revision = p_trash_revision
      and (
        (p_root_type = 'initiative' and task.package_id = p_root_id)
        or (
          p_root_type = 'deliverable'
          and (task.id = p_root_id or task.parent_task_id = p_root_id)
        )
      )
      and not exists (
        select 1
        from public.planning_github_lifecycle_outbox lifecycle
        where lifecycle.root_type = p_root_type
          and lifecycle.root_id = p_root_id
          and lifecycle.root_trash_revision = p_trash_revision
          and lifecycle.task_id = task.id
          and lifecycle.action = 'close_not_planned'
          and lifecycle.status = 'completed'
          and (
            (lifecycle.github_issue_number is null and lifecycle.status_reason = 'issue_missing')
            or (lifecycle.github_issue_number is not null and lifecycle.status_reason = 'delivered')
          )
      )
  ) or exists (
    select 1
    from public.planning_github_lifecycle_outbox lifecycle
    where lifecycle.root_type = p_root_type
      and lifecycle.root_id = p_root_id
      and lifecycle.root_trash_revision = p_trash_revision
      and lifecycle.action = 'close_not_planned'
      and not exists (
        select 1
        from public.tasks task
        where task.id = lifecycle.task_id
          and task.trashed_at is not null
          and task.trash_root_type = p_root_type
          and task.trash_root_id = p_root_id
          and task.trash_revision = p_trash_revision
          and (
            (p_root_type = 'initiative' and task.package_id = p_root_id)
            or (
              p_root_type = 'deliverable'
              and (task.id = p_root_id or task.parent_task_id = p_root_id)
            )
          )
      )
  ) then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.planning_trash_root_is_purge_eligible(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.planning_trash_root_is_purge_eligible(text, text, integer)
  to service_role;

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
  v_scan_limit integer := least(greatest(1, coalesce(p_limit, 25)) * 4, 100);
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
  v_blocked_expired_roots integer := 0;
  v_locked_roots integer := 0;
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
      'blockedExpiredRoots', 0,
      'hasMore', true
    );
  end if;

  perform set_config('founderops.trash_lifecycle_write', 'on', true);

  for v_candidate in
    with initiative_candidates as (
      select 'initiative'::text as root_type, package.id as root_id,
        package.trash_revision, package.purge_after
      from public.packages package
      where package.trashed_at is not null
        and package.trash_root_type = 'initiative'
        and package.trash_root_id = package.id
        and package.purge_after <= now()
      order by package.purge_after, package.id
      limit v_scan_limit
    ), deliverable_candidates as (
      select 'deliverable'::text as root_type, task.id as root_id,
        task.trash_revision, task.purge_after
      from public.tasks task
      where task.trashed_at is not null
        and task.task_type = 'deliverable'
        and task.trash_root_type = 'deliverable'
        and task.trash_root_id = task.id
        and task.purge_after <= now()
      order by task.purge_after, task.id
      limit v_scan_limit
    ), candidate_roots as (
      select * from initiative_candidates
      union all
      select * from deliverable_candidates
    )
    select candidate.root_type, candidate.root_id, candidate.trash_revision, candidate.purge_after
    from candidate_roots candidate
    order by candidate.purge_after, candidate.root_type, candidate.root_id
    limit v_scan_limit
  loop
    exit when v_locked_roots >= v_limit;

    if not public.planning_trash_root_is_purge_eligible(
      v_candidate.root_type,
      v_candidate.root_id,
      v_candidate.trash_revision
    ) then
      continue;
    end if;

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
        and task.parent_task_id is null
        and task.package_id is not null
        and task.trash_root_type = 'deliverable'
        and task.trash_root_id = task.id
        and task.trash_revision = v_candidate.trash_revision
        and task.purge_after <= now()
      for update skip locked;
    end if;

    if v_root_record.id is null
    then
      continue;
    end if;

    v_locked_roots := v_locked_roots + 1;
    if v_candidate.root_type = 'initiative' then
      perform task.id
      from public.tasks task
      where task.package_id = v_candidate.root_id
      order by task.id
      for update;
    else
      perform task.id
      from public.tasks task
      where task.id = v_candidate.root_id or task.parent_task_id = v_candidate.root_id
      order by task.id
      for update;
    end if;

    if not public.planning_trash_root_is_purge_eligible(
         v_candidate.root_type,
         v_candidate.root_id,
         v_candidate.trash_revision
       ) then
      continue;
    end if;

    if v_candidate.root_type = 'initiative' then
      select coalesce(array_agg(task.id order by task.id), '{}'::text[]), count(*)::integer
      into v_task_ids, v_task_count
      from public.tasks task
      where task.trash_root_type = 'initiative'
        and task.trash_root_id = v_candidate.root_id
        and task.trash_revision = v_candidate.trash_revision
        and task.package_id = v_candidate.root_id
        and task.trashed_at is not null;
    else
      select coalesce(array_agg(task.id order by task.id), '{}'::text[]), count(*)::integer
      into v_task_ids, v_task_count
      from public.tasks task
      where task.trash_root_type = 'deliverable'
        and task.trash_root_id = v_candidate.root_id
        and task.trash_revision = v_candidate.trash_revision
        and (task.id = v_candidate.root_id or task.parent_task_id = v_candidate.root_id)
        and task.trashed_at is not null;
    end if;

    select count(*)::integer,
      count(*) filter (
        where lifecycle.status = 'completed'
          and (
            (lifecycle.github_issue_number is null and lifecycle.status_reason = 'issue_missing')
            or (lifecycle.github_issue_number is not null and lifecycle.status_reason = 'delivered')
          )
      )::integer
    into v_outbox_count, v_completed_outbox_count
    from public.planning_github_lifecycle_outbox lifecycle
    where lifecycle.root_type = v_candidate.root_type
      and lifecycle.root_id = v_candidate.root_id
      and lifecycle.root_trash_revision = v_candidate.trash_revision
      and lifecycle.action = 'close_not_planned';

    if v_outbox_count <> v_task_count
       or v_completed_outbox_count <> v_task_count
       or exists (
         select 1
         from unnest(v_task_ids) as expected(task_id)
         where not exists (
           select 1
           from public.planning_github_lifecycle_outbox lifecycle
           where lifecycle.root_type = v_candidate.root_type
             and lifecycle.root_id = v_candidate.root_id
             and lifecycle.root_trash_revision = v_candidate.trash_revision
             and lifecycle.task_id = expected.task_id
             and lifecycle.action = 'close_not_planned'
             and lifecycle.status = 'completed'
             and (
               (lifecycle.github_issue_number is null and lifecycle.status_reason = 'issue_missing')
               or (lifecycle.github_issue_number is not null and lifecycle.status_reason = 'delivered')
             )
         )
       )
       or exists (
         select 1
         from public.planning_github_lifecycle_outbox lifecycle
         where lifecycle.root_type = v_candidate.root_type
           and lifecycle.root_id = v_candidate.root_id
           and lifecycle.root_trash_revision = v_candidate.trash_revision
           and lifecycle.action = 'close_not_planned'
           and not (lifecycle.task_id = any(v_task_ids))
       ) then
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
        (
          v_candidate.root_type = 'initiative'
          and notification.entity_type = 'initiative'
          and notification.entity_id = v_candidate.root_id
        )
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
    where package.trashed_at is not null
      and package.trash_root_type = 'initiative'
      and package.trash_root_id = package.id
      and package.purge_after <= now()
    union all
    select 1 from public.tasks task
    where task.trashed_at is not null
      and task.task_type = 'deliverable'
      and task.trash_root_type = 'deliverable'
      and task.trash_root_id = task.id
      and task.purge_after <= now()
  ) into v_has_more;

  with initiative_candidates as (
    select 'initiative'::text as root_type, package.id as root_id, package.trash_revision
    from public.packages package
    where package.trashed_at is not null
      and package.trash_root_type = 'initiative'
      and package.trash_root_id = package.id
      and package.purge_after <= now()
    order by package.purge_after, package.id
    limit v_scan_limit
  ), deliverable_candidates as (
    select 'deliverable'::text as root_type, task.id as root_id, task.trash_revision
    from public.tasks task
    where task.trashed_at is not null
      and task.task_type = 'deliverable'
      and task.trash_root_type = 'deliverable'
      and task.trash_root_id = task.id
      and task.purge_after <= now()
    order by task.purge_after, task.id
    limit v_scan_limit
  ), expired_probe as (
    select * from initiative_candidates
    union all
    select * from deliverable_candidates
  )
  select count(*) filter (
      where not public.planning_trash_root_is_purge_eligible(
        candidate.root_type,
        candidate.root_id,
        candidate.trash_revision
      )
    )::integer
  into v_blocked_expired_roots
  from (
    select probe.*
    from expired_probe probe
    order by probe.root_type, probe.root_id
    limit v_scan_limit
  ) candidate;

  perform set_config('founderops.trash_lifecycle_write', 'off', true);

  return jsonb_build_object(
    'busy', false,
    'dryRun', coalesce(p_dry_run, false),
    'eligibleRoots', v_eligible_roots,
    'eligibleTasks', v_eligible_tasks,
    'purgedRoots', v_purged_roots,
    'purgedTasks', v_purged_tasks,
    'resolvedNotifications', v_resolved_notifications,
    'blockedExpiredRoots', v_blocked_expired_roots,
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
