create table if not exists public.administrator_access_grants (
  profile_id text primary key references public.profiles(id) on delete cascade,
  eligible boolean not null default false,
  active_until timestamptz,
  constraint administrator_access_grants_inactive_when_ineligible
    check (eligible or active_until is null)
);

create table if not exists public.notification_delivery_claims (
  event_id bigint primary key references public.notification_events(id) on delete cascade,
  claim_token uuid not null,
  claimed_by_profile_id text references public.profiles(id),
  claim_authority text not null,
  claimed_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  constraint notification_delivery_claims_authority
    check (claim_authority in ('administrator', 'pipeline')),
  constraint notification_delivery_claims_expiry check (expires_at > claimed_at)
);

alter table public.notification_delivery_claims enable row level security;
revoke all on table public.notification_delivery_claims from public, anon, authenticated;
grant all on table public.notification_delivery_claims to service_role;

comment on table public.administrator_access_grants is
  'Time-limited technical administrator access. A grant never changes profiles.platform_role.';

alter table public.administrator_access_grants enable row level security;

revoke all on table public.administrator_access_grants from public;
revoke all on table public.administrator_access_grants from anon;
revoke all on table public.administrator_access_grants from authenticated;
grant select on table public.administrator_access_grants to authenticated;
grant all on table public.administrator_access_grants to service_role;

insert into public.administrator_access_grants (profile_id, eligible, active_until)
select profile.id, true, null
from public.profiles as profile
where profile.id in ('volkan', 'sebastian')
on conflict (profile_id) do update
set eligible = true;

create or replace function public.current_profile_has_active_administrator_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    join public.administrator_access_grants as access
      on access.profile_id = profile.id
    where profile.auth_user_id = (select auth.uid())
      and access.eligible is true
      and access.active_until > clock_timestamp()
  )
$$;

create or replace function public.require_active_administrator_profile()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile_id text;
begin
  select profile.id
  into v_profile_id
  from public.profiles as profile
  join public.administrator_access_grants as access
    on access.profile_id = profile.id
  where profile.auth_user_id = (select auth.uid())
    and access.eligible is true
    and access.active_until > clock_timestamp()
  for update of access;

  if v_profile_id is null then
    raise exception using errcode = '42501', message = 'active administrator access required';
  end if;

  return v_profile_id;
end;
$$;

drop policy if exists administrator_access_grants_select_self on public.administrator_access_grants;
drop policy if exists administrator_access_grants_select_manager on public.administrator_access_grants;
create policy administrator_access_grants_select_manager
on public.administrator_access_grants
for select
to authenticated
using (
  profile_id = (
    select profile.id
    from public.profiles as profile
    where profile.auth_user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.profiles as actor
    where actor.auth_user_id = (select auth.uid())
      and actor.platform_role = 'ceo'
  )
  or public.current_profile_has_active_administrator_access()
);

create or replace function public.administrator_access_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'eligible', coalesce(access.eligible, false),
    'active', coalesce(access.eligible and access.active_until > clock_timestamp(), false),
    'expiresAt', case
      when access.eligible and access.active_until > clock_timestamp()
        then to_jsonb(access.active_until)
      else null::jsonb
    end
  )
  from public.profiles as profile
  left join public.administrator_access_grants as access
    on access.profile_id = profile.id
  where profile.auth_user_id = (select auth.uid())
$$;

create or replace function public.current_authenticated_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', profile.id,
    'name', profile.name,
    'platform_role', profile.platform_role
  )
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
$$;

create or replace function public.administrator_directory_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
  v_technical boolean := false;
  v_people jsonb;
  v_project jsonb;
begin
  select profile.platform_role
  into v_actor_role
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid());

  if v_actor_role is null then
    raise exception using errcode = '42501', message = 'mapped team profile required';
  end if;

  v_technical := public.current_profile_has_active_administrator_access();
  if v_actor_role <> 'ceo' and not v_technical then
    raise exception using errcode = '42501', message = 'administrator eligibility manager required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', profile.id,
    'name', profile.name,
    'platformRole', profile.platform_role,
    'orgRole', coalesce(profile.org_role, ''),
    'authLinked', profile.auth_user_id is not null,
    'githubLogin', case when v_technical then coalesce(profile.github_login, '') else '' end,
    'googleChatUserId', case when v_technical then coalesce(profile.google_chat_user_id, '') else '' end,
    'googleChatDmSpace', case when v_technical then coalesce(profile.google_chat_dm_space, '') else '' end,
    'notificationsEnabled', case when v_technical then profile.notifications_enabled is not false else false end,
    'eligible', coalesce(access.eligible, false),
    'activeUntil', case
      when access.eligible and access.active_until > clock_timestamp() then access.active_until
      else null
    end
  ) order by profile.name), '[]'::jsonb)
  into v_people
  from public.profiles as profile
  left join public.administrator_access_grants as access on access.profile_id = profile.id;

  if v_technical then
    select jsonb_build_object(
      'id', project.id,
      'owner', coalesce(project.github_project_owner, ''),
      'number', coalesce(project.github_project_number, 0)
    )
    into v_project
    from public.projects as project
    order by project.id
    limit 1;
  end if;

  return jsonb_build_object(
    'people', v_people,
    'project', case when v_technical then v_project else null end
  );
end;
$$;

create or replace function public.activate_administrator_access()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id text;
  v_access public.administrator_access_grants%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select profile.id
  into v_profile_id
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid());

  if v_profile_id is null then
    raise exception using errcode = '42501', message = 'mapped team profile required';
  end if;

  select access.*
  into v_access
  from public.administrator_access_grants as access
  where access.profile_id = v_profile_id
  for update;

  if not found or v_access.eligible is not true then
    raise exception using errcode = '42501', message = 'administrator eligibility required';
  end if;

  if v_access.active_until is null or v_access.active_until <= v_now then
    update public.administrator_access_grants
    set active_until = v_now + interval '60 minutes'
    where profile_id = v_profile_id
    returning * into v_access;
  end if;

  return jsonb_build_object(
    'eligible', true,
    'active', true,
    'expiresAt', v_access.active_until
  );
end;
$$;

create or replace function public.end_administrator_access()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id text;
  v_eligible boolean := false;
begin
  select profile.id
  into v_profile_id
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid());

  if v_profile_id is null then
    raise exception using errcode = '42501', message = 'mapped team profile required';
  end if;

  update public.administrator_access_grants
  set active_until = null
  where profile_id = v_profile_id
  returning eligible into v_eligible;

  return jsonb_build_object(
    'eligible', coalesce(v_eligible, false),
    'active', false,
    'expiresAt', null
  );
end;
$$;

create or replace function public.claim_notification_delivery(
  p_event_ids bigint[] default null,
  p_limit integer default 20,
  p_test_delivery text default null,
  p_recipient_profile_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_profile_id text;
  v_claim_authority text;
  v_claim_token uuid := gen_random_uuid();
  v_event_ids bigint[] := '{}'::bigint[];
  v_now timestamptz := clock_timestamp();
  v_test_event_id bigint;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') = 'service_role' then
    v_claim_authority := 'pipeline';
  else
    v_actor_profile_id := public.require_active_administrator_profile();
    v_claim_authority := 'administrator';
  end if;

  if p_test_delivery is not null then
    if p_test_delivery not in ('webhook_digest', 'direct_dm') then
      raise exception using errcode = '22023', message = 'unsupported test delivery';
    end if;
    if p_test_delivery = 'direct_dm' and nullif(trim(coalesce(p_recipient_profile_id, '')), '') is null then
      raise exception using errcode = '22023', message = 'test DM recipient required';
    end if;

    if v_claim_authority = 'administrator' then
      v_actor_profile_id := public.require_active_administrator_profile();
    end if;

    insert into public.notification_events (
      type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body, status
    ) values (
      case when p_test_delivery = 'direct_dm' then 'task.review_requested' else 'task.blocker_reported' end,
      v_actor_profile_id,
      case when p_test_delivery = 'direct_dm' then p_recipient_profile_id else null end,
      'google_chat_test',
      case when p_test_delivery = 'direct_dm' then 'dm-' || p_recipient_profile_id else 'founderops-digest' end,
      'FounderOps Testnachricht',
      case when p_test_delivery = 'direct_dm'
        then 'Kontrollierter Test der persönlichen FounderOps-DM-Zustellung.'
        else 'Kontrollierter Test des FounderOps-Gruppendigest.'
      end,
      'pending'
    ) returning id into v_test_event_id;

    p_event_ids := array[v_test_event_id];
  end if;

  if v_claim_authority = 'administrator' then
    v_actor_profile_id := public.require_active_administrator_profile();
  end if;
  v_now := clock_timestamp();
  delete from public.notification_delivery_claims
  where expires_at <= v_now;

  with candidates as (
    select event.id
    from public.notification_events as event
    where event.status = 'pending'
      and (coalesce(cardinality(p_event_ids), 0) = 0 or event.id = any(p_event_ids))
      and not exists (
        select 1
        from public.notification_deliveries as delivery
        where delivery.event_id = event.id
          and delivery.channel = 'google_chat'
          and delivery.status = 'sent'
      )
      and not exists (
        select 1
        from public.notification_delivery_claims as existing_claim
        where existing_claim.event_id = event.id
          and existing_claim.expires_at > v_now
      )
    order by event.created_at, event.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  ), claimed as (
    insert into public.notification_delivery_claims (
      event_id, claim_token, claimed_by_profile_id, claim_authority, claimed_at, expires_at
    )
    select id, v_claim_token, v_actor_profile_id, v_claim_authority, v_now, v_now + interval '10 minutes'
    from candidates
    on conflict (event_id) do nothing
    returning event_id
  )
  select coalesce(array_agg(event_id order by event_id), '{}'::bigint[])
  into v_event_ids
  from claimed;

  return jsonb_build_object(
    'claimToken', v_claim_token,
    'eventIds', to_jsonb(v_event_ids)
  );
end;
$$;

create or replace function public.finalize_notification_delivery_claim(
  p_claim_token uuid,
  p_event_ids bigint[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'delivery pipeline authority required';
  end if;
  if p_claim_token is null or coalesce(cardinality(p_event_ids), 0) = 0 then
    return 0;
  end if;

  delete from public.notification_delivery_claims
  where claim_token = p_claim_token
    and event_id = any(p_event_ids);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.release_notification_delivery_claim(
  p_claim_token uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'delivery pipeline authority required';
  end if;
  if p_claim_token is null then
    return 0;
  end if;

  delete from public.notification_delivery_claims
  where claim_token = p_claim_token;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.set_administrator_eligibility(
  p_profile_id text,
  p_eligible boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
  v_access public.administrator_access_grants%rowtype;
begin
  select actor.platform_role
  into v_actor_role
  from public.profiles as actor
  where actor.auth_user_id = (select auth.uid());

  if v_actor_role is null then
    raise exception using errcode = '42501', message = 'administrator eligibility manager required';
  end if;
  if v_actor_role <> 'ceo' then
    perform public.require_active_administrator_profile();
  end if;

  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception using errcode = 'P0002', message = 'profile not found';
  end if;
  if v_actor_role <> 'ceo' then
    perform public.require_active_administrator_profile();
  end if;

  insert into public.administrator_access_grants (profile_id, eligible, active_until)
  values (p_profile_id, p_eligible, null)
  on conflict (profile_id) do update
  set eligible = excluded.eligible,
      active_until = case
        when excluded.eligible then public.administrator_access_grants.active_until
        else null
      end
  returning * into v_access;

  return jsonb_build_object(
    'profileId', v_access.profile_id,
    'eligible', v_access.eligible,
    'active', coalesce(v_access.eligible and v_access.active_until > clock_timestamp(), false),
    'expiresAt', case
      when v_access.eligible and v_access.active_until > clock_timestamp()
        then to_jsonb(v_access.active_until)
      else null::jsonb
    end
  );
end;
$$;

create or replace function public.update_administration_github_project_transaction(
  p_project_id text,
  p_expected_owner text,
  p_expected_number integer,
  p_github_project_owner text,
  p_github_project_number integer,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_profile_id text;
  v_project public.projects%rowtype;
begin
  if p_expected_owner is null
    or p_expected_number is null
    or p_github_project_owner is null
    or p_github_project_number is null
    or p_github_project_number <= 0
    or p_github_project_owner <> trim(p_github_project_owner)
    or p_github_project_owner !~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$' then
    raise exception using errcode = '22023', message = 'GitHub Project owner and number are invalid';
  end if;

  v_actor_profile_id := public.require_active_administrator_profile();

  perform pg_advisory_xact_lock(hashtextextended('founderops-github-project:' || p_project_id, 0));

  select * into v_project
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;
  if v_project.github_project_owner <> p_expected_owner
    or v_project.github_project_number <> p_expected_number then
    raise exception using errcode = 'P0001', message = 'FounderOps GitHub Project settings changed concurrently';
  end if;

  v_actor_profile_id := public.require_active_administrator_profile();

  update public.projects
  set github_project_owner = p_github_project_owner,
      github_project_number = p_github_project_number
  where id = p_project_id;

  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id,
    before_data, after_data, request_ip, user_agent
  ) values (
    v_actor_profile_id,
    'founderops.github_project.update',
    'project',
    p_project_id,
    jsonb_build_object(
      'githubProjectOwner', v_project.github_project_owner,
      'githubProjectNumber', v_project.github_project_number
    ),
    jsonb_build_object(
      'githubProjectOwner', p_github_project_owner,
      'githubProjectNumber', p_github_project_number
    ),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'project', jsonb_build_object(
      'id', p_project_id,
      'githubProjectOwner', p_github_project_owner,
      'githubProjectNumber', p_github_project_number
    )
  );
end;
$$;

create or replace function public.update_profile_governance_transaction(
  p_profile_id text,
  p_profile_patch jsonb default '{}'::jsonb,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_profile_id text;
  v_patch jsonb := coalesce(p_profile_patch, '{}'::jsonb);
  v_before jsonb;
  v_profile jsonb;
  v_current_role text;
  v_next_role text;
begin
  select profile.id
  into v_actor_profile_id
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.platform_role = 'ceo';

  if v_actor_profile_id is null then
    raise exception using errcode = '42501', message = 'CEO governance required';
  end if;
  if jsonb_typeof(v_patch) <> 'object' or exists (
    select 1 from jsonb_object_keys(v_patch) as key
    where key not in (
      'platform_role', 'org_role', 'deputy_for', 'deputy_active_from',
      'deputy_active_until', 'weekly_capacity'
    )
  ) then
    raise exception using errcode = '22023', message = 'profile governance patch contains an unsupported field';
  end if;

  lock table public.profiles in share row exclusive mode;
  select jsonb_build_object(
    'id', profile.id,
    'name', profile.name,
    'platform_role', profile.platform_role,
    'org_role', profile.org_role,
    'deputy_for', profile.deputy_for,
    'deputy_active_from', profile.deputy_active_from,
    'deputy_active_until', profile.deputy_active_until,
    'weekly_capacity', profile.weekly_capacity
  ), profile.platform_role
  into v_before, v_current_role
  from public.profiles as profile
  where profile.id = p_profile_id;

  if v_before is null then
    raise exception using errcode = 'P0002', message = 'profile not found';
  end if;

  if v_patch ? 'platform_role' then
    v_next_role := v_patch ->> 'platform_role';
    if v_next_role not in ('ceo', 'founder', 'deputy', 'viewer') then
      raise exception using errcode = '22023', message = 'invalid platform role';
    end if;
    if v_next_role = 'ceo' then
      update public.profiles
      set platform_role = 'founder',
          org_role = 'Founder',
          deputy_for = null,
          deputy_active_from = null,
          deputy_active_until = null
      where id <> p_profile_id and platform_role = 'ceo';
    elsif v_current_role = 'ceo' and not exists (
      select 1 from public.profiles
      where id <> p_profile_id and platform_role = 'ceo'
    ) then
      raise exception using errcode = '23514', message = 'at least one CEO must remain';
    end if;
  end if;

  update public.profiles as profile
  set platform_role = case when v_patch ? 'platform_role' then v_patch ->> 'platform_role' else profile.platform_role end,
      org_role = case when v_patch ? 'org_role' then nullif(v_patch ->> 'org_role', '') else profile.org_role end,
      deputy_for = case when v_patch ? 'deputy_for' then nullif(v_patch ->> 'deputy_for', '') else profile.deputy_for end,
      deputy_active_from = case when v_patch ? 'deputy_active_from' then nullif(v_patch ->> 'deputy_active_from', '')::date else profile.deputy_active_from end,
      deputy_active_until = case when v_patch ? 'deputy_active_until' then nullif(v_patch ->> 'deputy_active_until', '')::date else profile.deputy_active_until end,
      weekly_capacity = case when v_patch ? 'weekly_capacity' then (v_patch ->> 'weekly_capacity')::integer else profile.weekly_capacity end
  where profile.id = p_profile_id
  returning jsonb_build_object(
    'id', profile.id,
    'name', profile.name,
    'platform_role', profile.platform_role,
    'org_role', profile.org_role,
    'deputy_for', profile.deputy_for,
    'deputy_active_from', profile.deputy_active_from,
    'deputy_active_until', profile.deputy_active_until,
    'weekly_capacity', profile.weekly_capacity
  ) into v_profile;

  if (select count(*) from public.profiles where platform_role = 'ceo') <> 1 then
    raise exception using errcode = '23514', message = 'exactly one CEO is required';
  end if;

  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id,
    before_data, after_data, request_ip, user_agent
  ) values (
    v_actor_profile_id, 'profile.governance.update', 'profile', p_profile_id,
    v_before, v_profile, p_request_ip, p_user_agent
  );

  return jsonb_build_object('profile', v_profile);
end;
$$;

create or replace function public.update_profile_technical_identity_transaction(
  p_profile_id text,
  p_profile_patch jsonb default '{}'::jsonb,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_profile_id text;
  v_patch jsonb := coalesce(p_profile_patch, '{}'::jsonb);
  v_before jsonb;
  v_profile jsonb;
begin
  v_actor_profile_id := public.require_active_administrator_profile();
  if jsonb_typeof(v_patch) <> 'object' or exists (
    select 1 from jsonb_object_keys(v_patch) as key
    where key not in (
      'github_login', 'google_chat_user_id', 'google_chat_dm_space'
    )
  ) then
    raise exception using errcode = '22023', message = 'technical identity patch contains an unsupported field';
  end if;

  select jsonb_build_object(
    'id', profile.id,
    'github_login', profile.github_login,
    'google_chat_user_id', profile.google_chat_user_id,
    'google_chat_dm_space', profile.google_chat_dm_space
  )
  into v_before
  from public.profiles as profile
  where profile.id = p_profile_id
  for update;
  if v_before is null then
    raise exception using errcode = 'P0002', message = 'profile not found';
  end if;

  v_actor_profile_id := public.require_active_administrator_profile();

  update public.profiles as profile
  set github_login = case when v_patch ? 'github_login' then nullif(v_patch ->> 'github_login', '') else profile.github_login end,
      google_chat_user_id = case when v_patch ? 'google_chat_user_id' then nullif(v_patch ->> 'google_chat_user_id', '') else profile.google_chat_user_id end,
      google_chat_dm_space = case when v_patch ? 'google_chat_dm_space' then nullif(v_patch ->> 'google_chat_dm_space', '') else profile.google_chat_dm_space end
  where profile.id = p_profile_id
  returning jsonb_build_object(
    'id', profile.id,
    'github_login', profile.github_login,
    'google_chat_user_id', profile.google_chat_user_id,
    'google_chat_dm_space', profile.google_chat_dm_space
  ) into v_profile;

  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id,
    before_data, after_data, request_ip, user_agent
  ) values (
    v_actor_profile_id, 'profile.technical_identity.update', 'profile', p_profile_id,
    v_before, v_profile, p_request_ip, p_user_agent
  );

  return jsonb_build_object('profile', v_profile);
end;
$$;

create or replace function public.update_administrator_planning_item_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_strategy jsonb,
  p_raci_assignments jsonb,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_profile_id text;
  v_task public.tasks%rowtype;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  v_actor_profile_id := public.require_active_administrator_profile();

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  if v_task.trashed_at is not null then raise exception using errcode = 'P0003', message = 'planning item is trashed'; end if;
  if v_task.task_type not in ('epic', 'initiative') then
    raise exception using errcode = '22023', message = 'strategic correction requires an Epic or Initiative';
  end if;
  if v_task.status in ('Erledigt', 'done') or v_patch->>'status' in ('Erledigt', 'done') then
    raise exception using errcode = 'P0016', message = 'completed planning item is locked';
  end if;
  if v_patch ?| array['approval_status', 'approval_revision', 'decided_by', 'decided_at', 'decision_note'] then
    raise exception using errcode = '42501', message = 'administrator correction cannot change approvals';
  end if;
  if v_patch ? 'parent_task_id' then
    raise exception using errcode = '22023', message = 'parent changes require the planning parent command';
  end if;

  v_actor_profile_id := public.require_active_administrator_profile();

  return public.update_planning_item_transaction(
    p_task_id, p_expected_updated_at, v_patch, p_strategy, p_raci_assignments, v_actor_profile_id
  );
end;
$$;

create or replace function public.update_administrator_planning_task_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_task_patch jsonb,
  p_note_present boolean,
  p_note text,
  p_dependency_present boolean,
  p_dependency_note text,
  p_activity_messages text[],
  p_notifications jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_profile_id text;
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_target_sprint public.sprints%rowtype;
  v_source_sprint public.sprints%rowtype;
  v_patch jsonb := coalesce(p_task_patch, '{}'::jsonb);
  v_core_patch jsonb;
  v_result jsonb;
  v_updated_task public.tasks%rowtype;
  v_target_sprint_id text;
begin
  v_actor_profile_id := public.require_active_administrator_profile();

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if v_task.trashed_at is not null then raise exception using errcode = 'P0003', message = 'task is trashed'; end if;
  if v_task.task_type not in ('deliverable', 'sub_issue') then
    raise exception using errcode = '22023', message = 'operational correction requires a Deliverable or Sub-Issue';
  end if;
  if v_task.status = 'Erledigt' or v_patch->>'status' = 'Erledigt' then
    raise exception using errcode = 'P0016', message = 'administrator correction cannot complete or reopen a task';
  end if;
  if v_patch ?| array[
    'review_owner_profile_id', 'review_status', 'review_requested_at',
    'score_final', 'score_points', 'approval_status', 'approval_revision'
  ] then
    raise exception using errcode = '42501', message = 'administrator correction cannot change protected review or approval fields';
  end if;
  if v_patch ? 'parent_task_id' then
    raise exception using errcode = '22023', message = 'parent changes require the planning parent command';
  end if;
  if (v_task.review_status = 'requested' and not coalesce(v_task.score_final, false))
     or (v_task.review_status = 'accepted' and coalesce(v_task.score_final, false)) then
    raise exception using errcode = 'P0010', message = 'planning item review is locked';
  end if;

  if v_task.parent_task_id is not null then
    select * into v_parent from public.tasks where id = v_task.parent_task_id for share;
    if found and (
      v_parent.status = 'Erledigt'
      or (v_parent.review_status = 'requested' and not coalesce(v_parent.score_final, false))
      or (v_parent.review_status = 'accepted' and coalesce(v_parent.score_final, false))
    ) then
      raise exception using errcode = 'P0010', message = 'parent planning item is locked';
    end if;
    if v_task.task_type = 'sub_issue' and v_patch ? 'status' and v_parent.approval_status <> 'approved' then
      raise exception using errcode = 'P0015', message = 'parent approval is required';
    end if;
  end if;

  if v_patch ? 'sprint_id' then
    if v_task.task_type <> 'deliverable'
       or v_task.approval_status <> 'approved'
       or v_task.parent_task_id is null
       or v_parent.id is null
       or v_parent.task_type <> 'initiative'
       or v_parent.approval_status <> 'approved'
       or v_parent.trashed_at is not null then
      raise exception using errcode = 'P0015', message = 'planning item is not eligible for sprint assignment';
    end if;
    v_target_sprint_id := nullif(trim(coalesce(v_patch->>'sprint_id', '')), '');
    if v_target_sprint_id is not null then
      select * into v_target_sprint from public.sprints where id = v_target_sprint_id for share;
      if not found or v_target_sprint.score_locked then
        raise exception using errcode = 'P0015', message = 'target sprint is unavailable or locked';
      end if;
    end if;
    if v_task.sprint_id is not null and v_task.sprint_id is distinct from v_target_sprint_id then
      select * into v_source_sprint from public.sprints where id = v_task.sprint_id for share;
      if not found or v_source_sprint.score_locked then
        raise exception using errcode = 'P0015', message = 'source sprint is unavailable or locked';
      end if;
    end if;
  end if;

  v_actor_profile_id := public.require_active_administrator_profile();
  v_core_patch := v_patch - array['title', 'description', 'workstream', 'estimate_hours', 'github_repo'];
  v_result := public.update_planning_task_transaction(
    p_task_id,
    p_expected_updated_at,
    v_core_patch,
    p_note_present,
    p_note,
    p_dependency_present,
    p_dependency_note,
    p_activity_messages,
    p_notifications,
    v_actor_profile_id
  );
  if v_patch ?| array['title', 'description', 'workstream', 'estimate_hours', 'github_repo'] then
    v_actor_profile_id := public.require_active_administrator_profile();
    update public.tasks
    set title = case when v_patch ? 'title' then nullif(trim(v_patch->>'title'), '') else title end,
        description = case when v_patch ? 'description' then nullif(trim(coalesce(v_patch->>'description', '')), '') else description end,
        workstream = case when v_patch ? 'workstream' then nullif(trim(coalesce(v_patch->>'workstream', '')), '') else workstream end,
        estimate_hours = case when v_patch ? 'estimate_hours' then coalesce((v_patch->>'estimate_hours')::integer, 0) else estimate_hours end,
        github_repo = case when v_patch ? 'github_repo' then nullif(trim(coalesce(v_patch->>'github_repo', '')), '') else github_repo end,
        updated_at = clock_timestamp()
    where id = p_task_id
    returning * into v_updated_task;
    v_result := jsonb_set(v_result, '{task}', to_jsonb(v_updated_task), true);
  end if;
  return v_result;
end;
$$;

create or replace function public.mutate_administrator_planning_relationship_transaction(
  p_operation text,
  p_task_id text,
  p_related_task_id text,
  p_relation_type text,
  p_relation_id bigint,
  p_note text,
  p_expected_updated_at timestamptz,
  p_actor_profile_id text,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_profile_id text;
  v_source public.tasks%rowtype;
  v_related public.tasks%rowtype;
  v_relation public.task_relationship_edges%rowtype;
  v_other_task_id text;
begin
  v_actor_profile_id := public.require_active_administrator_profile();
  if v_actor_profile_id is null or v_actor_profile_id is distinct from p_actor_profile_id then
    raise exception using errcode = '42501', message = 'active administrator access required';
  end if;
  if p_operation not in ('add', 'remove')
     or nullif(trim(coalesce(p_task_id, '')), '') is null
     or (p_operation = 'add' and (
       nullif(trim(coalesce(p_related_task_id, '')), '') is null
       or p_related_task_id = p_task_id
       or p_relation_type not in ('blocked_by', 'blocks', 'relates_to')
       or p_relation_id is not null
     ))
     or (p_operation = 'remove' and (p_relation_id is null or p_relation_id <= 0))
     or char_length(coalesce(p_note, '')) > 500 then
    raise exception using errcode = '22023', message = 'planning relationship command is invalid';
  end if;

  if p_operation = 'remove' then
    select * into v_relation
    from public.task_relationship_edges
    where id = p_relation_id
    for update;
    if not found then raise exception using errcode = 'P0002', message = 'planning relationship not found'; end if;
    if v_relation.task_id <> p_task_id and v_relation.related_task_id <> p_task_id then
      raise exception using errcode = 'P0006', message = 'planning relationship does not belong to task';
    end if;
    v_other_task_id := case when v_relation.task_id = p_task_id then v_relation.related_task_id else v_relation.task_id end;
  else
    v_other_task_id := p_related_task_id;
  end if;

  perform 1 from public.tasks where id = any(array[p_task_id, v_other_task_id]) order by id for update;
  select * into v_source from public.tasks where id = p_task_id;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  select * into v_related from public.tasks where id = v_other_task_id;
  if not found then raise exception using errcode = 'P0002', message = 'related planning item not found'; end if;
  if v_source.trashed_at is not null then raise exception using errcode = 'P0010', message = 'planning item is trashed'; end if;
  if v_related.trashed_at is not null then raise exception using errcode = 'P0011', message = 'related planning item is trashed'; end if;
  if p_expected_updated_at is not null and v_source.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;
  if exists (
    select 1 from public.tasks as candidate
    where candidate.id = any(array[v_source.id, v_source.parent_task_id, v_related.id, v_related.parent_task_id])
      and (
        candidate.status = 'Erledigt'
        or (candidate.review_status = 'requested' and not coalesce(candidate.score_final, false))
        or (candidate.review_status = 'accepted' and coalesce(candidate.score_final, false))
      )
  ) then
    raise exception using errcode = 'P0008', message = 'planning relationship is locked';
  end if;

  v_actor_profile_id := public.require_active_administrator_profile();

  if p_operation = 'add' then
    if exists (
      select 1 from public.task_relationship_edges
      where task_id = p_task_id
        and related_task_id = p_related_task_id
        and relation_type = p_relation_type
    ) then
      raise exception using errcode = 'P0003', message = 'planning relationship already exists';
    end if;
    insert into public.task_relationship_edges (task_id, related_task_id, relation_type, note, created_by)
    values (p_task_id, p_related_task_id, p_relation_type, nullif(trim(coalesce(p_note, '')), ''), v_actor_profile_id)
    returning * into v_relation;
  else
    delete from public.task_relationship_edges where id = p_relation_id returning * into v_relation;
  end if;

  update public.tasks
  set github_issue_sync_status = 'not_synced',
      github_issue_sync_error = null,
      updated_at = clock_timestamp()
  where id = any(array[v_relation.task_id, v_relation.related_task_id])
    and task_type in ('deliverable', 'sub_issue');

  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id,
    before_data, after_data, request_ip, user_agent
  ) values (
    v_actor_profile_id,
    case when p_operation = 'add' then 'task.relationship_created' else 'task.relationship_deleted' end,
    'task', p_task_id,
    case when p_operation = 'remove' then to_jsonb(v_relation) else null end,
    case when p_operation = 'add' then jsonb_build_object(
      'relationType', v_relation.relation_type,
      'relatedTaskId', v_relation.related_task_id,
      'note', coalesce(v_relation.note, '')
    ) else null end,
    p_request_ip, p_user_agent
  );

  return jsonb_build_object(
    'operation', p_operation,
    'relation', to_jsonb(v_relation),
    'affectedItemIds', jsonb_build_array(v_relation.task_id, v_relation.related_task_id)
  );
end;
$$;

revoke all on function public.current_profile_has_active_administrator_access() from public, anon;
revoke all on function public.require_active_administrator_profile() from public, anon, authenticated;
revoke all on function public.administrator_access_snapshot() from public, anon;
revoke all on function public.current_authenticated_profile() from public, anon;
revoke all on function public.administrator_directory_snapshot() from public, anon;
revoke all on function public.activate_administrator_access() from public, anon;
revoke all on function public.end_administrator_access() from public, anon;
revoke all on function public.claim_notification_delivery(bigint[], integer, text, text) from public, anon;
revoke all on function public.finalize_notification_delivery_claim(uuid, bigint[]) from public, anon, authenticated;
revoke all on function public.release_notification_delivery_claim(uuid) from public, anon, authenticated;
revoke all on function public.set_administrator_eligibility(text, boolean) from public, anon;
revoke all on function public.update_administration_github_project_transaction(text, text, integer, text, integer, text, text) from public, anon;
revoke all on function public.update_profile_governance_transaction(text, jsonb, text, text) from public, anon;
revoke all on function public.update_profile_technical_identity_transaction(text, jsonb, text, text) from public, anon;
revoke all on function public.update_administrator_planning_item_transaction(text, timestamptz, jsonb, jsonb, jsonb, text, text) from public, anon;
revoke all on function public.update_administrator_planning_task_transaction(text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb) from public, anon;
revoke all on function public.mutate_administrator_planning_relationship_transaction(text, text, text, text, bigint, text, timestamptz, text, text, text) from public, anon;

grant execute on function public.current_profile_has_active_administrator_access() to authenticated;
grant execute on function public.administrator_access_snapshot() to authenticated;
grant execute on function public.current_authenticated_profile() to authenticated;
grant execute on function public.administrator_directory_snapshot() to authenticated;
grant execute on function public.activate_administrator_access() to authenticated;
grant execute on function public.end_administrator_access() to authenticated;
grant execute on function public.claim_notification_delivery(bigint[], integer, text, text) to authenticated, service_role;
grant execute on function public.finalize_notification_delivery_claim(uuid, bigint[]) to service_role;
grant execute on function public.release_notification_delivery_claim(uuid) to service_role;
grant execute on function public.set_administrator_eligibility(text, boolean) to authenticated;
grant execute on function public.update_administration_github_project_transaction(text, text, integer, text, integer, text, text) to authenticated;
grant execute on function public.update_profile_governance_transaction(text, jsonb, text, text) to authenticated;
grant execute on function public.update_profile_technical_identity_transaction(text, jsonb, text, text) to authenticated;
grant execute on function public.update_administrator_planning_item_transaction(text, timestamptz, jsonb, jsonb, jsonb, text, text) to authenticated;
grant execute on function public.update_administrator_planning_task_transaction(text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb) to authenticated;
grant execute on function public.mutate_administrator_planning_relationship_transaction(text, text, text, text, bigint, text, timestamptz, text, text, text) to authenticated;

drop policy if exists founder_events_write_members on public.founder_events;
create policy founder_events_write_authorized
on public.founder_events
to authenticated
using (
  public.current_platform_role() in ('ceo', 'deputy')
  or public.current_profile_has_active_administrator_access()
)
with check (
  public.current_platform_role() in ('ceo', 'deputy')
  or public.current_profile_has_active_administrator_access()
);

drop policy if exists task_dependencies_write_members on public.task_dependencies;
create policy task_dependencies_write_authorized
on public.task_dependencies
to authenticated
using (
  public.current_platform_role() in ('ceo', 'founder', 'deputy')
)
with check (
  public.current_platform_role() in ('ceo', 'founder', 'deputy')
);

drop policy if exists task_links_write_members on public.task_links;
create policy task_links_write_authorized
on public.task_links
to authenticated
using (
  public.current_platform_role() in ('ceo', 'founder', 'deputy')
)
with check (
  public.current_platform_role() in ('ceo', 'founder', 'deputy')
);

drop policy if exists task_notes_write_members on public.task_notes;
create policy task_notes_write_authorized
on public.task_notes
to authenticated
using (
  public.current_platform_role() in ('ceo', 'founder', 'deputy')
)
with check (
  public.current_platform_role() in ('ceo', 'founder', 'deputy')
);

drop policy if exists projects_write_admin on public.projects;

drop policy if exists notification_deliveries_select_operational on public.notification_deliveries;
drop policy if exists notification_deliveries_write_operational on public.notification_deliveries;
create policy notification_deliveries_select_administrator
on public.notification_deliveries
for select
to authenticated
using (public.current_profile_has_active_administrator_access());

drop policy if exists notification_events_select_team on public.notification_events;
create policy notification_events_select_personal_or_administrator
on public.notification_events
for select
to authenticated
using (
  recipient_profile_id = public.current_profile_id()
  or public.current_profile_has_active_administrator_access()
);

update public.profile_ui_preferences
set default_workspace = 'notifications',
    updated_at = clock_timestamp()
where default_workspace = 'settings';

drop function if exists public.update_founderops_github_project_transaction(text, text, integer, text, integer, text, text, text);
drop function if exists public.update_profile_admin_transaction(text, text, jsonb, jsonb, text, text);
drop function if exists public.current_profile_role();

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles drop column if exists role;

revoke select on table public.profiles from authenticated;
grant select (
  id, name, platform_role, org_role, deputy_for, deputy_active_from,
  deputy_active_until, focus, weekly_capacity, profile_color
) on table public.profiles to authenticated;
