-- Unifies the visible planning hierarchy under public.tasks without removing
-- the legacy milestone/package records. The legacy tables remain immutable
-- recovery evidence until a separately approved cleanup migration.

alter table public.tasks
  add column if not exists target_date date,
  add column if not exists created_at timestamptz not null default now();

alter table public.tasks
  alter column priority drop not null;

alter table public.task_comments
  add column if not exists github_delivery_applicable boolean not null default true;

create table if not exists public.planning_item_strategy (
  task_id text primary key references public.tasks(id) on delete cascade,
  goal text not null default '',
  success_criteria text not null default '',
  scope_constraints text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.planning_item_raci_assignments (
  task_id text not null references public.tasks(id) on delete cascade,
  profile_id text not null references public.profiles(id) on delete restrict,
  role text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (task_id, profile_id, role),
  constraint planning_item_raci_assignments_role_check
    check (role in ('accountable', 'responsible', 'consulted', 'informed')),
  constraint planning_item_raci_assignments_sort_order_check
    check (sort_order >= 0)
);

create unique index if not exists planning_item_raci_one_accountable_idx
  on public.planning_item_raci_assignments (task_id)
  where role = 'accountable';

create table if not exists public.planning_item_legacy_ids (
  source_kind text not null,
  legacy_id text not null,
  task_id text not null,
  project_id text not null,
  migrated_at timestamptz not null default now(),
  primary key (source_kind, legacy_id),
  unique (source_kind, task_id),
  constraint planning_item_legacy_ids_source_kind_check
    check (source_kind in ('milestone', 'package'))
);

create index if not exists planning_item_legacy_ids_task_idx
  on public.planning_item_legacy_ids (task_id);

create index if not exists tasks_planning_type_status_sort_idx
  on public.tasks (project_id, task_type, status, sort_order);

create index if not exists tasks_planning_parent_type_status_sort_idx
  on public.tasks (parent_task_id, task_type, status, sort_order);

alter table public.planning_item_strategy enable row level security;
alter table public.planning_item_raci_assignments enable row level security;
alter table public.planning_item_legacy_ids enable row level security;

revoke all on table public.planning_item_strategy from public, anon, authenticated;
revoke all on table public.planning_item_raci_assignments from public, anon, authenticated;
revoke all on table public.planning_item_legacy_ids from public, anon, authenticated;
grant select on table public.planning_item_strategy to authenticated;
grant select on table public.planning_item_raci_assignments to authenticated;
grant select on table public.planning_item_legacy_ids to authenticated;
grant all on table public.planning_item_strategy to service_role;
grant all on table public.planning_item_raci_assignments to service_role;
grant all on table public.planning_item_legacy_ids to service_role;

drop policy if exists planning_item_strategy_select_team on public.planning_item_strategy;
create policy planning_item_strategy_select_team
  on public.planning_item_strategy for select to authenticated
  using (public.current_profile_id() is not null);

drop policy if exists planning_item_raci_assignments_select_team on public.planning_item_raci_assignments;
create policy planning_item_raci_assignments_select_team
  on public.planning_item_raci_assignments for select to authenticated
  using (public.current_profile_id() is not null);

drop policy if exists planning_item_legacy_ids_select_team on public.planning_item_legacy_ids;
create policy planning_item_legacy_ids_select_team
  on public.planning_item_legacy_ids for select to authenticated
  using (public.current_profile_id() is not null);

create or replace function public.touch_planning_item_strategy_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists planning_item_strategy_touch_updated_at on public.planning_item_strategy;
create trigger planning_item_strategy_touch_updated_at
before update on public.planning_item_strategy
for each row execute function public.touch_planning_item_strategy_updated_at();

-- Uses a deterministic, namespaced identity even when a legacy id collides
-- with an existing task id. The original id remains queryable in the mapping
-- table and is never overwritten.
create or replace function public.planning_legacy_item_id(
  p_kind text,
  p_project_id text,
  p_legacy_id text
) returns text
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_primary text := p_kind || '-' || md5(p_kind || ':' || p_project_id || ':' || p_legacy_id);
  v_fallback text := p_kind || '-legacy-' || md5('fallback:' || p_kind || ':' || p_project_id || ':' || p_legacy_id);
begin
  if p_kind not in ('epic', 'initiative')
     or nullif(trim(coalesce(p_project_id, '')), '') is null
     or nullif(trim(coalesce(p_legacy_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'legacy planning identity input is invalid';
  end if;

  if not exists (select 1 from public.tasks where id = v_primary) then
    return v_primary;
  end if;

  if not exists (select 1 from public.tasks where id = v_fallback) then
    return v_fallback;
  end if;

  raise exception using errcode = '23505', message = 'deterministic planning identity collision';
end;
$$;

-- Stop before changing any row when the existing approval graph cannot be
-- represented without silently weakening an approved relationship.
do $$
begin
  if exists (
    select 1
    from public.packages package
    left join public.milestones milestone on milestone.id = package.milestone_id
    where package.approval_status = 'approved'
      and milestone.id is null
  ) then
    raise exception using errcode = '23514', message = 'approved legacy initiative is missing its milestone parent';
  end if;

  if exists (
    select 1
    from public.tasks task
    left join public.packages package on package.id = task.package_id
    where task.task_type = 'deliverable'
      and task.trashed_at is null
      and task.approval_status = 'approved'
      and (package.id is null or package.approval_status <> 'approved')
  ) then
    raise exception using errcode = '23514', message = 'approved deliverable is missing an approved initiative parent';
  end if;

  if exists (
    select 1
    from public.packages package
    cross join lateral unnest(
      array_cat(
        array[package.accountable_profile_id],
        array_cat(
          coalesce(package.responsible_profile_ids, '{}'::text[]),
          array_cat(
            coalesce(package.consulted_profile_ids, '{}'::text[]),
            coalesce(package.informed_profile_ids, '{}'::text[])
          )
        )
      )
    ) as assignment(profile_id)
    left join public.profiles profile on profile.id = assignment.profile_id
    where assignment.profile_id is not null
      and profile.id is null
  ) then
    raise exception using errcode = '23503', message = 'legacy initiative RACI references an unknown profile';
  end if;

  if exists (
    select 1
    from public.tasks task
    where task.task_type = 'sub_issue'
      and (
        task.sprint_id is not null
        or task.review_status <> 'not_requested'
        or task.review_owner_profile_id is not null
        or task.review_requested_at is not null
        or task.score_points <> 0
        or task.score_final
        or task.score_relevant
      )
  ) then
    raise exception using errcode = '23514', message = 'legacy sub-issue contains deliverable-only review or sprint data';
  end if;
end;
$$;

alter table public.tasks drop constraint if exists tasks_task_type_check;
alter table public.tasks drop constraint if exists tasks_approval_status_by_type_check;
alter table public.tasks drop constraint if exists tasks_github_repo_allowed_check;
alter table public.tasks drop constraint if exists tasks_github_sync_status_check;
alter table public.tasks drop constraint if exists tasks_score_relevance_approval_check;
alter table public.tasks drop constraint if exists tasks_approval_sprint_check;

alter table public.tasks
  add constraint tasks_task_type_check
    check (task_type in ('epic', 'initiative', 'deliverable', 'sub_issue')),
  add constraint tasks_approval_status_by_type_check
    check (
      (task_type in ('epic', 'sub_issue') and approval_status is null)
      or (task_type in ('initiative', 'deliverable') and approval_status in ('draft', 'proposed', 'approved', 'rejected'))
    ),
  add constraint tasks_github_repo_allowed_check
    check (
      (task_type in ('epic', 'initiative')
        and github_repo is null
        and github_issue_number is null
        and github_issue_url is null
        and github_issue_last_synced_at is null
        and github_issue_sync_error is null)
      or (task_type = 'deliverable' and github_repo = 'findmydoc-platform/management')
      or (task_type = 'sub_issue' and github_repo in ('findmydoc-platform/management', 'findmydoc-platform/website', 'findmydoc-platform/clinic-dashboard'))
    ),
  add constraint tasks_github_sync_status_check
    check (
      (task_type in ('epic', 'initiative') and github_issue_sync_status = 'not_applicable')
      or (task_type in ('deliverable', 'sub_issue') and github_issue_sync_status in ('not_synced', 'synced', 'pending', 'failed'))
    ),
  add constraint tasks_score_relevance_approval_check
    check (score_relevant = (task_type = 'deliverable' and approval_status = 'approved' and sprint_id is not null)),
  add constraint tasks_approval_sprint_check
    check ((task_type = 'deliverable' and approval_status = 'approved') or sprint_id is null),
  add constraint tasks_priority_by_type_check
    check ((task_type = 'epic' and priority is null) or (task_type <> 'epic' and nullif(trim(priority), '') is not null)),
  add constraint tasks_status_by_type_check
    check (
      (task_type in ('epic', 'initiative') and status in ('Offen', 'In Arbeit', 'Pausiert', 'Blockiert', 'Erledigt'))
      or (task_type = 'deliverable' and status in ('Offen', 'In Arbeit', 'Review', 'Nacharbeit', 'Blockiert', 'Erledigt'))
      or (task_type = 'sub_issue' and status in ('Offen', 'In Arbeit', 'Blockiert', 'Erledigt'))
    ),
  add constraint tasks_strategic_operational_fields_check
    check (
      task_type not in ('epic', 'initiative')
      or (
        sprint_id is null
        and original_sprint_id is null
        and carried_from_task_id is null
        and carried_from_sprint_id is null
        and carryover_reason is null
        and carryover_count = 0
        and sprint_outcome is null
        and review_status = 'not_requested'
        and review_owner_profile_id is null
        and review_requested_at is null
        and score_points = 0
        and score_final = false
        and score_relevant = false
      )
    ),
  add constraint tasks_sub_issue_operational_fields_check
    check (
      task_type <> 'sub_issue'
      or (
        sprint_id is null
        and review_status = 'not_requested'
        and review_owner_profile_id is null
        and review_requested_at is null
        and score_points = 0
        and score_final = false
        and score_relevant = false
      )
    );

create or replace function public.normalize_task_approval_state()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_actor_profile_id text := nullif(current_setting('app.actor_profile_id', true), '');
  v_backfill boolean := coalesce(current_setting('app.planning_hierarchy_backfill', true), 'false') = 'true';
  v_material_change boolean := false;
  v_parent public.tasks%rowtype;
  v_package_legacy_id text;
  v_milestone_legacy_id text;
begin
  if new.task_type = 'epic' then
    if new.parent_task_id is not null then
      raise exception using errcode = '23514', message = 'epic cannot have a parent';
    end if;
    new.priority := null;
    new.approval_status := null;
    new.sprint_id := null;
    new.original_sprint_id := null;
    new.carried_from_task_id := null;
    new.carried_from_sprint_id := null;
    new.carryover_reason := null;
    new.carryover_count := 0;
    new.sprint_outcome := null;
    new.review_status := 'not_requested';
    new.review_owner_profile_id := null;
    new.review_requested_at := null;
    new.score_points := 0;
    new.score_final := false;
    new.score_relevant := false;
    new.github_repo := null;
    new.github_issue_number := null;
    new.github_issue_url := null;
    new.github_issue_sync_status := 'not_applicable';
    new.github_issue_last_synced_at := null;
    new.github_issue_sync_error := null;
    return new;
  end if;

  if new.task_type = 'initiative' then
    if new.parent_task_id is not null then
      select * into v_parent from public.tasks where id = new.parent_task_id;
      if not found or v_parent.task_type <> 'epic' then
        raise exception using errcode = '23514', message = 'initiative parent must be an epic';
      end if;
      if new.trashed_at is null and v_parent.trashed_at is not null then
        raise exception using errcode = '23514', message = 'active initiative parent cannot be trashed';
      end if;
      select legacy_id into v_milestone_legacy_id
      from public.planning_item_legacy_ids
      where source_kind = 'milestone' and task_id = new.parent_task_id;
      new.milestone_id := v_milestone_legacy_id;
    else
      new.milestone_id := null;
    end if;
    if new.approval_status is null then
      new.approval_status := 'proposed';
    end if;
    new.sprint_id := null;
    new.original_sprint_id := null;
    new.carried_from_task_id := null;
    new.carried_from_sprint_id := null;
    new.carryover_reason := null;
    new.carryover_count := 0;
    new.sprint_outcome := null;
    new.review_status := 'not_requested';
    new.review_owner_profile_id := null;
    new.review_requested_at := null;
    new.score_points := 0;
    new.score_final := false;
    new.score_relevant := false;
    new.github_repo := null;
    new.github_issue_number := null;
    new.github_issue_url := null;
    new.github_issue_sync_status := 'not_applicable';
    new.github_issue_last_synced_at := null;
    new.github_issue_sync_error := null;

    if tg_op = 'UPDATE' and old.task_type = 'initiative' and not v_backfill then
      v_material_change := new.parent_task_id is distinct from old.parent_task_id;
      if v_material_change and old.approval_status = 'approved' then
        new.approval_status := 'proposed';
        new.approval_revision := old.approval_revision + 1;
        new.proposed_by := v_actor_profile_id;
        new.proposed_at := now();
        new.decided_by := null;
        new.decided_at := null;
        new.decision_note := null;
      end if;
    end if;
    return new;
  end if;

  if new.task_type = 'sub_issue' then
    if new.parent_task_id is null then
      raise exception using errcode = '23514', message = 'sub-issue requires a parent deliverable';
    end if;
    select * into v_parent from public.tasks where id = new.parent_task_id;
    if not found or v_parent.task_type <> 'deliverable' then
      raise exception using errcode = '23514', message = 'sub-issue parent must be a deliverable';
    end if;
    if new.trashed_at is null and v_parent.trashed_at is not null then
      raise exception using errcode = '23514', message = 'active sub-issue parent cannot be trashed';
    end if;
    if tg_op = 'INSERT' and not v_backfill and v_parent.approval_status is distinct from 'approved' then
      raise exception using errcode = '23514', message = 'sub-issue parent must be approved';
    end if;
    new.package_id := v_parent.package_id;
    new.milestone_id := v_parent.milestone_id;
    new.approval_status := null;
    new.sprint_id := null;
    new.review_status := 'not_requested';
    new.review_owner_profile_id := null;
    new.review_requested_at := null;
    new.score_points := 0;
    new.score_final := false;
    new.score_relevant := false;
    return new;
  end if;

  if new.task_type <> 'deliverable' then
    raise exception using errcode = '23514', message = 'unsupported task type';
  end if;

  if new.parent_task_id is not null then
    select * into v_parent from public.tasks where id = new.parent_task_id;
    if not found or v_parent.task_type <> 'initiative' then
      raise exception using errcode = '23514', message = 'deliverable parent must be an initiative';
    end if;
    if new.trashed_at is null and v_parent.trashed_at is not null then
      raise exception using errcode = '23514', message = 'active deliverable parent cannot be trashed';
    end if;
    select legacy_id into v_package_legacy_id
    from public.planning_item_legacy_ids
    where source_kind = 'package' and task_id = new.parent_task_id;
    new.package_id := v_package_legacy_id;
    new.milestone_id := v_parent.milestone_id;
  elsif new.approval_status = 'approved'
    and not v_backfill
    and not (tg_op = 'UPDATE' and new.parent_task_id is distinct from old.parent_task_id) then
    raise exception using errcode = '23514', message = 'approved deliverable requires an initiative parent';
  end if;

  if new.approval_status is null then
    new.approval_status := 'proposed';
  end if;
  new.github_repo := 'findmydoc-platform/management';

  if tg_op = 'UPDATE' and old.task_type = 'deliverable' and not v_backfill then
    v_material_change := new.parent_task_id is distinct from old.parent_task_id;
    if v_material_change and old.approval_status = 'approved' then
      new.approval_status := 'proposed';
      new.approval_revision := old.approval_revision + 1;
      new.proposed_by := v_actor_profile_id;
      new.proposed_at := now();
      new.decided_by := null;
      new.decided_at := null;
      new.decision_note := null;
      new.sprint_id := null;
      new.review_status := 'not_requested';
      new.review_requested_at := null;
      new.score_points := 0;
      new.score_final := false;
      insert into public.task_activity (task_id, message)
      values (new.id, 'Parent geändert: neue Freigabe erforderlich');
    end if;
  end if;

  if new.approval_status <> 'approved' then
    new.sprint_id := null;
    new.score_relevant := false;
  else
    new.score_relevant := new.sprint_id is not null;
  end if;

  if new.status = 'Review'
     and (
       new.approval_status is distinct from 'approved'
       or new.review_status is distinct from 'requested'
     ) then
    new.status := 'In Arbeit';
  end if;

  return new;
end;
$$;

comment on function public.normalize_task_approval_state()
is 'Normalizes the canonical Epic, Initiative, Deliverable and Sub-Issue hierarchy without deriving parent status from children.';

-- Existing task trigger names are stable across the production baseline. Rebind
-- defensively so local fresh resets and upgraded installations behave alike.
drop trigger if exists tasks_normalize_approval_state on public.tasks;
create trigger tasks_normalize_approval_state
before insert or update on public.tasks
for each row execute function public.normalize_task_approval_state();

select set_config('app.planning_hierarchy_backfill', 'true', false);

insert into public.planning_item_legacy_ids (source_kind, legacy_id, task_id, project_id)
select 'milestone', milestone.id, public.planning_legacy_item_id('epic', milestone.project_id, milestone.id), milestone.project_id
from public.milestones milestone
on conflict (source_kind, legacy_id) do nothing;

insert into public.tasks (
  id, project_id, title, description, status, priority, sort_order,
  target_date, created_at, updated_at, task_type, parent_task_id,
  approval_status, approval_revision, github_issue_sync_status,
  score_relevant, review_status
)
select
  legacy.task_id,
  milestone.project_id,
  milestone.title,
  milestone.description,
  case milestone.status
    when 'active' then 'In Arbeit'
    when 'done' then 'Erledigt'
    else 'Offen'
  end,
  null,
  milestone.sort_order,
  milestone.target_date,
  milestone.created_at,
  milestone.updated_at,
  'epic',
  null,
  null,
  1,
  'not_applicable',
  false,
  'not_requested'
from public.milestones milestone
join public.planning_item_legacy_ids legacy
  on legacy.source_kind = 'milestone' and legacy.legacy_id = milestone.id
on conflict (id) do nothing;

insert into public.planning_item_legacy_ids (source_kind, legacy_id, task_id, project_id)
select 'package', package.id, public.planning_legacy_item_id('initiative', package.project_id, package.id), package.project_id
from public.packages package
on conflict (source_kind, legacy_id) do nothing;

insert into public.tasks (
  id, project_id, title, description, status, priority, owner, assignee,
  sort_order, target_date, created_at, updated_at, task_type, parent_task_id,
  milestone_id, approval_status, approval_revision, proposed_by, proposed_at,
  decided_by, decided_at, decision_note, trashed_at, trashed_by, trash_reason,
  trash_cause, purge_after, trash_root_type, trash_root_id, trash_revision,
  github_issue_sync_status, score_relevant, review_status
)
select
  legacy.task_id,
  package.project_id,
  package.title,
  package.goal,
  case package.status
    when 'active' then 'In Arbeit'
    when 'paused' then 'Pausiert'
    when 'done' then 'Erledigt'
    else 'Offen'
  end,
  coalesce(nullif(trim(package.priority), ''), 'P2'),
  package.owner_id,
  package.owner_id,
  package.sort_order,
  package.target_date,
  package.updated_at,
  package.updated_at,
  'initiative',
  milestone_legacy.task_id,
  package.milestone_id,
  package.approval_status,
  package.approval_revision,
  package.proposed_by,
  package.proposed_at,
  package.decided_by,
  package.decided_at,
  package.decision_note,
  package.trashed_at,
  package.trashed_by,
  package.trash_reason,
  package.trash_cause,
  package.purge_after,
  package.trash_root_type,
  case when package.trashed_at is not null then legacy.task_id else null end,
  package.trash_revision,
  'not_applicable',
  false,
  'not_requested'
from public.packages package
join public.planning_item_legacy_ids legacy
  on legacy.source_kind = 'package' and legacy.legacy_id = package.id
left join public.planning_item_legacy_ids milestone_legacy
  on milestone_legacy.source_kind = 'milestone' and milestone_legacy.legacy_id = package.milestone_id
on conflict (id) do nothing;

insert into public.planning_item_strategy (task_id, goal, success_criteria, scope_constraints)
select
  legacy.task_id,
  coalesce(package.goal, ''),
  coalesce(package.success_criteria, ''),
  coalesce(package.scope_constraints, '')
from public.packages package
join public.planning_item_legacy_ids legacy
  on legacy.source_kind = 'package' and legacy.legacy_id = package.id
on conflict (task_id) do nothing;

insert into public.planning_item_raci_assignments (task_id, profile_id, role, sort_order)
select legacy.task_id, package.accountable_profile_id, 'accountable', 0
from public.packages package
join public.planning_item_legacy_ids legacy
  on legacy.source_kind = 'package' and legacy.legacy_id = package.id
where package.accountable_profile_id is not null
union all
select legacy.task_id, assignment.profile_id, 'responsible', assignment.ordinality::integer
from public.packages package
join public.planning_item_legacy_ids legacy
  on legacy.source_kind = 'package' and legacy.legacy_id = package.id
cross join lateral unnest(coalesce(package.responsible_profile_ids, '{}'::text[])) with ordinality as assignment(profile_id, ordinality)
union all
select legacy.task_id, assignment.profile_id, 'consulted', assignment.ordinality::integer
from public.packages package
join public.planning_item_legacy_ids legacy
  on legacy.source_kind = 'package' and legacy.legacy_id = package.id
cross join lateral unnest(coalesce(package.consulted_profile_ids, '{}'::text[])) with ordinality as assignment(profile_id, ordinality)
union all
select legacy.task_id, assignment.profile_id, 'informed', assignment.ordinality::integer
from public.packages package
join public.planning_item_legacy_ids legacy
  on legacy.source_kind = 'package' and legacy.legacy_id = package.id
cross join lateral unnest(coalesce(package.informed_profile_ids, '{}'::text[])) with ordinality as assignment(profile_id, ordinality)
on conflict (task_id, profile_id, role) do nothing;

update public.tasks task
set parent_task_id = legacy.task_id
from public.planning_item_legacy_ids legacy
where task.task_type = 'deliverable'
  and task.package_id = legacy.legacy_id
  and legacy.source_kind = 'package'
  and task.parent_task_id is distinct from legacy.task_id;

update public.tasks task
set trash_root_id = legacy.task_id
from public.planning_item_legacy_ids legacy
where task.task_type in ('deliverable', 'sub_issue')
  and task.trashed_at is not null
  and task.trash_root_type = 'initiative'
  and task.trash_root_id = legacy.legacy_id
  and legacy.source_kind = 'package';

select set_config('app.planning_hierarchy_backfill', 'false', false);

do $$
begin
  if (select count(*) from public.milestones)
     <> (select count(*) from public.planning_item_legacy_ids where source_kind = 'milestone')
     or (select count(*) from public.milestones)
     <> (select count(*) from public.tasks where task_type = 'epic') then
    raise exception using errcode = '23514', message = 'milestone to epic backfill count verification failed';
  end if;

  if (select count(*) from public.packages)
     <> (select count(*) from public.planning_item_legacy_ids where source_kind = 'package')
     or (select count(*) from public.packages)
     <> (select count(*) from public.tasks where task_type = 'initiative') then
    raise exception using errcode = '23514', message = 'package to initiative backfill count verification failed';
  end if;

  if exists (
    select 1
    from public.tasks task
    join public.planning_item_legacy_ids legacy
      on legacy.source_kind = 'package' and legacy.legacy_id = task.package_id
    where task.task_type = 'deliverable'
      and task.parent_task_id is distinct from legacy.task_id
  ) then
    raise exception using errcode = '23514', message = 'deliverable parent backfill verification failed';
  end if;

  if exists (
    select 1
    from public.tasks
    where task_type in ('epic', 'initiative')
      and (
        github_repo is not null
        or github_issue_number is not null
        or github_issue_sync_status <> 'not_applicable'
      )
  ) then
    raise exception using errcode = '23514', message = 'strategic GitHub exclusion verification failed';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'planning_item_legacy_ids_task_id_fkey'
      and conrelid = 'public.planning_item_legacy_ids'::regclass
  ) then
    alter table public.planning_item_legacy_ids
      add constraint planning_item_legacy_ids_task_id_fkey
      foreign key (task_id) references public.tasks(id) on delete restrict;
  end if;
end;
$$;

create or replace view public.active_tasks
with (security_invoker = true)
as
select task.*
from public.tasks task
where task.trashed_at is null;

-- Compatibility read model only.  The old package table remains recovery
-- evidence, while every active-package consumer now reads the Initiative task
-- projection below.  It deliberately exposes canonical ids for both the
-- Initiative and its Epic parent.
create or replace view public.active_packages
with (security_invoker = true)
as
select
  task.id,
  task.project_id,
  task.title,
  coalesce(strategy.goal, task.description, '') as goal,
  task.priority,
  task.sort_order,
  task.parent_task_id as milestone_id,
  task.owner as owner_id,
  case task.status
    when 'In Arbeit' then 'active'
    when 'Pausiert' then 'paused'
    when 'Erledigt' then 'done'
    else 'planned'
  end as status,
  task.target_date,
  coalesce(strategy.success_criteria, '') as success_criteria,
  coalesce(strategy.scope_constraints, '') as scope_constraints,
  coalesce((
    select assignment.profile_id
    from public.planning_item_raci_assignments assignment
    where assignment.task_id = task.id
      and assignment.role = 'accountable'
    order by assignment.sort_order, assignment.profile_id
    limit 1
  ), '') as accountable_profile_id,
  coalesce((
    select array_agg(assignment.profile_id order by assignment.sort_order, assignment.profile_id)
    from public.planning_item_raci_assignments assignment
    where assignment.task_id = task.id
      and assignment.role = 'responsible'
  ), '{}'::text[]) as responsible_profile_ids,
  coalesce((
    select array_agg(assignment.profile_id order by assignment.sort_order, assignment.profile_id)
    from public.planning_item_raci_assignments assignment
    where assignment.task_id = task.id
      and assignment.role = 'consulted'
  ), '{}'::text[]) as consulted_profile_ids,
  coalesce((
    select array_agg(assignment.profile_id order by assignment.sort_order, assignment.profile_id)
    from public.planning_item_raci_assignments assignment
    where assignment.task_id = task.id
      and assignment.role = 'informed'
  ), '{}'::text[]) as informed_profile_ids,
  task.approval_status,
  task.approval_revision,
  task.proposed_by,
  task.proposed_at,
  task.decided_by,
  task.decided_at,
  task.decision_note,
  task.trashed_at,
  task.trashed_by,
  task.trash_reason,
  task.trash_cause,
  task.purge_after,
  task.trash_root_type,
  task.trash_root_id,
  task.trash_revision,
  task.updated_at
from public.tasks task
left join public.planning_item_strategy strategy on strategy.task_id = task.id
where task.task_type = 'initiative'
  and task.trashed_at is null;

-- Strategic items have local activity and comments, but no GitHub delivery.
create or replace function public.create_task_comment_local(
  p_task_id text,
  p_profile_id text,
  p_comment text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_task public.tasks%rowtype;
  v_comment public.task_comments%rowtype;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
  if v_task.task_type not in ('epic', 'initiative') then
    raise exception using errcode = '22023', message = 'local-only comments are reserved for strategic planning items';
  end if;
  if nullif(trim(coalesce(p_comment, '')), '') is null then
    raise exception using errcode = '22023', message = 'comment is required';
  end if;

  insert into public.task_comments (task_id, profile_id, comment, github_delivery_applicable)
  values (p_task_id, nullif(p_profile_id, ''), trim(p_comment), false)
  returning * into v_comment;

  return jsonb_build_object(
    'comment', to_jsonb(v_comment),
    'deliveryStatus', 'not_applicable'
  );
end;
$$;

create or replace function public.assert_github_delivery_task_capability()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_task_type text;
begin
  select task_type into v_task_type from public.tasks where id = new.task_id;
  if v_task_type in ('epic', 'initiative') then
    raise exception using errcode = '23514', message = 'strategic planning items cannot create GitHub delivery records';
  end if;
  return new;
end;
$$;

drop trigger if exists task_comment_github_delivery_capability on public.task_comment_github_deliveries;
create trigger task_comment_github_delivery_capability
before insert or update on public.task_comment_github_deliveries
for each row execute function public.assert_github_delivery_task_capability();

drop trigger if exists planning_github_lifecycle_task_capability on public.planning_github_lifecycle_outbox;
create trigger planning_github_lifecycle_task_capability
before insert or update on public.planning_github_lifecycle_outbox
for each row execute function public.assert_github_delivery_task_capability();

drop trigger if exists github_issue_sync_lock_task_capability on public.github_issue_sync_locks;
create trigger github_issue_sync_lock_task_capability
before insert or update on public.github_issue_sync_locks
for each row
when (new.task_id is not null)
execute function public.assert_github_delivery_task_capability();

create or replace function public.replace_planning_item_raci_assignments(
  p_task_id text,
  p_assignments jsonb
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_assignments jsonb := coalesce(p_assignments, '[]'::jsonb);
begin
  if jsonb_typeof(v_assignments) <> 'array'
     or jsonb_array_length(v_assignments) > 100 then
    raise exception using errcode = '22023', message = 'RACI assignments must be an array with at most 100 entries';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_assignments) assignment(value)
    where jsonb_typeof(assignment.value) <> 'object'
      or nullif(trim(assignment.value->>'profileId'), '') is null
      or assignment.value->>'role' not in ('accountable', 'responsible', 'consulted', 'informed')
      or coalesce(assignment.value->>'sortOrder', '0') !~ '^[0-9]+$'
  ) then
    raise exception using errcode = '22023', message = 'RACI assignment is invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_assignments) assignment(value)
    left join public.profiles profile on profile.id = assignment.value->>'profileId'
    where profile.id is null
  ) then
    raise exception using errcode = '23503', message = 'RACI assignment profile was not found';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(v_assignments) assignment(value)
    where assignment.value->>'role' = 'accountable'
  ) > 1 then
    raise exception using errcode = '23514', message = 'planning item can have at most one accountable RACI assignment';
  end if;

  if exists (
    select 1
    from (
      select assignment.value->>'profileId' as profile_id, assignment.value->>'role' as role, count(*) as duplicate_count
      from jsonb_array_elements(v_assignments) assignment(value)
      group by assignment.value->>'profileId', assignment.value->>'role'
    ) duplicates
    where duplicates.duplicate_count > 1
  ) then
    raise exception using errcode = '23505', message = 'RACI assignment is duplicated';
  end if;

  delete from public.planning_item_raci_assignments where task_id = p_task_id;

  insert into public.planning_item_raci_assignments (task_id, profile_id, role, sort_order)
  select
    p_task_id,
    assignment.value->>'profileId',
    assignment.value->>'role',
    coalesce((assignment.value->>'sortOrder')::integer, assignment.ordinality::integer - 1)
  from jsonb_array_elements(v_assignments) with ordinality assignment(value, ordinality);
end;
$$;

create or replace function public.create_planning_item_transaction(
  p_item jsonb,
  p_strategy jsonb default null,
  p_raci_assignments jsonb default '[]'::jsonb,
  p_actor_profile_id text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_type text := lower(nullif(trim(coalesce(p_item->>'task_type', '')), ''));
  v_id text := nullif(trim(coalesce(p_item->>'id', '')), '');
  v_project_id text := nullif(trim(coalesce(p_item->>'project_id', '')), '');
  v_title text := nullif(trim(coalesce(p_item->>'title', '')), '');
  v_owner text := nullif(trim(coalesce(p_item->>'owner', p_item->>'assignee', '')), '');
  v_parent_task_id text := nullif(trim(coalesce(p_item->>'parent_task_id', '')), '');
  v_status text := nullif(trim(coalesce(p_item->>'status', '')), '');
  v_priority text := nullif(trim(coalesce(p_item->>'priority', '')), '');
  v_parent public.tasks%rowtype;
  v_task public.tasks%rowtype;
  v_strategy jsonb := coalesce(p_strategy, '{}'::jsonb);
begin
  perform set_config('app.actor_profile_id', coalesce(p_actor_profile_id, ''), true);

  if v_type not in ('epic', 'initiative')
     or v_id is null
     or v_project_id is null
     or v_title is null
     or v_owner is null
     or v_status is null then
    raise exception using errcode = '22023', message = 'planning item create input is invalid';
  end if;
  if exists (select 1 from public.tasks where id = v_id) then
    raise exception using errcode = '23505', message = 'planning item id already exists';
  end if;
  if not exists (select 1 from public.profiles where id = v_owner) then
    raise exception using errcode = '23503', message = 'planning item owner was not found';
  end if;
  if v_type = 'epic' and v_parent_task_id is not null then
    raise exception using errcode = '23514', message = 'epic cannot have a parent';
  end if;
  if v_type = 'initiative' and v_parent_task_id is not null then
    select * into v_parent from public.tasks where id = v_parent_task_id and trashed_at is null for share;
    if not found or v_parent.task_type <> 'epic' then
      raise exception using errcode = '23514', message = 'initiative parent must be an active epic';
    end if;
  end if;
  if v_type = 'initiative' and v_priority is null then
    v_priority := 'P2';
  end if;
  if jsonb_typeof(v_strategy) <> 'object' then
    raise exception using errcode = '22023', message = 'planning strategy must be an object';
  end if;

  insert into public.tasks (
    id, project_id, title, description, status, priority, owner, assignee,
    sort_order, target_date, task_type, parent_task_id, approval_status,
    approval_revision, proposed_by, proposed_at, github_issue_sync_status,
    score_relevant, review_status, created_by
  ) values (
    v_id,
    v_project_id,
    v_title,
    nullif(trim(coalesce(p_item->>'description', '')), ''),
    v_status,
    case when v_type = 'epic' then null else v_priority end,
    v_owner,
    v_owner,
    coalesce((p_item->>'sort_order')::integer, 0),
    nullif(trim(coalesce(p_item->>'target_date', '')), '')::date,
    v_type,
    v_parent_task_id,
    case when v_type = 'initiative' then 'proposed' else null end,
    1,
    case when v_type = 'initiative' then nullif(p_actor_profile_id, '') else null end,
    case when v_type = 'initiative' then now() else null end,
    'not_applicable',
    false,
    'not_requested',
    nullif(p_actor_profile_id, '')
  ) returning * into v_task;

  if v_type = 'initiative' then
    insert into public.planning_item_strategy (task_id, goal, success_criteria, scope_constraints)
    values (
      v_id,
      coalesce(v_strategy->>'goal', ''),
      coalesce(v_strategy->>'successCriteria', ''),
      coalesce(v_strategy->>'scopeConstraints', '')
    );
    perform public.replace_planning_item_raci_assignments(v_id, p_raci_assignments);
  end if;

  insert into public.task_activity (task_id, message)
  values (v_id, case when v_type = 'epic' then 'Epic erstellt' else 'Initiative vorgeschlagen' end);
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, after_data)
  values (
    nullif(p_actor_profile_id, ''),
    'planning_item.created',
    'task',
    v_id,
    jsonb_build_object('taskType', v_type, 'parentTaskId', v_parent_task_id)
  );

  return jsonb_build_object('task', to_jsonb(v_task));
end;
$$;

create or replace function public.update_planning_item_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_patch jsonb default '{}'::jsonb,
  p_strategy jsonb default null,
  p_raci_assignments jsonb default null,
  p_actor_profile_id text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_task public.tasks%rowtype;
  v_updated_task public.tasks%rowtype;
  v_parent_changed boolean := false;
begin
  perform set_config('app.actor_profile_id', coalesce(p_actor_profile_id, ''), true);

  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'planning item revision is required';
  end if;
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'planning item patch must be an object';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(v_patch) key
    where key not in ('title', 'description', 'status', 'priority', 'owner', 'assignee', 'target_date', 'parent_task_id', 'sort_order')
  ) then
    raise exception using errcode = '22023', message = 'planning item patch contains an unsupported field';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_task.task_type not in ('epic', 'initiative') then
    raise exception using errcode = '22023', message = 'task is not a strategic planning item';
  end if;
  if v_task.trashed_at is not null then
    raise exception using errcode = 'P0003', message = 'planning item is trashed';
  end if;
  if v_task.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;

  v_parent_changed := v_patch ? 'parent_task_id'
    and nullif(trim(coalesce(v_patch->>'parent_task_id', '')), '') is distinct from v_task.parent_task_id;

  update public.tasks
  set title = case when v_patch ? 'title' then nullif(trim(v_patch->>'title'), '') else v_task.title end,
      description = case when v_patch ? 'description' then nullif(trim(coalesce(v_patch->>'description', '')), '') else v_task.description end,
      status = case when v_patch ? 'status' then nullif(trim(v_patch->>'status'), '') else v_task.status end,
      priority = case
        when v_task.task_type = 'epic' then null
        when v_patch ? 'priority' then nullif(trim(v_patch->>'priority'), '')
        else v_task.priority
      end,
      owner = case when v_patch ? 'owner' then nullif(trim(coalesce(v_patch->>'owner', '')), '') else v_task.owner end,
      assignee = case when v_patch ? 'assignee' then nullif(trim(coalesce(v_patch->>'assignee', '')), '') else v_task.assignee end,
      target_date = case when v_patch ? 'target_date' then nullif(trim(coalesce(v_patch->>'target_date', '')), '')::date else v_task.target_date end,
      parent_task_id = case when v_patch ? 'parent_task_id' then nullif(trim(coalesce(v_patch->>'parent_task_id', '')), '') else v_task.parent_task_id end,
      sort_order = case when v_patch ? 'sort_order' then (v_patch->>'sort_order')::integer else v_task.sort_order end,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning * into v_updated_task;

  if p_strategy is not null then
    if v_task.task_type <> 'initiative' or jsonb_typeof(p_strategy) <> 'object' then
      raise exception using errcode = '22023', message = 'only initiatives can update strategy';
    end if;
    insert into public.planning_item_strategy (task_id, goal, success_criteria, scope_constraints)
    values (
      p_task_id,
      coalesce(p_strategy->>'goal', ''),
      coalesce(p_strategy->>'successCriteria', ''),
      coalesce(p_strategy->>'scopeConstraints', '')
    )
    on conflict (task_id) do update
      set goal = excluded.goal,
          success_criteria = excluded.success_criteria,
          scope_constraints = excluded.scope_constraints;
  end if;

  if p_raci_assignments is not null then
    if v_task.task_type <> 'initiative' then
      raise exception using errcode = '22023', message = 'only initiatives can update RACI assignments';
    end if;
    perform public.replace_planning_item_raci_assignments(p_task_id, p_raci_assignments);
  end if;

  if v_parent_changed then
    insert into public.task_activity (task_id, message)
    values (p_task_id, case when v_task.approval_status = 'approved'
      then 'Epic-Zuordnung geändert: neue Freigabe erforderlich'
      else 'Epic-Zuordnung geändert' end);
  end if;

  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
  values (
    nullif(p_actor_profile_id, ''),
    'planning_item.updated',
    'task',
    p_task_id,
    jsonb_build_object('parentTaskId', v_task.parent_task_id, 'approvalStatus', v_task.approval_status),
    jsonb_build_object('parentTaskId', v_updated_task.parent_task_id, 'approvalStatus', v_updated_task.approval_status)
  );

  return jsonb_build_object('task', to_jsonb(v_updated_task));
end;
$$;

create or replace function public.reparent_planning_item_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_parent_task_id text,
  p_actor_profile_id text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_parent_task_id text := nullif(trim(coalesce(p_parent_task_id, '')), '');
  v_updated_task public.tasks%rowtype;
begin
  perform set_config('app.actor_profile_id', coalesce(p_actor_profile_id, ''), true);
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_task.trashed_at is not null then
    raise exception using errcode = 'P0003', message = 'planning item is trashed';
  end if;
  if v_task.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;
  if v_task.task_type = 'epic' then
    raise exception using errcode = '22023', message = 'epic cannot change parent';
  end if;

  if v_task.task_type = 'initiative' then
    return public.update_planning_item_transaction(
      p_task_id,
      p_expected_updated_at,
      jsonb_build_object('parent_task_id', v_parent_task_id),
      null,
      null,
      p_actor_profile_id
    );
  end if;

  if v_task.task_type = 'sub_issue' and v_parent_task_id is null then
    raise exception using errcode = '23514', message = 'sub-issue requires a deliverable parent';
  end if;
  if v_parent_task_id is not null then
    select * into v_parent from public.tasks where id = v_parent_task_id and trashed_at is null for share;
    if not found then
      raise exception using errcode = '23514', message = 'planning item parent was not found';
    end if;
    if (v_task.task_type = 'deliverable' and v_parent.task_type <> 'initiative')
       or (v_task.task_type = 'sub_issue' and v_parent.task_type <> 'deliverable') then
      raise exception using errcode = '23514', message = 'planning item parent has the wrong type';
    end if;
    if v_task.task_type = 'sub_issue' and v_parent.approval_status is distinct from 'approved' then
      raise exception using errcode = '23514', message = 'sub-issue parent must be approved';
    end if;
  end if;

  update public.tasks
  set parent_task_id = v_parent_task_id,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning * into v_updated_task;

  insert into public.task_activity (task_id, message)
  values (p_task_id, 'Übergeordnete Planungsebene geändert');
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
  values (
    nullif(p_actor_profile_id, ''),
    'task.parent_changed',
    'task',
    p_task_id,
    jsonb_build_object('parentTaskId', v_task.parent_task_id),
    jsonb_build_object('parentTaskId', v_updated_task.parent_task_id)
  );

  return jsonb_build_object('task', to_jsonb(v_updated_task));
end;
$$;

create or replace function public.decide_planning_item_approval_transaction(
  p_task_id text,
  p_expected_revision integer,
  p_action text,
  p_actor_profile_id text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_actor_role text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_next_status text;
  v_accountable_count integer;
  v_responsible_count integer;
begin
  if p_action not in ('approve', 'reject', 'return_to_draft')
     or p_expected_revision is null
     or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'planning approval input is invalid';
  end if;
  if char_length(v_note) > 2000 then
    raise exception using errcode = '22023', message = 'approval decision note exceeds 2000 characters';
  end if;
  if p_action in ('reject', 'return_to_draft') and v_note is null then
    raise exception using errcode = '22023', message = 'approval decision note is required';
  end if;

  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  if not found then
    raise exception using errcode = 'P0006', message = 'approval actor not found';
  end if;
  if v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'only ceo or deputy may decide planning approval';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_task.task_type not in ('initiative', 'deliverable') then
    raise exception using errcode = '22023', message = 'planning item has no approval lifecycle';
  end if;
  if v_task.trashed_at is not null then
    raise exception using errcode = 'P0003', message = 'planning item is trashed';
  end if;
  if v_task.approval_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'planning approval revision changed';
  end if;
  if v_task.approval_status <> 'proposed' then
    raise exception using errcode = 'P0003', message = 'planning item is not proposed';
  end if;

  if p_action = 'approve' then
    if v_task.parent_task_id is null then
      raise exception using errcode = '23514', message = 'approved planning item requires a parent';
    end if;
    select * into v_parent from public.tasks where id = v_task.parent_task_id and trashed_at is null for share;
    if not found then
      raise exception using errcode = '23514', message = 'planning item parent was not found';
    end if;
    if v_task.task_type = 'initiative' then
      if v_parent.task_type <> 'epic' then
        raise exception using errcode = '23514', message = 'initiative parent must be an epic';
      end if;
      select count(*) filter (where role = 'accountable'), count(*) filter (where role = 'responsible')
      into v_accountable_count, v_responsible_count
      from public.planning_item_raci_assignments
      where task_id = p_task_id;
      if v_accountable_count <> 1 or v_responsible_count < 1 then
        raise exception using errcode = '23514', message = 'initiative approval requires one accountable and at least one responsible RACI assignment';
      end if;
    elsif v_parent.task_type <> 'initiative' or v_parent.approval_status <> 'approved' then
      raise exception using errcode = '23514', message = 'deliverable approval requires an approved initiative';
    end if;
  end if;

  if p_action = 'reject' then
    update public.tasks
    set approval_status = 'rejected',
        approval_revision = approval_revision + 1,
        decided_by = p_actor_profile_id,
        decided_at = now(),
        decision_note = v_note,
        updated_at = clock_timestamp()
    where id = p_task_id
    returning * into v_task;
    insert into public.task_activity (task_id, message)
    values (p_task_id, case when v_task.task_type = 'initiative'
      then 'Initiative abgelehnt · Revision ' || v_task.approval_revision
      else 'Deliverable abgelehnt · Revision ' || v_task.approval_revision end);
  else
    v_next_status := case p_action when 'approve' then 'approved' else 'draft' end;
    update public.tasks
    set approval_status = v_next_status,
        approval_revision = approval_revision + 1,
        decided_by = case when p_action = 'approve' then p_actor_profile_id else null end,
        decided_at = case when p_action = 'approve' then now() else null end,
        decision_note = v_note,
        sprint_id = case when p_action = 'approve' then sprint_id else null end,
        review_status = case when p_action = 'approve' then review_status else 'not_requested' end,
        review_requested_at = case when p_action = 'approve' then review_requested_at else null end,
        score_points = case when p_action = 'approve' then score_points else 0 end,
        score_final = case when p_action = 'approve' then score_final else false end,
        github_issue_sync_status = case when task_type = 'deliverable' then 'not_synced' else 'not_applicable' end,
        github_issue_sync_error = null,
        updated_at = clock_timestamp()
    where id = p_task_id
    returning * into v_task;
    insert into public.task_activity (task_id, message)
    values (p_task_id, case p_action
      when 'approve' then case when v_task.task_type = 'initiative' then 'Initiative freigegeben · Revision ' else 'Deliverable freigegeben · Revision ' end || v_task.approval_revision
      else case when v_task.task_type = 'initiative' then 'Initiative zur Überarbeitung zurückgegeben · Revision ' else 'Deliverable zur Überarbeitung zurückgegeben · Revision ' end || v_task.approval_revision || ' · Begründung: ' || v_note
    end);
  end if;

  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
  values (
    p_actor_profile_id,
    'planning_item.approval_' || p_action,
    'task',
    p_task_id,
    jsonb_build_object('approvalStatus', 'proposed', 'revision', p_expected_revision),
    jsonb_build_object('approvalStatus', v_task.approval_status, 'revision', v_task.approval_revision, 'note', v_note)
  );

  return jsonb_build_object('task', to_jsonb(v_task));
end;
$$;

-- The legacy task-create RPC remains as a compatibility entry point for
-- Deliverables and Sub-Issues.  Its approval step must use the canonical
-- Initiative parent, not the retained package recovery table.
create or replace function public.create_planning_task_transaction(
  p_task_insert jsonb,
  p_relation_type text default null,
  p_related_task_id text default null,
  p_relation_note text default null,
  p_activity_message text default 'Task created',
  p_relation_activity_message text default null,
  p_notifications jsonb default '[]'::jsonb,
  p_actor_profile_id text default null,
  p_request_ip text default null,
  p_user_agent text default null,
  p_approve_now boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
  v_task jsonb;
  v_clean_insert jsonb := coalesce(p_task_insert, '{}'::jsonb)
    - 'approval_status' - 'approval_revision' - 'proposed_by' - 'proposed_at'
    - 'decided_by' - 'decided_at' - 'decision_note';
  v_requested_approval_status text := nullif(p_task_insert->>'approval_status', '');
begin
  perform set_config('app.actor_profile_id', coalesce(p_actor_profile_id, ''), true);
  v_result := public.create_task_transaction(
    v_clean_insert,
    p_relation_type,
    p_related_task_id,
    p_relation_note,
    p_activity_message,
    p_relation_activity_message,
    p_notifications,
    p_actor_profile_id,
    p_request_ip,
    p_user_agent
  );
  v_task := v_result->'task';

  if coalesce((v_result->>'replayed')::boolean, false) = false
     and v_task->>'task_type' = 'deliverable' then
    if p_approve_now then
      v_task := (public.decide_planning_item_approval_transaction(
        v_task->>'id',
        coalesce((v_task->>'approval_revision')::integer, 1),
        'approve',
        p_actor_profile_id,
        'Bei Erstellung durch CEO freigegeben.'
      )->'task');
    elsif v_requested_approval_status <> 'approved' or v_requested_approval_status is null then
      update public.tasks
      set proposed_by = coalesce(nullif(p_task_insert->>'proposed_by', ''), p_actor_profile_id),
          proposed_at = coalesce((p_task_insert->>'proposed_at')::timestamptz, proposed_at, now())
      where id = v_task->>'id'
      returning to_jsonb(tasks) into v_task;
    else
      raise exception using errcode = '22023', message = 'deliverable approval requires an explicit approval decision';
    end if;
    v_result := jsonb_set(v_result, '{task}', v_task);
  end if;

  return v_result;
end;
$$;

revoke all on function public.replace_planning_item_raci_assignments(text, jsonb) from public;
revoke all on function public.create_planning_item_transaction(jsonb, jsonb, jsonb, text) from public;
revoke all on function public.update_planning_item_transaction(text, timestamptz, jsonb, jsonb, jsonb, text) from public;
revoke all on function public.reparent_planning_item_transaction(text, timestamptz, text, text) from public;
revoke all on function public.decide_planning_item_approval_transaction(text, integer, text, text, text) from public;
grant all on function public.replace_planning_item_raci_assignments(text, jsonb) to service_role;
grant all on function public.create_planning_item_transaction(jsonb, jsonb, jsonb, text) to service_role;
grant all on function public.update_planning_item_transaction(text, timestamptz, jsonb, jsonb, jsonb, text) to service_role;
grant all on function public.reparent_planning_item_transaction(text, timestamptz, text, text) to service_role;
grant all on function public.decide_planning_item_approval_transaction(text, integer, text, text, text) to service_role;
revoke all on function public.create_planning_task_transaction(jsonb, text, text, text, text, text, jsonb, text, text, text, boolean) from public;
grant all on function public.create_planning_task_transaction(jsonb, text, text, text, text, text, jsonb, text, text, text, boolean) to service_role;

revoke all on function public.create_task_comment_local(text, text, text) from public;
grant all on function public.create_task_comment_local(text, text, text) to service_role;

-- The original trash implementation rooted Initiative trees in packages.
-- Active planning now roots both Initiative and Deliverable trees in tasks,
-- while retained package rows remain recovery evidence only.
create or replace function public.trash_planning_item_tree_transaction(
  p_root_type text,
  p_root_id text,
  p_expected_revision integer,
  p_actor_profile_id text,
  p_reason text,
  p_cause text,
  p_request_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor_role text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_root public.tasks%rowtype;
  v_updated_root public.tasks%rowtype;
  v_task_ids text[] := array[]::text[];
  v_trash_revision integer;
  v_trashed_at timestamptz := clock_timestamp();
begin
  if p_root_type not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_root_id, '')), '') is null
     or p_expected_revision is null
     or p_expected_revision < 1
     or p_cause not in ('withdrawn', 'rejected')
     or v_reason is null
     or char_length(v_reason) > 2000 then
    raise exception using errcode = '22023', message = 'planning trash input is invalid';
  end if;

  select platform_role into v_actor_role
  from public.profiles
  where id = p_actor_profile_id
  for share;
  if not found then
    raise exception using errcode = 'P0006', message = 'planning trash actor not found';
  end if;

  select * into v_root
  from public.tasks
  where id = p_root_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_root.task_type <> p_root_type then
    raise exception using errcode = '22023', message = 'planning trash root type is invalid';
  end if;
  if v_root.trashed_at is not null then
    raise exception using errcode = 'P0003', message = 'planning item is already trashed';
  end if;
  if v_root.approval_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'planning approval revision changed';
  end if;
  if p_cause = 'withdrawn' then
    if v_root.approval_status not in ('draft', 'proposed') then
      raise exception using errcode = 'P0003', message = 'only draft or proposed planning items may be withdrawn';
    end if;
    if v_actor_role not in ('ceo', 'deputy')
       and coalesce(v_root.proposed_by, '') <> p_actor_profile_id then
      raise exception using errcode = 'P0006', message = 'planning item withdrawal requires proposer or operational lead';
    end if;
  else
    if v_root.approval_status <> 'proposed' then
      raise exception using errcode = 'P0003', message = 'only proposed planning items may be rejected';
    end if;
    if v_actor_role not in ('ceo', 'deputy') then
      raise exception using errcode = 'P0006', message = 'only ceo or deputy may reject planning items';
    end if;
  end if;

  with recursive planning_tree as (
    select task.id
    from public.tasks task
    where task.id = p_root_id
    union all
    select child.id
    from public.tasks child
    join planning_tree parent on child.parent_task_id = parent.id
    where child.trashed_at is null
  )
  select coalesce(array_agg(id order by id), array[]::text[])
  into v_task_ids
  from planning_tree;

  perform id
  from public.tasks
  where id = any(v_task_ids)
  order by id
  for update;

  v_trash_revision := v_root.trash_revision + 1;
  perform set_config('founderops.trash_lifecycle_write', 'on', true);

  update public.tasks
  set approval_status = case
        when id = p_root_id and p_cause = 'rejected' then 'rejected'
        else approval_status
      end,
      approval_revision = case
        when id = p_root_id and p_cause = 'rejected' then approval_revision + 1
        else approval_revision
      end,
      decided_by = case when id = p_root_id and p_cause = 'rejected' then p_actor_profile_id else decided_by end,
      decided_at = case when id = p_root_id and p_cause = 'rejected' then v_trashed_at else decided_at end,
      decision_note = case when id = p_root_id and p_cause = 'rejected' then v_reason else decision_note end,
      sprint_id = case when task_type = 'deliverable' then null else sprint_id end,
      review_status = case when task_type = 'deliverable' then 'not_requested' else review_status end,
      review_owner_profile_id = case when task_type = 'deliverable' then null else review_owner_profile_id end,
      review_requested_at = case when task_type = 'deliverable' then null else review_requested_at end,
      score_points = case when task_type = 'deliverable' then 0 else score_points end,
      score_final = case when task_type = 'deliverable' then false else score_final end,
      score_relevant = false,
      trashed_at = v_trashed_at,
      trashed_by = p_actor_profile_id,
      trash_reason = v_reason,
      trash_cause = p_cause,
      purge_after = v_trashed_at + interval '90 days',
      trash_root_type = p_root_type,
      trash_root_id = p_root_id,
      trash_revision = v_trash_revision,
      updated_at = clock_timestamp()
  where id = any(v_task_ids)
    and trashed_at is null
    and id <> p_root_id;

  update public.tasks
  set approval_status = case when p_cause = 'rejected' then 'rejected' else approval_status end,
      approval_revision = case when p_cause = 'rejected' then approval_revision + 1 else approval_revision end,
      decided_by = case when p_cause = 'rejected' then p_actor_profile_id else decided_by end,
      decided_at = case when p_cause = 'rejected' then v_trashed_at else decided_at end,
      decision_note = case when p_cause = 'rejected' then v_reason else decision_note end,
      sprint_id = case when task_type = 'deliverable' then null else sprint_id end,
      review_status = case when task_type = 'deliverable' then 'not_requested' else review_status end,
      review_owner_profile_id = case when task_type = 'deliverable' then null else review_owner_profile_id end,
      review_requested_at = case when task_type = 'deliverable' then null else review_requested_at end,
      score_points = case when task_type = 'deliverable' then 0 else score_points end,
      score_final = case when task_type = 'deliverable' then false else score_final end,
      score_relevant = false,
      trashed_at = v_trashed_at,
      trashed_by = p_actor_profile_id,
      trash_reason = v_reason,
      trash_cause = p_cause,
      purge_after = v_trashed_at + interval '90 days',
      trash_root_type = p_root_type,
      trash_root_id = p_root_id,
      trash_revision = v_trash_revision,
      updated_at = clock_timestamp()
  where id = p_root_id
  returning * into v_updated_root;

  insert into public.planning_github_lifecycle_outbox (
    root_type, root_id, root_trash_revision, task_id, github_repo,
    github_issue_number, action, source_type, source_revision, reason,
    status, status_reason, last_error
  )
  select
    p_root_type,
    p_root_id,
    v_trash_revision,
    task.id,
    issue_reference.normalized_repo,
    issue_reference.normalized_issue_number,
    'close_not_planned',
    p_cause,
    v_trash_revision,
    v_reason,
    case when issue_reference.reference_status = 'invalid' then 'failed' else 'pending' end,
    case when issue_reference.reference_status = 'invalid' then 'invalid_issue_reference' end,
    case when issue_reference.reference_status = 'invalid' then issue_reference.error_message end
  from public.tasks task
  cross join lateral public.normalize_planning_github_issue_reference(
    task.task_type,
    task.github_repo,
    task.github_issue_number,
    task.issue_number,
    task.github_issue_url,
    task.issue_url
  ) issue_reference
  where task.id = any(v_task_ids)
    and task.task_type in ('deliverable', 'sub_issue')
  on conflict (root_type, root_id, root_trash_revision, task_id, action) do nothing;

  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  insert into public.task_activity (task_id, message)
  values (
    p_root_id,
    case p_cause
      when 'rejected' then case when p_root_type = 'initiative' then 'Initiative abgelehnt und in den Papierkorb verschoben' else 'Deliverable abgelehnt und in den Papierkorb verschoben' end
      else case when p_root_type = 'initiative' then 'Initiative zurückgezogen' else 'Deliverable zurückgezogen' end
    end || ' · Begründung: ' || v_reason
  );
  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id, before_data, after_data, request_ip, user_agent
  ) values (
    p_actor_profile_id,
    case when p_cause = 'rejected' then 'planning_item.rejected' else 'planning_item.withdrawn' end,
    'task',
    p_root_id,
    jsonb_build_object('approvalStatus', v_root.approval_status, 'approvalRevision', v_root.approval_revision),
    jsonb_build_object('trashRevision', v_trash_revision, 'affectedTaskIds', to_jsonb(v_task_ids)),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'rootType', p_root_type,
    'rootId', p_root_id,
    'affectedTaskIds', to_jsonb(v_task_ids),
    'trashRevision', v_trash_revision,
    'item', to_jsonb(v_updated_root),
    'eventIds', '[]'::jsonb
  );
end;
$$;

create or replace function public.restore_planning_item_transaction(
  p_root_type text,
  p_root_id text,
  p_expected_trash_revision integer,
  p_actor_profile_id text,
  p_request_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor_role text;
  v_root public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_updated_root public.tasks%rowtype;
  v_task_ids text[] := array[]::text[];
begin
  if p_root_type not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_root_id, '')), '') is null
     or p_expected_trash_revision is null
     or p_expected_trash_revision < 1 then
    raise exception using errcode = '22023', message = 'planning restore input is invalid';
  end if;
  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id for share;
  if not found or v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'planning restore requires operational lead';
  end if;

  select * into v_root from public.tasks where id = p_root_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_root.task_type <> p_root_type
     or v_root.trashed_at is null
     or v_root.trash_root_type <> p_root_type
     or v_root.trash_root_id <> p_root_id then
    raise exception using errcode = 'P0003', message = 'planning item is not a trash root';
  end if;
  if v_root.trash_revision <> p_expected_trash_revision then
    raise exception using errcode = 'P0001', message = 'planning trash revision changed';
  end if;
  if v_root.parent_task_id is not null then
    select * into v_parent from public.tasks where id = v_root.parent_task_id for share;
    if not found or v_parent.trashed_at is not null then
      raise exception using errcode = 'P0003', message = 'parent planning item must be restored first';
    end if;
  end if;

  select coalesce(array_agg(id order by id), array[]::text[])
  into v_task_ids
  from public.tasks
  where trash_root_type = p_root_type
    and trash_root_id = p_root_id
    and trash_revision = p_expected_trash_revision
    and trashed_at is not null;
  perform id from public.tasks where id = any(v_task_ids) order by id for update;
  perform set_config('founderops.trash_lifecycle_write', 'on', true);

  update public.tasks
  set approval_status = case when task_type in ('initiative', 'deliverable') then 'proposed' else null end,
      approval_revision = case when task_type in ('initiative', 'deliverable') then approval_revision + 1 else approval_revision end,
      proposed_by = case when task_type in ('initiative', 'deliverable') then p_actor_profile_id else proposed_by end,
      proposed_at = case when task_type in ('initiative', 'deliverable') then clock_timestamp() else proposed_at end,
      decided_by = null,
      decided_at = null,
      decision_note = null,
      sprint_id = case when task_type = 'deliverable' then null else sprint_id end,
      review_status = case when task_type = 'deliverable' then 'not_requested' else review_status end,
      review_owner_profile_id = case when task_type = 'deliverable' then null else review_owner_profile_id end,
      review_requested_at = case when task_type = 'deliverable' then null else review_requested_at end,
      score_points = case when task_type = 'deliverable' then 0 else score_points end,
      score_final = case when task_type = 'deliverable' then false else score_final end,
      score_relevant = false,
      trashed_at = null,
      trashed_by = null,
      trash_reason = null,
      trash_cause = null,
      purge_after = null,
      trash_root_type = null,
      trash_root_id = null,
      updated_at = clock_timestamp()
  where id = any(v_task_ids);

  select * into v_updated_root from public.tasks where id = p_root_id;
  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  insert into public.task_activity (task_id, message)
  values (p_root_id, case when p_root_type = 'initiative' then 'Initiative aus dem Papierkorb wiederhergestellt · erneut vorgeschlagen' else 'Deliverable aus dem Papierkorb wiederhergestellt · erneut vorgeschlagen' end);
  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id, before_data, after_data, request_ip, user_agent
  ) values (
    p_actor_profile_id,
    'planning_item.restored',
    'task',
    p_root_id,
    jsonb_build_object('trashRevision', p_expected_trash_revision),
    jsonb_build_object('affectedTaskIds', to_jsonb(v_task_ids), 'approvalStatus', v_updated_root.approval_status),
    p_request_ip,
    p_user_agent
  );
  return jsonb_build_object(
    'rootType', p_root_type,
    'rootId', p_root_id,
    'affectedTaskIds', to_jsonb(v_task_ids),
    'trashRevision', p_expected_trash_revision,
    'item', to_jsonb(v_updated_root),
    'eventIds', '[]'::jsonb
  );
end;
$$;

revoke all on function public.trash_planning_item_tree_transaction(text, text, integer, text, text, text, text, text) from public;
revoke all on function public.withdraw_planning_item_transaction(text, text, integer, text, text, text, text) from public;
revoke all on function public.restore_planning_item_transaction(text, text, integer, text, text, text) from public;
grant all on function public.trash_planning_item_tree_transaction(text, text, integer, text, text, text, text, text) to service_role;
grant all on function public.withdraw_planning_item_transaction(text, text, integer, text, text, text, text) to service_role;
grant all on function public.restore_planning_item_transaction(text, text, integer, text, text, text) to service_role;

-- The external Planning Items API retains its token and idempotency contract,
-- but writes only canonical tasks. `milestone` is accepted as a short-lived
-- input alias and is normalized to `epic` before any record is created.
alter table public.team_planning_item_update_requests
  drop constraint if exists team_planning_item_update_requests_item_type_check;
alter table public.team_planning_item_update_requests
  add constraint team_planning_item_update_requests_item_type_check
  check (item_type in ('epic', 'milestone', 'initiative', 'deliverable', 'sub_issue'));

create or replace function public.create_team_planning_items_transaction(
  p_token_id uuid,
  p_profile_id text,
  p_idempotency_key uuid,
  p_request_hash text,
  p_items jsonb,
  p_request_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_batch public.team_task_intake_batches%rowtype;
  v_role text;
  v_item jsonb;
  v_index integer;
  v_type text;
  v_id text;
  v_title text;
  v_owner text;
  v_parent_id text;
  v_parent public.tasks%rowtype;
  v_status text;
  v_sort_order integer;
  v_raci jsonb := '[]'::jsonb;
  v_result jsonb;
  v_entity jsonb;
  v_task_insert jsonb;
  v_ids text[] := array[]::text[];
  v_entities jsonb := '[]'::jsonb;
begin
  if p_token_id is null
     or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or p_idempotency_key is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$'
     or p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception using errcode = '22023', message = 'planning items create input is invalid';
  end if;

  select * into v_token
  from public.team_task_intake_tokens
  where id = p_token_id
    and profile_id = p_profile_id
    and revoked_at is null
    and expires_at > now()
  for update;
  if not found then raise exception using errcode = 'P0004', message = 'planning items token is inactive'; end if;
  if not ('write:planning-items:create' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning items create scope is missing';
  end if;

  select platform_role into v_role from public.profiles where id = p_profile_id for share;
  if not found or v_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'planning items profile role is not allowed';
  end if;
  if v_role not in ('ceo', 'deputy') and exists (
    select 1
    from jsonb_array_elements(p_items) item(value)
    where item.value->>'itemType' in ('epic', 'milestone', 'initiative')
  ) then
    raise exception using errcode = 'P0006', message = 'strategic planning item creation requires ceo or deputy';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('planning-items-create:' || p_token_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_batch
  from public.team_task_intake_batches
  where token_id = p_token_id and idempotency_key = p_idempotency_key;
  if found then
    if v_batch.request_hash <> p_request_hash then
      raise exception using errcode = 'P0003', message = 'idempotency key conflict';
    end if;
    return jsonb_build_object('batchId', v_batch.id, 'replayed', true, 'items', v_batch.response_tasks);
  end if;

  for v_item, v_index in
    select value, ordinality::integer from jsonb_array_elements(p_items) with ordinality
  loop
    v_type := case nullif(trim(v_item->>'itemType'), '') when 'milestone' then 'epic' else nullif(trim(v_item->>'itemType'), '') end;
    v_id := p_profile_id || '-planning-items-v1-' || replace(p_idempotency_key::text, '-', '') || '-' || v_index::text;
    v_title := nullif(trim(coalesce(v_item->>'title', '')), '');
    v_owner := nullif(trim(coalesce(v_item->>'ownerId', '')), '');
    v_parent_id := nullif(trim(coalesce(v_item->>'parentTaskId', '')), '');
    v_status := coalesce(nullif(trim(v_item->>'status'), ''), 'Offen');

    if v_type not in ('epic', 'initiative', 'deliverable', 'sub_issue')
       or v_title is null then
      raise exception using errcode = '22023', message = 'planning items item type or title is invalid';
    end if;
    if v_type in ('epic', 'initiative') and v_owner is null then
      raise exception using errcode = '22023', message = 'strategic planning item owner is required';
    end if;
    if v_owner is null then v_owner := p_profile_id; end if;
    if not exists (select 1 from public.profiles where id = v_owner) then
      raise exception using errcode = '23503', message = 'planning item owner was not found';
    end if;
    if (v_type in ('epic', 'initiative') and v_status not in ('Offen', 'In Arbeit', 'Pausiert', 'Blockiert', 'Erledigt'))
       or (v_type = 'deliverable' and v_status not in ('Offen', 'In Arbeit', 'Review', 'Nacharbeit', 'Blockiert', 'Erledigt'))
       or (v_type = 'sub_issue' and v_status not in ('Offen', 'In Arbeit', 'Blockiert', 'Erledigt')) then
      raise exception using errcode = '22023', message = 'planning item status is invalid';
    end if;
    if v_type in ('epic', 'initiative') and v_item ? 'githubSync' then
      raise exception using errcode = '22023', message = 'strategic planning items do not support GitHub sync';
    end if;

    if v_type = 'epic' and v_parent_id is not null then
      raise exception using errcode = '23514', message = 'epic cannot have a parent';
    end if;
    if v_type = 'initiative' and v_parent_id is not null then
      select * into v_parent from public.tasks where id = v_parent_id and trashed_at is null for share;
      if not found or v_parent.task_type <> 'epic' then
        raise exception using errcode = '23514', message = 'initiative parent must be an active epic';
      end if;
    end if;
    if v_type = 'deliverable' and v_parent_id is not null then
      select * into v_parent from public.tasks where id = v_parent_id and trashed_at is null for share;
      if not found or v_parent.task_type <> 'initiative' then
        raise exception using errcode = '23514', message = 'deliverable parent must be an active initiative';
      end if;
      if v_parent.approval_status = 'rejected' then
        raise exception using errcode = '23514', message = 'deliverable parent initiative is rejected';
      end if;
    end if;
    if v_type = 'sub_issue' then
      if v_parent_id is null then
        raise exception using errcode = '23514', message = 'sub-issue requires a deliverable parent';
      end if;
      select * into v_parent from public.tasks where id = v_parent_id and trashed_at is null for share;
      if not found or v_parent.task_type <> 'deliverable' or v_parent.approval_status <> 'approved' then
        raise exception using errcode = '23514', message = 'sub-issue parent must be an approved deliverable';
      end if;
    end if;

    perform pg_advisory_xact_lock(hashtextextended('planning-sort:' || v_type, 0));
    select coalesce(max(sort_order) + 1, 1) into v_sort_order
    from public.tasks
    where project_id = 'findmydoc-founder-execution'
      and task_type = v_type
      and trashed_at is null;

    if v_type in ('epic', 'initiative') then
      select coalesce(jsonb_agg(assignment order by assignment->>'role', (assignment->>'sortOrder')::integer), '[]'::jsonb)
      into v_raci
      from (
        select jsonb_build_object('profileId', nullif(v_item->>'accountableProfileId', ''), 'role', 'accountable', 'sortOrder', 0) as assignment
        where nullif(v_item->>'accountableProfileId', '') is not null
        union all
        select jsonb_build_object('profileId', value, 'role', 'responsible', 'sortOrder', ordinality::integer - 1)
        from jsonb_array_elements_text(coalesce(v_item->'responsibleProfileIds', '[]'::jsonb)) with ordinality
        union all
        select jsonb_build_object('profileId', value, 'role', 'consulted', 'sortOrder', ordinality::integer - 1)
        from jsonb_array_elements_text(coalesce(v_item->'consultedProfileIds', '[]'::jsonb)) with ordinality
        union all
        select jsonb_build_object('profileId', value, 'role', 'informed', 'sortOrder', ordinality::integer - 1)
        from jsonb_array_elements_text(coalesce(v_item->'informedProfileIds', '[]'::jsonb)) with ordinality
      ) assignments;
      v_result := public.create_planning_item_transaction(
        jsonb_build_object(
          'id', v_id,
          'project_id', 'findmydoc-founder-execution',
          'task_type', v_type,
          'title', v_title,
          'description', coalesce(v_item->>'description', ''),
          'status', v_status,
          'priority', case when v_type = 'initiative' then coalesce(nullif(v_item->>'priority', ''), 'P2') else null end,
          'owner', v_owner,
          'assignee', v_owner,
          'parent_task_id', v_parent_id,
          'target_date', nullif(v_item->>'targetDate', ''),
          'sort_order', v_sort_order
        ),
        case when v_type = 'initiative' then jsonb_build_object(
          'goal', coalesce(nullif(v_item->>'intendedOutcome', ''), v_item->>'description', ''),
          'successCriteria', coalesce(v_item->>'acceptanceCriteria', ''),
          'scopeConstraints', coalesce(v_item->>'scopeConstraints', '')
        ) else null end,
        case when v_type = 'initiative' then v_raci else '[]'::jsonb end,
        p_profile_id
      );
      v_entity := v_result->'task';
      if v_type = 'initiative' then
        v_entity := v_entity || jsonb_build_object(
          'goal', coalesce(nullif(v_item->>'intendedOutcome', ''), v_item->>'description', ''),
          'success_criteria', coalesce(v_item->>'acceptanceCriteria', ''),
          'scope_constraints', coalesce(v_item->>'scopeConstraints', ''),
          'raci_assignments', v_raci
        );
      end if;
    else
      v_task_insert := jsonb_build_object(
        'id', v_id,
        'creation_request_id', 'planning-items:' || p_token_id::text || ':' || p_idempotency_key::text || ':' || v_index::text,
        'project_id', 'findmydoc-founder-execution',
        'title', v_title,
        'description', coalesce(v_item->>'description', ''),
        'problem_statement', coalesce(v_item->>'problemStatement', ''),
        'intended_outcome', coalesce(v_item->>'intendedOutcome', ''),
        'scope_constraints', coalesce(v_item->>'scopeConstraints', ''),
        'acceptance_criteria', coalesce(v_item->>'acceptanceCriteria', ''),
        'evidence_required', coalesce(v_item->>'evidenceRequired', ''),
        'definition_of_done', coalesce(v_item->>'definitionOfDone', ''),
        'status', v_status,
        'priority', case when v_type = 'sub_issue' then 'P2' else coalesce(nullif(v_item->>'priority', ''), 'P2') end,
        'owner', v_owner,
        'assignee', v_owner,
        'created_by', p_profile_id,
        'workstream', coalesce(v_item->>'workstream', ''),
        'sort_order', v_sort_order,
        'start_date', nullif(v_item->>'startDate', ''),
        'end_date', nullif(v_item->>'endDate', ''),
        'deadline', nullif(v_item->>'deadline', ''),
        'estimate_hours', case when coalesce(v_item->>'hours', '') ~ '^[0-9]+$' then (v_item->>'hours')::integer else 0 end,
        'sprint_id', null,
        'review_status', 'not_requested',
        'score_points', 0,
        'score_final', false,
        'github_repo', coalesce(nullif(v_item->>'githubRepo', ''), 'findmydoc-platform/management'),
        'task_type', v_type,
        'parent_task_id', v_parent_id,
        'approval_status', case when v_type = 'deliverable' then 'proposed' else null end,
        'approval_revision', 1,
        'proposed_by', case when v_type = 'deliverable' then p_profile_id else null end,
        'proposed_at', case when v_type = 'deliverable' then now() else null end,
        'score_relevant', false
      );
      v_result := public.create_planning_task_transaction(
        v_task_insert, null, null, null,
        case when v_type = 'sub_issue' then 'Sub-Issue created through Planning Items API' else 'Deliverable proposed through Planning Items API' end,
        null, '[]'::jsonb, p_profile_id, p_request_ip, p_user_agent, false
      );
      v_entity := v_result->'task';
    end if;

    v_ids := array_append(v_ids, v_id);
    v_entities := v_entities || jsonb_build_array(jsonb_build_object('itemType', v_type, 'item', v_entity));
  end loop;

  insert into public.team_task_intake_batches (token_id, profile_id, idempotency_key, request_hash, task_ids, response_tasks)
  values (p_token_id, p_profile_id, p_idempotency_key, p_request_hash, v_ids, v_entities)
  returning * into v_batch;
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, after_data, request_ip, user_agent)
  values (p_profile_id, 'team.planning_items.create', 'team_planning_items_batch', v_batch.id::text,
    jsonb_build_object('tokenId', p_token_id, 'entityIds', v_ids), p_request_ip, p_user_agent);
  return jsonb_build_object('batchId', v_batch.id, 'replayed', false, 'items', v_entities);
end;
$$;

create or replace function public.update_team_planning_item_transaction(
  p_token_id uuid,
  p_profile_id text,
  p_item_type text,
  p_item_id text,
  p_expected_updated_at timestamptz,
  p_idempotency_key uuid,
  p_request_hash text,
  p_patch jsonb default '{}'::jsonb,
  p_changed_fields jsonb default '[]'::jsonb,
  p_system_effects jsonb default '[]'::jsonb,
  p_request_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_request public.team_planning_item_update_requests%rowtype;
  v_role text;
  v_type text := case nullif(trim(coalesce(p_item_type, '')), '') when 'milestone' then 'epic' else nullif(trim(coalesce(p_item_type, '')), '') end;
  v_task public.tasks%rowtype;
  v_updated_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_review_owner text;
  v_review_owner_role text;
  v_review_status text;
  v_review_requested_at timestamptz;
  v_score_points integer;
  v_score_final boolean;
  v_sprint_locked boolean := false;
  v_parent_review_locked boolean := false;
  v_review_request_started boolean := false;
  v_response jsonb;
  v_before jsonb;
  v_strategy jsonb;
  v_raci jsonb;
  v_allowed text[];
  v_status text;
begin
  if p_token_id is null
     or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or v_type not in ('epic', 'initiative', 'deliverable', 'sub_issue')
     or nullif(trim(coalesce(p_item_id, '')), '') is null
     or p_expected_updated_at is null
     or p_idempotency_key is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_changed_fields, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_system_effects, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'planning items update input is invalid';
  end if;

  select * into v_token from public.team_task_intake_tokens
  where id = p_token_id and profile_id = p_profile_id and revoked_at is null and expires_at > now()
  for update;
  if not found then raise exception using errcode = 'P0004', message = 'planning items token is inactive'; end if;
  if not ('write:planning-items:update' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning items update scope is missing';
  end if;
  select platform_role into v_role from public.profiles where id = p_profile_id for share;
  if not found or v_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'planning items profile role is not allowed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('planning-items-update:' || p_token_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_request from public.team_planning_item_update_requests
  where token_id = p_token_id and idempotency_key = p_idempotency_key;
  if found then
    if v_request.request_hash <> p_request_hash then
      raise exception using errcode = 'P0003', message = 'idempotency key conflict';
    end if;
    return jsonb_set(v_request.response, '{replayed}', 'true'::jsonb, true);
  end if;

  select * into v_task from public.tasks
  where id = p_item_id and project_id = 'findmydoc-founder-execution' and trashed_at is null
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  if v_task.task_type <> v_type then raise exception using errcode = '22023', message = 'planning item type does not match'; end if;
  if v_task.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;
  if v_type = 'epic' and v_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'epic update requires ceo or deputy';
  end if;
  if v_role = 'founder' and v_type = 'initiative' and v_task.owner <> p_profile_id then
    raise exception using errcode = 'P0007', message = 'founder may only update owned initiatives';
  end if;
  if v_role = 'founder' and v_type in ('deliverable', 'sub_issue')
     and v_task.owner <> p_profile_id and v_task.assignee <> p_profile_id
     and not (v_type = 'sub_issue' and p_patch ? 'status' and p_patch - 'status' = '{}'::jsonb) then
    raise exception using errcode = 'P0007', message = 'founder may only update owned planning tasks';
  end if;

  v_allowed := case v_type
    when 'epic' then array['title', 'description', 'status', 'target_date']
    when 'initiative' then array['title', 'description', 'status', 'priority', 'owner', 'assignee', 'target_date', 'parent_task_id', 'strategy', 'raciAssignments']
    when 'deliverable' then array['title', 'description', 'status', 'priority', 'owner', 'assignee', 'parent_task_id', 'workstream', 'start_date', 'end_date', 'deadline', 'estimate_hours', 'problem_statement', 'intended_outcome', 'scope_constraints', 'acceptance_criteria', 'evidence_required', 'definition_of_done']
    else array['title', 'description', 'status', 'owner', 'assignee', 'parent_task_id', 'problem_statement', 'intended_outcome', 'scope_constraints', 'acceptance_criteria', 'evidence_required', 'definition_of_done', 'github_repo']
  end;
  if exists (select 1 from jsonb_object_keys(p_patch) key where not (key = any(v_allowed))) then
    raise exception using errcode = '22023', message = 'planning item patch contains an unsupported field';
  end if;
  if v_type in ('deliverable', 'sub_issue') and p_patch ? 'parent_task_id'
     and (select count(*) from jsonb_object_keys(p_patch)) > 1 then
    raise exception using errcode = '23514', message = 'planning item parent must be changed separately';
  end if;
  if p_patch ? 'status' then
    v_status := nullif(trim(p_patch->>'status'), '');
    if (v_type in ('epic', 'initiative') and v_status not in ('Offen', 'In Arbeit', 'Pausiert', 'Blockiert', 'Erledigt'))
       or (v_type = 'deliverable' and v_status not in ('Offen', 'In Arbeit', 'Review', 'Nacharbeit', 'Blockiert', 'Erledigt'))
       or (v_type = 'sub_issue' and v_status not in ('Offen', 'In Arbeit', 'Blockiert', 'Erledigt')) then
      raise exception using errcode = '22023', message = 'planning item status is invalid';
    end if;
    if v_status is distinct from v_task.status and v_type = 'deliverable' then
      if v_status = 'Erledigt' and v_role <> 'ceo' then
        raise exception using errcode = 'P0007', message = 'only ceo may complete a deliverable finally';
      end if;
      if v_task.status = 'Erledigt' and v_status <> 'Erledigt' and v_role <> 'ceo' then
        raise exception using errcode = 'P0007', message = 'only ceo may reopen a completed deliverable';
      end if;
      if v_role = 'founder' and v_task.status = 'Nacharbeit' and v_status not in ('In Arbeit', 'Review', 'Blockiert') then
        raise exception using errcode = 'P0007', message = 'founder may only resume, block, or review rework';
      end if;
    end if;
  end if;
  if p_patch ? 'parent_task_id' and nullif(trim(coalesce(p_patch->>'parent_task_id', '')), '') is not null then
    select * into v_parent from public.tasks where id = nullif(trim(p_patch->>'parent_task_id'), '') and trashed_at is null for share;
    if not found
       or (v_type = 'initiative' and v_parent.task_type <> 'epic')
       or (v_type = 'deliverable' and (v_parent.task_type <> 'initiative' or v_parent.approval_status = 'rejected'))
       or (v_type = 'sub_issue' and (v_parent.task_type <> 'deliverable' or v_parent.approval_status <> 'approved')) then
      raise exception using errcode = '23514', message = 'planning item parent has the wrong type or approval state';
    end if;
  elsif v_type = 'sub_issue' and p_patch ? 'parent_task_id' then
    raise exception using errcode = '23514', message = 'sub-issue requires a deliverable parent';
  end if;

  if v_type = 'sub_issue' then
    select * into v_parent
    from public.tasks
    where id = coalesce(nullif(trim(coalesce(p_patch->>'parent_task_id', '')), ''), v_task.parent_task_id)
      and trashed_at is null
    for share;
    if not found or v_parent.task_type <> 'deliverable' or v_parent.approval_status <> 'approved' then
      raise exception using errcode = 'P0008', message = 'sub-issue parent must be an approved deliverable';
    end if;
    v_parent_review_locked := (v_parent.review_status = 'requested' and not coalesce(v_parent.score_final, false))
      or (v_parent.review_status = 'accepted' and coalesce(v_parent.score_final, false));
    if v_parent_review_locked and p_patch <> '{}'::jsonb then
      raise exception using errcode = '23514', message = 'parent deliverable review is locked';
    end if;
  end if;

  if v_type = 'deliverable'
     and p_patch <> '{}'::jsonb
     and ((v_task.review_status = 'requested' and not coalesce(v_task.score_final, false))
       or (v_task.review_status = 'accepted' and coalesce(v_task.score_final, false))) then
    raise exception using errcode = '23514', message = 'deliverable review is locked';
  end if;

  v_review_owner := v_task.review_owner_profile_id;
  v_review_status := v_task.review_status;
  v_review_requested_at := v_task.review_requested_at;
  v_score_points := v_task.score_points;
  v_score_final := v_task.score_final;
  if v_type = 'deliverable' and p_patch ? 'status' and p_patch->>'status' = 'Review' then
    if v_task.approval_status <> 'approved' then
      raise exception using errcode = '23514', message = 'only approved deliverables can enter review';
    end if;
    if v_task.score_final then
      raise exception using errcode = '23514', message = 'final deliverable must use review reopen';
    end if;
    if v_task.sprint_id is not null then
      select coalesce(score_locked, false) into v_sprint_locked from public.sprints where id = v_task.sprint_id;
      if v_sprint_locked then
        raise exception using errcode = '23514', message = 'sprint score is locked';
      end if;
    end if;
    if v_review_owner is null and v_task.parent_task_id is not null then
      select profile_id into v_review_owner
      from public.planning_item_raci_assignments
      where task_id = v_task.parent_task_id and role = 'accountable'
      order by sort_order, profile_id
      limit 1;
    end if;
    if v_review_owner is null and v_task.parent_task_id is not null then
      select owner into v_review_owner from public.tasks where id = v_task.parent_task_id;
    end if;
    if v_review_owner is null then
      raise exception using errcode = '23514', message = 'review owner is required';
    end if;
    select platform_role into v_review_owner_role from public.profiles where id = v_review_owner for share;
    if v_review_owner_role is null or v_review_owner_role = 'viewer' then
      raise exception using errcode = '23514', message = 'review owner must have a contributor role';
    end if;
    v_review_status := 'requested';
    v_review_requested_at := clock_timestamp();
    v_score_points := 0;
    v_score_final := false;
    v_review_request_started := true;
  elsif v_type = 'deliverable' and p_patch ? 'status' and v_task.status = 'Erledigt' and p_patch->>'status' <> 'Erledigt' then
    v_review_status := 'not_requested';
    v_review_requested_at := null;
    v_score_final := false;
  elsif v_type = 'deliverable' and p_patch ? 'status' and v_task.status = 'Review' and p_patch->>'status' <> 'Review' then
    v_review_status := 'not_requested';
    v_review_requested_at := null;
  end if;

  v_before := to_jsonb(v_task);
  perform set_config('app.actor_profile_id', p_profile_id, true);
  if p_patch <> '{}'::jsonb then
    update public.tasks
    set title = case when p_patch ? 'title' then nullif(trim(p_patch->>'title'), '') else v_task.title end,
        description = case when p_patch ? 'description' then nullif(trim(coalesce(p_patch->>'description', '')), '') else v_task.description end,
        status = case when p_patch ? 'status' then nullif(trim(p_patch->>'status'), '') else v_task.status end,
        priority = case when v_type = 'epic' then null when p_patch ? 'priority' then nullif(trim(p_patch->>'priority'), '') else v_task.priority end,
        owner = case when p_patch ? 'owner' then nullif(trim(p_patch->>'owner'), '') else v_task.owner end,
        assignee = case when p_patch ? 'assignee' then nullif(trim(p_patch->>'assignee'), '') else v_task.assignee end,
        target_date = case when p_patch ? 'target_date' then nullif(trim(coalesce(p_patch->>'target_date', '')), '')::date else v_task.target_date end,
        parent_task_id = case when p_patch ? 'parent_task_id' then nullif(trim(coalesce(p_patch->>'parent_task_id', '')), '') else v_task.parent_task_id end,
        workstream = case when p_patch ? 'workstream' then nullif(trim(coalesce(p_patch->>'workstream', '')), '') else v_task.workstream end,
        start_date = case when p_patch ? 'start_date' then nullif(trim(coalesce(p_patch->>'start_date', '')), '')::date else v_task.start_date end,
        end_date = case when p_patch ? 'end_date' then nullif(trim(coalesce(p_patch->>'end_date', '')), '')::date else v_task.end_date end,
        deadline = case when p_patch ? 'deadline' then nullif(trim(coalesce(p_patch->>'deadline', '')), '') else v_task.deadline end,
        estimate_hours = case when p_patch ? 'estimate_hours' then coalesce((p_patch->>'estimate_hours')::integer, 0) else v_task.estimate_hours end,
        problem_statement = case when p_patch ? 'problem_statement' then nullif(trim(coalesce(p_patch->>'problem_statement', '')), '') else v_task.problem_statement end,
        intended_outcome = case when p_patch ? 'intended_outcome' then nullif(trim(coalesce(p_patch->>'intended_outcome', '')), '') else v_task.intended_outcome end,
        scope_constraints = case when p_patch ? 'scope_constraints' then nullif(trim(coalesce(p_patch->>'scope_constraints', '')), '') else v_task.scope_constraints end,
        acceptance_criteria = case when p_patch ? 'acceptance_criteria' then nullif(trim(coalesce(p_patch->>'acceptance_criteria', '')), '') else v_task.acceptance_criteria end,
        evidence_required = case when p_patch ? 'evidence_required' then nullif(trim(coalesce(p_patch->>'evidence_required', '')), '') else v_task.evidence_required end,
        definition_of_done = case when p_patch ? 'definition_of_done' then nullif(trim(coalesce(p_patch->>'definition_of_done', '')), '') else v_task.definition_of_done end,
        github_repo = case when p_patch ? 'github_repo' then nullif(trim(coalesce(p_patch->>'github_repo', '')), '') else v_task.github_repo end,
        review_status = v_review_status,
        review_owner_profile_id = v_review_owner,
        review_requested_at = v_review_requested_at,
        score_points = v_score_points,
        score_final = v_score_final,
        github_issue_sync_status = case when v_type in ('deliverable', 'sub_issue') then 'not_synced' else v_task.github_issue_sync_status end,
        github_issue_sync_error = case when v_type in ('deliverable', 'sub_issue') then null else v_task.github_issue_sync_error end,
        updated_at = clock_timestamp()
    where id = p_item_id
    returning * into v_updated_task;
  else
    v_updated_task := v_task;
  end if;

  if v_type = 'initiative' and p_patch ? 'strategy' then
    if jsonb_typeof(p_patch->'strategy') <> 'object' then
      raise exception using errcode = '22023', message = 'initiative strategy is invalid';
    end if;
    insert into public.planning_item_strategy (task_id, goal, success_criteria, scope_constraints)
    values (p_item_id, coalesce(p_patch->'strategy'->>'goal', ''), coalesce(p_patch->'strategy'->>'successCriteria', ''), coalesce(p_patch->'strategy'->>'scopeConstraints', ''))
    on conflict (task_id) do update set
      goal = excluded.goal,
      success_criteria = excluded.success_criteria,
      scope_constraints = excluded.scope_constraints;
  end if;
  if v_type = 'initiative' and p_patch ? 'raciAssignments' then
    perform public.replace_planning_item_raci_assignments(p_item_id, p_patch->'raciAssignments');
  end if;

  if p_patch ? 'status' and v_updated_task.status is distinct from v_task.status then
    insert into public.task_activity (task_id, message)
    values (p_item_id, 'Status geändert: ' || v_task.status || ' → ' || v_updated_task.status);
  end if;
  if v_review_request_started then
    insert into public.notification_events (
      type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body, dedupe_key
    ) values (
      'task.review_requested', p_profile_id, v_review_owner, 'task', p_item_id,
      'Review angefragt: ' || v_updated_task.title,
      'Diese Aufgabe wartet auf deine Accountable-Review.',
      'team-planning-review:' || p_item_id || ':' || v_review_requested_at::text
    );
  end if;
  if v_type = 'initiative' then
    select jsonb_build_object('goal', goal, 'successCriteria', success_criteria, 'scopeConstraints', scope_constraints)
    into v_strategy from public.planning_item_strategy where task_id = p_item_id;
    select coalesce(jsonb_agg(jsonb_build_object('profileId', profile_id, 'role', role, 'sortOrder', sort_order) order by role, sort_order), '[]'::jsonb)
    into v_raci from public.planning_item_raci_assignments where task_id = p_item_id;
  end if;
  v_response := jsonb_build_object(
    'replayed', false,
    'itemType', v_type,
    'item', to_jsonb(v_updated_task)
      || case when v_type = 'initiative' then jsonb_build_object(
        'goal', coalesce(v_strategy->>'goal', ''),
        'success_criteria', coalesce(v_strategy->>'successCriteria', ''),
        'scope_constraints', coalesce(v_strategy->>'scopeConstraints', ''),
        'raci_assignments', coalesce(v_raci, '[]'::jsonb)
      ) else '{}'::jsonb end,
    'changedFields', coalesce(p_changed_fields, '[]'::jsonb),
    'systemEffects', coalesce(p_system_effects, '[]'::jsonb)
  );
  insert into public.team_planning_item_update_requests (token_id, profile_id, item_type, item_id, expected_updated_at, idempotency_key, request_hash, response)
  values (p_token_id, p_profile_id, v_type, p_item_id, p_expected_updated_at, p_idempotency_key, p_request_hash, v_response);
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data, request_ip, user_agent)
  values (p_profile_id, 'team.planning_items.update', 'task', p_item_id, v_before, v_response->'item', p_request_ip, p_user_agent);
  return v_response;
end;
$$;

create or replace function public.delete_team_planning_milestone_transaction(
  p_token_id uuid,
  p_profile_id text,
  p_milestone_id text,
  p_expected_updated_at timestamptz,
  p_idempotency_key uuid,
  p_request_hash text,
  p_request_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_request public.team_planning_milestone_delete_requests%rowtype;
  v_role text;
  v_epic public.tasks%rowtype;
  v_deleted public.tasks%rowtype;
  v_canonical_id text := p_milestone_id;
  v_legacy_task_id text;
  v_initiative_count bigint := 0;
  v_task_count bigint := 0;
  v_response jsonb;
begin
  if p_token_id is null or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or nullif(trim(coalesce(p_milestone_id, '')), '') is null or p_expected_updated_at is null
     or p_idempotency_key is null or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'epic delete input is invalid';
  end if;
  select * into v_token from public.team_task_intake_tokens
  where id = p_token_id and profile_id = p_profile_id and revoked_at is null and expires_at > now()
  for update;
  if not found then raise exception using errcode = 'P0004', message = 'planning items token is inactive'; end if;
  if not ('write:planning-items:delete-empty' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning items epic delete scope is missing';
  end if;
  select platform_role into v_role from public.profiles where id = p_profile_id for share;
  if not found or v_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'epic deletion requires ceo or deputy';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('planning-items-epic-delete:' || p_token_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_request from public.team_planning_milestone_delete_requests
  where token_id = p_token_id and idempotency_key = p_idempotency_key;
  if found then
    if v_request.request_hash <> p_request_hash or v_request.milestone_id <> p_milestone_id or v_request.expected_updated_at is distinct from p_expected_updated_at then
      raise exception using errcode = 'P0003', message = 'idempotency key conflict';
    end if;
    return jsonb_set(v_request.response, '{replayed}', 'true'::jsonb, true);
  end if;

  select task_id into v_legacy_task_id
  from public.planning_item_legacy_ids
  where source_kind = 'milestone' and legacy_id = p_milestone_id;
  if found then v_canonical_id := v_legacy_task_id; end if;
  select * into v_epic from public.tasks
  where id = v_canonical_id and project_id = 'findmydoc-founder-execution' and task_type = 'epic' and trashed_at is null
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  if v_epic.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;
  with recursive descendants as (
    select id, task_type from public.tasks where parent_task_id = v_canonical_id and trashed_at is null
    union all
    select child.id, child.task_type from public.tasks child join descendants parent on child.parent_task_id = parent.id where child.trashed_at is null
  )
  select count(*) filter (where task_type = 'initiative'), count(*) filter (where task_type in ('deliverable', 'sub_issue'))
  into v_initiative_count, v_task_count from descendants;
  if v_initiative_count > 0 or v_task_count > 0 then
    raise exception using errcode = 'P0008', message = 'epic is not empty', detail = jsonb_build_object(
      'children', jsonb_build_object('initiatives', v_initiative_count, 'tasks', v_task_count)
    )::text;
  end if;
  if exists (select 1 from public.planning_item_legacy_ids where task_id = v_canonical_id) then
    raise exception using errcode = 'P0008', message = 'epic retains legacy recovery mapping', detail = jsonb_build_object(
      'children', jsonb_build_object('initiatives', 0, 'tasks', 0)
    )::text;
  end if;
  perform set_config('founderops.trash_lifecycle_write', 'on', true);
  delete from public.tasks where id = v_canonical_id and updated_at = p_expected_updated_at returning * into v_deleted;
  if not found then raise exception using errcode = 'P0001', message = 'planning item was changed concurrently'; end if;
  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  v_response := jsonb_build_object('replayed', false, 'itemType', 'epic', 'item', to_jsonb(v_deleted), 'children', jsonb_build_object('initiatives', 0, 'tasks', 0));
  insert into public.team_planning_milestone_delete_requests (token_id, profile_id, milestone_id, expected_updated_at, idempotency_key, request_hash, response)
  values (p_token_id, p_profile_id, p_milestone_id, p_expected_updated_at, p_idempotency_key, p_request_hash, v_response);
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, request_ip, user_agent)
  values (p_profile_id, 'team.planning_items.epic_delete', 'task', v_canonical_id, to_jsonb(v_epic), p_request_ip, p_user_agent);
  return v_response;
end;
$$;

-- The old milestone endpoint remains a thin compatibility adapter. It can
-- remove only a newly-created, empty Epic; migrated rows retain their legacy
-- mapping as the lossless recovery record and therefore stay protected.
create or replace function public.delete_empty_epic_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_actor_profile_id text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
  v_epic public.tasks%rowtype;
  v_deleted public.tasks%rowtype;
  v_initiative_count bigint := 0;
  v_task_count bigint := 0;
begin
  if nullif(trim(coalesce(p_task_id, '')), '') is null
     or p_expected_updated_at is null
     or nullif(trim(coalesce(p_actor_profile_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'empty epic delete input is invalid';
  end if;

  select platform_role into v_role
  from public.profiles
  where id = p_actor_profile_id
  for share;
  if not found or v_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'empty epic deletion requires ceo or deputy';
  end if;

  select * into v_epic
  from public.tasks
  where id = p_task_id
    and project_id = 'findmydoc-founder-execution'
    and task_type = 'epic'
    and trashed_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_epic.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;

  with recursive descendants as (
    select id, task_type from public.tasks where parent_task_id = p_task_id and trashed_at is null
    union all
    select child.id, child.task_type
    from public.tasks child
    join descendants parent on child.parent_task_id = parent.id
    where child.trashed_at is null
  )
  select count(*) filter (where task_type = 'initiative'), count(*) filter (where task_type in ('deliverable', 'sub_issue'))
  into v_initiative_count, v_task_count
  from descendants;
  if v_initiative_count > 0 or v_task_count > 0 then
    raise exception using errcode = 'P0008', message = 'epic is not empty', detail = jsonb_build_object(
      'children', jsonb_build_object('initiatives', v_initiative_count, 'tasks', v_task_count)
    )::text;
  end if;
  if exists (select 1 from public.planning_item_legacy_ids where task_id = p_task_id) then
    raise exception using errcode = 'P0008', message = 'epic retains legacy recovery mapping', detail = jsonb_build_object(
      'children', jsonb_build_object('initiatives', 0, 'tasks', 0)
    )::text;
  end if;

  perform set_config('founderops.trash_lifecycle_write', 'on', true);
  delete from public.tasks
  where id = p_task_id and updated_at = p_expected_updated_at
  returning * into v_deleted;
  if not found then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;
  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  return jsonb_build_object('task', to_jsonb(v_deleted));
exception when others then
  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  raise;
end;
$$;

revoke all on function public.create_team_planning_items_transaction(uuid, text, uuid, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.update_team_planning_item_transaction(uuid, text, text, text, timestamptz, uuid, text, jsonb, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.delete_team_planning_milestone_transaction(uuid, text, text, timestamptz, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.delete_empty_epic_transaction(text, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.touch_planning_item_strategy_updated_at() from public, anon, authenticated;
revoke execute on function public.planning_legacy_item_id(text, text, text) from public, anon, authenticated;
revoke execute on function public.assert_github_delivery_task_capability() from public, anon, authenticated;
grant execute on function public.create_team_planning_items_transaction(uuid, text, uuid, text, jsonb, text, text) to service_role;
grant execute on function public.update_team_planning_item_transaction(uuid, text, text, text, timestamptz, uuid, text, jsonb, jsonb, jsonb, text, text) to service_role;
grant execute on function public.delete_team_planning_milestone_transaction(uuid, text, text, timestamptz, uuid, text, text, text) to service_role;
grant execute on function public.delete_empty_epic_transaction(text, timestamptz, text) to service_role;
