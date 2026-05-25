alter table tasks add column if not exists created_by text references profiles(id) on delete set null;

update tasks
set created_by = 'volkan'
where created_by is null
  and exists (select 1 from profiles where id = 'volkan');

create index if not exists tasks_created_by_idx on tasks(created_by);
