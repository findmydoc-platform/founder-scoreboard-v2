alter table public.profile_ui_preferences
  add column if not exists expanded_item_ids text[] not null default '{}'::text[];

alter table public.profile_ui_preferences
  alter column planning_filters set default '{"query":"","assignee":"Alle","status":"Alle","priority":"Alle","review":"Alle","initiativeId":"Alle","quick":[],"sprintId":"Alle","workstream":"Alle","risk":"Alle","targetFrom":"","targetTo":"","sort":"priority","direction":"asc"}'::jsonb;

update public.profile_ui_preferences
set expanded_item_ids = expanded_package_ids
where expanded_item_ids = '{}'::text[]
  and expanded_package_ids <> '{}'::text[];

update public.profile_ui_preferences
set planning_filters = (
  planning_filters - 'packageId'
) || case
  when planning_filters ? 'initiativeId' then '{}'::jsonb
  else jsonb_build_object('initiativeId', planning_filters -> 'packageId')
end
where planning_filters ? 'packageId';

update public.profile_ui_preferences
set planning_filters = (
  planning_filters - 'owner'
) || case
  when planning_filters ? 'assignee' then '{}'::jsonb
  else jsonb_build_object('assignee', planning_filters -> 'owner')
end
where planning_filters ? 'owner';

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
    if p_ui_preferences ? 'expanded_package_ids'
      or (p_ui_preferences -> 'planning_filters') ?| array['packageId', 'owner'] then
      raise exception using errcode = '22023', message = 'legacy Planning preference fields are not supported';
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
      p_ui_preferences -> 'planning_filters',
      array(select jsonb_array_elements_text(p_ui_preferences -> 'expanded_item_ids')),
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
