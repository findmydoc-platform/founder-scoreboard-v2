-- Return safe credential metadata for Planning API access receipts while
-- preserving the existing inactive-token and profile authorization guards.

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
  v_evaluated_at timestamptz := statement_timestamp();
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
    and expires_at > v_evaluated_at
  for update;

  if not found then
    raise exception using errcode = 'P0004', message = 'planning items token is inactive';
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
    raise exception using errcode = 'P0006', message = 'epic deletion requires ceo or deputy';
  end if;

  update public.team_task_intake_tokens
  set last_used_at = v_evaluated_at
  where id = v_token.id;

  return jsonb_build_object(
    'tokenId', v_token.id,
    'tokenHint', v_token.token_hint,
    'scopes', v_token.scopes,
    'scopeGranted', p_scope = any(v_token.scopes),
    'expiresAt', v_token.expires_at,
    'evaluatedAt', v_evaluated_at,
    'remainingSeconds', greatest(
      0,
      floor(extract(epoch from (v_token.expires_at - v_evaluated_at)))
    )::bigint,
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'name', v_profile.name,
      'platformRole', v_profile.platform_role,
      'githubLogin', coalesce(v_profile.github_login, '')
    )
  );
end;
$$;

REVOKE ALL ON FUNCTION public.authenticate_team_planning_items_token(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_team_planning_items_token(text, text)
  TO service_role;
