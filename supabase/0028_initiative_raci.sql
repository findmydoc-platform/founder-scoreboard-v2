alter table packages add column if not exists accountable_profile_id text references profiles(id) on delete set null;
alter table packages add column if not exists responsible_profile_ids text[] not null default '{}';
alter table packages add column if not exists consulted_profile_ids text[] not null default '{}';
alter table packages add column if not exists informed_profile_ids text[] not null default '{}';

update packages
set
  accountable_profile_id = coalesce(accountable_profile_id, owner_id),
  responsible_profile_ids = case
    when cardinality(responsible_profile_ids) = 0 and owner_id is not null then array[owner_id]
    else responsible_profile_ids
  end
where owner_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'packages_responsible_profile_ids_no_null'
  ) then
    alter table packages
      add constraint packages_responsible_profile_ids_no_null
      check (array_position(responsible_profile_ids, null) is null);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'packages_consulted_profile_ids_no_null'
  ) then
    alter table packages
      add constraint packages_consulted_profile_ids_no_null
      check (array_position(consulted_profile_ids, null) is null);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'packages_informed_profile_ids_no_null'
  ) then
    alter table packages
      add constraint packages_informed_profile_ids_no_null
      check (array_position(informed_profile_ids, null) is null);
  end if;
end $$;

create index if not exists packages_accountable_profile_id_idx on packages(accountable_profile_id);

comment on column packages.accountable_profile_id is 'Mini-RACI Accountable profile for the fachliche Initiative.';
comment on column packages.responsible_profile_ids is 'Mini-RACI Responsible profile IDs for the fachliche Initiative.';
comment on column packages.consulted_profile_ids is 'Mini-RACI Consulted profile IDs for the fachliche Initiative.';
comment on column packages.informed_profile_ids is 'Mini-RACI Informed profile IDs for the fachliche Initiative.';
