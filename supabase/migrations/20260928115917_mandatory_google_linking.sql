-- Keep the migration inert until the matching application has been deployed and verified.
alter table workspace_private.configuration
  add column if not exists linking_enforced boolean not null default false;

create table if not exists workspace_private.google_login_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id),
  google_subject text not null,
  approved_at timestamptz not null default clock_timestamp()
);
create index if not exists google_login_sessions_user_id_idx
  on workspace_private.google_login_sessions(user_id);
alter table workspace_private.google_login_sessions enable row level security;
revoke all on workspace_private.google_login_sessions from public, anon, authenticated;

create or replace function public.workspace_access_context(p_user_id uuid default null, p_profile_id text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'mode', configuration.mode, 'linkingEnforced', configuration.linking_enforced,
    'userId', profile.auth_user_id, 'profileId', profile.id,
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

-- Only the server can attest that a completed OAuth callback used Google.
create function public.workspace_record_google_login(p_user_id uuid, p_session_id uuid, p_subject text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select mode from workspace_private.configuration where singleton) <> 'linking'
    or not exists (
      select 1 from workspace_private.identity_bindings binding
      join auth.identities identity on identity.user_id = binding.user_id and identity.provider = 'google'
      join auth.sessions session on session.id = p_session_id and session.user_id = binding.user_id
      where binding.user_id = p_user_id and binding.google_subject = p_subject
        and identity.identity_data->>'sub' = p_subject
        and identity.identity_data->>'email_verified' = 'true'
        and identity.identity_data#>>'{custom_claims,hd}' = 'findmydoc.eu'
        and identity.identity_data->>'iss' in ('https://accounts.google.com', 'accounts.google.com')
        and (session.not_after is null or session.not_after > now())
    ) then raise insufficient_privilege using message = 'Unapproved Google login'; end if;
  insert into workspace_private.google_login_sessions(session_id,user_id,google_subject)
    values (p_session_id,p_user_id,p_subject)
    on conflict (session_id) do update set user_id = excluded.user_id,
      google_subject = excluded.google_subject, approved_at = clock_timestamp();
end;
$$;
revoke all on function public.workspace_record_google_login(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.workspace_record_google_login(uuid,uuid,text) to service_role;

create function public.workspace_linking_session_allowed(p_user_id uuid, p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from workspace_private.google_login_sessions approved
    join workspace_private.identity_bindings binding on binding.user_id = approved.user_id
      and binding.google_subject = approved.google_subject
    join auth.sessions session on session.id = approved.session_id and session.user_id = approved.user_id
    where approved.user_id = p_user_id and approved.session_id = p_session_id
      and (session.not_after is null or session.not_after > now())
  );
$$;
revoke all on function public.workspace_linking_session_allowed(uuid,uuid) from public, anon, authenticated;
grant execute on function public.workspace_linking_session_allowed(uuid,uuid) to service_role;

create or replace function public.workspace_check_request()
returns void language plpgsql security definer set search_path = '' as $$
declare
  headers jsonb := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  permit workspace_private.request_permits;
begin
  if auth.role() = 'service_role' or not exists (
    select 1 from workspace_private.configuration
    where singleton and (mode = 'google' or (mode = 'linking' and linking_enforced))
  ) then return; end if;
  select * into permit from workspace_private.request_permits
    where permit_hash = encode(extensions.digest(coalesce(headers->>'x-founderops-workspace-permit',''), 'sha256'),'hex')
      and user_id = auth.uid() and expires_at > clock_timestamp()
      and jwt_hash = encode(extensions.digest(regexp_replace(coalesce(headers->>'authorization',''), '^Bearer ', '', 'i'), 'sha256'),'hex')
      and method = current_setting('request.method',true) and path = current_setting('request.path',true);
  if not found then raise insufficient_privilege using message = 'Workspace authorization required'; end if;
  if current_setting('transaction_read_only') = 'off' then
    delete from workspace_private.request_permits where permit_hash = permit.permit_hash;
    if not found then raise insufficient_privilege; end if;
  end if;
  perform set_config('founderops.workspace_admitted', 'true', true);
end;
$$;

create or replace function public.workspace_request_admitted()
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from workspace_private.configuration
    where singleton and (mode = 'google' or (mode = 'linking' and linking_enforced))
  ) or coalesce(current_setting('founderops.workspace_admitted',true),'') = 'true';
$$;
create policy workspace_preview_boundary on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'fmd-tool-previews' or (select public.workspace_request_admitted()));
notify pgrst, 'reload config';
