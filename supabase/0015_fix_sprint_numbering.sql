with planned as (
  select *
  from (values
    ('sprint-1', 'Sprint 2', '2026-06-01'::date, '2026-06-14'::date, '2026-06-12 12:00:00+00'::timestamptz),
    ('sprint-2', 'Sprint 3', '2026-06-15'::date, '2026-06-28'::date, '2026-06-26 12:00:00+00'::timestamptz),
    ('sprint-3', 'Sprint 4', '2026-06-29'::date, '2026-07-12'::date, '2026-07-10 12:00:00+00'::timestamptz),
    ('sprint-4', 'Sprint 5', '2026-07-13'::date, '2026-07-26'::date, '2026-07-24 12:00:00+00'::timestamptz),
    ('sprint-5', 'Sprint 6', '2026-07-27'::date, '2026-08-09'::date, '2026-08-07 12:00:00+00'::timestamptz),
    ('sprint-6', 'Sprint 7', '2026-08-10'::date, '2026-08-23'::date, '2026-08-21 12:00:00+00'::timestamptz),
    ('sprint-7', 'Sprint 8', '2026-08-24'::date, '2026-09-06'::date, '2026-09-04 12:00:00+00'::timestamptz),
    ('sprint-8', 'Sprint 9', '2026-09-07'::date, '2026-09-20'::date, '2026-09-18 12:00:00+00'::timestamptz)
  ) as values(id, name, start_date, end_date, review_due_at)
)
insert into sprints (id, project_id, name, status, start_date, end_date, review_due_at, score_locked)
select
  planned.id,
  'findmydoc-founder-execution',
  planned.name,
  case when planned.id = 'sprint-1' then 'active' else 'planning' end,
  planned.start_date,
  planned.end_date,
  planned.review_due_at,
  false
from planned
on conflict (id) do update
set
  name = excluded.name,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  review_due_at = excluded.review_due_at,
  updated_at = now()
where sprints.score_locked = false;

delete from sprints
where name ~ '^Sprint 2 [0-9]+$'
  and id not in ('sprint-1','sprint-2','sprint-3','sprint-4','sprint-5','sprint-6','sprint-7','sprint-8')
  and score_locked = false;

notify pgrst, 'reload schema';
