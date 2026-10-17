-- GitHub-specific durable rotation ownership. Existing ciphertext, expiry, RLS and grants remain intact.
alter table public.github_app_user_tokens
  add column if not exists connection_id uuid not null default gen_random_uuid(),
  add column if not exists credential_version bigint not null default 0,
  add column if not exists refresh_claim_id uuid,
  add column if not exists refresh_claim_expires_at timestamptz;

create or replace function public.store_github_user_connection(
  p_profile_id text, p_github_login text, p_github_user_id bigint, p_access text, p_refresh text,
  p_access_expires timestamptz, p_refresh_expires timestamptz, p_expected_connection uuid, p_expected_version bigint
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare configured text;
begin
  select lower(trim(github_login)) into configured from public.profiles where id=p_profile_id for update;
  if configured is null or configured='' or configured<>lower(trim(p_github_login)) or nullif(p_access,'') is null then return false; end if;
  perform 1 from public.github_app_user_tokens where profile_id=p_profile_id for update;
  if p_expected_connection is null then
    if exists(select 1 from public.github_app_user_tokens where profile_id=p_profile_id) then return false; end if;
  elsif not exists(select 1 from public.github_app_user_tokens where profile_id=p_profile_id and connection_id=p_expected_connection and credential_version=p_expected_version) then
    return false;
  end if;
  insert into public.github_app_user_tokens as stored (
    profile_id, github_login, github_user_id, encrypted_access_token, encrypted_refresh_token,
    access_token_expires_at, refresh_token_expires_at, connection_id, credential_version,
    connected_at, last_used_at, updated_at
  ) values (p_profile_id,p_github_login,p_github_user_id,p_access,p_refresh,p_access_expires,p_refresh_expires,
    gen_random_uuid(),0,clock_timestamp(),clock_timestamp(),clock_timestamp())
  on conflict (profile_id) do update set github_login=excluded.github_login, github_user_id=excluded.github_user_id,
    encrypted_access_token=excluded.encrypted_access_token, encrypted_refresh_token=excluded.encrypted_refresh_token,
    access_token_expires_at=excluded.access_token_expires_at, refresh_token_expires_at=excluded.refresh_token_expires_at,
    connection_id=excluded.connection_id, credential_version=stored.credential_version+1,
    refresh_claim_id=null,refresh_claim_expires_at=null,connected_at=excluded.connected_at,refreshed_at=null,
    last_used_at=excluded.last_used_at,revoked_at=null,last_error=null,updated_at=excluded.updated_at;
  return true;
end $$;

create or replace function public.claim_github_user_refresh(p_profile_id text,p_connection_id uuid,p_version bigint)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare configured text; claim uuid:=gen_random_uuid(); affected integer;
begin
  select lower(trim(github_login)) into configured from public.profiles where id=p_profile_id for share;
  update public.github_app_user_tokens set refresh_claim_id=claim,refresh_claim_expires_at=clock_timestamp()+interval '60 seconds'
  where profile_id=p_profile_id and connection_id=p_connection_id and credential_version=p_version
    and revoked_at is null and refresh_claim_id is null and lower(trim(github_login))=configured
    and encrypted_refresh_token is not null and (refresh_token_expires_at is null or refresh_token_expires_at>clock_timestamp());
  get diagnostics affected=row_count;
  if affected=1 then return claim; end if;
  -- Expired claims are never reassigned. A provider may already have consumed the rotating token.
  return null;
end $$;

create or replace function public.finalize_github_user_refresh(
  p_profile_id text,p_connection_id uuid,p_version bigint,p_claim_id uuid,p_access text,p_refresh text,
  p_access_expires timestamptz,p_refresh_expires timestamptz
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare configured text; affected integer;
begin
  select lower(trim(github_login)) into configured from public.profiles where id=p_profile_id for share;
  if p_access is null then
    update public.github_app_user_tokens set last_error='GitHub refresh failed or its outcome is unknown. Reconnect required.',updated_at=clock_timestamp()
    where profile_id=p_profile_id and connection_id=p_connection_id and credential_version=p_version
      and refresh_claim_id=p_claim_id and revoked_at is null and lower(trim(github_login))=configured;
    return false;
  end if;
  update public.github_app_user_tokens set encrypted_access_token=p_access,encrypted_refresh_token=p_refresh,
    access_token_expires_at=p_access_expires,refresh_token_expires_at=p_refresh_expires,
    credential_version=credential_version+1,refresh_claim_id=null,refresh_claim_expires_at=null,
    refreshed_at=clock_timestamp(),last_used_at=clock_timestamp(),last_error=null,updated_at=clock_timestamp()
  where profile_id=p_profile_id and connection_id=p_connection_id and credential_version=p_version
    and refresh_claim_id=p_claim_id and refresh_claim_expires_at>clock_timestamp()
    and revoked_at is null and lower(trim(github_login))=configured;
  get diagnostics affected=row_count;
  return affected=1;
end $$;

create or replace function public.use_github_user_connection(p_profile_id text,p_connection_id uuid,p_version bigint,p_disconnect boolean)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare configured text; affected integer;
begin
  select lower(trim(github_login)) into configured from public.profiles where id=p_profile_id for share;
  if p_disconnect then
    delete from public.github_app_user_tokens where profile_id=p_profile_id and connection_id=p_connection_id;
  else
    update public.github_app_user_tokens set last_used_at=clock_timestamp(),last_error=null,updated_at=clock_timestamp()
    where profile_id=p_profile_id and connection_id=p_connection_id and credential_version=p_version
      and revoked_at is null and lower(trim(github_login))=configured
      and (access_token_expires_at is null or access_token_expires_at>clock_timestamp());
  end if;
  get diagnostics affected=row_count;
  return affected=1;
end $$;

-- A permitted technical identity change must invalidate its previous credential association.
-- The trigger alone can touch the service-only vault; callers receive no additional table grant.
create or replace function public.invalidate_github_user_association() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if lower(trim(coalesce(old.github_login,''))) is distinct from lower(trim(coalesce(new.github_login,''))) then
    update public.github_app_user_tokens set revoked_at=clock_timestamp(),credential_version=credential_version+1,
      refresh_claim_id=null,refresh_claim_expires_at=null,last_error='Configured GitHub account changed. Reconnect required.',updated_at=clock_timestamp()
    where profile_id=new.id;
  end if;
  return new;
end $$;
do $$ begin
  if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.profiles'::regclass and tgname='invalidate_github_user_association') then
    create trigger invalidate_github_user_association after update of github_login on public.profiles
    for each row execute function public.invalidate_github_user_association();
  end if;
end $$;

revoke all on function public.store_github_user_connection(text,text,bigint,text,text,timestamptz,timestamptz,uuid,bigint) from public,anon,authenticated;
revoke all on function public.claim_github_user_refresh(text,uuid,bigint) from public,anon,authenticated;
revoke all on function public.finalize_github_user_refresh(text,uuid,bigint,uuid,text,text,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.use_github_user_connection(text,uuid,bigint,boolean) from public,anon,authenticated;
revoke all on function public.invalidate_github_user_association() from public,anon,authenticated;
grant execute on function public.store_github_user_connection(text,text,bigint,text,text,timestamptz,timestamptz,uuid,bigint) to service_role;
grant execute on function public.claim_github_user_refresh(text,uuid,bigint) to service_role;
grant execute on function public.finalize_github_user_refresh(text,uuid,bigint,uuid,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.use_github_user_connection(text,uuid,bigint,boolean) to service_role;
