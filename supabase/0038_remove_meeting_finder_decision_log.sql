update profile_ui_preferences
set default_workspace = case
  when default_workspace = 'meetings' then 'sprint'
  when default_workspace = 'decisions' then 'planning'
  else default_workspace
end,
updated_at = now()
where default_workspace in ('meetings', 'decisions');

alter table profile_ui_preferences
  drop constraint if exists profile_ui_preferences_default_workspace_check;

alter table profile_ui_preferences
  add constraint profile_ui_preferences_default_workspace_check
  check (default_workspace in ('planning', 'execution', 'mine', 'reviews', 'events', 'sprint', 'projects', 'tools', 'team', 'settings', 'ceo-intake', 'profile'));

delete from notification_preferences
where event_type = 'decision.confirmation_requested';

delete from notification_deliveries
where event_id in (
  select id from notification_events
  where type = 'decision.confirmation_requested'
     or entity_type = 'decision'
);

delete from notification_events
where type = 'decision.confirmation_requested'
   or entity_type = 'decision';

delete from audit_log
where entity_type = 'decision'
   or action like 'decision.%';

drop table if exists decision_task_links cascade;
drop table if exists decision_comments cascade;
drop table if exists decision_confirmations cascade;
drop table if exists decision_log cascade;

delete from audit_log
where entity_type = 'availability'
   or action like 'availability.%';

drop table if exists availability cascade;

drop index if exists profiles_google_calendar_sync_idx;

alter table profiles
  drop column if exists google_calendar_email,
  drop column if exists google_calendar_sync_enabled,
  drop column if exists google_calendar_last_synced_at;

drop index if exists meetings_google_calendar_event_idx;

alter table meetings
  drop column if exists google_calendar_id,
  drop column if exists google_calendar_event_id,
  drop column if exists google_calendar_html_link,
  drop column if exists google_calendar_sync_status,
  drop column if exists google_calendar_sync_error,
  drop column if exists google_calendar_synced_at;

insert into meetings (sprint_id, title, meeting_at, duration_minutes, status, agenda)
select s.id, s.name || ' Weekly 1', coalesce(s.start_date, current_date)::timestamp + interval '6 days 18 hours', 60, 'planned',
  'Weekly Update, Blocker, Review-Stand und nächste Schritte.'
from sprints s
where not exists (
  select 1 from meetings m
  where m.sprint_id = s.id and lower(m.title) like '%weekly 1%'
);

insert into meetings (sprint_id, title, meeting_at, duration_minutes, status, agenda)
select s.id, s.name || ' Weekly 2', coalesce(s.end_date, current_date)::timestamp + interval '18 hours', 60, 'planned',
  'Weekly Update, Blocker, Review-Stand und nächste Schritte.'
from sprints s
where not exists (
  select 1 from meetings m
  where m.sprint_id = s.id and lower(m.title) like '%weekly 2%'
);

notify pgrst, 'reload schema';
