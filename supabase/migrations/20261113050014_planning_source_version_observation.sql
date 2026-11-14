-- This clock covers the current Planning Board/complete-view reader only.
-- It is not a revision for discussion, Sprint assessment or other consumers.
create or replace function public.planning_source_version()
returns text language sql stable security definer set search_path = '' as $$
  select revision::text from workspace_private.planning_source_revision where singleton;
$$;
revoke all on function public.planning_source_version() from public, anon, authenticated;
grant execute on function public.planning_source_version() to service_role;

-- Planning also returns the actor's stored filters and expanded identities.
-- A conservative shared increment avoids disclosing whose preferences changed.
create or replace function workspace_private.advance_planning_preference_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and to_jsonb(old) is not distinct from to_jsonb(new) then return null; end if;
  update workspace_private.planning_source_revision set revision = revision + 1 where singleton;
  return null;
end;
$$;
revoke all on function workspace_private.advance_planning_preference_revision() from public, anon, authenticated, service_role;
create or replace trigger planning_source_revision after insert or update or delete on public.profile_ui_preferences
for each row execute function workspace_private.advance_planning_preference_revision();
