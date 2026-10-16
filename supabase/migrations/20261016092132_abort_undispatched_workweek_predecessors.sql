-- Persist the modern publication failure even before Google series are materialized.
alter table public.team_workweek_publications
  add column if not exists last_error_class text;
alter table public.team_workweek_publications
  add constraint team_workweek_publication_error_class check (
    last_error_class is null or last_error_class in
      ('provider_unavailable','provider_identity_mismatch','oauth_reconnect_required','storage_failed')
  );

-- Abort only predecessor effects whose complete write journal proves no dispatch.
-- Existing provider observations and event mappings remain authoritative.
alter table public.team_workweek_publication_effects
  add column if not exists cleanup_skipped boolean not null default false;
comment on column public.team_workweek_publication_effects.cleanup_skipped is
  'Aborted without provider writes; no Google observation or restoration is implied.';
alter table public.team_workweek_publication_effects
  add constraint team_workweek_cleanup_skipped_shape check (
    not cleanup_skipped or (state='cleaned' and operation<>'create'
      and kind<>'cleanup_crossing' and cleanup_at is not null
      and not cleanup_preserved and cleanup_confirmed_etag is null)
  );

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
  -- Absence of dispatch evidence is meaningful only for journaled generations.
  -- The owner lock and cancellation fence prevent a paused publisher from sending
  -- these effects after they have been aborted. Do not invent provider observations.
  update public.team_workweek_publication_effects effect
    set state='cleaned',cleanup_skipped=true,cleanup_at=v_cutoff
    where effect.publication_id=p_publication_id and effect.generation=p_generation
      and effect.state='pending' and effect.operation<>'create' and effect.kind<>'cleanup_crossing'
      and not exists(select 1 from public.team_workweek_provider_writes write where write.effect_id=effect.id);
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
    or (p_state in ('dispatched','replaying') and exists(select 1 from public.team_workweek_publication_effects where id=p_effect_id and state='cleaned'))
    or (p_state='replaying' and (v_op.state<>'uncertain' or not exists(select 1 from public.team_workweek_provider_writes where operation_id=v_op.id and effect_id=p_effect_id and state<>'settled')))
    or (p_state='dispatched' and (v_op.state<>'active' or (v_op.purpose='publish' and v_pub.restart_requested_at is not null))) then
    raise exception using errcode='P0003',message='provider write is stale or cancelled';end if;
  if p_state='dispatched' then
    insert into public.team_workweek_provider_writes(operation_id,effect_id,state) values(v_op.id,p_effect_id,p_state);
  elsif p_state<>'replaying' then
    update public.team_workweek_provider_writes set state=p_state,updated_at=clock_timestamp() where operation_id=v_op.id and effect_id=p_effect_id and state<>'settled';
  end if;
end;$$;

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
  if v_effect.cleanup_skipped then raise exception using errcode='P0003',message='undispatched effect was aborted without provider evidence';end if;
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

revoke all on function public.prepare_team_workweek_effect_cleanup(uuid,integer) from public,anon,authenticated;
grant execute on function public.prepare_team_workweek_effect_cleanup(uuid,integer) to service_role;
revoke all on function public.record_team_workweek_provider_write(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_team_workweek_provider_write(uuid,uuid,text) to service_role;
revoke all on function public.confirm_team_workweek_planned_cleanup(uuid,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.confirm_team_workweek_planned_cleanup(uuid,integer,text,boolean) to service_role;


CREATE OR REPLACE FUNCTION "public"."delay_team_workweek_publication"("p_publication_id" "uuid", "p_error_class" "text", "p_observed_at" timestamp with time zone DEFAULT "clock_timestamp"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_publication public.team_workweek_publications%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_error_class not in ('provider_unavailable', 'provider_identity_mismatch', 'oauth_reconnect_required', 'storage_failed') then
    raise exception using errcode = '22023', message = 'publication error class is invalid';
  end if;

  select * into v_publication
  from public.team_workweek_publications
  where id = p_publication_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'team workweek publication not found';
  end if;

  if v_publication.status = 'preparing' then
    update public.team_workweek_publications
    set sync_state = 'delayed', last_error_class = p_error_class
    where id = p_publication_id
    returning * into v_publication;

    update public.team_workweek_google_series
    set last_observed_at = p_observed_at,
      last_error_class = p_error_class,
      updated_at = p_observed_at
    where publication_id = p_publication_id and state = 'pending';

    update public.team_workweek_google_series_transitions
    set last_observed_at = p_observed_at,
      last_error_class = p_error_class,
      updated_at = p_observed_at
    where activation_publication_id = p_publication_id and state = 'pending';
  end if;

  return jsonb_build_object(
    'id', v_publication.id,
    'status', v_publication.status,
    'syncState', v_publication.sync_state,
    'publishedAt', v_publication.published_at,
    'lastSyncAt', v_publication.last_sync_at,
    'publicationRevision', v_publication.publication_revision
  );
end;
$$;
revoke all on function public.delay_team_workweek_publication(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.delay_team_workweek_publication(uuid,text,timestamptz) to service_role;
