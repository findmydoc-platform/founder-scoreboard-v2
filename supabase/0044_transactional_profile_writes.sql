create table if not exists audit_log (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  actor_profile_id text references profiles(id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  request_ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists notification_preferences (
  id bigint generated always as identity primary key,
  profile_id text not null references profiles(id) on delete cascade,
  channel text not null default 'google_chat' check (channel in ('google_chat', 'in_app', 'github')),
  event_type text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, channel, event_type)
);

create index if not exists audit_log_entity_idx on audit_log(entity_type, entity_id);

grant select, insert on audit_log to authenticated, service_role;
grant select, insert, update, delete on notification_preferences to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

alter table audit_log enable row level security;
alter table notification_preferences enable row level security;

drop policy if exists "audit_log_select_team" on audit_log;
create policy "audit_log_select_team" on audit_log for select to authenticated
using (auth.uid() is not null);

drop policy if exists "audit_log_insert_operational" on audit_log;
create policy "audit_log_insert_operational" on audit_log for insert to authenticated
with check (public.current_platform_role() in ('ceo', 'founder', 'deputy'));

drop policy if exists "notification_preferences_select_team" on notification_preferences;
create policy "notification_preferences_select_team" on notification_preferences for select to authenticated
using (
  public.current_platform_role() in ('ceo', 'deputy')
  or profile_id in (select id from profiles where auth_user_id = auth.uid())
);

drop policy if exists "notification_preferences_write_self_or_operational" on notification_preferences;
create policy "notification_preferences_write_self_or_operational" on notification_preferences for all to authenticated
using (
  public.current_platform_role() in ('ceo', 'deputy')
  or profile_id in (select id from profiles where auth_user_id = auth.uid())
)
with check (
  public.current_platform_role() in ('ceo', 'deputy')
  or profile_id in (select id from profiles where auth_user_id = auth.uid())
);

create or replace function public.upsert_profile_notification_preferences(
  p_profile_id text,
  p_notification_events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_events jsonb := coalesce(p_notification_events, '{}'::jsonb);
  v_preferences jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(v_events) <> 'object' then
    raise exception using errcode = '22023', message = 'notification events must be a JSON object';
  end if;

  if exists (
    select 1
    from jsonb_each(v_events) as event
    where jsonb_typeof(event.value) <> 'boolean'
  ) then
    raise exception using errcode = '22023', message = 'notification event values must be boolean';
  end if;

  insert into public.notification_preferences as preference (
    profile_id,
    channel,
    event_type,
    enabled,
    updated_at
  )
  select
    p_profile_id,
    'google_chat',
    event.key,
    (event.value #>> '{}')::boolean,
    now()
  from jsonb_each(v_events) as event
  on conflict (profile_id, channel, event_type) do update
    set enabled = excluded.enabled,
        updated_at = excluded.updated_at;

  select coalesce(jsonb_agg(to_jsonb(preference) order by preference.event_type), '[]'::jsonb)
  into v_preferences
  from public.notification_preferences as preference
  where preference.profile_id = p_profile_id
    and preference.channel = 'google_chat'
    and preference.event_type in (select key from jsonb_each(v_events));

  return v_preferences;
end;
$$;

create or replace function public.update_profile_admin_transaction(
  p_profile_id text,
  p_actor_profile_id text,
  p_profile_patch jsonb default '{}'::jsonb,
  p_notification_events jsonb default '{}'::jsonb,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patch jsonb := coalesce(p_profile_patch, '{}'::jsonb);
  v_before jsonb;
  v_profile jsonb;
  v_preferences jsonb;
  v_current_role text;
  v_next_role text;
  v_demoted_ceo_ids text[] := '{}';
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

  update public.profiles as profile
  set github_login = case when v_patch ? 'github_login' then nullif(v_patch ->> 'github_login', '') else profile.github_login end,
      platform_role = case when v_patch ? 'platform_role' then v_patch ->> 'platform_role' else profile.platform_role end,
      org_role = case when v_patch ? 'org_role' then nullif(v_patch ->> 'org_role', '') else profile.org_role end,
      deputy_for = case when v_patch ? 'deputy_for' then nullif(v_patch ->> 'deputy_for', '') else profile.deputy_for end,
      deputy_active_from = case when v_patch ? 'deputy_active_from' then nullif(v_patch ->> 'deputy_active_from', '')::date else profile.deputy_active_from end,
      deputy_active_until = case when v_patch ? 'deputy_active_until' then nullif(v_patch ->> 'deputy_active_until', '')::date else profile.deputy_active_until end,
      focus = case when v_patch ? 'focus' then nullif(v_patch ->> 'focus', '') else profile.focus end,
      weekly_capacity = case when v_patch ? 'weekly_capacity' then (v_patch ->> 'weekly_capacity')::integer else profile.weekly_capacity end,
      profile_color = case when v_patch ? 'profile_color' then v_patch ->> 'profile_color' else profile.profile_color end,
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

create or replace function public.update_profile_settings_transaction(
  p_profile_id text,
  p_profile_patch jsonb default '{}'::jsonb,
  p_ui_preferences jsonb default null,
  p_notification_events jsonb default '{}'::jsonb,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
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

    insert into public.profile_ui_preferences as preference (
      profile_id,
      default_workspace,
      default_task_view,
      planning_filters,
      expanded_package_ids,
      updated_at
    )
    values (
      p_profile_id,
      p_ui_preferences ->> 'default_workspace',
      p_ui_preferences ->> 'default_task_view',
      p_ui_preferences -> 'planning_filters',
      array(select jsonb_array_elements_text(p_ui_preferences -> 'expanded_package_ids')),
      now()
    )
    on conflict (profile_id) do update
      set default_workspace = excluded.default_workspace,
          default_task_view = excluded.default_task_view,
          planning_filters = excluded.planning_filters,
          expanded_package_ids = excluded.expanded_package_ids,
          updated_at = excluded.updated_at
    returning jsonb_build_object(
      'profile_id', preference.profile_id,
      'default_workspace', preference.default_workspace,
      'default_task_view', preference.default_task_view,
      'planning_filters', preference.planning_filters,
      'expanded_package_ids', to_jsonb(preference.expanded_package_ids),
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

revoke all on function public.upsert_profile_notification_preferences(text, jsonb) from public, anon, authenticated;
revoke all on function public.update_profile_admin_transaction(text, text, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.update_profile_settings_transaction(text, jsonb, jsonb, jsonb, text, text) from public, anon, authenticated;

grant execute on function public.update_profile_admin_transaction(text, text, jsonb, jsonb, text, text) to service_role;
grant execute on function public.update_profile_settings_transaction(text, jsonb, jsonb, jsonb, text, text) to service_role;

comment on function public.update_profile_admin_transaction(text, text, jsonb, jsonb, text, text)
is 'Atomically updates an admin-managed profile, CEO transfer, notification preferences, and audit entry.';

comment on function public.update_profile_settings_transaction(text, jsonb, jsonb, jsonb, text, text)
is 'Atomically updates self-service profile fields, UI preferences, notification preferences, and audit entry.';

notify pgrst, 'reload schema';
