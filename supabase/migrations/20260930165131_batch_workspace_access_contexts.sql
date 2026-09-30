-- Reuse the existing service-only identity binding checks in one Data API request.
create function public.workspace_access_contexts(p_profile_ids text[])
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(
    jsonb_agg(public.workspace_access_context(null::uuid, requested.profile_id) order by requested.position),
    '[]'::jsonb
  )
  from unnest(coalesce(p_profile_ids, array[]::text[])) with ordinality as requested(profile_id, position);
$$;

revoke all on function public.workspace_access_contexts(text[]) from public, anon, authenticated;
grant execute on function public.workspace_access_contexts(text[]) to service_role;
