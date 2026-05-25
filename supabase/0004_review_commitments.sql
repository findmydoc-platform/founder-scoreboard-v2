alter table task_reviews add column if not exists checklist jsonb not null default '{}'::jsonb;

create table if not exists sprint_commitments (
  id bigint generated always as identity primary key,
  sprint_id text not null references sprints(id) on delete cascade,
  profile_id text not null references profiles(id) on delete cascade,
  commitment_level text not null default 'Standard'
    check (commitment_level in ('Lite', 'Standard', 'Heavy', 'Away')),
  weekly_hours integer not null default 0 check (weekly_hours >= 0 and weekly_hours <= 80),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sprint_id, profile_id)
);

create index if not exists sprint_commitments_sprint_idx on sprint_commitments(sprint_id);
create index if not exists sprint_commitments_profile_idx on sprint_commitments(profile_id);

grant select, insert, update, delete on sprint_commitments to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

alter table sprint_commitments enable row level security;

drop policy if exists "sprint_commitments_select_team" on sprint_commitments;
create policy "sprint_commitments_select_team" on sprint_commitments for select to authenticated
using (auth.uid() is not null);

drop policy if exists "sprint_commitments_write_team" on sprint_commitments;
create policy "sprint_commitments_write_team" on sprint_commitments for all to authenticated
using (public.current_platform_role() in ('ceo', 'founder', 'deputy'))
with check (public.current_platform_role() in ('ceo', 'founder', 'deputy'));
