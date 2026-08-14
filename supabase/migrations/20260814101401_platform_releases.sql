create table if not exists public.platform_releases (
  version text primary key,
  schema_version integer not null,
  summary text not null,
  published_at timestamptz not null,
  plan_digest text not null,
  content_digest text not null,
  manifest_digest text not null unique,
  manifest jsonb not null,
  created_at timestamptz not null default now(),
  constraint platform_releases_version_check check (version ~ '^v[0-9]+\.[0-9]+\.[0-9]+$'),
  constraint platform_releases_schema_version_check check (schema_version = 2),
  constraint platform_releases_summary_check check (length(trim(summary)) between 1 and 1000),
  constraint platform_releases_plan_digest_check check (plan_digest ~ '^[a-f0-9]{64}$'),
  constraint platform_releases_content_digest_check check (content_digest ~ '^[a-f0-9]{64}$'),
  constraint platform_releases_manifest_digest_check check (manifest_digest ~ '^[a-f0-9]{64}$'),
  constraint platform_releases_manifest_object_check check (jsonb_typeof(manifest) = 'object'),
  constraint platform_releases_manifest_identity_check check (
    manifest->>'version' = version
    and (manifest->>'schemaVersion')::integer = schema_version
    and manifest->>'manifestDigest' = manifest_digest
  )
);

comment on table public.platform_releases
  is 'Immutable Platform Release manifests received from the protected release runner.';
comment on column public.platform_releases.manifest
  is 'Exact validated Manifest v2 payload. Planning relationships are derived at read time.';

create index if not exists platform_releases_published_at_idx
  on public.platform_releases (published_at desc, version desc);

alter table public.platform_releases enable row level security;

create policy platform_releases_select_team
  on public.platform_releases
  for select
  to authenticated
  using (public.current_profile_id() is not null);

revoke all on table public.platform_releases from public, anon;
grant select on table public.platform_releases to authenticated;
grant select, insert on table public.platform_releases to service_role;

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
  v_existing_digest text;
  v_inserted boolean := false;
begin
  if p_manifest is null
    or jsonb_typeof(p_manifest) <> 'object'
    or (p_manifest->>'schemaVersion')::integer <> 2
    or v_version !~ '^v[0-9]+\.[0-9]+\.[0-9]+$'
    or v_digest !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid platform release manifest';
  end if;

  -- Serialize concurrent retries for one version so they resolve as replays
  -- instead of racing into the unique constraint.
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
    2,
    trim(p_manifest->>'summary'),
    (p_manifest->>'publishedAt')::timestamptz,
    trim(p_manifest->>'planDigest'),
    trim(p_manifest->>'contentDigest'),
    v_digest,
    p_manifest
  );
  v_inserted := true;

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

  return jsonb_build_object('version', v_version, 'replayed', not v_inserted);
end;
$$;

alter function public.ingest_platform_release_v1(jsonb) owner to postgres;
comment on function public.ingest_platform_release_v1(jsonb)
  is 'Atomically stores one immutable Manifest v2 and creates one in-app notification per profile.';
revoke all on function public.ingest_platform_release_v1(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_platform_release_v1(jsonb) to service_role;
