create table if not exists feedback_items (
  id bigint generated always as identity primary key,
  type text not null check (type in ('bug', 'feature')),
  status text not null default 'open' check (status in ('open', 'triaged', 'planned', 'done', 'dismissed')),
  severity text not null default 'P2' check (severity in ('P0', 'P1', 'P2', 'P3')),
  profile_id text references profiles(id) on delete set null,
  title text not null,
  description text not null,
  page_url text,
  created_at timestamptz not null default now()
);

create index if not exists feedback_items_status_created_idx on feedback_items(status, created_at desc);
create index if not exists feedback_items_profile_created_idx on feedback_items(profile_id, created_at desc);

grant select, insert, update on feedback_items to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

alter table feedback_items enable row level security;

drop policy if exists "feedback_items_select_team" on feedback_items;
create policy "feedback_items_select_team" on feedback_items for select to authenticated
using (auth.uid() is not null);

drop policy if exists "feedback_items_insert_team" on feedback_items;
create policy "feedback_items_insert_team" on feedback_items for insert to authenticated
with check (public.current_platform_role() in ('ceo', 'founder', 'deputy'));

drop policy if exists "feedback_items_update_operational" on feedback_items;
create policy "feedback_items_update_operational" on feedback_items for update to authenticated
using (public.current_platform_role() in ('ceo', 'deputy'))
with check (public.current_platform_role() in ('ceo', 'deputy'));
