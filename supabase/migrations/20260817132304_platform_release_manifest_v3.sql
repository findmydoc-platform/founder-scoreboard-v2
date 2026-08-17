alter table public.platform_releases
  drop constraint if exists platform_releases_schema_version_check;

alter table public.platform_releases
  add constraint platform_releases_schema_version_check
  check (schema_version in (2, 3));

comment on column public.platform_releases.manifest
  is 'Exact validated Manifest v2 or v3 payload. Planning relationships are derived at read time.';

comment on table public.platform_releases
  is 'Immutable application and platform release manifests received from the protected release runner.';

create or replace function public.ingest_platform_release_v1(
  p_manifest jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version text := trim(p_manifest->>'version');
  v_digest text := trim(p_manifest->>'manifestDigest');
  v_schema_version integer := (p_manifest->>'schemaVersion')::integer;
  v_existing_digest text;
  v_inserted boolean := false;
  v_silent boolean := v_schema_version = 3 and p_manifest->>'notificationMode' = 'silent';
begin
  if p_manifest is null
    or jsonb_typeof(p_manifest) <> 'object'
    or v_schema_version not in (2, 3)
    or (
      v_schema_version = 3
      and not (
        (p_manifest->>'releaseMode' = 'application' and p_manifest->>'notificationMode' = 'silent' and p_manifest->'source'->>'kind' = 'github-release-import')
        or (p_manifest->>'releaseMode' = 'platform' and p_manifest->>'notificationMode' = 'standard' and p_manifest->'source'->>'kind' = 'native')
      )
    )
    or v_version !~ '^v[0-9]+\.[0-9]+\.[0-9]+$'
    or v_digest !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid platform release manifest';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_version, 0));

  select manifest_digest into v_existing_digest
  from public.platform_releases
  where version = v_version
  for update;

  if found then
    if v_existing_digest <> v_digest then
      raise exception using errcode = '23505', message = 'platform release version already exists with another digest';
    end if;
    return jsonb_build_object('version', v_version, 'replayed', true);
  end if;

  insert into public.platform_releases (
    version,
    schema_version,
    summary,
    published_at,
    plan_digest,
    content_digest,
    manifest_digest,
    manifest
  ) values (
    v_version,
    v_schema_version,
    trim(p_manifest->>'summary'),
    (p_manifest->>'publishedAt')::timestamptz,
    trim(p_manifest->>'planDigest'),
    trim(p_manifest->>'contentDigest'),
    v_digest,
    p_manifest
  );
  v_inserted := true;

  if not v_silent then
    insert into public.notification_events (
      type,
      recipient_profile_id,
      entity_type,
      entity_id,
      title,
      body,
      status,
      dedupe_key
    )
    select
      'platform_release.published',
      profile.id,
      'platform_release',
      v_version,
      'Neu auf der Plattform: ' || v_version,
      trim(p_manifest->>'summary'),
      'pending',
      'platform-release:' || v_digest || ':' || profile.id
    from public.profiles as profile
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;

  return jsonb_build_object('version', v_version, 'replayed', not v_inserted);
end;
$$;

alter function public.ingest_platform_release_v1(jsonb) owner to postgres;
comment on function public.ingest_platform_release_v1(jsonb)
  is 'Atomically stores one immutable Manifest v2 or v3 and creates notifications unless the manifest requests silent ingestion.';
revoke all on function public.ingest_platform_release_v1(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_platform_release_v1(jsonb) to service_role;
