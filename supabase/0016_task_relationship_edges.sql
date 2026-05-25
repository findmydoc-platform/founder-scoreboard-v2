create table if not exists task_relationship_edges (
  id bigserial primary key,
  task_id text not null references tasks(id) on delete cascade,
  related_task_id text not null references tasks(id) on delete cascade,
  relation_type text not null check (relation_type in ('blocked_by', 'blocks', 'relates_to')),
  note text,
  created_by text references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint task_relationship_edges_no_self_relation check (task_id <> related_task_id),
  constraint task_relationship_edges_unique unique (task_id, related_task_id, relation_type)
);

create index if not exists task_relationship_edges_task_id_idx on task_relationship_edges(task_id);
create index if not exists task_relationship_edges_related_task_id_idx on task_relationship_edges(related_task_id);
create index if not exists task_relationship_edges_relation_type_idx on task_relationship_edges(relation_type);

grant select, insert, update, delete on task_relationship_edges to authenticated, service_role;
grant usage, select on sequence task_relationship_edges_id_seq to authenticated, service_role;

alter table task_relationship_edges enable row level security;

drop policy if exists "task_relationship_edges_select_team" on task_relationship_edges;
create policy "task_relationship_edges_select_team" on task_relationship_edges
for select to authenticated using (auth.uid() is not null);

drop policy if exists "task_relationship_edges_write_founders" on task_relationship_edges;
create policy "task_relationship_edges_write_founders" on task_relationship_edges
for all to authenticated
using (auth.uid() is not null)
with check (auth.uid() is not null);
