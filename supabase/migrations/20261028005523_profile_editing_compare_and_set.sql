-- Retain the existing RPC signatures, authority checks and grants.
-- Optional expected business values bind an open editor to its displayed basis.
-- Row locks plus guarded upserts also protect the absence of preference rows.

CREATE OR REPLACE FUNCTION "public"."update_profile_settings_transaction"("p_profile_id" "text", "p_profile_patch" "jsonb" DEFAULT '{}'::"jsonb", "p_ui_preferences" "jsonb" DEFAULT NULL::"jsonb", "p_notification_events" "jsonb" DEFAULT '{}'::"jsonb", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_patch jsonb := coalesce(p_profile_patch, '{}'::jsonb);
  v_filters jsonb;
  v_expanded_ids jsonb;
  v_before jsonb;
  v_profile jsonb;
  v_ui_preference jsonb := null;
  v_preferences jsonb;
  v_expected jsonb := v_patch -> '_expected';
  v_ui_before jsonb;
  v_event_before jsonb;
  v_event record;
  v_count integer;
begin
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'profile patch must be a JSON object';
  end if;

  v_patch := v_patch - '_expected';
  if v_expected is not null and (
    jsonb_typeof(v_expected) <> 'object'
    or exists (select 1 from jsonb_object_keys(v_expected) key where key not in ('profile', 'ui', 'events'))
    or jsonb_typeof(v_expected -> 'profile') is distinct from 'object'
    or jsonb_typeof(coalesce(v_expected -> 'events', '{}'::jsonb)) <> 'object'
    or exists (select 1 from jsonb_object_keys(v_expected -> 'profile') key where key not in ('focus', 'profile_color', 'notifications_enabled') or not v_patch ? key)
    or exists (select 1 from jsonb_object_keys(v_patch - 'profile_color_duplicate_mode') key where not (v_expected -> 'profile') ? key)
    or exists (select 1 from jsonb_object_keys(coalesce(v_expected -> 'events', '{}'::jsonb)) key where not coalesce(p_notification_events, '{}'::jsonb) ? key)
    or exists (select 1 from jsonb_object_keys(coalesce(p_notification_events, '{}'::jsonb)) key where not coalesce(v_expected -> 'events', '{}'::jsonb) ? key)
  ) then
    raise exception using errcode = '22023', message = 'invalid profile editing basis';
  end if;

  lock table public.profiles in row exclusive mode;

  select to_jsonb(profile)
  into v_before
  from public.profiles as profile
  where profile.id = p_profile_id
  for update;

  if v_before is null then
    raise exception using errcode = 'P0002', message = 'profile not found';
  end if;

  if v_expected is not null then
    if exists (select 1 from jsonb_each(v_expected -> 'profile') field where v_before -> field.key is distinct from field.value) then
      raise exception using errcode = 'P0004', message = 'profile editing basis changed';
    end if;
    if p_ui_preferences is not null then
      if not v_expected ? 'ui' or (v_expected -> 'ui' <> 'null'::jsonb and (
        jsonb_typeof(v_expected -> 'ui') <> 'object'
        or (select count(*) from jsonb_object_keys(v_expected -> 'ui')) <> 4
        or not (v_expected -> 'ui') ?& array['default_workspace', 'default_task_view', 'planning_filters', 'expanded_item_ids']
      )) then
        raise exception using errcode = '22023', message = 'invalid UI editing basis';
      end if;
      select jsonb_build_object('default_workspace', preference.default_workspace, 'default_task_view', preference.default_task_view,
        'planning_filters', preference.planning_filters, 'expanded_item_ids', to_jsonb(preference.expanded_item_ids))
      into v_ui_before from public.profile_ui_preferences preference where preference.profile_id = p_profile_id for update;
      if coalesce(v_ui_before, 'null'::jsonb) is distinct from v_expected -> 'ui' then
        raise exception using errcode = 'P0004', message = 'UI editing basis changed';
      end if;
    elsif v_expected ? 'ui' then
      raise exception using errcode = '22023', message = 'unexpected UI editing basis';
    end if;
    for v_event in select key, value from jsonb_each(coalesce(v_expected -> 'events', '{}'::jsonb)) order by key loop
      if jsonb_typeof(v_event.value) not in ('boolean', 'null') then
        raise exception using errcode = '22023', message = 'invalid notification editing basis';
      end if;
      select to_jsonb(preference.enabled) into v_event_before from public.notification_preferences preference
        where preference.profile_id = p_profile_id and preference.channel = 'google_chat' and preference.event_type = v_event.key for update;
      if coalesce(v_event_before, 'null'::jsonb) is distinct from v_event.value then
        raise exception using errcode = 'P0004', message = 'notification editing basis changed';
      end if;
    end loop;
  end if;

  if v_patch ? 'profile_color' then
    if not v_patch ? 'profile_color_duplicate_mode'
       or jsonb_typeof(v_patch -> 'profile_color_duplicate_mode') <> 'boolean' then
      raise exception using errcode = '22023', message = 'profile color duplicate mode is required';
    end if;
    perform public.apply_profile_color_change(
      p_profile_id,
      v_patch ->> 'profile_color',
      (v_patch ->> 'profile_color_duplicate_mode')::boolean
    );
  elsif v_patch ? 'profile_color_duplicate_mode' then
    raise exception using errcode = '22023', message = 'profile color duplicate mode requires a color change';
  end if;

  update public.profiles as profile
  set focus = case when v_patch ? 'focus' then nullif(v_patch ->> 'focus', '') else profile.focus end,
      notifications_enabled = case when v_patch ? 'notifications_enabled' then (v_patch ->> 'notifications_enabled')::boolean else profile.notifications_enabled end
  where profile.id = p_profile_id
  returning to_jsonb(profile) into v_profile;

  if p_ui_preferences is not null then
    if jsonb_typeof(p_ui_preferences) <> 'object' then
      raise exception using errcode = '22023', message = 'UI preferences must be a JSON object';
    end if;

    v_filters := coalesce(p_ui_preferences -> 'planning_filters', '{}'::jsonb);
    if jsonb_typeof(v_filters) <> 'object' or v_filters ?| array['packageId', 'owner'] then
      raise exception using errcode = '22023', message = 'Planning filters must use canonical fields';
    end if;

    v_expanded_ids := coalesce(p_ui_preferences -> 'expanded_item_ids', '[]'::jsonb);
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
      where v_expected is null or (
        v_expected -> 'ui' <> 'null'::jsonb
        and jsonb_build_object('default_workspace', preference.default_workspace, 'default_task_view', preference.default_task_view,
          'planning_filters', preference.planning_filters, 'expanded_item_ids', to_jsonb(preference.expanded_item_ids)) = v_expected -> 'ui'
      )
    returning jsonb_build_object(
      'profile_id', preference.profile_id,
      'default_workspace', preference.default_workspace,
      'default_task_view', preference.default_task_view,
      'planning_filters', preference.planning_filters,
      'expanded_item_ids', to_jsonb(preference.expanded_item_ids),
      'created_at', preference.created_at,
      'updated_at', preference.updated_at
    ) into v_ui_preference;
    if v_ui_preference is null then
      raise exception using errcode = 'P0004', message = 'UI editing basis changed';
    end if;
  end if;

  if v_expected is null then
    v_preferences := public.upsert_profile_notification_preferences(p_profile_id, p_notification_events);
  else
    if jsonb_typeof(coalesce(p_notification_events, '{}'::jsonb)) <> 'object' or exists (
      select 1 from jsonb_each(coalesce(p_notification_events, '{}'::jsonb)) event where jsonb_typeof(event.value) <> 'boolean'
    ) then
      raise exception using errcode = '22023', message = 'notification event values must be boolean';
    end if;
    insert into public.notification_preferences as preference (profile_id, channel, event_type, enabled, updated_at)
      select p_profile_id, 'google_chat', event.key, (event.value #>> '{}')::boolean, now()
      from jsonb_each(coalesce(p_notification_events, '{}'::jsonb)) event
      on conflict (profile_id, channel, event_type) do update set enabled = excluded.enabled, updated_at = excluded.updated_at
      where v_expected -> 'events' -> preference.event_type <> 'null'::jsonb
        and to_jsonb(preference.enabled) = v_expected -> 'events' -> preference.event_type;
    get diagnostics v_count = row_count;
    if v_count <> (select count(*) from jsonb_each(coalesce(p_notification_events, '{}'::jsonb))) then
      raise exception using errcode = 'P0004', message = 'notification editing basis changed';
    end if;
    select coalesce(jsonb_agg(to_jsonb(preference) order by preference.event_type), '[]'::jsonb) into v_preferences
      from public.notification_preferences preference where preference.profile_id = p_profile_id and preference.channel = 'google_chat'
      and preference.event_type in (select key from jsonb_each(coalesce(p_notification_events, '{}'::jsonb)));
  end if;

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

create or replace function public.update_profile_governance_transaction(
  p_profile_id text,
  p_profile_patch jsonb default '{}'::jsonb,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_profile_id text;
  v_patch jsonb := coalesce(p_profile_patch, '{}'::jsonb);
  v_before jsonb;
  v_profile jsonb;
  v_expected jsonb := v_patch -> '_expected';
  v_current_role text;
  v_next_role text;
begin
  select profile.id
  into v_actor_profile_id
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.platform_role = 'ceo';

  if v_actor_profile_id is null then
    raise exception using errcode = '42501', message = 'CEO governance required';
  end if;
  v_patch := v_patch - '_expected';
  if jsonb_typeof(v_patch) <> 'object' or exists (
    select 1 from jsonb_object_keys(v_patch) as key
    where key not in (
      'platform_role', 'org_role', 'deputy_for', 'deputy_active_from',
      'deputy_active_until', 'weekly_capacity'
    )
  ) then
    raise exception using errcode = '22023', message = 'profile governance patch contains an unsupported field';
  end if;

  if v_expected is not null and (
    jsonb_typeof(v_expected) <> 'object'
    or exists (select 1 from jsonb_object_keys(v_expected) key where not v_patch ? key)
    or exists (select 1 from jsonb_object_keys(v_patch) key where not v_expected ? key)
  ) then
    raise exception using errcode = '22023', message = 'invalid governance editing basis';
  end if;

  lock table public.profiles in share row exclusive mode;
  if not exists (select 1 from public.profiles where id = v_actor_profile_id and auth_user_id = (select auth.uid()) and platform_role = 'ceo') then
    raise exception using errcode = '42501', message = 'CEO governance required';
  end if;
  select jsonb_build_object(
    'id', profile.id,
    'name', profile.name,
    'platform_role', profile.platform_role,
    'org_role', profile.org_role,
    'deputy_for', profile.deputy_for,
    'deputy_active_from', profile.deputy_active_from,
    'deputy_active_until', profile.deputy_active_until,
    'weekly_capacity', profile.weekly_capacity
  ), profile.platform_role
  into v_before, v_current_role
  from public.profiles as profile
  where profile.id = p_profile_id;

  if v_before is null then
    raise exception using errcode = 'P0002', message = 'profile not found';
  end if;

  if v_expected is not null and exists (
    select 1 from jsonb_each(v_expected) field where v_before -> field.key is distinct from field.value
  ) then
    raise exception using errcode = 'P0004', message = 'governance editing basis changed';
  end if;

  if v_patch ? 'platform_role' then
    v_next_role := v_patch ->> 'platform_role';
    if v_next_role not in ('ceo', 'founder', 'deputy', 'viewer') then
      raise exception using errcode = '22023', message = 'invalid platform role';
    end if;
    if v_next_role = 'ceo' then
      update public.profiles
      set platform_role = 'founder',
          org_role = 'Founder',
          deputy_for = null,
          deputy_active_from = null,
          deputy_active_until = null
      where id <> p_profile_id and platform_role = 'ceo';
    elsif v_current_role = 'ceo' and not exists (
      select 1 from public.profiles
      where id <> p_profile_id and platform_role = 'ceo'
    ) then
      raise exception using errcode = '23514', message = 'at least one CEO must remain';
    end if;
  end if;

  update public.profiles as profile
  set platform_role = case when v_patch ? 'platform_role' then v_patch ->> 'platform_role' else profile.platform_role end,
      org_role = case when v_patch ? 'org_role' then nullif(v_patch ->> 'org_role', '') else profile.org_role end,
      deputy_for = case when v_patch ? 'deputy_for' then nullif(v_patch ->> 'deputy_for', '') else profile.deputy_for end,
      deputy_active_from = case when v_patch ? 'deputy_active_from' then nullif(v_patch ->> 'deputy_active_from', '')::date else profile.deputy_active_from end,
      deputy_active_until = case when v_patch ? 'deputy_active_until' then nullif(v_patch ->> 'deputy_active_until', '')::date else profile.deputy_active_until end,
      weekly_capacity = case when v_patch ? 'weekly_capacity' then (v_patch ->> 'weekly_capacity')::integer else profile.weekly_capacity end
  where profile.id = p_profile_id
  returning jsonb_build_object(
    'id', profile.id,
    'name', profile.name,
    'platform_role', profile.platform_role,
    'org_role', profile.org_role,
    'deputy_for', profile.deputy_for,
    'deputy_active_from', profile.deputy_active_from,
    'deputy_active_until', profile.deputy_active_until,
    'weekly_capacity', profile.weekly_capacity
  ) into v_profile;

  if (select count(*) from public.profiles where platform_role = 'ceo') <> 1 then
    raise exception using errcode = '23514', message = 'exactly one CEO is required';
  end if;

  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id,
    before_data, after_data, request_ip, user_agent
  ) values (
    v_actor_profile_id, 'profile.governance.update', 'profile', p_profile_id,
    v_before, v_profile, p_request_ip, p_user_agent
  );

  return jsonb_build_object('profile', v_profile);
end;
$$;

-- CREATE OR REPLACE preserves the existing owner and execute grants.
