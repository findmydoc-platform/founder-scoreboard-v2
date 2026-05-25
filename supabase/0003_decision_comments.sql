create table if not exists decision_comments (
  id bigint generated always as identity primary key,
  decision_id bigint not null references decision_log(id) on delete cascade,
  profile_id text references profiles(id) on delete set null,
  type text not null default 'comment' check (type in ('comment', 'objection')),
  comment text not null,
  created_at timestamptz not null default now()
);

create index if not exists decision_comments_decision_id_idx on decision_comments(decision_id);

grant select, insert on decision_comments to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

alter table decision_comments enable row level security;

drop policy if exists "decision_comments_select_team" on decision_comments;
create policy "decision_comments_select_team" on decision_comments for select to authenticated using (auth.uid() is not null);

drop policy if exists "decision_comments_insert_team" on decision_comments;
create policy "decision_comments_insert_team" on decision_comments for insert to authenticated
with check (public.current_platform_role() in ('ceo', 'founder', 'deputy'));
