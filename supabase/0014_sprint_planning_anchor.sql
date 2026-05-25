insert into sprints (id, project_id, name, status, start_date, end_date, review_due_at, score_locked)
values
  ('sprint-1', 'findmydoc-founder-execution', 'Sprint 1', 'active', '2026-06-01', '2026-06-14', '2026-06-12 12:00:00+00', false),
  ('sprint-2', 'findmydoc-founder-execution', 'Sprint 2', 'planning', '2026-06-15', '2026-06-28', '2026-06-26 12:00:00+00', false),
  ('sprint-3', 'findmydoc-founder-execution', 'Sprint 3', 'planning', '2026-06-29', '2026-07-12', '2026-07-10 12:00:00+00', false),
  ('sprint-4', 'findmydoc-founder-execution', 'Sprint 4', 'planning', '2026-07-13', '2026-07-26', '2026-07-24 12:00:00+00', false)
on conflict (id) do update
set
  name = excluded.name,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  review_due_at = excluded.review_due_at,
  updated_at = now()
where sprints.score_locked = false;

notify pgrst, 'reload schema';
