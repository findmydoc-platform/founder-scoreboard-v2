-- Planning API GitHub sync is an explicit capability for newly issued
-- tokens. Active tokens at rollout retain parity with their previous API
-- capabilities through a bounded one-time backfill.

ALTER TABLE public.team_task_intake_tokens
  DROP CONSTRAINT IF EXISTS team_task_intake_tokens_scopes_check;

ALTER TABLE public.team_task_intake_tokens
  ADD CONSTRAINT team_task_intake_tokens_scopes_check CHECK (
    array_position(scopes, NULL::text) IS NULL
    AND scopes <@ ARRAY[
      'read:planning-context',
      'write:planning-items:create',
      'write:planning-items:update',
      'write:planning-items:delete-empty',
      'write:planning-items:github-sync'
    ]::text[]
    AND scopes @> ARRAY[
      'read:planning-context',
      'write:planning-items:create'
    ]::text[]
  );

UPDATE public.team_task_intake_tokens
SET scopes = array_append(scopes, 'write:planning-items:github-sync')
WHERE revoked_at IS NULL
  AND expires_at > now()
  AND NOT ('write:planning-items:github-sync' = ANY(scopes));

CREATE OR REPLACE FUNCTION public.authenticate_team_planning_items_token(
  p_token_hash text,
  p_scope text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_profile public.profiles%rowtype;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_scope is null
     or p_scope not in (
       'read:planning-context',
       'write:planning-items:create',
       'write:planning-items:update',
       'write:planning-items:delete-empty',
       'write:planning-items:github-sync'
     ) then
    raise exception using errcode = '22023', message = 'planning items authentication input is invalid';
  end if;

  select * into v_token
  from public.team_task_intake_tokens
  where token_hash = p_token_hash
    and revoked_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception using errcode = 'P0004', message = 'planning items token is inactive';
  end if;
  if not (p_scope = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning items scope is missing';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_token.profile_id
  for share;

  if not found or v_profile.platform_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'planning items profile role is not allowed';
  end if;
  if p_scope = 'write:planning-items:delete-empty'
     and v_profile.platform_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'milestone deletion requires ceo or deputy';
  end if;

  update public.team_task_intake_tokens
  set last_used_at = now()
  where id = v_token.id;

  return jsonb_build_object(
    'tokenId', v_token.id,
    'scopes', v_token.scopes,
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'name', v_profile.name,
      'platformRole', v_profile.platform_role,
      'githubLogin', coalesce(v_profile.github_login, '')
    )
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.create_team_planning_items_token_v3(
  p_profile_id text,
  p_label text,
  p_token_hash text,
  p_token_hint text,
  p_allow_updates boolean DEFAULT false,
  p_allow_empty_milestone_deletes boolean DEFAULT false,
  p_allow_github_sync boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
declare
  v_token jsonb;
begin
  v_token := public.create_team_planning_items_token_v2(
    p_profile_id,
    p_label,
    p_token_hash,
    p_token_hint,
    coalesce(p_allow_updates, false),
    coalesce(p_allow_empty_milestone_deletes, false)
  );

  if coalesce(p_allow_github_sync, false) then
    update public.team_task_intake_tokens
    set scopes = array_append(scopes, 'write:planning-items:github-sync')
    where id = (v_token->>'id')::uuid
      and not ('write:planning-items:github-sync' = any(scopes))
    returning to_jsonb(team_task_intake_tokens) - 'token_hash' into v_token;
  end if;

  return v_token;
end;
$$;

REVOKE ALL ON FUNCTION public.authenticate_team_planning_items_token(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_team_planning_items_token(text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.create_team_planning_items_token_v3(
  text, text, text, text, boolean, boolean, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_team_planning_items_token_v3(
  text, text, text, text, boolean, boolean, boolean
) TO service_role;
