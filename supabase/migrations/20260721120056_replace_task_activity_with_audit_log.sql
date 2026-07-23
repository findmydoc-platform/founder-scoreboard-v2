create or replace function public.task_audit_action_from_legacy_message(p_message text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when trim(coalesce(p_message, '')) like 'Titel geändert:%' then 'task.title_changed'
    when trim(coalesce(p_message, '')) like 'Status geändert:%' then 'task.status_changed'
    when trim(coalesce(p_message, '')) like 'Review geändert:%' then 'task.review_status_changed'
    when trim(coalesce(p_message, '')) like 'Review Owner geändert:%' then 'task.review_owner_changed'
    when trim(coalesce(p_message, '')) like 'Zuständigkeit geändert:%'
      or trim(coalesce(p_message, '')) like 'Assignee geändert:%'
      or trim(coalesce(p_message, '')) like 'Owner geändert:%'
      then 'task.assignment_changed'
    when trim(coalesce(p_message, '')) like 'Priorität geändert:%' then 'task.priority_changed'
    when trim(coalesce(p_message, '')) like 'Sprint-Zuordnung geändert:%' then 'task.sprint_changed'
    when trim(coalesce(p_message, '')) like 'Epic / Meilenstein geändert:%'
      or trim(coalesce(p_message, '')) like 'Initiative geändert:%'
      then 'task.structure_changed'
    when trim(coalesce(p_message, '')) like 'Zeitraum geändert:%' then 'task.schedule_changed'
    when trim(coalesce(p_message, '')) like 'Evidence-Link geändert%' then 'task.evidence_changed'
    when trim(coalesce(p_message, '')) like 'Anhang hochgeladen:%' then 'task.attachment_uploaded'
    when trim(coalesce(p_message, '')) like 'GitHub-Sync fehlgeschlagen:%' then 'task.github_sync_failed'
    when trim(coalesce(p_message, '')) like 'GitHub-Sync ausgeführt:%' then 'task.github_sync_succeeded'
    else null
  end;
$$;

comment on function public.task_audit_action_from_legacy_message(text)
is 'Maps the remaining legacy task activity writes to typed task audit actions during the compatibility period.';

insert into public.audit_log (
  entity_type,
  entity_id,
  action,
  actor_profile_id,
  after_data,
  created_at
)
select
  'task',
  activity.task_id,
  public.task_audit_action_from_legacy_message(activity.message),
  null,
  jsonb_build_object(
    'message', activity.message,
    'source', 'legacy_task_activity'
  ),
  activity.created_at
from public.task_activity activity
where public.task_audit_action_from_legacy_message(activity.message) is not null;

drop table public.task_activity;

create view public.task_activity
with (security_invoker = true)
as
select
  audit.id,
  audit.entity_id as task_id,
  coalesce(audit.after_data->>'message', audit.action) as message,
  audit.created_at
from public.audit_log audit
where audit.entity_type = 'task';

comment on view public.task_activity
is 'Temporary write compatibility view. Task timeline reads use structured audit_log rows directly.';

create view public.task_audit_timeline
with (security_invoker = true)
as
select
  audit.id,
  audit.entity_id as task_id,
  audit.action,
  audit.actor_profile_id,
  coalesce(audit.after_data->>'message', '') as message,
  jsonb_strip_nulls(jsonb_build_object(
    'filename', audit.after_data->'filename',
    'note', audit.after_data->'note',
    'relationType', coalesce(audit.after_data->'relationType', audit.before_data->'relation_type'),
    'relatedTaskId', coalesce(audit.after_data->'relatedTaskId', audit.before_data->'related_task_id')
  )) as payload,
  audit.created_at
from public.audit_log audit
where audit.entity_type = 'task';

comment on view public.task_audit_timeline
is 'Small user-facing task timeline projection that avoids transferring complete audit snapshots.';

create or replace function public.insert_legacy_task_activity_as_audit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_action text := public.task_audit_action_from_legacy_message(new.message);
  v_actor_profile_id text := nullif(current_setting('app.actor_profile_id', true), '');
begin
  if v_action is null then
    return null;
  end if;

  insert into public.audit_log (
    entity_type,
    entity_id,
    action,
    actor_profile_id,
    after_data,
    created_at
  ) values (
    'task',
    new.task_id,
    v_action,
    v_actor_profile_id,
    jsonb_build_object(
      'message', new.message,
      'source', 'task_activity_compatibility'
    ),
    coalesce(new.created_at, now())
  )
  returning id, created_at into new.id, new.created_at;

  return new;
end;
$$;

create trigger task_activity_insert_compatibility
instead of insert on public.task_activity
for each row execute function public.insert_legacy_task_activity_as_audit();

revoke all on public.task_activity from anon, authenticated;
grant select, insert on public.task_activity to service_role;

revoke all on public.task_audit_timeline from anon, authenticated;
grant select on public.task_audit_timeline to service_role;

revoke all on function public.task_audit_action_from_legacy_message(text) from public;
grant execute on function public.task_audit_action_from_legacy_message(text) to service_role;

revoke all on function public.insert_legacy_task_activity_as_audit() from public;
