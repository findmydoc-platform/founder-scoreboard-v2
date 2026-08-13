-- The cutover is intentionally fail closed: every legacy hierarchy row must
-- have a field-complete canonical counterpart before any legacy object moves.
begin;

lock table public.milestones in access exclusive mode;
lock table public.packages in access exclusive mode;
lock table public.tasks in access exclusive mode;
lock table public.planning_item_legacy_ids in access exclusive mode;
lock table public.planning_item_strategy in share mode;
lock table public.planning_item_raci_assignments in share mode;
lock table public.profile_ui_preferences in access exclusive mode;
lock table public.team_planning_milestone_delete_requests in access exclusive mode;

create temporary table planning_cutover_preservation_evidence (
  dataset text primary key,
  row_count bigint not null,
  checksum text not null
) on commit drop;

create temporary table planning_cutover_source_columns (
  item_type text not null,
  column_name text not null,
  primary key (item_type, column_name)
) on commit drop;

insert into planning_cutover_source_columns (item_type, column_name)
select case table_name when 'milestones' then 'epic' else 'initiative' end, column_name
from information_schema.columns
where table_schema = 'public' and table_name in ('milestones', 'packages');

insert into planning_cutover_preservation_evidence (dataset, row_count, checksum)
select 'historical_links', count(*), md5(coalesce(jsonb_agg(
  (to_jsonb(link) - array['source_kind', 'legacy_id', 'migrated_at'])
    || jsonb_build_object(
      'item_type', case link.source_kind when 'milestone' then 'epic' when 'package' then 'initiative' end,
      'historical_id', link.legacy_id,
      'recorded_at', link.migrated_at,
      'source_snapshot', case link.source_kind
        when 'milestone' then to_jsonb(milestone)
        when 'package' then to_jsonb(initiative)
      end
    ) order by link.source_kind, link.legacy_id
)::text, '[]'))
from public.planning_item_legacy_ids link
left join public.milestones milestone
  on link.source_kind = 'milestone' and milestone.id = link.legacy_id
left join public.packages initiative
  on link.source_kind = 'package' and initiative.id = link.legacy_id;

insert into planning_cutover_preservation_evidence (dataset, row_count, checksum)
select 'delete_receipts', count(*), md5(coalesce(jsonb_agg(
  (to_jsonb(receipt) - 'milestone_id') || jsonb_build_object('item_id', receipt.milestone_id)
  order by receipt.token_id, receipt.idempotency_key
)::text, '[]'))
from public.team_planning_milestone_delete_requests receipt;

do $$
begin
  if exists (
    select 1
    from public.milestones milestone
    left join public.planning_item_legacy_ids link
      on link.source_kind = 'milestone' and link.legacy_id = milestone.id
    left join public.tasks item on item.id = link.task_id
    where link.task_id is null
       or item.id is null
       or item.task_type <> 'epic'
       or item.project_id is distinct from milestone.project_id
       or item.title is distinct from milestone.title
       or coalesce(item.description, '') is distinct from coalesce(milestone.description, '')
       or item.target_date is distinct from milestone.target_date
       or item.sort_order is distinct from milestone.sort_order
       or item.status is distinct from case milestone.status
            when 'active' then 'In Arbeit'
            when 'done' then 'Erledigt'
            else 'Offen'
          end
  ) or exists (
    select 1
    from public.planning_item_legacy_ids link
    left join public.milestones milestone on milestone.id = link.legacy_id
    where link.source_kind = 'milestone' and milestone.id is null
  ) then
    raise exception using errcode = 'P0001', message = 'planning cutover blocked: Epic parity failed';
  end if;

  if exists (
    select 1
    from public.packages initiative
    left join public.planning_item_legacy_ids link
      on link.source_kind = 'package' and link.legacy_id = initiative.id
    left join public.tasks item on item.id = link.task_id
    left join public.planning_item_legacy_ids parent_link
      on parent_link.source_kind = 'milestone' and parent_link.legacy_id = initiative.milestone_id
    left join public.planning_item_strategy strategy on strategy.task_id = item.id
    where link.task_id is null
       or item.id is null
       or item.task_type <> 'initiative'
       or item.project_id is distinct from initiative.project_id
       or item.title is distinct from initiative.title
       or coalesce(item.description, '') is distinct from coalesce(initiative.goal, '')
       or coalesce(item.priority, '') is distinct from coalesce(initiative.priority, '')
       or item.sort_order is distinct from initiative.sort_order
       or item.parent_task_id is distinct from parent_link.task_id
       or item.owner is distinct from initiative.owner_id
       or item.target_date is distinct from initiative.target_date
       or item.status is distinct from case initiative.status
            when 'active' then 'In Arbeit'
            when 'paused' then 'Pausiert'
            when 'done' then 'Erledigt'
            else 'Offen'
          end
       or item.approval_status is distinct from initiative.approval_status
       or item.approval_revision is distinct from initiative.approval_revision
       or item.proposed_by is distinct from initiative.proposed_by
       or item.proposed_at is distinct from initiative.proposed_at
       or item.decided_by is distinct from initiative.decided_by
       or item.decided_at is distinct from initiative.decided_at
       or item.decision_note is distinct from initiative.decision_note
       or item.trashed_at is distinct from initiative.trashed_at
       or item.trashed_by is distinct from initiative.trashed_by
       or item.trash_reason is distinct from initiative.trash_reason
       or item.trash_cause is distinct from initiative.trash_cause
       or item.purge_after is distinct from initiative.purge_after
       or item.trash_root_type is distinct from initiative.trash_root_type
       or item.trash_root_id is distinct from initiative.trash_root_id
       or item.trash_revision is distinct from initiative.trash_revision
       or coalesce(strategy.goal, '') is distinct from coalesce(initiative.goal, '')
       or coalesce(strategy.success_criteria, '') is distinct from coalesce(initiative.success_criteria, '')
       or coalesce(strategy.scope_constraints, '') is distinct from coalesce(initiative.scope_constraints, '')
  ) or exists (
    select 1
    from public.planning_item_legacy_ids link
    left join public.packages initiative on initiative.id = link.legacy_id
    where link.source_kind = 'package' and initiative.id is null
  ) then
    raise exception using errcode = 'P0001', message = 'planning cutover blocked: Initiative parity failed';
  end if;

  if exists (
    with legacy as (
      select link.task_id, initiative.id,
        array_remove(array[initiative.accountable_profile_id], null) as accountable,
        coalesce(initiative.responsible_profile_ids, '{}'::text[]) as responsible,
        coalesce(initiative.consulted_profile_ids, '{}'::text[]) as consulted,
        coalesce(initiative.informed_profile_ids, '{}'::text[]) as informed
      from public.packages initiative
      join public.planning_item_legacy_ids link
        on link.source_kind = 'package' and link.legacy_id = initiative.id
    ), canonical as (
      select legacy.task_id, legacy.id,
        coalesce(array_agg(raci.profile_id order by raci.sort_order, raci.profile_id)
          filter (where raci.role = 'accountable'), '{}'::text[]) as accountable,
        coalesce(array_agg(raci.profile_id order by raci.sort_order, raci.profile_id)
          filter (where raci.role = 'responsible'), '{}'::text[]) as responsible,
        coalesce(array_agg(raci.profile_id order by raci.sort_order, raci.profile_id)
          filter (where raci.role = 'consulted'), '{}'::text[]) as consulted,
        coalesce(array_agg(raci.profile_id order by raci.sort_order, raci.profile_id)
          filter (where raci.role = 'informed'), '{}'::text[]) as informed
      from legacy
      left join public.planning_item_raci_assignments raci on raci.task_id = legacy.task_id
      group by legacy.task_id, legacy.id
    )
    select 1
    from legacy join canonical using (task_id, id)
    where legacy.accountable is distinct from canonical.accountable
       or legacy.responsible is distinct from canonical.responsible
       or legacy.consulted is distinct from canonical.consulted
       or legacy.informed is distinct from canonical.informed
  ) then
    raise exception using errcode = 'P0001', message = 'planning cutover blocked: RACI parity failed';
  end if;

  if exists (
    select 1
    from public.tasks child
    left join public.tasks parent on parent.id = child.parent_task_id
    left join public.tasks grandparent on grandparent.id = parent.parent_task_id
    left join public.planning_item_legacy_ids parent_initiative
      on parent_initiative.source_kind = 'package'
     and parent_initiative.task_id = case
       when child.task_type = 'deliverable' then parent.id
       when child.task_type = 'sub_issue' then grandparent.id
     end
    left join public.planning_item_legacy_ids parent_epic
      on parent_epic.source_kind = 'milestone'
     and parent_epic.task_id = case
       when child.task_type = 'initiative' then parent.id
       when child.task_type = 'deliverable' then grandparent.id
       when child.task_type = 'sub_issue' then grandparent.parent_task_id
     end
    where child.package_id is distinct from parent_initiative.legacy_id
       or child.milestone_id is distinct from parent_epic.legacy_id
  ) then
    raise exception using errcode = 'P0001', message = 'planning cutover blocked: derived hierarchy parity failed';
  end if;

  if exists (
    select 1
    from public.profile_ui_preferences preference
    where preference.expanded_package_ids is distinct from preference.expanded_item_ids
       or preference.planning_filters ?| array['packageId', 'owner']
  ) then
    raise exception using errcode = 'P0001', message = 'planning cutover blocked: canonical preferences are incomplete';
  end if;
end;
$$;

-- Preserve historical URLs and immutable delete receipts under canonical,
-- transport-neutral names. Renaming preserves every row and foreign key.
alter table public.planning_item_legacy_ids rename to planning_item_historical_links;
alter table public.planning_item_historical_links rename column source_kind to item_type;
alter table public.planning_item_historical_links rename column legacy_id to historical_id;
alter table public.planning_item_historical_links rename column migrated_at to recorded_at;
alter table public.planning_item_historical_links add column source_snapshot jsonb;
alter table public.planning_item_historical_links
  drop constraint planning_item_legacy_ids_source_kind_check;
update public.planning_item_historical_links
set source_snapshot = case item_type
      when 'milestone' then (select to_jsonb(milestone) from public.milestones milestone where milestone.id = historical_id)
      when 'package' then (select to_jsonb(initiative) from public.packages initiative where initiative.id = historical_id)
    end,
    item_type = case item_type when 'milestone' then 'epic' when 'package' then 'initiative' else item_type end;
alter table public.planning_item_historical_links alter column source_snapshot set not null;
do $$
begin
  if exists (
    select 1
    from public.planning_item_historical_links link
    where link.source_snapshot is distinct from case link.item_type
      when 'epic' then (select to_jsonb(source) from public.milestones source where source.id = link.historical_id)
      when 'initiative' then (select to_jsonb(source) from public.packages source where source.id = link.historical_id)
    end
  ) then
    raise exception using errcode = 'P0001', message = 'planning cutover blocked: source snapshot fidelity failed';
  end if;
end;
$$;
alter table public.planning_item_historical_links
  add constraint planning_item_historical_links_item_type_check check (item_type in ('epic', 'initiative'));
comment on table public.planning_item_historical_links is
  'Historical app URL mappings and immutable legacy source snapshots retained independently of canonical item retention after the Planning hierarchy cutover.';

alter table public.team_planning_milestone_delete_requests rename to team_planning_item_delete_requests;
alter table public.team_planning_item_delete_requests rename column milestone_id to item_id;
comment on table public.team_planning_item_delete_requests is
  'Immutable canonical Team Planning Item delete replay receipts.';

alter table public.notification_events drop constraint notification_events_status_check;
alter table public.notification_events add constraint notification_events_status_check
  check (status in ('pending', 'sent', 'failed', 'dismissed', 'resolved'));

create or replace function public.normalize_task_approval_state()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_actor_profile_id text := nullif(current_setting('app.actor_profile_id', true), '');
  v_backfill boolean := coalesce(current_setting('app.planning_hierarchy_backfill', true), 'false') = 'true';
  v_parent public.tasks%rowtype;
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
    end if;
    new.approval_status := coalesce(new.approval_status, 'proposed');
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
    if tg_op = 'UPDATE' and old.task_type = 'initiative' and not v_backfill
       and new.parent_task_id is distinct from old.parent_task_id
       and old.approval_status = 'approved' then
      new.approval_status := 'proposed';
      new.approval_revision := old.approval_revision + 1;
      new.proposed_by := v_actor_profile_id;
      new.proposed_at := now();
      new.decided_by := null;
      new.decided_at := null;
      new.decision_note := null;
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
  elsif new.approval_status = 'approved'
    and not v_backfill
    and not (tg_op = 'UPDATE' and new.parent_task_id is distinct from old.parent_task_id) then
    raise exception using errcode = '23514', message = 'approved deliverable requires an initiative parent';
  end if;
  new.approval_status := coalesce(new.approval_status, 'proposed');
  new.github_repo := 'findmydoc-platform/management';
  if tg_op = 'UPDATE' and old.task_type = 'deliverable' and not v_backfill
     and new.parent_task_id is distinct from old.parent_task_id
     and old.approval_status = 'approved' then
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
  if new.approval_status <> 'approved' then
    new.sprint_id := null;
    new.score_relevant := false;
  else
    new.score_relevant := new.sprint_id is not null;
  end if;
  if new.status = 'Review'
     and (new.approval_status is distinct from 'approved' or new.review_status is distinct from 'requested') then
    new.status := 'In Arbeit';
  end if;
  return new;
end;
$$;

create or replace function public.guard_planning_trash_mutation()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_bypass boolean := coalesce(current_setting('founderops.trash_lifecycle_write', true), '') = 'on';
begin
  if v_bypass then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0003', message = 'planning items may only be deleted by the lifecycle purge';
  end if;
  if tg_op = 'INSERT' then
    if new.trashed_at is not null or new.trashed_by is not null or new.trash_reason is not null
       or new.trash_cause is not null or new.purge_after is not null or new.trash_root_type is not null
       or new.trash_root_id is not null or new.trash_revision <> 0 then
      raise exception using errcode = 'P0003', message = 'trash metadata requires the planning trash lifecycle';
    end if;
  else
    if old.trashed_at is not null then
      raise exception using errcode = 'P0003', message = 'trashed planning items are immutable';
    end if;
    if new.trashed_at is distinct from old.trashed_at or new.trashed_by is distinct from old.trashed_by
       or new.trash_reason is distinct from old.trash_reason or new.trash_cause is distinct from old.trash_cause
       or new.purge_after is distinct from old.purge_after or new.trash_root_type is distinct from old.trash_root_type
       or new.trash_root_id is distinct from old.trash_root_id or new.trash_revision is distinct from old.trash_revision then
      raise exception using errcode = 'P0003', message = 'trash metadata requires the planning trash lifecycle';
    end if;
  end if;
  if new.trashed_at is null and new.parent_task_id is not null and exists (
    select 1 from public.tasks parent where parent.id = new.parent_task_id and parent.trashed_at is not null
  ) then
    raise exception using errcode = 'P0003', message = 'active planning items require an active parent';
  end if;
  return new;
end;
$$;

create or replace function public.prepare_empty_epic_delete(p_item_id text)
returns jsonb
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_epic public.tasks%rowtype;
  v_initiative_count bigint := 0;
  v_task_count bigint := 0;
begin
  if nullif(trim(coalesce(p_item_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'empty epic delete preparation input is invalid';
  end if;
  select * into v_epic from public.tasks
  where id = p_item_id and project_id = 'findmydoc-founder-execution'
    and task_type = 'epic' and trashed_at is null;
  if not found then
    return jsonb_build_object('item', null, 'children', jsonb_build_object('initiatives', 0, 'tasks', 0));
  end if;
  with recursive descendants as (
    select id, task_type from public.tasks where parent_task_id = p_item_id and trashed_at is null
    union all
    select child.id, child.task_type
    from public.tasks child join descendants parent on child.parent_task_id = parent.id
    where child.trashed_at is null
  )
  select count(*) filter (where task_type = 'initiative'),
    count(*) filter (where task_type in ('deliverable', 'sub_issue'))
  into v_initiative_count, v_task_count from descendants;
  return jsonb_build_object(
    'item', to_jsonb(v_epic),
    'children', jsonb_build_object('initiatives', v_initiative_count, 'tasks', v_task_count)
  );
end;
$$;

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
  if nullif(trim(coalesce(p_task_id, '')), '') is null or p_expected_updated_at is null
     or nullif(trim(coalesce(p_actor_profile_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'empty epic delete input is invalid';
  end if;
  select platform_role into v_role from public.profiles where id = p_actor_profile_id for share;
  if not found or v_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'empty epic deletion requires ceo or deputy';
  end if;
  select * into v_epic from public.tasks
  where id = p_task_id and project_id = 'findmydoc-founder-execution'
    and task_type = 'epic' and trashed_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  if v_epic.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;
  with recursive descendants as (
    select id, task_type from public.tasks where parent_task_id = p_task_id and trashed_at is null
    union all
    select child.id, child.task_type
    from public.tasks child join descendants parent on child.parent_task_id = parent.id
    where child.trashed_at is null
  )
  select count(*) filter (where task_type = 'initiative'),
    count(*) filter (where task_type in ('deliverable', 'sub_issue'))
  into v_initiative_count, v_task_count from descendants;
  if v_initiative_count > 0 or v_task_count > 0 then
    raise exception using errcode = 'P0008', message = 'epic is not empty', detail = jsonb_build_object(
      'children', jsonb_build_object('initiatives', v_initiative_count, 'tasks', v_task_count)
    )::text;
  end if;
  perform set_config('founderops.trash_lifecycle_write', 'on', true);
  delete from public.tasks where id = p_task_id and updated_at = p_expected_updated_at returning * into v_deleted;
  if not found then raise exception using errcode = 'P0001', message = 'planning item was changed concurrently'; end if;
  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  return jsonb_build_object('task', to_jsonb(v_deleted));
exception when others then
  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  raise;
end;
$$;

create or replace function public.prepare_planning_approval_command(
  p_item_id text,
  p_expected_kind text,
  p_actor_profile_id text
) returns jsonb
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_actor_role text;
  v_accountable_count integer := 0;
  v_responsible_count integer := 0;
begin
  if nullif(trim(coalesce(p_item_id, '')), '') is null
     or p_expected_kind not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_actor_profile_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'planning approval preparation input is invalid';
  end if;
  select * into v_task from public.tasks where id = p_item_id;
  if v_task.id is not null and v_task.parent_task_id is not null then
    select * into v_parent from public.tasks where id = v_task.parent_task_id;
  end if;
  if v_task.task_type = 'initiative' then
    select count(*) filter (where role = 'accountable'), count(*) filter (where role = 'responsible')
    into v_accountable_count, v_responsible_count
    from public.planning_item_raci_assignments where task_id = v_task.id;
  end if;
  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  return jsonb_build_object(
    'task', case when v_task.id is null then null else to_jsonb(v_task) end,
    'parent', case when v_parent.id is null then null else to_jsonb(v_parent) end,
    'actorRole', coalesce(v_actor_role, ''),
    'accountableCount', v_accountable_count,
    'responsibleCount', v_responsible_count,
    'profiles', coalesce((select jsonb_agg(jsonb_build_object('id', profile.id, 'name', profile.name))
      from public.profiles profile where profile.id in (v_task.owner, v_task.assignee, v_task.created_by)), '[]'::jsonb),
    'strategy', (select to_jsonb(strategy) from public.planning_item_strategy strategy where strategy.task_id = v_task.id),
    'raciAssignments', coalesce((select jsonb_agg(to_jsonb(raci) order by raci.sort_order, raci.profile_id)
      from public.planning_item_raci_assignments raci where raci.task_id = v_task.id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.prepare_planning_reparent_command(
  p_item_id text,
  p_parent_id text,
  p_expected_kind text,
  p_actor_profile_id text
) returns jsonb
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_old_parent public.tasks%rowtype;
  v_actor public.profiles%rowtype;
  v_item_id text := nullif(trim(coalesce(p_item_id, '')), '');
  v_parent_id text := nullif(trim(coalesce(p_parent_id, '')), '');
begin
  if v_item_id is null or p_expected_kind not in ('initiative', 'deliverable', 'sub_issue', 'any') then
    raise exception using errcode = '22023', message = 'planning reparent preparation input is invalid';
  end if;
  select * into v_task from public.tasks where id = v_item_id;
  if v_task.id is not null and v_task.parent_task_id is not null then
    select * into v_old_parent from public.tasks where id = v_task.parent_task_id;
  end if;
  if v_parent_id is not null then select * into v_parent from public.tasks where id = v_parent_id; end if;
  select * into v_actor from public.profiles where id = p_actor_profile_id;
  return jsonb_build_object(
    'task', case when v_task.id is null then null else to_jsonb(v_task) end,
    'parent', case when v_parent.id is null then null else to_jsonb(v_parent) end,
    'oldParent', case when v_old_parent.id is null then null else to_jsonb(v_old_parent) end,
    'requestedParentId', v_parent_id,
    'actor', case when v_actor.id is null then null else jsonb_build_object(
      'id', v_actor.id, 'name', v_actor.name, 'role', v_actor.platform_role
    ) end,
    'profiles', coalesce((select jsonb_agg(jsonb_build_object('id', profile.id, 'name', profile.name))
      from public.profiles profile where profile.id in (v_task.owner, v_task.assignee, v_task.created_by)), '[]'::jsonb),
    'strategy', (select to_jsonb(strategy) from public.planning_item_strategy strategy where strategy.task_id = v_task.id),
    'raciAssignments', coalesce((select jsonb_agg(to_jsonb(raci) order by raci.sort_order, raci.profile_id)
      from public.planning_item_raci_assignments raci where raci.task_id = v_task.id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.planning_trash_root_is_purge_eligible(
  p_root_type text,
  p_root_id text,
  p_trash_revision integer
) returns boolean
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_root public.tasks%rowtype;
begin
  if p_root_type not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_root_id, '')), '') is null
     or p_trash_revision is null or p_trash_revision < 1 then
    return false;
  end if;
  select * into v_root from public.tasks
  where id = p_root_id and task_type = p_root_type and trashed_at is not null
    and trash_root_type = p_root_type and trash_root_id = p_root_id
    and trash_revision = p_trash_revision and purge_after <= now();
  if not found then return false; end if;

  if exists (
    with recursive expected as (
      select id from public.tasks where id = p_root_id
      union all
      select child.id from public.tasks child join expected parent on child.parent_task_id = parent.id
    )
    select 1 from expected
    join public.tasks item using (id)
    where item.trashed_at is distinct from v_root.trashed_at
       or item.purge_after is distinct from v_root.purge_after
       or item.trash_cause is distinct from v_root.trash_cause
       or item.trash_root_type is distinct from p_root_type
       or item.trash_root_id is distinct from p_root_id
       or item.trash_revision is distinct from p_trash_revision
  ) or exists (
    with recursive expected as (
      select id from public.tasks where id = p_root_id
      union all
      select child.id from public.tasks child join expected parent on child.parent_task_id = parent.id
    )
    select 1 from public.tasks item
    where item.trashed_at is not null and item.trash_root_type = p_root_type
      and item.trash_root_id = p_root_id and item.trash_revision = p_trash_revision
      and not exists (select 1 from expected where expected.id = item.id)
  ) then
    return false;
  end if;

  if exists (
    with recursive expected as (
      select id, task_type from public.tasks where id = p_root_id
      union all
      select child.id, child.task_type from public.tasks child join expected parent on child.parent_task_id = parent.id
    )
    select 1 from expected item
    where item.task_type in ('deliverable', 'sub_issue')
      and not exists (
        select 1 from public.planning_github_lifecycle_outbox lifecycle
        where lifecycle.root_type = p_root_type and lifecycle.root_id = p_root_id
          and lifecycle.root_trash_revision = p_trash_revision and lifecycle.task_id = item.id
          and lifecycle.action = 'close_not_planned' and lifecycle.status = 'completed'
          and ((lifecycle.github_issue_number is null and lifecycle.status_reason = 'issue_missing')
            or (lifecycle.github_issue_number is not null and lifecycle.status_reason = 'delivered'))
      )
  ) or exists (
    with recursive expected as (
      select id, task_type from public.tasks where id = p_root_id
      union all
      select child.id, child.task_type from public.tasks child join expected parent on child.parent_task_id = parent.id
    )
    select 1 from public.planning_github_lifecycle_outbox lifecycle
    where lifecycle.root_type = p_root_type and lifecycle.root_id = p_root_id
      and lifecycle.root_trash_revision = p_trash_revision and lifecycle.action = 'close_not_planned'
      and not exists (
        select 1 from expected where expected.id = lifecycle.task_id
          and expected.task_type in ('deliverable', 'sub_issue')
      )
  ) then
    return false;
  end if;
  return true;
end;
$$;

create or replace function public.purge_expired_planning_trash_batch(
  p_limit integer default 25,
  p_dry_run boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 25));
  v_scan_limit integer := least(greatest(1, coalesce(p_limit, 25)) * 4, 100);
  v_candidate record;
  v_root public.tasks%rowtype;
  v_item_ids text[];
  v_projection_item_ids text[];
  v_item_count integer;
  v_projection_count integer;
  v_completed_count integer;
  v_resolved_count integer;
  v_purged_roots integer := 0;
  v_purged_tasks integer := 0;
  v_resolved_notifications integer := 0;
  v_eligible_roots integer := 0;
  v_eligible_tasks integer := 0;
  v_blocked_expired_roots integer := 0;
  v_locked_roots integer := 0;
  v_has_more boolean := false;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('planning-trash-purge', 0)) then
    return jsonb_build_object('busy', true, 'dryRun', coalesce(p_dry_run, false),
      'eligibleRoots', 0, 'eligibleTasks', 0, 'purgedRoots', 0, 'purgedTasks', 0,
      'resolvedNotifications', 0, 'blockedExpiredRoots', 0, 'hasMore', true);
  end if;
  perform set_config('founderops.trash_lifecycle_write', 'on', true);

  for v_candidate in
    select item.task_type as root_type, item.id as root_id, item.trash_revision, item.purge_after
    from public.tasks item
    where item.task_type in ('initiative', 'deliverable')
      and item.trashed_at is not null
      and item.trash_root_type = item.task_type
      and item.trash_root_id = item.id
      and item.purge_after <= now()
    order by item.purge_after, item.task_type, item.id
    limit v_scan_limit
  loop
    exit when v_locked_roots >= v_limit;
    if not public.planning_trash_root_is_purge_eligible(
      v_candidate.root_type, v_candidate.root_id, v_candidate.trash_revision
    ) then continue; end if;

    select * into v_root from public.tasks
    where id = v_candidate.root_id and task_type = v_candidate.root_type
      and trashed_at is not null and trash_root_type = v_candidate.root_type
      and trash_root_id = v_candidate.root_id and trash_revision = v_candidate.trash_revision
      and purge_after <= now()
    for update skip locked;
    if v_root.id is null then continue; end if;
    v_locked_roots := v_locked_roots + 1;

    select coalesce(array_agg(item.id order by item.id), '{}'::text[]), count(*)::integer,
      coalesce(array_agg(item.id order by item.id) filter (where item.task_type in ('deliverable', 'sub_issue')), '{}'::text[]),
      count(*) filter (where item.task_type in ('deliverable', 'sub_issue'))::integer
    into v_item_ids, v_item_count, v_projection_item_ids, v_projection_count
    from public.tasks item
    where item.trashed_at is not null and item.trash_root_type = v_candidate.root_type
      and item.trash_root_id = v_candidate.root_id and item.trash_revision = v_candidate.trash_revision;
    perform id from public.tasks where id = any(v_item_ids) order by id for update;
    if not public.planning_trash_root_is_purge_eligible(
      v_candidate.root_type, v_candidate.root_id, v_candidate.trash_revision
    ) then continue; end if;

    select count(*) filter (
      where lifecycle.status = 'completed'
        and ((lifecycle.github_issue_number is null and lifecycle.status_reason = 'issue_missing')
          or (lifecycle.github_issue_number is not null and lifecycle.status_reason = 'delivered'))
    )::integer
    into v_completed_count
    from public.planning_github_lifecycle_outbox lifecycle
    where lifecycle.root_type = v_candidate.root_type and lifecycle.root_id = v_candidate.root_id
      and lifecycle.root_trash_revision = v_candidate.trash_revision
      and lifecycle.action = 'close_not_planned';
    if v_completed_count <> v_projection_count then continue; end if;

    if coalesce(p_dry_run, false) then
      v_eligible_roots := v_eligible_roots + 1;
      v_eligible_tasks := v_eligible_tasks + v_item_count;
      continue;
    end if;

    update public.notification_events notification
    set status = 'resolved', resolved_at = coalesce(notification.resolved_at, now()),
        resolution_reason = coalesce(notification.resolution_reason, 'source_purged')
    where notification.status in ('pending', 'sent', 'failed')
      and ((notification.entity_type = 'initiative' and notification.entity_id = v_candidate.root_id)
        or (notification.entity_type = 'task' and notification.entity_id = any(v_item_ids)));
    get diagnostics v_resolved_count = row_count;
    v_resolved_notifications := v_resolved_notifications + v_resolved_count;

    if v_candidate.root_type = 'initiative' then
      update public.profile_ui_preferences preference
      set expanded_item_ids = array_remove(preference.expanded_item_ids, v_candidate.root_id),
          planning_filters = case
            when preference.planning_filters->>'initiativeId' = v_candidate.root_id
              then jsonb_set(preference.planning_filters, '{initiativeId}', '"Alle"'::jsonb, true)
            else preference.planning_filters
          end,
          updated_at = now()
      where v_candidate.root_id = any(preference.expanded_item_ids)
         or preference.planning_filters->>'initiativeId' = v_candidate.root_id;
    end if;

    insert into public.audit_log (action, entity_type, entity_id, before_data, after_data)
    values ('planning_trash.purge', v_candidate.root_type, v_candidate.root_id,
      jsonb_build_object('trashCause', v_root.trash_cause, 'trashedAt', v_root.trashed_at,
        'purgeAfter', v_root.purge_after, 'trashRevision', v_candidate.trash_revision),
      jsonb_build_object('purgedAt', now(), 'taskCount', v_item_count,
        'completedGitHubLifecycleJobs', v_completed_count, 'resolvedNotifications', v_resolved_count));

    delete from public.planning_github_lifecycle_outbox lifecycle
    where lifecycle.root_type = v_candidate.root_type and lifecycle.root_id = v_candidate.root_id
      and lifecycle.root_trash_revision = v_candidate.trash_revision;
    delete from public.tasks item
    where item.id = any(v_item_ids) and item.trashed_at is not null
      and item.trash_root_type = v_candidate.root_type and item.trash_root_id = v_candidate.root_id
      and item.trash_revision = v_candidate.trash_revision;
    v_purged_roots := v_purged_roots + 1;
    v_purged_tasks := v_purged_tasks + v_item_count;
  end loop;

  select exists (
    select 1 from public.tasks item
    where item.task_type in ('initiative', 'deliverable') and item.trashed_at is not null
      and item.trash_root_type = item.task_type and item.trash_root_id = item.id and item.purge_after <= now()
  ) into v_has_more;
  select count(*)::integer into v_blocked_expired_roots
  from (
    select item.task_type, item.id, item.trash_revision
    from public.tasks item
    where item.task_type in ('initiative', 'deliverable') and item.trashed_at is not null
      and item.trash_root_type = item.task_type and item.trash_root_id = item.id and item.purge_after <= now()
    order by item.purge_after, item.task_type, item.id limit v_scan_limit
  ) candidate
  where not public.planning_trash_root_is_purge_eligible(candidate.task_type, candidate.id, candidate.trash_revision);
  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  return jsonb_build_object('busy', false, 'dryRun', coalesce(p_dry_run, false),
    'eligibleRoots', v_eligible_roots, 'eligibleTasks', v_eligible_tasks,
    'purgedRoots', v_purged_roots, 'purgedTasks', v_purged_tasks,
    'resolvedNotifications', v_resolved_notifications,
    'blockedExpiredRoots', v_blocked_expired_roots, 'hasMore', v_has_more);
exception when others then
  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  raise;
end;
$$;

create or replace function public.update_planning_task_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_task_patch jsonb default '{}'::jsonb,
  p_note_present boolean default false,
  p_note text default null,
  p_dependency_present boolean default false,
  p_dependency_note text default null,
  p_activity_messages text[] default '{}'::text[],
  p_notifications jsonb default '[]'::jsonb,
  p_actor_profile_id text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_patch jsonb := coalesce(p_task_patch, '{}'::jsonb);
  v_evidence_links_present boolean := v_patch ? 'evidence_links';
  v_evidence_links jsonb := v_patch->'evidence_links';
  v_changes_parent boolean := v_patch ? 'parent_task_id';
  v_changes_status boolean := v_patch ? 'status';
  v_parent_id text;
  v_initial_parent_id text;
  v_initial_task_type text;
  v_before_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_updated_task public.tasks%rowtype;
  v_result jsonb;
begin
  perform set_config('app.actor_profile_id', coalesce(p_actor_profile_id, ''), true);
  v_patch := v_patch - 'evidence_links';
  if not v_changes_parent and not v_changes_status then
    v_result := public.update_task_transaction(
      p_task_id, p_expected_updated_at, v_patch, p_note_present, p_note,
      p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
    );
    if v_evidence_links_present then perform public.replace_task_evidence_links(p_task_id, v_evidence_links); end if;
    return v_result;
  end if;
  select task_type, parent_task_id into v_initial_task_type, v_initial_parent_id
  from public.tasks where id = p_task_id;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if v_changes_parent then
    if v_initial_task_type <> 'sub_issue' then
      raise exception using errcode = '22023', message = 'only sub-issues may change parent';
    end if;
    v_parent_id := nullif(trim(v_patch->>'parent_task_id'), '');
  elsif v_initial_task_type = 'sub_issue' then
    v_parent_id := v_initial_parent_id;
  else
    v_result := public.update_task_transaction(
      p_task_id, p_expected_updated_at, v_patch, p_note_present, p_note,
      p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
    );
    if v_evidence_links_present then perform public.replace_task_evidence_links(p_task_id, v_evidence_links); end if;
    return v_result;
  end if;
  if v_parent_id is null then raise exception using errcode = '22023', message = 'sub-issue parent is required'; end if;
  select * into v_parent from public.tasks
  where id = v_parent_id and task_type = 'deliverable' and trashed_at is null for share;
  if not found then raise exception using errcode = '22023', message = 'sub-issue parent must be an active deliverable'; end if;
  if v_changes_status and v_parent.approval_status is distinct from 'approved' then
    raise exception using errcode = 'P0008', message = 'sub-issue parent is not approved';
  end if;
  select * into v_before_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if v_before_task.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'task was changed concurrently';
  end if;
  if v_before_task.task_type <> 'sub_issue' then
    raise exception using errcode = '22023', message = 'only sub-issues may change parent';
  end if;
  if v_before_task.trashed_at is not null then raise exception using errcode = 'P0003', message = 'sub-issue is trashed'; end if;
  if not v_changes_parent and v_before_task.parent_task_id is distinct from v_parent_id then
    raise exception using errcode = 'P0001', message = 'sub-issue parent changed concurrently';
  end if;
  if not v_changes_parent then
    v_result := public.update_task_transaction(
      p_task_id, p_expected_updated_at, v_patch, p_note_present, p_note,
      p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
    );
    if v_evidence_links_present then perform public.replace_task_evidence_links(p_task_id, v_evidence_links); end if;
    return jsonb_set(v_result, '{parentApprovalStatus}', to_jsonb(v_parent.approval_status), true);
  end if;
  v_result := public.update_task_transaction(
    p_task_id, p_expected_updated_at, v_patch - 'parent_task_id', p_note_present, p_note,
    p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
  );
  update public.tasks set parent_task_id = v_parent_id, updated_at = clock_timestamp()
  where id = p_task_id returning * into v_updated_task;
  if v_evidence_links_present then perform public.replace_task_evidence_links(p_task_id, v_evidence_links); end if;
  if v_before_task.parent_task_id is distinct from v_updated_task.parent_task_id then
    insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
    values (p_actor_profile_id, 'task.parent_changed', 'task', p_task_id,
      jsonb_build_object('parentTaskId', v_before_task.parent_task_id),
      jsonb_build_object('parentTaskId', v_updated_task.parent_task_id));
  end if;
  return jsonb_set(jsonb_set(v_result, '{task}', to_jsonb(v_updated_task), true),
    '{parentApprovalStatus}', to_jsonb(v_parent.approval_status), true);
end;
$$;

create or replace function public.update_profile_settings_transaction(
  p_profile_id text,
  p_profile_patch jsonb default '{}'::jsonb,
  p_ui_preferences jsonb default null,
  p_notification_events jsonb default '{}'::jsonb,
  p_request_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_patch jsonb := coalesce(p_profile_patch, '{}'::jsonb);
  v_filters jsonb;
  v_expanded_ids jsonb;
  v_before jsonb;
  v_profile jsonb;
  v_ui_preference jsonb := null;
  v_preferences jsonb;
begin
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'profile patch must be a JSON object';
  end if;
  select to_jsonb(profile) into v_before from public.profiles profile
  where profile.id = p_profile_id for update;
  if v_before is null then raise exception using errcode = 'P0002', message = 'profile not found'; end if;
  update public.profiles profile
  set focus = case when v_patch ? 'focus' then nullif(v_patch->>'focus', '') else profile.focus end,
      profile_color = case when v_patch ? 'profile_color' then v_patch->>'profile_color' else profile.profile_color end,
      notifications_enabled = case when v_patch ? 'notifications_enabled'
        then (v_patch->>'notifications_enabled')::boolean else profile.notifications_enabled end
  where profile.id = p_profile_id returning to_jsonb(profile) into v_profile;

  if p_ui_preferences is not null then
    if jsonb_typeof(p_ui_preferences) <> 'object' then
      raise exception using errcode = '22023', message = 'UI preferences must be a JSON object';
    end if;
    v_filters := coalesce(p_ui_preferences->'planning_filters', '{}'::jsonb);
    if jsonb_typeof(v_filters) <> 'object' or v_filters ?| array['packageId', 'owner'] then
      raise exception using errcode = '22023', message = 'Planning filters must use canonical fields';
    end if;
    v_expanded_ids := coalesce(p_ui_preferences->'expanded_item_ids', '[]'::jsonb);
    if jsonb_typeof(v_expanded_ids) <> 'array' then
      raise exception using errcode = '22023', message = 'Expanded Planning item IDs must be an array';
    end if;
    insert into public.profile_ui_preferences as preference (
      profile_id, default_workspace, default_task_view, planning_filters, expanded_item_ids, updated_at
    ) values (
      p_profile_id, p_ui_preferences->>'default_workspace', p_ui_preferences->>'default_task_view',
      v_filters, array(select jsonb_array_elements_text(v_expanded_ids)), now()
    ) on conflict (profile_id) do update
      set default_workspace = excluded.default_workspace,
          default_task_view = excluded.default_task_view,
          planning_filters = excluded.planning_filters,
          expanded_item_ids = excluded.expanded_item_ids,
          updated_at = excluded.updated_at
    returning jsonb_build_object(
      'profile_id', preference.profile_id,
      'default_workspace', preference.default_workspace,
      'default_task_view', preference.default_task_view,
      'planning_filters', preference.planning_filters,
      'expanded_item_ids', to_jsonb(preference.expanded_item_ids),
      'created_at', preference.created_at,
      'updated_at', preference.updated_at
    ) into v_ui_preference;
  end if;
  v_preferences := public.upsert_profile_notification_preferences(p_profile_id, p_notification_events);
  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id, before_data, after_data, request_ip, user_agent
  ) values (
    p_profile_id, 'profile.self_service.update', 'profile', p_profile_id, v_before,
    jsonb_build_object('profile', v_profile, 'ui_preference', v_ui_preference,
      'notification_events', coalesce(p_notification_events, '{}'::jsonb)),
    p_request_ip, p_user_agent
  );
  return jsonb_build_object('profile', v_profile, 'ui_preference', v_ui_preference,
    'notification_preferences', v_preferences);
end;
$$;

create function public.create_browser_planning_item_transaction(
  p_item jsonb,
  p_strategy jsonb,
  p_raci_assignments jsonb,
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
begin
  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  if v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'planning create requires an operational lead';
  end if;
  return public.create_planning_item_transaction(
    p_item, p_strategy, coalesce(p_raci_assignments, '[]'::jsonb), p_actor_profile_id
  );
end;
$$;

create function public.update_browser_planning_item_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_strategy jsonb,
  p_raci_assignments jsonb,
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
  v_task public.tasks%rowtype;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  if not found or v_actor_role = 'viewer' then
    raise exception using errcode = 'P0006', message = 'planning revise actor is not allowed';
  end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  if v_task.trashed_at is not null then raise exception using errcode = 'P0003', message = 'planning item is trashed'; end if;
  if v_task.task_type not in ('epic', 'initiative') then
    raise exception using errcode = '22023', message = 'strategic revise requires an Epic or Initiative';
  end if;
  if v_patch ? 'parent_task_id' then
    raise exception using errcode = '22023', message = 'parent changes require the planning parent command';
  end if;
  if v_task.task_type = 'epic' and v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'Epic revise requires an operational lead';
  end if;
  if v_task.task_type = 'initiative' and v_actor_role not in ('ceo', 'deputy')
     and p_actor_profile_id is distinct from v_task.owner
     and p_actor_profile_id is distinct from v_task.assignee then
    raise exception using errcode = 'P0006', message = 'Initiative revise requires ownership';
  end if;
  if v_actor_role not in ('ceo', 'deputy') and (
    v_patch ?| array['owner', 'assignee'] or p_raci_assignments is not null
  ) then
    raise exception using errcode = 'P0006', message = 'Owner and RACI changes require an operational lead';
  end if;
  return public.update_planning_item_transaction(
    p_task_id, p_expected_updated_at, v_patch, p_strategy, p_raci_assignments, p_actor_profile_id
  );
end;
$$;

create function public.delete_team_planning_item_transaction(
  p_token_id uuid,
  p_profile_id text,
  p_item_id text,
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
  v_request public.team_planning_item_delete_requests%rowtype;
  v_role text;
  v_epic public.tasks%rowtype;
  v_deleted public.tasks%rowtype;
  v_initiative_count bigint := 0;
  v_task_count bigint := 0;
  v_response jsonb;
begin
  if p_token_id is null or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or nullif(trim(coalesce(p_item_id, '')), '') is null or p_expected_updated_at is null
     or p_idempotency_key is null or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'epic delete input is invalid';
  end if;
  select * into v_token from public.team_task_intake_tokens
  where id = p_token_id and profile_id = p_profile_id and revoked_at is null and expires_at > now() for update;
  if not found then raise exception using errcode = 'P0004', message = 'planning items token is inactive'; end if;
  if not ('write:planning-items:delete-empty' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning items epic delete scope is missing';
  end if;
  select platform_role into v_role from public.profiles where id = p_profile_id for share;
  if not found or v_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'epic deletion requires ceo or deputy';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'planning-items-epic-delete:' || p_token_id::text || ':' || p_idempotency_key::text, 0
  ));
  select * into v_request from public.team_planning_item_delete_requests
  where token_id = p_token_id and idempotency_key = p_idempotency_key;
  if found then
    if v_request.request_hash <> p_request_hash or v_request.item_id <> p_item_id
       or v_request.expected_updated_at is distinct from p_expected_updated_at then
      raise exception using errcode = 'P0003', message = 'idempotency key conflict';
    end if;
    return jsonb_set(v_request.response, '{replayed}', 'true'::jsonb, true);
  end if;
  select * into v_epic from public.tasks
  where id = p_item_id and project_id = 'findmydoc-founder-execution'
    and task_type = 'epic' and trashed_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  if v_epic.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;
  with recursive descendants as (
    select id, task_type from public.tasks where parent_task_id = p_item_id and trashed_at is null
    union all
    select child.id, child.task_type from public.tasks child
    join descendants parent on child.parent_task_id = parent.id where child.trashed_at is null
  )
  select count(*) filter (where task_type = 'initiative'),
    count(*) filter (where task_type in ('deliverable', 'sub_issue'))
  into v_initiative_count, v_task_count from descendants;
  if v_initiative_count > 0 or v_task_count > 0 then
    raise exception using errcode = 'P0008', message = 'epic is not empty', detail = jsonb_build_object(
      'children', jsonb_build_object('initiatives', v_initiative_count, 'tasks', v_task_count)
    )::text;
  end if;
  perform set_config('founderops.trash_lifecycle_write', 'on', true);
  delete from public.tasks where id = p_item_id and updated_at = p_expected_updated_at returning * into v_deleted;
  if not found then raise exception using errcode = 'P0001', message = 'planning item was changed concurrently'; end if;
  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  v_response := jsonb_build_object('replayed', false, 'itemType', 'epic', 'item', to_jsonb(v_deleted),
    'children', jsonb_build_object('initiatives', 0, 'tasks', 0));
  insert into public.team_planning_item_delete_requests (
    token_id, profile_id, item_id, expected_updated_at, idempotency_key, request_hash, response, contract_version
  ) values (
    p_token_id, p_profile_id, p_item_id, p_expected_updated_at, p_idempotency_key, p_request_hash, v_response, 2
  );
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, request_ip, user_agent)
  values (p_profile_id, 'team.planning_items.epic_delete', 'task', p_item_id, to_jsonb(v_epic), p_request_ip, p_user_agent);
  return v_response;
exception when others then
  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  raise;
end;
$$;

drop function public.create_browser_planning_item_transaction(jsonb,jsonb,jsonb,text,text,text,text) restrict;
drop function public.update_browser_planning_item_transaction(text,timestamptz,jsonb,jsonb,jsonb,text,text,text,text) restrict;
drop function public.delete_team_planning_milestone_transaction(uuid,text,text,timestamptz,uuid,text,text,text) restrict;
drop function public.backfill_unified_planning_hierarchy() restrict;
drop function public.create_team_task_intake_v2_transaction(uuid,text,uuid,text,jsonb,text,text) restrict;
drop function public.decide_deliverable_approval_transaction(text,integer,text,text,text) restrict;
drop function public.decide_initiative_approval_transaction(text,integer,text,text,text) restrict;
drop function public.update_team_planning_item_transaction_without_task_status(
  uuid,text,text,text,timestamptz,uuid,text,jsonb,jsonb,jsonb,text,text
) restrict;
drop function public.create_team_planning_items_token_v3(text,text,text,text,boolean,boolean,boolean) restrict;
drop function public.create_team_planning_items_token_v2(text,text,text,text,boolean,boolean) restrict;

create function public.create_team_planning_items_token_v2(
  p_profile_id text,
  p_label text,
  p_token_hash text,
  p_token_hint text,
  p_allow_updates boolean default false,
  p_allow_empty_epic_deletes boolean default false,
  p_allow_github_sync boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
  v_token jsonb;
begin
  if coalesce(p_allow_empty_epic_deletes, false) then
    select platform_role into v_role from public.profiles where id = p_profile_id for share;
    if not found or v_role not in ('ceo', 'deputy') then
      raise exception using errcode = 'P0006', message = 'empty Epic delete token requires ceo or deputy';
    end if;
  end if;
  v_token := public.create_team_planning_items_token(
    p_profile_id, p_label, p_token_hash, p_token_hint, coalesce(p_allow_updates, false)
  );
  update public.team_task_intake_tokens token
  set scopes = token.scopes
    || case when coalesce(p_allow_empty_epic_deletes, false)
      and not ('write:planning-items:delete-empty' = any(token.scopes))
      then array['write:planning-items:delete-empty']::text[] else '{}'::text[] end
    || case when coalesce(p_allow_github_sync, false)
      and not ('write:planning-items:github-sync' = any(token.scopes))
      then array['write:planning-items:github-sync']::text[] else '{}'::text[] end
  where token.id = (v_token->>'id')::uuid
  returning to_jsonb(token) - 'token_hash' into v_token;
  return v_token;
end;
$$;

drop view public.active_packages restrict;
drop view public.active_tasks restrict;
drop policy task_relationship_edges_delete_authorized on public.task_relationship_edges;
drop policy task_relationship_edges_insert_authorized on public.task_relationship_edges;
drop trigger packages_guard_trash_mutation on public.packages;
drop trigger packages_touch_updated_at on public.packages;
drop trigger milestones_allocate_sort_order on public.milestones;
drop trigger milestones_touch_updated_at on public.milestones;
drop function public.allocate_milestone_sort_order() restrict;

alter table public.tasks drop constraint tasks_package_id_fkey;
alter table public.tasks drop constraint tasks_milestone_id_fkey;
drop index public.tasks_package_id_idx;
drop index public.tasks_milestone_id_idx;
alter table public.tasks drop column package_id restrict;
alter table public.tasks drop column milestone_id restrict;
alter table public.profile_ui_preferences drop column expanded_package_ids restrict;

create view public.active_tasks
with (security_invoker = true)
as select task.* from public.tasks task where task.trashed_at is null;
grant select on public.active_tasks to authenticated, service_role;

create policy task_relationship_edges_delete_authorized
on public.task_relationship_edges
for delete to authenticated
using (
  public.current_platform_role() in ('ceo', 'deputy')
  or (
    public.current_platform_role() = 'founder'
    and relation_type = 'blocked_by'
    and exists (
      select 1
      from public.tasks item
      left join public.tasks deliverable
        on deliverable.id = item.parent_task_id and item.task_type = 'sub_issue'
      left join public.tasks initiative
        on initiative.id = case
          when item.task_type = 'deliverable' then item.parent_task_id
          when item.task_type = 'sub_issue' then deliverable.parent_task_id
        end
      where item.id = task_relationship_edges.task_id
        and item.task_type in ('deliverable', 'sub_issue')
        and (
          item.assignee = public.current_profile_id()
          or item.owner = public.current_profile_id()
          or initiative.owner = public.current_profile_id()
          or exists (
            select 1 from public.planning_item_raci_assignments raci
            where raci.task_id = initiative.id and raci.role = 'accountable'
              and raci.profile_id = public.current_profile_id()
          )
        )
    )
  )
);

create policy task_relationship_edges_insert_authorized
on public.task_relationship_edges
for insert to authenticated
with check (
  public.current_platform_role() in ('ceo', 'deputy')
  or (
    public.current_platform_role() = 'founder'
    and relation_type = 'blocked_by'
    and created_by = public.current_profile_id()
    and exists (
      select 1
      from public.tasks item
      left join public.tasks deliverable
        on deliverable.id = item.parent_task_id and item.task_type = 'sub_issue'
      left join public.tasks initiative
        on initiative.id = case
          when item.task_type = 'deliverable' then item.parent_task_id
          when item.task_type = 'sub_issue' then deliverable.parent_task_id
        end
      where item.id = task_relationship_edges.task_id
        and item.task_type in ('deliverable', 'sub_issue')
        and (
          item.assignee = public.current_profile_id()
          or item.owner = public.current_profile_id()
          or initiative.owner = public.current_profile_id()
          or exists (
            select 1 from public.planning_item_raci_assignments raci
            where raci.task_id = initiative.id and raci.role = 'accountable'
              and raci.profile_id = public.current_profile_id()
          )
        )
    )
  )
);

drop table public.packages restrict;
drop table public.milestones restrict;

alter table public.planning_item_historical_links
  rename constraint planning_item_legacy_ids_pkey to planning_item_historical_links_pkey;
alter table public.planning_item_historical_links
  rename constraint planning_item_legacy_ids_source_kind_task_id_key to planning_item_historical_links_item_type_task_id_key;
alter table public.planning_item_historical_links
  drop constraint planning_item_legacy_ids_task_id_fkey;
alter index public.planning_item_legacy_ids_task_idx rename to planning_item_historical_links_task_idx;
alter policy planning_item_legacy_ids_select_team on public.planning_item_historical_links
  rename to planning_item_historical_links_select_team;

alter table public.team_planning_item_delete_requests
  rename constraint team_planning_milestone_delete_requests_pkey to team_planning_item_delete_requests_pkey;
alter table public.team_planning_item_delete_requests
  rename constraint team_planning_milestone_delete_req_token_id_idempotency_key_key
  to team_planning_item_delete_req_token_id_idempotency_key_key;
alter table public.team_planning_item_delete_requests
  rename constraint team_planning_milestone_delete_requests_contract_version_check
  to team_planning_item_delete_requests_contract_version_check;
alter table public.team_planning_item_delete_requests
  rename constraint team_planning_milestone_delete_requests_request_hash_check
  to team_planning_item_delete_requests_request_hash_check;
alter table public.team_planning_item_delete_requests
  rename constraint team_planning_milestone_delete_requests_response_check
  to team_planning_item_delete_requests_response_check;
alter table public.team_planning_item_delete_requests
  rename constraint team_planning_milestone_delete_requests_profile_id_fkey
  to team_planning_item_delete_requests_profile_id_fkey;
alter table public.team_planning_item_delete_requests
  rename constraint team_planning_milestone_delete_requests_token_id_fkey
  to team_planning_item_delete_requests_token_id_fkey;

revoke all on function public.create_browser_planning_item_transaction(jsonb,jsonb,jsonb,text,text,text) from public,anon,authenticated;
revoke all on function public.update_browser_planning_item_transaction(text,timestamptz,jsonb,jsonb,jsonb,text,text,text) from public,anon,authenticated;
revoke all on function public.delete_team_planning_item_transaction(uuid,text,text,timestamptz,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.create_browser_planning_item_transaction(jsonb,jsonb,jsonb,text,text,text) to service_role;
grant execute on function public.update_browser_planning_item_transaction(text,timestamptz,jsonb,jsonb,jsonb,text,text,text) to service_role;
grant execute on function public.delete_team_planning_item_transaction(uuid,text,text,timestamptz,uuid,text,text,text) to service_role;
revoke all on function public.create_team_planning_items_token_v2(text,text,text,text,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.create_team_planning_items_token_v2(text,text,text,text,boolean,boolean,boolean) to service_role;

do $$
begin
  if to_regclass('public.packages') is not null or to_regclass('public.milestones') is not null
     or to_regclass('public.active_packages') is not null
     or to_regclass('public.planning_item_legacy_ids') is not null
     or to_regclass('public.team_planning_milestone_delete_requests') is not null
     or to_regprocedure('public.create_team_planning_items_token_v3(text,text,text,text,boolean,boolean,boolean)') is not null
     or to_regprocedure('public.create_team_planning_items_token_v2(text,text,text,text,boolean,boolean)') is not null
     or exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and (
         (table_name = 'tasks' and column_name in ('package_id', 'milestone_id'))
         or (table_name = 'profile_ui_preferences' and column_name = 'expanded_package_ids')
       )
     ) then
    raise exception using errcode = 'P0001', message = 'planning cutover blocked: legacy schema remains';
  end if;
  if exists (
    select 1
    from planning_cutover_preservation_evidence evidence
    cross join lateral (
      select count(*) as row_count, md5(coalesce(jsonb_agg(to_jsonb(link)
        order by link.item_type, link.historical_id)::text, '[]')) as checksum
      from public.planning_item_historical_links link
    ) actual
    where evidence.dataset = 'historical_links'
      and (evidence.row_count is distinct from actual.row_count or evidence.checksum is distinct from actual.checksum)
  ) or exists (
    select 1
    from planning_cutover_preservation_evidence evidence
    cross join lateral (
      select count(*) as row_count, md5(coalesce(jsonb_agg(to_jsonb(receipt)
        order by receipt.token_id, receipt.idempotency_key)::text, '[]')) as checksum
      from public.team_planning_item_delete_requests receipt
    ) actual
    where evidence.dataset = 'delete_receipts'
      and (evidence.row_count is distinct from actual.row_count or evidence.checksum is distinct from actual.checksum)
  ) or exists (
    select 1
    from public.planning_item_historical_links link
    cross join lateral (
      select array_agg(key order by key) as actual_columns
      from jsonb_object_keys(link.source_snapshot) key
    ) actual
    cross join lateral (
      select array_agg(column_name order by column_name) as expected_columns
      from planning_cutover_source_columns expected
      where expected.item_type = link.item_type
    ) expected
    where actual.actual_columns is distinct from expected.expected_columns
  ) then
    raise exception using errcode = 'P0001', message = 'planning cutover blocked: preserved data is unavailable';
  end if;
end;
$$;

commit;
