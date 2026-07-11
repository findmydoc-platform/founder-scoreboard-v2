alter table public.notification_events
  add column if not exists seen_at timestamptz,
  add column if not exists dismissed_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_reason text;

create or replace function public.current_profile_id()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select profile.id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
     or (
       profile.auth_user_id is null
       and nullif(lower(profile.github_login), '') = nullif(lower(coalesce(
         auth.jwt() -> 'user_metadata' ->> 'user_name',
         auth.jwt() -> 'user_metadata' ->> 'preferred_username'
       )), '')
     )
  order by (profile.auth_user_id = auth.uid()) desc
  limit 1
$$;

create or replace function public.current_platform_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select profile.platform_role
  from public.profiles as profile
  where profile.id = public.current_profile_id()
$$;

revoke all on function public.current_profile_id() from public, anon;
grant execute on function public.current_profile_id() to authenticated, service_role;
revoke all on function public.current_platform_role() from public, anon;
grant execute on function public.current_platform_role() to authenticated, service_role;


create index if not exists notification_events_unseen_recipient_created_idx
  on public.notification_events (recipient_profile_id, created_at desc)
  where status = 'pending' and seen_at is null;

drop policy if exists "notification_events_select_team" on public.notification_events;
create policy "notification_events_select_team"
on public.notification_events for select to authenticated
using (
  auth.uid() is not null
  and (
    recipient_profile_id = public.current_profile_id()
    or (
      recipient_profile_id is null
      and public.current_platform_role() in ('ceo', 'deputy')
    )
  )
);

drop policy if exists "notification_events_update_recipient" on public.notification_events;
create policy "notification_events_update_recipient"
on public.notification_events for update to authenticated
using (
  recipient_profile_id = public.current_profile_id()
  or (
    recipient_profile_id is null
    and public.current_platform_role() in ('ceo', 'deputy')
  )
)
with check (
  recipient_profile_id = public.current_profile_id()
  or (
    recipient_profile_id is null
    and public.current_platform_role() in ('ceo', 'deputy')
  )
);

create or replace function public.guard_notification_system_resolution()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), 'service_role') = 'service_role' then
    return new;
  end if;

  if (to_jsonb(new) - 'status' - 'seen_at' - 'dismissed_at')
    is distinct from
    (to_jsonb(old) - 'status' - 'seen_at' - 'dismissed_at')
  then
    raise exception using errcode = '42501', message = 'notification system fields are immutable';
  end if;

  if old.status = 'pending'
    and new.status = 'pending'
    and new.seen_at is not null
    and new.dismissed_at is not distinct from old.dismissed_at
  then
    return new;
  end if;

  if old.status = 'pending'
    and new.status = 'dismissed'
    and new.seen_at is not null
    and new.dismissed_at is not null
  then
    return new;
  end if;

  raise exception using errcode = '42501', message = 'notification lifecycle transition is not allowed';
end;
$$;

revoke all on function public.guard_notification_system_resolution() from public, anon, authenticated;
grant execute on function public.guard_notification_system_resolution() to service_role;


drop trigger if exists notification_events_guard_system_resolution on public.notification_events;
create trigger notification_events_guard_system_resolution
before update on public.notification_events
for each row execute function public.guard_notification_system_resolution();

comment on column public.notification_events.seen_at
is 'Set when the recipient opens an in-app notification; the notification remains open.';
comment on column public.notification_events.dismissed_at
is 'Set when the recipient explicitly closes an in-app notification.';
comment on column public.notification_events.resolved_at
is 'Set by system reconciliation when the source condition is no longer relevant.';
comment on column public.notification_events.resolution_reason
is 'Stable system reason explaining why reconciliation resolved the notification.';

notify pgrst, 'reload schema';
