alter table tasks add column if not exists original_sprint_id text references sprints(id) on delete set null;
alter table tasks add column if not exists carried_from_task_id text references tasks(id) on delete set null;
alter table tasks add column if not exists carried_from_sprint_id text references sprints(id) on delete set null;
alter table tasks add column if not exists carryover_reason text;
alter table tasks add column if not exists carryover_count integer not null default 0;
alter table tasks add column if not exists sprint_outcome text
  check (sprint_outcome is null or sprint_outcome in ('completed', 'partial', 'rework', 'communicated_blocker', 'missed_no_review', 'missed_uncommunicated'));

create index if not exists tasks_original_sprint_idx on tasks(original_sprint_id);
create index if not exists tasks_carried_from_task_idx on tasks(carried_from_task_id);
create index if not exists tasks_carried_from_sprint_idx on tasks(carried_from_sprint_id);

update tasks
set original_sprint_id = sprint_id
where original_sprint_id is null and sprint_id is not null;
