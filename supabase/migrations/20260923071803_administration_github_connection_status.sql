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

revoke all on function public.administrator_directory_snapshot() from public, anon;
grant execute on function public.administrator_directory_snapshot() to authenticated;
