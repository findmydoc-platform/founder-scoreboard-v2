alter table profiles add column if not exists github_login text unique;
alter table profiles add column if not exists platform_role text not null default 'founder'
  check (platform_role in ('ceo', 'founder', 'deputy', 'viewer'));
alter table profiles add column if not exists org_role text;
alter table profiles add column if not exists deputy_for text references profiles(id) on delete set null;
alter table profiles add column if not exists deputy_active_from timestamptz;
alter table profiles add column if not exists deputy_active_until timestamptz;

alter table tasks add column if not exists sprint_id text;
alter table tasks add column if not exists review_status text not null default 'not_requested'
  check (review_status in ('not_requested', 'requested', 'accepted', 'partial', 'changes_requested'));
alter table tasks add column if not exists score_points integer not null default 0;
alter table tasks add column if not exists score_final boolean not null default false;
alter table tasks add column if not exists github_repo text;
alter table tasks add column if not exists github_issue_number integer;
alter table tasks add column if not exists github_issue_url text;
alter table tasks add column if not exists github_sync_status text not null default 'not_synced'
  check (github_sync_status in ('not_synced', 'synced', 'pending', 'failed'));
alter table tasks add column if not exists github_last_synced_at timestamptz;
alter table tasks add column if not exists github_sync_error text;

create table if not exists sprints (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  status text not null default 'planning' check (status in ('planning', 'active', 'review', 'closed')),
  start_date date,
  end_date date,
  score_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists task_reviews (
  id bigint generated always as identity primary key,
  task_id text not null references tasks(id) on delete cascade,
  sprint_id text references sprints(id) on delete set null,
  reviewer_profile_id text references profiles(id) on delete set null,
  decision text not null check (decision in ('accepted', 'partial', 'changes_requested')),
  points integer not null default 0,
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists decision_log (
  id bigint generated always as identity primary key,
  title text not null,
  context text,
  decision text,
  status text not null default 'draft' check (status in ('draft', 'open_for_confirmation', 'locked')),
  required_profile_ids text[] not null default '{}',
  created_by text references profiles(id) on delete set null,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists decision_confirmations (
  id bigint generated always as identity primary key,
  decision_id bigint not null references decision_log(id) on delete cascade,
  profile_id text not null references profiles(id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  unique (decision_id, profile_id)
);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  actor_profile_id text references profiles(id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  request_ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists availability (
  id bigint generated always as identity primary key,
  profile_id text not null references profiles(id) on delete cascade,
  type text not null default 'busy' check (type in ('working_hours', 'busy', 'vacation', 'sick')),
  weekday integer check (weekday between 0 and 6),
  start_date date,
  end_date date,
  start_time time,
  end_time time,
  note text,
  created_by text references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists profiles_github_login_idx on profiles(github_login);
create index if not exists profiles_platform_role_idx on profiles(platform_role);
create index if not exists tasks_sprint_id_idx on tasks(sprint_id);
create index if not exists tasks_review_status_idx on tasks(review_status);
create index if not exists tasks_github_sync_status_idx on tasks(github_sync_status);
create index if not exists task_reviews_task_id_idx on task_reviews(task_id);
create index if not exists decision_log_status_idx on decision_log(status);
create index if not exists audit_log_entity_idx on audit_log(entity_type, entity_id);
create index if not exists availability_profile_idx on availability(profile_id);

grant select, insert, update, delete on sprints, task_reviews, decision_log, decision_confirmations, audit_log, availability
to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

alter table sprints enable row level security;
alter table task_reviews enable row level security;
alter table decision_log enable row level security;
alter table decision_confirmations enable row level security;
alter table audit_log enable row level security;
alter table availability enable row level security;

create or replace function public.current_platform_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select platform_role from public.profiles where auth_user_id = auth.uid()
$$;

drop policy if exists "sprints_select_team" on sprints;
create policy "sprints_select_team" on sprints for select to authenticated using (auth.uid() is not null);

drop policy if exists "sprints_write_operational" on sprints;
create policy "sprints_write_operational" on sprints for all to authenticated
using (public.current_platform_role() in ('ceo', 'deputy'))
with check (public.current_platform_role() in ('ceo', 'deputy'));

drop policy if exists "task_reviews_select_team" on task_reviews;
create policy "task_reviews_select_team" on task_reviews for select to authenticated using (auth.uid() is not null);

drop policy if exists "task_reviews_write_founders" on task_reviews;
create policy "task_reviews_write_founders" on task_reviews for insert to authenticated
with check (public.current_platform_role() in ('ceo', 'founder', 'deputy'));

drop policy if exists "decision_log_select_team" on decision_log;
create policy "decision_log_select_team" on decision_log for select to authenticated using (auth.uid() is not null);

drop policy if exists "decision_log_write_ceo" on decision_log;
create policy "decision_log_write_ceo" on decision_log for all to authenticated
using (public.current_platform_role() = 'ceo' and status <> 'locked')
with check (public.current_platform_role() = 'ceo');

drop policy if exists "decision_confirmations_select_team" on decision_confirmations;
create policy "decision_confirmations_select_team" on decision_confirmations for select to authenticated using (auth.uid() is not null);

drop policy if exists "decision_confirmations_insert_team" on decision_confirmations;
create policy "decision_confirmations_insert_team" on decision_confirmations for insert to authenticated
with check (public.current_platform_role() in ('ceo', 'founder', 'deputy'));

drop policy if exists "audit_log_select_team" on audit_log;
create policy "audit_log_select_team" on audit_log for select to authenticated using (auth.uid() is not null);

drop policy if exists "audit_log_insert_operational" on audit_log;
create policy "audit_log_insert_operational" on audit_log for insert to authenticated
with check (public.current_platform_role() in ('ceo', 'founder', 'deputy'));

drop policy if exists "availability_select_team" on availability;
create policy "availability_select_team" on availability for select to authenticated using (auth.uid() is not null);

drop policy if exists "availability_write_operational" on availability;
create policy "availability_write_operational" on availability for all to authenticated
using (public.current_platform_role() in ('ceo', 'founder', 'deputy'))
with check (public.current_platform_role() in ('ceo', 'founder', 'deputy'));

insert into sprints (id, project_id, name, status, start_date, end_date)
values ('sprint-1', 'findmydoc-founder-execution', 'Sprint 1', 'active', '2026-05-25', '2026-06-07')
on conflict (id) do update set name = excluded.name, status = excluded.status, start_date = excluded.start_date, end_date = excluded.end_date;

update profiles set platform_role = case when id = 'volkan' then 'ceo' else 'founder' end where platform_role in ('founder', 'ceo');
update profiles set org_role = case when id = 'volkan' then 'CEO' else 'Founder' end where org_role is null;
update tasks set sprint_id = 'sprint-1' where sprint_id is null;
