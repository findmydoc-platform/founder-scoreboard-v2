create table if not exists profiles (
  id text primary key,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  role text not null check (role in ('admin', 'member', 'viewer')),
  focus text,
  weekly_capacity integer not null default 6,
  profile_color text not null default '#64748b' check (profile_color ~ '^#[0-9A-Fa-f]{6}$')
);

create table if not exists projects (
  id text primary key,
  name text not null,
  range_label text
);

create table if not exists packages (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  title text not null,
  goal text,
  priority text,
  sort_order integer not null default 0
);

create table if not exists tasks (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  package_id text references packages(id) on delete set null,
  title text not null,
  description text,
  status text not null,
  priority text not null,
  owner text references profiles(id) on delete set null,
  assignee text references profiles(id) on delete set null,
  workstream text,
  sort_order integer not null default 0,
  start_date date,
  end_date date,
  deadline text,
  estimate_hours integer,
  definition_of_done text,
  evidence_link text,
  issue_number text,
  issue_url text,
  watched boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists task_dependencies (
  id bigint generated always as identity primary key,
  task_id text not null references tasks(id) on delete cascade,
  note text not null
);

create table if not exists task_links (
  id bigint generated always as identity primary key,
  task_id text not null references tasks(id) on delete cascade,
  type text not null,
  label text not null,
  url text not null
);

create table if not exists task_notes (
  task_id text primary key references tasks(id) on delete cascade,
  note text not null,
  updated_at timestamptz not null default now()
);

create table if not exists task_activity (
  id bigint generated always as identity primary key,
  task_id text not null references tasks(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists profiles_auth_user_id_idx on profiles(auth_user_id);
create index if not exists packages_project_id_idx on packages(project_id);
create index if not exists tasks_project_id_idx on tasks(project_id);
create index if not exists tasks_package_id_idx on tasks(package_id);
create index if not exists tasks_status_idx on tasks(status);
create index if not exists tasks_owner_idx on tasks(owner);
create index if not exists task_dependencies_task_id_idx on task_dependencies(task_id);
create index if not exists task_links_task_id_idx on task_links(task_id);
create index if not exists task_activity_task_id_idx on task_activity(task_id);

grant usage on schema public to anon, authenticated, service_role;
grant select on profiles, projects, packages, tasks, task_dependencies, task_links, task_notes, task_activity to authenticated, service_role;
grant insert, update, delete on profiles, projects, packages, tasks, task_dependencies, task_links, task_notes, task_activity to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

create or replace function public.current_profile_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where auth_user_id = auth.uid()
$$;

alter table profiles enable row level security;
alter table projects enable row level security;
alter table packages enable row level security;
alter table tasks enable row level security;
alter table task_dependencies enable row level security;
alter table task_links enable row level security;
alter table task_notes enable row level security;
alter table task_activity enable row level security;

drop policy if exists "profiles_select_team" on profiles;
create policy "profiles_select_team" on profiles for select to authenticated using (auth.uid() is not null);

drop policy if exists "profiles_update_self_or_admin" on profiles;
create policy "profiles_update_self_or_admin" on profiles for update to authenticated
using (auth_user_id = auth.uid() or public.current_profile_role() = 'admin')
with check (auth_user_id = auth.uid() or public.current_profile_role() = 'admin');

drop policy if exists "projects_select_team" on projects;
create policy "projects_select_team" on projects for select to authenticated using (auth.uid() is not null);

drop policy if exists "projects_write_admin" on projects;
create policy "projects_write_admin" on projects for all to authenticated
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

drop policy if exists "packages_select_team" on packages;
create policy "packages_select_team" on packages for select to authenticated using (auth.uid() is not null);

drop policy if exists "packages_write_members" on packages;
create policy "packages_write_members" on packages for all to authenticated
using (public.current_profile_role() in ('admin', 'member'))
with check (public.current_profile_role() in ('admin', 'member'));

drop policy if exists "tasks_select_team" on tasks;
create policy "tasks_select_team" on tasks for select to authenticated using (auth.uid() is not null);

drop policy if exists "tasks_write_members" on tasks;
create policy "tasks_write_members" on tasks for all to authenticated
using (public.current_profile_role() in ('admin', 'member'))
with check (public.current_profile_role() in ('admin', 'member'));

drop policy if exists "task_dependencies_select_team" on task_dependencies;
create policy "task_dependencies_select_team" on task_dependencies for select to authenticated using (auth.uid() is not null);

drop policy if exists "task_dependencies_write_members" on task_dependencies;
create policy "task_dependencies_write_members" on task_dependencies for all to authenticated
using (public.current_profile_role() in ('admin', 'member'))
with check (public.current_profile_role() in ('admin', 'member'));

drop policy if exists "task_links_select_team" on task_links;
create policy "task_links_select_team" on task_links for select to authenticated using (auth.uid() is not null);

drop policy if exists "task_links_write_members" on task_links;
create policy "task_links_write_members" on task_links for all to authenticated
using (public.current_profile_role() in ('admin', 'member'))
with check (public.current_profile_role() in ('admin', 'member'));

drop policy if exists "task_notes_select_team" on task_notes;
create policy "task_notes_select_team" on task_notes for select to authenticated using (auth.uid() is not null);

drop policy if exists "task_notes_write_members" on task_notes;
create policy "task_notes_write_members" on task_notes for all to authenticated
using (public.current_profile_role() in ('admin', 'member'))
with check (public.current_profile_role() in ('admin', 'member'));

drop policy if exists "task_activity_select_team" on task_activity;
create policy "task_activity_select_team" on task_activity for select to authenticated using (auth.uid() is not null);

drop policy if exists "task_activity_insert_members" on task_activity;
create policy "task_activity_insert_members" on task_activity for insert to authenticated
with check (public.current_profile_role() in ('admin', 'member'));
