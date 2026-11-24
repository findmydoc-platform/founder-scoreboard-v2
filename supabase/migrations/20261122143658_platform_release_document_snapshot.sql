create function public.platform_release_document_snapshot(
  p_version text,
  p_user_id uuid,
  p_profile_id text,
  p_platform_role text
) returns jsonb
language sql stable security invoker set search_path = ''
as $$
with actor as materialized (
  select profile.id
  from public.profiles profile
  where profile.auth_user_id = p_user_id
    and profile.id = p_profile_id
    and profile.platform_role = p_platform_role
    and profile.platform_role in ('ceo', 'deputy', 'founder', 'viewer')
), selected_release as materialized (
  select release.version, release.summary, release.published_at, release.manifest_digest, release.manifest
  from public.platform_releases release
  where release.version = p_version and exists (select 1 from actor)
), notifications as materialized (
  select event.id, event.entity_id, event.seen_at
  from public.notification_events event
  join actor on actor.id = event.recipient_profile_id
  join selected_release release on release.version = event.entity_id
  where event.entity_type = 'platform_release'
  limit 2
)
select case
  when not exists (select 1 from actor) then jsonb_build_object('status', 'forbidden')
  when (select count(*) from notifications) > 1 then jsonb_build_object('status', 'legacy-required')
  else jsonb_build_object(
    'status', 'ready',
    'release', (select to_jsonb(release) from selected_release release),
    'notification', (select to_jsonb(notification) from notifications notification limit 1)
  )
end;
$$;

revoke all on function public.platform_release_document_snapshot(text, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.platform_release_document_snapshot(text, uuid, text, text)
to service_role;
