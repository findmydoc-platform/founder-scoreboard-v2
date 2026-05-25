alter table sprints add column if not exists review_due_at timestamptz;

create table if not exists task_comments (
  id bigint generated always as identity primary key,
  task_id text not null references tasks(id) on delete cascade,
  profile_id text references profiles(id) on delete set null,
  comment text not null,
  created_at timestamptz not null default now()
);

create table if not exists task_blockers (
  id bigint generated always as identity primary key,
  task_id text not null references tasks(id) on delete cascade,
  profile_id text references profiles(id) on delete set null,
  reason text not null,
  impact text,
  needs_help_from text,
  status text not null default 'open' check (status in ('open', 'resolved', 'accepted_carryover')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists notification_events (
  id bigint generated always as identity primary key,
  type text not null,
  actor_profile_id text references profiles(id) on delete set null,
  recipient_profile_id text references profiles(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  title text not null,
  body text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'dismissed')),
  created_at timestamptz not null default now()
);

create table if not exists notification_deliveries (
  id bigint generated always as identity primary key,
  event_id bigint not null references notification_events(id) on delete cascade,
  channel text not null default 'google_chat' check (channel in ('google_chat', 'in_app', 'github')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists task_comments_task_id_idx on task_comments(task_id);
create index if not exists task_blockers_task_id_idx on task_blockers(task_id);
create index if not exists task_blockers_status_idx on task_blockers(status);
create index if not exists notification_events_recipient_status_idx on notification_events(recipient_profile_id, status);
create index if not exists notification_events_entity_idx on notification_events(entity_type, entity_id);
create index if not exists notification_deliveries_event_id_idx on notification_deliveries(event_id);

grant select, insert, update, delete on task_comments, task_blockers, notification_events, notification_deliveries
to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

alter table task_comments enable row level security;
alter table task_blockers enable row level security;
alter table notification_events enable row level security;
alter table notification_deliveries enable row level security;

drop policy if exists "task_comments_select_team" on task_comments;
create policy "task_comments_select_team" on task_comments for select to authenticated using (auth.uid() is not null);

drop policy if exists "task_comments_insert_team" on task_comments;
create policy "task_comments_insert_team" on task_comments for insert to authenticated
with check (public.current_platform_role() in ('ceo', 'founder', 'deputy'));

drop policy if exists "task_blockers_select_team" on task_blockers;
create policy "task_blockers_select_team" on task_blockers for select to authenticated using (auth.uid() is not null);

drop policy if exists "task_blockers_write_team" on task_blockers;
create policy "task_blockers_write_team" on task_blockers for all to authenticated
using (public.current_platform_role() in ('ceo', 'founder', 'deputy'))
with check (public.current_platform_role() in ('ceo', 'founder', 'deputy'));

drop policy if exists "notification_events_select_team" on notification_events;
create policy "notification_events_select_team" on notification_events for select to authenticated
using (
  auth.uid() is not null
  and (
    public.current_platform_role() in ('ceo', 'deputy')
    or recipient_profile_id in (select id from profiles where auth_user_id = auth.uid())
  )
);

drop policy if exists "notification_events_insert_team" on notification_events;
create policy "notification_events_insert_team" on notification_events for insert to authenticated
with check (public.current_platform_role() in ('ceo', 'founder', 'deputy'));

drop policy if exists "notification_events_update_recipient" on notification_events;
create policy "notification_events_update_recipient" on notification_events for update to authenticated
using (
  public.current_platform_role() in ('ceo', 'deputy')
  or recipient_profile_id in (select id from profiles where auth_user_id = auth.uid())
)
with check (
  public.current_platform_role() in ('ceo', 'deputy')
  or recipient_profile_id in (select id from profiles where auth_user_id = auth.uid())
);

drop policy if exists "notification_deliveries_select_operational" on notification_deliveries;
create policy "notification_deliveries_select_operational" on notification_deliveries for select to authenticated
using (public.current_platform_role() in ('ceo', 'deputy'));

drop policy if exists "notification_deliveries_write_operational" on notification_deliveries;
create policy "notification_deliveries_write_operational" on notification_deliveries for all to authenticated
using (public.current_platform_role() in ('ceo', 'deputy'))
with check (public.current_platform_role() in ('ceo', 'deputy'));

update sprints
set review_due_at = (end_date::timestamp - interval '2 days')
where review_due_at is null and end_date is not null;
