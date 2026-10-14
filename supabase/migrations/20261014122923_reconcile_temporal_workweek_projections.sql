-- Keep provider observations and private recovery separate from confirmed Team schedules.
alter table public.team_workweek_google_series add column if not exists observed_payload jsonb;
alter table public.team_workweek_versions add column if not exists retired_at timestamptz;
alter table public.team_workweek_versions add column if not exists restarted_version_id uuid references public.team_workweek_versions(id);
alter table public.team_workweek_google_conflicts add column if not exists google_variant_supported boolean not null default true;
alter table public.team_workweek_google_conflicts add column if not exists app_variant_supported boolean not null default true;
alter table public.team_workweek_google_conflicts add column if not exists founderops_binding_snapshot jsonb;


CREATE OR REPLACE FUNCTION "public"."apply_google_team_workweek_observations"("p_publication_id" "uuid", "p_publication_revision" integer, "p_observations" "jsonb", "p_observed_at" timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_observation jsonb;
  v_series_id uuid;
  v_prior_etag text;
  v_observed_etag text;
  v_founderops_revision integer;
  v_provider_state text;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_observations is null or jsonb_typeof(p_observations) <> 'array' or p_observed_at is null then
    raise exception using errcode = '22023', message = 'Google workweek observations are invalid';
  end if;
  if jsonb_array_length(p_observations) <> (
    select count(*)
    from public.team_workweek_google_series as series
    where series.publication_id = p_publication_id
      and series.state = 'confirmed'
      and series.provider_state = 'active'
  ) then
    raise exception using errcode = 'P0004', message = 'Google workweek observation set is stale';
  end if;
  if (
    select count(distinct value->>'seriesId')
    from jsonb_array_elements(p_observations)
  ) <> jsonb_array_length(p_observations) then
    raise exception using errcode = '22023', message = 'Google workweek observations contain duplicate series';
  end if;

  for v_observation in select value from jsonb_array_elements(p_observations)
  loop
    if jsonb_typeof(v_observation) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(v_observation) as key
        where key not in ('seriesId', 'priorEtag', 'observedEtag', 'founderopsRevision', 'providerState', 'observedPayload')
      )
      or v_observation->>'seriesId' is null
      or nullif(btrim(v_observation->>'priorEtag'), '') is null
      or nullif(btrim(v_observation->>'observedEtag'), '') is null
      or v_observation->>'founderopsRevision' is null
      or v_observation->>'providerState' not in ('active', 'deleted') then
      raise exception using errcode = '22023', message = 'Google workweek observation contains unsupported fields';
    end if;

    begin
      v_series_id := (v_observation->>'seriesId')::uuid;
      v_prior_etag := btrim(v_observation->>'priorEtag');
      v_observed_etag := btrim(v_observation->>'observedEtag');
      v_founderops_revision := (v_observation->>'founderopsRevision')::integer;
      v_provider_state := v_observation->>'providerState';
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'Google workweek observation contains invalid values';
    end;

    if v_provider_state='active' and v_observation ? 'observedPayload' and (
      jsonb_typeof(v_observation->'observedPayload')<>'object'
      or v_observation#>>'{observedPayload,extendedProperties,private,founderopsWorkweekSeriesId}' is distinct from v_series_id::text
      or v_observation#>>'{observedPayload,extendedProperties,private,founderopsWorkweekRevision}' is distinct from v_founderops_revision::text
      or not exists(select 1 from public.team_workweek_google_series where id=v_series_id and google_event_id=v_observation#>>'{observedPayload,id}')
    ) then raise exception using errcode='22023',message='observed managed payload identity is invalid'; end if;
    update public.team_workweek_google_series
    set observed_payload=case when v_provider_state='active' then coalesce(v_observation->'observedPayload',observed_payload) else observed_payload end,
      confirmed_etag = v_observed_etag,
      provider_state = v_provider_state,
      provider_deleted_at = case when v_provider_state = 'deleted' then p_observed_at else null end,
      last_observed_at = p_observed_at,
      last_confirmed_at = p_observed_at,
      last_error_class = null,
      updated_at = p_observed_at
    where id = v_series_id
      and publication_id = p_publication_id
      and state = 'confirmed'
      and provider_state = 'active'
      and confirmed_etag = v_prior_etag
      and confirmed_founderops_revision = v_founderops_revision;

    if not found then
      raise exception using errcode = 'P0004', message = 'Google workweek series changed during reconciliation';
    end if;
  end loop;

  if not exists (
    select 1
    from public.team_workweek_publications as publication
    where publication.id = p_publication_id
      and publication.publication_revision = p_publication_revision
  ) then
    raise exception using errcode = 'P0004', message = 'FounderOps workweek changed during reconciliation';
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."confirm_google_team_workweek_observation"("p_publication_id" "uuid", "p_publication_revision" integer, "p_observations" "jsonb", "p_observed_at" timestamp with time zone DEFAULT "clock_timestamp"()) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_publication public.team_workweek_publications%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;

  select * into v_publication
  from public.team_workweek_publications
  where id = p_publication_id
    and publication_revision = p_publication_revision
    and status = 'published'
    and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp() and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp()
  for update;

  if not found then
    raise exception using errcode = 'P0004', message = 'FounderOps workweek changed during reconciliation';
  end if;

  perform public.apply_google_team_workweek_observations(
    p_publication_id,
    p_publication_revision,
    p_observations,
    p_observed_at
  );

  insert into public.team_workweek_google_reconciliation_status (
    publication_id,
    owner_profile_id,
    state,
    last_observed_at,
    last_error_class,
    updated_at
  ) values (
    v_publication.id,
    v_publication.owner_profile_id,
    'confirmed',
    p_observed_at,
    null,
    p_observed_at
  )
  on conflict (publication_id) do update
  set owner_profile_id = excluded.owner_profile_id,
    state = excluded.state,
    last_observed_at = excluded.last_observed_at,
    last_error_class = excluded.last_error_class,
    updated_at = excluded.updated_at;

  update public.team_workweek_publications
  set last_sync_at = p_observed_at
  where id = p_publication_id;
end;
$$;

create or replace function public.insert_temporal_google_workweek_version(p_owner text,p_base uuid,p_revision integer,p_windows jsonb,p_origin text,p_fingerprint text,p_mode text default 'immediate',p_effective_from date default null,p_reconciliation_source uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_window jsonb; v_day integer; v_start integer; v_end integer;
begin
  if p_origin not in('owner','google_reconciliation') or p_mode not in('immediate','future_monday') or (p_mode='future_monday' and (p_effective_from is null or extract(isodow from p_effective_from)<>1)) or not exists(select 1 from public.profiles where id=p_owner)
    or p_windows is null or jsonb_typeof(p_windows)<>'array' or jsonb_array_length(p_windows)>84 then
    raise exception using errcode='22023',message='temporal workweek draft is invalid';
  end if;
  insert into public.team_workweek_versions(owner_profile_id,effective_from,activation_mode,base_publication_id,base_publication_revision,origin,google_reconciliation_source_publication_id,google_reconciliation_fingerprint)
    values(p_owner,case when p_mode='future_monday' then p_effective_from else date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date end,p_mode,p_base,p_revision,p_origin,
      case when p_origin='google_reconciliation' then coalesce(p_reconciliation_source,p_base) end,case when p_origin='google_reconciliation' then p_fingerprint end) returning id into v_id;
  for v_window in select value from jsonb_array_elements(p_windows) loop
    if jsonb_typeof(v_window)<>'object' or exists(select 1 from jsonb_object_keys(v_window) k where k not in('weekday','startMinute','endMinute'))
      or coalesce(v_window->>'weekday','')!~'^[1-7]$' or coalesce(v_window->>'startMinute','')!~'^[0-9]{1,4}$' or coalesce(v_window->>'endMinute','')!~'^[0-9]{1,4}$' then
      raise exception using errcode='22023',message='temporal workweek window is invalid';
    end if;
    v_day:=(v_window->>'weekday')::integer;v_start:=(v_window->>'startMinute')::integer;v_end:=(v_window->>'endMinute')::integer;
    if v_start<0 or v_end>1439 or v_start>=v_end or (select count(*) from public.team_workweek_windows where version_id=v_id and weekday=v_day)>=12
      or exists(select 1 from public.team_workweek_windows where version_id=v_id and weekday=v_day and v_start<end_minute and v_end>start_minute) then
      raise exception using errcode='22023',message='temporal workweek windows overlap or exceed a day';
    end if;
    insert into public.team_workweek_windows(version_id,weekday,start_minute,end_minute) values(v_id,v_day,v_start,v_end);
  end loop;
  return v_id;
end; $$;
revoke all on function public.insert_temporal_google_workweek_version(text,uuid,integer,jsonb,text,text,text,date,uuid) from public,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION "public"."prepare_google_team_workweek_reconciliation"("p_owner_profile_id" "text", "p_source_publication_id" "uuid", "p_source_publication_revision" integer, "p_effective_from" "date", "p_observations" "jsonb", "p_windows" "jsonb", "p_fingerprint" "text", "p_observed_at" timestamp with time zone DEFAULT "clock_timestamp"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_source public.team_workweek_publications%rowtype;
  v_existing public.team_workweek_versions%rowtype;
  v_target_version_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if nullif(btrim(p_owner_profile_id), '') is null
    or p_source_publication_revision < 1
    or p_observed_at is null
    or p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Google workweek reconciliation identity is invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id, 0));

  select * into v_existing
  from public.team_workweek_versions
  where google_reconciliation_source_publication_id = p_source_publication_id
    and google_reconciliation_fingerprint = p_fingerprint
  for update;

  if found then
    return jsonb_build_object(
      'versionId', v_existing.id,
      'effectiveFrom', v_existing.effective_from,
      'replayed', true
    );
  end if;

  select * into v_source
  from public.team_workweek_publications
  where id = p_source_publication_id
    and owner_profile_id = p_owner_profile_id
    and publication_revision = p_source_publication_revision
    and status = 'published'
    and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp() and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp()
  for update;

  if not found then
    raise exception using errcode = 'P0004', message = 'FounderOps workweek changed during reconciliation';
  end if;
  if exists (
    select 1
    from public.team_workweek_publications
    where owner_profile_id = p_owner_profile_id and status = 'preparing'
  ) then
    raise exception using errcode = 'P0003', message = 'another team workweek publication is still preparing';
  end if;
  if exists (
    select 1
    from public.team_workweek_versions as version
    where version.owner_profile_id = p_owner_profile_id
      and version.status = 'preparing'
      and version.origin = 'owner'
      and version.retired_at is null
      and not exists (
        select 1
        from public.team_workweek_publications as publication
        where publication.source_version_id = version.id
      )
  ) then
    raise exception using errcode = 'P0003', message = 'an owner workweek draft is already preparing';
  end if;

  if p_windows is null
    or jsonb_typeof(p_windows) <> 'array'
    or jsonb_array_length(p_windows) > 84
    or p_windows = v_source.windows then
    raise exception using errcode = '22023', message = 'Google reconciliation windows are invalid or unchanged';
  end if;

  perform public.apply_google_team_workweek_observations(
    p_source_publication_id,
    p_source_publication_revision,
    p_observations,
    p_observed_at
  );

  v_target_version_id:=public.insert_temporal_google_workweek_version(p_owner_profile_id,v_source.id,v_source.publication_revision,p_windows,'google_reconciliation',p_fingerprint);
  return jsonb_build_object('versionId',v_target_version_id,'activationMode','immediate','replayed',false);
end;
$_$;


CREATE OR REPLACE FUNCTION "public"."create_team_workweek_google_conflict"("p_owner_profile_id" "text", "p_base_publication_id" "uuid", "p_base_publication_revision" integer, "p_founderops_version_id" "uuid", "p_google_effective_from" "date", "p_google_windows" "jsonb", "p_google_observations" "jsonb", "p_google_fingerprint" "text", "p_founderops_fingerprint" "text", "p_observed_at" timestamp with time zone DEFAULT "clock_timestamp"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_conflict public.team_workweek_google_conflicts%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if nullif(btrim(p_owner_profile_id), '') is null
    or p_base_publication_revision < 1
    or p_google_effective_from is null
    or p_google_windows is null or jsonb_typeof(p_google_windows) <> 'array'
    or p_google_observations is null or jsonb_typeof(p_google_observations) <> 'array'
    or p_google_fingerprint !~ '^[0-9a-f]{64}$'
    or p_founderops_fingerprint !~ '^[0-9a-f]{64}$'
    or p_observed_at is null then
    raise exception using errcode = '22023', message = 'parallel workweek conflict is invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id, 0));

  if not exists (
    select 1 from public.team_workweek_publications
    where id = p_base_publication_id
      and owner_profile_id = p_owner_profile_id
      and publication_revision = p_base_publication_revision
      and status = 'published'
      and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp() and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp()
  ) then
    raise exception using errcode = 'P0004', message = 'confirmed workweek changed before conflict capture';
  end if;
  if not exists (
    select 1 from public.team_workweek_versions as version
    where version.id = p_founderops_version_id
      and version.owner_profile_id = p_owner_profile_id
      and version.origin = 'owner' and version.retired_at is null
      and not exists (
        select 1 from public.team_workweek_publications as publication
        where publication.source_version_id = version.id
      )
      and version.id = (
        select candidate.id
        from public.team_workweek_versions as candidate
        where candidate.owner_profile_id = p_owner_profile_id
          and candidate.origin = 'owner' and candidate.retired_at is null
          and not exists (
            select 1 from public.team_workweek_publications as publication
            where publication.source_version_id = candidate.id
          )
        order by candidate.created_at desc, candidate.id desc
        limit 1
      )
  ) then
    raise exception using errcode = 'P0004', message = 'FounderOps draft changed before conflict capture';
  end if;

  insert into public.team_workweek_google_conflicts (
    owner_profile_id,
    base_publication_id,
    base_publication_revision,
    founderops_version_id,
    google_effective_from,
    google_windows,
    google_observations,
    google_fingerprint,
    founderops_fingerprint,
    founderops_binding_snapshot,
    observed_at,
    updated_at
  ) values (
    p_owner_profile_id,
    p_base_publication_id,
    p_base_publication_revision,
    p_founderops_version_id,
    p_google_effective_from,
    p_google_windows,
    p_google_observations,
    p_google_fingerprint,
    p_founderops_fingerprint,
    public.team_workweek_private_binding(p_founderops_version_id),
    p_observed_at,
    p_observed_at
  )
  on conflict (base_publication_id, founderops_version_id, google_fingerprint) do update
  set observed_at = excluded.observed_at,
    updated_at = excluded.updated_at
  returning * into v_conflict;

  insert into public.team_workweek_google_reconciliation_status (
    publication_id, owner_profile_id, state, last_observed_at, last_error_class, updated_at
  ) values (
    p_base_publication_id, p_owner_profile_id, 'conflict', p_observed_at, 'founderops_changed', p_observed_at
  )
  on conflict (publication_id) do update
  set owner_profile_id = excluded.owner_profile_id,
    state = excluded.state,
    last_observed_at = excluded.last_observed_at,
    last_error_class = excluded.last_error_class,
    updated_at = excluded.updated_at;

  return jsonb_build_object('id', v_conflict.id, 'conflictRevision', v_conflict.conflict_revision, 'state', v_conflict.state);
end;
$_$;


create or replace function public.team_workweek_private_binding(p_version uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('versionId',v.id,'effectiveFrom',v.effective_from,'preparedContext',public.team_workweek_successor_snapshot(v.owner_profile_id),'activationMode',v.activation_mode,'basePublicationId',v.base_publication_id,'basePublicationRevision',v.base_publication_revision,'successorSnapshot',v.successor_snapshot,
    'windows',(select coalesce(jsonb_agg(jsonb_build_object('weekday',w.weekday,'startMinute',w.start_minute,'endMinute',w.end_minute) order by w.weekday,w.start_minute,w.end_minute,w.id),'[]') from public.team_workweek_windows w where w.version_id=v.id))
  from public.team_workweek_versions v where v.id=p_version;
$$;
revoke all on function public.team_workweek_private_binding(uuid) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION "public"."prepare_team_workweek_google_conflict_resolution"("p_conflict_id" "uuid", "p_owner_profile_id" "text", "p_conflict_revision" integer, "p_decision" "text", "p_google_observations" "jsonb", "p_google_fingerprint" "text", "p_founderops_fingerprint" "text", "p_resolution_fingerprint" "text", "p_observed_at" timestamp with time zone DEFAULT "clock_timestamp"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_conflict public.team_workweek_google_conflicts%rowtype;
  v_founderops_version public.team_workweek_versions%rowtype;
  v_version_id uuid;
  v_windows jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_conflict_revision < 1
    or p_decision not in ('founderops', 'google')
    or p_google_observations is null or jsonb_typeof(p_google_observations) <> 'array'
    or p_google_fingerprint !~ '^[0-9a-f]{64}$'
    or p_founderops_fingerprint !~ '^[0-9a-f]{64}$'
    or p_resolution_fingerprint !~ '^[0-9a-f]{64}$'
    or p_observed_at is null then
    raise exception using errcode = '22023', message = 'workweek conflict decision is invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id, 0));
  select * into v_conflict
  from public.team_workweek_google_conflicts
  where id = p_conflict_id and owner_profile_id = p_owner_profile_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'workweek conflict not found';
  end if;
  if v_conflict.conflict_revision <> p_conflict_revision then
    raise exception using errcode = 'P0004', message = 'workweek conflict decision is stale';
  end if;
  if v_conflict.state in ('resolving', 'resolved') then
    if v_conflict.decision <> p_decision then
      raise exception using errcode = 'P0004', message = 'workweek conflict was resolved differently';
    end if;
    return jsonb_build_object(
      'versionId', v_conflict.resolution_version_id,
      'state', v_conflict.state,
      'replayed', true
    );
  end if;
  if p_google_fingerprint <> v_conflict.google_fingerprint
    or p_founderops_fingerprint <> v_conflict.founderops_fingerprint
    or p_google_observations <> v_conflict.google_observations then
    raise exception using errcode = 'P0004', message = 'Google or FounderOps workweek changed after conflict capture';
  end if;
  if not exists (
    select 1 from public.team_workweek_publications
    where id = v_conflict.base_publication_id
      and publication_revision = v_conflict.base_publication_revision
      and status = 'published'
      and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp() and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp()
  ) then
    raise exception using errcode = 'P0004', message = 'confirmed workweek changed after conflict capture';
  end if;

  select * into v_founderops_version
  from public.team_workweek_versions
  where id = v_conflict.founderops_version_id
    and owner_profile_id = p_owner_profile_id
  for update;
  if not found or exists (
    select 1 from public.team_workweek_publications
    where source_version_id = v_founderops_version.id
  ) or v_founderops_version.id <> (
    select candidate.id
    from public.team_workweek_versions as candidate
    where candidate.owner_profile_id = p_owner_profile_id
      and candidate.origin = 'owner' and candidate.retired_at is null
      and not exists (
        select 1 from public.team_workweek_publications as publication
        where publication.source_version_id = candidate.id
      )
    order by candidate.created_at desc, candidate.id desc
    limit 1
  ) then
    raise exception using errcode = 'P0004', message = 'FounderOps draft changed after conflict capture';
  end if;

  if (v_conflict.founderops_binding_snapshot is not null and v_conflict.founderops_binding_snapshot<>public.team_workweek_private_binding(v_founderops_version.id))
    or (v_founderops_version.successor_snapshot is not null and v_founderops_version.successor_snapshot<>public.team_workweek_successor_snapshot(p_owner_profile_id)) then
    raise exception using errcode='P0004',message='private or prepared workweek context changed after the decision';
  end if;
  perform public.apply_google_team_workweek_observations(
    v_conflict.base_publication_id,
    v_conflict.base_publication_revision,
    p_google_observations,
    p_observed_at
  );

  if (p_decision='google' and not v_conflict.google_variant_supported) or (p_decision='founderops' and not v_conflict.app_variant_supported) then
    raise exception using errcode='P0004',message='this physical projection has no safely supported chosen variant';
  end if;
  if p_decision = 'google' then
    v_windows := v_conflict.google_windows;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'weekday', work_window.weekday,
      'startMinute', work_window.start_minute,
      'endMinute', work_window.end_minute
    ) order by work_window.weekday, work_window.start_minute, work_window.end_minute, work_window.id), '[]'::jsonb)
    into v_windows
    from public.team_workweek_windows as work_window
    where work_window.version_id = v_founderops_version.id;
  end if;

  v_version_id:=public.insert_temporal_google_workweek_version(p_owner_profile_id,case when p_decision='founderops' and v_founderops_version.activation_mode='future_monday' then null else v_conflict.base_publication_id end,case when p_decision='founderops' and v_founderops_version.activation_mode='future_monday' then null else v_conflict.base_publication_revision end,v_windows,'google_reconciliation',p_resolution_fingerprint,case when p_decision='founderops' then v_founderops_version.activation_mode else 'immediate' end,case when p_decision='founderops' then v_founderops_version.effective_from end,v_conflict.base_publication_id);

  update public.team_workweek_google_conflicts
  set state = 'resolving',
    decision = p_decision,
    resolution_version_id = v_version_id,
    updated_at = p_observed_at
  where id = v_conflict.id;

  return jsonb_build_object('versionId', v_version_id, 'state', 'resolving', 'replayed', false);
end;
$_$;

CREATE OR REPLACE FUNCTION "public"."complete_team_workweek_google_conflict_resolution"("p_conflict_id" "uuid", "p_owner_profile_id" "text", "p_conflict_revision" integer, "p_resolved_at" timestamp with time zone DEFAULT "clock_timestamp"()) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_conflict public.team_workweek_google_conflicts%rowtype;
  v_publication public.team_workweek_publications%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id, 0));
  select * into v_conflict from public.team_workweek_google_conflicts
  where id = p_conflict_id
    and owner_profile_id = p_owner_profile_id
    and conflict_revision = p_conflict_revision
  for update;
  if not found then
    raise exception using errcode = 'P0004', message = 'workweek conflict decision is stale';
  end if;
  if v_conflict.state = 'resolved' then return; end if;
  select * into v_publication from public.team_workweek_publications
  where source_version_id = v_conflict.resolution_version_id and status = 'published';
  if not found then
    raise exception using errcode = 'P0003', message = 'resolved workweek is not fully published';
  end if;
  update public.team_workweek_google_conflicts
  set state = 'resolved', resolved_at = p_resolved_at, updated_at = p_resolved_at
  where id = v_conflict.id;
  update public.team_workweek_versions set retired_at=p_resolved_at where id=v_conflict.founderops_version_id and owner_profile_id=p_owner_profile_id;
  insert into public.team_workweek_google_reconciliation_status (
    publication_id, owner_profile_id, state, last_observed_at, last_error_class, updated_at
  ) values (v_publication.id, p_owner_profile_id, 'confirmed', p_resolved_at, null, p_resolved_at)
  on conflict (publication_id) do update
  set state = excluded.state,
    last_observed_at = excluded.last_observed_at,
    last_error_class = excluded.last_error_class,
    updated_at = excluded.updated_at;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."refresh_team_workweek_google_conflict_resolution"("p_conflict_id" "uuid", "p_owner_profile_id" "text", "p_conflict_revision" integer, "p_decision" "text", "p_google_observations" "jsonb", "p_google_fingerprint" "text", "p_observed_at" timestamp with time zone DEFAULT "clock_timestamp"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_conflict public.team_workweek_google_conflicts%rowtype;
  v_publication public.team_workweek_publications%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_conflict_revision < 1
    or p_decision not in ('founderops', 'google')
    or p_google_observations is null or jsonb_typeof(p_google_observations) <> 'array'
    or p_google_fingerprint !~ '^[0-9a-f]{64}$'
    or p_observed_at is null then
    raise exception using errcode = '22023', message = 'workweek conflict refresh is invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id, 0));
  select * into v_conflict
  from public.team_workweek_google_conflicts
  where id = p_conflict_id and owner_profile_id = p_owner_profile_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'workweek conflict not found';
  end if;
  if v_conflict.conflict_revision <> p_conflict_revision
    or v_conflict.state <> 'resolving'
    or v_conflict.decision <> p_decision then
    raise exception using errcode = 'P0004', message = 'workweek conflict refresh is stale';
  end if;

  select * into v_publication
  from public.team_workweek_publications
  where source_version_id = v_conflict.resolution_version_id
    and owner_profile_id = p_owner_profile_id
    and status = 'preparing'
  for update;
  if not found then
    raise exception using errcode = 'P0004', message = 'workweek conflict publication is not refreshable';
  end if;

  if v_publication.attempt_generation>0 then
    raise exception using errcode='P0004',message='changed physical conflict requires explicit compensated restart';
  end if;
  perform public.apply_google_team_workweek_observations(
    v_conflict.base_publication_id,
    v_conflict.base_publication_revision,
    p_google_observations,
    p_observed_at
  );

  update public.team_workweek_google_series_transitions as transition
  set expected_etag = predecessor.confirmed_etag,
    expected_founderops_revision = predecessor.confirmed_founderops_revision
  from public.team_workweek_google_series as predecessor
  where transition.activation_publication_id = v_publication.id
    and transition.predecessor_series_id = predecessor.id
    and transition.state = 'pending'
    and predecessor.confirmed_etag is not null
    and predecessor.confirmed_founderops_revision is not null;

  update public.team_workweek_google_conflicts
  set google_observations = p_google_observations,
    google_fingerprint = p_google_fingerprint,
    conflict_revision = conflict_revision + 1,
    observed_at = p_observed_at,
    updated_at = p_observed_at
  where id = v_conflict.id
  returning * into v_conflict;

  return jsonb_build_object(
    'id', v_conflict.id,
    'conflictRevision', v_conflict.conflict_revision,
    'state', v_conflict.state,
    'decision', v_conflict.decision
  );
end;
$_$;

create or replace function public.plan_team_workweek_predecessor_effects(p_publication_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_publication public.team_workweek_publications%rowtype;
  v_predecessor public.team_workweek_publications%rowtype;
  v_series record;
  v_prior record;
  v_before jsonb;
  v_payload jsonb;
  v_effect_id uuid;
  v_first_date date;
  v_start timestamptz;
  v_count integer;
  v_boundary jsonb;
  v_latest_etag text;
begin
  select * into v_publication from public.team_workweek_publications where id=p_publication_id;
  if v_publication.predecessor_publication_id is null or exists(select 1 from public.team_workweek_publication_effects
    where publication_id=p_publication_id and generation=v_publication.attempt_generation and operation<>'create') then return; end if;
  select * into v_predecessor from public.team_workweek_publications where id=v_publication.predecessor_publication_id;
  for v_series in select series.*,work_window.weekday,work_window.start_minute,work_window.end_minute
    from public.team_workweek_google_series series join public.team_workweek_windows work_window on work_window.id=series.source_window_id
    where series.publication_id=v_predecessor.id and series.provider_state='active' order by series.id loop
    if v_series.state<>'confirmed' then raise exception using errcode='P0003',message='predecessor series must be confirmed'; end if;
    select payload into v_before from public.team_workweek_publication_effects
      where series_id=v_series.id and kind in('weekly','predecessor_cutoff') and state='confirmed' order by observed_at desc nulls last,id desc limit 1;
    if v_before is null then
      v_first_date:=v_predecessor.effective_from+v_series.weekday-1;
      v_before:=jsonb_build_object('id',v_series.google_event_id,'summary','Arbeitszeit','description','Mit FounderOps synchronisiert',
        'start',jsonb_build_object('dateTime',public.team_workweek_berlin_civil_instant(v_first_date::timestamp+make_interval(mins=>v_series.start_minute)),'timeZone','Europe/Berlin'),
        'end',jsonb_build_object('dateTime',public.team_workweek_berlin_civil_instant(v_first_date::timestamp+make_interval(mins=>v_series.end_minute)),'timeZone','Europe/Berlin'),
        'recurrence',jsonb_build_array('RRULE:FREQ=WEEKLY'),'transparency','transparent','visibility','private','reminders',jsonb_build_object('useDefault',false),
        'extendedProperties',jsonb_build_object('private',jsonb_build_object('founderopsWorkweekSeriesId',v_series.id,'founderopsWorkweekRevision',v_predecessor.publication_revision::text)));
    end if;
    v_before:=coalesce(v_series.observed_payload,v_before);
    if v_before->>'status'='cancelled' then continue;end if;
    v_boundary:=public.team_workweek_payload_before(v_before,v_publication.effective_at);
    v_count:=case when (v_boundary->>'elapsed')::boolean then 1 else 0 end;
    v_effect_id:=gen_random_uuid();
    v_payload:=v_before||jsonb_build_object('status',case when v_count=0 then 'cancelled' else 'confirmed' end);
    if v_count>0 then v_payload:=v_boundary->'payload';end if;
    if v_payload=v_before and (v_boundary->'crossing' is null or v_boundary->'crossing'='null'::jsonb) then continue;end if;
    v_payload:=jsonb_set(v_payload,'{extendedProperties,private}',(v_before#>'{extendedProperties,private}')||jsonb_build_object('founderopsWorkweekTransitionId',v_effect_id::text));
    insert into public.team_workweek_publication_effects(id,publication_id,owner_profile_id,generation,series_id,kind,google_event_id,payload,operation,expected_payload,expected_etag)
      values(v_effect_id,v_publication.id,v_publication.owner_profile_id,v_publication.attempt_generation,v_series.id,'predecessor_cutoff',v_series.google_event_id,v_payload,
        case when v_count=0 then 'cancel' else 'update' end,v_before,v_series.confirmed_etag);
    if v_count>0 and v_boundary->'crossing' is not null and v_boundary->'crossing'<>'null'::jsonb then
      v_effect_id:=gen_random_uuid();
      v_before:=v_boundary->'crossing';
      v_start:=(v_before#>>'{start,dateTime}')::timestamptz;
      v_payload:=jsonb_set(v_before,'{end,dateTime}',to_jsonb(v_publication.effective_at));
      v_payload:=jsonb_set(v_payload,'{extendedProperties,private}',(v_before#>'{extendedProperties,private}')||jsonb_build_object('founderopsWorkweekTransitionId',v_effect_id::text));
      insert into public.team_workweek_publication_effects(id,publication_id,owner_profile_id,generation,kind,google_event_id,payload,operation,expected_payload,instance_of,original_start)
        values(v_effect_id,v_publication.id,v_publication.owner_profile_id,v_publication.attempt_generation,'crossing_instance',v_series.google_event_id,v_payload,'update',v_before,v_series.google_event_id,v_start);
    end if;
  end loop;
  for v_prior in select * from public.team_workweek_publication_effects
    where publication_id=v_predecessor.id and kind='activation_remainder' and operation='create' and state='confirmed' loop
    select coalesce(cleanup_payload,payload),coalesce(cleanup_confirmed_etag,confirmed_etag) into v_before,v_latest_etag from public.team_workweek_publication_effects where google_event_id=v_prior.google_event_id and kind in('activation_remainder','predecessor_remainder') and (state='confirmed' or (state='cleaned' and cleanup_preserved)) order by observed_at desc nulls last,id desc limit 1;
    if (v_before#>>'{end,dateTime}')::timestamptz<=v_publication.effective_at then continue; end if;
    v_effect_id:=gen_random_uuid();
    if (v_before#>>'{start,dateTime}')::timestamptz<v_publication.effective_at then
      v_payload:=jsonb_set(v_before,'{end,dateTime}',to_jsonb(v_publication.effective_at));
    else v_payload:=v_before||jsonb_build_object('status','cancelled'); end if;
    v_payload:=jsonb_set(v_payload,'{extendedProperties,private}',(v_before#>'{extendedProperties,private}')||jsonb_build_object('founderopsWorkweekTransitionId',v_effect_id::text));
    insert into public.team_workweek_publication_effects(id,publication_id,owner_profile_id,generation,kind,google_event_id,payload,operation,expected_payload,expected_etag)
      values(v_effect_id,v_publication.id,v_publication.owner_profile_id,v_publication.attempt_generation,'predecessor_remainder',v_prior.google_event_id,v_payload,
        case when v_payload->>'status'='cancelled' then 'cancel' else 'update' end,v_before,v_latest_etag);
  end loop;
end; $$;

create or replace function public.confirm_team_workweek_effect(p_effect_id uuid,p_generation integer,p_etag text,p_payload jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_effect public.team_workweek_publication_effects%rowtype; v_publication public.team_workweek_publications%rowtype;
begin
  select * into v_effect from public.team_workweek_publication_effects where id=p_effect_id;
  if not found then raise exception using errcode='P0002',message='effect not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_effect.owner_profile_id,0));
  select * into v_publication from public.team_workweek_publications where id=v_effect.publication_id for update;
  if v_publication.status<>'preparing' or v_publication.attempt_generation<>p_generation or v_effect.generation<>p_generation
    or v_effect.state='cleaned' or v_effect.payload<>p_payload or nullif(trim(p_etag),'') is null or clock_timestamp()>=v_publication.effective_at
    or (v_effect.kind='crossing_instance' and v_effect.expected_etag is null) then
    raise exception using errcode='P0003',message='stale or expired projection confirmation';
  end if;
  update public.team_workweek_publication_effects set state='confirmed',confirmed_etag=p_etag,observed_at=clock_timestamp() where id=p_effect_id;
  if v_effect.series_id is not null then
    update public.team_workweek_google_series set observed_payload=p_payload,state='confirmed',confirmed_etag=p_etag,
      confirmed_founderops_revision=case when v_effect.operation='create' then v_publication.publication_revision else confirmed_founderops_revision end,
      last_confirmed_at=clock_timestamp(),last_observed_at=clock_timestamp() where id=v_effect.series_id;
  end if;
end; $$;

create or replace function public.confirm_team_workweek_effect_restoration(p_effect_id uuid,p_generation integer,p_etag text)
returns void language plpgsql security definer set search_path=public as $$
declare v_effect public.team_workweek_publication_effects%rowtype;
begin
  select * into v_effect from public.team_workweek_publication_effects where id=p_effect_id;
  if not found or v_effect.operation='create' or nullif(trim(p_etag),'') is null then
    raise exception using errcode='22023',message='restored predecessor observation required';
  end if;
  perform public.confirm_team_workweek_effect_cleanup(p_effect_id,p_generation);
  if v_effect.series_id is not null then
    update public.team_workweek_google_series set observed_payload=v_effect.expected_payload,confirmed_etag=p_etag,last_observed_at=clock_timestamp() where id=v_effect.series_id;
  end if;
  update public.team_workweek_publication_effects set confirmed_etag=p_etag
    where publication_id<>v_effect.publication_id and google_event_id=v_effect.google_event_id and operation='create' and state='confirmed';
end; $$;
create or replace function public.capture_team_workweek_physical_conflict(p_owner_profile_id text,p_base_publication_id uuid,p_base_publication_revision integer,p_google_windows jsonb,p_google_observations jsonb,p_google_fingerprint text,p_google_variant_supported boolean,p_app_variant_supported boolean,p_observed_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_version public.team_workweek_versions%rowtype; v_base public.team_workweek_publications%rowtype; v_result jsonb; v_fingerprint text; v_version_id uuid;
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='service role required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id,0));
  select * into v_base from public.team_workweek_publications where id=p_base_publication_id and owner_profile_id=p_owner_profile_id and publication_revision=p_base_publication_revision and status='published';
  if not found then raise exception using errcode='P0004',message='confirmed workweek is stale'; end if;
  select * into v_version from public.team_workweek_versions where owner_profile_id=p_owner_profile_id and origin='owner' and retired_at is null
    and not exists(select 1 from public.team_workweek_publications where source_version_id=team_workweek_versions.id) order by created_at desc,id desc limit 1;
  if not found then
    v_version_id:=public.insert_temporal_google_workweek_version(p_owner_profile_id,v_base.id,v_base.publication_revision,v_base.windows,'owner',null);
    select * into v_version from public.team_workweek_versions where id=v_version_id;
  end if;
  -- The exact private fingerprint is calculated by the same server view before a decision.
  v_fingerprint:=encode(sha256(convert_to(public.team_workweek_private_binding(v_version.id)::text,'UTF8')),'hex');
  v_result:=public.create_team_workweek_google_conflict(p_owner_profile_id,v_base.id,v_base.publication_revision,v_version.id,v_version.effective_from,p_google_windows,p_google_observations,p_google_fingerprint,v_fingerprint,p_observed_at);
  update public.team_workweek_google_conflicts set google_variant_supported=p_google_variant_supported,app_variant_supported=p_app_variant_supported,founderops_binding_snapshot=public.team_workweek_private_binding(v_version.id) where id=(v_result->>'id')::uuid;
  return v_result||jsonb_build_object('requiresViewFingerprint',true);
end; $$;
revoke all on function public.capture_team_workweek_physical_conflict(text,uuid,integer,jsonb,jsonb,text,boolean,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.capture_team_workweek_physical_conflict(text,uuid,integer,jsonb,jsonb,text,boolean,boolean,timestamptz) to service_role;


-- Cleanup decisions are immutable per generation. Provider evidence decides whether
-- the predecessor can be restored; elapsed provisional prefixes must not overlap it.
alter table public.team_workweek_publications add column cleanup_history jsonb not null default '{}';
alter table public.team_workweek_publication_effects add column cleanup_at timestamptz;
alter table public.team_workweek_publication_effects add column cleanup_payload jsonb;
alter table public.team_workweek_publication_effects add column cleanup_disposition text check(cleanup_disposition in('delete','preserve','retain','restore'));
alter table public.team_workweek_publication_effects add column cleanup_parent_id uuid references public.team_workweek_publication_effects(id);
alter table public.team_workweek_publication_effects add column cleanup_preserved boolean not null default false;
alter table public.team_workweek_publication_effects add column cleanup_confirmed_etag text;
alter table public.team_workweek_publication_effects drop constraint team_workweek_effect_kind;
alter table public.team_workweek_publication_effects add constraint team_workweek_effect_kind check(kind in('weekly','activation_remainder','predecessor_cutoff','crossing_instance','predecessor_remainder','cleanup_crossing'));

create or replace function public.team_workweek_payload_before(p_payload jsonb,p_cutoff timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_first timestamptz;v_end timestamptz;v_rule text;v_part text;v_until timestamptz;v_count integer;v_last_date date;v_start timestamptz;v_payload jsonb;v_crossing jsonb;
begin
  v_first:=(p_payload#>>'{start,dateTime}')::timestamptz;v_end:=(p_payload#>>'{end,dateTime}')::timestamptz;
  if v_first is null or v_end<=v_first or p_cutoff is null then raise exception using errcode='22023',message='invalid cleanup boundary';end if;
  if p_payload->>'status'='cancelled' or v_first>=p_cutoff then return jsonb_build_object('elapsed',false);end if;
  if p_payload->'recurrence' is null then
    return jsonb_build_object('elapsed',true,'payload',jsonb_set(p_payload,'{end,dateTime}',to_jsonb(least(v_end,p_cutoff))));
  end if;
  if jsonb_array_length(p_payload->'recurrence')<>1 then raise exception using errcode='P0004',message='ambiguous recurrence boundary';end if;
  v_rule:=p_payload#>>'{recurrence,0}';v_part:=coalesce(p_payload#>>'{extendedProperties,private,founderopsWorkweekProjectionPart}','legacy');
  if v_part not in('legacy','weekly','ordinary-months','transition-month-ordinary','spring','autumn')
    or regexp_replace(v_rule,';(COUNT|UNTIL)=[^;]+','','g')<>(case v_part
      when 'ordinary-months' then 'RRULE:FREQ=WEEKLY;BYDAY=SU;BYMONTH=1,2,4,5,6,7,8,9,11,12'
      when 'transition-month-ordinary' then 'RRULE:FREQ=MONTHLY;BYMONTH=3,10;BYDAY=SU;BYSETPOS=1,2,3,-2'
      when 'spring' then 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU'
      when 'autumn' then 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU' else 'RRULE:FREQ=WEEKLY' end) then
    raise exception using errcode='P0004',message='unsupported managed recurrence boundary';end if;
  v_until:=p_cutoff-interval '1 second';
  if v_rule ~ ';UNTIL=' then v_until:=least(v_until,(to_timestamp(substring(v_rule from ';UNTIL=([0-9]{8}T[0-9]{6}Z)'),'YYYYMMDD"T"HH24MISS"Z"') at time zone current_setting('TimeZone')) at time zone 'UTC');end if;
  if v_rule ~ ';COUNT=' then
    v_count:=substring(v_rule from ';COUNT=([0-9]+)')::integer;
    if v_part not in('legacy','weekly') or v_count<1 then raise exception using errcode='P0004',message='unsupported counted cohort';end if;
    v_until:=least(v_until,public.team_workweek_berlin_civil_instant((v_first at time zone 'Europe/Berlin')+(v_count-1)*interval '7 days'));
  end if;
  select max(day::date) into v_last_date from generate_series((v_first at time zone 'Europe/Berlin')::date::timestamp,(v_until at time zone 'Europe/Berlin')::date::timestamp,interval '1 day') day
    where extract(isodow from day)=extract(isodow from v_first at time zone 'Europe/Berlin')
      and (v_part in('legacy','weekly') or public.team_workweek_projection_part(day::date)=v_part)
      and (case when day::date=(v_first at time zone 'Europe/Berlin')::date then v_first else public.team_workweek_berlin_civil_instant(day::date+(v_first at time zone 'Europe/Berlin')::time) end)<=v_until;
  if v_last_date is null then return jsonb_build_object('elapsed',false);end if;
  v_start:=case when v_last_date=(v_first at time zone 'Europe/Berlin')::date then v_first else public.team_workweek_berlin_civil_instant(v_last_date+(v_first at time zone 'Europe/Berlin')::time) end;
  v_payload:=jsonb_set(p_payload,'{recurrence}',jsonb_build_array(regexp_replace(v_rule,';(COUNT|UNTIL)=[^;]+','','g')||';UNTIL='||to_char(v_until at time zone 'UTC','YYYYMMDD"T"HH24MISS"Z"')));
  if v_start<p_cutoff and v_start+(v_end-v_first)>p_cutoff then
    v_crossing:=(p_payload-'recurrence')||jsonb_build_object('start',jsonb_build_object('dateTime',v_start,'timeZone','Europe/Berlin'),'end',jsonb_build_object('dateTime',v_start+(v_end-v_first),'timeZone','Europe/Berlin'));
  end if;
  return jsonb_build_object('elapsed',true,'payload',v_payload,'crossing',v_crossing);
end;$$;
revoke all on function public.team_workweek_payload_before(jsonb,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.prepare_team_workweek_effect_cleanup(p_publication_id uuid,p_generation integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_pub public.team_workweek_publications%rowtype;v_effect public.team_workweek_publication_effects%rowtype;v_cutoff timestamptz;v_boundary jsonb;v_id uuid;v_crossing jsonb;v_effects jsonb;v_preserved boolean;
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='service role required';end if;
  select * into v_pub from public.team_workweek_publications where id=p_publication_id;
  if not found then raise exception using errcode='P0002',message='publication not found';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_pub.owner_profile_id,0));
  select * into v_pub from public.team_workweek_publications where id=p_publication_id for update;
  if v_pub.status<>'preparing' or v_pub.attempt_generation<>p_generation or v_pub.effective_at>clock_timestamp() then raise exception using errcode='P0003',message='active or committed projection cannot be cleaned';end if;
  select coalesce((v_pub.cleanup_history->>p_generation::text)::timestamptz,min(cleanup_at),clock_timestamp()) into v_cutoff from public.team_workweek_publication_effects where publication_id=p_publication_id and generation=p_generation;
  update public.team_workweek_publications set cleanup_history=cleanup_history||jsonb_build_object(p_generation::text,v_cutoff) where id=p_publication_id;
  for v_effect in select * from public.team_workweek_publication_effects where publication_id=p_publication_id and generation=p_generation and operation='create' and cleanup_at is null and state<>'cleaned' order by id loop
    v_boundary:=public.team_workweek_payload_before(v_effect.payload,v_cutoff);
    update public.team_workweek_publication_effects set cleanup_at=v_cutoff,cleanup_disposition=case when (v_boundary->>'elapsed')::boolean then 'preserve' else 'delete' end,cleanup_payload=v_boundary->'payload' where id=v_effect.id;
    v_crossing:=v_boundary->'crossing';
    if v_crossing is not null and v_crossing<>'null'::jsonb then
      v_id:=gen_random_uuid();
      insert into public.team_workweek_publication_effects(id,publication_id,owner_profile_id,generation,kind,google_event_id,operation,payload,expected_payload,instance_of,original_start,cleanup_at,cleanup_disposition,cleanup_payload,cleanup_parent_id)
        values(v_id,p_publication_id,v_pub.owner_profile_id,p_generation,'cleanup_crossing',v_effect.google_event_id,'update',v_crossing,v_crossing,v_effect.google_event_id,(v_crossing#>>'{start,dateTime}')::timestamptz,v_cutoff,'preserve',jsonb_set(v_crossing,'{end,dateTime}',to_jsonb(v_cutoff)),v_effect.id);
    end if;
  end loop;
  -- Restoration is planned only after all provisional creates and their crossing
  -- occurrences have confirmed cleanup evidence. Replays cannot change that decision.
  if not exists(select 1 from public.team_workweek_publication_effects where publication_id=p_publication_id and generation=p_generation and (operation='create' or kind='cleanup_crossing') and state<>'cleaned') then
    select coalesce(bool_or(cleanup_preserved),false) into v_preserved from public.team_workweek_publication_effects where publication_id=p_publication_id and generation=p_generation and operation='create';
    update public.team_workweek_publication_effects set cleanup_at=v_cutoff,cleanup_disposition=case when v_preserved then 'retain' else 'restore' end,cleanup_payload=case when v_preserved then payload else expected_payload end
      where publication_id=p_publication_id and generation=p_generation and operation<>'create' and kind<>'cleanup_crossing' and cleanup_at is null and state<>'cleaned';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'calendarId','primary','googleEventId',google_event_id,'generation',generation,'kind',kind,'operation',operation,'payload',payload,'expectedPayload',expected_payload,'expectedEtag',expected_etag,'instanceOf',instance_of,'originalStart',original_start,'state',state,'confirmedEtag',confirmed_etag,'cleanupAt',cleanup_at,'cleanupDisposition',cleanup_disposition,'cleanupPayload',cleanup_payload,'cleanupParentId',cleanup_parent_id,'cleanupPreserved',cleanup_preserved) order by case when operation='create' then 0 when kind='cleanup_crossing' then 1 else 2 end,id),'[]') into v_effects from public.team_workweek_publication_effects where publication_id=p_publication_id and generation=p_generation and cleanup_at is not null;
  return jsonb_build_object('effects',v_effects,'cleanupAt',v_cutoff);
end;$$;
revoke all on function public.prepare_team_workweek_effect_cleanup(uuid,integer) from public,anon,authenticated;
grant execute on function public.prepare_team_workweek_effect_cleanup(uuid,integer) to service_role;

create or replace function public.confirm_team_workweek_planned_cleanup(p_effect_id uuid,p_generation integer,p_etag text,p_preserved boolean)
returns void language plpgsql security definer set search_path=public as $$
declare v_effect public.team_workweek_publication_effects%rowtype;v_pub public.team_workweek_publications%rowtype;
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='service role required';end if;
  select * into v_effect from public.team_workweek_publication_effects where id=p_effect_id;
  if not found then raise exception using errcode='P0002',message='effect not found';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_effect.owner_profile_id,0));
  select * into v_pub from public.team_workweek_publications where id=v_effect.publication_id for update;
  if v_pub.status<>'preparing' or v_pub.attempt_generation<>p_generation or v_effect.generation<>p_generation or v_effect.cleanup_at is null or nullif(trim(p_etag),'') is null
    or (p_preserved and v_effect.cleanup_disposition not in('preserve','retain')) then raise exception using errcode='P0003',message='cleanup observation is stale';end if;
  if v_effect.state='cleaned' then
    if v_effect.cleanup_confirmed_etag<>p_etag or v_effect.cleanup_preserved<>p_preserved then raise exception using errcode='P0004',message='cleanup evidence changed';end if;
    return;
  end if;
  update public.team_workweek_publication_effects set state='cleaned',cleanup_preserved=p_preserved,cleanup_confirmed_etag=p_etag,observed_at=clock_timestamp() where id=p_effect_id;
  if p_preserved and v_pub.predecessor_publication_id is not null then
    insert into public.team_workweek_google_reconciliation_status(publication_id,owner_profile_id,state,last_error_class,updated_at)
      values(v_pub.predecessor_publication_id,v_pub.owner_profile_id,'delayed','provider_unavailable',clock_timestamp())
      on conflict(publication_id) do update set state='delayed',last_error_class='provider_unavailable',updated_at=clock_timestamp();
  end if;
  if v_effect.series_id is not null and v_effect.operation<>'create' then
    update public.team_workweek_google_series set observed_payload=v_effect.cleanup_payload,confirmed_etag=p_etag,last_observed_at=clock_timestamp() where id=v_effect.series_id;
  end if;
end;$$;
revoke all on function public.confirm_team_workweek_planned_cleanup(uuid,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.confirm_team_workweek_planned_cleanup(uuid,integer,text,boolean) to service_role;

create or replace function public.bind_team_workweek_crossing_instance(p_effect_id uuid,p_generation integer,p_event_id text,p_etag text,p_original_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_effect public.team_workweek_publication_effects%rowtype; v_publication public.team_workweek_publications%rowtype; v_payload jsonb;
begin
  select * into v_effect from public.team_workweek_publication_effects where id=p_effect_id;
  if not found then raise exception using errcode='P0002',message='effect not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_effect.owner_profile_id,0));
  select * into v_publication from public.team_workweek_publications where id=v_effect.publication_id for update;
  if v_publication.status<>'preparing' or v_publication.attempt_generation<>p_generation or v_effect.generation<>p_generation
    or v_effect.kind not in('crossing_instance','cleanup_crossing') or v_effect.state<>'pending'
    or (v_effect.kind='crossing_instance' and clock_timestamp()>=v_publication.effective_at)
    or (v_effect.kind='cleanup_crossing' and v_effect.cleanup_at is null) then
    raise exception using errcode='P0003',message='stale or expired instance binding';
  end if;
  if nullif(trim(p_etag),'') is null or p_event_id !~ '^[A-Za-z0-9_]{5,255}$'
    or p_original_payload->>'id' is distinct from p_event_id
    or ((p_original_payload#>>'{start,dateTime}')::timestamptz at time zone 'Europe/Berlin') is distinct from (v_effect.original_start at time zone 'Europe/Berlin')
    or (p_original_payload#>>'{end,dateTime}')::timestamptz<=(p_original_payload#>>'{start,dateTime}')::timestamptz
    or p_original_payload#>'{extendedProperties,private}' is null then
    raise exception using errcode='22023',message='invalid instance observation';
  end if;
  if v_effect.expected_etag is not null then
    if v_effect.google_event_id<>p_event_id or v_effect.expected_payload<>p_original_payload then
      raise exception using errcode='P0004',message='instance binding changed';
    end if;
  else
    v_payload:=jsonb_set(p_original_payload,'{end,dateTime}',to_jsonb(case when v_effect.kind='cleanup_crossing' then v_effect.cleanup_at else v_publication.effective_at end));
    v_payload:=jsonb_set(v_payload,'{extendedProperties,private}',(p_original_payload#>'{extendedProperties,private}')||jsonb_build_object('founderopsWorkweekTransitionId',v_effect.id::text));
    update public.team_workweek_publication_effects set google_event_id=p_event_id,expected_etag=p_etag,expected_payload=p_original_payload,payload=v_payload,cleanup_payload=case when kind='cleanup_crossing' then v_payload else cleanup_payload end where id=p_effect_id returning * into v_effect;
  end if;
  return jsonb_build_object('id',v_effect.id,'calendarId','primary','googleEventId',v_effect.google_event_id,'generation',v_effect.generation,
    'payload',v_effect.payload,'state',v_effect.state,'confirmedEtag',v_effect.confirmed_etag,'kind',v_effect.kind,'operation',v_effect.operation,
    'expectedPayload',v_effect.expected_payload,'expectedEtag',v_effect.expected_etag,'instanceOf',v_effect.instance_of,'originalStart',v_effect.original_start,'cleanupAt',v_effect.cleanup_at,'cleanupDisposition',v_effect.cleanup_disposition,'cleanupPayload',v_effect.cleanup_payload,'cleanupParentId',v_effect.cleanup_parent_id);
end; $$;
revoke all on function public.bind_team_workweek_crossing_instance(uuid,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.bind_team_workweek_crossing_instance(uuid,integer,text,text,jsonb) to service_role;


create or replace function public.prepare_team_workweek_publication(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner text;
  v_version public.team_workweek_versions%rowtype;
  v_publication public.team_workweek_publications%rowtype;
  v_generation integer;
  v_effects jsonb;
  v_predecessor public.team_workweek_publications%rowtype;
  v_successor public.team_workweek_publications%rowtype;
  v_snapshot jsonb;
begin
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id = auth.uid();
  if v_owner is null then raise exception using errcode='42501',message='mapped team profile required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner,0));
  select * into v_version from public.team_workweek_versions where id=p_version_id and owner_profile_id=v_owner for update;
  if not found then raise exception using errcode='P0002',message='private team workweek version not found'; end if;
  if v_version.retired_at is not null then raise exception using errcode='P0004',message='private version has retired; use its explicit restarted version';end if;
  if v_version.base_publication_id is not null and not exists(select 1 from public.team_workweek_publications
    where id=v_version.base_publication_id and owner_profile_id=v_owner and status='published' and ((v_version.activation_mode='future_monday' and effective_to is null) or (v_version.activation_mode='immediate' and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp() and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp()))
      and publication_revision=v_version.base_publication_revision) and not exists(select 1 from public.team_workweek_publications where source_version_id=v_version.id) then
    raise exception using errcode='P0004',message='published workweek revision is stale';
  end if;
  if exists(select 1 from public.team_workweek_publications where source_version_id=p_version_id and owner_profile_id=v_owner and attempt_generation=0) then
    return public.prepare_monday_team_workweek_publication(p_version_id);
  end if;
  select * into v_predecessor from public.team_workweek_publications where owner_profile_id=v_owner and status='published' and ((v_version.activation_mode='immediate' and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp() and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp()) or (v_version.activation_mode='future_monday' and effective_to is null))
    order by publication_revision desc limit 1 for update;
  select * into v_publication from public.team_workweek_publications where source_version_id=p_version_id and owner_profile_id=v_owner for update;
  if found and v_publication.status='published' then
    -- Lost finalize response: replay the committed generation even after its deadline.
    null;
  elsif v_publication.id is not null and v_publication.effective_at<=clock_timestamp() and exists(
    select 1 from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation and state<>'cleaned'
  ) then
    -- Expired immutable effects remain available for guarded compensation, even if the future plan changed.
    null;
  else
    if v_version.activation_mode='immediate' then
      if v_predecessor.id is distinct from v_version.base_publication_id
        or v_predecessor.publication_revision is distinct from v_version.base_publication_revision then
        raise exception using errcode='P0004',message='published workweek revision is stale';
      end if;
      v_snapshot:=public.team_workweek_successor_snapshot(v_owner);
      if v_version.successor_snapshot is not null and v_version.successor_snapshot<>v_snapshot then
        raise exception using errcode='P0004',message='prepared successor revision is stale';
      end if;
      select * into v_successor from public.team_workweek_publications where id=(v_snapshot->0->>'id')::uuid;

    end if;
    if v_publication.id is null then
      if v_version.activation_mode='future_monday' and v_version.effective_from::timestamp at time zone 'Europe/Berlin'<=clock_timestamp() then
        raise exception using errcode='22023',message='future Monday is no longer eligible';
      end if;
      if exists (select 1 from public.team_workweek_publications where owner_profile_id=v_owner and status='preparing') then
        raise exception using errcode='P0003',message='another team workweek publication is still preparing';
      end if;
      if v_successor.id is not null and date_trunc('minute',clock_timestamp())+interval '3 minutes'>=coalesce(v_successor.effective_at,v_successor.effective_from::timestamp at time zone 'Europe/Berlin') then
        raise exception using errcode='P0004',message='prepared successor starts before activation candidate';
      end if;
      insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,publication_revision,activation_mode,effective_at,attempt_generation,predecessor_publication_id,expected_predecessor_revision,successor_snapshot,successor_publication_id,effective_until,effective_to,superseded_by_publication_id)
      select v_version.id,v_owner,v_version.effective_from,
        coalesce(jsonb_agg(jsonb_build_object('weekday',weekday,'startMinute',start_minute,'endMinute',end_minute) order by weekday,start_minute),'[]'),
        (select coalesce(max(publication_revision),0)+1 from public.team_workweek_publications where owner_profile_id=v_owner),
        v_version.activation_mode,case when v_version.activation_mode='immediate' then date_trunc('minute',clock_timestamp())+interval '3 minutes' else v_version.effective_from::timestamp at time zone 'Europe/Berlin' end,1,v_predecessor.id,v_predecessor.publication_revision,v_snapshot,v_successor.id,
        coalesce(v_successor.effective_at,v_successor.effective_from::timestamp at time zone 'Europe/Berlin'),
        case when v_successor.id is not null then (coalesce(v_successor.effective_at,v_successor.effective_from::timestamp at time zone 'Europe/Berlin') at time zone 'Europe/Berlin')::date-1 end,v_successor.id
      from public.team_workweek_windows where version_id=v_version.id returning * into v_publication;
    elsif v_publication.effective_at <= clock_timestamp() and not exists (
      select 1 from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation and state <> 'cleaned'
    ) then
      if v_publication.effective_until is not null and date_trunc('minute',clock_timestamp())+interval '3 minutes'>=v_publication.effective_until then
        raise exception using errcode='P0004',message='prepared successor starts before activation candidate';
      end if;
      update public.team_workweek_publications set effective_at=case when activation_mode='immediate' then date_trunc('minute',clock_timestamp())+interval '3 minutes' else (date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7)::timestamp at time zone 'Europe/Berlin' end,
        effective_from=case when activation_mode='future_monday' then date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7 else effective_from end,
        attempt_generation=attempt_generation+1,sync_state='pending',planned_effect_count=null,projection_omissions='[]'
      where id=v_publication.id returning * into v_publication;
    end if;
    v_generation:=v_publication.attempt_generation;
    if not exists (select 1 from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_generation)
      and v_publication.effective_at > clock_timestamp() then
      perform public.plan_team_workweek_civil_effects(v_publication.id);
    end if;
  end if;
  if v_publication.status='preparing' and v_publication.predecessor_publication_id is not null and v_publication.effective_at>clock_timestamp() then
    perform public.plan_team_workweek_predecessor_effects(v_publication.id);
  end if;
  if v_publication.status='preparing' then
    update public.team_workweek_publications set planned_effect_count=(select count(*) from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation) where id=v_publication.id and planned_effect_count is null;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'calendarId','primary','googleEventId',google_event_id,'generation',generation,'payload',payload,'state',state,'confirmedEtag',confirmed_etag,'kind',kind,'operation',operation,'expectedPayload',expected_payload,'expectedEtag',expected_etag,'instanceOf',instance_of,'originalStart',original_start) order by case when operation='create' then 0 when kind='crossing_instance' then 1 else 2 end,id),'[]')
    into v_effects from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation;
  return jsonb_build_object('id',v_publication.id,'sourceVersionId',v_version.id,'ownerProfileId',v_owner,'effectiveFrom',v_publication.effective_from,
    'effectiveUntil',v_publication.effective_until,'successorPublicationId',v_publication.successor_publication_id,'activationMode',v_publication.activation_mode,'predecessorPublicationId',v_publication.predecessor_publication_id,'effectiveAt',v_publication.effective_at,'attemptGeneration',v_publication.attempt_generation,
    'timezone','Europe/Berlin','status',v_publication.status,'syncState',v_publication.sync_state,'publicationRevision',v_publication.publication_revision,
    'publishedAt',v_publication.published_at,'lastSyncAt',v_publication.last_sync_at,'series','[]'::jsonb,'transitions','[]'::jsonb,'effects',v_effects);
end; $$;


alter table public.team_workweek_publications drop constraint team_workweek_publications_deactivation_reason;
alter table public.team_workweek_publications add constraint team_workweek_publications_deactivation_reason check(deactivation_reason is null or deactivation_reason in('manual_disconnect','external_revocation','private_restart'));
create or replace function public.restart_private_team_workweek_version(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_owner text;v_version public.team_workweek_versions%rowtype;v_pub public.team_workweek_publications%rowtype;v_base public.team_workweek_publications%rowtype;v_windows jsonb;v_id uuid;v_date date;
begin
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id = auth.uid();
  if not found then raise exception using errcode='42501',message='mapped team profile required';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner,0));
  select * into v_version from public.team_workweek_versions where id=p_version_id and owner_profile_id=v_owner for update;
  if not found then raise exception using errcode='42501',message='private workweek is not owned by caller';end if;
  if v_version.restarted_version_id is not null then return jsonb_build_object('versionId',v_version.restarted_version_id,'replayed',true);end if;
  if v_version.retired_at is not null then raise exception using errcode='P0004',message='private version has retired';end if;
  select * into v_pub from public.team_workweek_publications where source_version_id=p_version_id
    or source_version_id=(select resolution_version_id from public.team_workweek_google_conflicts where founderops_version_id=p_version_id and owner_profile_id=v_owner and state='resolving' order by updated_at desc limit 1);
  if found then
    if v_pub.status<>'preparing' or v_pub.attempt_generation=0 or v_pub.effective_at>clock_timestamp()
      or exists(select 1 from public.team_workweek_publication_effects where publication_id=v_pub.id and generation=v_pub.attempt_generation and state<>'cleaned') then
      raise exception using errcode='P0003',message='publication must be safely compensated before restart';end if;
    update public.team_workweek_publications set status='inactive',deactivated_at=clock_timestamp(),deactivation_reason='private_restart' where id=v_pub.id;
  end if;
  select * into v_base from public.team_workweek_publications where owner_profile_id=v_owner and status='published'
    and (v_version.activation_mode='future_monday' or (coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp() and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp()))
    order by effective_from desc,publication_revision desc limit 1;
  v_date:=case when v_version.activation_mode='future_monday' then greatest(v_version.effective_from,date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7,coalesce(v_base.effective_from+7,v_version.effective_from)) else date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date end;
  select coalesce(jsonb_agg(jsonb_build_object('weekday',weekday,'startMinute',start_minute,'endMinute',end_minute) order by weekday,start_minute,end_minute,id),'[]') into v_windows from public.team_workweek_windows where version_id=p_version_id;
  v_id:=public.insert_temporal_google_workweek_version(v_owner,v_base.id,v_base.publication_revision,v_windows,'owner',null,v_version.activation_mode,v_date);
  update public.team_workweek_versions set retired_at=clock_timestamp(),restarted_version_id=v_id where id=p_version_id or (id=v_pub.source_version_id and v_pub.source_version_id is distinct from p_version_id);
  update public.team_workweek_versions set retired_at=clock_timestamp() where id in(select founderops_version_id from public.team_workweek_google_conflicts where resolution_version_id=p_version_id and owner_profile_id=v_owner);
  update public.team_workweek_google_conflicts set state='cancelled',decision=null,resolution_version_id=null,resolved_at=clock_timestamp(),updated_at=clock_timestamp()
    where owner_profile_id=v_owner and state in('open','resolving') and (resolution_version_id=p_version_id or founderops_version_id=p_version_id);
  return jsonb_build_object('versionId',v_id,'replayed',false);
end;$$;
revoke all on function public.restart_private_team_workweek_version(uuid) from public,anon,service_role;
grant execute on function public.restart_private_team_workweek_version(uuid) to authenticated;


-- Timestamped/cohort disconnect targets retain their exact prior physical payload.
-- Legacy already-prepared operations keep their original COUNT path for replay.
alter table public.google_workspace_disconnect_series alter column series_id drop not null;
alter table public.google_workspace_disconnect_series add column effect_plan jsonb;
alter table public.google_workspace_disconnect_series drop constraint google_workspace_disconnect_series_identity;
alter table public.google_workspace_disconnect_series add constraint google_workspace_disconnect_series_identity check(char_length(google_event_id) between 5 and 1024 and google_event_id ~ '^[A-Za-z0-9_]+$');

create or replace function public.plan_google_workspace_disconnect_targets(p_operation_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_op public.google_workspace_disconnect_operations%rowtype;v_source record;v_before jsonb;v_payload jsonb;v_boundary jsonb;v_id uuid;v_cutoff timestamptz;v_count integer;v_plan jsonb;
begin
  select * into v_op from public.google_workspace_disconnect_operations where id=p_operation_id;
  v_cutoff:=v_op.cutoff_date::timestamp at time zone 'Europe/Berlin';
  for v_source in select series.*,pub.effective_from,pub.publication_revision,work_window.weekday,work_window.start_minute,work_window.end_minute
    from public.team_workweek_google_series series join public.team_workweek_publications pub on pub.id=series.publication_id
    join public.team_workweek_windows work_window on work_window.id=series.source_window_id
    where series.owner_profile_id=v_op.owner_profile_id and series.state='confirmed' and series.provider_state='active'
      and not exists(select 1 from public.google_workspace_disconnect_series target where target.operation_id=p_operation_id and target.series_id=series.id)
      and (pub.status='published' or (pub.status='inactive' and pub.deactivation_reason='external_revocation')) order by series.id loop
    select payload into v_before from public.team_workweek_publication_effects where series_id=v_source.id and state='confirmed' and kind in('weekly','predecessor_cutoff') order by observed_at desc nulls last,id desc limit 1;
    v_before:=coalesce(v_source.observed_payload,v_before);
    if v_before is null then
      select recurrence_count into v_count from public.team_workweek_google_series_transitions where predecessor_series_id=v_source.id and state='confirmed' order by last_confirmed_at desc,id desc limit 1;
      v_before:=jsonb_build_object('id',v_source.google_event_id,'summary','Arbeitszeit','description','Mit FounderOps synchronisiert','transparency','transparent','visibility','private','reminders',jsonb_build_object('useDefault',false),
        'start',jsonb_build_object('dateTime',public.team_workweek_berlin_civil_instant((v_source.effective_from+v_source.weekday-1)::timestamp+make_interval(mins=>v_source.start_minute)),'timeZone','Europe/Berlin'),
        'end',jsonb_build_object('dateTime',public.team_workweek_berlin_civil_instant((v_source.effective_from+v_source.weekday-1)::timestamp+make_interval(mins=>v_source.end_minute)),'timeZone','Europe/Berlin'),
        'recurrence',jsonb_build_array('RRULE:FREQ=WEEKLY'||case when v_count is null then '' else ';COUNT='||v_count end),
        'extendedProperties',jsonb_build_object('private',jsonb_build_object('founderopsWorkweekSeriesId',v_source.id,'founderopsWorkweekRevision',v_source.confirmed_founderops_revision::text)));
    end if;
    v_boundary:=public.team_workweek_payload_before(v_before,v_cutoff);v_id:=gen_random_uuid();
    v_payload:=coalesce(v_boundary->'payload',v_before);
    v_plan:=jsonb_build_object('id',v_id,'calendarId','primary','googleEventId',v_source.google_event_id,'generation',v_op.revision,'payload',v_before,'state','pending','confirmedEtag',null,'cleanupAt',v_cutoff,
      'cleanupDisposition',case when (v_boundary->>'elapsed')::boolean then 'preserve' else 'delete' end,'cleanupPayload',case when (v_boundary->>'elapsed')::boolean then v_payload end,'cleanupDeadline',v_cutoff);
    insert into public.google_workspace_disconnect_series(id,operation_id,series_id,google_event_id,expected_etag,expected_founderops_revision,cleanup_action,recurrence_count,effect_plan)
      values(v_id,v_op.id,v_source.id,v_source.google_event_id,v_source.confirmed_etag,v_source.confirmed_founderops_revision,case when (v_boundary->>'elapsed')::boolean then 'truncate' else 'delete' end,case when (v_boundary->>'elapsed')::boolean then 1 end,v_plan);
  end loop;
  for v_source in select distinct on(effect.google_event_id) effect.* from public.team_workweek_publication_effects effect join public.team_workweek_publications pub on pub.id=effect.publication_id
    where effect.owner_profile_id=v_op.owner_profile_id and effect.kind='activation_remainder' and effect.operation='create' and effect.state='confirmed'
      and not exists(select 1 from public.google_workspace_disconnect_series target where target.operation_id=p_operation_id and target.google_event_id=effect.google_event_id)
      and (pub.status='published' or (pub.status='inactive' and pub.deactivation_reason='external_revocation')) order by effect.google_event_id,effect.observed_at desc nulls last,effect.id desc loop
    select coalesce(cleanup_payload,payload) into v_before from public.team_workweek_publication_effects where google_event_id=v_source.google_event_id and ((state='confirmed' and kind in('activation_remainder','predecessor_remainder')) or (state='cleaned' and cleanup_preserved)) order by observed_at desc nulls last,id desc limit 1;
    v_boundary:=public.team_workweek_payload_before(v_before,v_cutoff);v_id:=gen_random_uuid();
    insert into public.google_workspace_disconnect_series(id,operation_id,google_event_id,expected_etag,expected_founderops_revision,cleanup_action,recurrence_count,effect_plan)
      values(v_id,v_op.id,v_source.google_event_id,v_source.confirmed_etag,1,case when (v_boundary->>'elapsed')::boolean then 'truncate' else 'delete' end,case when (v_boundary->>'elapsed')::boolean then 1 end,
        jsonb_build_object('id',v_id,'calendarId','primary','googleEventId',v_source.google_event_id,'generation',v_op.revision,'payload',v_before,'state','pending','confirmedEtag',null,'cleanupAt',v_cutoff,'cleanupDisposition',case when (v_boundary->>'elapsed')::boolean then 'preserve' else 'delete' end,'cleanupPayload',v_boundary->'payload','cleanupDeadline',v_cutoff));
  end loop;
  update public.team_workweek_google_series series set future_cleanup_state='pending',future_cleanup_confirmed_at=null where exists(select 1 from public.google_workspace_disconnect_series target where target.operation_id=p_operation_id and target.series_id=series.id);
end;$$;
revoke all on function public.plan_google_workspace_disconnect_targets(uuid) from public,anon,authenticated,service_role;

create or replace function public.prepare_google_workspace_disconnect(p_owner_profile_id text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_operation public.google_workspace_disconnect_operations%rowtype;
  v_today date := (clock_timestamp() at time zone 'Europe/Berlin')::date;
  v_cutoff date;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if nullif(btrim(p_owner_profile_id), '') is null or not exists (
    select 1 from public.profiles as profile where profile.id = p_owner_profile_id
  ) then
    raise exception using errcode = '42501', message = 'mapped team profile required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id, 0));
  select * into v_operation from public.google_workspace_disconnect_operations
  where owner_profile_id = p_owner_profile_id and state <> 'completed'
  for update;
  if found then
    if v_operation.state in('cleaning','cleanup_pending') and not exists(select 1 from public.google_workspace_disconnect_series where operation_id=v_operation.id)
      and not exists(select 1 from public.team_workweek_publications where owner_profile_id=p_owner_profile_id and status='preparing') then
      perform public.plan_google_workspace_disconnect_targets(v_operation.id);
    end if;
    return jsonb_build_object('id', v_operation.id, 'state', v_operation.state, 'replayed', true);
  end if;
  if not exists (
    select 1 from public.google_workspace_connections
    where profile_id = p_owner_profile_id
  ) and not exists (
    select 1 from public.team_workweek_publications
    where owner_profile_id = p_owner_profile_id and status = 'published'
  ) then
    select * into v_operation from public.google_workspace_disconnect_operations
    where owner_profile_id = p_owner_profile_id and state = 'completed'
    order by completed_at desc, id desc limit 1;
    return jsonb_build_object('id', v_operation.id, 'state', 'completed', 'replayed', true);
  end if;
  if exists (
    select 1 from public.team_workweek_publications
    where owner_profile_id = p_owner_profile_id and status = 'preparing'
  ) or exists (
    select 1 from public.team_workweek_google_conflicts
    where owner_profile_id = p_owner_profile_id and state in ('open', 'resolving')
  ) then
    raise exception using errcode = 'P0003', message = 'team workweek transition is still preparing';
  end if;

  v_cutoff := v_today + case
    when extract(isodow from v_today)::integer = 1 then 7
    else 8 - extract(isodow from v_today)::integer
  end;
  insert into public.google_workspace_disconnect_operations (
    owner_profile_id, requested_by, revoke_connection, cutoff_date, state
  ) values (p_owner_profile_id, 'owner', true, v_cutoff, 'cleaning')
  returning * into v_operation;

  perform public.plan_google_workspace_disconnect_targets(v_operation.id);

  return jsonb_build_object(
    'id', v_operation.id,
    'state', v_operation.state,
    'pendingSeries', (select count(*) from public.google_workspace_disconnect_series where operation_id = v_operation.id),
    'replayed', false
  );
end;
$$;

alter function public.prepare_google_workspace_disconnect(text) owner to postgres;
revoke all on function public.prepare_google_workspace_disconnect(text) from public, anon, authenticated;
grant execute on function public.prepare_google_workspace_disconnect(text) to service_role;

create or replace function public.retain_private_team_workweek_after_deactivation(p_owner_profile_id text,p_cutoff date)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;v_pub public.team_workweek_publications%rowtype;
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='service role required';end if;
  select version.id into v_id from public.team_workweek_versions version where version.owner_profile_id=p_owner_profile_id and version.origin='owner' and version.retired_at is null
    and not exists(select 1 from public.team_workweek_publications pub where pub.source_version_id=version.id and pub.deactivation_reason is distinct from 'private_restart') order by version.created_at desc,version.id desc limit 1;
  if found then return v_id;end if;
  select * into v_pub from public.team_workweek_publications where owner_profile_id=p_owner_profile_id and status='inactive'
    and deactivation_reason<>'private_restart' order by case when coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=deactivated_at and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>deactivated_at then 0 else 1 end,effective_from desc,publication_revision desc limit 1;
  if not found then return null;end if;
  return public.insert_temporal_google_workweek_version(p_owner_profile_id,null,null,v_pub.windows,'owner',null,'immediate',null);
end;$$;
revoke all on function public.retain_private_team_workweek_after_deactivation(text,date) from public,anon,authenticated;
grant execute on function public.retain_private_team_workweek_after_deactivation(text,date) to service_role;

create or replace function public.retire_compensated_workweek_for_disconnect(p_owner_profile_id text,p_publication_id uuid,p_generation integer)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='service role required';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id,0));
  if not exists(select 1 from public.team_workweek_publications where id=p_publication_id and owner_profile_id=p_owner_profile_id and status='preparing' and attempt_generation=p_generation and effective_at<=clock_timestamp())
    or exists(select 1 from public.team_workweek_publication_effects where publication_id=p_publication_id and generation=p_generation and state<>'cleaned') then raise exception using errcode='P0003',message='abandoned generation is not fully compensated';end if;
  update public.team_workweek_publications set status='inactive',deactivation_reason='private_restart',deactivated_at=clock_timestamp() where id=p_publication_id;
  update public.team_workweek_google_conflicts set state='cancelled',decision=null,resolution_version_id=null,resolved_at=clock_timestamp() where owner_profile_id=p_owner_profile_id and state in('open','resolving');
end;$$;
revoke all on function public.retire_compensated_workweek_for_disconnect(text,uuid,integer) from public,anon,authenticated;
grant execute on function public.retire_compensated_workweek_for_disconnect(text,uuid,integer) to service_role;

CREATE OR REPLACE FUNCTION "public"."deactivate_team_workweek_for_external_revocation"("p_owner_profile_id" "text", "p_excluded_publication_id" "uuid" DEFAULT NULL::"uuid", "p_observed_at" timestamp with time zone DEFAULT "clock_timestamp"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_operation public.google_workspace_disconnect_operations%rowtype;
  v_today date := (p_observed_at at time zone 'Europe/Berlin')::date;
  v_cutoff date;
  v_retained_version_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id, 0));
  v_cutoff := v_today + case
    when extract(isodow from v_today)::integer = 1 then 7
    else 8 - extract(isodow from v_today)::integer
  end;
  select * into v_operation from public.google_workspace_disconnect_operations
  where owner_profile_id = p_owner_profile_id and state <> 'completed' for update;
  if not found then
    insert into public.google_workspace_disconnect_operations (
      owner_profile_id, requested_by, revoke_connection, cutoff_date, state, last_error_class
    ) values (p_owner_profile_id, 'external_revocation', false, v_cutoff, 'cleanup_pending', 'oauth_reconnect_required')
    returning * into v_operation;
  else
    update public.google_workspace_disconnect_operations
    set requested_by = 'external_revocation', revoke_connection = false,
      state = 'cleanup_pending', last_error_class = 'oauth_reconnect_required', updated_at = p_observed_at
    where id = v_operation.id returning * into v_operation;
  end if;

  if not exists(select 1 from public.team_workweek_publications where owner_profile_id=p_owner_profile_id and status='preparing' and attempt_generation>0) then
    perform public.plan_google_workspace_disconnect_targets(v_operation.id);
  end if;

  update public.team_workweek_publications
  set status = 'inactive', deactivated_at = p_observed_at, deactivation_reason = 'external_revocation'
  where owner_profile_id = p_owner_profile_id
    and (status='published' or (status='preparing' and attempt_generation=0))
    and (p_excluded_publication_id is null or id <> p_excluded_publication_id);

  update public.team_workweek_google_conflicts
  set state = 'cancelled', decision = null, resolution_version_id = null,
    resolved_at = p_observed_at, updated_at = p_observed_at
  where owner_profile_id = p_owner_profile_id and state in ('open', 'resolving');



  update public.team_workweek_google_series as series
  set future_cleanup_state = 'pending', future_cleanup_confirmed_at = null, updated_at = p_observed_at
  where exists (
    select 1 from public.google_workspace_disconnect_series as target
    where target.operation_id = v_operation.id and target.series_id = series.id and target.state = 'pending'
  );

  v_retained_version_id := public.retain_private_team_workweek_after_deactivation(p_owner_profile_id, v_operation.cutoff_date);
  update public.google_workspace_disconnect_operations
  set retained_version_id = v_retained_version_id, deactivated_at = p_observed_at, updated_at = p_observed_at
  where id = v_operation.id returning * into v_operation;

  return jsonb_build_object(
    'id', v_operation.id,
    'state', v_operation.state,
    'retainedVersionId', v_retained_version_id,
    'pendingSeries', (select count(*) from public.google_workspace_disconnect_series where operation_id = v_operation.id and state = 'pending')
  );
end;
$$;


