-- Count and content share lifecycle semantics, not results or authority.
-- Keep each area bounded and evaluated inside its own authorized SQL snapshot.
create function workspace_private.notification_scope_snapshot(
  p_user_id uuid, p_session_id uuid, p_profile_id text, p_platform_role text,
  p_deadline timestamptz, p_area text, p_limit integer
) returns jsonb language sql stable security invoker set search_path = '' as $$
with authority as materialized (
  select profile.id, profile.platform_role, revision.revision::text as source_revision,
    statement_timestamp() as observed_at
  from public.profiles profile
  join auth.sessions session on session.user_id = profile.auth_user_id and session.id = p_session_id
  left join workspace_private.notification_scope_revision revision on revision.singleton
  where profile.auth_user_id = p_user_id and profile.id = p_profile_id
    and profile.platform_role = p_platform_role
    and profile.platform_role in ('ceo', 'deputy', 'founder', 'viewer')
    and (session.not_after is null or session.not_after > statement_timestamp())
    and p_deadline > statement_timestamp()
), events as (
  select event.type, event.recipient_profile_id, event.entity_type, event.entity_id, event.seen_at, basis.observed_at
  from authority basis
  join public.notification_events event on event.status = 'pending'
    and (event.recipient_profile_id = basis.id
      or event.recipient_profile_id is null and basis.platform_role in ('ceo', 'deputy'))
  where basis.source_revision is not null
), evidence as (
  select event.seen_at,
    case
      when event.type in ('task.comment', 'task.mention', 'task.review_completed', 'task.review_reopened', 'sprint.task_carried_over')
        then task.id is not null
      when event.type = 'task.review_requested' then
        task.id is not null and task.review_status = 'requested' and
        case when nullif(task.review_owner_profile_id, '') is not null
          then coalesce(event.recipient_profile_id, '') = task.review_owner_profile_id
          else event.recipient_profile_id is null or recipient.platform_role in ('ceo', 'deputy') end
      when event.type = 'task.review_rework' then task.id is not null
        and (task.review_status = 'changes_requested' or public.planning_selection_status(task.status, false) = 'Nacharbeit')
        and coalesce(nullif(task.assignee, ''), nullif(task.owner, '')) = event.recipient_profile_id
      when event.type = 'task.blocker_reported' then task.id is not null
        and exists(select 1 from public.task_blockers blocker where blocker.task_id = task.id and blocker.status = 'open')
        and (event.recipient_profile_id is null or recipient.platform_role in ('ceo', 'deputy'))
      when event.type = 'task.deadline_overdue' then task.id is not null
        and not task.score_final and public.planning_selection_status(task.status, false) <> 'Erledigt'
        and task.task_type = 'deliverable'
        and coalesce(nullif(task.assignee, ''), nullif(task.owner, '')) = event.recipient_profile_id
        and task.fixed_date <= (event.observed_at at time zone 'Europe/Berlin')::date
      when event.type = 'task.proposed' then task.id is not null and task.approval_status = 'proposed'
        and (event.recipient_profile_id is null or recipient.platform_role in ('ceo', 'deputy'))
      when event.type = 'sprint.review_due' then sprint.id is not null
        and not sprint.score_locked and sprint.status <> 'closed'
        and (sprint.review_due_at at time zone 'UTC')::date <= (event.observed_at at time zone 'Europe/Berlin')::date
      when event.type = 'event.upcoming' then founder_event.id is not null
        and isfinite(founder_event.starts_at) and founder_event.status = 'planned'
        and event.observed_at between founder_event.starts_at - founder_event.reminder_days_before * interval '24 hours' and founder_event.starts_at
        and (event.recipient_profile_id is null or recipient.id is not null and
          (founder_event.audience_mode <> 'selected' or event.recipient_profile_id = any(founder_event.participant_profile_ids)))
      when event.type = 'meeting.attendance_updated' then meeting.id is not null
      when event.type in ('platform_release.published', 'planning_item.rejected', 'task.review_withdrawn') then true
      else false
    end as proven_pending,
    founder_event.starts_at as next_boundary
  from events event
  left join public.active_tasks task on event.entity_type = 'task' and task.id = event.entity_id
    and event.type in ('task.comment', 'task.mention', 'task.review_completed', 'task.review_reopened',
      'sprint.task_carried_over', 'task.review_requested', 'task.review_rework', 'task.blocker_reported',
      'task.deadline_overdue', 'task.proposed')
  left join public.profiles recipient on recipient.id = event.recipient_profile_id
    and event.type in ('task.review_requested', 'task.blocker_reported', 'task.proposed', 'event.upcoming')
  left join public.sprints sprint on event.entity_type = 'sprint' and sprint.id = event.entity_id
    and event.type = 'sprint.review_due'
  left join public.founder_events founder_event on event.entity_type = 'founder_event' and event.type = 'event.upcoming'
    and founder_event.id = case when event.entity_id ~ '^-?(0|[1-9][0-9]*)$'
      and pg_input_is_valid(event.entity_id, 'bigint') then event.entity_id::bigint end
    and founder_event.id::text = event.entity_id
  left join public.meetings meeting on event.entity_type = 'meeting' and event.type = 'meeting.attendance_updated'
    and meeting.id = case when event.entity_id ~ '^-?(0|[1-9][0-9]*)$'
      and pg_input_is_valid(event.entity_id, 'bigint') then event.entity_id::bigint end
    and meeting.id::text = event.entity_id
), summary as (
  select count(*) filter (where p_area = 'count' and seen_at is null) as unread_count,
    count(*) filter (where proven_pending is not true) as unproven,
    min(next_boundary) as next_boundary
  from evidence
)
select coalesce((
  select case when basis.source_revision is null then jsonb_build_object('status', 'unavailable')
    when summary.unproven > 0 then jsonb_build_object('status', 'needs_reconcile', 'source_revision', basis.source_revision)
    else jsonb_build_object('status', 'ready', 'source_revision', basis.source_revision,
      'observed_at', basis.observed_at,
      'valid_until', least(date_trunc('hour', basis.observed_at, 'UTC') + interval '1 hour', summary.next_boundary))
      || case when p_area = 'count' then jsonb_build_object('unread_count', summary.unread_count)
        else jsonb_build_object('rows', (
          select coalesce(jsonb_agg(to_jsonb(page) order by page.created_at desc, page.id desc), '[]'::jsonb)
          from (
            select event.id, event.type, event.actor_profile_id, event.actor_label, event.recipient_profile_id,
              event.entity_type, event.entity_id, event.title, event.body, event.target_path, event.status,
              event.seen_at, event.dismissed_at, event.resolved_at, event.resolution_reason, event.created_at
            from public.notification_events event
            where (event.recipient_profile_id = basis.id
              or event.recipient_profile_id is null and basis.platform_role in ('ceo', 'deputy'))
              and (p_area = 'inbox' or event.status = 'pending' and event.seen_at is null)
            order by event.created_at desc, event.id desc
            limit case when p_area = 'inbox' then p_limit + 1 else p_limit end
          ) page
        ))
      end
    end
  from authority basis cross join summary
), jsonb_build_object('status', 'forbidden'));
$$;
revoke all on function workspace_private.notification_scope_snapshot(uuid, uuid, text, text, timestamptz, text, integer)
  from public, anon, authenticated, service_role;

create or replace function public.notification_count_fast_path(
  p_user_id uuid, p_session_id uuid, p_profile_id text, p_platform_role text,
  p_deadline timestamptz
) returns jsonb language sql stable security definer set search_path = '' as $$
  select workspace_private.notification_scope_snapshot(p_user_id, p_session_id, p_profile_id,
    p_platform_role, p_deadline, 'count', null)
$$;
revoke all on function public.notification_count_fast_path(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.notification_count_fast_path(uuid, uuid, text, text, timestamptz) to service_role;

create function public.notification_content_fast_path(
  p_user_id uuid, p_session_id uuid, p_profile_id text, p_platform_role text,
  p_deadline timestamptz, p_area text, p_limit integer
) returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p_area in ('preview', 'inbox') and p_limit between 1 and 100
    then workspace_private.notification_scope_snapshot(p_user_id, p_session_id, p_profile_id,
      p_platform_role, p_deadline, p_area, p_limit)
    else jsonb_build_object('status', 'unavailable') end
$$;
revoke all on function public.notification_content_fast_path(uuid, uuid, text, text, timestamptz, text, integer)
  from public, anon, authenticated;
grant execute on function public.notification_content_fast_path(uuid, uuid, text, text, timestamptz, text, integer)
  to service_role;
