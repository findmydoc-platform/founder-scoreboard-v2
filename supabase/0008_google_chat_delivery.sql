alter table profiles add column if not exists google_chat_user_id text;
alter table profiles add column if not exists google_chat_dm_space text;
alter table profiles add column if not exists notifications_enabled boolean not null default true;

alter table notification_deliveries add column if not exists target text;
alter table notification_deliveries add column if not exists payload jsonb;

create index if not exists notification_events_status_created_idx on notification_events(status, created_at);
create index if not exists notification_deliveries_status_idx on notification_deliveries(status);

drop table if exists notification_preferences;
create table if not exists notification_preferences (
  id bigint generated always as identity primary key,
  profile_id text not null references profiles(id) on delete cascade,
  channel text not null default 'google_chat' check (channel in ('google_chat', 'in_app', 'github')),
  event_type text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, channel, event_type)
);

grant select, insert, update, delete on notification_preferences to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

alter table notification_preferences enable row level security;

drop policy if exists "notification_preferences_select_team" on notification_preferences;
create policy "notification_preferences_select_team" on notification_preferences for select to authenticated
using (
  public.current_platform_role() in ('ceo', 'deputy')
  or profile_id in (select id from profiles where auth_user_id = auth.uid())
);

drop policy if exists "notification_preferences_write_self_or_operational" on notification_preferences;
create policy "notification_preferences_write_self_or_operational" on notification_preferences for all to authenticated
using (
  public.current_platform_role() in ('ceo', 'deputy')
  or profile_id in (select id from profiles where auth_user_id = auth.uid())
)
with check (
  public.current_platform_role() in ('ceo', 'deputy')
  or profile_id in (select id from profiles where auth_user_id = auth.uid())
);
