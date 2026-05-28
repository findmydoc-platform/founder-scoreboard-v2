alter table profiles add column if not exists google_calendar_email text;
alter table profiles add column if not exists google_calendar_sync_enabled boolean not null default false;
alter table profiles add column if not exists google_calendar_last_synced_at timestamptz;

create index if not exists profiles_google_calendar_sync_idx
  on profiles(google_calendar_sync_enabled, google_calendar_email)
  where google_calendar_sync_enabled = true and google_calendar_email is not null;

comment on column profiles.google_calendar_email is 'Google Workspace calendar email used by the Meeting Finder import.';
comment on column profiles.google_calendar_sync_enabled is 'Controls whether this profile is included in the Google Calendar busy-block import.';
comment on column profiles.google_calendar_last_synced_at is 'Last successful Meeting Finder calendar import timestamp for this profile.';
