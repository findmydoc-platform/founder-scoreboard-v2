alter table availability add column if not exists source text not null default 'manual'
  check (source in ('manual', 'google_calendar'));
alter table availability add column if not exists external_id text;
alter table availability add column if not exists external_calendar_id text;
alter table availability add column if not exists synced_at timestamptz;

create index if not exists availability_source_idx on availability(source);
create unique index if not exists availability_google_external_idx
  on availability(external_calendar_id, external_id)
  where source = 'google_calendar' and external_calendar_id is not null and external_id is not null;

comment on column availability.source is 'Manual entries are app-owned; google_calendar entries are imported busy blocks from Google Workspace.';
comment on column availability.external_id is 'Provider event id for imported calendar blocks.';
comment on column availability.external_calendar_id is 'Provider calendar id for imported calendar blocks.';
comment on column availability.synced_at is 'Timestamp of the last successful external calendar import.';
