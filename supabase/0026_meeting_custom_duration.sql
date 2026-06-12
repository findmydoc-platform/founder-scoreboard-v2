do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'meetings_duration_minutes_check'
      and conrelid = 'meetings'::regclass
  ) then
    alter table meetings drop constraint meetings_duration_minutes_check;
  end if;
end $$;

alter table meetings add constraint meetings_duration_minutes_check
  check (duration_minutes between 15 and 480);

comment on column meetings.duration_minutes is 'Meeting duration in minutes, 15 to 480, used by the Meeting Finder and Google Calendar export.';
