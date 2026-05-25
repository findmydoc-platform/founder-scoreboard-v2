alter table tasks add column if not exists task_type text not null default 'deliverable'
  check (task_type in ('deliverable', 'proposal', 'sub_issue'));
alter table tasks add column if not exists parent_task_id text references tasks(id) on delete cascade;
alter table tasks add column if not exists score_relevant boolean not null default true;

create index if not exists tasks_task_type_idx on tasks(task_type);
create index if not exists tasks_parent_task_id_idx on tasks(parent_task_id);
create index if not exists tasks_score_relevant_idx on tasks(score_relevant);

update tasks
set task_type = 'deliverable', score_relevant = true
where task_type is null or task_type = 'deliverable';
