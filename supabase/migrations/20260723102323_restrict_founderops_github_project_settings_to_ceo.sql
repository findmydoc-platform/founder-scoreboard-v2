create or replace function public.update_founderops_github_project_transaction(
  p_project_id text,
  p_expected_owner text,
  p_expected_number integer,
  p_github_project_owner text,
  p_github_project_number integer,
  p_actor_profile_id text,
  p_request_ip text,
  p_user_agent text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor public.profiles%rowtype;
  v_project public.projects%rowtype;
begin
  if p_expected_owner is null
    or p_expected_number is null
    or p_github_project_owner is null
    or p_github_project_number is null
    or p_github_project_number <= 0
    or p_github_project_owner <> trim(p_github_project_owner)
    or p_github_project_owner !~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$' then
    raise exception using errcode = '22023', message = 'GitHub Project owner and number are invalid';
  end if;

  select * into v_actor
  from public.profiles
  where id = p_actor_profile_id;

  if not found or v_actor.platform_role <> 'ceo' then
    raise exception using errcode = 'P0005', message = 'only CEO may update the FounderOps GitHub Project';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('founderops-github-project:' || p_project_id, 0));

  select * into v_project
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;
  if v_project.github_project_owner <> p_expected_owner
    or v_project.github_project_number <> p_expected_number then
    raise exception using errcode = 'P0001', message = 'FounderOps GitHub Project settings changed concurrently';
  end if;

  update public.projects
  set github_project_owner = p_github_project_owner,
      github_project_number = p_github_project_number
  where id = p_project_id;

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
    'founderops.github_project.update',
    'project',
    p_project_id,
    jsonb_build_object(
      'githubProjectOwner', v_project.github_project_owner,
      'githubProjectNumber', v_project.github_project_number
    ),
    jsonb_build_object(
      'githubProjectOwner', p_github_project_owner,
      'githubProjectNumber', p_github_project_number
    ),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'project', jsonb_build_object(
      'id', p_project_id,
      'githubProjectOwner', p_github_project_owner,
      'githubProjectNumber', p_github_project_number
    )
  );
end;
$$;

revoke all on function public.update_founderops_github_project_transaction(text, text, integer, text, integer, text, text, text) from public;
grant all on function public.update_founderops_github_project_transaction(text, text, integer, text, integer, text, text, text) to service_role;
