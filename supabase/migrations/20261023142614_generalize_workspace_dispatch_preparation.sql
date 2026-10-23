-- Grouped dispatch binds live context and permit issuance under one configuration lock.
create or replace function public.workspace_dispatch_prepare(
  p_hash text, p_user_id uuid, p_jwt_hash text, p_method text, p_path text,
  p_session_id uuid, p_profile_id text, p_mode text, p_linking_enforced boolean,
  p_subject text, p_email text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  configuration workspace_private.configuration;
  context jsonb;
  identity jsonb;
  permit_required boolean;
begin
  -- Lock before reading the context. A waiter must validate the updated configuration.
  select * into configuration from workspace_private.configuration where singleton for share;
  if not found or configuration.mode is distinct from p_mode
    or configuration.linking_enforced is distinct from p_linking_enforced then
    raise insufficient_privilege using message = 'Workspace binding is not current';
  end if;
  context := public.workspace_access_context(p_user_id, null);
  if context is null or context->>'userId' is distinct from p_user_id::text
    or context->>'profileId' is distinct from p_profile_id or p_profile_id is null then
    raise insufficient_privilege using message = 'Workspace binding is not current';
  end if;
  permit_required := configuration.mode = 'google'
    or (configuration.mode = 'linking' and configuration.linking_enforced);
  if not permit_required then return false; end if;
  identity := context->'identity';
  if context->'linked' is distinct from 'true'::jsonb
    or jsonb_typeof(identity) is distinct from 'object'
    or jsonb_typeof(identity->'iss') is distinct from 'string'
    or identity->>'iss' not in ('https://accounts.google.com', 'accounts.google.com')
    or identity->'email_verified' is distinct from 'true'::jsonb
    or identity#>'{custom_claims,hd}' is distinct from '"findmydoc.eu"'::jsonb
    or jsonb_typeof(identity->'sub') is distinct from 'string'
    or coalesce(identity->>'sub','') = ''
    or jsonb_typeof(identity->'email') is distinct from 'string'
    or coalesce(identity->>'email','') = ''
    or identity->>'sub' is distinct from p_subject
    or identity->>'email' is distinct from p_email then
    raise insufficient_privilege using message = 'Workspace binding is not current';
  end if;
  -- The existing issuer reuses this ShareLock and enforces current session admission.
  perform public.workspace_issue_permit(p_hash,p_user_id,p_jwt_hash,p_method,p_path,p_session_id);
  return true;
end;
$$;
revoke all on function public.workspace_dispatch_prepare(text,uuid,text,text,text,uuid,text,text,boolean,text,text) from public, anon, authenticated;
grant execute on function public.workspace_dispatch_prepare(text,uuid,text,text,text,uuid,text,text,boolean,text,text) to service_role;

-- Keep the existing Calendar RPC compatible with the shared atomic implementation.
create or replace function public.workspace_calendar_prepare(
  p_hash text, p_user_id uuid, p_jwt_hash text, p_method text, p_path text,
  p_session_id uuid, p_profile_id text, p_mode text, p_linking_enforced boolean,
  p_subject text, p_email text
)
returns boolean language sql security definer set search_path = '' as $$
  select public.workspace_dispatch_prepare(
    p_hash,p_user_id,p_jwt_hash,p_method,p_path,p_session_id,p_profile_id,
    p_mode,p_linking_enforced,p_subject,p_email
  );
$$;
alter function public.workspace_dispatch_prepare(text,uuid,text,text,text,uuid,text,text,boolean,text,text) owner to postgres;
alter function public.workspace_calendar_prepare(text,uuid,text,text,text,uuid,text,text,boolean,text,text) owner to postgres;
revoke all on function public.workspace_calendar_prepare(text,uuid,text,text,text,uuid,text,text,boolean,text,text) from public, anon, authenticated;
grant execute on function public.workspace_calendar_prepare(text,uuid,text,text,text,uuid,text,text,boolean,text,text) to service_role;
