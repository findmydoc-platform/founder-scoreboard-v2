do $migration$
declare
  v_profile_github_login text;
  v_existing_auth_user_id uuid;
  v_auth_user_id uuid;
  v_identity_count integer;
begin
  select profile.github_login, profile.auth_user_id
    into v_profile_github_login, v_existing_auth_user_id
  from public.profiles as profile
  where profile.id = 'sebastian'
  for update;

  -- Fresh local databases apply migrations before loading seed data.
  if not found then
    return;
  end if;

  if lower(coalesce(v_profile_github_login, '')) <> lower('SebastianSchuetze') then
    raise exception
      'Refusing to bind profile sebastian: expected GitHub login SebastianSchuetze, found %',
      coalesce(v_profile_github_login, '<null>');
  end if;

  select count(*)::integer, min(identity_row.user_id::text)::uuid
    into v_identity_count, v_auth_user_id
  from auth.identities as identity_row
  where identity_row.provider = 'github'
    and identity_row.provider_id = '7256168';

  if v_identity_count <> 1 or v_auth_user_id is null then
    raise exception
      'Refusing to bind profile sebastian: expected exactly one GitHub identity for provider ID 7256168, found %',
      v_identity_count;
  end if;

  if v_existing_auth_user_id is not null
    and v_existing_auth_user_id <> v_auth_user_id
  then
    raise exception
      'Refusing to replace the existing auth identity for profile sebastian';
  end if;

  if exists (
    select 1
    from public.profiles as profile
    where profile.auth_user_id = v_auth_user_id
      and profile.id <> 'sebastian'
  ) then
    raise exception
      'Refusing to bind profile sebastian: the GitHub auth identity is already assigned to another profile';
  end if;

  update public.profiles
  set auth_user_id = v_auth_user_id
  where id = 'sebastian'
    and auth_user_id is distinct from v_auth_user_id;
end
$migration$;
