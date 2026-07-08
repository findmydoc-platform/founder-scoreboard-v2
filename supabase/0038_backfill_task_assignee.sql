update tasks
set assignee = owner
where assignee is null
  and owner is not null;

create index if not exists tasks_assignee_idx on tasks(assignee);

comment on column tasks.owner is 'Deprecated legacy mirror of tasks.assignee. Kept for staged fallback/backfill only.';
