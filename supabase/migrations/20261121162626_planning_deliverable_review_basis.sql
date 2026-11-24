-- Bind one Deliverable decision to a verified snapshot, its own evidence and
-- Sprint support, and the original authenticated authority.
create function public.planning_deliverable_review_basis(
  p_task_id text, p_actor_profile_id text, p_actor_user_id uuid, p_session_id uuid,
  p_platform_role text, p_deadline timestamptz
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor public.profiles;
  target public.tasks;
  sprint public.sprints;
  evaluated_at timestamptz := statement_timestamp();
  sprint_end timestamptz;
  review_due timestamptz;
  window_hours integer;
  valid_until timestamptz;
  revision text;
  evidence_links jsonb;
  has_evidence boolean;
  has_exception boolean;
begin
  select profile.* into actor
  from public.profiles profile
  join auth.sessions session on session.user_id = profile.auth_user_id and session.id = p_session_id
  where profile.id = p_actor_profile_id and profile.auth_user_id = p_actor_user_id
    and profile.platform_role = p_platform_role and profile.platform_role in ('ceo','deputy','founder')
    and (session.not_after is null or session.not_after > evaluated_at) and p_deadline > evaluated_at;
  if not found then return jsonb_build_object('status', 'forbidden'); end if;

  select task.* into target from public.tasks task
  where task.id = p_task_id and task.project_id = 'findmydoc-founder-execution'
    and task.task_type = 'deliverable' and task.trashed_at is null;
  if not found then return jsonb_build_object('status', 'notFound'); end if;
  if actor.platform_role = 'founder' and target.review_owner_profile_id is distinct from actor.id then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if target.sprint_id is not null then
    select review_objection_window_hours into window_hours
    from public.projects where id = target.project_id;
    if not found or window_hours is null then return jsonb_build_object('status', 'unavailable'); end if;
    select * into sprint from public.sprints where id = target.sprint_id and project_id = target.project_id;
    if not found or sprint.score_locked is null or sprint.end_date is null then
      return jsonb_build_object('status', 'unavailable');
    end if;
    sprint_end := (sprint.end_date + time '23:59:59.999') at time zone 'Europe/Berlin';
    review_due := coalesce(sprint.review_due_at, sprint_end + make_interval(hours => window_hours));
  end if;

  valid_until := least(p_deadline,
    case when actor.deputy_active_from > evaluated_at then actor.deputy_active_from end,
    case when actor.deputy_active_until > evaluated_at then actor.deputy_active_until end,
    case when sprint_end > evaluated_at then sprint_end end,
    case when review_due > evaluated_at then review_due end);
  revision := public.planning_source_version();
  -- Match the established evidence predicate and keep each link on its source.
  with evidence_tasks as (
    select target.id as task_id, target.title, target.evidence_link
    union all
    select child.id, child.title, child.evidence_link
    from public.tasks child
    where child.parent_task_id = target.id and child.project_id = target.project_id
      and child.task_type = 'sub_issue' and child.trashed_at is null
  ), links as (
    select task.task_id, task.title, task.evidence_link as url, 'evidence' as kind, null::jsonb as pull_request
    from evidence_tasks task where task.evidence_link ~* '^https?://'
    union
    select task.task_id, task.title, link.url, link.type,
      case when link.type = 'github_pull_request' and link.metadata->>'number' ~ '^[1-9][0-9]{0,14}$' then
        jsonb_strip_nulls(jsonb_build_object('title', link.label, 'repository', link.metadata->>'repository',
          'number', (link.metadata->>'number')::bigint, 'url', link.url, 'status', link.metadata->>'status',
          'mergedAt', case when jsonb_typeof(link.metadata->'mergedAt') = 'string' then nullif(link.metadata->>'mergedAt','') end))
      end
    from evidence_tasks task join public.task_links link on link.task_id = task.task_id
    where link.type in ('evidence','github_pull_request') and link.url ~* '^https?://'
      and (link.type = 'evidence' or (
        nullif(btrim(link.metadata->>'repository'), '') is not null
        and link.metadata->>'number' ~ '^[1-9][0-9]*$'
        and link.metadata->>'status' in ('open','merged','closed')
      ))
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('taskId', links.task_id, 'title', links.title, 'url', links.url, 'kind', links.kind, 'pullRequest', links.pull_request))
    order by (links.task_id <> target.id), links.task_id, links.kind, links.url), '[]'::jsonb)
  into evidence_links from links;
  has_evidence := public.has_valid_planning_review_evidence(target.id);
  has_exception := target.review_evidence_exception_confirmed_at is not null
    and nullif(btrim(target.review_evidence_exception_note), '') is not null;
  if revision is null or has_evidence is distinct from (jsonb_array_length(evidence_links) > 0) then return jsonb_build_object('status', 'unavailable'); end if;

  return jsonb_build_object('status', 'ready', 'taskUpdatedAt', target.updated_at, 'sourceRevision', revision,
    'evaluatedAt', evaluated_at, 'validUntil', valid_until, 'hasEvidence', has_evidence,
    'hasException', has_exception, 'exceptionNote', case when has_exception then target.review_evidence_exception_note end,
    'evidenceLinks', evidence_links, 'sprintId', target.sprint_id, 'sprintLocked', coalesce(sprint.score_locked, false),
    'blockedReason', case
      when target.approval_status is distinct from 'approved' then 'notApproved'
      when target.status is distinct from 'Review' or target.review_status is distinct from 'requested'
        or target.score_final is distinct from false then 'inactive'
      when sprint.score_locked then 'sprintLocked'
      when not has_evidence and not has_exception then 'evidenceRequired'
    end);
end;
$$;

revoke all on function public.planning_deliverable_review_basis(text,text,uuid,uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.planning_deliverable_review_basis(text,text,uuid,uuid,text,timestamptz) to service_role;

-- Revalidate the displayed source in the same transaction as the established
-- decision. Keep the existing task/actor/Sprint lock order, and fail stale
-- without waiting if another source transaction already owns the revision row.
create function public.decide_planning_review_from_basis(
  p_task_id text, p_expected_updated_at timestamptz, p_actor_profile_id text,
  p_actor_user_id uuid, p_session_id uuid, p_platform_role text, p_deadline timestamptz,
  p_source_revision text, p_valid_until timestamptz, p_reviewer_profile_id text, p_decision text,
  p_comment text, p_checklist jsonb, p_points integer, p_activity_messages text[], p_notifications jsonb,
  p_mention_recipient_profile_ids text[], p_audit_after_data jsonb, p_request_ip text, p_user_agent text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target public.tasks;
  snapshot jsonb;
  revision text;
begin
  select * into target from public.tasks where id = p_task_id for update;
  if not found then raise sqlstate 'P0002' using message = 'review target not found'; end if;
  if target.updated_at is distinct from p_expected_updated_at then
    raise sqlstate 'P0001' using message = 'review target revision changed';
  end if;
  perform 1 from public.profiles where id = p_actor_profile_id and auth_user_id = p_actor_user_id
    and platform_role = p_platform_role and platform_role in ('ceo','deputy','founder') for share;
  if not found then raise sqlstate 'P0006' using message = 'review actor changed'; end if;
  perform 1 from auth.sessions where id = p_session_id and user_id = p_actor_user_id
    and (not_after is null or not_after > clock_timestamp()) for share;
  if not found then raise sqlstate 'P0006' using message = 'review session expired'; end if;
  begin
    if target.sprint_id is not null then
      perform 1 from public.sprints where id = target.sprint_id for update nowait;
    end if;
    select source.revision::text into revision
    from workspace_private.planning_source_revision source where singleton for update nowait;
  exception when lock_not_available then
    raise sqlstate 'P0021' using message = 'review basis is changing';
  end;
  if revision is null or p_source_revision is distinct from revision
    or p_valid_until is null or p_valid_until <= clock_timestamp()
    or p_deadline is null or p_deadline <= clock_timestamp() then
    raise sqlstate 'P0021' using message = 'review basis is stale';
  end if;
  snapshot := public.planning_deliverable_review_basis(p_task_id, p_actor_profile_id, p_actor_user_id,
    p_session_id, p_platform_role, p_deadline);
  if snapshot->>'status' = 'forbidden' then raise sqlstate 'P0006' using message = 'review authority changed'; end if;
  if snapshot->>'status' is distinct from 'ready' or snapshot->>'blockedReason' is not null then
    raise sqlstate 'P0021' using message = 'review basis no longer permits a decision';
  end if;

  return public.mutate_planning_review_command_transaction_v3('decide', p_task_id, p_expected_updated_at,
    p_actor_profile_id, p_reviewer_profile_id, p_decision, p_comment, p_checklist, p_points, null,
    '[]'::jsonb, null, p_activity_messages, p_notifications, p_mention_recipient_profile_ids,
    p_audit_after_data, p_request_ip, p_user_agent);
end;
$$;

revoke all on function public.decide_planning_review_from_basis(
  text,timestamptz,text,uuid,uuid,text,timestamptz,text,timestamptz,text,text,text,jsonb,integer,text[],jsonb,text[],jsonb,text,text
) from public, anon, authenticated;
grant execute on function public.decide_planning_review_from_basis(
  text,timestamptz,text,uuid,uuid,text,timestamptz,text,timestamptz,text,text,text,jsonb,integer,text[],jsonb,text[],jsonb,text,text
) to service_role;
