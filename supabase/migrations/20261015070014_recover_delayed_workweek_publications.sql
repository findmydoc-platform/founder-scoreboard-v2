-- Provider claims keep cancellation separate from activation and immutable effects.
alter table public.team_workweek_publications add column if not exists write_journal_version integer not null default 0;
alter table public.team_workweek_publications add column if not exists restart_requested_at timestamptz;
create table public.team_workweek_provider_operations (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.team_workweek_publications(id) on delete cascade,
  owner_profile_id text not null references public.profiles(id),
  generation integer not null check (generation > 0),
  purpose text not null check (purpose in ('publish','cleanup')),
  state text not null default 'active' check (state in ('active','uncertain','settled')),
  created_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz
);
create unique index team_workweek_provider_operation_exclusive on public.team_workweek_provider_operations(publication_id) where state <> 'settled';
create table public.team_workweek_provider_writes (
  operation_id uuid not null references public.team_workweek_provider_operations(id) on delete cascade,
  effect_id uuid not null references public.team_workweek_publication_effects(id) on delete cascade,
  state text not null check (state in ('dispatched','uncertain','settled')),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(operation_id,effect_id)
);
alter table public.team_workweek_provider_operations enable row level security;
alter table public.team_workweek_provider_writes enable row level security;
revoke all on public.team_workweek_provider_operations, public.team_workweek_provider_writes from public, anon, authenticated, service_role;
grant select, insert, update on public.team_workweek_provider_operations, public.team_workweek_provider_writes to service_role;

create function public.claim_team_workweek_provider_operation(p_publication_id uuid,p_generation integer,p_purpose text)
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
  select * into v_op from public.team_workweek_provider_operations where publication_id=p_publication_id and state<>'settled';
  if found then return jsonb_build_object('state',case when v_op.state='active' then 'in_progress' else 'uncertain' end,'id',v_op.id,'purpose',v_op.purpose);end if;
  if p_purpose='publish' and v_pub.restart_requested_at is not null then raise exception using errcode='P0003',message='publication restart requested';end if;
  if p_purpose='cleanup' and v_pub.write_journal_version=0 then return jsonb_build_object('state','legacy_untracked');end if;
  if p_purpose='cleanup' and v_pub.effective_at>clock_timestamp() and (v_pub.restart_requested_at is null or v_pub.write_journal_version=0) then
    raise exception using errcode='P0003',message='future publication has not been cancelled';end if;
  insert into public.team_workweek_provider_operations(publication_id,owner_profile_id,generation,purpose) values(p_publication_id,v_pub.owner_profile_id,p_generation,p_purpose) returning * into v_op;
  return jsonb_build_object('state','claimed','id',v_op.id);
end;$$;

create function public.record_team_workweek_provider_write(p_operation_id uuid,p_effect_id uuid,p_state text)
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
    or p_state not in ('dispatched','uncertain','settled') or not exists(select 1 from public.team_workweek_publication_effects where id=p_effect_id and publication_id=v_pub.id and generation=v_op.generation)
    or (p_state='dispatched' and (v_op.state<>'active' or (v_op.purpose='publish' and v_pub.restart_requested_at is not null))) then
    raise exception using errcode='P0003',message='provider write is stale or cancelled';end if;
  if p_state='dispatched' then
    insert into public.team_workweek_provider_writes(operation_id,effect_id,state) values(v_op.id,p_effect_id,p_state);
  else
    update public.team_workweek_provider_writes set state=p_state,updated_at=clock_timestamp() where operation_id=v_op.id and effect_id=p_effect_id;
  end if;
end;$$;

create function public.finish_team_workweek_provider_operation(p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_op public.team_workweek_provider_operations%rowtype; v_uncertain boolean;
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='service role required';end if;
  select * into v_op from public.team_workweek_provider_operations where id=p_operation_id;
  if not found then raise exception using errcode='P0002',message='operation not found';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_op.owner_profile_id,0));
  select * into v_op from public.team_workweek_provider_operations where id=p_operation_id for update;
  select exists(select 1 from public.team_workweek_provider_writes where operation_id=v_op.id and state<>'settled') into v_uncertain;
  update public.team_workweek_provider_operations set state=case when v_uncertain then 'uncertain' else 'settled' end,settled_at=case when v_uncertain then null else clock_timestamp() end where id=v_op.id;
  return jsonb_build_object('state',case when v_uncertain then 'uncertain' else 'settled' end);
end;$$;

create function public.request_team_workweek_publication_restart(p_publication_id uuid,p_owner_profile_id text)
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
  select * into v_op from public.team_workweek_provider_operations where publication_id=v_pub.id and state<>'settled';
  if found then return jsonb_build_object('state','delayed','reason',case when v_op.state='active' then 'in_progress' else 'uncertain' end);end if;
  return jsonb_build_object('state','ready','reason',null);
end;$$;

-- Preserve existing implementation bodies behind guarded entry points.
alter function public.prepare_team_workweek_publication(uuid) rename to prepare_team_workweek_publication_before_recovery;
revoke all on function public.prepare_team_workweek_publication_before_recovery(uuid) from public,anon,authenticated,service_role;
create function public.prepare_team_workweek_publication_with_protocol(p_version_id uuid,p_write_journal_version integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_owner text;v_existing uuid;v_result jsonb;
begin
  if p_write_journal_version not in (0,1) or p_write_journal_version is null then raise exception using errcode='22023',message='unsupported publication protocol';end if;
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id=auth.uid();
  if v_owner is null then raise exception using errcode='42501',message='mapped team profile required';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner,0));
  if not exists(select 1 from public.team_workweek_versions where id=p_version_id and owner_profile_id=v_owner) then raise exception using errcode='P0002',message='private version not found';end if;
  select id into v_existing from public.team_workweek_publications where source_version_id=p_version_id and owner_profile_id=v_owner;
  if p_write_journal_version=0 and exists(select 1 from public.team_workweek_publications where id=v_existing and write_journal_version>0) then raise exception using errcode='P0003',message='publication requires the journaled protocol';end if;
  if exists(select 1 from public.team_workweek_publications where id=v_existing and restart_requested_at is not null) then raise exception using errcode='P0003',message='publication restart requested';end if;
  if exists(select 1 from public.team_workweek_provider_operations operation join public.team_workweek_publications publication on publication.id=operation.publication_id where publication.id=v_existing and operation.state<>'settled' and (operation.purpose='cleanup' or publication.effective_at<=clock_timestamp())) then raise exception using errcode='P0003',message='publication provider operation is still preparing';end if;
  if exists(select 1 from public.team_workweek_publications where id=v_existing and status='preparing' and write_journal_version=0 and attempt_generation>0 and effective_at<=clock_timestamp()) then raise exception using errcode='P0003',message='historical provider writes require recovery evidence';end if;
  v_result:=public.prepare_team_workweek_publication_before_recovery(p_version_id);
  if v_existing is null and (v_result->>'attemptGeneration')::integer>0 then update public.team_workweek_publications set write_journal_version=p_write_journal_version where id=(v_result->>'id')::uuid;end if;
  return v_result||jsonb_build_object('writeJournalVersion',(select write_journal_version from public.team_workweek_publications where id=(v_result->>'id')::uuid));
end;$$;
revoke all on function public.prepare_team_workweek_publication_with_protocol(uuid,integer) from public,anon,authenticated,service_role;
create function public.prepare_team_workweek_publication(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_owner text;
begin
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id=auth.uid();
  if v_owner is null then raise exception using errcode='42501',message='mapped team profile required';end if;
  return public.prepare_team_workweek_publication_with_protocol(p_version_id,0);
end;$$;
create function public.prepare_team_workweek_publication(p_version_id uuid,p_write_journal_version integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_owner text;
begin
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id=auth.uid();
  if v_owner is null then raise exception using errcode='42501',message='mapped team profile required';end if;
  if p_write_journal_version is distinct from 1 then raise exception using errcode='22023',message='journaled publication protocol required';end if;
  return public.prepare_team_workweek_publication_with_protocol(p_version_id,1);
end;$$;
revoke all on function public.prepare_team_workweek_publication(uuid,integer) from public,anon,service_role;
grant execute on function public.prepare_team_workweek_publication(uuid,integer) to authenticated;
revoke all on function public.prepare_team_workweek_publication(uuid) from public,anon,service_role;
grant execute on function public.prepare_team_workweek_publication(uuid) to authenticated;

alter function public.finalize_team_workweek_publication(uuid) rename to finalize_team_workweek_publication_before_recovery;
revoke all on function public.finalize_team_workweek_publication_before_recovery(uuid) from public,anon,authenticated,service_role;
create function public.finalize_team_workweek_publication(p_publication_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_owner text;
begin
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id=auth.uid();
  if v_owner is null then raise exception using errcode='42501',message='mapped team profile required';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner,0));
  if exists(select 1 from public.team_workweek_publications where id=p_publication_id and owner_profile_id=v_owner and restart_requested_at is not null) then raise exception using errcode='P0003',message='publication restart requested';end if;
  return public.finalize_team_workweek_publication_before_recovery(p_publication_id);
end;$$;
revoke all on function public.finalize_team_workweek_publication(uuid) from public,anon,service_role;
grant execute on function public.finalize_team_workweek_publication(uuid) to authenticated;

alter function public.confirm_team_workweek_effect(uuid,integer,text,jsonb) rename to confirm_team_workweek_effect_before_recovery;
revoke all on function public.confirm_team_workweek_effect_before_recovery(uuid,integer,text,jsonb) from public,anon,authenticated,service_role;
create function public.confirm_team_workweek_effect(p_effect_id uuid,p_generation integer,p_etag text,p_payload jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_owner text;
begin
  select owner_profile_id into v_owner from public.team_workweek_publication_effects where id=p_effect_id;
  perform pg_advisory_xact_lock(hashtextextended(v_owner,0));
  if exists(select 1 from public.team_workweek_publications p join public.team_workweek_publication_effects e on e.publication_id=p.id where e.id=p_effect_id and p.restart_requested_at is not null) then raise exception using errcode='P0003',message='publication restart requested';end if;
  perform public.confirm_team_workweek_effect_before_recovery(p_effect_id,p_generation,p_etag,p_payload);
end;$$;
revoke all on function public.confirm_team_workweek_effect(uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_team_workweek_effect(uuid,integer,text,jsonb) to service_role;

create or replace function public.prepare_team_workweek_effect_cleanup(p_publication_id uuid,p_generation integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_pub public.team_workweek_publications%rowtype;v_effect public.team_workweek_publication_effects%rowtype;v_cutoff timestamptz;v_boundary jsonb;v_id uuid;v_crossing jsonb;v_effects jsonb;v_preserved boolean;
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='service role required';end if;
  select * into v_pub from public.team_workweek_publications where id=p_publication_id;
  if not found then raise exception using errcode='P0002',message='publication not found';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_pub.owner_profile_id,0));
  select * into v_pub from public.team_workweek_publications where id=p_publication_id for update;
  if v_pub.status<>'preparing' or v_pub.attempt_generation<>p_generation or v_pub.write_journal_version=0 or (v_pub.effective_at>clock_timestamp() and (v_pub.restart_requested_at is null or v_pub.write_journal_version=0)) or exists(select 1 from public.team_workweek_provider_operations where publication_id=v_pub.id and state<>'settled' and purpose='publish') then raise exception using errcode='P0003',message='active or committed projection cannot be cleaned';end if;
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

revoke all on function public.claim_team_workweek_provider_operation(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.claim_team_workweek_provider_operation(uuid,integer,text) to service_role;
revoke all on function public.record_team_workweek_provider_write(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_team_workweek_provider_write(uuid,uuid,text) to service_role;
revoke all on function public.finish_team_workweek_provider_operation(uuid) from public,anon,authenticated;
grant execute on function public.finish_team_workweek_provider_operation(uuid) to service_role;
revoke all on function public.request_team_workweek_publication_restart(uuid,text) from public,anon,authenticated;
grant execute on function public.request_team_workweek_publication_restart(uuid,text) to service_role;
