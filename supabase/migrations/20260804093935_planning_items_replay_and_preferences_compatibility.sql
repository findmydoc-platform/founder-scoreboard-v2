-- Distinguish immutable replay snapshots written before and after the unified
-- Planning Item contract. Existing rows retain their original wire shape;
-- newly inserted rows use the canonical v2 contract.
alter table public.team_task_intake_batches
  add column if not exists contract_version smallint not null default 1;
alter table public.team_planning_item_update_requests
  add column if not exists contract_version smallint not null default 1;
alter table public.team_planning_milestone_delete_requests
  add column if not exists contract_version smallint not null default 1;

alter table public.team_task_intake_batches
  alter column contract_version set default 2;
alter table public.team_planning_item_update_requests
  alter column contract_version set default 2;
alter table public.team_planning_milestone_delete_requests
  alter column contract_version set default 2;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'team_task_intake_batches_contract_version_check'
      and conrelid = 'public.team_task_intake_batches'::regclass
  ) then
    alter table public.team_task_intake_batches
      add constraint team_task_intake_batches_contract_version_check
      check (contract_version in (1, 2));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'team_planning_item_update_requests_contract_version_check'
      and conrelid = 'public.team_planning_item_update_requests'::regclass
  ) then
    alter table public.team_planning_item_update_requests
      add constraint team_planning_item_update_requests_contract_version_check
      check (contract_version in (1, 2));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'team_planning_milestone_delete_requests_contract_version_check'
      and conrelid = 'public.team_planning_milestone_delete_requests'::regclass
  ) then
    alter table public.team_planning_milestone_delete_requests
      add constraint team_planning_milestone_delete_requests_contract_version_check
      check (contract_version in (1, 2));
  end if;
end;
$$;

comment on column public.team_task_intake_batches.contract_version
is 'Wire-contract version of the immutable create replay snapshot.';
comment on column public.team_planning_item_update_requests.contract_version
is 'Wire-contract version of the immutable update replay snapshot.';
comment on column public.team_planning_milestone_delete_requests.contract_version
is 'Wire-contract version of the immutable delete replay snapshot.';

-- Translate only known legacy Package ids in persisted UI preferences. The
-- sentinel "Alle", unknown ids, and array order remain unchanged.
update public.profile_ui_preferences preference
set planning_filters = case
      when exists (
        select 1
        from public.planning_item_legacy_ids legacy
        where legacy.source_kind = 'package'
          and legacy.legacy_id = preference.planning_filters->>'packageId'
      ) then jsonb_set(
        preference.planning_filters,
        '{packageId}',
        to_jsonb((
          select legacy.task_id
          from public.planning_item_legacy_ids legacy
          where legacy.source_kind = 'package'
            and legacy.legacy_id = preference.planning_filters->>'packageId'
        )),
        true
      )
      else preference.planning_filters
    end,
    expanded_package_ids = array(
      select coalesce(legacy.task_id, expanded.package_id)
      from unnest(preference.expanded_package_ids) with ordinality as expanded(package_id, position)
      left join public.planning_item_legacy_ids legacy
        on legacy.source_kind = 'package'
       and legacy.legacy_id = expanded.package_id
      order by expanded.position
    )
where exists (
    select 1
    from public.planning_item_legacy_ids legacy
    where legacy.source_kind = 'package'
      and legacy.legacy_id = preference.planning_filters->>'packageId'
  )
  or exists (
    select 1
    from unnest(preference.expanded_package_ids) expanded(package_id)
    join public.planning_item_legacy_ids legacy
      on legacy.source_kind = 'package'
     and legacy.legacy_id = expanded.package_id
  );

do $$
begin
  if exists (
    select 1
    from public.profile_ui_preferences preference
    join public.planning_item_legacy_ids legacy
      on legacy.source_kind = 'package'
     and legacy.legacy_id = preference.planning_filters->>'packageId'
  ) or exists (
    select 1
    from public.profile_ui_preferences preference
    cross join lateral unnest(preference.expanded_package_ids) expanded(package_id)
    join public.planning_item_legacy_ids legacy
      on legacy.source_kind = 'package'
     and legacy.legacy_id = expanded.package_id
  ) then
    raise exception using errcode = '23514', message = 'planning preference package id migration verification failed';
  end if;
end;
$$;
