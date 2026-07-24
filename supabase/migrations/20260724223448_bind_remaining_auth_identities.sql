do $migration$
declare
  v_target record;
  v_target_profile_count integer;
  v_profile_github_login text;
  v_existing_auth_user_id uuid;
  v_auth_user_id uuid;
  v_identity_count integer;
begin
  select count(*)::integer
    into v_target_profile_count
  from public.profiles as profile
  where profile.id = any (
    array['sebastian', 'volkan', 'anil', 'ozen', 'youssef']::text[]
  );

  -- Fresh local databases apply migrations before loading seed data.
  if v_target_profile_count = 0 then
    return;
  end if;

  if v_target_profile_count <> 5 then
    raise exception
      'Refusing to bind team Auth identities: expected all 5 target profiles, found %',
      v_target_profile_count;
  end if;

  for v_target in
    select *
    from (
      values
        ('sebastian'::text, 'SebastianSchuetze'::text, '7256168'::text),
        ('volkan'::text, 'MehmetVolkan'::text, '186458176'::text),
        ('anil'::text, 'AnilG24'::text, '186387364'::text),
        ('ozen'::text, 'OezenG'::text, '187222752'::text),
        ('youssef'::text, 'YoussefAdlah'::text, '186973821'::text)
    ) as expected(profile_id, github_login, provider_id)
  loop
    select profile.github_login, profile.auth_user_id
      into v_profile_github_login, v_existing_auth_user_id
    from public.profiles as profile
    where profile.id = v_target.profile_id
    for update;

    if not found then
      raise exception
        'Refusing to bind team Auth identities: profile % is missing',
        v_target.profile_id;
    end if;

    if lower(coalesce(v_profile_github_login, '')) <> lower(v_target.github_login) then
      raise exception
        'Refusing to bind profile %: expected GitHub login %, found %',
        v_target.profile_id,
        v_target.github_login,
        coalesce(v_profile_github_login, '<null>');
    end if;

    select count(*)::integer, min(identity_row.user_id::text)::uuid
      into v_identity_count, v_auth_user_id
    from auth.identities as identity_row
    where identity_row.provider = 'github'
      and identity_row.provider_id = v_target.provider_id;

    if v_identity_count <> 1 or v_auth_user_id is null then
      raise exception
        'Refusing to bind profile %: expected exactly one GitHub identity for provider ID %, found %',
        v_target.profile_id,
        v_target.provider_id,
        v_identity_count;
    end if;

    if v_existing_auth_user_id is not null
      and v_existing_auth_user_id <> v_auth_user_id
    then
      raise exception
        'Refusing to replace the existing Auth identity for profile %',
        v_target.profile_id;
    end if;

    if exists (
      select 1
      from public.profiles as profile
      where profile.auth_user_id = v_auth_user_id
        and profile.id <> v_target.profile_id
    ) then
      raise exception
        'Refusing to bind profile %: the GitHub Auth identity is already assigned to another profile',
        v_target.profile_id;
    end if;

    update public.profiles
    set auth_user_id = v_auth_user_id
    where id = v_target.profile_id
      and auth_user_id is distinct from v_auth_user_id;
  end loop;

  if (
    select count(*)::integer
    from public.profiles as profile
    where profile.id = any (
      array['sebastian', 'volkan', 'anil', 'ozen', 'youssef']::text[]
    )
      and profile.auth_user_id is not null
  ) <> 5 then
    raise exception
      'Refusing to finish team Auth identity binding: not all target profiles are linked';
  end if;
end
$migration$;
