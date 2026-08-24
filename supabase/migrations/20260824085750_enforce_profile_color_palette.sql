create or replace function public.profile_color_palette()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    '#22c55e',
    '#4f46e5',
    '#f97316',
    '#ec4899',
    '#06b6d4',
    '#ef4444',
    '#84cc16',
    '#8b5cf6',
    '#f59e0b',
    '#1e3a8a',
    '#14b8a6',
    '#c026d3',
    '#92400e',
    '#e11d48',
    '#3b82f6',
    '#0f766e',
    '#64748b',
    '#4d7c0f',
    '#701a75',
    '#334155'
  ]::text[];
$$;

alter function public.profile_color_palette() owner to postgres;
revoke all on function public.profile_color_palette() from public, anon, authenticated;
grant execute on function public.profile_color_palette() to service_role;

with palette as (
  select color, ordinality::integer as position
  from unnest(public.profile_color_palette()) with ordinality as entry(color, ordinality)
),
ranked_profiles as (
  select
    profile.id,
    profile.profile_color,
    palette.position as palette_position,
    row_number() over (partition by profile.profile_color order by profile.id) as occurrence
  from public.profiles as profile
  left join palette on palette.color = profile.profile_color
),
keepers as (
  select id, profile_color
  from ranked_profiles
  where palette_position is not null
    and occurrence = 1
),
available_colors as (
  select
    palette.color,
    row_number() over (order by palette.position) as slot
  from palette
  where not exists (
    select 1
    from keepers
    where keepers.profile_color = palette.color
  )
),
candidates as (
  select
    ranked_profiles.id,
    row_number() over (order by ranked_profiles.id) as slot
  from ranked_profiles
  where ranked_profiles.palette_position is null
     or ranked_profiles.occurrence > 1
),
available_count as (
  select count(*) as free_count
  from available_colors
),
assignments as (
  select
    candidate.id,
    coalesce(
      available.color,
      fallback.color
    ) as color
  from candidates as candidate
  cross join available_count
  left join available_colors as available on available.slot = candidate.slot
  left join palette as fallback
    on fallback.position = mod(candidate.slot - available_count.free_count - 1, 20) + 1
)
update public.profiles as profile
set profile_color = assignment.color
from assignments as assignment
where profile.id = assignment.id
  and profile.profile_color is distinct from assignment.color;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_profile_color_palette'
  ) then
    alter table public.profiles
      add constraint profiles_profile_color_palette
      check (profile_color = any (public.profile_color_palette())) not valid;
  end if;
end;
$$;

alter table public.profiles validate constraint profiles_profile_color_palette;

create or replace function public.apply_profile_color_change(
  p_profile_id text,
  p_requested_color text,
  p_duplicate_mode_observed boolean
) returns text
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_current_color text;
  v_palette text[] := public.profile_color_palette();
  v_palette_full boolean;
begin
  if p_requested_color is null or not (p_requested_color = any (v_palette)) then
    raise exception using errcode = '22023', message = 'profile color is not in the configured palette';
  end if;
  if p_duplicate_mode_observed is null then
    raise exception using errcode = '22023', message = 'profile color duplicate mode is required';
  end if;

  lock table public.profiles in row exclusive mode;
  perform pg_catalog.pg_advisory_xact_lock(59301, 384);

  select profile.profile_color
  into v_current_color
  from public.profiles as profile
  where profile.id = p_profile_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'profile not found';
  end if;
  if v_current_color = p_requested_color then
    return v_current_color;
  end if;

  select count(distinct profile.profile_color) = cardinality(v_palette)
  into v_palette_full
  from public.profiles as profile
  where profile.profile_color = any (v_palette);

  if p_duplicate_mode_observed and not v_palette_full then
    raise exception using errcode = 'P0001', message = 'profile color duplicate mode is stale';
  end if;

  if not (v_palette_full and p_duplicate_mode_observed) and exists (
    select 1
    from public.profiles as profile
    where profile.id <> p_profile_id
      and profile.profile_color = p_requested_color
  ) then
    raise exception using errcode = 'P0001', message = 'profile color is already occupied';
  end if;

  update public.profiles
  set profile_color = p_requested_color
  where id = p_profile_id;

  return p_requested_color;
end;
$$;

alter function public.apply_profile_color_change(text, text, boolean) owner to postgres;
revoke all on function public.apply_profile_color_change(text, text, boolean) from public, anon, authenticated;
grant execute on function public.apply_profile_color_change(text, text, boolean) to service_role;

create or replace function public.assign_profile_color_on_insert()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_existing_color text;
begin
  perform pg_catalog.pg_advisory_xact_lock(59301, 384);

  select profile.profile_color
  into v_existing_color
  from public.profiles as profile
  where profile.id = new.id;

  if found then
    new.profile_color := v_existing_color;
    return new;
  end if;

  select palette.color
  into new.profile_color
  from unnest(public.profile_color_palette()) with ordinality as palette(color, position)
  left join public.profiles as profile on profile.profile_color = palette.color
  group by palette.color, palette.position
  order by count(profile.id), palette.position
  limit 1;

  if new.profile_color is null then
    raise exception using errcode = '22023', message = 'profile color palette is empty';
  end if;
  return new;
end;
$$;

alter function public.assign_profile_color_on_insert() owner to postgres;
revoke all on function public.assign_profile_color_on_insert() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'assign_profile_color_before_insert'
      and not tgisinternal
  ) then
    create trigger assign_profile_color_before_insert
      before insert on public.profiles
      for each row
      execute function public.assign_profile_color_on_insert();
  end if;
end;
$$;

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
set search_path = 'public'
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

  lock table public.profiles in row exclusive mode;

  select to_jsonb(profile)
  into v_before
  from public.profiles as profile
  where profile.id = p_profile_id
  for update;

  if v_before is null then
    raise exception using errcode = 'P0002', message = 'profile not found';
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
revoke all on function public.update_profile_settings_transaction(text, jsonb, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.update_profile_settings_transaction(text, jsonb, jsonb, jsonb, text, text) to service_role;

create or replace function public.update_profile_admin_transaction(
  p_profile_id text,
  p_actor_profile_id text,
  p_profile_patch jsonb default '{}'::jsonb,
  p_notification_events jsonb default '{}'::jsonb,
  p_request_ip text default null::text,
  p_user_agent text default null::text
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_patch jsonb := coalesce(p_profile_patch, '{}'::jsonb);
  v_before jsonb;
  v_profile jsonb;
  v_preferences jsonb;
  v_current_role text;
  v_next_role text;
  v_demoted_ceo_ids text[] := array[]::text[];
begin
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'profile patch must be a JSON object';
  end if;

  lock table public.profiles in share row exclusive mode;

  select to_jsonb(profile), profile.platform_role
  into v_before, v_current_role
  from public.profiles as profile
  where profile.id = p_profile_id;

  if v_before is null then
    raise exception using errcode = 'P0002', message = 'profile not found';
  end if;

  if v_patch ? 'platform_role' then
    v_next_role := v_patch ->> 'platform_role';
    if v_next_role not in ('ceo', 'founder', 'deputy', 'viewer') then
      raise exception using errcode = '22023', message = 'invalid platform role';
    end if;

    if v_next_role = 'ceo' then
      select coalesce(array_agg(profile.id order by profile.id), '{}')
      into v_demoted_ceo_ids
      from public.profiles as profile
      where profile.id <> p_profile_id
        and profile.platform_role = 'ceo';

      update public.profiles
      set platform_role = 'founder',
          org_role = 'Founder',
          deputy_for = null,
          deputy_active_from = null,
          deputy_active_until = null
      where id <> p_profile_id
        and platform_role = 'ceo';
    elsif v_current_role = 'ceo' and not exists (
      select 1
      from public.profiles
      where id <> p_profile_id
        and platform_role = 'ceo'
    ) then
      raise exception using errcode = '23514', message = 'at least one CEO must remain';
    end if;
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
  set github_login = case when v_patch ? 'github_login' then nullif(v_patch ->> 'github_login', '') else profile.github_login end,
      platform_role = case when v_patch ? 'platform_role' then v_patch ->> 'platform_role' else profile.platform_role end,
      org_role = case when v_patch ? 'org_role' then nullif(v_patch ->> 'org_role', '') else profile.org_role end,
      deputy_for = case when v_patch ? 'deputy_for' then nullif(v_patch ->> 'deputy_for', '') else profile.deputy_for end,
      deputy_active_from = case when v_patch ? 'deputy_active_from' then nullif(v_patch ->> 'deputy_active_from', '')::date else profile.deputy_active_from end,
      deputy_active_until = case when v_patch ? 'deputy_active_until' then nullif(v_patch ->> 'deputy_active_until', '')::date else profile.deputy_active_until end,
      focus = case when v_patch ? 'focus' then nullif(v_patch ->> 'focus', '') else profile.focus end,
      weekly_capacity = case when v_patch ? 'weekly_capacity' then (v_patch ->> 'weekly_capacity')::integer else profile.weekly_capacity end,
      google_chat_user_id = case when v_patch ? 'google_chat_user_id' then nullif(v_patch ->> 'google_chat_user_id', '') else profile.google_chat_user_id end,
      google_chat_dm_space = case when v_patch ? 'google_chat_dm_space' then nullif(v_patch ->> 'google_chat_dm_space', '') else profile.google_chat_dm_space end,
      notifications_enabled = case when v_patch ? 'notifications_enabled' then (v_patch ->> 'notifications_enabled')::boolean else profile.notifications_enabled end
  where profile.id = p_profile_id
  returning to_jsonb(profile) into v_profile;

  if (select count(*) from public.profiles where platform_role = 'ceo') <> 1 then
    raise exception using errcode = '23514', message = 'exactly one CEO is required';
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
    p_actor_profile_id,
    'profile.update',
    'profile',
    p_profile_id,
    v_before,
    jsonb_build_object(
      'profile', v_profile,
      'notification_events', coalesce(p_notification_events, '{}'::jsonb),
      'demoted_ceo_ids', to_jsonb(v_demoted_ceo_ids)
    ),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'profile', v_profile,
    'notification_preferences', v_preferences
  );
end;
$$;

alter function public.update_profile_admin_transaction(text, text, jsonb, jsonb, text, text) owner to postgres;
revoke all on function public.update_profile_admin_transaction(text, text, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.update_profile_admin_transaction(text, text, jsonb, jsonb, text, text) to service_role;
