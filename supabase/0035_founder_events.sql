create table if not exists founder_events (
  id bigserial primary key,
  title text not null,
  category text not null default 'other' check (category in ('conference', 'legal', 'company', 'travel', 'deadline', 'other')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text not null default '',
  description text not null default '',
  audience_mode text not null default 'all' check (audience_mode in ('all', 'selected')),
  participant_profile_ids text[] not null default '{}',
  reminder_days_before integer not null default 7 check (reminder_days_before between 0 and 90),
  reminder_generated_at timestamptz,
  status text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  created_by text references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint founder_events_participant_profile_ids_no_null check (array_position(participant_profile_ids, null) is null),
  constraint founder_events_selected_has_participants check (audience_mode = 'all' or cardinality(participant_profile_ids) > 0),
  constraint founder_events_end_after_start check (ends_at is null or ends_at >= starts_at)
);

create index if not exists founder_events_starts_at_idx on founder_events(starts_at);
create index if not exists founder_events_status_idx on founder_events(status);
create index if not exists founder_events_reminder_generated_at_idx on founder_events(reminder_generated_at);
create index if not exists founder_events_participant_profile_ids_idx on founder_events using gin(participant_profile_ids);

grant select on founder_events to authenticated, service_role;
grant insert, update, delete on founder_events to authenticated, service_role;
grant usage, select on sequence founder_events_id_seq to authenticated, service_role;

alter table founder_events enable row level security;

drop policy if exists "founder_events_select_team" on founder_events;
create policy "founder_events_select_team" on founder_events for select to authenticated using (auth.uid() is not null);

drop policy if exists "founder_events_write_members" on founder_events;
create policy "founder_events_write_members" on founder_events for all to authenticated
using (public.current_profile_role() in ('admin', 'member'))
with check (public.current_profile_role() in ('admin', 'member'));
