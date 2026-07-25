-- Bind every authorization decision to the immutable Supabase Auth user id.
-- GitHub profile metadata is user-editable and must never select an application role.
create or replace function public.current_profile_id()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select profile.id
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
$function$;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select profile.role
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
$function$;

create or replace function public.current_platform_role()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select profile.platform_role
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
$function$;

-- Keep the existing RLS-governed CRUD contract, but remove privileges that can
-- bypass RLS or manipulate database objects.
revoke create on schema public from public, anon, authenticated;

revoke references, trigger, truncate, maintain
  on all tables in schema public
  from public, anon, authenticated;

-- Existing authenticated inserts only need USAGE for generated identifiers.
-- SELECT/UPDATE also permit sequence inspection or setval-style manipulation.
revoke select, update
  on all sequences in schema public
  from public, anon, authenticated;

-- These are trigger implementations, not Data API RPCs.
revoke execute on function public.allocate_milestone_sort_order()
  from public, anon, authenticated;
revoke execute on function public.normalize_task_approval_state()
  from public, anon, authenticated;
revoke execute on function public.touch_milestone_updated_at()
  from public, anon, authenticated;
revoke execute on function public.touch_package_updated_at()
  from public, anon, authenticated;

-- The three RLS helpers are the complete authenticated RPC allowlist.
revoke execute on function public.current_profile_id() from public, anon;
revoke execute on function public.current_profile_role() from public, anon;
revoke execute on function public.current_platform_role() from public, anon;
grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_platform_role() to authenticated;

-- Viewer is a read-only platform role. Keep tool reads team-wide, but require a
-- planning contributor for direct Data API inserts and updates.
alter policy fmd_tools_insert_team
  on public.fmd_tools
  with check (
    public.current_platform_role() = any (
      array['ceo'::text, 'founder'::text, 'deputy'::text]
    )
  );

alter policy fmd_tools_update_team
  on public.fmd_tools
  using (
    public.current_platform_role() = any (
      array['ceo'::text, 'founder'::text, 'deputy'::text]
    )
  )
  with check (
    public.current_platform_role() = any (
      array['ceo'::text, 'founder'::text, 'deputy'::text]
    )
  );

-- New public-schema objects start private and require an explicit migration grant.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
