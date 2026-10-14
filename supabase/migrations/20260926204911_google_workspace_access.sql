-- Application cutover is a separate operator action. Existing accounts remain intact.
create schema if not exists workspace_private;
revoke all on schema workspace_private from public, anon, authenticated;
create table workspace_private.configuration (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'legacy' check (mode in ('legacy', 'linking', 'google'))
);
insert into workspace_private.configuration(singleton) values (true);
create table workspace_private.identity_bindings (
  user_id uuid primary key references auth.users(id),
  google_subject text not null unique,
  linked_at timestamptz not null default now()
);
create table workspace_private.link_attempts (
  nonce_hash text primary key,
  user_id uuid not null references auth.users(id),
  expires_at timestamptz not null
);
create table workspace_private.request_permits (
  permit_hash text primary key,
  user_id uuid not null,
  jwt_hash text not null,
  method text not null,
  path text not null,
  expires_at timestamptz not null default clock_timestamp() + interval '10 seconds'
);
alter table workspace_private.configuration enable row level security;
alter table workspace_private.identity_bindings enable row level security;
alter table workspace_private.link_attempts enable row level security;
alter table workspace_private.request_permits enable row level security;

create function public.workspace_access_context(p_user_id uuid default null, p_profile_id text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'mode', configuration.mode, 'userId', profile.auth_user_id, 'profileId', profile.id,
    'linked', binding.google_subject is not null and binding.google_subject = identity.identity_data->>'sub',
    'identity', identity.identity_data
  ) from workspace_private.configuration configuration
  left join public.profiles profile on (p_user_id is not null and profile.auth_user_id = p_user_id)
    or (p_profile_id is not null and profile.id = p_profile_id)
  left join auth.identities identity on identity.user_id = profile.auth_user_id and identity.provider = 'google'
    and 1 = (select count(*) from auth.identities candidate where candidate.user_id = profile.auth_user_id and candidate.provider = 'google')
  left join workspace_private.identity_bindings binding on binding.user_id = profile.auth_user_id
  where configuration.singleton;
$$;
revoke all on function public.workspace_access_context(uuid,text) from public, anon, authenticated;
grant execute on function public.workspace_access_context(uuid,text) to service_role;

create function public.workspace_begin_link(p_user_id uuid, p_nonce_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select mode from workspace_private.configuration) <> 'linking'
    or not exists (select 1 from public.profiles where auth_user_id = p_user_id) then
    raise insufficient_privilege using message = 'Workspace linking is unavailable';
  end if;
  delete from workspace_private.link_attempts where user_id = p_user_id or expires_at < clock_timestamp();
  insert into workspace_private.link_attempts values (p_nonce_hash, p_user_id, clock_timestamp() + interval '10 minutes');
end;
$$;
create function public.workspace_complete_link(p_user_id uuid, p_nonce_hash text, p_subject text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select mode from workspace_private.configuration) <> 'linking' then raise insufficient_privilege; end if;
  delete from workspace_private.link_attempts where nonce_hash = p_nonce_hash and user_id = p_user_id and expires_at > clock_timestamp();
  if not found then raise insufficient_privilege using message = 'Invalid linking attempt'; end if;
  if not exists (select 1 from auth.identities where user_id = p_user_id and provider = 'google'
    and identity_data->>'sub' = p_subject and identity_data->>'email_verified' = 'true'
    and identity_data#>>'{custom_claims,hd}' = 'findmydoc.eu'
    and identity_data->>'iss' in ('https://accounts.google.com', 'accounts.google.com')) then
    raise insufficient_privilege using message = 'Invalid Workspace identity';
  end if;
  insert into workspace_private.identity_bindings(user_id,google_subject) values (p_user_id,p_subject)
    on conflict (user_id) do update set google_subject = excluded.google_subject, linked_at = now()
    where workspace_private.identity_bindings.google_subject = excluded.google_subject;
  if not found then raise insufficient_privilege using message = 'Conflicting Workspace binding'; end if;
end;
$$;
revoke all on function public.workspace_begin_link(uuid,text), public.workspace_complete_link(uuid,text,text) from public, anon, authenticated;
grant execute on function public.workspace_begin_link(uuid,text), public.workspace_complete_link(uuid,text,text) to service_role;

create function public.workspace_issue_permit(p_hash text, p_user_id uuid, p_jwt_hash text, p_method text, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from workspace_private.identity_bindings where user_id = p_user_id) then raise insufficient_privilege; end if;
  delete from workspace_private.request_permits where expires_at < clock_timestamp();
  insert into workspace_private.request_permits(permit_hash,user_id,jwt_hash,method,path)
    values (p_hash,p_user_id,p_jwt_hash,p_method,p_path);
end;
$$;
create function public.workspace_release_permit(p_hash text)
returns void language sql security definer set search_path = '' as $$
  delete from workspace_private.request_permits where permit_hash = p_hash;
$$;
revoke all on function public.workspace_issue_permit(text,uuid,text,text,text), public.workspace_release_permit(text) from public, anon, authenticated;
grant execute on function public.workspace_issue_permit(text,uuid,text,text,text), public.workspace_release_permit(text) to service_role;

create function public.workspace_check_request()
returns void language plpgsql security definer set search_path = '' as $$
declare
  headers jsonb := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  permit workspace_private.request_permits;
begin
  if auth.role() = 'service_role' or (select mode from workspace_private.configuration) <> 'google' then return; end if;
  select * into permit from workspace_private.request_permits
    where permit_hash = encode(extensions.digest(coalesce(headers->>'x-founderops-workspace-permit',''), 'sha256'),'hex')
      and user_id = auth.uid() and expires_at > clock_timestamp()
      and jwt_hash = encode(extensions.digest(regexp_replace(coalesce(headers->>'authorization',''), '^Bearer ', '', 'i'), 'sha256'),'hex')
      and method = current_setting('request.method',true) and path = current_setting('request.path',true);
  if not found then raise insufficient_privilege using message = 'Workspace authorization required'; end if;
  -- PostgREST GET/HEAD transactions are read-only. The relay releases those permits in finally.
  if current_setting('transaction_read_only') = 'off' then
    delete from workspace_private.request_permits where permit_hash = permit.permit_hash;
    if not found then raise insufficient_privilege; end if;
  end if;
  perform set_config('founderops.workspace_admitted', 'true', true);
end;
$$;
revoke all on function public.workspace_check_request() from public;
grant execute on function public.workspace_check_request() to authenticated, service_role;
alter role authenticator set pgrst.db_pre_request = 'public.workspace_check_request';

create function public.workspace_request_admitted()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select mode from workspace_private.configuration) <> 'google'
    or coalesce(current_setting('founderops.workspace_admitted',true),'') = 'true';
$$;
revoke all on function public.workspace_request_admitted() from public;
grant execute on function public.workspace_request_admitted() to authenticated, service_role;
-- Restrictive policies also deny GraphQL/Realtime access without a relay decision.
do $$ declare target record; begin
  for target in select distinct tablename from pg_policies where schemaname = 'public' and 'authenticated'::name = any(roles) loop
    execute format('create policy workspace_request_boundary on public.%I as restrictive for all to authenticated using ((select public.workspace_request_admitted())) with check ((select public.workspace_request_admitted()))',target.tablename);
  end loop;
end $$;
update storage.buckets set public = false where id = 'fmd-tool-previews';
notify pgrst, 'reload config';

-- A new Google-only epoch invalidates older application sessions without touching provider tokens.
alter table workspace_private.configuration add column google_activated_at timestamptz;
create function workspace_private.record_login_cutover()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.mode = 'google' and old.mode <> 'google' then new.google_activated_at := clock_timestamp(); end if;
  return new;
end;
$$;
create trigger workspace_login_cutover before update on workspace_private.configuration
  for each row execute function workspace_private.record_login_cutover();
create function public.workspace_session_allowed(p_user_id uuid, p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.sessions session cross join workspace_private.configuration configuration
    where session.id = p_session_id and session.user_id = p_user_id
      and session.created_at >= configuration.google_activated_at
      and (session.not_after is null or session.not_after > now()));
$$;
revoke all on function public.workspace_session_allowed(uuid,uuid) from public, anon, authenticated;
grant execute on function public.workspace_session_allowed(uuid,uuid) to service_role;
