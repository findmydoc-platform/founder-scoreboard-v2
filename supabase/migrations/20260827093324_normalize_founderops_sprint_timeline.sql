with canonical_sprints(name, start_date, end_date) as (
  values
    ('Sprint 1'::text, date '2026-05-18', date '2026-05-31'),
    ('Sprint 2'::text, date '2026-06-01', date '2026-06-14'),
    ('Sprint 3'::text, date '2026-06-15', date '2026-06-28'),
    ('Sprint 4'::text, date '2026-06-29', date '2026-07-12'),
    ('Sprint 5'::text, date '2026-07-13', date '2026-07-26'),
    ('Sprint 6'::text, date '2026-07-27', date '2026-08-09'),
    ('Sprint 7'::text, date '2026-08-10', date '2026-08-23'),
    ('Sprint 8'::text, date '2026-08-24', date '2026-09-06'),
    ('Sprint 9'::text, date '2026-09-07', date '2026-09-20'),
    ('Sprint 10'::text, date '2026-09-21', date '2026-10-04')
),
founderops_project as (
  select id, review_objection_window_hours
  from public.projects
  where id = 'findmydoc-founder-execution'
)
update public.sprints as sprint
set start_date = canonical.start_date,
    end_date = canonical.end_date,
    status = case
      when sprint.score_locked then 'closed'
      when (clock_timestamp() at time zone 'Europe/Berlin')::date
        between canonical.start_date and canonical.end_date then 'active'
      when canonical.start_date > (clock_timestamp() at time zone 'Europe/Berlin')::date then 'planning'
      else 'review'
    end,
    review_due_at = ((canonical.end_date + time '23:59:59.999') at time zone 'Europe/Berlin')
      + make_interval(hours => project.review_objection_window_hours),
    updated_at = clock_timestamp()
from canonical_sprints as canonical
join founderops_project as project on true
where sprint.project_id = project.id
  and sprint.name = canonical.name;
