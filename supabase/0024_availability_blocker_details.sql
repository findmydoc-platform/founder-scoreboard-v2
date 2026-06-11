alter table availability add column if not exists title text not null default '';
alter table availability add column if not exists blocker_kind text not null default 'on_business';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'availability_blocker_kind_check'
      and conrelid = 'availability'::regclass
  ) then
    alter table availability add constraint availability_blocker_kind_check
      check (blocker_kind in (
        'working_hours',
        'on_business',
        'customer_appointment',
        'internal_meeting',
        'focus_time',
        'admin',
        'travel',
        'private_appointment',
        'vacation',
        'sick',
        'care',
        'calendar_event',
        'other'
      ));
  end if;
end $$;

update availability
set blocker_kind = case
  when type = 'working_hours' then 'working_hours'
  when type = 'vacation' then 'vacation'
  when type = 'sick' then 'sick'
  when source = 'google_calendar' then 'calendar_event'
  else blocker_kind
end
where blocker_kind = 'on_business';

update availability
set title = case
  when type = 'working_hours' then 'Reguläre FindMyDoc-Arbeitszeit'
  when source = 'google_calendar' then coalesce(nullif(regexp_replace(coalesce(note, ''), '^Google Kalender: ', ''), ''), 'Google Kalender')
  when coalesce(note, '') <> '' then note
  when type = 'vacation' then 'Urlaub'
  when type = 'sick' then 'Krank'
  else 'Blocker'
end
where coalesce(title, '') = '';

comment on column availability.title is 'Short user-facing title for manual availability blockers and imported calendar blocks.';
comment on column availability.blocker_kind is 'Detailed blocker reason used by the Meeting Finder UI; type remains the broad availability category.';
