-- Observe and resolve the selected future predecessor before publication effects exist.
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
      and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp()
      and (coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp()
        or exists(select 1 from public.team_workweek_versions draft
          where draft.id=p_founderops_version_id and draft.owner_profile_id=p_owner_profile_id
            and draft.selected_week_start>date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date
            and draft.base_publication_id=p_base_publication_id
            and draft.base_publication_revision=p_base_publication_revision
            and (public.team_workweek_selected_binding(p_owner_profile_id,draft.selected_week_start)->>'basePublicationId')::uuid=p_base_publication_id))
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
      and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp()
      and (coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp()
        or exists(select 1 from public.team_workweek_versions draft
          where draft.id=v_conflict.founderops_version_id and draft.owner_profile_id=p_owner_profile_id
            and draft.selected_week_start>date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date
            and draft.base_publication_id=v_conflict.base_publication_id
            and draft.base_publication_revision=v_conflict.base_publication_revision
            and (public.team_workweek_selected_binding(p_owner_profile_id,draft.selected_week_start)->>'basePublicationId')::uuid=v_conflict.base_publication_id))
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
    or (v_founderops_version.successor_snapshot is not null and v_founderops_version.successor_snapshot<>case when v_founderops_version.selected_week_start is not null and v_founderops_version.activation_mode='future_monday' then public.team_workweek_selected_snapshot(p_owner_profile_id,v_founderops_version.base_publication_id) else public.team_workweek_successor_snapshot(p_owner_profile_id) end) then
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

  if v_founderops_version.selected_week_start is not null and v_founderops_version.activation_mode='future_monday' then
    v_version_id:=public.insert_temporal_google_workweek_version(p_owner_profile_id,v_conflict.base_publication_id,v_conflict.base_publication_revision,v_windows,'google_reconciliation',p_resolution_fingerprint,'future_monday',v_founderops_version.selected_week_start,v_conflict.base_publication_id);
  else
  v_version_id:=public.insert_temporal_google_workweek_version(p_owner_profile_id,case when p_decision='founderops' and v_founderops_version.activation_mode='future_monday' then null else v_conflict.base_publication_id end,case when p_decision='founderops' and v_founderops_version.activation_mode='future_monday' then null else v_conflict.base_publication_revision end,v_windows,'google_reconciliation',p_resolution_fingerprint,case when p_decision='founderops' then v_founderops_version.activation_mode else 'immediate' end,case when p_decision='founderops' then v_founderops_version.effective_from end,v_conflict.base_publication_id);
  end if;

  update public.team_workweek_google_conflicts
  set state = 'resolving',
    decision = p_decision,
    resolution_version_id = v_version_id,
    updated_at = p_observed_at
  where id = v_conflict.id;

  return jsonb_build_object('versionId', v_version_id, 'state', 'resolving', 'replayed', false);
end;
$_$;

create or replace function public.insert_temporal_google_workweek_version(p_owner text,p_base uuid,p_revision integer,p_windows jsonb,p_origin text,p_fingerprint text,p_mode text default 'immediate',p_effective_from date default null,p_reconciliation_source uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_window jsonb; v_day integer; v_start integer; v_end integer;
begin
  if p_origin not in('owner','google_reconciliation') or p_mode not in('immediate','future_monday') or (p_mode='future_monday' and (p_effective_from is null or extract(isodow from p_effective_from)<>1)) or not exists(select 1 from public.profiles where id=p_owner)
    or p_windows is null or jsonb_typeof(p_windows)<>'array' or jsonb_array_length(p_windows)>84 then
    raise exception using errcode='22023',message='temporal workweek draft is invalid';
  end if;
  insert into public.team_workweek_versions(owner_profile_id,effective_from,activation_mode,base_publication_id,base_publication_revision,origin,google_reconciliation_source_publication_id,google_reconciliation_fingerprint,selected_week_start)
    values(p_owner,case when p_mode='future_monday' then p_effective_from else date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date end,p_mode,p_base,p_revision,p_origin,
      case when p_origin='google_reconciliation' then coalesce(p_reconciliation_source,p_base) end,case when p_origin='google_reconciliation' then p_fingerprint end,case when p_origin='google_reconciliation' and p_mode='future_monday' and p_base is not null then p_effective_from end) returning id into v_id;
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

-- Recover orphaned workers without treating time or 404 as write rejection.
create or replace function public.claim_team_workweek_provider_operation(p_publication_id uuid,p_generation integer,p_purpose text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_pub public.team_workweek_publications%rowtype; v_op public.team_workweek_provider_operations%rowtype;
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='service role required';end if;
  select * into v_pub from public.team_workweek_publications where id=p_publication_id;
  if not found then raise exception using errcode='P0002',message='publication not found';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_pub.owner_profile_id,0));
  select * into v_pub from public.team_workweek_publications where id=p_publication_id for update;
  if v_pub.status<>'preparing' or v_pub.attempt_generation<>p_generation or p_generation<1 or p_purpose not in ('publish','cleanup') then
    raise exception using errcode='P0003',message='publication generation is unavailable';end if;
  -- Aging only fences the old worker. Outstanding writes still require provider
  -- identity/CAS evidence before the operation can settle or cleanup can start.
  update public.team_workweek_provider_operations operation
    set state=case when exists(select 1 from public.team_workweek_provider_writes write where write.operation_id=operation.id and write.state<>'settled') then 'uncertain' else 'settled' end,
      settled_at=case when not exists(select 1 from public.team_workweek_provider_writes write where write.operation_id=operation.id and write.state<>'settled') then clock_timestamp() end
    where publication_id=p_publication_id and state='active' and created_at<clock_timestamp()-interval '30 seconds';
  select * into v_op from public.team_workweek_provider_operations where publication_id=p_publication_id and state<>'settled';
  if found then return jsonb_build_object('state',case when v_op.state='active' then 'in_progress' else 'uncertain' end,'id',v_op.id,'purpose',v_op.purpose,'abandon',v_pub.restart_requested_at is not null or v_pub.effective_at<=clock_timestamp());end if;
  if p_purpose='publish' and v_pub.restart_requested_at is not null then raise exception using errcode='P0003',message='publication restart requested';end if;
  if p_purpose='cleanup' and v_pub.write_journal_version=0 then return jsonb_build_object('state','legacy_untracked');end if;
  if p_purpose='cleanup' and v_pub.effective_at>clock_timestamp() and (v_pub.restart_requested_at is null or v_pub.write_journal_version=0) then
    raise exception using errcode='P0003',message='future publication has not been cancelled';end if;
  insert into public.team_workweek_provider_operations(publication_id,owner_profile_id,generation,purpose) values(p_publication_id,v_pub.owner_profile_id,p_generation,p_purpose) returning * into v_op;
  return jsonb_build_object('state','claimed','id',v_op.id);
end;$$;

create or replace function public.record_team_workweek_provider_write(p_operation_id uuid,p_effect_id uuid,p_state text)
returns void language plpgsql security definer set search_path=public as $$
declare v_op public.team_workweek_provider_operations%rowtype; v_pub public.team_workweek_publications%rowtype;
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='service role required';end if;
  select * into v_op from public.team_workweek_provider_operations where id=p_operation_id;
  if not found then raise exception using errcode='P0002',message='operation not found';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_op.owner_profile_id,0));
  select * into v_op from public.team_workweek_provider_operations where id=p_operation_id for update;
  select * into v_pub from public.team_workweek_publications where id=v_op.publication_id;
  if v_op.state='settled' or v_pub.status<>'preparing' or v_pub.attempt_generation<>v_op.generation
    or p_state not in ('dispatched','replaying','uncertain','settled') or not exists(select 1 from public.team_workweek_publication_effects where id=p_effect_id and publication_id=v_pub.id and generation=v_op.generation)
    or (p_state='replaying' and (v_op.state<>'uncertain' or not exists(select 1 from public.team_workweek_provider_writes where operation_id=v_op.id and effect_id=p_effect_id and state<>'settled')))
    or (p_state='dispatched' and (v_op.state<>'active' or (v_op.purpose='publish' and v_pub.restart_requested_at is not null))) then
    raise exception using errcode='P0003',message='provider write is stale or cancelled';end if;
  if p_state='dispatched' then
    insert into public.team_workweek_provider_writes(operation_id,effect_id,state) values(v_op.id,p_effect_id,p_state);
  elsif p_state<>'replaying' then
    update public.team_workweek_provider_writes set state=p_state,updated_at=clock_timestamp() where operation_id=v_op.id and effect_id=p_effect_id and state<>'settled';
  end if;
end;$$;

create or replace function public.request_team_workweek_publication_restart(p_publication_id uuid,p_owner_profile_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_pub public.team_workweek_publications%rowtype;v_op public.team_workweek_provider_operations%rowtype;
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='service role required';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id,0));
  select * into v_pub from public.team_workweek_publications where id=p_publication_id and owner_profile_id=p_owner_profile_id for update;
  if not found then raise exception using errcode='42501',message='publication is not owned by caller';end if;
  if v_pub.status<>'preparing' or v_pub.attempt_generation<1 then raise exception using errcode='P0003',message='committed publication cannot restart';end if;
  if v_pub.write_journal_version=0 then return jsonb_build_object('state','delayed','reason','legacy_untracked');end if;
  update public.team_workweek_publications set restart_requested_at=coalesce(restart_requested_at,clock_timestamp()) where id=v_pub.id;
  -- The cancellation fence makes a later before-dispatch claim fail. Claims with
  -- no outstanding dispatched writes can therefore settle without a lease timer.
  update public.team_workweek_provider_operations operation set state='settled',settled_at=clock_timestamp()
    where operation.publication_id=v_pub.id and operation.state='active'
      and not exists(select 1 from public.team_workweek_provider_writes write where write.operation_id=operation.id and write.state<>'settled');
  update public.team_workweek_provider_operations set state='uncertain' where publication_id=v_pub.id and state='active' and created_at<clock_timestamp()-interval '30 seconds';
  select * into v_op from public.team_workweek_provider_operations where publication_id=v_pub.id and state<>'settled';
  if found then return jsonb_build_object('state','delayed','reason',case when v_op.state='active' then 'in_progress' else 'uncertain' end);end if;
  return jsonb_build_object('state','ready','reason',null);
end;$$;

