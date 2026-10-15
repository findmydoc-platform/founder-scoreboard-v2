-- Selected weeks use the existing publication journal and owner boundary.
alter table public.team_workweek_versions add column if not exists selected_week_start date;

create function public.team_workweek_selected_binding(p_owner text,p_week_start date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_base public.team_workweek_publications%rowtype; v_next timestamptz; v_point timestamptz; v_snapshot jsonb;
begin
  if p_week_start is null or extract(isodow from p_week_start)<>1
    or p_week_start<date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date then
    raise exception using errcode='22023',message='select the current or a future week';
  end if;
  v_point:=case when p_week_start=date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date then clock_timestamp() else p_week_start::timestamp at time zone 'Europe/Berlin' end;
  select * into v_base from public.team_workweek_publications where owner_profile_id=p_owner and status='published'
    and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=v_point
    and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>v_point
    order by publication_revision desc limit 1;
  select min(coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')) into v_next
    from public.team_workweek_publications where owner_profile_id=p_owner and status='published'
    and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')>v_point
    and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin');
  v_snapshot:=public.team_workweek_successor_snapshot(p_owner);
  return jsonb_build_object('weekStart',p_week_start,'basePublicationId',v_base.id,'basePublicationRevision',v_base.publication_revision,
    'windows',coalesce(v_base.windows,'[]'::jsonb),'effectiveUntil',v_next,
    'contextToken',md5(jsonb_build_object('week',p_week_start,'base',to_jsonb(v_base),'successors',v_snapshot)::text));
end;$$;
revoke all on function public.team_workweek_selected_binding(text,date) from public,anon,authenticated,service_role;

create function public.team_workweek_edit_context(p_week_start date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_owner text;
begin
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id = auth.uid();
  if v_owner is null then raise exception using errcode='42501',message='mapped team profile required';end if;
  return public.team_workweek_selected_binding(v_owner,p_week_start);
end;$$;
revoke all on function public.team_workweek_edit_context(date) from public,anon,service_role;
grant execute on function public.team_workweek_edit_context(date) to authenticated;

-- The replaced plan's conditional provider writes legitimately rotate its ETags.
-- Preserve its topology and all other successors exactly; effects bind each old ETag.
create function public.team_workweek_selected_snapshot(p_owner text,p_replaced uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(case when item->>'id'=p_replaced::text then
    jsonb_set(item,'{series}',coalesce((select jsonb_agg(series-'etag' order by series->>'id') from jsonb_array_elements(item->'series') series),'[]'::jsonb))
    else item end order by item->>'start',item->>'id'),'[]'::jsonb)
  from jsonb_array_elements(public.team_workweek_successor_snapshot(p_owner)) item;
$$;
revoke all on function public.team_workweek_selected_snapshot(text,uuid) from public,anon,authenticated,service_role;

create or replace function public.enforce_team_workweek_version_boundary()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_latest date; v_base uuid; v_revision integer;
begin
  if new.selected_week_start is not null then
    if new.selected_week_start<>new.effective_from or extract(isodow from new.selected_week_start)<>1
      or new.selected_week_start<date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date then
      raise exception using errcode='22023',message='selected week is no longer eligible';
    end if;
    new.successor_snapshot:=case when new.activation_mode='future_monday' then public.team_workweek_selected_snapshot(new.owner_profile_id,new.base_publication_id) else public.team_workweek_successor_snapshot(new.owner_profile_id) end;
    return new;
  end if;
  if new.activation_mode='immediate' then
    if new.base_publication_id is not null and not exists(select 1 from public.team_workweek_publications
      where id=new.base_publication_id and owner_profile_id=new.owner_profile_id and status='published' and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp() and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp()
        and publication_revision=new.base_publication_revision) then
      raise exception using errcode='P0004',message='published workweek revision is stale';
    end if;
    new.successor_snapshot:=public.team_workweek_successor_snapshot(new.owner_profile_id);
    return new;
  end if;
  select effective_from,id,publication_revision into v_latest,v_base,v_revision from public.team_workweek_publications
    where owner_profile_id=new.owner_profile_id and status='published' order by effective_from desc,publication_revision desc limit 1;
  if new.base_publication_id is null then new.base_publication_id:=v_base; new.base_publication_revision:=v_revision; end if;
  if v_latest is not null and new.effective_from<=v_latest then
    raise exception using errcode='22023',message='new workweek version must start after the latest published boundary';
  end if;
  return new;
end; $$;
create or replace function public.create_private_selected_team_workweek_version(
  p_week_start date, p_windows jsonb, p_context_token text
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_owner_profile_id text;
  p_effective_from date := p_week_start;
  v_context jsonb;
  v_mode text;
  v_version_id uuid;
  v_window jsonb;
  v_weekday smallint;
  v_start_minute smallint;
  v_end_minute smallint;
begin
  select profile.id
  into v_owner_profile_id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid();

  if not found or v_owner_profile_id is null then
    raise exception using errcode = '42501', message = 'mapped team profile required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner_profile_id, 0));
  if exists (select 1 from public.team_workweek_publications where owner_profile_id = v_owner_profile_id and status = 'preparing') then
    raise exception using errcode = 'P0003', message = 'finish the pending publication before editing';
  end if;
  v_context:=public.team_workweek_selected_binding(v_owner_profile_id,p_week_start);
  if p_context_token is null or p_context_token is distinct from v_context->>'contextToken' then
    raise exception using errcode='P0004',message='selected week changed; reload before saving';
  end if;
  v_mode:=case when p_week_start=date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date then 'immediate' else 'future_monday' end;
  if p_windows is null or jsonb_typeof(p_windows) <> 'array' or jsonb_array_length(p_windows) > 84 then
    raise exception using errcode = '22023', message = 'workweek windows must be a bounded array';
  end if;

  insert into public.team_workweek_versions (owner_profile_id, effective_from, activation_mode,base_publication_id,base_publication_revision,selected_week_start)
  values (v_owner_profile_id, p_effective_from, v_mode,(v_context->>'basePublicationId')::uuid,(v_context->>'basePublicationRevision')::integer,p_week_start)
  returning id into v_version_id;

  for v_window in select value from jsonb_array_elements(p_windows)
  loop
    if jsonb_typeof(v_window) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(v_window) as key
        where key not in ('weekday', 'startMinute', 'endMinute')
      )
      or v_window->>'weekday' is null
      or v_window->>'startMinute' is null
      or v_window->>'endMinute' is null then
      raise exception using errcode = '22023', message = 'workweek window contains unsupported fields';
    end if;

    begin
      v_weekday := (v_window->>'weekday')::smallint;
      v_start_minute := (v_window->>'startMinute')::smallint;
      v_end_minute := (v_window->>'endMinute')::smallint;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'workweek window contains invalid values';
    end;

    if v_weekday not between 1 and 7
      or v_start_minute not between 0 and 1438
      or v_end_minute not between 1 and 1439
      or v_start_minute >= v_end_minute then
      raise exception using errcode = '22023', message = 'workweek window must stay inside one day and begin before it ends';
    end if;
    if (
      select count(*)
      from public.team_workweek_windows as existing
      where existing.version_id = v_version_id
        and existing.weekday = v_weekday
    ) >= 12 then
      raise exception using errcode = '22023', message = 'workweek day contains too many windows';
    end if;
    if exists (
      select 1
      from public.team_workweek_windows as existing
      where existing.version_id = v_version_id
        and existing.weekday = v_weekday
        and v_start_minute < existing.end_minute
        and v_end_minute > existing.start_minute
    ) then
      raise exception using errcode = '22023', message = 'workweek windows must not overlap';
    end if;

    insert into public.team_workweek_windows (version_id, weekday, start_minute, end_minute)
    values (v_version_id, v_weekday, v_start_minute, v_end_minute);
  end loop;

  return jsonb_build_object(
    'id', v_version_id,
    'effectiveFrom', p_effective_from,
    'activationMode', v_mode,
    'basePublicationId',v_context->'basePublicationId','basePublicationRevision',v_context->'basePublicationRevision','selectedWeekStart',p_week_start,
    'timezone', 'Europe/Berlin',
    'status', 'preparing',
    'createdAt', clock_timestamp()
  );
end;
$$;
revoke all on function public.create_private_selected_team_workweek_version(date,jsonb,text) from public,anon,service_role;
grant execute on function public.create_private_selected_team_workweek_version(date,jsonb,text) to authenticated;

alter function public.prepare_team_workweek_publication_before_recovery(uuid) rename to prepare_team_workweek_publication_before_week_selection;
alter function public.finalize_team_workweek_publication_before_recovery(uuid) rename to finalize_team_workweek_publication_before_week_selection;
create or replace function public.prepare_team_workweek_publication_before_recovery(p_version_id uuid)
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
  if v_version.selected_week_start<date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date
    and not exists(select 1 from public.team_workweek_publications where source_version_id=v_version.id and status='published') then
    raise exception using errcode='P0004',message='selected week has ended; explicitly select the current week';
  end if;
  if v_version.selected_week_start is null or v_version.activation_mode<>'future_monday' then
    return public.prepare_team_workweek_publication_before_week_selection(p_version_id);
  end if;
  if v_version.retired_at is not null then raise exception using errcode='P0004',message='private version has retired; use its explicit restarted version';end if;
  if v_version.base_publication_id is not null and not exists(select 1 from public.team_workweek_publications
    where id=v_version.base_publication_id and owner_profile_id=v_owner and status='published' and (coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=(v_version.effective_from::timestamp at time zone 'Europe/Berlin') and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>(v_version.effective_from::timestamp at time zone 'Europe/Berlin'))
      and publication_revision=v_version.base_publication_revision) and not exists(select 1 from public.team_workweek_publications where source_version_id=v_version.id) then
    raise exception using errcode='P0004',message='published workweek revision is stale';
  end if;
  if exists(select 1 from public.team_workweek_publications where source_version_id=p_version_id and owner_profile_id=v_owner and attempt_generation=0) then
    return public.prepare_monday_team_workweek_publication(p_version_id);
  end if;
  select * into v_predecessor from public.team_workweek_publications where owner_profile_id=v_owner and status='published' and (coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=(v_version.effective_from::timestamp at time zone 'Europe/Berlin') and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>(v_version.effective_from::timestamp at time zone 'Europe/Berlin'))
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
      if v_predecessor.id is distinct from v_version.base_publication_id
        or v_predecessor.publication_revision is distinct from v_version.base_publication_revision then
        raise exception using errcode='P0004',message='published workweek revision is stale';
      end if;
      v_snapshot:=public.team_workweek_selected_snapshot(v_owner,v_version.base_publication_id);
      if v_version.successor_snapshot is not null and v_version.successor_snapshot<>v_snapshot then
        raise exception using errcode='P0004',message='prepared successor revision is stale';
      end if;
      select * into v_successor from public.team_workweek_publications where owner_profile_id=v_owner and status='published' and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')>(v_version.effective_from::timestamp at time zone 'Europe/Berlin') and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin') order by coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin') limit 1;

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
      raise exception using errcode='P0004',message='selected week activation expired; explicitly restart and choose a week';
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
create or replace function public.finalize_team_workweek_publication_before_recovery(p_publication_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_owner text; v_publication public.team_workweek_publications%rowtype;
begin
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id=auth.uid();
  if v_owner is null then raise exception using errcode='42501',message='mapped team profile required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner,0));
  select * into v_publication from public.team_workweek_publications where id=p_publication_id and owner_profile_id=v_owner for update;
  if not found then raise exception using errcode='P0002',message='team workweek publication not found'; end if;
  if not exists(select 1 from public.team_workweek_versions where id=v_publication.source_version_id and selected_week_start is not null and activation_mode='future_monday') then
    return public.finalize_team_workweek_publication_before_week_selection(p_publication_id);
  end if;
  if v_publication.attempt_generation=0 then return public.finalize_monday_team_workweek_publication(p_publication_id); end if;
  if v_publication.status='preparing' then
    if clock_timestamp()>=v_publication.effective_at then raise exception using errcode='P0005',message='activation candidate expired'; end if;
    if v_publication.predecessor_publication_id is not null and not exists(select 1 from public.team_workweek_publications
      where id=v_publication.predecessor_publication_id and owner_profile_id=v_owner and status='published' and (coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=v_publication.effective_at and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>v_publication.effective_at)
        and publication_revision=v_publication.expected_predecessor_revision) then
      raise exception using errcode='P0004',message='published workweek revision is stale';
    end if;
    if coalesce(v_publication.successor_snapshot,'[]'::jsonb) is distinct from public.team_workweek_selected_snapshot(v_owner,v_publication.predecessor_publication_id) then
      raise exception using errcode='P0004',message='prepared successor revision is stale';
    end if;
    if v_publication.planned_effect_count is null or exists(select 1 from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation and state<>'confirmed')
      or (select count(*) from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation ) <> v_publication.planned_effect_count then
      raise exception using errcode='P0003',message='all projection effects must be confirmed';
    end if;
    if v_publication.predecessor_publication_id is not null then
      update public.team_workweek_publications set effective_until=v_publication.effective_at,
        effective_to=(v_publication.effective_at at time zone 'Europe/Berlin')::date-1,superseded_by_publication_id=v_publication.id
      where id=v_publication.predecessor_publication_id;
    end if;
    update public.team_workweek_google_series as series set provider_state='deleted',provider_deleted_at=clock_timestamp()
      where id in(select series_id from public.team_workweek_publication_effects where publication_id=v_publication.id
        and generation=v_publication.attempt_generation and operation='cancel');
    update public.team_workweek_publications set status='published' ,sync_state='confirmed',published_at=clock_timestamp(),last_sync_at=clock_timestamp()
      where id=v_publication.id and effective_at>clock_timestamp() returning * into v_publication;
    if not found or clock_timestamp()>=v_publication.effective_at then
      raise exception using errcode='P0005',message='activation candidate expired';
    end if;
  elsif v_publication.status<>'published' then
    raise exception using errcode='P0004',message='publication is inactive';
  end if;
  return jsonb_build_object('id',v_publication.id,'status',v_publication.status,'syncState',v_publication.sync_state,
    'publishedAt',v_publication.published_at,'lastSyncAt',v_publication.last_sync_at,'publicationRevision',v_publication.publication_revision,
    'effectiveUntil',v_publication.effective_until,'successorPublicationId',v_publication.successor_publication_id,'activationMode',v_publication.activation_mode,'effectiveAt',v_publication.effective_at);
end; $$;
revoke all on function public.prepare_team_workweek_publication_before_recovery(uuid),public.finalize_team_workweek_publication_before_recovery(uuid),public.prepare_team_workweek_publication_before_week_selection(uuid),public.finalize_team_workweek_publication_before_week_selection(uuid) from public,anon,authenticated,service_role;

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
  if not found then
    -- A saved Owner draft must retain its inputs while the stale automatic
    -- operation blocking all publication is safely retired by the same action.
    select publication.* into v_pub from public.team_workweek_publications as publication
      join public.team_workweek_versions as source on source.id=publication.source_version_id
      where publication.owner_profile_id=v_owner and publication.status='preparing'
        and source.origin='google_reconciliation' and source.retired_at is null;
  end if;
  if found then
    if v_pub.status<>'preparing' or v_pub.attempt_generation=0 or v_pub.write_journal_version=0 or (v_pub.effective_at>clock_timestamp() and (v_pub.restart_requested_at is null or v_pub.write_journal_version=0))
      or exists(select 1 from public.team_workweek_provider_operations where publication_id=v_pub.id and state<>'settled')
      or exists(select 1 from public.team_workweek_publication_effects where publication_id=v_pub.id and generation=v_pub.attempt_generation and state<>'cleaned') then
      raise exception using errcode='P0003',message='publication must be safely compensated before restart';end if;
    update public.team_workweek_publications set status='inactive',deactivated_at=clock_timestamp(),deactivation_reason='private_restart' where id=v_pub.id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('weekday',weekday,'startMinute',start_minute,'endMinute',end_minute) order by weekday,start_minute,end_minute,id),'[]') into v_windows from public.team_workweek_windows where version_id=p_version_id;
  if v_version.selected_week_start is not null then
    v_date:=greatest(v_version.selected_week_start,date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date);
    v_id:=(public.create_private_selected_team_workweek_version(v_date,v_windows,public.team_workweek_selected_binding(v_owner,v_date)->>'contextToken')->>'id')::uuid;
  else
  select * into v_base from public.team_workweek_publications where owner_profile_id=v_owner and status='published'
    and (v_version.activation_mode='future_monday' or (coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp() and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp()))
    order by effective_from desc,publication_revision desc limit 1;
  v_date:=case when v_version.activation_mode='future_monday' then greatest(v_version.effective_from,date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7,coalesce(v_base.effective_from+7,v_version.effective_from)) else date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date end;
  select coalesce(jsonb_agg(jsonb_build_object('weekday',weekday,'startMinute',start_minute,'endMinute',end_minute) order by weekday,start_minute,end_minute,id),'[]') into v_windows from public.team_workweek_windows where version_id=p_version_id;
  v_id:=public.insert_temporal_google_workweek_version(v_owner,v_base.id,v_base.publication_revision,v_windows,'owner',null,v_version.activation_mode,v_date);
  end if;
  update public.team_workweek_versions set retired_at=clock_timestamp(),restarted_version_id=v_id where id=p_version_id or (id=v_pub.source_version_id and v_pub.source_version_id is distinct from p_version_id);
  update public.team_workweek_versions set retired_at=clock_timestamp() where id in(select founderops_version_id from public.team_workweek_google_conflicts where resolution_version_id=p_version_id and owner_profile_id=v_owner);
  update public.team_workweek_google_conflicts set state='cancelled',decision=null,resolution_version_id=null,resolved_at=clock_timestamp(),updated_at=clock_timestamp()
    where owner_profile_id=v_owner and state in('open','resolving') and (resolution_version_id=p_version_id or founderops_version_id=p_version_id);
  return jsonb_build_object('versionId',v_id,'replayed',false);
end;$$;
