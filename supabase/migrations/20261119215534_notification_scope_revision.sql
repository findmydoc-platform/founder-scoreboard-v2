-- Notification membership and lifecycle depend on more than Planning's source
-- clock. A conservative private clock makes same-count changes observable.
create table if not exists workspace_private.notification_scope_revision (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0 check (revision >= 0)
);
alter table workspace_private.notification_scope_revision enable row level security;
revoke all on workspace_private.notification_scope_revision from public, anon, authenticated, service_role;
insert into workspace_private.notification_scope_revision(singleton) values (true) on conflict do nothing;

create function workspace_private.advance_notification_scope_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update workspace_private.notification_scope_revision set revision = revision + 1 where singleton;
  return null;
end;
$$;
revoke all on function workspace_private.advance_notification_scope_revision() from public, anon, authenticated, service_role;

do $$
declare source text;
begin
  foreach source in array array['notification_events', 'notification_deliveries', 'notification_preferences',
    'profile_ui_preferences', 'profiles', 'tasks', 'task_blockers', 'sprints', 'founder_events', 'meetings'] loop
    execute format('create trigger notification_scope_revision after insert or update or delete on public.%I for each statement execute function workspace_private.advance_notification_scope_revision()', source);
  end loop;
end;
$$;

-- Actor and revision are observed together under the original user JWT.
create function public.notification_publication_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare context jsonb;
begin
  select jsonb_build_object('profile_id', profile.id, 'platform_role', profile.platform_role,
    'source_revision', revision.revision::text)
  into context
  from public.profiles profile
  cross join workspace_private.notification_scope_revision revision
  where revision.singleton and profile.auth_user_id = (select auth.uid())
    and profile.platform_role in ('ceo', 'deputy', 'founder', 'viewer')
    and exists (
      select 1 from auth.sessions session where session.user_id = profile.auth_user_id
        and session.id = case when (select auth.jwt()->>'session_id') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
          then (select auth.jwt()->>'session_id')::uuid else null end
        and (session.not_after is null or session.not_after > statement_timestamp())
    );
  if context is null then
    raise insufficient_privilege using message = 'Notification publication access denied';
  end if;
  return context;
end;
$$;
revoke all on function public.notification_publication_context() from public, anon, service_role;
grant execute on function public.notification_publication_context() to authenticated;
