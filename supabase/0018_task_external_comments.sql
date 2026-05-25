create table if not exists task_external_comments (
  id bigint generated always as identity primary key,
  task_id text not null references tasks(id) on delete cascade,
  source text not null default 'github' check (source in ('github')),
  external_id text not null,
  author_login text not null,
  author_avatar_url text,
  body text not null,
  html_url text,
  created_at timestamptz not null,
  imported_at timestamptz not null default now(),
  unique (source, external_id)
);

create index if not exists task_external_comments_task_id_created_at_idx
  on task_external_comments(task_id, created_at);

grant select, insert, update, delete on task_external_comments to authenticated, service_role;
grant usage, select on sequence task_external_comments_id_seq to authenticated, service_role;

alter table task_external_comments enable row level security;

drop policy if exists "task_external_comments_select_team" on task_external_comments;
create policy "task_external_comments_select_team" on task_external_comments
for select to authenticated using (auth.uid() is not null);

drop policy if exists "task_external_comments_insert_members" on task_external_comments;
create policy "task_external_comments_insert_members" on task_external_comments
for insert to authenticated with check (auth.uid() is not null);

drop policy if exists "task_external_comments_update_members" on task_external_comments;
create policy "task_external_comments_update_members" on task_external_comments
for update to authenticated using (auth.uid() is not null)
with check (auth.uid() is not null);
