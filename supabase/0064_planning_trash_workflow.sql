-- Atomic planning trash lifecycle, mutation guards, and durable GitHub lifecycle delivery.

create table if not exists public.planning_github_lifecycle_outbox (
  id uuid primary key default gen_random_uuid(),
  root_type text not null check (root_type in ('initiative', 'deliverable')),
  root_id text not null,
  root_trash_revision integer not null check (root_trash_revision > 0),
  task_id text not null,
  github_repo text,
  github_issue_number integer check (github_issue_number > 0),
  action text not null check (action in ('close_not_planned', 'reopen')),
  source_type text not null check (source_type in ('withdrawn', 'rejected', 'approval')),
  source_revision integer not null check (source_revision > 0),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'retry_scheduled', 'completed', 'failed')),
  status_reason text,
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planning_github_lifecycle_outbox_target_check check (
    github_issue_number is null or nullif(trim(github_repo), '') is not null
  ),
  constraint planning_github_lifecycle_outbox_root_task_action_key unique (
    root_type, root_id, root_trash_revision, task_id, action
  ),
  constraint planning_github_lifecycle_outbox_lock_check check (
    (status = 'processing' and locked_at is not null and lock_token is not null)
    or (status <> 'processing' and locked_at is null and lock_token is null)
  ),
  constraint planning_github_lifecycle_outbox_completion_check check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create index if not exists planning_github_lifecycle_outbox_claim_idx
  on public.planning_github_lifecycle_outbox(status, available_at, created_at)
  where status in ('pending', 'processing', 'retry_scheduled');
create index if not exists planning_github_lifecycle_outbox_task_idx
  on public.planning_github_lifecycle_outbox(task_id, created_at);
create index if not exists planning_github_lifecycle_outbox_root_idx
  on public.planning_github_lifecycle_outbox(root_type, root_id, root_trash_revision, action, status);

alter table public.planning_github_lifecycle_outbox enable row level security;
revoke all on public.planning_github_lifecycle_outbox from public, anon, authenticated;
grant select, insert, update, delete on public.planning_github_lifecycle_outbox to service_role;

create or replace function public.guard_planning_trash_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_bypass boolean := coalesce(current_setting('founderops.trash_lifecycle_write', true), '') = 'on';
begin
  if v_bypass then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0003', message = 'planning items may only be deleted by the lifecycle purge';
  end if;

  if tg_op = 'INSERT' then
    if new.trashed_at is not null
       or new.trashed_by is not null
       or new.trash_reason is not null
       or new.trash_cause is not null
       or new.purge_after is not null
       or new.trash_root_type is not null
       or new.trash_root_id is not null
       or new.trash_revision <> 0 then
      raise exception using errcode = 'P0003', message = 'trash metadata requires the planning trash lifecycle';
    end if;
  else
    if old.trashed_at is not null then
      raise exception using errcode = 'P0003', message = 'trashed planning items are immutable';
    end if;
    if new.trashed_at is distinct from old.trashed_at
       or new.trashed_by is distinct from old.trashed_by
       or new.trash_reason is distinct from old.trash_reason
       or new.trash_cause is distinct from old.trash_cause
       or new.purge_after is distinct from old.purge_after
       or new.trash_root_type is distinct from old.trash_root_type
       or new.trash_root_id is distinct from old.trash_root_id
       or new.trash_revision is distinct from old.trash_revision then
      raise exception using errcode = 'P0003', message = 'trash metadata requires the planning trash lifecycle';
    end if;
  end if;

  if tg_table_name = 'tasks' and new.trashed_at is null then
    if exists (
      select 1 from public.packages
      where id = new.package_id and trashed_at is not null
    ) then
      raise exception using errcode = 'P0003', message = 'active tasks require an active initiative';
    end if;
    if new.task_type = 'sub_issue' and exists (
      select 1 from public.tasks
      where id = new.parent_task_id and trashed_at is not null
    ) then
      raise exception using errcode = 'P0003', message = 'active sub-issues require an active parent deliverable';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_planning_trash_mutation() from public, anon, authenticated;
grant execute on function public.guard_planning_trash_mutation() to service_role;

drop trigger if exists packages_guard_trash_mutation on public.packages;
create trigger packages_guard_trash_mutation
before insert or update or delete on public.packages
for each row execute function public.guard_planning_trash_mutation();

drop trigger if exists tasks_guard_trash_mutation on public.tasks;
create trigger tasks_guard_trash_mutation
before insert or update or delete on public.tasks
for each row execute function public.guard_planning_trash_mutation();

create or replace function public.trash_planning_item_tree_transaction(
  p_root_type text,
  p_root_id text,
  p_expected_revision integer,
  p_actor_profile_id text,
  p_reason text,
  p_cause text,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_trashed_at timestamptz := clock_timestamp();
  v_initiative public.packages%rowtype;
  v_task public.tasks%rowtype;
  v_root_task public.tasks%rowtype;
  v_task_ids text[] := array[]::text[];
  v_event_ids bigint[] := array[]::bigint[];
  v_notification_id bigint;
  v_root_trash_revision integer;
  v_before_data jsonb;
  v_item jsonb;
begin
  if p_root_type not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_root_id, '')), '') is null
     or p_expected_revision < 1
     or p_cause not in ('withdrawn', 'rejected') then
    raise exception using errcode = '22023', message = 'planning trash input is invalid';
  end if;
  if v_reason is null then
    raise exception using errcode = '22023', message = 'planning trash reason is required';
  end if;
  if char_length(v_reason) > 2000 then
    raise exception using errcode = '22023', message = 'planning trash reason exceeds 2000 characters';
  end if;

  select platform_role into v_actor_role
  from public.profiles
  where id = p_actor_profile_id;
  if not found then
    raise exception using errcode = 'P0006', message = 'planning trash actor not found';
  end if;

  if p_root_type = 'initiative' then
    select * into v_initiative
    from public.packages
    where id = p_root_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'initiative not found';
    end if;
    if v_initiative.trashed_at is not null then
      raise exception using errcode = 'P0003', message = 'initiative is already trashed';
    end if;
    if v_initiative.approval_revision <> p_expected_revision then
      raise exception using errcode = 'P0001', message = 'initiative approval revision changed';
    end if;
    if p_cause = 'withdrawn' then
      if v_initiative.approval_status not in ('draft', 'proposed') then
        raise exception using errcode = 'P0003', message = 'only draft or proposed initiatives may be withdrawn';
      end if;
      if v_actor_role not in ('ceo', 'deputy')
         and coalesce(v_initiative.proposed_by, '') <> p_actor_profile_id then
        raise exception using errcode = 'P0006', message = 'initiative withdrawal requires proposer or operational lead';
      end if;
    else
      if v_initiative.approval_status <> 'proposed' then
        raise exception using errcode = 'P0003', message = 'initiative is not proposed';
      end if;
      if v_actor_role <> 'ceo' then
        raise exception using errcode = 'P0006', message = 'only ceo may reject initiative approval';
      end if;
    end if;

    perform id
    from public.tasks
    where package_id = p_root_id and trashed_at is null
    order by id
    for update;

    v_before_data := jsonb_build_object(
      'approvalStatus', v_initiative.approval_status,
      'approvalRevision', v_initiative.approval_revision,
      'trashRevision', v_initiative.trash_revision
    );
    perform set_config('founderops.trash_lifecycle_write', 'on', true);

    update public.packages
    set approval_status = case when p_cause = 'rejected' then 'rejected' else approval_status end,
        approval_revision = case when p_cause = 'rejected' then approval_revision + 1 else approval_revision end,
        decided_by = case when p_cause = 'rejected' then p_actor_profile_id else decided_by end,
        decided_at = case when p_cause = 'rejected' then v_trashed_at else decided_at end,
        decision_note = case when p_cause = 'rejected' then v_reason else decision_note end,
        trashed_at = v_trashed_at,
        trashed_by = p_actor_profile_id,
        trash_reason = v_reason,
        trash_cause = p_cause,
        purge_after = v_trashed_at + interval '90 days',
        trash_root_type = 'initiative',
        trash_root_id = p_root_id,
        trash_revision = trash_revision + 1
    where id = p_root_id
    returning * into v_initiative;

    with updated as (
      update public.tasks
      set trashed_at = v_trashed_at,
          trashed_by = p_actor_profile_id,
          trash_reason = v_reason,
          trash_cause = p_cause,
          purge_after = v_trashed_at + interval '90 days',
          trash_root_type = 'initiative',
          trash_root_id = p_root_id,
          trash_revision = v_initiative.trash_revision,
          updated_at = clock_timestamp()
      where package_id = p_root_id and trashed_at is null
      returning id
    )
    select coalesce(array_agg(id order by id), array[]::text[]) into v_task_ids from updated;

    v_root_trash_revision := v_initiative.trash_revision;
    v_item := to_jsonb(v_initiative);
  else
    select * into v_task
    from public.tasks
    where id = p_root_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'deliverable not found';
    end if;
    if v_task.task_type <> 'deliverable' then
      raise exception using errcode = '22023', message = 'only deliverables may be trashed as task roots';
    end if;
    if v_task.trashed_at is not null then
      raise exception using errcode = 'P0003', message = 'deliverable is already trashed';
    end if;
    if v_task.approval_revision <> p_expected_revision then
      raise exception using errcode = 'P0001', message = 'deliverable approval revision changed';
    end if;

    select * into v_initiative
    from public.packages
    where id = v_task.package_id
    for share;
    if not found or v_initiative.trashed_at is not null then
      raise exception using errcode = 'P0003', message = 'deliverable requires an active initiative';
    end if;

    if p_cause = 'withdrawn' then
      if v_task.approval_status not in ('draft', 'proposed') then
        raise exception using errcode = 'P0003', message = 'only draft or proposed deliverables may be withdrawn';
      end if;
      if v_actor_role not in ('ceo', 'deputy')
         and coalesce(v_task.proposed_by, '') <> p_actor_profile_id then
        raise exception using errcode = 'P0006', message = 'deliverable withdrawal requires proposer or operational lead';
      end if;
    else
      if v_task.approval_status <> 'proposed' then
        raise exception using errcode = 'P0003', message = 'deliverable is not proposed';
      end if;
      if v_actor_role <> 'ceo'
         and coalesce(v_initiative.accountable_profile_id, '') <> p_actor_profile_id then
        raise exception using errcode = 'P0006', message = 'deliverable rejection requires ceo or initiative accountable';
      end if;
    end if;

    perform id
    from public.tasks
    where parent_task_id = p_root_id and trashed_at is null
    order by id
    for update;

    v_before_data := jsonb_build_object(
      'approvalStatus', v_task.approval_status,
      'approvalRevision', v_task.approval_revision,
      'trashRevision', v_task.trash_revision
    );
    v_root_trash_revision := v_task.trash_revision + 1;
    perform set_config('founderops.trash_lifecycle_write', 'on', true);

    with updated as (
      update public.tasks
      set approval_status = case
            when id = p_root_id and p_cause = 'rejected' then 'rejected'
            else approval_status
          end,
          approval_revision = case
            when id = p_root_id and p_cause = 'rejected' then approval_revision + 1
            else approval_revision
          end,
          decided_by = case
            when id = p_root_id and p_cause = 'rejected' then p_actor_profile_id
            else decided_by
          end,
          decided_at = case
            when id = p_root_id and p_cause = 'rejected' then v_trashed_at
            else decided_at
          end,
          decision_note = case
            when id = p_root_id and p_cause = 'rejected' then v_reason
            else decision_note
          end,
          sprint_id = case when id = p_root_id then null else sprint_id end,
          review_status = case when id = p_root_id then 'not_requested' else review_status end,
          review_requested_at = case when id = p_root_id then null else review_requested_at end,
          score_points = case when id = p_root_id then 0 else score_points end,
          score_final = case when id = p_root_id then false else score_final end,
          trashed_at = v_trashed_at,
          trashed_by = p_actor_profile_id,
          trash_reason = v_reason,
          trash_cause = p_cause,
          purge_after = v_trashed_at + interval '90 days',
          trash_root_type = 'deliverable',
          trash_root_id = p_root_id,
          trash_revision = v_root_trash_revision,
          updated_at = clock_timestamp()
      where (id = p_root_id or parent_task_id = p_root_id) and trashed_at is null
      returning *
    ), collected as (
      select coalesce(array_agg(id order by id), array[]::text[]) as ids from updated
    )
    select ids into v_task_ids from collected;

    select * into v_root_task from public.tasks where id = p_root_id;
    v_item := to_jsonb(v_root_task);

    insert into public.task_activity (task_id, message)
    values (
      p_root_id,
      case p_cause
        when 'rejected' then 'Deliverable abgelehnt und in den Papierkorb verschoben · Revision ' || v_root_task.approval_revision || ' · Begründung: ' || v_reason
        else 'Deliverable zurückgezogen und in den Papierkorb verschoben · Begründung: ' || v_reason
      end
    );
  end if;

  insert into public.planning_github_lifecycle_outbox (
    root_type,
    root_id,
    root_trash_revision,
    task_id,
    github_repo,
    github_issue_number,
    action,
    source_type,
    source_revision,
    reason
  )
  select
    p_root_type,
    p_root_id,
    v_root_trash_revision,
    task.id,
    coalesce(nullif(task.github_repo, ''), 'findmydoc-platform/management'),
    coalesce(
      task.github_issue_number,
      case when coalesce(task.issue_number, '') ~ '^[0-9]+$' then task.issue_number::integer end
    ),
    'close_not_planned',
    p_cause,
    v_root_trash_revision,
    v_reason
  from public.tasks task
  where task.id = any(v_task_ids)
  on conflict (root_type, root_id, root_trash_revision, task_id, action) do nothing;

  perform set_config('founderops.trash_lifecycle_write', 'off', true);

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    request_ip,
    user_agent
  ) values (
    p_actor_profile_id,
    case
      when p_cause = 'rejected' and p_root_type = 'initiative' then 'initiative.approval_reject'
      when p_cause = 'rejected' then 'task.approval_reject'
      when p_root_type = 'initiative' then 'initiative.withdrawn'
      else 'task.withdrawn'
    end,
    case when p_root_type = 'initiative' then 'initiative' else 'task' end,
    p_root_id,
    v_before_data,
    jsonb_build_object(
      'trashCause', p_cause,
      'trashReason', v_reason,
      'trashRevision', v_root_trash_revision,
      'affectedTaskIds', to_jsonb(v_task_ids),
      'approvalStatus', v_item->'approval_status',
      'approvalRevision', v_item->'approval_revision'
    ),
    p_request_ip,
    p_user_agent
  );

  if p_cause = 'rejected' then
    if p_root_type = 'initiative' then
      if v_initiative.proposed_by is not null then
        insert into public.notification_events (
          type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body, dedupe_key
        ) values (
          'planning_item.rejected', p_actor_profile_id, v_initiative.proposed_by, 'initiative', p_root_id,
          'Initiative abgelehnt: ' || v_initiative.title,
          'Begründung: ' || v_reason,
          'planning-item-rejected:initiative:' || p_root_id || ':' || v_initiative.approval_revision
        ) returning id into v_notification_id;
      end if;
    elsif v_root_task.proposed_by is not null then
      insert into public.notification_events (
        type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body, dedupe_key
      ) values (
        'planning_item.rejected', p_actor_profile_id, v_root_task.proposed_by, 'task', p_root_id,
        'Deliverable abgelehnt: ' || v_root_task.title,
        'Begründung: ' || v_reason,
        'planning-item-rejected:task:' || p_root_id || ':' || v_root_task.approval_revision
      ) returning id into v_notification_id;
    end if;
    if v_notification_id is not null then
      v_event_ids := array_append(v_event_ids, v_notification_id);
    end if;
  end if;

  return jsonb_build_object(
    'rootType', p_root_type,
    'rootId', p_root_id,
    'affectedTaskIds', to_jsonb(v_task_ids),
    'trashRevision', v_root_trash_revision,
    'item', v_item,
    'eventIds', to_jsonb(v_event_ids)
  );
end;
$$;

create or replace function public.withdraw_planning_item_transaction(
  p_root_type text,
  p_root_id text,
  p_expected_revision integer,
  p_actor_profile_id text,
  p_reason text,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.trash_planning_item_tree_transaction(
    p_root_type,
    p_root_id,
    p_expected_revision,
    p_actor_profile_id,
    p_reason,
    'withdrawn',
    p_request_ip,
    p_user_agent
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
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_initiative public.packages%rowtype;
  v_root_task public.tasks%rowtype;
  v_task_ids text[] := array[]::text[];
  v_before_data jsonb;
  v_item jsonb;
begin
  if p_root_type not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_root_id, '')), '') is null
     or p_expected_trash_revision < 1 then
    raise exception using errcode = '22023', message = 'planning restore input is invalid';
  end if;

  select platform_role into v_actor_role
  from public.profiles
  where id = p_actor_profile_id;
  if not found or v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'planning restore requires operational lead';
  end if;

  if p_root_type = 'initiative' then
    select * into v_initiative
    from public.packages
    where id = p_root_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'initiative not found';
    end if;
    if v_initiative.trashed_at is null
       or v_initiative.trash_root_type <> 'initiative'
       or v_initiative.trash_root_id <> p_root_id then
      raise exception using errcode = 'P0003', message = 'initiative is not a trash root';
    end if;
    if v_initiative.trash_revision <> p_expected_trash_revision then
      raise exception using errcode = 'P0001', message = 'initiative trash revision changed';
    end if;

    perform id
    from public.tasks
    where trash_root_type = 'initiative'
      and trash_root_id = p_root_id
      and trash_revision = p_expected_trash_revision
      and trashed_at is not null
    order by id
    for update;

    v_before_data := jsonb_build_object(
      'trashCause', v_initiative.trash_cause,
      'trashReason', v_initiative.trash_reason,
      'trashRevision', v_initiative.trash_revision
    );
    perform set_config('founderops.trash_lifecycle_write', 'on', true);

    update public.packages
    set approval_status = 'draft',
        approval_revision = approval_revision + 1,
        decided_by = null,
        decided_at = null,
        decision_note = null,
        trashed_at = null,
        trashed_by = null,
        trash_reason = null,
        trash_cause = null,
        purge_after = null,
        trash_root_type = null,
        trash_root_id = null
    where id = p_root_id
    returning * into v_initiative;

    with updated as (
      update public.tasks
      set approval_status = case when task_type = 'deliverable' then 'proposed' else null end,
          approval_revision = case when task_type = 'deliverable' then approval_revision + 1 else approval_revision end,
          proposed_at = case when task_type = 'deliverable' then clock_timestamp() else proposed_at end,
          decided_by = case when task_type = 'deliverable' then null else decided_by end,
          decided_at = case when task_type = 'deliverable' then null else decided_at end,
          decision_note = case when task_type = 'deliverable' then null else decision_note end,
          sprint_id = case when task_type = 'deliverable' then null else sprint_id end,
          review_status = case when task_type = 'deliverable' then 'not_requested' else review_status end,
          review_requested_at = case when task_type = 'deliverable' then null else review_requested_at end,
          score_points = case when task_type = 'deliverable' then 0 else score_points end,
          score_final = case when task_type = 'deliverable' then false else score_final end,
          trashed_at = null,
          trashed_by = null,
          trash_reason = null,
          trash_cause = null,
          purge_after = null,
          trash_root_type = null,
          trash_root_id = null,
          updated_at = clock_timestamp()
      where trash_root_type = 'initiative'
        and trash_root_id = p_root_id
        and trash_revision = p_expected_trash_revision
        and trashed_at is not null
      returning id
    )
    select coalesce(array_agg(id order by id), array[]::text[]) into v_task_ids from updated;

    v_item := to_jsonb(v_initiative);
  else
    select * into v_root_task
    from public.tasks
    where id = p_root_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'deliverable not found';
    end if;
    if v_root_task.task_type <> 'deliverable'
       or v_root_task.trashed_at is null
       or v_root_task.trash_root_type <> 'deliverable'
       or v_root_task.trash_root_id <> p_root_id then
      raise exception using errcode = 'P0003', message = 'deliverable is not a trash root';
    end if;
    if v_root_task.trash_revision <> p_expected_trash_revision then
      raise exception using errcode = 'P0001', message = 'deliverable trash revision changed';
    end if;

    perform id
    from public.tasks
    where trash_root_type = 'deliverable'
      and trash_root_id = p_root_id
      and trash_revision = p_expected_trash_revision
      and trashed_at is not null
    order by id
    for update;

    v_before_data := jsonb_build_object(
      'trashCause', v_root_task.trash_cause,
      'trashReason', v_root_task.trash_reason,
      'trashRevision', v_root_task.trash_revision
    );
    perform set_config('founderops.trash_lifecycle_write', 'on', true);

    with updated as (
      update public.tasks
      set approval_status = case when id = p_root_id then 'draft' else approval_status end,
          approval_revision = case when id = p_root_id then approval_revision + 1 else approval_revision end,
          decided_by = case when id = p_root_id then null else decided_by end,
          decided_at = case when id = p_root_id then null else decided_at end,
          decision_note = case when id = p_root_id then null else decision_note end,
          sprint_id = case when id = p_root_id then null else sprint_id end,
          review_status = case when id = p_root_id then 'not_requested' else review_status end,
          review_requested_at = case when id = p_root_id then null else review_requested_at end,
          score_points = case when id = p_root_id then 0 else score_points end,
          score_final = case when id = p_root_id then false else score_final end,
          trashed_at = null,
          trashed_by = null,
          trash_reason = null,
          trash_cause = null,
          purge_after = null,
          trash_root_type = null,
          trash_root_id = null,
          updated_at = clock_timestamp()
      where trash_root_type = 'deliverable'
        and trash_root_id = p_root_id
        and trash_revision = p_expected_trash_revision
        and trashed_at is not null
      returning id
    )
    select coalesce(array_agg(id order by id), array[]::text[]) into v_task_ids from updated;

    select * into v_root_task from public.tasks where id = p_root_id;
    v_item := to_jsonb(v_root_task);
    insert into public.task_activity (task_id, message)
    values (p_root_id, 'Deliverable aus dem Papierkorb wiederhergestellt · neue Freigabe erforderlich');
  end if;

  perform set_config('founderops.trash_lifecycle_write', 'off', true);

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    request_ip,
    user_agent
  ) values (
    p_actor_profile_id,
    case when p_root_type = 'initiative' then 'initiative.restored' else 'task.restored' end,
    p_root_type,
    p_root_id,
    v_before_data,
    jsonb_build_object(
      'trashRevision', p_expected_trash_revision,
      'affectedTaskIds', to_jsonb(v_task_ids),
      'approvalStatus', v_item->'approval_status',
      'approvalRevision', v_item->'approval_revision'
    ),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'rootType', p_root_type,
    'rootId', p_root_id,
    'affectedTaskIds', to_jsonb(v_task_ids),
    'trashRevision', p_expected_trash_revision,
    'item', v_item,
    'eventIds', '[]'::jsonb
  );
end;
$$;

create or replace function public.claim_planning_github_lifecycle_jobs(
  p_lock_token uuid,
  p_limit integer default 25,
  p_lease_seconds integer default 120
)
returns setof public.planning_github_lifecycle_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_lock_token is null or p_limit not between 1 and 100 or p_lease_seconds not between 30 and 900 then
    raise exception using errcode = '22023', message = 'planning github lifecycle claim input is invalid';
  end if;

  return query
  with candidates as (
    select job.id
    from public.planning_github_lifecycle_outbox job
    where (
      (job.status in ('pending', 'retry_scheduled') and job.available_at <= now())
      or (job.status = 'processing' and job.locked_at < now() - make_interval(secs => p_lease_seconds))
    )
      and not exists (
        select 1
        from public.planning_github_lifecycle_outbox predecessor
        where predecessor.task_id = job.task_id
          and predecessor.status <> 'completed'
          and (
            predecessor.created_at < job.created_at
            or (predecessor.created_at = job.created_at and predecessor.id::text < job.id::text)
          )
      )
    order by job.created_at, job.id
    for update skip locked
    limit p_limit
  )
  update public.planning_github_lifecycle_outbox job
  set status = 'processing',
      attempts = attempts + 1,
      locked_at = clock_timestamp(),
      lock_token = p_lock_token,
      status_reason = null,
      last_error = null,
      updated_at = clock_timestamp()
  from candidates
  where job.id = candidates.id
  returning job.*;
end;
$$;

create or replace function public.finalize_planning_github_lifecycle_job(
  p_job_id uuid,
  p_lock_token uuid,
  p_succeeded boolean,
  p_error_message text default null,
  p_status_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.planning_github_lifecycle_outbox%rowtype;
  v_error text := left(nullif(trim(coalesce(p_error_message, '')), ''), 2000);
  v_status_reason text := left(nullif(trim(coalesce(p_status_reason, '')), ''), 120);
begin
  if p_job_id is null or p_lock_token is null or p_succeeded is null then
    raise exception using errcode = '22023', message = 'planning github lifecycle finalize input is invalid';
  end if;
  if not p_succeeded and v_error is null then
    raise exception using errcode = '22023', message = 'planning github lifecycle error is required';
  end if;

  select * into v_job
  from public.planning_github_lifecycle_outbox
  where id = p_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning github lifecycle job not found';
  end if;
  if v_job.status <> 'processing' or v_job.lock_token is distinct from p_lock_token then
    raise exception using errcode = 'P0001', message = 'planning github lifecycle lease changed';
  end if;

  update public.planning_github_lifecycle_outbox
      set status = case
        when p_succeeded then 'completed'
        when attempts >= 5 then 'failed'
        else 'retry_scheduled'
      end,
      available_at = case
        when p_succeeded or attempts >= 5 then available_at
        else clock_timestamp() + make_interval(secs => least(3600, (power(2, least(attempts, 6)) * 60)::integer))
      end,
      locked_at = null,
      lock_token = null,
      completed_at = case when p_succeeded then clock_timestamp() else null end,
      status_reason = coalesce(
        v_status_reason,
        case when p_succeeded then 'delivered' when attempts >= 5 then 'delivery_failed' else 'retry_after_error' end
      ),
      last_error = case when p_succeeded then null else v_error end,
      updated_at = clock_timestamp()
  where id = p_job_id
  returning * into v_job;

  return to_jsonb(v_job);
end;
$$;

create or replace function public.decide_initiative_approval_transaction(
  p_initiative_id text,
  p_expected_revision integer,
  p_action text,
  p_actor_profile_id text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_initiative public.packages%rowtype;
  v_actor_role text;
  v_next_status text;
  v_before_status text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_notification_recipient_id text;
  v_trash_result jsonb;
begin
  if p_action not in ('approve', 'reject', 'return_to_draft') or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'initiative approval input is invalid';
  end if;
  if char_length(v_note) > 2000 then
    raise exception using errcode = '22023', message = 'approval decision note exceeds 2000 characters';
  end if;
  if p_action in ('reject', 'return_to_draft') and v_note is null then
    raise exception using errcode = '22023', message = 'approval decision note is required';
  end if;

  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  if not found then raise exception using errcode = 'P0006', message = 'approval actor not found'; end if;

  select * into v_initiative from public.packages where id = p_initiative_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'initiative not found'; end if;
  if v_initiative.trashed_at is not null then raise exception using errcode = 'P0003', message = 'initiative is trashed'; end if;
  if v_initiative.approval_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'initiative approval revision changed';
  end if;
  if v_initiative.approval_status <> 'proposed' then
    raise exception using errcode = 'P0003', message = 'initiative is not proposed';
  end if;

  if p_action in ('approve', 'reject') and v_actor_role <> 'ceo' then
    raise exception using errcode = 'P0006', message = 'only ceo may decide initiative approval';
  end if;
  if p_action = 'return_to_draft' and v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'initiative may only be returned by operational lead';
  end if;

  if p_action = 'reject' then
    v_trash_result := public.trash_planning_item_tree_transaction(
      'initiative', p_initiative_id, p_expected_revision, p_actor_profile_id, v_note, 'rejected', null, null
    );
    return v_trash_result->'item';
  end if;

  v_before_status := v_initiative.approval_status;
  v_notification_recipient_id := v_initiative.proposed_by;
  v_next_status := case p_action when 'approve' then 'approved' else 'draft' end;
  update public.packages
  set approval_status = v_next_status,
      approval_revision = approval_revision + 1,
      decided_by = case when p_action = 'approve' then p_actor_profile_id else null end,
      decided_at = case when p_action = 'approve' then now() else null end,
      decision_note = v_note
  where id = p_initiative_id
  returning * into v_initiative;

  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_profile_id, 'initiative.approval_' || p_action, 'initiative', p_initiative_id,
    jsonb_build_object('approvalStatus', v_before_status, 'revision', p_expected_revision),
    jsonb_build_object('approvalStatus', v_next_status, 'revision', v_initiative.approval_revision, 'note', v_note));

  if p_action = 'return_to_draft' and v_notification_recipient_id is not null then
    insert into public.notification_events (
      type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body, dedupe_key
    ) values (
      'planning_item.returned', p_actor_profile_id, v_notification_recipient_id, 'initiative', p_initiative_id,
      'Initiative zur Überarbeitung: ' || v_initiative.title,
      'Begründung: ' || v_note,
      'planning-item-returned:initiative:' || p_initiative_id || ':' || v_initiative.approval_revision
    );
  end if;

  return to_jsonb(v_initiative);
end;
$$;

create or replace function public.decide_deliverable_approval_transaction(
  p_task_id text,
  p_expected_revision integer,
  p_action text,
  p_actor_profile_id text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks%rowtype;
  v_initiative public.packages%rowtype;
  v_actor_role text;
  v_next_status text;
  v_before_status text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_notification_recipient_id text;
  v_trash_result jsonb;
begin
  if p_action not in ('approve', 'reject', 'return_to_draft') or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'deliverable approval input is invalid';
  end if;
  if char_length(v_note) > 2000 then
    raise exception using errcode = '22023', message = 'approval decision note exceeds 2000 characters';
  end if;
  if p_action in ('reject', 'return_to_draft') and v_note is null then
    raise exception using errcode = '22023', message = 'approval decision note is required';
  end if;

  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  if not found then raise exception using errcode = 'P0006', message = 'approval actor not found'; end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'deliverable not found'; end if;
  if v_task.task_type <> 'deliverable' then raise exception using errcode = '22023', message = 'task is not a deliverable'; end if;
  if v_task.trashed_at is not null then raise exception using errcode = 'P0003', message = 'deliverable is trashed'; end if;
  if v_task.approval_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'deliverable approval revision changed';
  end if;
  if v_task.approval_status <> 'proposed' then
    raise exception using errcode = 'P0003', message = 'deliverable is not proposed';
  end if;

  select * into v_initiative from public.packages where id = v_task.package_id for share;
  if not found or v_initiative.trashed_at is not null then
    raise exception using errcode = 'P0003', message = 'deliverable requires an active initiative';
  end if;

  if p_action in ('approve', 'reject')
     and v_actor_role <> 'ceo'
     and coalesce(v_initiative.accountable_profile_id, '') <> p_actor_profile_id then
    raise exception using errcode = 'P0006', message = 'deliverable approval requires ceo or initiative accountable';
  end if;
  if p_action = 'return_to_draft'
     and v_actor_role not in ('ceo', 'deputy')
     and coalesce(v_initiative.accountable_profile_id, '') <> p_actor_profile_id then
    raise exception using errcode = 'P0006', message = 'deliverable may only be returned by operational lead or accountable';
  end if;
  if p_action = 'approve' and v_initiative.approval_status <> 'approved' then
    raise exception using errcode = 'P0003', message = 'initiative must be approved first';
  end if;

  if p_action = 'reject' then
    v_trash_result := public.trash_planning_item_tree_transaction(
      'deliverable', p_task_id, p_expected_revision, p_actor_profile_id, v_note, 'rejected', null, null
    );
    return v_trash_result->'item';
  end if;

  v_before_status := v_task.approval_status;
  v_notification_recipient_id := v_task.proposed_by;
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
      github_issue_sync_status = 'not_synced',
      github_issue_sync_error = null,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning * into v_task;

  insert into public.task_activity (task_id, message)
  values (p_task_id, case p_action
    when 'approve' then 'Deliverable freigegeben · Revision ' || v_task.approval_revision
    else 'Deliverable zur Überarbeitung zurückgegeben · Revision ' || v_task.approval_revision || ' · Begründung: ' || v_note
  end);
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_profile_id, 'task.approval_' || p_action, 'task', p_task_id,
    jsonb_build_object('approvalStatus', v_before_status, 'revision', p_expected_revision),
    jsonb_build_object('approvalStatus', v_next_status, 'revision', v_task.approval_revision, 'note', v_note));

  if p_action = 'approve' then
    insert into public.planning_github_lifecycle_outbox (
      root_type, root_id, root_trash_revision, task_id, github_repo, github_issue_number,
      action, source_type, source_revision, reason
    )
    select
      prior.root_type,
      prior.root_id,
      prior.root_trash_revision,
      linked.id,
      coalesce(nullif(linked.github_repo, ''), 'findmydoc-platform/management'),
      coalesce(
        linked.github_issue_number,
        case when coalesce(linked.issue_number, '') ~ '^[0-9]+$' then linked.issue_number::integer end
      ),
      'reopen',
      'approval',
      v_task.approval_revision,
      null
    from public.tasks linked
    join lateral (
      select closed.root_type, closed.root_id, closed.root_trash_revision
      from public.planning_github_lifecycle_outbox closed
      where closed.task_id = linked.id and closed.action = 'close_not_planned'
      order by closed.root_trash_revision desc, closed.created_at desc
      limit 1
    ) prior on true
    where (linked.id = p_task_id or linked.parent_task_id = p_task_id)
      and linked.trashed_at is null
      and linked.trash_revision > 0
      and coalesce(
        linked.github_issue_number,
        case when coalesce(linked.issue_number, '') ~ '^[0-9]+$' then linked.issue_number::integer end
      ) is not null
    on conflict (root_type, root_id, root_trash_revision, task_id, action) do nothing;
  end if;

  if p_action = 'return_to_draft' and v_notification_recipient_id is not null then
    insert into public.notification_events (
      type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body, dedupe_key
    ) values (
      'planning_item.returned', p_actor_profile_id, v_notification_recipient_id, 'task', p_task_id,
      'Deliverable zur Überarbeitung: ' || v_task.title,
      'Begründung: ' || v_note,
      'planning-item-returned:task:' || p_task_id || ':' || v_task.approval_revision
    );
  end if;

  return to_jsonb(v_task);
end;
$$;

revoke all on function public.trash_planning_item_tree_transaction(text, text, integer, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.withdraw_planning_item_transaction(text, text, integer, text, text, text, text) from public, anon, authenticated;
revoke all on function public.restore_planning_item_transaction(text, text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.claim_planning_github_lifecycle_jobs(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.finalize_planning_github_lifecycle_job(uuid, uuid, boolean, text, text) from public, anon, authenticated;
revoke all on function public.decide_initiative_approval_transaction(text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.decide_deliverable_approval_transaction(text, integer, text, text, text) from public, anon, authenticated;

grant execute on function public.withdraw_planning_item_transaction(text, text, integer, text, text, text, text) to service_role;
grant execute on function public.restore_planning_item_transaction(text, text, integer, text, text, text) to service_role;
grant execute on function public.claim_planning_github_lifecycle_jobs(uuid, integer, integer) to service_role;
grant execute on function public.finalize_planning_github_lifecycle_job(uuid, uuid, boolean, text, text) to service_role;
grant execute on function public.decide_initiative_approval_transaction(text, integer, text, text, text) to service_role;
grant execute on function public.decide_deliverable_approval_transaction(text, integer, text, text, text) to service_role;

comment on table public.planning_github_lifecycle_outbox
is 'Durable, ordered delivery queue for closing or reopening linked GitHub issues after planning trash lifecycle changes.';
comment on function public.withdraw_planning_item_transaction(text, text, integer, text, text, text, text)
is 'Atomically moves an Initiative or Deliverable tree to planning trash after role and revision checks.';
comment on function public.restore_planning_item_transaction(text, text, integer, text, text, text)
is 'Atomically restores one planning trash root while requiring a fresh approval cycle.';

notify pgrst, 'reload schema';
