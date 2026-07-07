create table if not exists profile_ui_preferences (
  profile_id text primary key references profiles(id) on delete cascade,
  default_workspace text not null default 'planning'
    check (default_workspace in ('planning', 'execution', 'mine', 'reviews', 'events', 'sprint', 'decisions', 'meetings', 'projects', 'tools', 'team', 'settings', 'ceo-intake', 'profile')),
  default_task_view text not null default 'board'
    check (default_task_view in ('board', 'structure', 'table', 'gantt')),
  planning_filters jsonb not null default '{"query":"","owner":"Alle","status":"Alle","priority":"Alle","packageId":"Alle","quick":""}'::jsonb,
  expanded_package_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profile_feature_tour_acknowledgements (
  profile_id text not null references profiles(id) on delete cascade,
  tour_id text not null,
  seen_at timestamptz not null default now(),
  primary key (profile_id, tour_id)
);

create index if not exists profile_feature_tour_acknowledgements_tour_idx
  on profile_feature_tour_acknowledgements(tour_id, seen_at);

grant select, insert, update, delete on profile_ui_preferences to authenticated, service_role;
grant select, insert, update, delete on profile_feature_tour_acknowledgements to authenticated, service_role;

alter table profile_ui_preferences enable row level security;
alter table profile_feature_tour_acknowledgements enable row level security;

drop policy if exists "profile_ui_preferences_select_self_or_operational" on profile_ui_preferences;
create policy "profile_ui_preferences_select_self_or_operational" on profile_ui_preferences for select to authenticated
using (
  public.current_platform_role() in ('ceo', 'deputy')
  or profile_id in (select id from profiles where auth_user_id = auth.uid())
);

drop policy if exists "profile_ui_preferences_write_self" on profile_ui_preferences;
create policy "profile_ui_preferences_write_self" on profile_ui_preferences for all to authenticated
using (profile_id in (select id from profiles where auth_user_id = auth.uid()))
with check (profile_id in (select id from profiles where auth_user_id = auth.uid()));

drop policy if exists "profile_feature_tour_acknowledgements_select_self_or_operational" on profile_feature_tour_acknowledgements;
create policy "profile_feature_tour_acknowledgements_select_self_or_operational" on profile_feature_tour_acknowledgements for select to authenticated
using (
  public.current_platform_role() in ('ceo', 'deputy')
  or profile_id in (select id from profiles where auth_user_id = auth.uid())
);

drop policy if exists "profile_feature_tour_acknowledgements_write_self" on profile_feature_tour_acknowledgements;
create policy "profile_feature_tour_acknowledgements_write_self" on profile_feature_tour_acknowledgements for all to authenticated
using (profile_id in (select id from profiles where auth_user_id = auth.uid()))
with check (profile_id in (select id from profiles where auth_user_id = auth.uid()));

comment on table profile_ui_preferences is 'Per-profile planning UI defaults. Users write only their own preferences.';
comment on table profile_feature_tour_acknowledgements is 'Per-profile acknowledgements for code-defined feature tours.';
