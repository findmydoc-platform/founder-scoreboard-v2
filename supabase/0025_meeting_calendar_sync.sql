alter table meetings add column if not exists duration_minutes integer not null default 60
  check (duration_minutes in (30, 45, 60, 90));
alter table meetings add column if not exists google_calendar_id text;
alter table meetings add column if not exists google_calendar_event_id text;
alter table meetings add column if not exists google_calendar_html_link text;
alter table meetings add column if not exists google_calendar_sync_status text not null default 'not_synced'
  check (google_calendar_sync_status in ('not_synced', 'synced', 'skipped', 'failed'));
alter table meetings add column if not exists google_calendar_sync_error text not null default '';
alter table meetings add column if not exists google_calendar_synced_at timestamptz;

create index if not exists meetings_google_calendar_event_idx
  on meetings(google_calendar_id, google_calendar_event_id)
  where google_calendar_event_id is not null;

drop policy if exists "meetings_write_operational" on meetings;
drop policy if exists "meetings_write_team" on meetings;
create policy "meetings_write_team" on meetings for all to authenticated
using (public.current_platform_role() in ('ceo', 'deputy', 'founder'))
with check (public.current_platform_role() in ('ceo', 'deputy', 'founder'));

comment on column meetings.duration_minutes is 'Meeting duration used by the Meeting Finder and Google Calendar export.';
comment on column meetings.google_calendar_id is 'Organizer calendar email where the event was created.';
comment on column meetings.google_calendar_event_id is 'Google Calendar event id for the synced app meeting.';
comment on column meetings.google_calendar_sync_status is 'Last Google Calendar write attempt for this app-owned meeting.';
