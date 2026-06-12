alter table notification_events add column if not exists dedupe_key text;

create unique index if not exists notification_events_dedupe_key_uidx
on notification_events(dedupe_key)
where dedupe_key is not null;
