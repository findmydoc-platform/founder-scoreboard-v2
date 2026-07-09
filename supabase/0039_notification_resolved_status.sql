alter table notification_events
  drop constraint if exists notification_events_status_check;

alter table notification_events
  add constraint notification_events_status_check
  check (status in ('pending', 'sent', 'failed', 'dismissed', 'resolved'));
