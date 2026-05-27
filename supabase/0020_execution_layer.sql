create table if not exists task_focus_items (
  id bigserial primary key,
  profile_id text references profiles(id) on delete cascade,
  task_id text not null references tasks(id) on delete cascade,
  focus_date date not null default current_date,
  position integer not null default 1,
  next_step text not null default '',
  status text not null default 'planned' check (status in ('planned', 'done', 'blocked', 'deferred', 'needs_decision')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, task_id, focus_date)
);

create table if not exists decision_task_links (
  id bigserial primary key,
  decision_id bigint not null references decision_log(id) on delete cascade,
  task_id text not null references tasks(id) on delete cascade,
  link_type text not null default 'follows_from' check (link_type in ('follows_from', 'supports', 'blocks_decision')),
  note text not null default '',
  created_by text references profiles(id),
  created_at timestamptz not null default now(),
  unique (decision_id, task_id)
);

create index if not exists task_focus_items_profile_date_idx on task_focus_items(profile_id, focus_date, position);
create index if not exists task_focus_items_task_idx on task_focus_items(task_id);
create index if not exists decision_task_links_decision_idx on decision_task_links(decision_id);
create index if not exists decision_task_links_task_idx on decision_task_links(task_id);

grant select, insert, update, delete on task_focus_items to authenticated, service_role;
grant select, insert, update, delete on decision_task_links to authenticated, service_role;
grant usage, select on sequence task_focus_items_id_seq to authenticated, service_role;
grant usage, select on sequence decision_task_links_id_seq to authenticated, service_role;

alter table task_focus_items enable row level security;
alter table decision_task_links enable row level security;

drop policy if exists "task_focus_items_select_team" on task_focus_items;
create policy "task_focus_items_select_team" on task_focus_items for select to authenticated using (auth.uid() is not null);

drop policy if exists "task_focus_items_write_team" on task_focus_items;
create policy "task_focus_items_write_team" on task_focus_items for all to authenticated
using (auth.uid() is not null)
with check (auth.uid() is not null);

drop policy if exists "decision_task_links_select_team" on decision_task_links;
create policy "decision_task_links_select_team" on decision_task_links for select to authenticated using (auth.uid() is not null);

drop policy if exists "decision_task_links_write_team" on decision_task_links;
create policy "decision_task_links_write_team" on decision_task_links for all to authenticated
using (auth.uid() is not null)
with check (auth.uid() is not null);
