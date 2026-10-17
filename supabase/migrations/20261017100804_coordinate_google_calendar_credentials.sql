-- Calendar-only ownership and CAS. Existing ciphertext, scope checks, RLS and grants remain intact.
alter table public.google_workspace_connections
  add column if not exists connection_id uuid not null default gen_random_uuid(),
  add column if not exists credential_version bigint not null default 0,
  add column if not exists refresh_claim_id uuid,
  add column if not exists refresh_claim_expires_at timestamptz;

-- Cleanup must never switch to a calendar connection created after the disconnect request.
alter table public.google_workspace_disconnect_operations add column if not exists connection_id uuid;
update public.google_workspace_disconnect_operations operation set connection_id=connection.connection_id
from public.google_workspace_connections connection
where operation.owner_profile_id=connection.profile_id and operation.connection_id is null
  and operation.state<>'completed' and connection.connected_at<=operation.requested_at;
create or replace function public.bind_google_calendar_disconnect() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select connection_id into new.connection_id from public.google_workspace_connections where profile_id=new.owner_profile_id;
  return new;
end $$;
do $$ begin
  if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.google_workspace_disconnect_operations'::regclass and tgname='bind_google_calendar_disconnect') then
    create trigger bind_google_calendar_disconnect before insert on public.google_workspace_disconnect_operations
    for each row execute function public.bind_google_calendar_disconnect();
  end if;
end $$;

create or replace function public.store_google_calendar_connection(
  p_profile_id text,p_access text,p_refresh text,p_access_expires timestamptz,p_refresh_expires timestamptz,
  p_expected_connection uuid,p_expected_version bigint
) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.profiles where id=p_profile_id for update;
  if not found then return false; end if;
  perform 1 from public.google_workspace_connections where profile_id=p_profile_id for update;
  if p_expected_connection is null then
    if exists(select 1 from public.google_workspace_connections where profile_id=p_profile_id) then return false; end if;
  elsif not exists(select 1 from public.google_workspace_connections where profile_id=p_profile_id and connection_id=p_expected_connection and credential_version=p_expected_version) then
    return false;
  end if;
  insert into public.google_workspace_connections as stored (
    profile_id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,refresh_token_expires_at,
    oauth_scopes,token_type,primary_calendar_id,connection_id,credential_version,connected_at,updated_at
  ) values (p_profile_id,p_access,p_refresh,p_access_expires,p_refresh_expires,
    array['https://www.googleapis.com/auth/calendar.events.owned'],'Bearer','primary',gen_random_uuid(),0,clock_timestamp(),clock_timestamp())
  on conflict (profile_id) do update set encrypted_access_token=excluded.encrypted_access_token,
    encrypted_refresh_token=excluded.encrypted_refresh_token,access_token_expires_at=excluded.access_token_expires_at,
    refresh_token_expires_at=excluded.refresh_token_expires_at,oauth_scopes=excluded.oauth_scopes,
    token_type=excluded.token_type,primary_calendar_id=excluded.primary_calendar_id,
    connection_id=excluded.connection_id,credential_version=stored.credential_version+1,
    refresh_claim_id=null,refresh_claim_expires_at=null,connected_at=excluded.connected_at,refreshed_at=null,
    last_used_at=null,revoked_at=null,last_error_class=null,updated_at=excluded.updated_at;
  return true;
end $$;

create or replace function public.claim_google_calendar_refresh(p_profile_id text,p_connection_id uuid,p_version bigint)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare claim uuid:=gen_random_uuid(); affected integer;
begin
  perform 1 from public.profiles where id=p_profile_id for share;
  update public.google_workspace_connections set refresh_claim_id=claim,refresh_claim_expires_at=clock_timestamp()+interval '60 seconds'
  where profile_id=p_profile_id and connection_id=p_connection_id and credential_version=p_version
    and revoked_at is null and refresh_claim_id is null
    and (refresh_token_expires_at is null or refresh_token_expires_at>clock_timestamp());
  get diagnostics affected=row_count;
  if affected=1 then return claim; end if;
  -- An expired owner may already have consumed a rotating credential. Never reassign it.
  return null;
end $$;

create or replace function public.finalize_google_calendar_refresh(
  p_profile_id text,p_connection_id uuid,p_version bigint,p_claim_id uuid,p_access text,p_refresh text,
  p_access_expires timestamptz,p_refresh_expires timestamptz,p_error text
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  perform 1 from public.profiles where id=p_profile_id for share;
  if p_access is null then
    if p_error not in ('oauth_reconnect_required','oauth_provider_unavailable','oauth_scope_mismatch','oauth_storage_failed') then return false; end if;
    update public.google_workspace_connections set last_error_class=p_error,updated_at=clock_timestamp()
    where profile_id=p_profile_id and connection_id=p_connection_id and credential_version=p_version
      and refresh_claim_id=p_claim_id and revoked_at is null;
    return false;
  end if;
  update public.google_workspace_connections set encrypted_access_token=p_access,encrypted_refresh_token=p_refresh,
    access_token_expires_at=p_access_expires,refresh_token_expires_at=p_refresh_expires,
    credential_version=credential_version+1,refresh_claim_id=null,refresh_claim_expires_at=null,
    refreshed_at=clock_timestamp(),last_used_at=clock_timestamp(),last_error_class=null,updated_at=clock_timestamp()
  where profile_id=p_profile_id and connection_id=p_connection_id and credential_version=p_version
    and refresh_claim_id=p_claim_id and refresh_claim_expires_at>clock_timestamp() and revoked_at is null;
  get diagnostics affected=row_count;
  return affected=1;
end $$;

create or replace function public.use_google_calendar_connection(p_profile_id text,p_connection_id uuid,p_version bigint)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  update public.google_workspace_connections set last_used_at=clock_timestamp(),updated_at=clock_timestamp()
  where profile_id=p_profile_id and connection_id=p_connection_id and credential_version=p_version
    and revoked_at is null and access_token_expires_at>clock_timestamp()
    and (refresh_token_expires_at is null or refresh_token_expires_at>clock_timestamp());
  get diagnostics affected=row_count;
  return affected=1;
end $$;

create or replace function public.remove_google_calendar_connection(p_profile_id text,p_operation_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare operation public.google_workspace_disconnect_operations%rowtype;
begin
  perform 1 from public.profiles where id=p_profile_id for update;
  select * into operation from public.google_workspace_disconnect_operations
    where id=p_operation_id and owner_profile_id=p_profile_id and state='revoke_pending' and revoke_connection for update;
  if not found then return false; end if;
  if not exists(select 1 from public.google_workspace_connections where profile_id=p_profile_id) then return true; end if;
  if operation.connection_id is null then return false; end if;
  delete from public.google_workspace_connections where profile_id=p_profile_id and connection_id=operation.connection_id;
  -- A replacement connection remains intact. The old connection is already absent.
  return true;
end $$;

revoke all on function public.bind_google_calendar_disconnect() from public,anon,authenticated;
revoke all on function public.store_google_calendar_connection(text,text,text,timestamptz,timestamptz,uuid,bigint) from public,anon,authenticated;
revoke all on function public.claim_google_calendar_refresh(text,uuid,bigint) from public,anon,authenticated;
revoke all on function public.finalize_google_calendar_refresh(text,uuid,bigint,uuid,text,text,timestamptz,timestamptz,text) from public,anon,authenticated;
revoke all on function public.use_google_calendar_connection(text,uuid,bigint) from public,anon,authenticated;
revoke all on function public.remove_google_calendar_connection(text,uuid) from public,anon,authenticated;
grant execute on function public.store_google_calendar_connection(text,text,text,timestamptz,timestamptz,uuid,bigint) to service_role;
grant execute on function public.claim_google_calendar_refresh(text,uuid,bigint) to service_role;
grant execute on function public.finalize_google_calendar_refresh(text,uuid,bigint,uuid,text,text,timestamptz,timestamptz,text) to service_role;
grant execute on function public.use_google_calendar_connection(text,uuid,bigint) to service_role;
grant execute on function public.remove_google_calendar_connection(text,uuid) to service_role;
