create table if not exists founder_sprint_scores (
  id bigint generated always as identity primary key,
  sprint_id text not null references sprints(id) on delete cascade,
  profile_id text not null references profiles(id) on delete cascade,
  delivery_points integer not null default 0 check (delivery_points between 0 and 12),
  form_points integer not null default 0 check (form_points between 0 and 4),
  weekly_points integer not null default 0 check (weekly_points between 0 and 4),
  total_points integer not null default 0 check (total_points between 0 and 20),
  fulfilled boolean not null default false,
  away_neutral boolean not null default false,
  finalized_at timestamptz not null default now(),
  finalized_by text references profiles(id) on delete set null,
  reason_summary text not null default '',
  unique (sprint_id, profile_id)
);

create table if not exists founder_strike_state (
  id bigint generated always as identity primary key,
  profile_id text not null unique references profiles(id) on delete cascade,
  strike_level integer not null default 0 check (strike_level between 0 and 3),
  fulfilled_reset_streak integer not null default 0 check (fulfilled_reset_streak >= 0),
  last_evaluated_sprint_id text references sprints(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists strike_events (
  id bigint generated always as identity primary key,
  profile_id text not null references profiles(id) on delete cascade,
  sprint_id text not null references sprints(id) on delete cascade,
  event_type text not null check (event_type in ('strike_added', 'strike_reset', 'away_neutral', 'fulfilled_no_change', 'governance_review_required')),
  previous_strike_level integer not null default 0 check (previous_strike_level between 0 and 3),
  next_strike_level integer not null default 0 check (next_strike_level between 0 and 3),
  reason text not null default '',
  created_at timestamptz not null default now(),
  created_by text references profiles(id) on delete set null
);

create table if not exists score_objections (
  id bigint generated always as identity primary key,
  sprint_id text not null references sprints(id) on delete cascade,
  profile_id text not null references profiles(id) on delete cascade,
  founder_sprint_score_id bigint references founder_sprint_scores(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed', 'accepted')),
  comment text not null,
  resolution_comment text not null default '',
  reviewed_by text references profiles(id) on delete set null,
  reviewed_at timestamptz,
  second_reviewer_profile_id text references profiles(id) on delete set null,
  second_review_decision text,
  second_reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists founder_sprint_scores_sprint_idx on founder_sprint_scores(sprint_id);
create index if not exists founder_sprint_scores_profile_idx on founder_sprint_scores(profile_id);
create index if not exists strike_events_profile_sprint_idx on strike_events(profile_id, sprint_id);
create index if not exists strike_events_type_idx on strike_events(event_type);
create index if not exists score_objections_sprint_status_idx on score_objections(sprint_id, status);
create index if not exists score_objections_profile_idx on score_objections(profile_id);

grant select, insert, update, delete on founder_sprint_scores, founder_strike_state, strike_events, score_objections to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

alter table founder_sprint_scores enable row level security;
alter table founder_strike_state enable row level security;
alter table strike_events enable row level security;
alter table score_objections enable row level security;

drop policy if exists "founder_sprint_scores_select_team" on founder_sprint_scores;
create policy "founder_sprint_scores_select_team" on founder_sprint_scores for select to authenticated using (auth.uid() is not null);

drop policy if exists "founder_sprint_scores_write_operational" on founder_sprint_scores;
create policy "founder_sprint_scores_write_operational" on founder_sprint_scores for all to authenticated
using (public.current_platform_role() in ('ceo', 'deputy'))
with check (public.current_platform_role() in ('ceo', 'deputy'));

drop policy if exists "founder_strike_state_select_team" on founder_strike_state;
create policy "founder_strike_state_select_team" on founder_strike_state for select to authenticated using (auth.uid() is not null);

drop policy if exists "founder_strike_state_write_operational" on founder_strike_state;
create policy "founder_strike_state_write_operational" on founder_strike_state for all to authenticated
using (public.current_platform_role() in ('ceo', 'deputy'))
with check (public.current_platform_role() in ('ceo', 'deputy'));

drop policy if exists "strike_events_select_team" on strike_events;
create policy "strike_events_select_team" on strike_events for select to authenticated using (auth.uid() is not null);

drop policy if exists "strike_events_insert_operational" on strike_events;
create policy "strike_events_insert_operational" on strike_events for insert to authenticated
with check (public.current_platform_role() in ('ceo', 'deputy'));

drop policy if exists "score_objections_select_team" on score_objections;
create policy "score_objections_select_team" on score_objections for select to authenticated using (auth.uid() is not null);

drop policy if exists "score_objections_insert_founder" on score_objections;
create policy "score_objections_insert_founder" on score_objections for insert to authenticated
with check (
  public.current_platform_role() in ('ceo', 'founder', 'deputy')
  and profile_id in (select id from profiles where auth_user_id = auth.uid())
);

drop policy if exists "score_objections_update_operational" on score_objections;
create policy "score_objections_update_operational" on score_objections for update to authenticated
using (public.current_platform_role() in ('ceo', 'deputy'))
with check (public.current_platform_role() in ('ceo', 'deputy'));

insert into meetings (sprint_id, title, meeting_at, agenda)
select s.id, s.name || ' Weekly 1', coalesce(s.start_date, current_date)::timestamp + interval '6 days 18 hours',
  'Weekly Update, Blocker, Review-Stand, Entscheidungen und nächste Schritte.'
from sprints s
where not exists (
  select 1 from meetings m
  where m.sprint_id = s.id and lower(m.title) like '%weekly 1%'
);

insert into meetings (sprint_id, title, meeting_at, agenda)
select s.id, s.name || ' Weekly 2', coalesce(s.end_date, current_date)::timestamp + interval '18 hours',
  'Weekly Update, Blocker, Review-Stand, Entscheidungen und nächste Schritte.'
from sprints s
where not exists (
  select 1 from meetings m
  where m.sprint_id = s.id and lower(m.title) like '%weekly 2%'
);

comment on table founder_sprint_scores is 'FounderOps v2.1 locked 20-point sprint score: Delivery 12, Form/Review 4, Weekly 4.';
comment on table founder_strike_state is 'Current FounderOps v2.1 strike level and reset streak per founder.';
comment on table strike_events is 'Append-only FounderOps v2.1 strike and governance-review history.';
comment on table score_objections is 'Founder score objections and optional one-time second review.';

notify pgrst, 'reload schema';
