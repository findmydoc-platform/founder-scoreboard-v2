-- One original-user dispatch establishes live actor and source on the same
-- statement snapshot. No actor identity or role comes from caller arguments.
-- The credential boundary still supplies Workspace permits and JWT checks.
create function public.planning_board_publication_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb;
begin
  select jsonb_build_object('profile_id', profile.id,
    'platform_role', profile.platform_role,
    'source_revision', public.planning_source_version())
  into context
  from public.profiles profile
  where profile.auth_user_id = (select auth.uid())
    and profile.platform_role in ('ceo','deputy','founder','viewer')
    and exists (
      select 1 from auth.sessions session
      where session.user_id = profile.auth_user_id
        and session.id = case when (select auth.jwt()->>'session_id') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
          then (select auth.jwt()->>'session_id')::uuid else null end
        and (session.not_after is null or session.not_after > statement_timestamp())
    );
  if context is null then
    raise insufficient_privilege using message = 'Planning publication access denied';
  end if;
  return context;
end;
$$;
revoke all on function public.planning_board_publication_context() from public, anon, service_role;
grant execute on function public.planning_board_publication_context() to authenticated;
comment on function public.planning_board_publication_context() is
  'Original-user Planning publication fence: current mapped actor, role and source on one statement snapshot; no Item content.';
