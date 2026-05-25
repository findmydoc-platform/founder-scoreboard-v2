create table if not exists meetings (
  id bigint generated always as identity primary key,
  sprint_id text not null references sprints(id) on delete cascade,
  title text not null,
  meeting_at timestamptz not null,
  status text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  agenda text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists meeting_attendance (
  id bigint generated always as identity primary key,
  meeting_id bigint not null references meetings(id) on delete cascade,
  profile_id text not null references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'present', 'excused', 'late_excused', 'unexcused', 'no_show')),
  absence_reason text,
  reason_accepted boolean not null default false,
  written_update text,
  points integer not null default 0 check (points between 0 and 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, profile_id)
);

create index if not exists meetings_sprint_id_idx on meetings(sprint_id);
create index if not exists meeting_attendance_meeting_idx on meeting_attendance(meeting_id);
create index if not exists meeting_attendance_profile_idx on meeting_attendance(profile_id);

grant select, insert, update, delete on meetings, meeting_attendance to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

alter table meetings enable row level security;
alter table meeting_attendance enable row level security;

drop policy if exists "meetings_select_team" on meetings;
create policy "meetings_select_team" on meetings for select to authenticated using (auth.uid() is not null);

drop policy if exists "meetings_write_operational" on meetings;
create policy "meetings_write_operational" on meetings for all to authenticated
using (public.current_platform_role() in ('ceo', 'deputy'))
with check (public.current_platform_role() in ('ceo', 'deputy'));

drop policy if exists "meeting_attendance_select_team" on meeting_attendance;
create policy "meeting_attendance_select_team" on meeting_attendance for select to authenticated using (auth.uid() is not null);

drop policy if exists "meeting_attendance_write_team" on meeting_attendance;
create policy "meeting_attendance_write_team" on meeting_attendance for all to authenticated
using (
  public.current_platform_role() in ('ceo', 'deputy')
  or profile_id in (select id from profiles where auth_user_id = auth.uid())
)
with check (
  public.current_platform_role() in ('ceo', 'deputy')
  or profile_id in (select id from profiles where auth_user_id = auth.uid())
);

insert into meetings (sprint_id, title, meeting_at, agenda)
select id, name || ' Biweekly', coalesce(end_date, current_date)::timestamp + interval '18 hours',
  'Sprint-Update, Blocker, Review-Stand, Entscheidungen und nächste Sprintplanung.'
from sprints
where not exists (select 1 from meetings where meetings.sprint_id = sprints.id);
