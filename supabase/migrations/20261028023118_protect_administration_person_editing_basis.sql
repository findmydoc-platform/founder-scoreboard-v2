-- Preserve separate technical and eligibility transactions and their existing actors.
create or replace function public.update_profile_technical_identity_transaction(
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
  v_expected jsonb := v_patch -> '__expected_technical_identity';
  v_before jsonb;
  v_profile jsonb;
begin
  v_patch := v_patch - '__expected_technical_identity';
  if v_expected is not null then
    if jsonb_typeof(v_expected) <> 'object' then
      raise exception using errcode = '22023', message = 'technical identity basis must be an object';
    end if;
    if not (v_expected ?& array['github_login', 'google_chat_user_id', 'google_chat_dm_space']) or exists (
      select 1 from jsonb_each(v_expected) expected
      where expected.key not in ('github_login', 'google_chat_user_id', 'google_chat_dm_space')
        or jsonb_typeof(expected.value) not in ('string', 'null')
    ) then
      raise exception using errcode = '22023', message = 'technical identity basis is invalid';
    end if;
  end if;
  v_actor_profile_id := public.require_active_administrator_profile();
  if jsonb_typeof(v_patch) <> 'object' or exists (
    select 1 from jsonb_object_keys(v_patch) as key
    where key not in (
      'github_login', 'google_chat_user_id', 'google_chat_dm_space'
    )
  ) then
    raise exception using errcode = '22023', message = 'technical identity patch contains an unsupported field';
  end if;

  select jsonb_build_object(
    'id', profile.id,
    'github_login', profile.github_login,
    'google_chat_user_id', profile.google_chat_user_id,
    'google_chat_dm_space', profile.google_chat_dm_space
  )
  into v_before
  from public.profiles as profile
  where profile.id = p_profile_id
  for update;
  if v_before is null then
    raise exception using errcode = 'P0002', message = 'profile not found';
  end if;

  v_actor_profile_id := public.require_active_administrator_profile();
  if v_expected is not null and (v_before - 'id') is distinct from v_expected then
    raise exception using errcode = 'P0019', message = 'technical identity was changed concurrently';
  end if;

  update public.profiles as profile
  set github_login = case when v_patch ? 'github_login' then nullif(v_patch ->> 'github_login', '') else profile.github_login end,
      google_chat_user_id = case when v_patch ? 'google_chat_user_id' then nullif(v_patch ->> 'google_chat_user_id', '') else profile.google_chat_user_id end,
      google_chat_dm_space = case when v_patch ? 'google_chat_dm_space' then nullif(v_patch ->> 'google_chat_dm_space', '') else profile.google_chat_dm_space end
  where profile.id = p_profile_id
  returning jsonb_build_object(
    'id', profile.id,
    'github_login', profile.github_login,
    'google_chat_user_id', profile.google_chat_user_id,
    'google_chat_dm_space', profile.google_chat_dm_space
  ) into v_profile;

  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id,
    before_data, after_data, request_ip, user_agent
  ) values (
    v_actor_profile_id, 'profile.technical_identity.update', 'profile', p_profile_id,
    v_before, v_profile, p_request_ip, p_user_agent
  );

  return jsonb_build_object('profile', v_profile);
end;
$$;

create or replace function public.set_administrator_eligibility(
  p_profile_id text,
  p_eligible boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
  v_access public.administrator_access_grants%rowtype;
begin
  select actor.platform_role
  into v_actor_role
  from public.profiles as actor
  where actor.auth_user_id = (select auth.uid());

  if v_actor_role is null then
    raise exception using errcode = '42501', message = 'administrator eligibility manager required';
  end if;
  if v_actor_role <> 'ceo' then
    perform public.require_active_administrator_profile();
  end if;

  perform 1 from public.profiles where id = p_profile_id for no key update;
  if not found then
    raise exception using errcode = 'P0002', message = 'profile not found';
  end if;
  -- Activation and ending access can hold the target grant independently.
  -- Recheck actor authority only after every target row wait has finished.
  perform 1 from public.administrator_access_grants
  where profile_id = p_profile_id for update;
  select actor.platform_role into v_actor_role
  from public.profiles actor where actor.auth_user_id = (select auth.uid());
  if v_actor_role is null then
    raise exception using errcode = '42501', message = 'administrator eligibility manager required';
  end if;
  if v_actor_role <> 'ceo' then
    perform public.require_active_administrator_profile();
  end if;

  insert into public.administrator_access_grants (profile_id, eligible, active_until)
  values (p_profile_id, p_eligible, null)
  on conflict (profile_id) do update
  set eligible = excluded.eligible,
      active_until = case
        when excluded.eligible then public.administrator_access_grants.active_until
        else null
      end
  returning * into v_access;

  return jsonb_build_object(
    'profileId', v_access.profile_id,
    'eligible', v_access.eligible,
    'active', coalesce(v_access.eligible and v_access.active_until > clock_timestamp(), false),
    'expiresAt', case
      when v_access.eligible and v_access.active_until > clock_timestamp()
        then to_jsonb(v_access.active_until)
      else null::jsonb
    end
  );
end;
$$;

create or replace function public.set_administrator_eligibility_if_current(
  p_profile_id text,
  p_expected_eligible boolean,
  p_eligible boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
  v_eligible boolean;
begin
  select actor.platform_role into v_actor_role
  from public.profiles actor where actor.auth_user_id = (select auth.uid());
  if v_actor_role is null then
    raise exception using errcode = '42501', message = 'administrator eligibility manager required';
  end if;
  if v_actor_role <> 'ceo' then
    perform public.require_active_administrator_profile();
  end if;
  if p_expected_eligible is null or p_eligible is null then
    raise exception using errcode = '22023', message = 'administrator eligibility basis is required';
  end if;

  -- Both old and new writers lock the existing profile even when no grant exists.
  perform 1 from public.profiles where id = p_profile_id for no key update;
  if not found then
    raise exception using errcode = 'P0002', message = 'profile not found';
  end if;
  -- Activation and ending access can hold the target grant independently.
  -- Recheck actor authority only after every target row wait has finished.
  perform 1 from public.administrator_access_grants
  where profile_id = p_profile_id for update;
  select actor.platform_role into v_actor_role
  from public.profiles actor where actor.auth_user_id = (select auth.uid());
  if v_actor_role is null then
    raise exception using errcode = '42501', message = 'administrator eligibility manager required';
  end if;
  if v_actor_role <> 'ceo' then
    perform public.require_active_administrator_profile();
  end if;

  select eligible into v_eligible from public.administrator_access_grants where profile_id = p_profile_id;
  if coalesce(v_eligible, false) is distinct from p_expected_eligible then
    raise exception using errcode = 'P0020', message = 'administrator eligibility was changed concurrently';
  end if;
  return public.set_administrator_eligibility(p_profile_id, p_eligible);
end;
$$;

revoke all on function public.set_administrator_eligibility_if_current(text, boolean, boolean) from public, anon;
grant execute on function public.set_administrator_eligibility_if_current(text, boolean, boolean) to authenticated;

create or replace function public.administrator_directory_snapshot()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
  v_technical boolean := false;
  v_people jsonb;
  v_project jsonb;
begin
  select profile.platform_role
  into v_actor_role
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid());

  if v_actor_role is null then
    raise exception using errcode = '42501', message = 'mapped team profile required';
  end if;

  v_technical := public.current_profile_has_active_administrator_access();
  if v_actor_role <> 'ceo' and not v_technical then
    raise exception using errcode = '42501', message = 'administrator eligibility manager required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', profile.id,
    'name', profile.name,
    'platformRole', profile.platform_role,
    'orgRole', coalesce(profile.org_role, ''),
    'technicalBasis', case when v_technical then jsonb_build_object(
      'githubLogin', profile.github_login,
      'googleChatUserId', profile.google_chat_user_id,
      'googleChatDmSpace', profile.google_chat_dm_space
    ) else null end,
    'githubLogin', case when v_technical then coalesce(profile.github_login, '') else '' end,
    'githubConnection', case
      when not v_technical then null
      else jsonb_build_object(
        'status', case
          when nullif(btrim(coalesce(profile.github_login, '')), '') is null then 'incomplete'
          when profile.auth_user_id is null then 'incomplete'
          when github_identity.identity_count <> 1 then 'incomplete'
          when github_identity.matching_identity_count <> 1 then 'incomplete'
          when github_identity.last_sign_in_at is null then 'prepared'
          else 'active'
        end,
        'description', case
          when nullif(btrim(coalesce(profile.github_login, '')), '') is null
            then 'GitHub-Login fehlt.'
          when profile.auth_user_id is null
            then 'Das Profil ist noch keiner FounderOps-Anmeldung zugeordnet.'
          when github_identity.identity_count = 0
            then 'Der FounderOps-Anmeldung ist keine GitHub-Identität zugeordnet.'
          when github_identity.identity_count > 1
            then 'Die GitHub-Identität ist nicht eindeutig.'
          when github_identity.matching_identity_count <> 1
            then 'GitHub-Login und GitHub-Identität stimmen nicht überein.'
          when github_identity.last_sign_in_at is null
            then 'GitHub ist vorbereitet. Die erste erfolgreiche Anmeldung bei FounderOps steht noch aus.'
          else 'GitHub ist aktiv mit FounderOps verbunden.'
        end,
        'lastSignInAt', github_identity.last_sign_in_at
      )
    end,
    'googleChatUserId', case when v_technical then coalesce(profile.google_chat_user_id, '') else '' end,
    'googleChatDmSpace', case when v_technical then coalesce(profile.google_chat_dm_space, '') else '' end,
    'notificationsEnabled', case when v_technical then profile.notifications_enabled is not false else false end,
    'eligible', coalesce(access.eligible, false),
    'activeUntil', case
      when access.eligible and access.active_until > clock_timestamp() then access.active_until
      else null
    end
  ) order by profile.name), '[]'::jsonb)
  into v_people
  from public.profiles as profile
  left join public.administrator_access_grants as access on access.profile_id = profile.id
  left join lateral (
    select
      count(*)::integer as identity_count,
      count(*) filter (
        where lower(btrim(coalesce(identity.identity_data ->> 'user_name', '')))
          = lower(btrim(coalesce(profile.github_login, '')))
      )::integer as matching_identity_count,
      max(identity.last_sign_in_at) filter (
        where lower(btrim(coalesce(identity.identity_data ->> 'user_name', '')))
          = lower(btrim(coalesce(profile.github_login, '')))
      ) as last_sign_in_at
    from auth.identities as identity
    where identity.user_id = profile.auth_user_id
      and identity.provider = 'github'
  ) as github_identity on true;

  if v_technical then
    select jsonb_build_object(
      'id', project.id,
      'owner', coalesce(project.github_project_owner, ''),
      'number', coalesce(project.github_project_number, 0)
    )
    into v_project
    from public.projects as project
    order by project.id
    limit 1;
  end if;

  return jsonb_build_object(
    'people', v_people,
    'project', case when v_technical then v_project else null end
  );
end;
$$;
