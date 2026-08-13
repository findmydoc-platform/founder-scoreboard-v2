-- Keep the database compatible with the already deployed application while
-- the canonical Planning clients roll out. The application and stored rows
-- remain canonical; only this bounded input adapter accepts the old keys.
create or replace function public.update_profile_settings_transaction(
  p_profile_id text,
  p_profile_patch jsonb default '{}'::jsonb,
  p_ui_preferences jsonb default null::jsonb,
  p_notification_events jsonb default '{}'::jsonb,
  p_request_ip text default null::text,
  p_user_agent text default null::text
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

  select to_jsonb(profile)
  into v_before
  from public.profiles as profile
  where profile.id = p_profile_id
  for update;

  if v_before is null then
    raise exception using errcode = 'P0002', message = 'profile not found';
  end if;

  update public.profiles as profile
  set focus = case when v_patch ? 'focus' then nullif(v_patch ->> 'focus', '') else profile.focus end,
      profile_color = case when v_patch ? 'profile_color' then v_patch ->> 'profile_color' else profile.profile_color end,
      notifications_enabled = case when v_patch ? 'notifications_enabled' then (v_patch ->> 'notifications_enabled')::boolean else profile.notifications_enabled end
  where profile.id = p_profile_id
  returning to_jsonb(profile) into v_profile;

  if p_ui_preferences is not null then
    if jsonb_typeof(p_ui_preferences) <> 'object' then
      raise exception using errcode = '22023', message = 'UI preferences must be a JSON object';
    end if;

    v_filters := coalesce(p_ui_preferences -> 'planning_filters', '{}'::jsonb);
    if jsonb_typeof(v_filters) <> 'object' then
      raise exception using errcode = '22023', message = 'Planning filters must be a JSON object';
    end if;
    if v_filters ? 'packageId' and not v_filters ? 'initiativeId' then
      v_filters := v_filters || jsonb_build_object('initiativeId', v_filters -> 'packageId');
    end if;
    if v_filters ? 'owner' and not v_filters ? 'assignee' then
      v_filters := v_filters || jsonb_build_object('assignee', v_filters -> 'owner');
    end if;
    v_filters := v_filters - array['packageId', 'owner'];

    v_expanded_ids := coalesce(
      p_ui_preferences -> 'expanded_item_ids',
      p_ui_preferences -> 'expanded_package_ids',
      '[]'::jsonb
    );
    if jsonb_typeof(v_expanded_ids) <> 'array' then
      raise exception using errcode = '22023', message = 'Expanded Planning item IDs must be an array';
    end if;

    insert into public.profile_ui_preferences as preference (
      profile_id,
      default_workspace,
      default_task_view,
      planning_filters,
      expanded_item_ids,
      updated_at
    )
    values (
      p_profile_id,
      p_ui_preferences ->> 'default_workspace',
      p_ui_preferences ->> 'default_task_view',
      v_filters,
      array(select jsonb_array_elements_text(v_expanded_ids)),
      now()
    )
    on conflict (profile_id) do update
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
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    request_ip,
    user_agent
  )
  values (
    p_profile_id,
    'profile.self_service.update',
    'profile',
    p_profile_id,
    v_before,
    jsonb_build_object(
      'profile', v_profile,
      'ui_preference', v_ui_preference,
      'notification_events', coalesce(p_notification_events, '{}'::jsonb)
    ),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'profile', v_profile,
    'ui_preference', v_ui_preference,
    'notification_preferences', v_preferences
  );
end;
$$;

alter function public.update_profile_settings_transaction(text, jsonb, jsonb, jsonb, text, text) owner to postgres;
revoke all on function public.update_profile_settings_transaction(text, jsonb, jsonb, jsonb, text, text) from public;
grant all on function public.update_profile_settings_transaction(text, jsonb, jsonb, jsonb, text, text) to service_role;

-- A Browser Initiative save is one atomic strategic transaction, including a
-- possible Epic change. The canonical hierarchy trigger retains the approval
-- reset and parent validation semantics inside the same transaction.
create or replace function public.update_browser_planning_item_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_strategy jsonb,
  p_raci_assignments jsonb,
  p_actor_profile_id text,
  p_request_ip text default null,
  p_user_agent text default null,
  p_legacy_audit_action text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor_role text;
  v_task public.tasks%rowtype;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_result jsonb;
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
  if v_patch ? 'parent_task_id' and v_task.task_type <> 'initiative' then
    raise exception using errcode = '22023', message = 'only an Initiative can change its parent in a strategic revise';
  end if;
  if v_task.task_type = 'epic' and v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'Epic revise requires an operational lead';
  end if;
  if v_task.task_type = 'initiative'
     and v_actor_role not in ('ceo', 'deputy')
     and p_actor_profile_id is distinct from v_task.owner
     and p_actor_profile_id is distinct from v_task.assignee then
    raise exception using errcode = 'P0006', message = 'Initiative revise requires ownership';
  end if;
  if v_actor_role not in ('ceo', 'deputy') and (
    v_patch ?| array['owner', 'assignee', 'parent_task_id'] or p_raci_assignments is not null
  ) then
    raise exception using errcode = 'P0006', message = 'Parent, owner, and RACI changes require an operational lead';
  end if;

  v_result := public.update_planning_item_transaction(
    p_task_id,
    p_expected_updated_at,
    v_patch,
    p_strategy,
    p_raci_assignments,
    p_actor_profile_id
  );
  if nullif(trim(coalesce(p_legacy_audit_action, '')), '') is not null then
    insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data, request_ip, user_agent)
    values (p_actor_profile_id, p_legacy_audit_action, 'milestone', p_task_id, to_jsonb(v_task), v_result->'task', p_request_ip, p_user_agent);
  end if;
  return v_result;
end;
$$;

revoke all on function public.update_browser_planning_item_transaction(text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text) from public;
grant execute on function public.update_browser_planning_item_transaction(text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text) to service_role;
