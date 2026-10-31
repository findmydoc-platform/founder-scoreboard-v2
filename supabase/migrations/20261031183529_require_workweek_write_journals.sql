-- All new Calendar writes require durable owner-bound journal evidence.
alter table public.team_workweek_publications alter column write_journal_version set default 1;
alter table public.team_workweek_publications alter column attempt_generation set default 1;
alter table public.team_workweek_provider_writes add column evidence_kind text not null default 'dispatch' check(evidence_kind in ('dispatch','observation'));
alter table public.google_workspace_disconnect_series add column provider_write_state text not null default 'pending' check(provider_write_state in ('pending','dispatched','uncertain','settled'));
alter table public.google_workspace_disconnect_series add column provider_write_at timestamptz;
alter table public.google_workspace_disconnect_series add column provider_evidence_kind text check(provider_evidence_kind in ('dispatch','observation'));

create function public.enforce_workweek_journal_contract() returns trigger language plpgsql set search_path=public as $$
begin
  if (TG_OP='INSERT' and (new.write_journal_version<>1 or new.attempt_generation<1))
    or (TG_OP='UPDATE' and (new.write_journal_version<>old.write_journal_version
      or (old.status<>'published' and new.status='published' and (new.write_journal_version<>1 or new.attempt_generation<1)))) then
    raise exception using errcode='23514',message='journaled publication required';
  end if;
  return new;
end;$$;
revoke all on function public.enforce_workweek_journal_contract() from public,anon,authenticated,service_role;
create trigger enforce_workweek_journal_contract before insert or update on public.team_workweek_publications for each row execute function public.enforce_workweek_journal_contract();


CREATE OR REPLACE FUNCTION public.prepare_team_workweek_activation(p_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'effectiveUntil',v_publication.effective_until,'successorPublicationId',v_publication.successor_publication_id,'activationMode',v_publication.activation_mode,'predecessorPublicationId',v_publication.predecessor_publication_id,'effectiveAt',v_publication.effective_at,'attemptGeneration',v_publication.attempt_generation,'writeJournalVersion',1,
    'timezone','Europe/Berlin','status',v_publication.status,'syncState',v_publication.sync_state,'publicationRevision',v_publication.publication_revision,
    'publishedAt',v_publication.published_at,'lastSyncAt',v_publication.last_sync_at,'series','[]'::jsonb,'transitions','[]'::jsonb,'effects',v_effects);
end; $function$;

revoke all on function public.prepare_team_workweek_activation(uuid) from public,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public.prepare_team_workweek_selection(p_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    return public.prepare_team_workweek_activation(p_version_id);
  end if;
  if v_version.retired_at is not null then raise exception using errcode='P0004',message='private version has retired; use its explicit restarted version';end if;
  if v_version.base_publication_id is not null and not exists(select 1 from public.team_workweek_publications
    where id=v_version.base_publication_id and owner_profile_id=v_owner and status='published' and (coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=(v_version.effective_from::timestamp at time zone 'Europe/Berlin') and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>(v_version.effective_from::timestamp at time zone 'Europe/Berlin'))
      and publication_revision=v_version.base_publication_revision) and not exists(select 1 from public.team_workweek_publications where source_version_id=v_version.id) then
    raise exception using errcode='P0004',message='published workweek revision is stale';
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
    'effectiveUntil',v_publication.effective_until,'successorPublicationId',v_publication.successor_publication_id,'activationMode',v_publication.activation_mode,'predecessorPublicationId',v_publication.predecessor_publication_id,'effectiveAt',v_publication.effective_at,'attemptGeneration',v_publication.attempt_generation,'writeJournalVersion',1,
    'timezone','Europe/Berlin','status',v_publication.status,'syncState',v_publication.sync_state,'publicationRevision',v_publication.publication_revision,
    'publishedAt',v_publication.published_at,'lastSyncAt',v_publication.last_sync_at,'series','[]'::jsonb,'transitions','[]'::jsonb,'effects',v_effects);
end; $function$;

revoke all on function public.prepare_team_workweek_selection(uuid) from public,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public.prepare_team_workweek_publication(p_version_id uuid, p_write_journal_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_owner text;v_existing uuid;v_result jsonb;
begin
  if p_write_journal_version is distinct from 1 then raise exception using errcode='22023',message='unsupported publication protocol';end if;
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id=auth.uid();
  if v_owner is null then raise exception using errcode='42501',message='mapped team profile required';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner,0));
  if not exists(select 1 from public.team_workweek_versions where id=p_version_id and owner_profile_id=v_owner) then raise exception using errcode='P0002',message='private version not found';end if;
  select id into v_existing from public.team_workweek_publications where source_version_id=p_version_id and owner_profile_id=v_owner;
  if exists(select 1 from public.team_workweek_publications where id=v_existing and restart_requested_at is not null) then raise exception using errcode='P0003',message='publication restart requested';end if;
  if exists(select 1 from public.team_workweek_provider_operations operation join public.team_workweek_publications publication on publication.id=operation.publication_id where publication.id=v_existing and operation.state<>'settled' and (operation.purpose='cleanup' or publication.effective_at<=clock_timestamp())) then raise exception using errcode='P0003',message='publication provider operation is still preparing';end if;
  if exists(select 1 from public.team_workweek_publications where id=v_existing and (write_journal_version<>1 or attempt_generation<1)) then raise exception using errcode='P0003',message='historical provider writes require recovery evidence';end if;
  v_result:=public.prepare_team_workweek_selection(p_version_id);
  return v_result||jsonb_build_object('writeJournalVersion',(select write_journal_version from public.team_workweek_publications where id=(v_result->>'id')::uuid));
end;$function$;


revoke all on function public.prepare_team_workweek_publication(uuid,integer) from public,anon,service_role;
grant execute on function public.prepare_team_workweek_publication(uuid,integer) to authenticated;


CREATE OR REPLACE FUNCTION public.finalize_team_workweek_activation(p_publication_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_owner text; v_publication public.team_workweek_publications%rowtype;
begin
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id=auth.uid();
  if v_owner is null then raise exception using errcode='42501',message='mapped team profile required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner,0));
  select * into v_publication from public.team_workweek_publications where id=p_publication_id and owner_profile_id=v_owner for update;
  if not found then raise exception using errcode='P0002',message='team workweek publication not found'; end if;
  if v_publication.status='preparing' then
    if clock_timestamp()>=v_publication.effective_at then raise exception using errcode='P0005',message='activation candidate expired'; end if;
    if v_publication.predecessor_publication_id is not null and not exists(select 1 from public.team_workweek_publications
      where id=v_publication.predecessor_publication_id and owner_profile_id=v_owner and status='published' and ((v_publication.activation_mode='future_monday' and effective_to is null) or (v_publication.activation_mode='immediate' and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp() and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp()))
        and publication_revision=v_publication.expected_predecessor_revision) then
      raise exception using errcode='P0004',message='published workweek revision is stale';
    end if;
    if v_publication.activation_mode='immediate' then
      if coalesce(v_publication.successor_snapshot,'[]'::jsonb) is distinct from public.team_workweek_successor_snapshot(v_owner) then
        raise exception using errcode='P0004',message='prepared successor revision is stale';
      end if;
    elsif exists(select 1 from public.team_workweek_publications where owner_profile_id=v_owner and status='published'
      and id is distinct from v_publication.predecessor_publication_id and effective_to is null) then
      raise exception using errcode='P0004',message='published workweek revision is stale';
    end if;
    if v_publication.planned_effect_count is null or exists(select 1 from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation and state<>'confirmed')
      or (select count(*) from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation ) <> v_publication.planned_effect_count then
      raise exception using errcode='P0003',message='all projection effects must be confirmed';
    end if;
    if v_publication.predecessor_publication_id is not null then
      update public.team_workweek_publications set effective_until=v_publication.effective_at,
        effective_to=(v_publication.effective_at at time zone 'Europe/Berlin')::date,superseded_by_publication_id=v_publication.id
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
end; $function$;

revoke all on function public.finalize_team_workweek_activation(uuid) from public,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public.finalize_team_workweek_selection(p_publication_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_owner text; v_publication public.team_workweek_publications%rowtype;
begin
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id=auth.uid();
  if v_owner is null then raise exception using errcode='42501',message='mapped team profile required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner,0));
  select * into v_publication from public.team_workweek_publications where id=p_publication_id and owner_profile_id=v_owner for update;
  if not found then raise exception using errcode='P0002',message='team workweek publication not found'; end if;
  if not exists(select 1 from public.team_workweek_versions where id=v_publication.source_version_id and selected_week_start is not null and activation_mode='future_monday') then
    return public.finalize_team_workweek_activation(p_publication_id);
  end if;
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
end; $function$;

revoke all on function public.finalize_team_workweek_selection(uuid) from public,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public.finalize_team_workweek_publication(p_publication_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_owner text;v_publication public.team_workweek_publications%rowtype;v_result jsonb;
begin
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id=auth.uid();
  if v_owner is null then raise exception using errcode='42501',message='mapped team profile required';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner,0));
  select * into v_publication from public.team_workweek_publications where id=p_publication_id and owner_profile_id=v_owner;
  if v_publication.restart_requested_at is not null then raise exception using errcode='P0003',message='publication restart requested';end if;
  v_result:=public.finalize_team_workweek_selection(p_publication_id);
  -- This assertion shares the finalization transaction, so a missing journal rolls back every publication change.
  if v_publication.status='preparing' and (v_publication.write_journal_version<>1 or v_publication.attempt_generation<1
    or exists(select 1 from public.team_workweek_publication_effects e where e.publication_id=v_publication.id and e.generation=v_publication.attempt_generation and not exists(
      select 1 from public.team_workweek_provider_writes w join public.team_workweek_provider_operations o on o.id=w.operation_id
      where w.effect_id=e.id and w.state='settled' and o.publication_id=v_publication.id and o.generation=v_publication.attempt_generation and o.purpose='publish'))) then
    raise exception using errcode='P0003',message='publication evidence is incomplete';
  end if;
  return v_result;
end;$function$;


CREATE OR REPLACE FUNCTION public.claim_team_workweek_provider_operation(p_publication_id uuid, p_generation integer, p_purpose text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_pub public.team_workweek_publications%rowtype; v_op public.team_workweek_provider_operations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='service role required';end if;
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
  if v_pub.write_journal_version<>1 then raise exception using errcode='P0003',message='journaled publication required';end if;
  if p_purpose='cleanup' and v_pub.effective_at>clock_timestamp() and v_pub.restart_requested_at is null then
    raise exception using errcode='P0003',message='future publication has not been cancelled';end if;
  insert into public.team_workweek_provider_operations(publication_id,owner_profile_id,generation,purpose) values(p_publication_id,v_pub.owner_profile_id,p_generation,p_purpose) returning * into v_op;
  return jsonb_build_object('state','claimed','id',v_op.id);
end;$function$;


CREATE OR REPLACE FUNCTION public.request_team_workweek_publication_restart(p_publication_id uuid, p_owner_profile_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_pub public.team_workweek_publications%rowtype;v_op public.team_workweek_provider_operations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='service role required';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id,0));
  select * into v_pub from public.team_workweek_publications where id=p_publication_id and owner_profile_id=p_owner_profile_id for update;
  if not found then raise exception using errcode='42501',message='publication is not owned by caller';end if;
  if v_pub.status<>'preparing' or v_pub.attempt_generation<1 then raise exception using errcode='P0003',message='committed publication cannot restart';end if;
  if v_pub.write_journal_version<>1 then raise exception using errcode='P0003',message='journaled publication required';end if;
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
end;$function$;


CREATE OR REPLACE FUNCTION public.record_team_workweek_provider_write(p_operation_id uuid, p_effect_id uuid, p_state text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_op public.team_workweek_provider_operations%rowtype; v_pub public.team_workweek_publications%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='service role required';end if;
  select * into v_op from public.team_workweek_provider_operations where id=p_operation_id;
  if not found then raise exception using errcode='P0002',message='operation not found';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_op.owner_profile_id,0));
  select * into v_op from public.team_workweek_provider_operations where id=p_operation_id for update;
  select * into v_pub from public.team_workweek_publications where id=v_op.publication_id;
  if v_op.state='settled' or v_pub.status<>'preparing' or v_pub.attempt_generation<>v_op.generation
    or p_state not in ('dispatched','replaying','uncertain','settled','observed') or not exists(select 1 from public.team_workweek_publication_effects where id=p_effect_id and publication_id=v_pub.id and generation=v_op.generation)
    or (p_state in ('dispatched','replaying') and exists(select 1 from public.team_workweek_publication_effects where id=p_effect_id and state='cleaned'))
    or (p_state='replaying' and (v_op.state<>'uncertain' or not exists(select 1 from public.team_workweek_provider_writes where operation_id=v_op.id and effect_id=p_effect_id and state<>'settled')))
    or (p_state='dispatched' and (v_op.state<>'active' or (v_op.purpose='publish' and v_pub.restart_requested_at is not null))) then
    raise exception using errcode='P0003',message='provider write is stale or cancelled';end if;
  if p_state='dispatched' then
    insert into public.team_workweek_provider_writes(operation_id,effect_id,state) values(v_op.id,p_effect_id,p_state);
  elsif p_state='observed' then
    insert into public.team_workweek_provider_writes(operation_id,effect_id,state,evidence_kind) values(v_op.id,p_effect_id,'settled','observation')
      on conflict(operation_id,effect_id) do update set state='settled',updated_at=clock_timestamp();
  elsif p_state<>'replaying' then
    update public.team_workweek_provider_writes set state=p_state,updated_at=clock_timestamp() where operation_id=v_op.id and effect_id=p_effect_id and state<>'settled';
  end if;
end;$function$;


CREATE OR REPLACE FUNCTION public.confirm_team_workweek_effect(p_effect_id uuid, p_generation integer, p_etag text, p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_effect public.team_workweek_publication_effects%rowtype; v_publication public.team_workweek_publications%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='service role required';end if;
  select * into v_effect from public.team_workweek_publication_effects where id=p_effect_id;
  if not found then raise exception using errcode='P0002',message='effect not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_effect.owner_profile_id,0));
  select * into v_publication from public.team_workweek_publications where id=v_effect.publication_id for update;
  if v_publication.status<>'preparing' or v_publication.attempt_generation<>p_generation or v_effect.generation<>p_generation
    or v_effect.state='cleaned' or v_effect.payload<>p_payload or nullif(trim(p_etag),'') is null or clock_timestamp()>=v_publication.effective_at
    or (v_effect.kind='crossing_instance' and v_effect.expected_etag is null) then
    raise exception using errcode='P0003',message='stale or expired projection confirmation';
  end if;
  if v_publication.restart_requested_at is not null or not exists(
    select 1 from public.team_workweek_provider_writes w join public.team_workweek_provider_operations o on o.id=w.operation_id
    where w.effect_id=p_effect_id and w.state='settled' and o.publication_id=v_publication.id and o.generation=p_generation and o.purpose='publish') then
    raise exception using errcode='P0003',message='effect evidence is incomplete';
  end if;
  update public.team_workweek_publication_effects set state='confirmed',confirmed_etag=p_etag,observed_at=clock_timestamp() where id=p_effect_id;
  if v_effect.series_id is not null then
    update public.team_workweek_google_series set observed_payload=p_payload,state='confirmed',confirmed_etag=p_etag,
      confirmed_founderops_revision=case when v_effect.operation='create' then v_publication.publication_revision else confirmed_founderops_revision end,
      last_confirmed_at=clock_timestamp(),last_observed_at=clock_timestamp() where id=v_effect.series_id;
  end if;
end; $function$;


CREATE OR REPLACE FUNCTION public.confirm_team_workweek_planned_cleanup(p_effect_id uuid, p_generation integer, p_etag text, p_preserved boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_effect public.team_workweek_publication_effects%rowtype;v_pub public.team_workweek_publications%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='service role required';end if;
  select * into v_effect from public.team_workweek_publication_effects where id=p_effect_id;
  if not found then raise exception using errcode='P0002',message='effect not found';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_effect.owner_profile_id,0));
  select * into v_pub from public.team_workweek_publications where id=v_effect.publication_id for update;
  if v_pub.status<>'preparing' or v_pub.attempt_generation<>p_generation or v_effect.generation<>p_generation or v_effect.cleanup_at is null or nullif(trim(p_etag),'') is null
    or (p_preserved and v_effect.cleanup_disposition not in('preserve','retain')) then raise exception using errcode='P0003',message='cleanup observation is stale';end if;
  if v_effect.cleanup_skipped then raise exception using errcode='P0003',message='undispatched effect was aborted without provider evidence';end if;
  if v_effect.state='cleaned' then
    if v_effect.cleanup_confirmed_etag<>p_etag or v_effect.cleanup_preserved<>p_preserved then raise exception using errcode='P0004',message='cleanup evidence changed';end if;
    return;
  end if;
  if not exists(select 1 from public.team_workweek_provider_writes w join public.team_workweek_provider_operations o on o.id=w.operation_id
    where w.effect_id=p_effect_id and w.state='settled' and o.publication_id=v_pub.id and o.generation=p_generation and o.purpose='cleanup') then
    raise exception using errcode='P0003',message='cleanup evidence is incomplete';
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
end;$function$;


create function public.record_google_workspace_disconnect_write(p_target_id uuid,p_state text) returns void language plpgsql security definer set search_path=public as $$
declare v_target public.google_workspace_disconnect_series%rowtype;v_operation public.google_workspace_disconnect_operations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='service role required';end if;
  select * into v_target from public.google_workspace_disconnect_series where id=p_target_id;
  select * into v_operation from public.google_workspace_disconnect_operations where id=v_target.operation_id;
  if v_operation.id is null then raise exception using errcode='P0003',message='disconnect evidence is stale';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_operation.owner_profile_id,0));
  select * into v_target from public.google_workspace_disconnect_series where id=p_target_id for update;
  if v_target.id is null or v_operation.state not in ('cleaning','cleanup_pending') or v_target.state<>'pending'
    or p_state not in ('dispatched','settled','uncertain','observed') then raise exception using errcode='P0003',message='disconnect evidence is stale';end if;
  if p_state='dispatched' and v_target.provider_write_state='dispatched' and v_target.provider_write_at>clock_timestamp()-interval '30 seconds' then
    raise exception using errcode='P0003',message='disconnect write is in progress';
  end if;
  update public.google_workspace_disconnect_series set provider_write_state=case when p_state='observed' then 'settled' else p_state end,
    provider_evidence_kind=case when p_state='dispatched' then 'dispatch' when p_state='observed' then coalesce(provider_evidence_kind,'observation') else provider_evidence_kind end,
    provider_write_at=clock_timestamp() where id=p_target_id;
end;$$;
revoke all on function public.record_google_workspace_disconnect_write(uuid,text) from public,anon,authenticated;
grant execute on function public.record_google_workspace_disconnect_write(uuid,text) to service_role;

create function public.dispatch_google_calendar_mutation(p_owner_profile_id text,p_kind text,p_operation_id uuid,p_target_id uuid,p_event_id text,p_method text,p_replay boolean default false)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_op public.team_workweek_provider_operations%rowtype;v_effect public.team_workweek_publication_effects%rowtype;v_target public.google_workspace_disconnect_series%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='service role required';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id,0));
  if p_method not in ('POST','PUT','DELETE') then raise exception using errcode='42501',message='unsupported Calendar mutation';end if;
  if p_kind='publication' then
    select * into v_op from public.team_workweek_provider_operations where id=p_operation_id and owner_profile_id=p_owner_profile_id;
    select * into v_effect from public.team_workweek_publication_effects where id=p_target_id and publication_id=v_op.publication_id and generation=v_op.generation and owner_profile_id=p_owner_profile_id;
    if v_effect.id is null or v_effect.google_event_id<>p_event_id
      or (v_op.purpose='publish' and p_method<>case when v_effect.operation='create' then 'POST' else 'PUT' end)
      or (v_op.purpose='cleanup' and (p_method='POST' or (v_effect.operation<>'create' and p_method<>'PUT'))) then
      raise exception using errcode='42501',message='Calendar target is not bound';end if;
    perform public.record_team_workweek_provider_write(p_operation_id,p_target_id,case when p_replay then 'replaying' else 'dispatched' end);
  elsif p_kind='disconnect' then
    select t.* into v_target from public.google_workspace_disconnect_series t join public.google_workspace_disconnect_operations o on o.id=t.operation_id
      where t.id=p_target_id and t.operation_id=p_operation_id and o.owner_profile_id=p_owner_profile_id;
    if v_target.id is null or v_target.google_event_id<>p_event_id or p_method='POST' then raise exception using errcode='42501',message='Calendar target is not bound';end if;
    perform public.record_google_workspace_disconnect_write(p_target_id,'dispatched');
  else raise exception using errcode='42501',message='Calendar operation is not bound';end if;
  return true;
end;$$;
revoke all on function public.dispatch_google_calendar_mutation(text,text,uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.dispatch_google_calendar_mutation(text,text,uuid,uuid,text,text,boolean) to service_role;


CREATE OR REPLACE FUNCTION public.confirm_google_workspace_disconnect_series(p_target_id uuid, p_expected_etag text, p_confirmed_etag text, p_observed_at timestamp with time zone DEFAULT clock_timestamp())
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_target public.google_workspace_disconnect_series%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  select * into v_target from public.google_workspace_disconnect_series
  where id = p_target_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'disconnect target not found'; end if;
  if v_target.state = 'confirmed' then return; end if;
  if v_target.expected_etag <> p_expected_etag then
    raise exception using errcode = 'P0004', message = 'disconnect target changed';
  end if;
  if v_target.provider_write_state<>'settled' or v_target.provider_evidence_kind is null then raise exception using errcode='P0003',message='disconnect evidence is incomplete';end if;
  update public.google_workspace_disconnect_series
  set state = 'confirmed', confirmed_etag = nullif(p_confirmed_etag, ''),
    last_error_class = null, last_observed_at = p_observed_at, updated_at = p_observed_at
  where id = v_target.id;
end;
$function$;


drop function public.prepare_team_workweek_publication(uuid);

drop function public.prepare_team_workweek_publication_with_protocol(uuid,integer);

drop function public.prepare_team_workweek_publication_before_recovery(uuid);

drop function public.prepare_team_workweek_publication_before_week_selection(uuid);

drop function public.prepare_monday_team_workweek_publication(uuid);

drop function public.finalize_team_workweek_publication_before_recovery(uuid);

drop function public.finalize_team_workweek_publication_before_week_selection(uuid);

drop function public.finalize_monday_team_workweek_publication(uuid);

drop function public.confirm_team_workweek_effect_before_recovery(uuid,integer,text,jsonb);

drop function public.confirm_team_workweek_effect_restoration(uuid,integer,text);

drop function public.confirm_team_workweek_effect_cleanup(uuid,integer);

drop function public.confirm_team_workweek_google_series(uuid,text,integer,timestamptz);

drop function public.confirm_team_workweek_google_series_transition(uuid,text,integer,timestamptz);
