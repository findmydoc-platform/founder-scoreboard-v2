-- The Calendar entry uses one snapshot for context and mode-dependent admission.
-- Keep admission failures as data so the server retains its identity/AMR error order.
create function public.workspace_calendar_entry(p_user_id uuid, p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb;
  session_allowed boolean := null;
  session_error boolean := false;
begin
  context := public.workspace_access_context(p_user_id, null::text);
  if context->>'mode' = 'google'
    or (context->>'mode' = 'linking' and context->'linkingEnforced' = 'true'::jsonb) then
    begin
      if context->>'mode' = 'linking' then
        session_allowed := public.workspace_linking_session_allowed(p_user_id, p_session_id);
      else
        session_allowed := public.workspace_session_allowed(p_user_id, p_session_id);
      end if;
    exception when others then
      session_allowed := false;
      session_error := true;
    end;
  end if;
  return context || pg_catalog.jsonb_build_object('sessionAllowed', session_allowed, 'sessionError', session_error);
end;
$$;
revoke all on function public.workspace_calendar_entry(uuid,uuid) from public, anon, authenticated;
grant execute on function public.workspace_calendar_entry(uuid,uuid) to service_role;
