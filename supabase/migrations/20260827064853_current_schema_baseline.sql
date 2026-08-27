


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- Supabase roles.sql grants legacy default privileges before migrations run.
-- Remove them before creating application objects so a fresh baseline does not
-- broaden the final deployed ACLs.
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
  REVOKE ALL ON TABLES FROM "anon", "authenticated", "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
  REVOKE ALL ON SEQUENCES FROM "anon", "authenticated", "service_role";


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."apply_github_issue_comment_webhook_projection"("p_delivery_id" "text", "p_lock_token" "uuid", "p_operation" "text", "p_task_id" "text", "p_comment_updated_at" timestamp with time zone, "p_author_login" "text", "p_author_avatar_url" "text", "p_body" "text", "p_html_url" "text", "p_created_at" timestamp with time zone, "p_imported_at" timestamp with time zone) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_delivery public.github_webhook_deliveries%rowtype;
  v_is_stale boolean := false;
  v_mapping_count integer := 0;
  v_mapping_task_id text;
begin
  if p_operation not in ('upsert', 'suppress', 'delete') then
    raise exception using errcode = '22023', message = 'invalid Issue comment projection operation';
  end if;
  if nullif(trim(coalesce(p_task_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'task id is required';
  end if;

  select delivery.*
  into v_delivery
  from public.github_webhook_deliveries delivery
  where delivery.delivery_id = p_delivery_id
    and delivery.event_name = 'issue_comment'
    and delivery.status = 'processing'
    and delivery.lock_token = p_lock_token
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'active Issue comment delivery lock was not found';
  end if;

  if p_operation = 'delete' then
    if v_delivery.action <> 'deleted'
       or p_comment_updated_at is distinct from v_delivery.comment_updated_at then
      raise exception using errcode = '22023', message = 'only the matching deleted event can remove a GitHub comment projection';
    end if;
  elsif v_delivery.action not in ('created', 'edited')
        or p_comment_updated_at is null
        or p_comment_updated_at < v_delivery.comment_updated_at then
    raise exception using errcode = '22023', message = 'comment snapshot is older than its GitHub delivery';
  end if;

  if p_operation = 'upsert' and (
    nullif(trim(coalesce(p_author_login, '')), '') is null
    or nullif(trim(coalesce(p_body, '')), '') is null
    or nullif(trim(coalesce(p_html_url, '')), '') is null
    or p_created_at is null
    or p_imported_at is null
  ) then
    raise exception using errcode = '22023', message = 'complete comment content is required for projection';
  end if;

  select count(*)::integer, min(mapping.task_id)
  into v_mapping_count, v_mapping_task_id
  from public.resolve_github_issue_comment_webhook_tasks(
    v_delivery.repository_full_name,
    v_delivery.issue_number
  ) mapping;

  if v_mapping_count <> 1 or v_mapping_task_id <> p_task_id then
    raise exception using errcode = 'P0003', message = 'GitHub Issue task mapping changed before projection';
  end if;

  perform pg_advisory_xact_lock(v_delivery.comment_id);

  select exists (
    select 1
    from public.github_webhook_deliveries newer
    where newer.event_name = 'issue_comment'
      and newer.comment_id = v_delivery.comment_id
      and newer.delivery_id <> v_delivery.delivery_id
      and (
        newer.comment_updated_at > p_comment_updated_at
        or (
          newer.comment_updated_at = p_comment_updated_at
          and newer.action = 'deleted'
          and p_operation <> 'delete'
        )
        or (
          newer.comment_updated_at = p_comment_updated_at
          and (newer.action = 'deleted') = (p_operation = 'delete')
          and (
            newer.received_at > v_delivery.received_at
            or (
              newer.received_at = v_delivery.received_at
              and newer.delivery_id > v_delivery.delivery_id
            )
          )
        )
      )
  ) into v_is_stale;

  if v_is_stale then
    return 'stale';
  end if;

  if p_operation = 'upsert' then
    insert into public.task_external_comments (
      task_id,
      source,
      external_id,
      author_login,
      author_avatar_url,
      body,
      html_url,
      created_at,
      imported_at
    ) values (
      p_task_id,
      'github',
      v_delivery.comment_id::text,
      trim(p_author_login),
      nullif(trim(coalesce(p_author_avatar_url, '')), ''),
      trim(p_body),
      trim(p_html_url),
      p_created_at,
      p_imported_at
    )
    on conflict (source, external_id) do update
    set task_id = excluded.task_id,
        author_login = excluded.author_login,
        author_avatar_url = excluded.author_avatar_url,
        body = excluded.body,
        html_url = excluded.html_url,
        created_at = excluded.created_at,
        imported_at = excluded.imported_at;
  else
    delete from public.task_external_comments external_comment
    where external_comment.source = 'github'
      and external_comment.external_id = v_delivery.comment_id::text;
  end if;

  return 'applied';
end;
$$;


ALTER FUNCTION "public"."apply_github_issue_comment_webhook_projection"("p_delivery_id" "text", "p_lock_token" "uuid", "p_operation" "text", "p_task_id" "text", "p_comment_updated_at" timestamp with time zone, "p_author_login" "text", "p_author_avatar_url" "text", "p_body" "text", "p_html_url" "text", "p_created_at" timestamp with time zone, "p_imported_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."apply_github_issue_comment_webhook_projection"("p_delivery_id" "text", "p_lock_token" "uuid", "p_operation" "text", "p_task_id" "text", "p_comment_updated_at" timestamp with time zone, "p_author_login" "text", "p_author_avatar_url" "text", "p_body" "text", "p_html_url" "text", "p_created_at" timestamp with time zone, "p_imported_at" timestamp with time zone) IS 'Atomically applies the latest verified GitHub comment state. The durable delivery journal orders concurrent snapshots, and a deleted event wins at the same GitHub version.';



CREATE OR REPLACE FUNCTION "public"."apply_github_issue_comment_webhook_projection_with_mentions"("p_delivery_id" "text", "p_lock_token" "uuid", "p_operation" "text", "p_task_id" "text", "p_comment_updated_at" timestamp with time zone, "p_author_login" "text", "p_author_avatar_url" "text", "p_body" "text", "p_html_url" "text", "p_created_at" timestamp with time zone, "p_imported_at" timestamp with time zone, "p_actor_profile_id" "text" DEFAULT NULL::"text", "p_mention_recipient_profile_ids" "text"[] DEFAULT '{}'::"text"[], "p_baseline_mention_recipient_profile_ids" "text"[] DEFAULT '{}'::"text"[], "p_baseline_source_updated_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_delivery public.github_webhook_deliveries%rowtype;
  v_task public.tasks%rowtype;
  v_is_stale boolean := false;
  v_mapping_count integer := 0;
  v_mapping_task_id text;
  v_existing public.task_external_comments%rowtype;
  v_existing_found boolean;
  v_previous_recipient_profile_ids text[];
  v_current_recipient_profile_ids text[];
begin
  if p_operation not in ('upsert', 'suppress', 'delete') then
    raise exception using errcode = '22023', message = 'invalid Issue comment projection operation';
  end if;
  if nullif(trim(coalesce(p_task_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'task id is required';
  end if;

  select delivery.* into v_delivery
  from public.github_webhook_deliveries delivery
  where delivery.delivery_id = p_delivery_id
    and delivery.event_name = 'issue_comment'
    and delivery.status = 'processing'
    and delivery.lock_token = p_lock_token
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'active Issue comment delivery lock was not found';
  end if;

  if p_operation = 'delete' then
    if v_delivery.action <> 'deleted' or p_comment_updated_at is distinct from v_delivery.comment_updated_at then
      raise exception using errcode = '22023', message = 'only the matching deleted event can remove a GitHub comment projection';
    end if;
  elsif v_delivery.action not in ('created', 'edited')
    or p_comment_updated_at is null
    or p_comment_updated_at < v_delivery.comment_updated_at
  then
    raise exception using errcode = '22023', message = 'comment snapshot is older than its GitHub delivery';
  end if;

  if p_operation = 'upsert' and (
    nullif(trim(coalesce(p_author_login, '')), '') is null
    or nullif(trim(coalesce(p_body, '')), '') is null
    or nullif(trim(coalesce(p_html_url, '')), '') is null
    or p_created_at is null
    or p_imported_at is null
  ) then
    raise exception using errcode = '22023', message = 'complete comment content is required for projection';
  end if;

  select count(*)::integer, min(mapping.task_id)
  into v_mapping_count, v_mapping_task_id
  from public.resolve_github_issue_comment_webhook_tasks(v_delivery.repository_full_name, v_delivery.issue_number) mapping;
  if v_mapping_count <> 1 or v_mapping_task_id <> p_task_id then
    raise exception using errcode = 'P0003', message = 'GitHub Issue task mapping changed before projection';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  perform pg_advisory_xact_lock(hashtextextended('github:' || v_delivery.comment_id::text, 0));

  select exists (
    select 1 from public.github_webhook_deliveries newer
    where newer.event_name = 'issue_comment'
      and newer.comment_id = v_delivery.comment_id
      and newer.delivery_id <> v_delivery.delivery_id
      and (
        newer.comment_updated_at > p_comment_updated_at
        or (newer.comment_updated_at = p_comment_updated_at and newer.action = 'deleted' and p_operation <> 'delete')
        or (
          newer.comment_updated_at = p_comment_updated_at
          and (newer.action = 'deleted') = (p_operation = 'delete')
          and (newer.received_at > v_delivery.received_at
            or (newer.received_at = v_delivery.received_at and newer.delivery_id > v_delivery.delivery_id))
        )
      )
  ) into v_is_stale;
  if v_is_stale then return 'stale'; end if;

  select * into v_existing
  from public.task_external_comments
  where source = 'github' and external_id = v_delivery.comment_id::text
  for update;
  v_existing_found := found;
  if v_existing_found and p_comment_updated_at < v_existing.source_updated_at then
    return 'stale';
  end if;

  if p_operation = 'upsert' then
    select coalesce(array_agg(recipient_id order by recipient_id), '{}')
    into v_current_recipient_profile_ids
    from (
      select distinct nullif(trim(recipient_id), '') as recipient_id
      from unnest(coalesce(p_mention_recipient_profile_ids, '{}')) recipient_id
    ) recipients
    where recipient_id is not null;

    if not v_existing_found then
      v_previous_recipient_profile_ids := '{}';
    elsif v_existing.mention_recipients_initialized then
      v_previous_recipient_profile_ids := v_existing.mention_recipient_profile_ids;
    else
      if p_baseline_source_updated_at is distinct from v_existing.source_updated_at then
        raise exception using errcode = '40001', message = 'GitHub comment mention baseline changed before webhook projection';
      end if;
      select coalesce(array_agg(recipient_id order by recipient_id), '{}')
      into v_previous_recipient_profile_ids
      from (
        select distinct nullif(trim(recipient_id), '') as recipient_id
        from unnest(coalesce(p_baseline_mention_recipient_profile_ids, '{}')) recipient_id
      ) recipients
      where recipient_id is not null;
    end if;

    insert into public.task_external_comments (
      task_id, source, external_id, author_login, author_avatar_url, body,
      html_url, created_at, source_updated_at, imported_at,
      mention_recipient_profile_ids, mention_recipients_initialized
    ) values (
      p_task_id, 'github', v_delivery.comment_id::text, trim(p_author_login),
      nullif(trim(coalesce(p_author_avatar_url, '')), ''), trim(p_body), trim(p_html_url),
      p_created_at, p_comment_updated_at, p_imported_at,
      v_current_recipient_profile_ids, true
    )
    on conflict (source, external_id) do update
    set task_id = excluded.task_id,
        author_login = excluded.author_login,
        author_avatar_url = excluded.author_avatar_url,
        body = excluded.body,
        html_url = excluded.html_url,
        created_at = excluded.created_at,
        source_updated_at = excluded.source_updated_at,
        imported_at = excluded.imported_at,
        mention_recipient_profile_ids = excluded.mention_recipient_profile_ids,
        mention_recipients_initialized = true;

    if v_task.github_comment_notifications_after is not null
      and p_comment_updated_at >= v_task.github_comment_notifications_after
    then
      insert into public.notification_events (
        type, actor_profile_id, actor_label, recipient_profile_id, entity_type, entity_id,
        title, body, dedupe_key, target_path
      )
      select
        'task.mention', nullif(trim(coalesce(p_actor_profile_id, '')), ''), trim(p_author_login),
        recipient_id, 'task', p_task_id,
        '@' || trim(p_author_login) || ' hat dich erwähnt: ' || v_task.title, trim(p_body),
        'task.mention:github:' || v_delivery.comment_id || ':' || recipient_id,
        '/tasks/' || p_task_id || '?comment=github:' || v_delivery.comment_id
      from unnest(v_current_recipient_profile_ids) recipient_id
      where nullif(trim(recipient_id), '') is not null
        and not (recipient_id = any(v_previous_recipient_profile_ids))
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
  else
    delete from public.task_external_comments external_comment
    where external_comment.source = 'github'
      and external_comment.external_id = v_delivery.comment_id::text;
  end if;

  return 'applied';
end;
$$;


ALTER FUNCTION "public"."apply_github_issue_comment_webhook_projection_with_mentions"("p_delivery_id" "text", "p_lock_token" "uuid", "p_operation" "text", "p_task_id" "text", "p_comment_updated_at" timestamp with time zone, "p_author_login" "text", "p_author_avatar_url" "text", "p_body" "text", "p_html_url" "text", "p_created_at" timestamp with time zone, "p_imported_at" timestamp with time zone, "p_actor_profile_id" "text", "p_mention_recipient_profile_ids" "text"[], "p_baseline_mention_recipient_profile_ids" "text"[], "p_baseline_source_updated_at" timestamp with time zone) OWNER TO "postgres";


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
        where key not in ('seriesId', 'priorEtag', 'observedEtag', 'founderopsRevision', 'providerState')
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

    update public.team_workweek_google_series
    set confirmed_etag = v_observed_etag,
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


ALTER FUNCTION "public"."apply_google_team_workweek_observations"("p_publication_id" "uuid", "p_publication_revision" integer, "p_observations" "jsonb", "p_observed_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_profile_color_change"("p_profile_id" "text", "p_requested_color" "text", "p_duplicate_mode_observed" boolean) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_current_color text;
  v_palette text[] := public.profile_color_palette();
  v_palette_full boolean;
begin
  if p_requested_color is null or not (p_requested_color = any (v_palette)) then
    raise exception using errcode = '22023', message = 'profile color is not in the configured palette';
  end if;
  if p_duplicate_mode_observed is null then
    raise exception using errcode = '22023', message = 'profile color duplicate mode is required';
  end if;

  lock table public.profiles in row exclusive mode;
  perform pg_catalog.pg_advisory_xact_lock(59301, 384);

  select profile.profile_color
  into v_current_color
  from public.profiles as profile
  where profile.id = p_profile_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'profile not found';
  end if;
  if v_current_color = p_requested_color then
    return v_current_color;
  end if;

  select count(distinct profile.profile_color) = cardinality(v_palette)
  into v_palette_full
  from public.profiles as profile
  where profile.profile_color = any (v_palette);

  if p_duplicate_mode_observed and not v_palette_full then
    raise exception using errcode = 'P0001', message = 'profile color duplicate mode is stale';
  end if;

  if not (v_palette_full and p_duplicate_mode_observed) and exists (
    select 1
    from public.profiles as profile
    where profile.id <> p_profile_id
      and profile.profile_color = p_requested_color
  ) then
    raise exception using errcode = 'P0001', message = 'profile color is already occupied';
  end if;

  update public.profiles
  set profile_color = p_requested_color
  where id = p_profile_id;

  return p_requested_color;
end;
$$;


ALTER FUNCTION "public"."apply_profile_color_change"("p_profile_id" "text", "p_requested_color" "text", "p_duplicate_mode_observed" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assert_github_delivery_task_capability"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_task_type text;
begin
  select task_type into v_task_type from public.tasks where id = new.task_id;
  if v_task_type in ('epic', 'initiative') then
    raise exception using errcode = '23514', message = 'strategic planning items cannot create GitHub delivery records';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."assert_github_delivery_task_capability"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_backlog_tasks_to_sprint_transaction"("p_assignments" "jsonb", "p_sprint_id" "text", "p_actor_profile_id" "text" DEFAULT NULL::"text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_assignment jsonb;
  v_assignment_count integer;
  v_task_ids text[];
  v_actor_role text;
  v_task public.tasks%rowtype;
  v_before public.tasks%rowtype;
  v_updated public.tasks%rowtype;
  v_target_sprint public.sprints%rowtype;
  v_source_locked boolean;
  v_updates jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_assignments) <> 'array' then
    raise exception using errcode = '22023', message = 'assignments must be an array';
  end if;

  v_assignment_count := jsonb_array_length(p_assignments);
  if v_assignment_count < 1 or v_assignment_count > 100 then
    raise exception using errcode = '22023', message = 'assignments must contain between 1 and 100 tasks';
  end if;
  if nullif(trim(p_sprint_id), '') is null then
    raise exception using errcode = '22023', message = 'target sprint is required';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_assignments) as assignment(value)
    where jsonb_typeof(assignment.value) <> 'object'
      or nullif(trim(assignment.value ->> 'taskId'), '') is null
      or nullif(trim(assignment.value ->> 'expectedUpdatedAt'), '') is null
  ) then
    raise exception using errcode = '22023', message = 'assignment entries are invalid';
  end if;

  select profile.platform_role into v_actor_role
  from public.profiles as profile
  where profile.id = nullif(trim(coalesce(p_actor_profile_id, '')), '');
  if not found or v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0015', message = 'sprint assignment requires ceo or deputy';
  end if;

  select array_agg(task_id order by task_id)
  into v_task_ids
  from (
    select distinct assignment.value ->> 'taskId' as task_id
    from jsonb_array_elements(p_assignments) as assignment(value)
  ) as distinct_tasks;
  if cardinality(v_task_ids) <> v_assignment_count then
    raise exception using errcode = '22023', message = 'assignment task ids must be unique';
  end if;

  select sprint.*
  into v_target_sprint
  from public.sprints as sprint
  where sprint.id = p_sprint_id
  for share;
  if not found then
    raise exception using errcode = 'P0004', message = 'target sprint not found';
  end if;
  if v_target_sprint.score_locked then
    raise exception using errcode = 'P0005', message = 'target sprint is locked';
  end if;

  perform 1
  from public.tasks as task
  where task.id = any(v_task_ids)
  order by task.id
  for update;

  for v_assignment in
    select assignment.value
    from jsonb_array_elements(p_assignments) as assignment(value)
    order by assignment.value ->> 'taskId'
  loop
    select task.*
    into v_task
    from public.tasks as task
    where task.id = v_assignment ->> 'taskId';
    if not found or v_task.trashed_at is not null then
      raise exception using errcode = 'P0002', message = 'task not found';
    end if;
    if v_task.updated_at <> (v_assignment ->> 'expectedUpdatedAt')::timestamptz then
      raise exception using errcode = 'P0001', message = 'task was changed concurrently';
    end if;
    if v_task.task_type <> 'deliverable' then
      raise exception using errcode = 'P0010', message = 'only deliverables may be assigned to sprints';
    end if;
    if v_task.approval_status <> 'approved' then
      raise exception using errcode = 'P0011', message = 'deliverable approval is required';
    end if;
    if v_task.status = 'Erledigt' then
      raise exception using errcode = 'P0012', message = 'completed deliverables cannot be assigned';
    end if;
    if coalesce(nullif(trim(v_task.assignee), ''), nullif(trim(v_task.owner), '')) is null then
      raise exception using errcode = 'P0013', message = 'deliverable owner is required';
    end if;
    if v_task.parent_task_id is null or not exists (
      select 1
      from public.tasks as parent
      where parent.id = v_task.parent_task_id
        and parent.task_type = 'initiative'
        and parent.approval_status = 'approved'
        and parent.trashed_at is null
    ) then
      raise exception using errcode = 'P0014', message = 'approved deliverable initiative is required';
    end if;

    if v_task.sprint_id is not null and v_task.sprint_id <> p_sprint_id then
      select sprint.score_locked
      into v_source_locked
      from public.sprints as sprint
      where sprint.id = v_task.sprint_id
      for share;
      if not found then
        raise exception using errcode = 'P0006', message = 'source sprint not found';
      end if;
      if v_source_locked then
        raise exception using errcode = 'P0007', message = 'source sprint is locked';
      end if;
    end if;
  end loop;

  for v_assignment in
    select assignment.value
    from jsonb_array_elements(p_assignments) as assignment(value)
    order by assignment.value ->> 'taskId'
  loop
    select task.*
    into v_before
    from public.tasks as task
    where task.id = v_assignment ->> 'taskId';

    if v_before.sprint_id is distinct from p_sprint_id then
      update public.tasks as task
      set sprint_id = p_sprint_id,
          score_relevant = true,
          updated_at = clock_timestamp()
      where task.id = v_before.id
      returning task.* into v_updated;

      insert into public.audit_log (
        actor_profile_id,
        action,
        entity_type,
        entity_id,
        before_data,
        after_data,
        request_ip,
        user_agent
      ) values (
        p_actor_profile_id,
        'task.sprint.bulk_assigned',
        'task',
        v_before.id,
        jsonb_build_object(
          'sprintId', v_before.sprint_id,
          'scoreRelevant', v_before.score_relevant,
          'updatedAt', v_before.updated_at
        ),
        jsonb_build_object(
          'sprintId', v_updated.sprint_id,
          'scoreRelevant', v_updated.score_relevant,
          'updatedAt', v_updated.updated_at
        ),
        p_request_ip,
        p_user_agent
      );
    else
      v_updated := v_before;
    end if;

    v_updates := v_updates || jsonb_build_array(jsonb_build_object(
      'id', v_updated.id,
      'sprintId', v_updated.sprint_id,
      'scoreRelevant', v_updated.score_relevant,
      'updatedAt', v_updated.updated_at
    ));
  end loop;

  return v_updates;
end;
$$;


ALTER FUNCTION "public"."assign_backlog_tasks_to_sprint_transaction"("p_assignments" "jsonb", "p_sprint_id" "text", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."assign_backlog_tasks_to_sprint_transaction"("p_assignments" "jsonb", "p_sprint_id" "text", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") IS 'Atomically assigns up to 100 eligible Deliverables to one unlocked Sprint with compare-and-set protection, authoritative actor validation, and per-item audit history.';



CREATE OR REPLACE FUNCTION "public"."assign_profile_color_on_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_existing_color text;
begin
  perform pg_catalog.pg_advisory_xact_lock(59301, 384);

  select profile.profile_color
  into v_existing_color
  from public.profiles as profile
  where profile.id = new.id;

  if found then
    new.profile_color := v_existing_color;
    return new;
  end if;

  select palette.color
  into new.profile_color
  from unnest(public.profile_color_palette()) with ordinality as palette(color, position)
  left join public.profiles as profile on profile.profile_color = palette.color
  group by palette.color, palette.position
  order by count(profile.id), palette.position
  limit 1;

  if new.profile_color is null then
    raise exception using errcode = '22023', message = 'profile color palette is empty';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."assign_profile_color_on_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."authenticate_team_planning_items_token"("p_token_hash" "text", "p_scope" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_profile public.profiles%rowtype;
  v_evaluated_at timestamptz := statement_timestamp();
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_scope is null
     or p_scope not in (
       'read:planning-context',
       'write:planning-items:create',
       'write:planning-items:update',
       'write:planning-items:delete-empty',
       'write:planning-items:github-sync'
     ) then
    raise exception using errcode = '22023', message = 'planning items authentication input is invalid';
  end if;

  select * into v_token
  from public.team_task_intake_tokens
  where token_hash = p_token_hash
    and revoked_at is null
    and expires_at > v_evaluated_at
  for update;

  if not found then
    raise exception using errcode = 'P0004', message = 'planning items token is inactive';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_token.profile_id
  for share;

  if not found or v_profile.platform_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'planning items profile role is not allowed';
  end if;
  if p_scope = 'write:planning-items:delete-empty'
     and v_profile.platform_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'epic deletion requires ceo or deputy';
  end if;

  update public.team_task_intake_tokens
  set last_used_at = v_evaluated_at
  where id = v_token.id;

  return jsonb_build_object(
    'tokenId', v_token.id,
    'tokenHint', v_token.token_hint,
    'scopes', v_token.scopes,
    'scopeGranted', p_scope = any(v_token.scopes),
    'expiresAt', v_token.expires_at,
    'evaluatedAt', v_evaluated_at,
    'remainingSeconds', greatest(
      0,
      floor(extract(epoch from (v_token.expires_at - v_evaluated_at)))
    )::bigint,
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'name', v_profile.name,
      'platformRole', v_profile.platform_role,
      'githubLogin', coalesce(v_profile.github_login, '')
    )
  );
end;
$_$;


ALTER FUNCTION "public"."authenticate_team_planning_items_token"("p_token_hash" "text", "p_scope" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."authenticate_team_task_intake_token"("p_token_hash" "text", "p_scope" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_profile public.profiles%rowtype;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_scope not in ('read:task-context', 'write:task-intake') then
    raise exception using errcode = '22023', message = 'team intake authentication input is invalid';
  end if;

  select *
  into v_token
  from public.team_task_intake_tokens
  where token_hash = p_token_hash
    and revoked_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception using errcode = 'P0004', message = 'team intake token is inactive';
  end if;
  if not (p_scope = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'team intake scope is missing';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_token.profile_id
  for share;

  if not found or v_profile.platform_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'team intake profile role is not allowed';
  end if;

  update public.team_task_intake_tokens
  set last_used_at = now()
  where id = v_token.id;

  return jsonb_build_object(
    'tokenId', v_token.id,
    'scopes', v_token.scopes,
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'name', v_profile.name,
      'platformRole', v_profile.platform_role,
      'githubLogin', coalesce(v_profile.github_login, '')
    )
  );
end;
$_$;


ALTER FUNCTION "public"."authenticate_team_task_intake_token"("p_token_hash" "text", "p_scope" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."authenticate_team_task_intake_token"("p_token_hash" "text", "p_scope" "text") IS 'Atomically validates a personal token, current profile role and scope while recording last use.';



CREATE OR REPLACE FUNCTION "public"."begin_github_issue_sync_transaction"("p_task_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task jsonb;
begin
  update public.tasks
  set github_issue_sync_status = 'pending',
      github_issue_sync_error = null,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning to_jsonb(tasks) into v_task;

  if v_task is null then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  return v_task;
end;
$$;


ALTER FUNCTION "public"."begin_github_issue_sync_transaction"("p_task_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."begin_github_issue_sync_transaction_v2"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task jsonb;
begin
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'expected task revision is required';
  end if;

  update public.tasks
  set github_issue_sync_status = 'pending',
      github_issue_sync_error = null,
      updated_at = clock_timestamp()
  where id = p_task_id
    and updated_at = p_expected_updated_at
  returning to_jsonb(tasks) into v_task;

  if v_task is null then
    if exists (select 1 from public.tasks where id = p_task_id) then
      raise exception using errcode = 'P0001', message = 'task was changed concurrently';
    end if;
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  return v_task;
end;
$$;


ALTER FUNCTION "public"."begin_github_issue_sync_transaction_v2"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."begin_github_issue_sync_transaction_v2"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone) IS 'Starts GitHub issue sync only when the task revision still matches.';



CREATE OR REPLACE FUNCTION "public"."cancel_task_deletion_transaction"("p_operation_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_operation public.task_deletion_operations%rowtype;
begin
  select * into v_operation
  from public.task_deletion_operations
  where id = p_operation_id
  for update;

  if v_operation.id is null then
    return jsonb_build_object('cancelled', true);
  end if;

  if v_operation.status = 'completed' then
    return jsonb_build_object(
      'cancelled', false,
      'status', v_operation.status,
      'task', v_operation.task_snapshot
    );
  end if;

  delete from public.task_deletion_operations where id = v_operation.id;

  return jsonb_build_object(
    'cancelled', true,
    'status', 'cancelled',
    'task', v_operation.task_snapshot
  );
end;
$$;


ALTER FUNCTION "public"."cancel_task_deletion_transaction"("p_operation_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cancel_task_deletion_transaction"("p_operation_id" "uuid") IS 'Cancels an unfinished task deletion operation after an external side-effect failure.';



CREATE OR REPLACE FUNCTION "public"."claim_github_issue_comment_webhook_delivery"("p_delivery_id" "text", "p_lock_token" "uuid", "p_lease_seconds" integer DEFAULT 120) RETURNS TABLE("delivery_id" "text", "action" "text", "repository_full_name" "text", "issue_number" integer, "comment_id" bigint, "comment_updated_at" timestamp with time zone, "attempts" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_lease interval := make_interval(
    secs => least(greatest(coalesce(p_lease_seconds, 120), 30), 900)
  );
begin
  if nullif(trim(coalesce(p_delivery_id, '')), '') is null or p_lock_token is null then
    raise exception using errcode = '22023', message = 'delivery id and lock token are required';
  end if;

  return query
  update public.github_webhook_deliveries delivery
  set status = 'processing',
      status_reason = null,
      attempts = delivery.attempts + 1,
      locked_at = clock_timestamp(),
      lock_token = p_lock_token,
      processed_at = null,
      last_error = null,
      updated_at = clock_timestamp()
  where delivery.delivery_id = p_delivery_id
    and delivery.event_name = 'issue_comment'
    and delivery.archived_at is null
    and (
      delivery.status in ('received', 'retry_scheduled', 'failed')
      or (
        delivery.status = 'processing'
        and delivery.locked_at < clock_timestamp() - v_lease
      )
    )
  returning
    delivery.delivery_id,
    delivery.action,
    delivery.repository_full_name,
    delivery.issue_number,
    delivery.comment_id,
    delivery.comment_updated_at,
    delivery.attempts;
end;
$$;


ALTER FUNCTION "public"."claim_github_issue_comment_webhook_delivery"("p_delivery_id" "text", "p_lock_token" "uuid", "p_lease_seconds" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_github_issue_comment_webhook_delivery"("p_delivery_id" "text", "p_lock_token" "uuid", "p_lease_seconds" integer) IS 'Claims one verified Issue comment delivery for idempotent projection. Exact redelivery can recover retryable, failed, or stale processing rows unless an operator archived the delivery; archived failures remain retained and are never reclaimed.';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."github_planning_webhook_deliveries" (
    "delivery_id" "text" NOT NULL,
    "event_name" "text" NOT NULL,
    "action" "text" NOT NULL,
    "installation_id" bigint,
    "organization_id" bigint,
    "organization_login" "text",
    "repository_id" bigint,
    "repository_full_name" "text",
    "issue_id" bigint,
    "issue_node_id" "text",
    "issue_number" integer,
    "issue_updated_at" timestamp with time zone,
    "related_repository_id" bigint,
    "related_repository_full_name" "text",
    "related_issue_id" bigint,
    "related_issue_node_id" "text",
    "related_issue_number" integer,
    "related_issue_updated_at" timestamp with time zone,
    "project_node_id" "text",
    "project_item_node_id" "text",
    "project_item_updated_at" timestamp with time zone,
    "project_content_node_id" "text",
    "project_content_type" "text",
    "project_field_node_id" "text",
    "changed_fields" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "target_user_id" bigint,
    "target_user_login" "text",
    "sender_id" bigint,
    "sender_login" "text",
    "sender_type" "text",
    "payload_sha256" "text" NOT NULL,
    "status" "text" DEFAULT 'received'::"text" NOT NULL,
    "status_reason" "text",
    "processing_version" integer DEFAULT 1 NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "available_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "locked_at" timestamp with time zone,
    "lock_token" "uuid",
    "processed_at" timestamp with time zone,
    "last_error" "text",
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    "archive_reason" "text",
    CONSTRAINT "github_planning_webhook_deliveries_action_check" CHECK (((NULLIF(TRIM(BOTH FROM "action"), ''::"text") IS NOT NULL) AND ("length"("action") <= 64))),
    CONSTRAINT "github_planning_webhook_deliveries_archive_check" CHECK (((("archived_at" IS NULL) AND ("archive_reason" IS NULL)) OR (("archived_at" IS NOT NULL) AND (NULLIF(TRIM(BOTH FROM "archive_reason"), ''::"text") IS NOT NULL) AND ("length"("archive_reason") <= 120)))),
    CONSTRAINT "github_planning_webhook_deliveries_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "github_planning_webhook_deliveries_changed_fields_check" CHECK ((("cardinality"("changed_fields") >= 0) AND ("cardinality"("changed_fields") <= 20))),
    CONSTRAINT "github_planning_webhook_deliveries_delivery_id_check" CHECK (((NULLIF(TRIM(BOTH FROM "delivery_id"), ''::"text") IS NOT NULL) AND ("length"("delivery_id") <= 128))),
    CONSTRAINT "github_planning_webhook_deliveries_event_name_check" CHECK (("event_name" = ANY (ARRAY['issues'::"text", 'sub_issues'::"text", 'issue_dependencies'::"text", 'projects_v2_item'::"text"]))),
    CONSTRAINT "github_planning_webhook_deliveries_installation_id_check" CHECK ((("installation_id" IS NULL) OR ("installation_id" > 0))),
    CONSTRAINT "github_planning_webhook_deliveries_issue_id_check" CHECK ((("issue_id" IS NULL) OR ("issue_id" > 0))),
    CONSTRAINT "github_planning_webhook_deliveries_issue_node_id_check" CHECK ((("issue_node_id" IS NULL) OR ((NULLIF(TRIM(BOTH FROM "issue_node_id"), ''::"text") IS NOT NULL) AND ("length"("issue_node_id") <= 255)))),
    CONSTRAINT "github_planning_webhook_deliveries_issue_number_check" CHECK ((("issue_number" IS NULL) OR ("issue_number" > 0))),
    CONSTRAINT "github_planning_webhook_deliveries_lock_check" CHECK (((("status" = 'processing'::"text") AND ("locked_at" IS NOT NULL) AND ("lock_token" IS NOT NULL)) OR (("status" <> 'processing'::"text") AND ("locked_at" IS NULL) AND ("lock_token" IS NULL)))),
    CONSTRAINT "github_planning_webhook_deliveries_organization_id_check" CHECK ((("organization_id" IS NULL) OR ("organization_id" > 0))),
    CONSTRAINT "github_planning_webhook_deliveries_organization_login_check" CHECK ((("organization_login" IS NULL) OR ((NULLIF(TRIM(BOTH FROM "organization_login"), ''::"text") IS NOT NULL) AND ("length"("organization_login") <= 255)))),
    CONSTRAINT "github_planning_webhook_deliveries_payload_sha256_check" CHECK (("payload_sha256" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "github_planning_webhook_deliveries_processed_check" CHECK (((("status" = 'processed'::"text") AND ("processed_at" IS NOT NULL)) OR (("status" <> 'processed'::"text") AND ("processed_at" IS NULL)))),
    CONSTRAINT "github_planning_webhook_deliveries_processing_version_check" CHECK (("processing_version" >= 1)),
    CONSTRAINT "github_planning_webhook_deliveries_project_content_node_id_chec" CHECK ((("project_content_node_id" IS NULL) OR ((NULLIF(TRIM(BOTH FROM "project_content_node_id"), ''::"text") IS NOT NULL) AND ("length"("project_content_node_id") <= 255)))),
    CONSTRAINT "github_planning_webhook_deliveries_project_content_type_check" CHECK ((("project_content_type" IS NULL) OR ("project_content_type" = 'Issue'::"text"))),
    CONSTRAINT "github_planning_webhook_deliveries_project_field_node_id_check" CHECK ((("project_field_node_id" IS NULL) OR ((NULLIF(TRIM(BOTH FROM "project_field_node_id"), ''::"text") IS NOT NULL) AND ("length"("project_field_node_id") <= 255)))),
    CONSTRAINT "github_planning_webhook_deliveries_project_item_node_id_check" CHECK ((("project_item_node_id" IS NULL) OR ((NULLIF(TRIM(BOTH FROM "project_item_node_id"), ''::"text") IS NOT NULL) AND ("length"("project_item_node_id") <= 255)))),
    CONSTRAINT "github_planning_webhook_deliveries_project_node_id_check" CHECK ((("project_node_id" IS NULL) OR ((NULLIF(TRIM(BOTH FROM "project_node_id"), ''::"text") IS NOT NULL) AND ("length"("project_node_id") <= 255)))),
    CONSTRAINT "github_planning_webhook_deliveries_related_issue_id_check" CHECK ((("related_issue_id" IS NULL) OR ("related_issue_id" > 0))),
    CONSTRAINT "github_planning_webhook_deliveries_related_issue_node_id_check" CHECK ((("related_issue_node_id" IS NULL) OR ((NULLIF(TRIM(BOTH FROM "related_issue_node_id"), ''::"text") IS NOT NULL) AND ("length"("related_issue_node_id") <= 255)))),
    CONSTRAINT "github_planning_webhook_deliveries_related_issue_number_check" CHECK ((("related_issue_number" IS NULL) OR ("related_issue_number" > 0))),
    CONSTRAINT "github_planning_webhook_deliveries_related_repository_check" CHECK ((("related_repository_full_name" IS NULL) OR ((NULLIF(TRIM(BOTH FROM "related_repository_full_name"), ''::"text") IS NOT NULL) AND ("length"("related_repository_full_name") <= 255)))),
    CONSTRAINT "github_planning_webhook_deliveries_related_repository_id_check" CHECK ((("related_repository_id" IS NULL) OR ("related_repository_id" > 0))),
    CONSTRAINT "github_planning_webhook_deliveries_repository_check" CHECK ((("repository_full_name" IS NULL) OR ((NULLIF(TRIM(BOTH FROM "repository_full_name"), ''::"text") IS NOT NULL) AND ("length"("repository_full_name") <= 255)))),
    CONSTRAINT "github_planning_webhook_deliveries_repository_id_check" CHECK ((("repository_id" IS NULL) OR ("repository_id" > 0))),
    CONSTRAINT "github_planning_webhook_deliveries_resource_shape_check" CHECK (((("event_name" = 'issues'::"text") AND ("installation_id" IS NOT NULL) AND ("repository_id" IS NOT NULL) AND ("repository_full_name" IS NOT NULL) AND ("issue_id" IS NOT NULL) AND ("issue_node_id" IS NOT NULL) AND ("issue_number" IS NOT NULL) AND ("issue_updated_at" IS NOT NULL) AND ("related_issue_id" IS NULL) AND ("related_issue_updated_at" IS NULL) AND ("project_item_node_id" IS NULL) AND ("project_item_updated_at" IS NULL) AND ("project_content_node_id" IS NULL)) OR (("event_name" = ANY (ARRAY['sub_issues'::"text", 'issue_dependencies'::"text"])) AND ("installation_id" IS NOT NULL) AND ("repository_id" IS NOT NULL) AND ("repository_full_name" IS NOT NULL) AND ("issue_id" IS NOT NULL) AND ("issue_node_id" IS NOT NULL) AND ("issue_number" IS NOT NULL) AND ("issue_updated_at" IS NOT NULL) AND ("related_repository_id" IS NOT NULL) AND ("related_repository_full_name" IS NOT NULL) AND ("related_issue_id" IS NOT NULL) AND ("related_issue_node_id" IS NOT NULL) AND ("related_issue_number" IS NOT NULL) AND ("related_issue_updated_at" IS NOT NULL) AND ("project_item_node_id" IS NULL) AND ("project_item_updated_at" IS NULL) AND ("project_content_node_id" IS NULL)) OR (("event_name" = 'projects_v2_item'::"text") AND ("organization_id" IS NOT NULL) AND ("organization_login" IS NOT NULL) AND ("project_node_id" IS NOT NULL) AND ("project_item_node_id" IS NOT NULL) AND ("project_item_updated_at" IS NOT NULL) AND ("project_content_node_id" IS NOT NULL) AND ("project_content_type" = 'Issue'::"text") AND ((("action" = 'edited'::"text") AND ("project_field_node_id" IS NOT NULL)) OR (("action" <> 'edited'::"text") AND ("project_field_node_id" IS NULL)))))),
    CONSTRAINT "github_planning_webhook_deliveries_sender_id_check" CHECK ((("sender_id" IS NULL) OR ("sender_id" > 0))),
    CONSTRAINT "github_planning_webhook_deliveries_sender_login_check" CHECK ((("sender_login" IS NULL) OR ((NULLIF(TRIM(BOTH FROM "sender_login"), ''::"text") IS NOT NULL) AND ("length"("sender_login") <= 255)))),
    CONSTRAINT "github_planning_webhook_deliveries_sender_type_check" CHECK ((("sender_type" IS NULL) OR ((NULLIF(TRIM(BOTH FROM "sender_type"), ''::"text") IS NOT NULL) AND ("length"("sender_type") <= 64)))),
    CONSTRAINT "github_planning_webhook_deliveries_status_check" CHECK (("status" = ANY (ARRAY['received'::"text", 'processing'::"text", 'retry_scheduled'::"text", 'processed'::"text", 'ignored'::"text", 'failed'::"text"]))),
    CONSTRAINT "github_planning_webhook_deliveries_status_reason_check" CHECK ((("status_reason" IS NULL) OR ((NULLIF(TRIM(BOTH FROM "status_reason"), ''::"text") IS NOT NULL) AND ("length"("status_reason") <= 120)))),
    CONSTRAINT "github_planning_webhook_deliveries_target_user_check" CHECK (((("target_user_id" IS NULL) AND ("target_user_login" IS NULL)) OR (("target_user_id" > 0) AND (NULLIF(TRIM(BOTH FROM "target_user_login"), ''::"text") IS NOT NULL) AND ("length"("target_user_login") <= 255))))
);


ALTER TABLE "public"."github_planning_webhook_deliveries" OWNER TO "postgres";


COMMENT ON TABLE "public"."github_planning_webhook_deliveries" IS 'Verified GitHub planning change journal. Stores stable resource identities, changed field names, and a payload hash, never Issue content.';



COMMENT ON COLUMN "public"."github_planning_webhook_deliveries"."changed_fields" IS 'Bounded names of fields reported as changed. Values are reloaded from GitHub before processing.';



COMMENT ON COLUMN "public"."github_planning_webhook_deliveries"."sender_id" IS 'Stable GitHub user id proposed as the human actor. GitHub App identity is never authorization.';



COMMENT ON COLUMN "public"."github_planning_webhook_deliveries"."archived_at" IS 'Operator acknowledgement timestamp for an unreplayable terminal delivery. The failed delivery metadata remains retained.';



COMMENT ON COLUMN "public"."github_planning_webhook_deliveries"."archive_reason" IS 'Stable operator acknowledgement reason for an archived terminal delivery.';



CREATE OR REPLACE FUNCTION "public"."claim_github_planning_webhook_delivery"("p_delivery_id" "text", "p_lock_token" "uuid", "p_lease_seconds" integer DEFAULT 120) RETURNS SETOF "public"."github_planning_webhook_deliveries"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_lease interval := make_interval(
    secs => least(greatest(coalesce(p_lease_seconds, 120), 30), 900)
  );
begin
  if nullif(trim(coalesce(p_delivery_id, '')), '') is null or p_lock_token is null then
    raise exception using errcode = '22023', message = 'delivery id and lock token are required';
  end if;

  return query
  update public.github_planning_webhook_deliveries delivery
  set status = 'processing',
      status_reason = null,
      attempts = delivery.attempts + 1,
      locked_at = clock_timestamp(),
      lock_token = p_lock_token,
      processed_at = null,
      last_error = null,
      updated_at = clock_timestamp()
  where delivery.delivery_id = p_delivery_id
    and delivery.archived_at is null
    and (
      (delivery.status in ('received', 'retry_scheduled') and delivery.available_at <= clock_timestamp())
      or (delivery.status = 'processing' and delivery.locked_at < clock_timestamp() - v_lease)
    )
  returning delivery.*;
end;
$$;


ALTER FUNCTION "public"."claim_github_planning_webhook_delivery"("p_delivery_id" "text", "p_lock_token" "uuid", "p_lease_seconds" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_github_planning_webhook_delivery"("p_delivery_id" "text", "p_lock_token" "uuid", "p_lease_seconds" integer) IS 'Claims one verified planning delivery. Authorization is resolved later from the stable GitHub sender id.';



CREATE SEQUENCE IF NOT EXISTS "public"."planning_github_delivery_sequence"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."planning_github_delivery_sequence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."planning_github_lifecycle_outbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "root_type" "text" NOT NULL,
    "root_id" "text" NOT NULL,
    "root_trash_revision" integer NOT NULL,
    "task_id" "text" NOT NULL,
    "github_repo" "text",
    "github_issue_number" integer,
    "action" "text" NOT NULL,
    "source_type" "text" NOT NULL,
    "source_revision" integer NOT NULL,
    "reason" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "status_reason" "text",
    "attempts" integer DEFAULT 0 NOT NULL,
    "available_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "locked_at" timestamp with time zone,
    "lock_token" "uuid",
    "completed_at" timestamp with time zone,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "delivery_sequence" bigint DEFAULT "nextval"('"public"."planning_github_delivery_sequence"'::"regclass") NOT NULL,
    CONSTRAINT "planning_github_lifecycle_outbox_action_check" CHECK (("action" = ANY (ARRAY['close_not_planned'::"text", 'reopen'::"text"]))),
    CONSTRAINT "planning_github_lifecycle_outbox_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "planning_github_lifecycle_outbox_completion_check" CHECK (((("status" = 'completed'::"text") AND ("completed_at" IS NOT NULL)) OR (("status" <> 'completed'::"text") AND ("completed_at" IS NULL)))),
    CONSTRAINT "planning_github_lifecycle_outbox_github_issue_number_check" CHECK (("github_issue_number" > 0)),
    CONSTRAINT "planning_github_lifecycle_outbox_lock_check" CHECK (((("status" = 'processing'::"text") AND ("locked_at" IS NOT NULL) AND ("lock_token" IS NOT NULL)) OR (("status" <> 'processing'::"text") AND ("locked_at" IS NULL) AND ("lock_token" IS NULL)))),
    CONSTRAINT "planning_github_lifecycle_outbox_root_trash_revision_check" CHECK (("root_trash_revision" > 0)),
    CONSTRAINT "planning_github_lifecycle_outbox_root_type_check" CHECK (("root_type" = ANY (ARRAY['initiative'::"text", 'deliverable'::"text"]))),
    CONSTRAINT "planning_github_lifecycle_outbox_source_revision_check" CHECK (("source_revision" > 0)),
    CONSTRAINT "planning_github_lifecycle_outbox_source_type_check" CHECK (("source_type" = ANY (ARRAY['withdrawn'::"text", 'rejected'::"text", 'approval'::"text"]))),
    CONSTRAINT "planning_github_lifecycle_outbox_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'retry_scheduled'::"text", 'completed'::"text", 'failed'::"text"]))),
    CONSTRAINT "planning_github_lifecycle_outbox_target_check" CHECK ((("github_issue_number" IS NULL) OR (NULLIF(TRIM(BOTH FROM "github_repo"), ''::"text") IS NOT NULL)))
);


ALTER TABLE "public"."planning_github_lifecycle_outbox" OWNER TO "postgres";


COMMENT ON TABLE "public"."planning_github_lifecycle_outbox" IS 'Durable, ordered delivery queue for closing or reopening linked GitHub issues after planning trash lifecycle changes.';



CREATE OR REPLACE FUNCTION "public"."claim_planning_github_lifecycle_jobs"("p_lock_token" "uuid", "p_limit" integer DEFAULT 25, "p_lease_seconds" integer DEFAULT 120) RETURNS SETOF "public"."planning_github_lifecycle_outbox"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select *
  from public.claim_planning_github_lifecycle_jobs_transaction(
    p_lock_token,
    p_limit,
    p_lease_seconds,
    null,
    null,
    null
  )
$$;


ALTER FUNCTION "public"."claim_planning_github_lifecycle_jobs"("p_lock_token" "uuid", "p_limit" integer, "p_lease_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_planning_github_lifecycle_jobs_for_root"("p_lock_token" "uuid", "p_root_type" "text", "p_root_id" "text", "p_task_ids" "text"[], "p_limit" integer DEFAULT 25, "p_lease_seconds" integer DEFAULT 120) RETURNS SETOF "public"."planning_github_lifecycle_outbox"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if p_root_type is null
     or p_root_type not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_root_id, '')), '') is null
     or p_task_ids is null
     or cardinality(p_task_ids) < 1 then
    raise exception using errcode = '22023', message = 'scoped planning github lifecycle claim input is invalid';
  end if;

  return query
  select *
  from public.claim_planning_github_lifecycle_jobs_transaction(
    p_lock_token,
    p_limit,
    p_lease_seconds,
    p_root_type,
    p_root_id,
    p_task_ids
  );
end;
$$;


ALTER FUNCTION "public"."claim_planning_github_lifecycle_jobs_for_root"("p_lock_token" "uuid", "p_root_type" "text", "p_root_id" "text", "p_task_ids" "text"[], "p_limit" integer, "p_lease_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_planning_github_lifecycle_jobs_transaction"("p_lock_token" "uuid", "p_limit" integer, "p_lease_seconds" integer, "p_root_type" "text", "p_root_id" "text", "p_task_ids" "text"[]) RETURNS SETOF "public"."planning_github_lifecycle_outbox"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if p_lock_token is null or p_limit not between 1 and 100 or p_lease_seconds not between 30 and 900
     or (p_root_type is null and (p_root_id is not null or p_task_ids is not null))
     or (p_root_type is not null and (p_root_type not in ('initiative', 'deliverable')
       or nullif(trim(coalesce(p_root_id, '')), '') is null or p_task_ids is null
       or cardinality(p_task_ids) < 1 or exists (
         select 1 from unnest(p_task_ids) task_id where nullif(trim(coalesce(task_id, '')), '') is null
       ))) then
    raise exception using errcode = '22023', message = 'planning github lifecycle claim input is invalid';
  end if;
  return query
  with candidates as (
    select job.id
    from public.planning_github_lifecycle_outbox job
    where ((job.status in ('pending', 'retry_scheduled') and job.available_at <= now())
      or (job.status = 'processing' and job.locked_at < now() - make_interval(secs => p_lease_seconds)))
      and (p_root_type is null or (job.root_type = p_root_type and job.root_id = p_root_id and job.task_id = any(p_task_ids)))
      and not exists (
        select 1 from public.planning_github_lifecycle_outbox predecessor
        where predecessor.task_id = job.task_id and predecessor.status <> 'completed'
          and predecessor.delivery_sequence < job.delivery_sequence
      )
      and not exists (
        select 1 from public.planning_github_projection_outbox predecessor
        where predecessor.task_id = job.task_id
          and predecessor.status in ('pending', 'processing', 'retry_scheduled')
          and predecessor.delivery_sequence < job.delivery_sequence
      )
    order by job.delivery_sequence
    for update skip locked
    limit p_limit
  )
  update public.planning_github_lifecycle_outbox job
  set status = 'processing', attempts = attempts + 1, locked_at = clock_timestamp(),
      lock_token = p_lock_token, status_reason = null, last_error = null,
      updated_at = clock_timestamp()
  from candidates where job.id = candidates.id
  returning job.*;
end;
$$;


ALTER FUNCTION "public"."claim_planning_github_lifecycle_jobs_transaction"("p_lock_token" "uuid", "p_limit" integer, "p_lease_seconds" integer, "p_root_type" "text", "p_root_id" "text", "p_task_ids" "text"[]) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."planning_github_projection_outbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "delivery_sequence" bigint DEFAULT "nextval"('"public"."planning_github_delivery_sequence"'::"regclass") NOT NULL,
    "planning_operation_id" "text" NOT NULL,
    "task_id" "text" NOT NULL,
    "actor_profile_id" "text",
    "source_revision_token" "text" NOT NULL,
    "create_if_missing" boolean NOT NULL,
    "receipt_kind" "text",
    "receipt_token_id" "uuid",
    "receipt_idempotency_key" "uuid",
    "receipt_item_index" integer,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "status_reason" "text",
    "result" "jsonb",
    "attempts" integer DEFAULT 0 NOT NULL,
    "available_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "locked_at" timestamp with time zone,
    "lock_token" "uuid",
    "completed_at" timestamp with time zone,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_kind" "text" DEFAULT 'command'::"text" NOT NULL,
    "source_delivery_id" "text",
    CONSTRAINT "planning_github_projection_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "planning_github_projection_completion_check" CHECK (((("status" = 'completed'::"text") AND ("completed_at" IS NOT NULL)) OR (("status" <> 'completed'::"text") AND ("completed_at" IS NULL)))),
    CONSTRAINT "planning_github_projection_lock_check" CHECK (((("status" = 'processing'::"text") AND ("locked_at" IS NOT NULL) AND ("lock_token" IS NOT NULL)) OR (("status" <> 'processing'::"text") AND ("locked_at" IS NULL) AND ("lock_token" IS NULL)))),
    CONSTRAINT "planning_github_projection_operation_check" CHECK ((NULLIF(TRIM(BOTH FROM "planning_operation_id"), ''::"text") IS NOT NULL)),
    CONSTRAINT "planning_github_projection_receipt_check" CHECK (((("receipt_kind" IS NULL) AND ("receipt_token_id" IS NULL) AND ("receipt_idempotency_key" IS NULL) AND ("receipt_item_index" IS NULL)) OR (("receipt_kind" = 'team_create'::"text") AND ("receipt_token_id" IS NOT NULL) AND ("receipt_idempotency_key" IS NOT NULL) AND ("receipt_item_index" >= 0)) OR (("receipt_kind" = 'team_update'::"text") AND ("receipt_token_id" IS NOT NULL) AND ("receipt_idempotency_key" IS NOT NULL) AND ("receipt_item_index" IS NULL)))),
    CONSTRAINT "planning_github_projection_source_kind_check" CHECK (((("source_kind" = 'command'::"text") AND ("source_delivery_id" IS NULL) AND ("actor_profile_id" IS NOT NULL)) OR (("source_kind" = 'github_webhook'::"text") AND ("source_delivery_id" IS NOT NULL)))),
    CONSTRAINT "planning_github_projection_source_revision_check" CHECK ((NULLIF(TRIM(BOTH FROM "source_revision_token"), ''::"text") IS NOT NULL)),
    CONSTRAINT "planning_github_projection_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'retry_scheduled'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."planning_github_projection_outbox" OWNER TO "postgres";


COMMENT ON TABLE "public"."planning_github_projection_outbox" IS 'Durable GitHub reconciliation requests. Claims share item ordering with planning lifecycle delivery through delivery_sequence.';



COMMENT ON COLUMN "public"."planning_github_projection_outbox"."actor_profile_id" IS 'Human actor for authorized commands; null for corrective webhook reconciliation without an authorized FounderOps identity.';



COMMENT ON COLUMN "public"."planning_github_projection_outbox"."source_delivery_id" IS 'Verified inbound delivery that caused an automatic desired-state reconciliation.';



CREATE OR REPLACE FUNCTION "public"."claim_planning_github_projection_requests"("p_lock_token" "uuid", "p_limit" integer DEFAULT 25, "p_lease_seconds" integer DEFAULT 120, "p_operation_id" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."planning_github_projection_outbox"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if p_lock_token is null or p_limit not between 1 and 100 or p_lease_seconds not between 30 and 900 then
    raise exception using errcode = '22023', message = 'planning github projection claim input is invalid';
  end if;
  return query
  with candidates as (
    select request.id
    from public.planning_github_projection_outbox request
    where ((request.status in ('pending', 'retry_scheduled') and request.available_at <= now())
      or (request.status = 'processing' and request.locked_at < now() - make_interval(secs => p_lease_seconds)))
      and (p_operation_id is null or request.planning_operation_id = p_operation_id)
      and not exists (
        select 1 from public.planning_github_projection_outbox predecessor
        where predecessor.task_id = request.task_id
          and predecessor.status in ('pending', 'processing', 'retry_scheduled')
          and predecessor.delivery_sequence < request.delivery_sequence
      )
      and not exists (
        select 1 from public.planning_github_lifecycle_outbox predecessor
        where predecessor.task_id = request.task_id
          and predecessor.status <> 'completed'
          and predecessor.delivery_sequence < request.delivery_sequence
      )
    order by request.delivery_sequence
    for update skip locked
    limit p_limit
  )
  update public.planning_github_projection_outbox request
  set status = 'processing', attempts = attempts + 1, locked_at = clock_timestamp(),
      lock_token = p_lock_token, status_reason = null, last_error = null,
      updated_at = clock_timestamp()
  from candidates where request.id = candidates.id
  returning request.*;
end;
$$;


ALTER FUNCTION "public"."claim_planning_github_projection_requests"("p_lock_token" "uuid", "p_limit" integer, "p_lease_seconds" integer, "p_operation_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_task_comment_github_deliveries"("p_lock_token" "text", "p_task_id" "text" DEFAULT NULL::"text", "p_author_profile_id" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 20, "p_lease_seconds" integer DEFAULT 120) RETURNS TABLE("task_comment_id" bigint, "task_id" "text", "author_profile_id" "text", "github_issue_number" integer, "status" "text", "attempts" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return query
  with candidates as (
    select delivery.task_comment_id
    from public.task_comment_github_deliveries delivery
    where (p_task_id is null or delivery.task_id = p_task_id)
      and (p_author_profile_id is null or delivery.author_profile_id = p_author_profile_id)
      and (
        delivery.status in ('pending', 'waiting_for_issue', 'waiting_for_author_connection', 'retry_scheduled', 'failed')
        or (delivery.status = 'processing' and delivery.locked_at <= now() - make_interval(secs => greatest(30, p_lease_seconds)))
      )
      and (delivery.next_attempt_at is null or delivery.next_attempt_at <= now())
    order by delivery.created_at, delivery.task_comment_id
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  )
  update public.task_comment_github_deliveries delivery
  set status = 'processing',
      lock_token = p_lock_token,
      locked_at = now(),
      last_attempted_at = now(),
      updated_at = now()
  from candidates
  where delivery.task_comment_id = candidates.task_comment_id
  returning delivery.task_comment_id, delivery.task_id, delivery.author_profile_id,
    delivery.github_issue_number, delivery.status, delivery.attempts;
end;
$$;


ALTER FUNCTION "public"."claim_task_comment_github_deliveries"("p_lock_token" "text", "p_task_id" "text", "p_author_profile_id" "text", "p_limit" integer, "p_lease_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_google_workspace_disconnect"("p_operation_id" "uuid", "p_owner_profile_id" "text", "p_completed_at" timestamp with time zone DEFAULT "clock_timestamp"()) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  update public.google_workspace_disconnect_operations
  set state = 'completed', completed_at = p_completed_at, last_error_class = null, updated_at = p_completed_at
  where id = p_operation_id and owner_profile_id = p_owner_profile_id and state = 'revoke_pending';
  if not found and not exists (
    select 1 from public.google_workspace_disconnect_operations
    where id = p_operation_id and owner_profile_id = p_owner_profile_id and state = 'completed'
  ) then
    raise exception using errcode = 'P0004', message = 'disconnect operation is not completable';
  end if;
end;
$$;


ALTER FUNCTION "public"."complete_google_workspace_disconnect"("p_operation_id" "uuid", "p_owner_profile_id" "text", "p_completed_at" timestamp with time zone) OWNER TO "postgres";


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


ALTER FUNCTION "public"."complete_team_workweek_google_conflict_resolution"("p_conflict_id" "uuid", "p_owner_profile_id" "text", "p_conflict_revision" integer, "p_resolved_at" timestamp with time zone) OWNER TO "postgres";


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
    and effective_to is null
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


ALTER FUNCTION "public"."confirm_google_team_workweek_observation"("p_publication_id" "uuid", "p_publication_revision" integer, "p_observations" "jsonb", "p_observed_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_google_workspace_disconnect_series"("p_target_id" "uuid", "p_expected_etag" "text", "p_confirmed_etag" "text", "p_observed_at" timestamp with time zone DEFAULT "clock_timestamp"()) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  update public.google_workspace_disconnect_series
  set state = 'confirmed', confirmed_etag = nullif(p_confirmed_etag, ''),
    last_error_class = null, last_observed_at = p_observed_at, updated_at = p_observed_at
  where id = v_target.id;
end;
$$;


ALTER FUNCTION "public"."confirm_google_workspace_disconnect_series"("p_target_id" "uuid", "p_expected_etag" "text", "p_confirmed_etag" "text", "p_observed_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_team_workweek_google_series"("p_series_id" "uuid", "p_etag" "text", "p_founderops_revision" integer, "p_observed_at" timestamp with time zone DEFAULT "clock_timestamp"()) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if nullif(btrim(p_etag), '') is null or p_founderops_revision < 1 or p_observed_at is null then
    raise exception using errcode = '22023', message = 'confirmed Google series metadata is invalid';
  end if;

  update public.team_workweek_google_series as series
  set state = 'confirmed',
    confirmed_etag = btrim(p_etag),
    confirmed_founderops_revision = p_founderops_revision,
    last_observed_at = p_observed_at,
    last_confirmed_at = p_observed_at,
    last_error_class = null,
    updated_at = p_observed_at
  from public.team_workweek_publications as publication
  where series.id = p_series_id
    and publication.id = series.publication_id
    and publication.publication_revision = p_founderops_revision;

  if not found then
    raise exception using errcode = '22023', message = 'Google series projection revision is invalid';
  end if;
end;
$$;


ALTER FUNCTION "public"."confirm_team_workweek_google_series"("p_series_id" "uuid", "p_etag" "text", "p_founderops_revision" integer, "p_observed_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_team_workweek_google_series_transition"("p_transition_id" "uuid", "p_etag" "text", "p_expected_founderops_revision" integer, "p_observed_at" timestamp with time zone DEFAULT "clock_timestamp"()) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if nullif(btrim(p_etag), '') is null or p_expected_founderops_revision < 1 or p_observed_at is null then
    raise exception using errcode = '22023', message = 'confirmed Google series transition metadata is invalid';
  end if;

  update public.team_workweek_google_series_transitions
  set state = 'confirmed',
    confirmed_etag = btrim(p_etag),
    last_observed_at = p_observed_at,
    last_confirmed_at = p_observed_at,
    last_error_class = null,
    updated_at = p_observed_at
  where id = p_transition_id
    and expected_founderops_revision = p_expected_founderops_revision;

  if not found then
    raise exception using errcode = '22023', message = 'Google series transition revision is invalid';
  end if;
end;
$$;


ALTER FUNCTION "public"."confirm_team_workweek_google_series_transition"("p_transition_id" "uuid", "p_etag" "text", "p_expected_founderops_revision" integer, "p_observed_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_browser_planning_item_transaction"("p_item" "jsonb", "p_strategy" "jsonb", "p_raci_assignments" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor_role text;
begin
  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  if v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'planning create requires an operational lead';
  end if;
  return public.create_planning_item_transaction(
    p_item, p_strategy, coalesce(p_raci_assignments, '[]'::jsonb), p_actor_profile_id
  );
end;
$$;


ALTER FUNCTION "public"."create_browser_planning_item_transaction"("p_item" "jsonb", "p_strategy" "jsonb", "p_raci_assignments" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_planning_item_transaction"("p_item" "jsonb", "p_strategy" "jsonb" DEFAULT NULL::"jsonb", "p_raci_assignments" "jsonb" DEFAULT '[]'::"jsonb", "p_actor_profile_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_type text := lower(nullif(trim(coalesce(p_item->>'task_type', '')), ''));
  v_id text := nullif(trim(coalesce(p_item->>'id', '')), '');
  v_project_id text := nullif(trim(coalesce(p_item->>'project_id', '')), '');
  v_title text := nullif(trim(coalesce(p_item->>'title', '')), '');
  v_owner text := nullif(trim(coalesce(p_item->>'owner', p_item->>'assignee', '')), '');
  v_parent_task_id text := nullif(trim(coalesce(p_item->>'parent_task_id', '')), '');
  v_status text := nullif(trim(coalesce(p_item->>'status', '')), '');
  v_priority text := nullif(trim(coalesce(p_item->>'priority', '')), '');
  v_parent public.tasks%rowtype;
  v_task public.tasks%rowtype;
  v_strategy jsonb := coalesce(p_strategy, '{}'::jsonb);
begin
  perform set_config('app.actor_profile_id', coalesce(p_actor_profile_id, ''), true);

  if v_type not in ('epic', 'initiative')
     or v_id is null
     or v_project_id is null
     or v_title is null
     or v_owner is null
     or v_status is null then
    raise exception using errcode = '22023', message = 'planning item create input is invalid';
  end if;
  if exists (select 1 from public.tasks where id = v_id) then
    raise exception using errcode = '23505', message = 'planning item id already exists';
  end if;
  if not exists (select 1 from public.profiles where id = v_owner) then
    raise exception using errcode = '23503', message = 'planning item owner was not found';
  end if;
  if v_type = 'epic' and v_parent_task_id is not null then
    raise exception using errcode = '23514', message = 'epic cannot have a parent';
  end if;
  if v_type = 'initiative' and v_parent_task_id is not null then
    select * into v_parent from public.tasks where id = v_parent_task_id and trashed_at is null for share;
    if not found or v_parent.task_type <> 'epic' then
      raise exception using errcode = '23514', message = 'initiative parent must be an active epic';
    end if;
  end if;
  if v_type = 'initiative' and v_priority is null then
    v_priority := 'P2';
  end if;
  if jsonb_typeof(v_strategy) <> 'object' then
    raise exception using errcode = '22023', message = 'planning strategy must be an object';
  end if;

  insert into public.tasks (
    id, project_id, title, description, status, priority, owner, assignee,
    sort_order, target_date, task_type, parent_task_id, approval_status,
    approval_revision, proposed_by, proposed_at, github_issue_sync_status,
    score_relevant, review_status, created_by
  ) values (
    v_id,
    v_project_id,
    v_title,
    nullif(trim(coalesce(p_item->>'description', '')), ''),
    v_status,
    case when v_type = 'epic' then null else v_priority end,
    v_owner,
    v_owner,
    coalesce((p_item->>'sort_order')::integer, 0),
    nullif(trim(coalesce(p_item->>'target_date', '')), '')::date,
    v_type,
    v_parent_task_id,
    case when v_type = 'initiative' then 'proposed' else null end,
    1,
    case when v_type = 'initiative' then nullif(p_actor_profile_id, '') else null end,
    case when v_type = 'initiative' then now() else null end,
    'not_applicable',
    false,
    'not_requested',
    nullif(p_actor_profile_id, '')
  ) returning * into v_task;

  if v_type = 'initiative' then
    insert into public.planning_item_strategy (task_id, goal, success_criteria, scope_constraints)
    values (
      v_id,
      coalesce(v_strategy->>'goal', ''),
      coalesce(v_strategy->>'successCriteria', ''),
      coalesce(v_strategy->>'scopeConstraints', '')
    );
    perform public.replace_planning_item_raci_assignments(v_id, p_raci_assignments);
  end if;

  insert into public.task_activity (task_id, message)
  values (v_id, case when v_type = 'epic' then 'Epic erstellt' else 'Initiative vorgeschlagen' end);
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, after_data)
  values (
    nullif(p_actor_profile_id, ''),
    'planning_item.created',
    'task',
    v_id,
    jsonb_build_object('taskType', v_type, 'parentTaskId', v_parent_task_id)
  );

  return jsonb_build_object('task', to_jsonb(v_task));
end;
$$;


ALTER FUNCTION "public"."create_planning_item_transaction"("p_item" "jsonb", "p_strategy" "jsonb", "p_raci_assignments" "jsonb", "p_actor_profile_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_planning_task_transaction"("p_task_insert" "jsonb", "p_relation_type" "text" DEFAULT NULL::"text", "p_related_task_id" "text" DEFAULT NULL::"text", "p_relation_note" "text" DEFAULT NULL::"text", "p_activity_message" "text" DEFAULT 'Task created'::"text", "p_relation_activity_message" "text" DEFAULT NULL::"text", "p_notifications" "jsonb" DEFAULT '[]'::"jsonb", "p_actor_profile_id" "text" DEFAULT NULL::"text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text", "p_approve_now" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_result jsonb;
  v_task jsonb;
  v_clean_insert jsonb := coalesce(p_task_insert, '{}'::jsonb)
    - 'approval_status' - 'approval_revision' - 'proposed_by' - 'proposed_at'
    - 'decided_by' - 'decided_at' - 'decision_note';
  v_requested_approval_status text := nullif(p_task_insert->>'approval_status', '');
begin
  perform set_config('app.actor_profile_id', coalesce(p_actor_profile_id, ''), true);
  v_result := public.create_task_transaction(
    v_clean_insert,
    p_relation_type,
    p_related_task_id,
    p_relation_note,
    p_activity_message,
    p_relation_activity_message,
    p_notifications,
    p_actor_profile_id,
    p_request_ip,
    p_user_agent
  );
  v_task := v_result->'task';

  if coalesce((v_result->>'replayed')::boolean, false) = false
     and v_task->>'task_type' = 'deliverable' then
    if p_approve_now then
      v_task := (public.decide_planning_item_approval_transaction(
        v_task->>'id',
        coalesce((v_task->>'approval_revision')::integer, 1),
        'approve',
        p_actor_profile_id,
        'Bei Erstellung durch CEO freigegeben.'
      )->'task');
    elsif v_requested_approval_status <> 'approved' or v_requested_approval_status is null then
      update public.tasks
      set proposed_by = coalesce(nullif(p_task_insert->>'proposed_by', ''), p_actor_profile_id),
          proposed_at = coalesce((p_task_insert->>'proposed_at')::timestamptz, proposed_at, now())
      where id = v_task->>'id'
      returning to_jsonb(tasks) into v_task;
    else
      raise exception using errcode = '22023', message = 'deliverable approval requires an explicit approval decision';
    end if;
    v_result := jsonb_set(v_result, '{task}', v_task);
  end if;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."create_planning_task_transaction"("p_task_insert" "jsonb", "p_relation_type" "text", "p_related_task_id" "text", "p_relation_note" "text", "p_activity_message" "text", "p_relation_activity_message" "text", "p_notifications" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text", "p_approve_now" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_private_team_workweek_version"("p_effective_from" "date", "p_windows" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_owner_profile_id text;
  v_owner_role text;
  v_today date := (clock_timestamp() at time zone 'Europe/Berlin')::date;
  v_next_monday date;
  v_version_id uuid;
  v_window jsonb;
  v_weekday smallint;
  v_start_minute smallint;
  v_end_minute smallint;
begin
  v_next_monday := v_today + case
    when extract(isodow from v_today)::integer = 1 then 7
    else 8 - extract(isodow from v_today)::integer
  end;

  select profile.id, profile.platform_role
  into v_owner_profile_id, v_owner_role
  from public.profiles as profile
  where profile.auth_user_id = auth.uid();

  if not found or v_owner_profile_id is null then
    raise exception using errcode = '42501', message = 'mapped team profile required';
  end if;
  if v_owner_role not in ('ceo', 'founder', 'deputy') then
    raise exception using errcode = '42501', message = 'viewer cannot create a private team workweek';
  end if;
  if p_effective_from is null
    or extract(isodow from p_effective_from)::integer <> 1
    or p_effective_from < v_next_monday then
    raise exception using errcode = '22023', message = 'effective date must be a future Monday';
  end if;
  if p_windows is null or jsonb_typeof(p_windows) <> 'array' or jsonb_array_length(p_windows) > 84 then
    raise exception using errcode = '22023', message = 'workweek windows must be a bounded array';
  end if;

  insert into public.team_workweek_versions (owner_profile_id, effective_from)
  values (v_owner_profile_id, p_effective_from)
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
    'timezone', 'Europe/Berlin',
    'status', 'preparing',
    'createdAt', clock_timestamp()
  );
end;
$$;


ALTER FUNCTION "public"."create_private_team_workweek_version"("p_effective_from" "date", "p_windows" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_score_objection_transaction"("p_sprint_id" "text", "p_profile_id" "text", "p_comment" "text", "p_request_ip" "text", "p_user_agent" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_project_id text;
  v_window_hours integer;
  v_actor_role text;
  v_sprint public.sprints%rowtype;
  v_sprint_end timestamptz;
  v_review_due_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_score_id bigint;
  v_objection public.score_objections%rowtype;
begin
  if nullif(trim(coalesce(p_comment, '')), '') is null then
    raise exception using errcode = '22023', message = 'score objection comment is required';
  end if;

  select platform_role into v_actor_role
  from public.profiles
  where id = p_profile_id;
  if not found or v_actor_role not in ('ceo', 'founder', 'deputy') then
    raise exception using errcode = 'P0005', message = 'contributor profile is required';
  end if;

  select project_id into v_project_id
  from public.sprints
  where id = p_sprint_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'sprint not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('founderops-review-window:' || v_project_id, 0));

  select review_objection_window_hours into v_window_hours
  from public.projects
  where id = v_project_id
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  select * into v_sprint
  from public.sprints
  where id = p_sprint_id and project_id = v_project_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'sprint not found';
  end if;
  if v_sprint.score_locked then
    raise exception using errcode = 'P0003', message = 'sprint score is locked';
  end if;
  if v_sprint.end_date is null then
    raise exception using errcode = '22023', message = 'sprint end date is required';
  end if;

  v_sprint_end := ((v_sprint.end_date + time '23:59:59.999') at time zone 'Europe/Berlin');
  v_review_due_at := coalesce(
    v_sprint.review_due_at,
    v_sprint_end + make_interval(hours => v_window_hours)
  );
  if v_now <= v_sprint_end then
    raise exception using errcode = 'P0004', message = 'score objection window has not started';
  end if;
  if v_now > v_review_due_at then
    raise exception using errcode = 'P0006', message = 'score objection window has expired';
  end if;

  select id into v_score_id
  from public.founder_sprint_scores
  where sprint_id = p_sprint_id and profile_id = p_profile_id;

  insert into public.score_objections (
    sprint_id, profile_id, founder_sprint_score_id, status, comment
  ) values (
    p_sprint_id, p_profile_id, v_score_id, 'open', trim(p_comment)
  ) returning * into v_objection;

  insert into public.audit_log (
    entity_type, entity_id, action, actor_profile_id, after_data, request_ip, user_agent
  ) values (
    'score_objection', v_objection.id::text, 'score_objection.create', p_profile_id,
    to_jsonb(v_objection), p_request_ip, p_user_agent
  );

  return to_jsonb(v_objection);
end;
$$;


ALTER FUNCTION "public"."create_score_objection_transaction"("p_sprint_id" "text", "p_profile_id" "text", "p_comment" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_sprint_plan_transaction"("p_sprints" "jsonb", "p_meetings" "jsonb" DEFAULT '[]'::"jsonb", "p_audit_data" "jsonb" DEFAULT '{}'::"jsonb", "p_actor_profile_id" "text" DEFAULT NULL::"text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_sprint jsonb;
  v_row jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_expected_updated_at timestamptz;
begin
  if jsonb_typeof(p_sprints) <> 'array' or jsonb_array_length(p_sprints) = 0 then
    raise exception using errcode = '22023', message = 'sprint plan must contain at least one sprint';
  end if;
  if jsonb_typeof(coalesce(p_meetings, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'sprint meetings must be a JSON array';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sprint-plan', 0));

  for v_sprint in select value from jsonb_array_elements(p_sprints)
  loop
    if nullif(trim(v_sprint->>'id'), '') is null then
      raise exception using errcode = '22023', message = 'sprint id is required';
    end if;
    v_expected_updated_at := nullif(v_sprint->>'expected_updated_at', '')::timestamptz;
    v_row := null;

    if v_expected_updated_at is null then
      insert into public.sprints (
        id,
        project_id,
        name,
        status,
        start_date,
        end_date,
        review_due_at,
        score_locked
      )
      values (
        v_sprint->>'id',
        v_sprint->>'project_id',
        v_sprint->>'name',
        v_sprint->>'status',
        nullif(v_sprint->>'start_date', '')::date,
        nullif(v_sprint->>'end_date', '')::date,
        nullif(v_sprint->>'review_due_at', '')::timestamptz,
        coalesce((v_sprint->>'score_locked')::boolean, false)
      )
      on conflict (id) do nothing
      returning to_jsonb(sprints) into v_row;
    else
      update public.sprints as sprint
      set name = v_sprint->>'name',
          status = v_sprint->>'status',
          start_date = nullif(v_sprint->>'start_date', '')::date,
          end_date = nullif(v_sprint->>'end_date', '')::date,
          review_due_at = nullif(v_sprint->>'review_due_at', '')::timestamptz,
          updated_at = clock_timestamp()
      where sprint.id = v_sprint->>'id'
        and sprint.updated_at = v_expected_updated_at
        and not sprint.score_locked
        and not exists (select 1 from public.tasks where sprint_id = sprint.id)
      returning to_jsonb(sprint) into v_row;
    end if;

    if v_row is null then
      raise exception using errcode = 'P0001', message = 'sprint plan changed concurrently or contains a protected sprint';
    end if;
    v_rows := v_rows || jsonb_build_array(v_row);
  end loop;

  insert into public.meetings (
    sprint_id,
    title,
    meeting_at,
    duration_minutes,
    status,
    agenda
  )
  select
    meeting.sprint_id,
    meeting.title,
    meeting.meeting_at,
    meeting.duration_minutes,
    meeting.status,
    meeting.agenda
  from jsonb_to_recordset(coalesce(p_meetings, '[]'::jsonb)) as meeting(
    sprint_id text,
    title text,
    meeting_at timestamptz,
    duration_minutes integer,
    status text,
    agenda text
  )
  where not exists (
    select 1
    from public.meetings as existing
    where existing.sprint_id = meeting.sprint_id
      and lower(existing.title) = lower(meeting.title)
  );

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    after_data,
    request_ip,
    user_agent
  )
  values (
    p_actor_profile_id,
    'sprint.plan_create',
    'sprint',
    'bulk',
    coalesce(p_audit_data, '{}'::jsonb) || jsonb_build_object('upserted', jsonb_array_length(v_rows)),
    p_request_ip,
    p_user_agent
  );

  return v_rows;
end;
$$;


ALTER FUNCTION "public"."create_sprint_plan_transaction"("p_sprints" "jsonb", "p_meetings" "jsonb", "p_audit_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_sprint_plan_transaction"("p_sprints" "jsonb", "p_meetings" "jsonb", "p_audit_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") IS 'Atomically creates or updates an optimistic sprint plan with its weekly meetings and audit record.';



CREATE OR REPLACE FUNCTION "public"."create_sprint_plan_with_review_window_transaction"("p_project_id" "text", "p_sprints" "jsonb", "p_meetings" "jsonb", "p_audit_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_window_hours integer;
  v_sprint jsonb;
  v_end_date date;
  v_review_due_at timestamptz;
  v_adjusted_sprints jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_sprints) <> 'array' or jsonb_array_length(p_sprints) = 0 then
    raise exception using errcode = '22023', message = 'sprint plan must contain at least one sprint';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('founderops-review-window:' || p_project_id, 0));

  select review_objection_window_hours into v_window_hours
  from public.projects
  where id = p_project_id
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  for v_sprint in select value from jsonb_array_elements(p_sprints)
  loop
    if nullif(trim(v_sprint->>'project_id'), '') is distinct from p_project_id then
      raise exception using errcode = '22023', message = 'sprint project does not match process settings project';
    end if;
    v_end_date := nullif(v_sprint->>'end_date', '')::date;
    if v_end_date is null then
      raise exception using errcode = '22023', message = 'sprint end date is required';
    end if;
    v_review_due_at := ((v_end_date + time '23:59:59.999') at time zone 'Europe/Berlin')
      + make_interval(hours => v_window_hours);
    v_adjusted_sprints := v_adjusted_sprints || jsonb_build_array(
      jsonb_set(v_sprint, '{review_due_at}', to_jsonb(v_review_due_at), true)
    );
  end loop;

  return public.create_sprint_plan_transaction(
    v_adjusted_sprints,
    coalesce(p_meetings, '[]'::jsonb),
    coalesce(p_audit_data, '{}'::jsonb) || jsonb_build_object('reviewObjectionWindowHours', v_window_hours),
    p_actor_profile_id,
    p_request_ip,
    p_user_agent
  );
end;
$$;


ALTER FUNCTION "public"."create_sprint_plan_with_review_window_transaction"("p_project_id" "text", "p_sprints" "jsonb", "p_meetings" "jsonb", "p_audit_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_task_comment_local"("p_task_id" "text", "p_profile_id" "text", "p_comment" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task public.tasks%rowtype;
  v_comment public.task_comments%rowtype;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
  if v_task.task_type not in ('epic', 'initiative') then
    raise exception using errcode = '22023', message = 'local-only comments are reserved for strategic planning items';
  end if;
  if nullif(trim(coalesce(p_comment, '')), '') is null then
    raise exception using errcode = '22023', message = 'comment is required';
  end if;

  insert into public.task_comments (task_id, profile_id, comment, github_delivery_applicable)
  values (p_task_id, nullif(p_profile_id, ''), trim(p_comment), false)
  returning * into v_comment;

  return jsonb_build_object(
    'comment', to_jsonb(v_comment),
    'deliveryStatus', 'not_applicable'
  );
end;
$$;


ALTER FUNCTION "public"."create_task_comment_local"("p_task_id" "text", "p_profile_id" "text", "p_comment" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_task_comment_with_github_delivery"("p_task_id" "text", "p_profile_id" "text", "p_comment" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_task public.tasks%rowtype;
  v_comment public.task_comments%rowtype;
  v_status text;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  insert into public.task_comments (task_id, profile_id, comment)
  values (p_task_id, nullif(p_profile_id, ''), p_comment)
  returning * into v_comment;

  v_status := case
    when v_task.github_issue_number is null and coalesce(trim(v_task.issue_number), '') !~ '^[1-9][0-9]*$' then 'waiting_for_issue'
    when nullif(p_profile_id, '') is null then 'waiting_for_author_connection'
    else 'pending'
  end;

  insert into public.task_comment_github_deliveries (
    task_comment_id,
    task_id,
    author_profile_id,
    github_issue_number,
    status,
    status_reason
  ) values (
    v_comment.id,
    p_task_id,
    nullif(p_profile_id, ''),
    coalesce(
      v_task.github_issue_number,
      case when coalesce(trim(v_task.issue_number), '') ~ '^[1-9][0-9]*$' then trim(v_task.issue_number)::integer end
    ),
    v_status,
    case
      when v_status = 'waiting_for_issue' then 'github_issue_missing'
      when v_status = 'waiting_for_author_connection' then 'author_profile_missing'
      else null
    end
  );

  return jsonb_build_object(
    'comment', to_jsonb(v_comment),
    'deliveryStatus', v_status
  );
end;
$_$;


ALTER FUNCTION "public"."create_task_comment_with_github_delivery"("p_task_id" "text", "p_profile_id" "text", "p_comment" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_task_comment_with_notifications"("p_task_id" "text", "p_profile_id" "text", "p_comment" "text", "p_deliver_to_github" boolean, "p_mention_recipient_profile_ids" "text"[] DEFAULT '{}'::"text"[], "p_comment_recipient_profile_ids" "text"[] DEFAULT '{}'::"text"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_task public.tasks%rowtype;
  v_comment public.task_comments%rowtype;
  v_status text := 'not_applicable';
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
  if nullif(trim(coalesce(p_comment, '')), '') is null then
    raise exception using errcode = '22023', message = 'comment is required';
  end if;
  if p_deliver_to_github = (v_task.task_type in ('epic', 'initiative')) then
    raise exception using errcode = '22023', message = 'comment delivery mode does not match task capability';
  end if;

  insert into public.task_comments (task_id, profile_id, comment, github_delivery_applicable)
  values (p_task_id, nullif(p_profile_id, ''), trim(p_comment), p_deliver_to_github)
  returning * into v_comment;

  if p_deliver_to_github then
    v_status := case
      when v_task.github_issue_number is null and coalesce(trim(v_task.issue_number), '') !~ '^[1-9][0-9]*$' then 'waiting_for_issue'
      when nullif(p_profile_id, '') is null then 'waiting_for_author_connection'
      else 'pending'
    end;

    insert into public.task_comment_github_deliveries (
      task_comment_id, task_id, author_profile_id, github_issue_number, status, status_reason
    ) values (
      v_comment.id,
      p_task_id,
      nullif(p_profile_id, ''),
      coalesce(
        v_task.github_issue_number,
        case when coalesce(trim(v_task.issue_number), '') ~ '^[1-9][0-9]*$' then trim(v_task.issue_number)::integer end
      ),
      v_status,
      case
        when v_status = 'waiting_for_issue' then 'github_issue_missing'
        when v_status = 'waiting_for_author_connection' then 'author_profile_missing'
        else null
      end
    );
  end if;

  insert into public.notification_events (
    type, actor_profile_id, recipient_profile_id, entity_type, entity_id,
    title, body, dedupe_key, target_path
  )
  select
    'task.mention', nullif(p_profile_id, ''), recipient_id, 'task', p_task_id,
    'Du wurdest erwähnt: ' || v_task.title, trim(p_comment),
    'task.mention:founderops:' || v_comment.id || ':' || recipient_id,
    '/tasks/' || p_task_id || '?comment=local:' || v_comment.id
  from unnest(coalesce(p_mention_recipient_profile_ids, '{}')) recipient_id
  where nullif(trim(recipient_id), '') is not null
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  insert into public.notification_events (
    type, actor_profile_id, recipient_profile_id, entity_type, entity_id,
    title, body, dedupe_key, target_path
  )
  select
    'task.comment', nullif(p_profile_id, ''), recipient_id, 'task', p_task_id,
    'Neuer Kommentar: ' || v_task.title, trim(p_comment),
    'task.comment:founderops:' || v_comment.id || ':' || recipient_id,
    '/tasks/' || p_task_id || '?comment=local:' || v_comment.id
  from unnest(coalesce(p_comment_recipient_profile_ids, '{}')) recipient_id
  where nullif(trim(recipient_id), '') is not null
    and recipient_id is distinct from nullif(p_profile_id, '')
    and not (recipient_id = any(coalesce(p_mention_recipient_profile_ids, '{}')))
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  return jsonb_build_object(
    'comment', to_jsonb(v_comment),
    'deliveryStatus', v_status
  );
end;
$_$;


ALTER FUNCTION "public"."create_task_comment_with_notifications"("p_task_id" "text", "p_profile_id" "text", "p_comment" "text", "p_deliver_to_github" boolean, "p_mention_recipient_profile_ids" "text"[], "p_comment_recipient_profile_ids" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_task_transaction"("p_task_insert" "jsonb", "p_relation_type" "text" DEFAULT NULL::"text", "p_related_task_id" "text" DEFAULT NULL::"text", "p_relation_note" "text" DEFAULT NULL::"text", "p_activity_message" "text" DEFAULT 'Task created'::"text", "p_relation_activity_message" "text" DEFAULT NULL::"text", "p_notifications" "jsonb" DEFAULT '[]'::"jsonb", "p_actor_profile_id" "text" DEFAULT NULL::"text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_insert jsonb := coalesce(p_task_insert, '{}'::jsonb);
  v_allowed_columns constant text[] := array[
    'acceptance_criteria',
    'assignee',
    'carryover_count',
    'carryover_reason',
    'carried_from_sprint_id',
    'carried_from_task_id',
    'created_by',
    'creation_request_id',
    'deadline',
    'definition_of_done',
    'description',
    'dod_template_version',
    'end_date',
    'estimate_hours',
    'evidence_link',
    'evidence_required',
    'github_issue_number',
    'github_issue_url',
    'github_repo',
    'github_issue_sync_status',
    'id',
    'intended_outcome',
    'issue_number',
    'issue_url',
    'milestone_id',
    'original_sprint_id',
    'owner',
    'package_id',
    'parent_task_id',
    'priority',
    'problem_statement',
    'project_id',
    'review_owner_profile_id',
    'review_status',
    'score_final',
    'score_points',
    'score_relevant',
    'scope_constraints',
    'sort_order',
    'sprint_id',
    'start_date',
    'status',
    'task_type',
    'title',
    'workstream'
  ];
  v_task_id text := nullif(trim(v_insert->>'id'), '');
  v_creation_request_id text := nullif(trim(v_insert->>'creation_request_id'), '');
  v_request_payload jsonb;
  v_request_fingerprint jsonb;
  v_columns text;
  v_values text;
  v_task jsonb;
  v_relation jsonb := null;
  v_related_task jsonb := null;
  v_activities jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(v_insert) <> 'object' or v_task_id is null or v_creation_request_id is null then
    raise exception using errcode = '22023', message = 'task insert, task id, and creation request id are required';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(v_insert) as insert_key
    where not (insert_key = any(v_allowed_columns))
  ) then
    raise exception using errcode = '22023', message = 'task insert contains unsupported columns';
  end if;

  if jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'task notifications must be a JSON array';
  end if;

  v_request_payload := jsonb_build_object(
    'task', v_insert - 'sort_order',
    'relation', jsonb_build_object(
      'type', nullif(trim(coalesce(p_relation_type, '')), ''),
      'relatedTaskId', nullif(trim(coalesce(p_related_task_id, '')), ''),
      'note', nullif(trim(coalesce(p_relation_note, '')), '')
    )
  );
  v_request_fingerprint := to_jsonb(md5(v_request_payload::text));

  perform pg_advisory_xact_lock(hashtextextended('task-create:' || v_creation_request_id, 0));
  select to_jsonb(task) into v_task
  from public.tasks as task
  where task.creation_request_id = v_creation_request_id;

  if v_task is not null then
    if (v_task->'creation_request_payload') is distinct from v_request_fingerprint then
      raise exception using errcode = 'P0003', message = 'creation request id was reused with different task data';
    end if;

    select to_jsonb(relation) into v_relation
    from public.task_relationship_edges as relation
    where relation.task_id = v_task->>'id'
    order by relation.id
    limit 1;

    if v_relation is not null then
      select jsonb_build_object(
        'id', related.id,
        'githubIssueSyncStatus', related.github_issue_sync_status,
        'githubIssueSyncError', coalesce(related.github_issue_sync_error, ''),
        'updatedAt', related.updated_at
      )
      into v_related_task
      from public.tasks as related
      where related.id = v_relation->>'related_task_id';
    end if;

    return jsonb_build_object(
      'task', v_task,
      'relation', v_relation,
      'relatedTask', v_related_task,
      'activities', '[]'::jsonb,
      'replayed', true
    );
  end if;

  if nullif(trim(coalesce(p_related_task_id, '')), '') is not null then
    if p_related_task_id = v_task_id then
      raise exception using errcode = '22023', message = 'task cannot relate to itself';
    end if;
    if p_relation_type not in ('blocked_by', 'blocks', 'relates_to') then
      raise exception using errcode = '22023', message = 'task relation type is invalid';
    end if;
    if not exists (select 1 from public.tasks where id = p_related_task_id) then
      raise exception using errcode = 'P0002', message = 'related task not found';
    end if;
  elsif nullif(trim(coalesce(p_relation_type, '')), '') is not null then
    raise exception using errcode = '22023', message = 'related task id is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tasks:sort-order', 0));
  v_insert := v_insert || jsonb_build_object(
    'sort_order', coalesce((select max(sort_order) from public.tasks), 0) + 1,
    'creation_request_payload', v_request_fingerprint
  );

  select
    string_agg(format('%I', insert_key), ', ' order by insert_key),
    string_agg(
      format('(jsonb_populate_record(null::public.tasks, $1)).%I', insert_key),
      ', '
      order by insert_key
    )
  into v_columns, v_values
  from jsonb_object_keys(v_insert) as insert_key;

  execute format(
    'insert into public.tasks (%s) select %s returning to_jsonb(tasks)',
    v_columns,
    v_values
  )
  into v_task
  using v_insert;

  if nullif(trim(coalesce(p_related_task_id, '')), '') is not null then
    insert into public.task_relationship_edges (
      task_id,
      related_task_id,
      relation_type,
      note,
      created_by
    )
    values (
      v_task_id,
      p_related_task_id,
      p_relation_type,
      nullif(trim(coalesce(p_relation_note, '')), ''),
      p_actor_profile_id
    )
    returning to_jsonb(task_relationship_edges) into v_relation;

    update public.tasks as related
    set github_issue_sync_status = 'not_synced',
        github_issue_sync_error = null,
        updated_at = clock_timestamp()
    where id = p_related_task_id
    returning jsonb_build_object(
      'id', related.id,
      'githubIssueSyncStatus', related.github_issue_sync_status,
      'githubIssueSyncError', coalesce(related.github_issue_sync_error, ''),
      'updatedAt', related.updated_at
    ) into v_related_task;
  end if;

  with inserted as (
    insert into public.task_activity (task_id, message)
    select v_task_id, message
    from unnest(array[p_activity_message, p_relation_activity_message]) as message
    where nullif(trim(coalesce(message, '')), '') is not null
    returning id, task_id, message, created_at
  )
  select coalesce(jsonb_agg(to_jsonb(inserted) order by inserted.id), '[]'::jsonb)
  into v_activities
  from inserted;

  insert into public.notification_events (
    type,
    actor_profile_id,
    recipient_profile_id,
    entity_type,
    entity_id,
    title,
    body
  )
  select
    notification.type,
    notification.actor_profile_id,
    notification.recipient_profile_id,
    notification.entity_type,
    notification.entity_id,
    notification.title,
    notification.body
  from jsonb_to_recordset(coalesce(p_notifications, '[]'::jsonb)) as notification(
    type text,
    actor_profile_id text,
    recipient_profile_id text,
    entity_type text,
    entity_id text,
    title text,
    body text
  );

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    after_data,
    request_ip,
    user_agent
  )
  values (
    p_actor_profile_id,
    'task.create',
    'task',
    v_task_id,
    v_insert,
    p_request_ip,
    p_user_agent
  );

  if v_relation is not null then
    insert into public.audit_log (
      actor_profile_id,
      action,
      entity_type,
      entity_id,
      after_data,
      request_ip,
      user_agent
    )
    values (
      p_actor_profile_id,
      'task.relationship_created',
      'task',
      v_task_id,
      v_relation,
      p_request_ip,
      p_user_agent
    );
  end if;

  return jsonb_build_object(
    'task', v_task,
    'relation', v_relation,
    'relatedTask', v_related_task,
    'activities', v_activities,
    'replayed', false
  );
end;
$_$;


ALTER FUNCTION "public"."create_task_transaction"("p_task_insert" "jsonb", "p_relation_type" "text", "p_related_task_id" "text", "p_relation_note" "text", "p_activity_message" "text", "p_relation_activity_message" "text", "p_notifications" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_task_transaction"("p_task_insert" "jsonb", "p_relation_type" "text", "p_related_task_id" "text", "p_relation_note" "text", "p_activity_message" "text", "p_relation_activity_message" "text", "p_notifications" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") IS 'Atomically creates a task with its optional first relationship, activity, notifications, and audit records.';



CREATE OR REPLACE FUNCTION "public"."create_team_planning_items_token"("p_profile_id" "text", "p_label" "text", "p_token_hash" "text", "p_token_hint" "text", "p_allow_updates" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_active_count integer;
  v_token public.team_task_intake_tokens%rowtype;
  v_scopes text[] := ARRAY[
    'read:planning-context',
    'write:planning-items:create'
  ]::text[];
begin
  if nullif(trim(coalesce(p_profile_id, '')), '') is null
     or char_length(trim(coalesce(p_label, ''))) not between 1 and 80
     or coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or char_length(coalesce(p_token_hint, '')) not between 4 and 16 then
    raise exception using errcode = '22023', message = 'planning items token input is invalid';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_profile_id
      and platform_role in ('ceo', 'deputy', 'founder')
  ) then
    raise exception using errcode = 'P0002', message = 'operational profile not found';
  end if;

  if p_allow_updates then
    v_scopes := v_scopes || ARRAY['write:planning-items:update']::text[];
  end if;

  perform pg_advisory_xact_lock(hashtextextended('planning-items-token:' || p_profile_id, 0));

  select count(*) into v_active_count
  from public.team_task_intake_tokens
  where profile_id = p_profile_id
    and revoked_at is null
    and expires_at > now();

  if v_active_count >= 3 then
    raise exception using errcode = 'P0003', message = 'active planning items token limit reached';
  end if;

  insert into public.team_task_intake_tokens (
    profile_id, label, token_hash, token_hint, scopes, expires_at
  ) values (
    p_profile_id, trim(p_label), p_token_hash, p_token_hint, v_scopes, now() + interval '90 days'
  ) returning * into v_token;

  return to_jsonb(v_token) - 'token_hash';
end;
$_$;


ALTER FUNCTION "public"."create_team_planning_items_token"("p_profile_id" "text", "p_label" "text", "p_token_hash" "text", "p_token_hint" "text", "p_allow_updates" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_team_planning_items_token_v2"("p_profile_id" "text", "p_label" "text", "p_token_hash" "text", "p_token_hint" "text", "p_allow_updates" boolean DEFAULT false, "p_allow_empty_epic_deletes" boolean DEFAULT false, "p_allow_github_sync" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_role text;
  v_token jsonb;
begin
  if coalesce(p_allow_empty_epic_deletes, false) then
    select platform_role into v_role from public.profiles where id = p_profile_id for share;
    if not found or v_role not in ('ceo', 'deputy') then
      raise exception using errcode = 'P0006', message = 'empty Epic delete token requires ceo or deputy';
    end if;
  end if;
  v_token := public.create_team_planning_items_token(
    p_profile_id, p_label, p_token_hash, p_token_hint, coalesce(p_allow_updates, false)
  );
  update public.team_task_intake_tokens token
  set scopes = token.scopes
    || case when coalesce(p_allow_empty_epic_deletes, false)
      and not ('write:planning-items:delete-empty' = any(token.scopes))
      then array['write:planning-items:delete-empty']::text[] else '{}'::text[] end
    || case when coalesce(p_allow_github_sync, false)
      and not ('write:planning-items:github-sync' = any(token.scopes))
      then array['write:planning-items:github-sync']::text[] else '{}'::text[] end
  where token.id = (v_token->>'id')::uuid
  returning to_jsonb(token) - 'token_hash' into v_token;
  return v_token;
end;
$$;


ALTER FUNCTION "public"."create_team_planning_items_token_v2"("p_profile_id" "text", "p_label" "text", "p_token_hash" "text", "p_token_hint" "text", "p_allow_updates" boolean, "p_allow_empty_epic_deletes" boolean, "p_allow_github_sync" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_team_planning_items_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_idempotency_key" "uuid", "p_request_hash" "text", "p_items" "jsonb", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_batch public.team_task_intake_batches%rowtype;
  v_role text;
  v_item jsonb;
  v_index integer;
  v_type text;
  v_id text;
  v_title text;
  v_owner text;
  v_parent_id text;
  v_parent public.tasks%rowtype;
  v_status text;
  v_sort_order integer;
  v_raci jsonb := '[]'::jsonb;
  v_result jsonb;
  v_entity jsonb;
  v_task_insert jsonb;
  v_ids text[] := array[]::text[];
  v_entities jsonb := '[]'::jsonb;
begin
  if p_token_id is null
     or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or p_idempotency_key is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$'
     or p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception using errcode = '22023', message = 'planning items create input is invalid';
  end if;

  select * into v_token
  from public.team_task_intake_tokens
  where id = p_token_id
    and profile_id = p_profile_id
    and revoked_at is null
    and expires_at > now()
  for update;
  if not found then raise exception using errcode = 'P0004', message = 'planning items token is inactive'; end if;
  if not ('write:planning-items:create' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning items create scope is missing';
  end if;

  select platform_role into v_role from public.profiles where id = p_profile_id for share;
  if not found or v_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'planning items profile role is not allowed';
  end if;
  if v_role not in ('ceo', 'deputy') and exists (
    select 1
    from jsonb_array_elements(p_items) item(value)
    where item.value->>'itemType' in ('epic', 'milestone', 'initiative')
  ) then
    raise exception using errcode = 'P0006', message = 'strategic planning item creation requires ceo or deputy';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('planning-items-create:' || p_token_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_batch
  from public.team_task_intake_batches
  where token_id = p_token_id and idempotency_key = p_idempotency_key;
  if found then
    if v_batch.request_hash <> p_request_hash then
      raise exception using errcode = 'P0003', message = 'idempotency key conflict';
    end if;
    return jsonb_build_object('batchId', v_batch.id, 'replayed', true, 'items', v_batch.response_tasks);
  end if;

  for v_item, v_index in
    select value, ordinality::integer from jsonb_array_elements(p_items) with ordinality
  loop
    v_type := case nullif(trim(v_item->>'itemType'), '') when 'milestone' then 'epic' else nullif(trim(v_item->>'itemType'), '') end;
    v_id := p_profile_id || '-planning-items-v1-' || replace(p_idempotency_key::text, '-', '') || '-' || v_index::text;
    v_title := nullif(trim(coalesce(v_item->>'title', '')), '');
    v_owner := nullif(trim(coalesce(v_item->>'ownerId', '')), '');
    v_parent_id := nullif(trim(coalesce(v_item->>'parentTaskId', '')), '');
    v_status := coalesce(nullif(trim(v_item->>'status'), ''), 'Offen');

    if v_type not in ('epic', 'initiative', 'deliverable', 'sub_issue')
       or v_title is null then
      raise exception using errcode = '22023', message = 'planning items item type or title is invalid';
    end if;
    if v_type in ('epic', 'initiative') and v_owner is null then
      raise exception using errcode = '22023', message = 'strategic planning item owner is required';
    end if;
    if v_owner is null then v_owner := p_profile_id; end if;
    if not exists (select 1 from public.profiles where id = v_owner) then
      raise exception using errcode = '23503', message = 'planning item owner was not found';
    end if;
    if (v_type in ('epic', 'initiative') and v_status not in ('Offen', 'In Arbeit', 'Pausiert', 'Blockiert', 'Erledigt'))
       or (v_type = 'deliverable' and v_status not in ('Offen', 'In Arbeit', 'Review', 'Nacharbeit', 'Blockiert', 'Erledigt'))
       or (v_type = 'sub_issue' and v_status not in ('Offen', 'In Arbeit', 'Blockiert', 'Erledigt')) then
      raise exception using errcode = '22023', message = 'planning item status is invalid';
    end if;
    if v_type in ('epic', 'initiative') and v_item ? 'githubSync' then
      raise exception using errcode = '22023', message = 'strategic planning items do not support GitHub sync';
    end if;

    if v_type = 'epic' and v_parent_id is not null then
      raise exception using errcode = '23514', message = 'epic cannot have a parent';
    end if;
    if v_type = 'initiative' and v_parent_id is not null then
      select * into v_parent from public.tasks where id = v_parent_id and trashed_at is null for share;
      if not found or v_parent.task_type <> 'epic' then
        raise exception using errcode = '23514', message = 'initiative parent must be an active epic';
      end if;
    end if;
    if v_type = 'deliverable' and v_parent_id is not null then
      select * into v_parent from public.tasks where id = v_parent_id and trashed_at is null for share;
      if not found or v_parent.task_type <> 'initiative' then
        raise exception using errcode = '23514', message = 'deliverable parent must be an active initiative';
      end if;
      if v_parent.approval_status = 'rejected' then
        raise exception using errcode = '23514', message = 'deliverable parent initiative is rejected';
      end if;
    end if;
    if v_type = 'sub_issue' then
      if v_parent_id is null then
        raise exception using errcode = '23514', message = 'sub-issue requires a deliverable parent';
      end if;
      select * into v_parent from public.tasks where id = v_parent_id and trashed_at is null for share;
      if not found or v_parent.task_type <> 'deliverable' or v_parent.approval_status <> 'approved' then
        raise exception using errcode = '23514', message = 'sub-issue parent must be an approved deliverable';
      end if;
    end if;

    perform pg_advisory_xact_lock(hashtextextended('planning-sort:' || v_type, 0));
    select coalesce(max(sort_order) + 1, 1) into v_sort_order
    from public.tasks
    where project_id = 'findmydoc-founder-execution'
      and task_type = v_type
      and trashed_at is null;

    if v_type in ('epic', 'initiative') then
      select coalesce(jsonb_agg(assignment order by assignment->>'role', (assignment->>'sortOrder')::integer), '[]'::jsonb)
      into v_raci
      from (
        select jsonb_build_object('profileId', nullif(v_item->>'accountableProfileId', ''), 'role', 'accountable', 'sortOrder', 0) as assignment
        where nullif(v_item->>'accountableProfileId', '') is not null
        union all
        select jsonb_build_object('profileId', value, 'role', 'responsible', 'sortOrder', ordinality::integer - 1)
        from jsonb_array_elements_text(coalesce(v_item->'responsibleProfileIds', '[]'::jsonb)) with ordinality
        union all
        select jsonb_build_object('profileId', value, 'role', 'consulted', 'sortOrder', ordinality::integer - 1)
        from jsonb_array_elements_text(coalesce(v_item->'consultedProfileIds', '[]'::jsonb)) with ordinality
        union all
        select jsonb_build_object('profileId', value, 'role', 'informed', 'sortOrder', ordinality::integer - 1)
        from jsonb_array_elements_text(coalesce(v_item->'informedProfileIds', '[]'::jsonb)) with ordinality
      ) assignments;
      v_result := public.create_planning_item_transaction(
        jsonb_build_object(
          'id', v_id,
          'project_id', 'findmydoc-founder-execution',
          'task_type', v_type,
          'title', v_title,
          'description', coalesce(v_item->>'description', ''),
          'status', v_status,
          'priority', case when v_type = 'initiative' then coalesce(nullif(v_item->>'priority', ''), 'P2') else null end,
          'owner', v_owner,
          'assignee', v_owner,
          'parent_task_id', v_parent_id,
          'target_date', nullif(v_item->>'targetDate', ''),
          'sort_order', v_sort_order
        ),
        case when v_type = 'initiative' then jsonb_build_object(
          'goal', coalesce(nullif(v_item->>'intendedOutcome', ''), v_item->>'description', ''),
          'successCriteria', coalesce(v_item->>'acceptanceCriteria', ''),
          'scopeConstraints', coalesce(v_item->>'scopeConstraints', '')
        ) else null end,
        case when v_type = 'initiative' then v_raci else '[]'::jsonb end,
        p_profile_id
      );
      v_entity := v_result->'task';
      if v_type = 'initiative' then
        v_entity := v_entity || jsonb_build_object(
          'goal', coalesce(nullif(v_item->>'intendedOutcome', ''), v_item->>'description', ''),
          'success_criteria', coalesce(v_item->>'acceptanceCriteria', ''),
          'scope_constraints', coalesce(v_item->>'scopeConstraints', ''),
          'raci_assignments', v_raci
        );
      end if;
    else
      v_task_insert := jsonb_build_object(
        'id', v_id,
        'creation_request_id', 'planning-items:' || p_token_id::text || ':' || p_idempotency_key::text || ':' || v_index::text,
        'project_id', 'findmydoc-founder-execution',
        'title', v_title,
        'description', coalesce(v_item->>'description', ''),
        'problem_statement', coalesce(v_item->>'problemStatement', ''),
        'intended_outcome', coalesce(v_item->>'intendedOutcome', ''),
        'scope_constraints', coalesce(v_item->>'scopeConstraints', ''),
        'acceptance_criteria', coalesce(v_item->>'acceptanceCriteria', ''),
        'evidence_required', coalesce(v_item->>'evidenceRequired', ''),
        'definition_of_done', coalesce(v_item->>'definitionOfDone', ''),
        'status', v_status,
        'priority', case when v_type = 'sub_issue' then 'P2' else coalesce(nullif(v_item->>'priority', ''), 'P2') end,
        'owner', v_owner,
        'assignee', v_owner,
        'created_by', p_profile_id,
        'workstream', coalesce(v_item->>'workstream', ''),
        'sort_order', v_sort_order,
        'start_date', nullif(v_item->>'startDate', ''),
        'end_date', nullif(v_item->>'endDate', ''),
        'deadline', nullif(v_item->>'deadline', ''),
        'estimate_hours', case when coalesce(v_item->>'hours', '') ~ '^[0-9]+$' then (v_item->>'hours')::integer else 0 end,
        'sprint_id', null,
        'review_status', 'not_requested',
        'score_points', 0,
        'score_final', false,
        'github_repo', coalesce(nullif(v_item->>'githubRepo', ''), 'findmydoc-platform/management'),
        'task_type', v_type,
        'parent_task_id', v_parent_id,
        'approval_status', case when v_type = 'deliverable' then 'proposed' else null end,
        'approval_revision', 1,
        'proposed_by', case when v_type = 'deliverable' then p_profile_id else null end,
        'proposed_at', case when v_type = 'deliverable' then now() else null end,
        'score_relevant', false
      );
      v_result := public.create_planning_task_transaction(
        v_task_insert, null, null, null,
        case when v_type = 'sub_issue' then 'Sub-Issue created through Planning Items API' else 'Deliverable proposed through Planning Items API' end,
        null, '[]'::jsonb, p_profile_id, p_request_ip, p_user_agent, false
      );
      v_entity := v_result->'task';
    end if;

    v_ids := array_append(v_ids, v_id);
    v_entities := v_entities || jsonb_build_array(jsonb_build_object('itemType', v_type, 'item', v_entity));
  end loop;

  insert into public.team_task_intake_batches (token_id, profile_id, idempotency_key, request_hash, task_ids, response_tasks)
  values (p_token_id, p_profile_id, p_idempotency_key, p_request_hash, v_ids, v_entities)
  returning * into v_batch;
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, after_data, request_ip, user_agent)
  values (p_profile_id, 'team.planning_items.create', 'team_planning_items_batch', v_batch.id::text,
    jsonb_build_object('tokenId', p_token_id, 'entityIds', v_ids), p_request_ip, p_user_agent);
  return jsonb_build_object('batchId', v_batch.id, 'replayed', false, 'items', v_entities);
end;
$_$;


ALTER FUNCTION "public"."create_team_planning_items_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_idempotency_key" "uuid", "p_request_hash" "text", "p_items" "jsonb", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_team_planning_items_with_projection_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_idempotency_key" "uuid", "p_request_hash" "text", "p_items" "jsonb", "p_projection_commands" "jsonb" DEFAULT '[]'::"jsonb", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_result jsonb;
  v_items jsonb;
  v_command jsonb;
  v_request public.planning_github_projection_outbox%rowtype;
  v_operation_id text := 'team-create:' || p_token_id::text || ':' || p_idempotency_key::text;
  v_index integer;
begin
  if jsonb_typeof(coalesce(p_projection_commands, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_projection_commands, '[]'::jsonb)) not in (0, jsonb_array_length(p_items)) then
    raise exception using errcode = '22023', message = 'planning github projection commands are invalid';
  end if;
  v_result := public.create_team_planning_items_transaction(
    p_token_id, p_profile_id, p_idempotency_key, p_request_hash, p_items,
    p_request_ip, p_user_agent
  );
  v_items := v_result->'items';
  if not coalesce((v_result->>'replayed')::boolean, false) then
    for v_command, v_index in
      select value, ordinality::integer - 1
      from jsonb_array_elements(coalesce(p_projection_commands, '[]'::jsonb)) with ordinality
    loop
      if jsonb_typeof(v_command) = 'object' then
        v_request := public.enqueue_planning_github_projection_request(
          v_operation_id,
          v_items->v_index->'item'->>'id',
          p_profile_id,
          coalesce((v_command->>'createIfMissing')::boolean, false),
          'team_create', p_token_id, p_idempotency_key, v_index
        );
        v_items := jsonb_set(v_items, array[v_index::text, 'githubSync'],
          jsonb_build_object('status', 'accepted'), true);
      end if;
    end loop;
    update public.team_task_intake_batches
    set response_tasks = v_items
    where token_id = p_token_id and idempotency_key = p_idempotency_key;
    v_result := jsonb_set(v_result, '{items}', v_items, true);
  end if;
  return v_result || jsonb_build_object('projectionOperationId', v_operation_id);
end;
$$;


ALTER FUNCTION "public"."create_team_planning_items_with_projection_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_idempotency_key" "uuid", "p_request_hash" "text", "p_items" "jsonb", "p_projection_commands" "jsonb", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_team_planning_items_with_projection_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_idempotency_key" "uuid", "p_request_hash" "text", "p_items" "jsonb", "p_projection_commands" "jsonb", "p_request_ip" "text", "p_user_agent" "text") IS 'Atomically commits Team Planning Items and durable GitHub projection requests.';



CREATE OR REPLACE FUNCTION "public"."create_team_task_intake_token"("p_profile_id" "text", "p_label" "text", "p_token_hash" "text", "p_token_hint" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_active_count integer;
  v_token public.team_task_intake_tokens%rowtype;
begin
  if nullif(trim(coalesce(p_profile_id, '')), '') is null
     or char_length(trim(coalesce(p_label, ''))) not between 1 and 80
     or coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or char_length(coalesce(p_token_hint, '')) not between 4 and 16 then
    raise exception using errcode = '22023', message = 'team intake token input is invalid';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_profile_id
      and platform_role in ('ceo', 'deputy', 'founder')
  ) then
    raise exception using errcode = 'P0002', message = 'operational profile not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('team-intake-token:' || p_profile_id, 0));

  select count(*)
  into v_active_count
  from public.team_task_intake_tokens
  where profile_id = p_profile_id
    and revoked_at is null
    and expires_at > now();

  if v_active_count >= 3 then
    raise exception using errcode = 'P0003', message = 'active team intake token limit reached';
  end if;

  insert into public.team_task_intake_tokens (
    profile_id,
    label,
    token_hash,
    token_hint,
    expires_at
  ) values (
    p_profile_id,
    trim(p_label),
    p_token_hash,
    p_token_hint,
    now() + interval '90 days'
  )
  returning * into v_token;

  return to_jsonb(v_token) - 'token_hash';
end;
$_$;


ALTER FUNCTION "public"."create_team_task_intake_token"("p_profile_id" "text", "p_label" "text", "p_token_hash" "text", "p_token_hint" "text") OWNER TO "postgres";


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
      and effective_to is null
  ) then
    raise exception using errcode = 'P0004', message = 'confirmed workweek changed before conflict capture';
  end if;
  if not exists (
    select 1 from public.team_workweek_versions as version
    where version.id = p_founderops_version_id
      and version.owner_profile_id = p_owner_profile_id
      and version.origin = 'owner'
      and not exists (
        select 1 from public.team_workweek_publications as publication
        where publication.source_version_id = version.id
      )
      and version.id = (
        select candidate.id
        from public.team_workweek_versions as candidate
        where candidate.owner_profile_id = p_owner_profile_id
          and candidate.origin = 'owner'
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


ALTER FUNCTION "public"."create_team_workweek_google_conflict"("p_owner_profile_id" "text", "p_base_publication_id" "uuid", "p_base_publication_revision" integer, "p_founderops_version_id" "uuid", "p_google_effective_from" "date", "p_google_windows" "jsonb", "p_google_observations" "jsonb", "p_google_fingerprint" "text", "p_founderops_fingerprint" "text", "p_observed_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_platform_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select profile.platform_role
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
$$;


ALTER FUNCTION "public"."current_platform_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_profile_id"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select profile.id
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
$$;


ALTER FUNCTION "public"."current_profile_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_profile_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select profile.role
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
$$;


ALTER FUNCTION "public"."current_profile_role"() OWNER TO "postgres";


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

  insert into public.google_workspace_disconnect_series (
    operation_id, series_id, calendar_id, google_event_id, expected_etag,
    expected_founderops_revision, cleanup_action, recurrence_count
  )
  select v_operation.id, series.id, series.calendar_id, series.google_event_id,
    series.confirmed_etag, series.confirmed_founderops_revision,
    case when publication.effective_from >= v_cutoff then 'delete' else 'truncate' end,
    case when publication.effective_from >= v_cutoff then null else (v_cutoff - publication.effective_from) / 7 end
  from public.team_workweek_google_series as series
  join public.team_workweek_publications as publication on publication.id = series.publication_id
  where publication.owner_profile_id = p_owner_profile_id
    and publication.status = 'published'
    and (publication.effective_to is null or publication.effective_to >= v_cutoff)
    and series.state = 'confirmed'
    and series.provider_state = 'active'
  on conflict (operation_id, series_id) do nothing;

  update public.team_workweek_publications
  set status = 'inactive', deactivated_at = p_observed_at, deactivation_reason = 'external_revocation'
  where owner_profile_id = p_owner_profile_id
    and status in ('published', 'preparing')
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


ALTER FUNCTION "public"."deactivate_team_workweek_for_external_revocation"("p_owner_profile_id" "text", "p_excluded_publication_id" "uuid", "p_observed_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decide_planning_item_approval_transaction"("p_task_id" "text", "p_expected_revision" integer, "p_action" "text", "p_actor_profile_id" "text", "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_actor_role text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_next_status text;
  v_accountable_count integer;
  v_responsible_count integer;
begin
  if p_action not in ('approve', 'reject', 'return_to_draft')
     or p_expected_revision is null
     or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'planning approval input is invalid';
  end if;
  if char_length(v_note) > 2000 then
    raise exception using errcode = '22023', message = 'approval decision note exceeds 2000 characters';
  end if;
  if p_action in ('reject', 'return_to_draft') and v_note is null then
    raise exception using errcode = '22023', message = 'approval decision note is required';
  end if;

  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  if not found then
    raise exception using errcode = 'P0006', message = 'approval actor not found';
  end if;
  if v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'only ceo or deputy may decide planning approval';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_task.task_type not in ('initiative', 'deliverable') then
    raise exception using errcode = '22023', message = 'planning item has no approval lifecycle';
  end if;
  if v_task.trashed_at is not null then
    raise exception using errcode = 'P0003', message = 'planning item is trashed';
  end if;
  if v_task.approval_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'planning approval revision changed';
  end if;
  if v_task.approval_status <> 'proposed' then
    raise exception using errcode = 'P0003', message = 'planning item is not proposed';
  end if;

  if p_action = 'approve' then
    if v_task.parent_task_id is null then
      raise exception using errcode = '23514', message = 'approved planning item requires a parent';
    end if;
    select * into v_parent from public.tasks where id = v_task.parent_task_id and trashed_at is null for share;
    if not found then
      raise exception using errcode = '23514', message = 'planning item parent was not found';
    end if;
    if v_task.task_type = 'initiative' then
      if v_parent.task_type <> 'epic' then
        raise exception using errcode = '23514', message = 'initiative parent must be an epic';
      end if;
      select count(*) filter (where role = 'accountable'), count(*) filter (where role = 'responsible')
      into v_accountable_count, v_responsible_count
      from public.planning_item_raci_assignments
      where task_id = p_task_id;
      if v_accountable_count <> 1 or v_responsible_count < 1 then
        raise exception using errcode = '23514', message = 'initiative approval requires one accountable and at least one responsible RACI assignment';
      end if;
    elsif v_parent.task_type <> 'initiative' or v_parent.approval_status <> 'approved' then
      raise exception using errcode = '23514', message = 'deliverable approval requires an approved initiative';
    end if;
  end if;

  if p_action = 'reject' then
    update public.tasks
    set approval_status = 'rejected',
        approval_revision = approval_revision + 1,
        decided_by = p_actor_profile_id,
        decided_at = now(),
        decision_note = v_note,
        updated_at = clock_timestamp()
    where id = p_task_id
    returning * into v_task;
    insert into public.task_activity (task_id, message)
    values (p_task_id, case when v_task.task_type = 'initiative'
      then 'Initiative abgelehnt · Revision ' || v_task.approval_revision
      else 'Deliverable abgelehnt · Revision ' || v_task.approval_revision end);
  else
    v_next_status := case p_action when 'approve' then 'approved' else 'draft' end;
    update public.tasks
    set approval_status = v_next_status,
        approval_revision = approval_revision + 1,
        decided_by = case when p_action = 'approve' then p_actor_profile_id else null end,
        decided_at = case when p_action = 'approve' then now() else null end,
        decision_note = v_note,
        sprint_id = case when p_action = 'approve' then sprint_id else null end,
        review_status = case when p_action = 'approve' then review_status else 'not_requested' end,
        review_requested_at = case when p_action = 'approve' then review_requested_at else null end,
        score_points = case when p_action = 'approve' then score_points else 0 end,
        score_final = case when p_action = 'approve' then score_final else false end,
        github_issue_sync_status = case when task_type = 'deliverable' then 'not_synced' else 'not_applicable' end,
        github_issue_sync_error = null,
        updated_at = clock_timestamp()
    where id = p_task_id
    returning * into v_task;
    insert into public.task_activity (task_id, message)
    values (p_task_id, case p_action
      when 'approve' then case when v_task.task_type = 'initiative' then 'Initiative freigegeben · Revision ' else 'Deliverable freigegeben · Revision ' end || v_task.approval_revision
      else case when v_task.task_type = 'initiative' then 'Initiative zur Überarbeitung zurückgegeben · Revision ' else 'Deliverable zur Überarbeitung zurückgegeben · Revision ' end || v_task.approval_revision || ' · Begründung: ' || v_note
    end);
  end if;

  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
  values (
    p_actor_profile_id,
    'planning_item.approval_' || p_action,
    'task',
    p_task_id,
    jsonb_build_object('approvalStatus', 'proposed', 'revision', p_expected_revision),
    jsonb_build_object('approvalStatus', v_task.approval_status, 'revision', v_task.approval_revision, 'note', v_note)
  );

  return jsonb_build_object('task', to_jsonb(v_task));
end;
$$;


ALTER FUNCTION "public"."decide_planning_item_approval_transaction"("p_task_id" "text", "p_expected_revision" integer, "p_action" "text", "p_actor_profile_id" "text", "p_note" "text") OWNER TO "postgres";


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
    set sync_state = 'delayed'
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


ALTER FUNCTION "public"."delay_team_workweek_publication"("p_publication_id" "uuid", "p_error_class" "text", "p_observed_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_empty_epic_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_role text;
  v_epic public.tasks%rowtype;
  v_deleted public.tasks%rowtype;
  v_initiative_count bigint := 0;
  v_task_count bigint := 0;
begin
  if nullif(trim(coalesce(p_task_id, '')), '') is null or p_expected_updated_at is null
     or nullif(trim(coalesce(p_actor_profile_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'empty epic delete input is invalid';
  end if;
  select platform_role into v_role from public.profiles where id = p_actor_profile_id for share;
  if not found or v_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'empty epic deletion requires ceo or deputy';
  end if;
  select * into v_epic from public.tasks
  where id = p_task_id and project_id = 'findmydoc-founder-execution'
    and task_type = 'epic' and trashed_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  if v_epic.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;
  with recursive descendants as (
    select id, task_type from public.tasks where parent_task_id = p_task_id and trashed_at is null
    union all
    select child.id, child.task_type
    from public.tasks child join descendants parent on child.parent_task_id = parent.id
    where child.trashed_at is null
  )
  select count(*) filter (where task_type = 'initiative'),
    count(*) filter (where task_type in ('deliverable', 'sub_issue'))
  into v_initiative_count, v_task_count from descendants;
  if v_initiative_count > 0 or v_task_count > 0 then
    raise exception using errcode = 'P0008', message = 'epic is not empty', detail = jsonb_build_object(
      'children', jsonb_build_object('initiatives', v_initiative_count, 'tasks', v_task_count)
    )::text;
  end if;
  perform set_config('founderops.trash_lifecycle_write', 'on', true);
  delete from public.tasks where id = p_task_id and updated_at = p_expected_updated_at returning * into v_deleted;
  if not found then raise exception using errcode = 'P0001', message = 'planning item was changed concurrently'; end if;
  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  return jsonb_build_object('task', to_jsonb(v_deleted));
exception when others then
  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  raise;
end;
$$;


ALTER FUNCTION "public"."delete_empty_epic_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_empty_epic_with_audit_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_result jsonb;
  v_task jsonb;
begin
  select public.delete_empty_epic_transaction(
    p_task_id,
    p_expected_updated_at,
    p_actor_profile_id
  ) into v_result;
  v_task := v_result->'task';
  if v_task is null then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    request_ip,
    user_agent
  ) values (
    p_actor_profile_id,
    'milestone.delete',
    'milestone',
    p_task_id,
    v_task,
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'replayed', false,
    'itemType', 'epic',
    'item', v_task,
    'children', jsonb_build_object('initiatives', 0, 'tasks', 0)
  );
end;
$$;


ALTER FUNCTION "public"."delete_empty_epic_with_audit_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_team_planning_item_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_id" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_request public.team_planning_item_delete_requests%rowtype;
  v_role text;
  v_epic public.tasks%rowtype;
  v_deleted public.tasks%rowtype;
  v_initiative_count bigint := 0;
  v_task_count bigint := 0;
  v_response jsonb;
begin
  if p_token_id is null or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or nullif(trim(coalesce(p_item_id, '')), '') is null or p_expected_updated_at is null
     or p_idempotency_key is null or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'epic delete input is invalid';
  end if;
  select * into v_token from public.team_task_intake_tokens
  where id = p_token_id and profile_id = p_profile_id and revoked_at is null and expires_at > now() for update;
  if not found then raise exception using errcode = 'P0004', message = 'planning items token is inactive'; end if;
  if not ('write:planning-items:delete-empty' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning items epic delete scope is missing';
  end if;
  select platform_role into v_role from public.profiles where id = p_profile_id for share;
  if not found or v_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'epic deletion requires ceo or deputy';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'planning-items-epic-delete:' || p_token_id::text || ':' || p_idempotency_key::text, 0
  ));
  select * into v_request from public.team_planning_item_delete_requests
  where token_id = p_token_id and idempotency_key = p_idempotency_key;
  if found then
    if v_request.request_hash <> p_request_hash or v_request.item_id <> p_item_id
       or v_request.expected_updated_at is distinct from p_expected_updated_at then
      raise exception using errcode = 'P0003', message = 'idempotency key conflict';
    end if;
    return jsonb_set(v_request.response, '{replayed}', 'true'::jsonb, true);
  end if;
  select * into v_epic from public.tasks
  where id = p_item_id and project_id = 'findmydoc-founder-execution'
    and task_type = 'epic' and trashed_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  if v_epic.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;
  with recursive descendants as (
    select id, task_type from public.tasks where parent_task_id = p_item_id and trashed_at is null
    union all
    select child.id, child.task_type from public.tasks child
    join descendants parent on child.parent_task_id = parent.id where child.trashed_at is null
  )
  select count(*) filter (where task_type = 'initiative'),
    count(*) filter (where task_type in ('deliverable', 'sub_issue'))
  into v_initiative_count, v_task_count from descendants;
  if v_initiative_count > 0 or v_task_count > 0 then
    raise exception using errcode = 'P0008', message = 'epic is not empty', detail = jsonb_build_object(
      'children', jsonb_build_object('initiatives', v_initiative_count, 'tasks', v_task_count)
    )::text;
  end if;
  perform set_config('founderops.trash_lifecycle_write', 'on', true);
  delete from public.tasks where id = p_item_id and updated_at = p_expected_updated_at returning * into v_deleted;
  if not found then raise exception using errcode = 'P0001', message = 'planning item was changed concurrently'; end if;
  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  v_response := jsonb_build_object('replayed', false, 'itemType', 'epic', 'item', to_jsonb(v_deleted),
    'children', jsonb_build_object('initiatives', 0, 'tasks', 0));
  insert into public.team_planning_item_delete_requests (
    token_id, profile_id, item_id, expected_updated_at, idempotency_key, request_hash, response, contract_version
  ) values (
    p_token_id, p_profile_id, p_item_id, p_expected_updated_at, p_idempotency_key, p_request_hash, v_response, 2
  );
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, request_ip, user_agent)
  values (p_profile_id, 'team.planning_items.epic_delete', 'task', p_item_id, to_jsonb(v_epic), p_request_ip, p_user_agent);
  return v_response;
exception when others then
  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  raise;
end;
$_$;


ALTER FUNCTION "public"."delete_team_planning_item_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_id" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_team_workweek_version_boundary"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_latest_effective_from date;
begin
  select max(publication.effective_from)
  into v_latest_effective_from
  from public.team_workweek_publications as publication
  where publication.owner_profile_id = new.owner_profile_id
    and publication.status = 'published';

  if v_latest_effective_from is not null and new.effective_from <= v_latest_effective_from then
    raise exception using errcode = '22023', message = 'new workweek version must start after the latest published boundary';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_team_workweek_version_boundary"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_github_webhook_planning_projection"("p_delivery_id" "text", "p_lock_token" "uuid", "p_task_id" "text", "p_observed_repository_full_name" "text" DEFAULT NULL::"text", "p_observed_issue_number" integer DEFAULT NULL::integer) RETURNS "public"."planning_github_projection_outbox"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_delivery public.github_planning_webhook_deliveries%rowtype;
  v_task public.tasks%rowtype;
  v_actor_profile_id text;
  v_mapping_count integer;
  v_mapping_task_id text;
  v_related_mapping_count integer := 0;
  v_related_mapping_task_id text;
  v_observed_repository_full_name text := lower(nullif(trim(coalesce(p_observed_repository_full_name, '')), ''));
  v_task_reference record;
  v_request public.planning_github_projection_outbox%rowtype;
begin
  select * into v_delivery
  from public.github_planning_webhook_deliveries
  where delivery_id = p_delivery_id and status = 'processing' and lock_token = p_lock_token
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'active GitHub planning delivery lock was not found';
  end if;

  select * into v_task from public.tasks
  where id = p_task_id and trashed_at is null
  for share;
  if not found or v_task.task_type not in ('deliverable', 'sub_issue') then
    raise exception using errcode = 'P0014', message = 'GitHub planning projection target is not eligible';
  end if;

  if v_delivery.event_name = 'projects_v2_item' then
    if v_observed_repository_full_name is null or p_observed_issue_number is null or p_observed_issue_number < 1 then
      raise exception using errcode = '22023', message = 'observed Project Issue identity is required';
    end if;
    select * into v_task_reference
    from public.normalize_planning_github_issue_reference(
      v_task.task_type,
      v_task.github_repo,
      v_task.github_issue_number,
      v_task.issue_number,
      v_task.github_issue_url,
      v_task.issue_url
    );
    if v_task_reference.reference_status <> 'valid'
       or v_task_reference.normalized_repo <> v_observed_repository_full_name
       or v_task_reference.normalized_issue_number <> p_observed_issue_number then
      raise exception using errcode = 'P0003', message = 'GitHub Project Issue task mapping changed before projection';
    end if;
  else
    if v_delivery.repository_full_name is null or v_delivery.issue_number is null then
      raise exception using errcode = '22023', message = 'GitHub planning delivery has no Issue identity';
    end if;
    select count(*)::integer, min(mapping.task_id)
    into v_mapping_count, v_mapping_task_id
    from public.resolve_github_planning_webhook_tasks(
      v_delivery.repository_full_name,
      v_delivery.issue_number
    ) mapping;
    if v_delivery.related_repository_full_name is not null and v_delivery.related_issue_number is not null then
      select count(*)::integer, min(mapping.task_id)
      into v_related_mapping_count, v_related_mapping_task_id
      from public.resolve_github_planning_webhook_tasks(
        v_delivery.related_repository_full_name,
        v_delivery.related_issue_number
      ) mapping;
    end if;
    if not (
      (v_mapping_count = 1 and v_mapping_task_id = p_task_id)
      or (v_related_mapping_count = 1 and v_related_mapping_task_id = p_task_id)
    ) then
      raise exception using errcode = 'P0003', message = 'GitHub Issue task mapping changed before projection';
    end if;
  end if;

  select actor.profile_id into v_actor_profile_id
  from public.resolve_github_planning_webhook_actor(v_delivery.sender_id) actor;

  insert into public.planning_github_projection_outbox (
    planning_operation_id,
    task_id,
    actor_profile_id,
    source_revision_token,
    create_if_missing,
    source_kind,
    source_delivery_id
  ) values (
    'github-webhook:' || v_delivery.delivery_id,
    v_task.id,
    v_actor_profile_id,
    v_task.updated_at::text,
    false,
    'github_webhook',
    v_delivery.delivery_id
  )
  on conflict (planning_operation_id, task_id) do nothing
  returning * into v_request;

  if v_request.id is null then
    select * into v_request from public.planning_github_projection_outbox
    where planning_operation_id = 'github-webhook:' || v_delivery.delivery_id
      and task_id = v_task.id;
  end if;
  return v_request;
end;
$$;


ALTER FUNCTION "public"."enqueue_github_webhook_planning_projection"("p_delivery_id" "text", "p_lock_token" "uuid", "p_task_id" "text", "p_observed_repository_full_name" "text", "p_observed_issue_number" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enqueue_github_webhook_planning_projection"("p_delivery_id" "text", "p_lock_token" "uuid", "p_task_id" "text", "p_observed_repository_full_name" "text", "p_observed_issue_number" integer) IS 'Durably restores the FounderOps desired state for one linked GitHub Issue without treating the App identity as a human actor.';



CREATE OR REPLACE FUNCTION "public"."enqueue_planning_github_projection_request"("p_planning_operation_id" "text", "p_task_id" "text", "p_actor_profile_id" "text", "p_create_if_missing" boolean, "p_receipt_kind" "text" DEFAULT NULL::"text", "p_receipt_token_id" "uuid" DEFAULT NULL::"uuid", "p_receipt_idempotency_key" "uuid" DEFAULT NULL::"uuid", "p_receipt_item_index" integer DEFAULT NULL::integer) RETURNS "public"."planning_github_projection_outbox"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_request public.planning_github_projection_outbox%rowtype;
begin
  if nullif(trim(coalesce(p_planning_operation_id, '')), '') is null
     or nullif(trim(coalesce(p_task_id, '')), '') is null
     or nullif(trim(coalesce(p_actor_profile_id, '')), '') is null
     or p_create_if_missing is null then
    raise exception using errcode = '22023', message = 'planning github projection input is invalid';
  end if;

  select * into v_task from public.tasks
  where id = p_task_id and trashed_at is null
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning github projection task was not found';
  end if;
  if v_task.task_type not in ('deliverable', 'sub_issue') then
    raise exception using errcode = 'P0014', message = 'planning github projection target is not eligible';
  end if;
  if v_task.task_type = 'deliverable' and v_task.approval_status is distinct from 'approved' then
    raise exception using errcode = 'P0014', message = 'planning github projection deliverable is not approved';
  end if;
  if v_task.task_type = 'sub_issue' then
    select * into v_parent from public.tasks
    where id = v_task.parent_task_id and task_type = 'deliverable' and trashed_at is null
    for share;
    if not found or v_parent.approval_status is distinct from 'approved' then
      raise exception using errcode = 'P0014', message = 'planning github projection parent is not approved';
    end if;
  end if;
  if not p_create_if_missing
     and v_task.github_issue_number is null
     and coalesce(trim(v_task.issue_number), '') !~ '^[1-9][0-9]*$' then
    raise exception using errcode = 'P0015', message = 'planning github projection requires an existing issue';
  end if;

  insert into public.planning_github_projection_outbox (
    planning_operation_id, task_id, actor_profile_id, source_revision_token,
    create_if_missing, receipt_kind, receipt_token_id, receipt_idempotency_key,
    receipt_item_index
  ) values (
    p_planning_operation_id, p_task_id, p_actor_profile_id, v_task.updated_at::text,
    p_create_if_missing, p_receipt_kind, p_receipt_token_id,
    p_receipt_idempotency_key, p_receipt_item_index
  )
  on conflict (planning_operation_id, task_id) do nothing
  returning * into v_request;

  if v_request.id is null then
    select * into v_request from public.planning_github_projection_outbox
    where planning_operation_id = p_planning_operation_id and task_id = p_task_id;
    if v_request.actor_profile_id is distinct from p_actor_profile_id
       or v_request.create_if_missing is distinct from p_create_if_missing then
      raise exception using errcode = 'P0003', message = 'planning github projection idempotency conflict';
    end if;
  end if;
  return v_request;
end;
$_$;


ALTER FUNCTION "public"."enqueue_planning_github_projection_request"("p_planning_operation_id" "text", "p_task_id" "text", "p_actor_profile_id" "text", "p_create_if_missing" boolean, "p_receipt_kind" "text", "p_receipt_token_id" "uuid", "p_receipt_idempotency_key" "uuid", "p_receipt_item_index" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_team_planning_github_projection_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_id" "text", "p_idempotency_key" "uuid", "p_create_if_missing" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_task public.tasks%rowtype;
  v_request public.planning_github_projection_outbox%rowtype;
  v_operation_id text := 'team-sync:' || p_token_id::text || ':' || p_idempotency_key::text;
begin
  if p_token_id is null or p_idempotency_key is null or p_create_if_missing is null then
    raise exception using errcode = '22023', message = 'planning github projection input is invalid';
  end if;
  select * into v_token from public.team_task_intake_tokens
  where id = p_token_id and profile_id = p_profile_id and revoked_at is null and expires_at > now()
  for update;
  if not found then raise exception using errcode = 'P0004', message = 'planning items token is inactive'; end if;
  if not ('write:planning-items:github-sync' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning github projection scope is missing';
  end if;
  if exists (
    select 1 from public.planning_github_projection_outbox request
    where request.planning_operation_id = v_operation_id
      and (request.task_id <> p_item_id or request.create_if_missing is distinct from p_create_if_missing)
  ) then
    raise exception using errcode = 'P0003', message = 'planning github projection idempotency conflict';
  end if;
  select * into v_task from public.tasks where id = p_item_id and trashed_at is null for share;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  v_request := public.enqueue_planning_github_projection_request(
    v_operation_id, p_item_id, p_profile_id, p_create_if_missing
  );
  return jsonb_build_object(
    'operationId', v_operation_id,
    'itemId', p_item_id,
    'itemType', v_task.task_type,
    'githubSync', coalesce(v_request.result, jsonb_build_object('status', 'accepted')),
    'replayed', v_request.attempts > 0 or v_request.status <> 'pending'
  );
end;
$$;


ALTER FUNCTION "public"."enqueue_team_planning_github_projection_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_id" "text", "p_idempotency_key" "uuid", "p_create_if_missing" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_github_issue_sync_transaction"("p_task_id" "text", "p_error_message" "text", "p_activity_message" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task jsonb;
begin
  update public.tasks
  set github_issue_sync_status = 'failed',
      github_issue_sync_error = left(coalesce(p_error_message, 'GitHub sync failed'), 4000),
      updated_at = clock_timestamp()
  where id = p_task_id
  returning to_jsonb(tasks) into v_task;

  if v_task is null then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  insert into public.task_activity (task_id, message)
  values (p_task_id, p_activity_message);

  return v_task;
end;
$$;


ALTER FUNCTION "public"."fail_github_issue_sync_transaction"("p_task_id" "text", "p_error_message" "text", "p_activity_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_github_issue_comment_webhook_delivery"("p_delivery_id" "text", "p_lock_token" "uuid", "p_status" "text", "p_status_reason" "text" DEFAULT NULL::"text", "p_last_error" "text" DEFAULT NULL::"text", "p_available_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_updated_count integer := 0;
begin
  if p_status not in ('processed', 'ignored', 'retry_scheduled', 'failed') then
    raise exception using errcode = '22023', message = 'invalid webhook delivery final status';
  end if;
  if p_status = 'retry_scheduled' and p_available_at is null then
    raise exception using errcode = '22023', message = 'retry availability is required';
  end if;

  update public.github_webhook_deliveries delivery
  set status = p_status,
      status_reason = nullif(trim(coalesce(p_status_reason, '')), ''),
      available_at = case
        when p_status = 'retry_scheduled' then p_available_at
        else delivery.available_at
      end,
      locked_at = null,
      lock_token = null,
      processed_at = case
        when p_status = 'processed' then clock_timestamp()
        else null
      end,
      last_error = case
        when p_status in ('retry_scheduled', 'failed')
          then nullif(left(coalesce(p_last_error, ''), 2000), '')
        else null
      end,
      updated_at = clock_timestamp()
  where delivery.delivery_id = p_delivery_id
    and delivery.event_name = 'issue_comment'
    and delivery.status = 'processing'
    and delivery.lock_token = p_lock_token;

  get diagnostics v_updated_count = row_count;
  return v_updated_count = 1;
end;
$$;


ALTER FUNCTION "public"."finalize_github_issue_comment_webhook_delivery"("p_delivery_id" "text", "p_lock_token" "uuid", "p_status" "text", "p_status_reason" "text", "p_last_error" "text", "p_available_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."finalize_github_issue_comment_webhook_delivery"("p_delivery_id" "text", "p_lock_token" "uuid", "p_status" "text", "p_status_reason" "text", "p_last_error" "text", "p_available_at" timestamp with time zone) IS 'Finalizes a claimed Issue comment projection only for the active lock owner.';



CREATE OR REPLACE FUNCTION "public"."finalize_github_issue_sync_transaction"("p_task_id" "text", "p_github_repo" "text", "p_github_issue_number" integer, "p_github_issue_url" "text", "p_synced_at" timestamp with time zone, "p_activity_message" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task jsonb;
begin
  if p_github_issue_number is null or p_github_issue_number <= 0 then
    raise exception using errcode = '22023', message = 'github issue number is invalid';
  end if;

  update public.tasks
  set github_repo = p_github_repo,
      github_issue_number = p_github_issue_number,
      github_issue_url = p_github_issue_url,
      github_issue_sync_status = 'synced',
      github_issue_last_synced_at = p_synced_at,
      github_issue_sync_error = null,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning to_jsonb(tasks) into v_task;

  if v_task is null then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  insert into public.task_activity (task_id, message)
  values (p_task_id, p_activity_message);

  return v_task;
end;
$$;


ALTER FUNCTION "public"."finalize_github_issue_sync_transaction"("p_task_id" "text", "p_github_repo" "text", "p_github_issue_number" integer, "p_github_issue_url" "text", "p_synced_at" timestamp with time zone, "p_activity_message" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."finalize_github_issue_sync_transaction"("p_task_id" "text", "p_github_repo" "text", "p_github_issue_number" integer, "p_github_issue_url" "text", "p_synced_at" timestamp with time zone, "p_activity_message" "text") IS 'Atomically persists a successful GitHub issue sync and its activity record.';



CREATE OR REPLACE FUNCTION "public"."finalize_github_issue_sync_transaction_v2"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_github_repo" "text", "p_github_issue_number" integer, "p_github_issue_url" "text", "p_synced_at" timestamp with time zone, "p_activity_message" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task jsonb;
begin
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'expected task revision is required';
  end if;
  if p_github_issue_number is null or p_github_issue_number <= 0 then
    raise exception using errcode = '22023', message = 'github issue number is invalid';
  end if;

  update public.tasks
  set github_repo = p_github_repo,
      github_issue_number = p_github_issue_number,
      github_issue_url = p_github_issue_url,
      github_issue_sync_status = 'synced',
      github_issue_last_synced_at = p_synced_at,
      github_issue_sync_error = null,
      updated_at = clock_timestamp()
  where id = p_task_id
    and updated_at = p_expected_updated_at
    and github_issue_sync_status = 'pending'
  returning to_jsonb(tasks) into v_task;

  if v_task is null then
    if exists (select 1 from public.tasks where id = p_task_id) then
      raise exception using errcode = 'P0001', message = 'task was changed concurrently';
    end if;
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  insert into public.task_activity (task_id, message)
  values (p_task_id, p_activity_message);

  return v_task;
end;
$$;


ALTER FUNCTION "public"."finalize_github_issue_sync_transaction_v2"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_github_repo" "text", "p_github_issue_number" integer, "p_github_issue_url" "text", "p_synced_at" timestamp with time zone, "p_activity_message" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."finalize_github_issue_sync_transaction_v2"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_github_repo" "text", "p_github_issue_number" integer, "p_github_issue_url" "text", "p_synced_at" timestamp with time zone, "p_activity_message" "text") IS 'Finalizes GitHub issue sync only when no task change occurred after sync started.';



CREATE OR REPLACE FUNCTION "public"."finalize_github_issue_sync_with_pull_requests_v1"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_github_repo" "text", "p_github_issue_number" integer, "p_github_issue_url" "text", "p_synced_at" timestamp with time zone, "p_activity_message" "text", "p_linked_pull_requests" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_task jsonb;
begin
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'expected task revision is required';
  end if;
  if p_github_issue_number is null or p_github_issue_number <= 0 then
    raise exception using errcode = '22023', message = 'github issue number is invalid';
  end if;
  if p_linked_pull_requests is not null
    and (jsonb_typeof(p_linked_pull_requests) <> 'array' or jsonb_array_length(p_linked_pull_requests) > 100) then
    raise exception using errcode = '22023', message = 'linked pull requests must be a JSON array with at most 100 entries';
  end if;
  if p_linked_pull_requests is not null and exists (
    select 1
    from jsonb_array_elements(p_linked_pull_requests) as entry(value)
    where jsonb_typeof(entry.value) <> 'object'
      or nullif(trim(entry.value->>'title'), '') is null
      or length(trim(entry.value->>'title')) > 500
      or coalesce(entry.value->>'repository', '') !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
      or coalesce(entry.value->>'number', '') !~ '^[1-9][0-9]*$'
      or coalesce(entry.value->>'url', '') !~ '^https://github\.com/'
      or coalesce(entry.value->>'status', '') not in ('open', 'merged', 'closed')
  ) then
    raise exception using errcode = '22023', message = 'linked pull request metadata is invalid';
  end if;

  update public.tasks
  set github_repo = p_github_repo,
      github_issue_number = p_github_issue_number,
      github_issue_url = p_github_issue_url,
      github_issue_sync_status = 'synced',
      github_issue_last_synced_at = p_synced_at,
      github_issue_sync_error = null,
      updated_at = clock_timestamp()
  where id = p_task_id
    and updated_at = p_expected_updated_at
    and github_issue_sync_status = 'pending'
  returning to_jsonb(tasks) into v_task;

  if v_task is null then
    if exists (select 1 from public.tasks where id = p_task_id) then
      raise exception using errcode = 'P0001', message = 'task was changed concurrently';
    end if;
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  if p_linked_pull_requests is not null then
    delete from public.task_links
    where task_id = p_task_id
      and type = 'github_pull_request';

    insert into public.task_links (task_id, type, label, url, position, metadata)
    select
      p_task_id,
      'github_pull_request',
      trim(entry.value->>'title'),
      entry.value->>'url',
      entry.ordinality::integer - 1,
      jsonb_build_object(
        'repository', entry.value->>'repository',
        'number', (entry.value->>'number')::integer,
        'status', entry.value->>'status',
        'mergedAt', nullif(entry.value->>'mergedAt', '')
      )
    from jsonb_array_elements(p_linked_pull_requests) with ordinality as entry(value, ordinality);
  end if;

  insert into public.task_activity (task_id, message)
  values (p_task_id, p_activity_message);

  return v_task;
end;
$_$;


ALTER FUNCTION "public"."finalize_github_issue_sync_with_pull_requests_v1"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_github_repo" "text", "p_github_issue_number" integer, "p_github_issue_url" "text", "p_synced_at" timestamp with time zone, "p_activity_message" "text", "p_linked_pull_requests" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."finalize_github_issue_sync_with_pull_requests_v1"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_github_repo" "text", "p_github_issue_number" integer, "p_github_issue_url" "text", "p_synced_at" timestamp with time zone, "p_activity_message" "text", "p_linked_pull_requests" "jsonb") IS 'Finalizes GitHub issue sync and replaces linked PRs only when GitHub returned a complete projection.';



CREATE OR REPLACE FUNCTION "public"."finalize_github_planning_webhook_delivery"("p_delivery_id" "text", "p_lock_token" "uuid", "p_status" "text", "p_status_reason" "text", "p_last_error" "text" DEFAULT NULL::"text", "p_available_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_updated integer;
  v_error text := left(nullif(trim(coalesce(p_last_error, '')), ''), 2000);
begin
  if p_status not in ('processed', 'ignored', 'retry_scheduled', 'failed')
     or nullif(trim(coalesce(p_status_reason, '')), '') is null
     or length(p_status_reason) > 120
     or (p_status = 'retry_scheduled' and p_available_at is null)
     or (p_status <> 'retry_scheduled' and p_available_at is not null) then
    raise exception using errcode = '22023', message = 'invalid GitHub planning delivery final status';
  end if;

  update public.github_planning_webhook_deliveries delivery
  set status = p_status,
      status_reason = p_status_reason,
      available_at = coalesce(p_available_at, delivery.available_at),
      locked_at = null,
      lock_token = null,
      processed_at = case when p_status = 'processed' then clock_timestamp() else null end,
      last_error = case when p_status in ('retry_scheduled', 'failed') then v_error else null end,
      updated_at = clock_timestamp()
  where delivery.delivery_id = p_delivery_id
    and delivery.status = 'processing'
    and delivery.lock_token = p_lock_token;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;


ALTER FUNCTION "public"."finalize_github_planning_webhook_delivery"("p_delivery_id" "text", "p_lock_token" "uuid", "p_status" "text", "p_status_reason" "text", "p_last_error" "text", "p_available_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_google_workspace_disconnect"("p_operation_id" "uuid", "p_owner_profile_id" "text", "p_observed_at" timestamp with time zone DEFAULT "clock_timestamp"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_operation public.google_workspace_disconnect_operations%rowtype;
  v_retained_version_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id, 0));
  select * into v_operation from public.google_workspace_disconnect_operations
  where id = p_operation_id and owner_profile_id = p_owner_profile_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'disconnect operation not found'; end if;
  if v_operation.state in ('revoke_pending', 'completed') then
    return jsonb_build_object('id', v_operation.id, 'state', v_operation.state, 'retainedVersionId', v_operation.retained_version_id, 'replayed', true);
  end if;
  if exists (
    select 1 from public.google_workspace_disconnect_series
    where operation_id = v_operation.id and state <> 'confirmed'
  ) then
    raise exception using errcode = 'P0003', message = 'future Google series cleanup is incomplete';
  end if;
  if exists (
    select 1 from public.team_workweek_publications
    where owner_profile_id = p_owner_profile_id and status = 'preparing'
  ) then
    raise exception using errcode = 'P0003', message = 'team workweek publication started during disconnect';
  end if;
  if exists (
    select 1
    from public.team_workweek_google_series as series
    join public.team_workweek_publications as publication on publication.id = series.publication_id
    where publication.owner_profile_id = p_owner_profile_id
      and publication.status = 'published'
      and (publication.effective_to is null or publication.effective_to >= v_operation.cutoff_date)
      and series.state = 'confirmed'
      and series.provider_state = 'active'
      and not exists (
        select 1 from public.google_workspace_disconnect_series as target
        where target.operation_id = v_operation.id and target.series_id = series.id
      )
  ) then
    raise exception using errcode = 'P0003', message = 'disconnect cleanup snapshot is stale';
  end if;

  update public.team_workweek_publications
  set status = 'inactive', deactivated_at = p_observed_at,
    deactivation_reason = case when v_operation.requested_by = 'owner' then 'manual_disconnect' else 'external_revocation' end
  where owner_profile_id = p_owner_profile_id and status = 'published';

  v_retained_version_id := public.retain_private_team_workweek_after_deactivation(p_owner_profile_id, v_operation.cutoff_date);

  update public.team_workweek_google_series as series
  set future_cleanup_state = 'confirmed', future_cleanup_confirmed_at = p_observed_at, updated_at = p_observed_at
  where exists (
    select 1 from public.google_workspace_disconnect_series as target
    where target.operation_id = v_operation.id and target.series_id = series.id
  );

  update public.google_workspace_disconnect_operations
  set state = case when revoke_connection then 'revoke_pending' else 'completed' end,
    retained_version_id = v_retained_version_id,
    deactivated_at = p_observed_at,
    completed_at = case when revoke_connection then null else p_observed_at end,
    last_error_class = null,
    updated_at = p_observed_at
  where id = v_operation.id
  returning * into v_operation;

  return jsonb_build_object('id', v_operation.id, 'state', v_operation.state, 'retainedVersionId', v_retained_version_id, 'replayed', false);
end;
$$;


ALTER FUNCTION "public"."finalize_google_workspace_disconnect"("p_operation_id" "uuid", "p_owner_profile_id" "text", "p_observed_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_planning_github_lifecycle_job"("p_job_id" "uuid", "p_lock_token" "uuid", "p_succeeded" boolean, "p_error_message" "text" DEFAULT NULL::"text", "p_status_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_job public.planning_github_lifecycle_outbox%rowtype;
  v_error text := left(nullif(trim(coalesce(p_error_message, '')), ''), 2000);
  v_status_reason text := left(nullif(trim(coalesce(p_status_reason, '')), ''), 120);
begin
  if p_job_id is null or p_lock_token is null or p_succeeded is null then
    raise exception using errcode = '22023', message = 'planning github lifecycle finalize input is invalid';
  end if;
  if not p_succeeded and v_error is null then
    raise exception using errcode = '22023', message = 'planning github lifecycle error is required';
  end if;

  select * into v_job
  from public.planning_github_lifecycle_outbox
  where id = p_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning github lifecycle job not found';
  end if;
  if v_job.status <> 'processing' or v_job.lock_token is distinct from p_lock_token then
    raise exception using errcode = 'P0001', message = 'planning github lifecycle lease changed';
  end if;

  update public.planning_github_lifecycle_outbox
      set status = case
        when p_succeeded then 'completed'
        when attempts >= 5 then 'failed'
        else 'retry_scheduled'
      end,
      available_at = case
        when p_succeeded or attempts >= 5 then available_at
        else clock_timestamp() + make_interval(secs => least(3600, (power(2, least(attempts, 6)) * 60)::integer))
      end,
      locked_at = null,
      lock_token = null,
      completed_at = case when p_succeeded then clock_timestamp() else null end,
      status_reason = coalesce(
        v_status_reason,
        case when p_succeeded then 'delivered' when attempts >= 5 then 'delivery_failed' else 'retry_after_error' end
      ),
      last_error = case when p_succeeded then null else v_error end,
      updated_at = clock_timestamp()
  where id = p_job_id
  returning * into v_job;

  return to_jsonb(v_job);
end;
$$;


ALTER FUNCTION "public"."finalize_planning_github_lifecycle_job"("p_job_id" "uuid", "p_lock_token" "uuid", "p_succeeded" boolean, "p_error_message" "text", "p_status_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_planning_github_projection_request"("p_request_id" "uuid", "p_lock_token" "uuid", "p_succeeded" boolean, "p_result" "jsonb", "p_error_message" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_request public.planning_github_projection_outbox%rowtype;
  v_error text := left(nullif(trim(coalesce(p_error_message, '')), ''), 2000);
  v_next_status text;
begin
  select * into v_request from public.planning_github_projection_outbox
  where id = p_request_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'planning github projection request not found'; end if;
  if v_request.status <> 'processing' or v_request.lock_token is distinct from p_lock_token then
    raise exception using errcode = 'P0001', message = 'planning github projection lease changed';
  end if;
  if not p_succeeded and v_error is null then
    raise exception using errcode = '22023', message = 'planning github projection error is required';
  end if;
  v_next_status := case when p_succeeded then 'completed' when v_request.attempts >= 5 then 'failed' else 'retry_scheduled' end;
  update public.planning_github_projection_outbox
  set status = v_next_status,
      available_at = case when v_next_status = 'retry_scheduled'
        then clock_timestamp() + make_interval(secs => least(3600, (power(2, least(attempts, 6)) * 60)::integer))
        else available_at end,
      locked_at = null, lock_token = null,
      completed_at = case when v_next_status = 'completed' then clock_timestamp() else null end,
      status_reason = case when v_next_status = 'completed' then 'delivered' when v_next_status = 'failed' then 'delivery_failed' else 'retry_after_error' end,
      result = p_result, last_error = case when p_succeeded then null else v_error end,
      updated_at = clock_timestamp()
  where id = p_request_id returning * into v_request;

  if v_request.receipt_kind = 'team_create' then
    update public.team_task_intake_batches batch
    set response_tasks = jsonb_set(batch.response_tasks,
      array[v_request.receipt_item_index::text, 'githubSync'], p_result, true)
    where batch.token_id = v_request.receipt_token_id
      and batch.idempotency_key = v_request.receipt_idempotency_key;
  elsif v_request.receipt_kind = 'team_update' then
    update public.team_planning_item_update_requests receipt
    set response = jsonb_set(receipt.response, '{githubSync}', p_result, true)
    where receipt.token_id = v_request.receipt_token_id
      and receipt.idempotency_key = v_request.receipt_idempotency_key;
  end if;
  return to_jsonb(v_request);
end;
$$;


ALTER FUNCTION "public"."finalize_planning_github_projection_request"("p_request_id" "uuid", "p_lock_token" "uuid", "p_succeeded" boolean, "p_result" "jsonb", "p_error_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_task_comment_github_delivery"("p_task_comment_id" bigint, "p_lock_token" "text", "p_status" "text", "p_status_reason" "text" DEFAULT NULL::"text", "p_github_issue_number" integer DEFAULT NULL::integer, "p_github_comment_id" bigint DEFAULT NULL::bigint, "p_github_comment_url" "text" DEFAULT NULL::"text", "p_last_error" "text" DEFAULT NULL::"text", "p_next_attempt_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_updated bigint;
begin
  if p_status not in ('pending', 'waiting_for_issue', 'waiting_for_author_connection', 'retry_scheduled', 'delivered', 'failed') then
    raise exception using errcode = '22023', message = 'invalid github comment delivery status';
  end if;

  update public.task_comment_github_deliveries
  set status = p_status,
      status_reason = p_status_reason,
      github_issue_number = coalesce(p_github_issue_number, github_issue_number),
      github_comment_id = coalesce(p_github_comment_id, github_comment_id),
      github_comment_url = coalesce(p_github_comment_url, github_comment_url),
      attempts = attempts + case when p_status in ('retry_scheduled', 'delivered', 'failed') then 1 else 0 end,
      last_error = case when p_status in ('retry_scheduled', 'failed') then left(p_last_error, 4000) else null end,
      next_attempt_at = p_next_attempt_at,
      delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
      lock_token = null,
      locked_at = null,
      updated_at = now()
  where task_comment_id = p_task_comment_id
    and lock_token = p_lock_token;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;


ALTER FUNCTION "public"."finalize_task_comment_github_delivery"("p_task_comment_id" bigint, "p_lock_token" "text", "p_status" "text", "p_status_reason" "text", "p_github_issue_number" integer, "p_github_comment_id" bigint, "p_github_comment_url" "text", "p_last_error" "text", "p_next_attempt_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_task_deletion_transaction"("p_operation_id" "uuid", "p_github_closed" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_operation public.task_deletion_operations%rowtype;
  v_task public.tasks%rowtype;
begin
  select * into v_operation
  from public.task_deletion_operations
  where id = p_operation_id
  for update;

  if v_operation.id is null then
    raise exception using errcode = 'P0002', message = 'task deletion operation not found';
  end if;

  if v_operation.status = 'completed' then
    return jsonb_build_object(
      'operationId', v_operation.id,
      'status', v_operation.status,
      'deletedTaskIds', to_jsonb(v_operation.deleted_task_ids),
      'githubClosed', v_operation.github_closed
    );
  end if;

  select * into v_task
  from public.tasks
  where id = v_operation.task_id
  for update;

  if v_task.id is null then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  if v_task.updated_at <> v_operation.task_updated_at then
    raise exception using errcode = 'P0001', message = 'task was changed concurrently';
  end if;

  delete from public.tasks where id = v_operation.task_id;

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    request_ip,
    user_agent
  )
  values (
    v_operation.actor_profile_id,
    'task.delete',
    'task',
    v_operation.task_id,
    v_operation.task_snapshot,
    jsonb_build_object(
      'deleted', true,
      'deletedTaskIds', to_jsonb(v_operation.deleted_task_ids),
      'githubClosed', coalesce(p_github_closed, false)
    ),
    v_operation.request_ip,
    v_operation.user_agent
  );

  update public.task_deletion_operations
  set status = 'completed',
      github_closed = coalesce(p_github_closed, false),
      updated_at = clock_timestamp(),
      completed_at = clock_timestamp()
  where id = v_operation.id
  returning * into v_operation;

  return jsonb_build_object(
    'operationId', v_operation.id,
    'status', v_operation.status,
    'deletedTaskIds', to_jsonb(v_operation.deleted_task_ids),
    'githubClosed', v_operation.github_closed
  );
end;
$$;


ALTER FUNCTION "public"."finalize_task_deletion_transaction"("p_operation_id" "uuid", "p_github_closed" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."finalize_task_deletion_transaction"("p_operation_id" "uuid", "p_github_closed" boolean) IS 'Atomically deletes a prepared task tree, writes its audit record, and completes the deletion operation.';



CREATE OR REPLACE FUNCTION "public"."finalize_team_workweek_publication"("p_publication_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_owner_profile_id text;
  v_owner_role text;
  v_publication public.team_workweek_publications%rowtype;
  v_predecessor public.team_workweek_publications%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select profile.id, profile.platform_role
  into v_owner_profile_id, v_owner_role
  from public.profiles as profile
  where profile.auth_user_id = auth.uid();

  if not found or v_owner_profile_id is null or v_owner_role not in ('ceo', 'founder', 'deputy') then
    raise exception using errcode = '42501', message = 'planning contributor profile required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner_profile_id, 0));

  select * into v_publication
  from public.team_workweek_publications
  where id = p_publication_id and owner_profile_id = v_owner_profile_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'team workweek publication not found';
  end if;
  if v_publication.status = 'published' then
    return jsonb_build_object(
      'id', v_publication.id,
      'status', v_publication.status,
      'syncState', v_publication.sync_state,
      'publishedAt', v_publication.published_at,
      'lastSyncAt', v_publication.last_sync_at,
      'publicationRevision', v_publication.publication_revision
    );
  end if;
  if exists (
    select 1 from public.team_workweek_google_series
    where publication_id = v_publication.id and state <> 'confirmed'
  ) or (
    select count(*) from public.team_workweek_google_series where publication_id = v_publication.id
  ) <> jsonb_array_length(v_publication.windows) then
    raise exception using errcode = 'P0003', message = 'all Google series must be confirmed before team publication';
  end if;
  if exists (
    select 1 from public.team_workweek_google_series_transitions
    where activation_publication_id = v_publication.id and state <> 'confirmed'
  ) then
    raise exception using errcode = 'P0003', message = 'all predecessor Google series transitions must be confirmed before team publication';
  end if;

  if v_publication.predecessor_publication_id is not null then
    select * into v_predecessor
    from public.team_workweek_publications
    where id = v_publication.predecessor_publication_id
    for update;

    if not found
      or v_predecessor.owner_profile_id <> v_owner_profile_id
      or v_predecessor.status <> 'published'
      or v_predecessor.effective_from >= v_publication.effective_from
      or v_predecessor.effective_to is not null
      or v_predecessor.superseded_by_publication_id is not null then
      raise exception using errcode = 'P0004', message = 'published workweek revision is stale';
    end if;

    update public.team_workweek_publications
    set effective_to = v_publication.effective_from - 1,
      superseded_by_publication_id = v_publication.id
    where id = v_predecessor.id;
  end if;

  update public.team_workweek_publications
  set status = 'published', sync_state = 'confirmed', published_at = v_now, last_sync_at = v_now
  where id = v_publication.id
  returning * into v_publication;

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


ALTER FUNCTION "public"."finalize_team_workweek_publication"("p_publication_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_locked_sub_issue_parent"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_parent public.tasks%rowtype;
begin
  if new.task_type <> 'sub_issue' or new.parent_task_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.parent_task_id is not distinct from old.parent_task_id then
    return new;
  end if;
  select * into v_parent from public.tasks where id = new.parent_task_id for share;
  if found and v_parent.status = 'Erledigt' then
    raise exception using errcode = 'P0016', message = 'completed parent planning item is locked';
  end if;
  if found and (
    (v_parent.review_status = 'requested' and not coalesce(v_parent.score_final, false))
    or (v_parent.review_status = 'accepted' and coalesce(v_parent.score_final, false))
  ) then
    raise exception using errcode = 'P0009', message = 'parent planning item review is locked';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."guard_locked_sub_issue_parent"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_notification_system_resolution"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if coalesce(auth.role(), 'service_role') = 'service_role' then
    return new;
  end if;

  if (to_jsonb(new) - 'status' - 'seen_at' - 'dismissed_at')
    is distinct from
    (to_jsonb(old) - 'status' - 'seen_at' - 'dismissed_at')
  then
    raise exception using errcode = '42501', message = 'notification system fields are immutable';
  end if;

  if old.status = 'pending'
    and new.status = 'pending'
    and new.seen_at is not null
    and new.dismissed_at is not distinct from old.dismissed_at
  then
    return new;
  end if;

  if old.status = 'pending'
    and new.status = 'dismissed'
    and new.seen_at is not null
    and new.dismissed_at is not null
  then
    return new;
  end if;

  raise exception using errcode = '42501', message = 'notification lifecycle transition is not allowed';
end;
$$;


ALTER FUNCTION "public"."guard_notification_system_resolution"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_owner_team_workweek_version_against_reconciliation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_profile_id, 0));
  if exists (
    select 1 from public.google_workspace_disconnect_operations
    where owner_profile_id = new.owner_profile_id and state <> 'completed'
  ) and not (auth.role() = 'service_role' and new.origin = 'owner') then
    raise exception using errcode = 'P0003', message = 'Google disconnect is still preparing';
  end if;
  if new.origin = 'owner' and exists (
    select 1 from public.team_workweek_publications
    where owner_profile_id = new.owner_profile_id and status = 'preparing'
  ) then
    raise exception using errcode = 'P0003', message = 'Google reconciliation is still preparing';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."guard_owner_team_workweek_version_against_reconciliation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_planning_trash_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_bypass boolean := coalesce(current_setting('founderops.trash_lifecycle_write', true), '') = 'on';
begin
  if v_bypass then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0003', message = 'planning items may only be deleted by the lifecycle purge';
  end if;
  if tg_op = 'INSERT' then
    if new.trashed_at is not null or new.trashed_by is not null or new.trash_reason is not null
       or new.trash_cause is not null or new.purge_after is not null or new.trash_root_type is not null
       or new.trash_root_id is not null or new.trash_revision <> 0 then
      raise exception using errcode = 'P0003', message = 'trash metadata requires the planning trash lifecycle';
    end if;
  else
    if old.trashed_at is not null then
      raise exception using errcode = 'P0003', message = 'trashed planning items are immutable';
    end if;
    if new.trashed_at is distinct from old.trashed_at or new.trashed_by is distinct from old.trashed_by
       or new.trash_reason is distinct from old.trash_reason or new.trash_cause is distinct from old.trash_cause
       or new.purge_after is distinct from old.purge_after or new.trash_root_type is distinct from old.trash_root_type
       or new.trash_root_id is distinct from old.trash_root_id or new.trash_revision is distinct from old.trash_revision then
      raise exception using errcode = 'P0003', message = 'trash metadata requires the planning trash lifecycle';
    end if;
  end if;
  if new.trashed_at is null and new.parent_task_id is not null and exists (
    select 1 from public.tasks parent where parent.id = new.parent_task_id and parent.trashed_at is not null
  ) then
    raise exception using errcode = 'P0003', message = 'active planning items require an active parent';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."guard_planning_trash_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_team_workweek_conflict_against_disconnect"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_profile_id, 0));
  if new.state <> 'cancelled' and exists (
    select 1 from public.google_workspace_disconnect_operations
    where owner_profile_id = new.owner_profile_id and state <> 'completed'
  ) then
    raise exception using errcode = 'P0003', message = 'Google disconnect is still preparing';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."guard_team_workweek_conflict_against_disconnect"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_team_workweek_publication_effective_future"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_today date := (clock_timestamp() at time zone 'Europe/Berlin')::date;
  v_next_monday date;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_profile_id, 0));
  if exists (
    select 1 from public.google_workspace_disconnect_operations
    where owner_profile_id = new.owner_profile_id and state <> 'completed'
  ) then
    raise exception using errcode = 'P0003', message = 'Google disconnect is still preparing';
  end if;
  v_next_monday := v_today + case
    when extract(isodow from v_today)::integer = 1 then 7
    else 8 - extract(isodow from v_today)::integer
  end;
  if new.effective_from < v_next_monday and exists (
    select 1 from public.google_workspace_disconnect_operations
    where owner_profile_id = new.owner_profile_id
      and retained_version_id = new.source_version_id
      and state = 'completed'
  ) then
    new.effective_from := v_next_monday;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."guard_team_workweek_publication_effective_future"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_github_task_comments_with_mentions"("p_task_id" "text", "p_comments" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task public.tasks%rowtype;
  v_comment jsonb;
  v_external_id text;
  v_actor_profile_id text;
  v_author_login text;
  v_source_updated_at timestamptz;
  v_baseline_source_updated_at timestamptz;
  v_existing public.task_external_comments%rowtype;
  v_previous_recipient_profile_ids text[];
  v_current_recipient_profile_ids text[];
  v_imported integer := 0;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
  if jsonb_typeof(coalesce(p_comments, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'comments must be an array';
  end if;

  for v_comment in select value from jsonb_array_elements(coalesce(p_comments, '[]'::jsonb)) loop
    v_external_id := nullif(trim(v_comment ->> 'externalId'), '');
    v_author_login := nullif(trim(v_comment ->> 'authorLogin'), '');
    v_actor_profile_id := nullif(trim(v_comment ->> 'actorProfileId'), '');
    v_source_updated_at := (v_comment ->> 'sourceUpdatedAt')::timestamptz;
    v_baseline_source_updated_at := nullif(v_comment ->> 'baselineSourceUpdatedAt', '')::timestamptz;
    select coalesce(array_agg(recipient_id order by recipient_id), '{}')
    into v_current_recipient_profile_ids
    from (
      select distinct nullif(trim(value), '') as recipient_id
      from jsonb_array_elements_text(coalesce(v_comment -> 'mentionRecipientProfileIds', '[]'::jsonb))
    ) recipients
    where recipient_id is not null;
    if v_external_id is null or v_author_login is null or nullif(trim(v_comment ->> 'body'), '') is null then
      raise exception using errcode = '22023', message = 'complete GitHub comment content is required';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('github:' || v_external_id, 0));
    select * into v_existing
    from public.task_external_comments
    where source = 'github' and external_id = v_external_id
    for update;

    if found and v_source_updated_at < v_existing.source_updated_at then
      continue;
    end if;

    if not found then
      v_imported := v_imported + 1;
      v_previous_recipient_profile_ids := '{}';
    elsif v_existing.mention_recipients_initialized then
      v_previous_recipient_profile_ids := v_existing.mention_recipient_profile_ids;
    else
      if v_baseline_source_updated_at is distinct from v_existing.source_updated_at then
        raise exception using errcode = '40001', message = 'GitHub comment mention baseline changed before import';
      end if;
      select coalesce(array_agg(recipient_id order by recipient_id), '{}')
      into v_previous_recipient_profile_ids
      from (
        select distinct nullif(trim(value), '') as recipient_id
        from jsonb_array_elements_text(coalesce(v_comment -> 'baselineMentionRecipientProfileIds', '[]'::jsonb))
      ) recipients
      where recipient_id is not null;
    end if;

    insert into public.task_external_comments (
      task_id, source, external_id, author_login, author_avatar_url, body,
      html_url, created_at, source_updated_at, imported_at,
      mention_recipient_profile_ids, mention_recipients_initialized
    ) values (
      p_task_id, 'github', v_external_id, v_author_login,
      nullif(trim(v_comment ->> 'authorAvatarUrl'), ''), trim(v_comment ->> 'body'),
      nullif(trim(v_comment ->> 'htmlUrl'), ''), (v_comment ->> 'createdAt')::timestamptz,
      v_source_updated_at, (v_comment ->> 'importedAt')::timestamptz,
      v_current_recipient_profile_ids, true
    )
    on conflict (source, external_id) do update
    set task_id = excluded.task_id,
        author_login = excluded.author_login,
        author_avatar_url = excluded.author_avatar_url,
        body = excluded.body,
        html_url = excluded.html_url,
        created_at = excluded.created_at,
        source_updated_at = excluded.source_updated_at,
        imported_at = excluded.imported_at,
        mention_recipient_profile_ids = excluded.mention_recipient_profile_ids,
        mention_recipients_initialized = true;

    if v_task.github_comment_notifications_after is not null
      and v_source_updated_at >= v_task.github_comment_notifications_after
    then
      insert into public.notification_events (
        type, actor_profile_id, actor_label, recipient_profile_id, entity_type, entity_id,
        title, body, dedupe_key, target_path
      )
      select
        'task.mention', v_actor_profile_id, v_author_login, recipient_id, 'task', p_task_id,
        '@' || v_author_login || ' hat dich erwähnt: ' || v_task.title, trim(v_comment ->> 'body'),
        'task.mention:github:' || v_external_id || ':' || recipient_id,
        '/tasks/' || p_task_id || '?comment=github:' || v_external_id
      from unnest(v_current_recipient_profile_ids) recipient_id
      where recipient_id is not null
        and not (recipient_id = any(v_previous_recipient_profile_ids))
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end loop;

  return jsonb_build_object('imported', v_imported);
end;
$$;


ALTER FUNCTION "public"."import_github_task_comments_with_mentions"("p_task_id" "text", "p_comments" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_platform_release_v1"("p_manifest" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."ingest_platform_release_v1"("p_manifest" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ingest_platform_release_v1"("p_manifest" "jsonb") IS 'Atomically stores one immutable Manifest v2 or v3 and creates notifications unless the manifest requests silent ingestion.';



CREATE OR REPLACE FUNCTION "public"."insert_legacy_task_activity_as_audit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_action text := public.task_audit_action_from_legacy_message(new.message);
  v_actor_profile_id text := nullif(current_setting('app.actor_profile_id', true), '');
begin
  if v_action is null then
    return null;
  end if;

  insert into public.audit_log (
    entity_type,
    entity_id,
    action,
    actor_profile_id,
    after_data,
    created_at
  ) values (
    'task',
    new.task_id,
    v_action,
    v_actor_profile_id,
    jsonb_build_object(
      'message', new.message,
      'source', 'task_activity_compatibility'
    ),
    coalesce(new.created_at, now())
  )
  returning id, created_at into new.id, new.created_at;

  return new;
end;
$$;


ALTER FUNCTION "public"."insert_legacy_task_activity_as_audit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lock_sprint_transaction"("p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_updates" "jsonb" DEFAULT '[]'::"jsonb", "p_accepted_blocker_task_ids" "text"[] DEFAULT '{}'::"text"[], "p_carryover_inserts" "jsonb" DEFAULT '[]'::"jsonb", "p_notifications" "jsonb" DEFAULT '[]'::"jsonb", "p_score_rows" "jsonb" DEFAULT '[]'::"jsonb", "p_strike_state_rows" "jsonb" DEFAULT '[]'::"jsonb", "p_strike_events" "jsonb" DEFAULT '[]'::"jsonb", "p_result_data" "jsonb" DEFAULT '{}'::"jsonb", "p_actor_profile_id" "text" DEFAULT NULL::"text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_sprint public.sprints%rowtype;
  v_result jsonb;
  v_insert jsonb;
  v_columns text;
  v_values text;
  v_allowed_columns constant text[] := array[
    'acceptance_criteria', 'assignee', 'carryover_count', 'carryover_reason',
    'carried_from_sprint_id', 'carried_from_task_id', 'created_by', 'creation_request_id',
    'deadline', 'definition_of_done', 'description', 'dod_template_version', 'end_date',
    'estimate_hours', 'evidence_link', 'evidence_required', 'github_issue_number',
    'github_issue_url', 'github_repo', 'github_issue_sync_status', 'id', 'intended_outcome',
    'issue_number', 'issue_url', 'milestone_id', 'original_sprint_id', 'owner',
    'package_id', 'parent_task_id', 'priority', 'problem_statement', 'project_id',
    'review_owner_profile_id', 'review_status', 'score_final', 'score_points',
    'score_relevant', 'scope_constraints', 'sort_order', 'sprint_id', 'start_date',
    'status', 'task_type', 'title', 'workstream'
  ];
begin
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'expected sprint update timestamp is required';
  end if;
  if jsonb_typeof(coalesce(p_task_updates, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_carryover_inserts, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_score_rows, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_strike_state_rows, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_strike_events, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'sprint finalization batches must be JSON arrays';
  end if;

  select * into v_sprint
  from public.sprints
  where id = p_sprint_id
  for update;

  if v_sprint.id is null then
    raise exception using errcode = 'P0002', message = 'sprint not found';
  end if;
  if v_sprint.score_locked then
    return coalesce(v_sprint.lock_result, '{}'::jsonb) || jsonb_build_object('replayed', true);
  end if;
  if v_sprint.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'sprint was changed concurrently';
  end if;

  update public.tasks as task
  set score_points = requested.score_points,
      score_final = requested.score_final,
      sprint_outcome = requested.sprint_outcome,
      carryover_reason = requested.carryover_reason,
      github_issue_sync_status = requested.github_issue_sync_status,
      github_issue_sync_error = requested.github_issue_sync_error,
      updated_at = clock_timestamp()
  from jsonb_to_recordset(coalesce(p_task_updates, '[]'::jsonb)) as requested(
    id text,
    score_points integer,
    score_final boolean,
    sprint_outcome text,
    carryover_reason text,
    github_issue_sync_status text,
    github_issue_sync_error text
  )
  where task.id = requested.id
    and task.sprint_id = p_sprint_id;

  update public.task_blockers
  set status = 'accepted_carryover',
      resolved_at = coalesce(resolved_at, clock_timestamp())
  where task_id = any(coalesce(p_accepted_blocker_task_ids, '{}'))
    and status = 'open';

  for v_insert in select value from jsonb_array_elements(coalesce(p_carryover_inserts, '[]'::jsonb))
  loop
    if jsonb_typeof(v_insert) <> 'object' or exists (
      select 1
      from jsonb_object_keys(v_insert) as insert_key
      where not (insert_key = any(v_allowed_columns))
    ) then
      raise exception using errcode = '22023', message = 'carryover task insert is invalid';
    end if;

    select
      string_agg(format('%I', insert_key), ', ' order by insert_key),
      string_agg(
        format('(jsonb_populate_record(null::public.tasks, $1)).%I', insert_key),
        ', '
        order by insert_key
      )
    into v_columns, v_values
    from jsonb_object_keys(v_insert) as insert_key;

    execute format(
      'insert into public.tasks (%s) select %s',
      v_columns,
      v_values
    ) using v_insert;
  end loop;

  insert into public.notification_events (
    type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body
  )
  select
    notification.type,
    notification.actor_profile_id,
    notification.recipient_profile_id,
    notification.entity_type,
    notification.entity_id,
    notification.title,
    notification.body
  from jsonb_to_recordset(coalesce(p_notifications, '[]'::jsonb)) as notification(
    type text,
    actor_profile_id text,
    recipient_profile_id text,
    entity_type text,
    entity_id text,
    title text,
    body text
  );

  update public.tasks
  set score_points = 0,
      score_final = true,
      sprint_outcome = 'missed_uncommunicated',
      updated_at = clock_timestamp()
  where sprint_id = p_sprint_id
    and score_final = false;

  insert into public.founder_sprint_scores (
    sprint_id, profile_id, delivery_points, form_points, weekly_points, total_points,
    fulfilled, away_neutral, finalized_at, finalized_by, reason_summary
  )
  select
    score.sprint_id, score.profile_id, score.delivery_points, score.form_points,
    score.weekly_points, score.total_points, score.fulfilled, score.away_neutral,
    score.finalized_at, score.finalized_by, score.reason_summary
  from jsonb_to_recordset(coalesce(p_score_rows, '[]'::jsonb)) as score(
    sprint_id text, profile_id text, delivery_points integer, form_points integer,
    weekly_points integer, total_points integer, fulfilled boolean, away_neutral boolean,
    finalized_at timestamptz, finalized_by text, reason_summary text
  )
  on conflict (sprint_id, profile_id) do update
  set delivery_points = excluded.delivery_points,
      form_points = excluded.form_points,
      weekly_points = excluded.weekly_points,
      total_points = excluded.total_points,
      fulfilled = excluded.fulfilled,
      away_neutral = excluded.away_neutral,
      finalized_at = excluded.finalized_at,
      finalized_by = excluded.finalized_by,
      reason_summary = excluded.reason_summary;

  insert into public.founder_strike_state (
    profile_id, strike_level, fulfilled_reset_streak, last_evaluated_sprint_id, updated_at
  )
  select
    state.profile_id, state.strike_level, state.fulfilled_reset_streak,
    state.last_evaluated_sprint_id, state.updated_at
  from jsonb_to_recordset(coalesce(p_strike_state_rows, '[]'::jsonb)) as state(
    profile_id text, strike_level integer, fulfilled_reset_streak integer,
    last_evaluated_sprint_id text, updated_at timestamptz
  )
  on conflict (profile_id) do update
  set strike_level = excluded.strike_level,
      fulfilled_reset_streak = excluded.fulfilled_reset_streak,
      last_evaluated_sprint_id = excluded.last_evaluated_sprint_id,
      updated_at = excluded.updated_at;

  insert into public.strike_events (
    profile_id, sprint_id, event_type, previous_strike_level,
    next_strike_level, reason, created_by
  )
  select
    event.profile_id, event.sprint_id, event.event_type, event.previous_strike_level,
    event.next_strike_level, event.reason, event.created_by
  from jsonb_to_recordset(coalesce(p_strike_events, '[]'::jsonb)) as event(
    profile_id text, sprint_id text, event_type text, previous_strike_level integer,
    next_strike_level integer, reason text, created_by text
  );

  v_result := coalesce(p_result_data, '{}'::jsonb) || jsonb_build_object(
    'sprint', jsonb_build_object('id', p_sprint_id, 'status', 'closed', 'scoreLocked', true),
    'replayed', false
  );

  update public.sprints
  set score_locked = true,
      status = 'closed',
      lock_result = v_result,
      updated_at = clock_timestamp()
  where id = p_sprint_id;

  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id, after_data, request_ip, user_agent
  )
  values (
    p_actor_profile_id, 'sprint.lock_score', 'sprint', p_sprint_id,
    v_result, p_request_ip, p_user_agent
  );

  return v_result;
end;
$_$;


ALTER FUNCTION "public"."lock_sprint_transaction"("p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_updates" "jsonb", "p_accepted_blocker_task_ids" "text"[], "p_carryover_inserts" "jsonb", "p_notifications" "jsonb", "p_score_rows" "jsonb", "p_strike_state_rows" "jsonb", "p_strike_events" "jsonb", "p_result_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."lock_sprint_transaction"("p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_updates" "jsonb", "p_accepted_blocker_task_ids" "text"[], "p_carryover_inserts" "jsonb", "p_notifications" "jsonb", "p_score_rows" "jsonb", "p_strike_state_rows" "jsonb", "p_strike_events" "jsonb", "p_result_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") IS 'Atomically finalizes sprint tasks, carryover, scoring, strikes, notifications, audit, and the sprint lock with idempotent replay.';



CREATE OR REPLACE FUNCTION "public"."lock_sprint_with_review_window_transaction"("p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_updates" "jsonb", "p_accepted_blocker_task_ids" "text"[], "p_carryover_inserts" "jsonb", "p_notifications" "jsonb", "p_score_rows" "jsonb", "p_strike_state_rows" "jsonb", "p_strike_events" "jsonb", "p_result_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_project_id text;
  v_window_hours integer;
  v_review_due_at timestamptz;
  v_sprint public.sprints%rowtype;
begin
  select project_id into v_project_id
  from public.sprints
  where id = p_sprint_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'sprint not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('founderops-review-window:' || v_project_id, 0));

  select review_objection_window_hours into v_window_hours
  from public.projects
  where id = v_project_id
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  select * into v_sprint
  from public.sprints
  where id = p_sprint_id and project_id = v_project_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'sprint not found';
  end if;
  if v_sprint.score_locked then
    return public.lock_sprint_transaction(
      p_sprint_id, p_expected_updated_at, p_task_updates, p_accepted_blocker_task_ids,
      p_carryover_inserts, p_notifications, p_score_rows, p_strike_state_rows,
      p_strike_events, p_result_data, p_actor_profile_id, p_request_ip, p_user_agent
    );
  end if;
  if v_sprint.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'sprint was changed concurrently';
  end if;
  if v_sprint.end_date is null then
    raise exception using errcode = '22023', message = 'sprint end date is required';
  end if;
  v_review_due_at := coalesce(
    v_sprint.review_due_at,
    ((v_sprint.end_date + time '23:59:59.999') at time zone 'Europe/Berlin')
      + make_interval(hours => v_window_hours)
  );
  if v_review_due_at > clock_timestamp() then
    raise exception using errcode = 'P0006', message = 'review and objection window is still open';
  end if;
  if exists (
    select 1
    from public.score_objections
    where sprint_id = p_sprint_id
      and (status = 'open' or (second_reviewer_profile_id is not null and second_reviewed_at is null))
  ) then
    raise exception using errcode = 'P0004', message = 'score objections are still unresolved';
  end if;

  return public.lock_sprint_transaction(
    p_sprint_id, p_expected_updated_at, p_task_updates, p_accepted_blocker_task_ids,
    p_carryover_inserts, p_notifications, p_score_rows, p_strike_state_rows,
    p_strike_events, p_result_data, p_actor_profile_id, p_request_ip, p_user_agent
  );
end;
$$;


ALTER FUNCTION "public"."lock_sprint_with_review_window_transaction"("p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_updates" "jsonb", "p_accepted_blocker_task_ids" "text"[], "p_carryover_inserts" "jsonb", "p_notifications" "jsonb", "p_score_rows" "jsonb", "p_strike_state_rows" "jsonb", "p_strike_events" "jsonb", "p_result_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."move_backlog_task_transaction"("p_task_id" "text", "p_target_task_id" "text", "p_placement" "text", "p_expected_task_updated_at" timestamp with time zone, "p_expected_target_updated_at" timestamp with time zone, "p_actor_profile_id" "text" DEFAULT NULL::"text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task_id text := nullif(trim(coalesce(p_task_id, '')), '');
  v_target_task_id text := nullif(trim(coalesce(p_target_task_id, '')), '');
  v_actor_role text;
  v_project_id text;
  v_task public.tasks%rowtype;
  v_target_task public.tasks%rowtype;
  v_insert_position integer;
  v_before jsonb := '[]'::jsonb;
  v_updates jsonb := '[]'::jsonb;
begin
  if v_task_id is null
     or v_target_task_id is null
     or v_task_id = v_target_task_id
     or p_placement is null
     or p_placement not in ('before', 'after')
     or p_expected_task_updated_at is null
     or p_expected_target_updated_at is null then
    raise exception using errcode = '22023', message = 'backlog move input is invalid';
  end if;

  select profile.platform_role into v_actor_role
  from public.profiles as profile
  where profile.id = nullif(trim(coalesce(p_actor_profile_id, '')), '');
  if not found or v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0004', message = 'backlog move requires ceo or deputy';
  end if;

  select task.project_id into v_project_id
  from public.tasks as task
  where task.id = v_task_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'backlog task was not found';
  end if;

  perform 1
  from public.tasks as task
  where task.project_id = v_project_id
    and task.trashed_at is null
    and task.task_type = 'deliverable'
    and task.status <> 'Erledigt'
  order by task.id
  for update of task;

  select * into v_task
  from public.tasks as task
  where task.id = v_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'backlog task was not found';
  end if;

  select * into v_target_task
  from public.tasks as task
  where task.id = v_target_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'backlog target was not found';
  end if;

  if v_task.project_id is distinct from v_project_id then
    raise exception using errcode = 'P0001', message = 'backlog task was changed concurrently';
  end if;
  if v_task.project_id is distinct from v_target_task.project_id then
    raise exception using errcode = '22023', message = 'backlog tasks must belong to the same project';
  end if;
  if v_task.trashed_at is not null
     or v_target_task.trashed_at is not null
     or v_task.task_type <> 'deliverable'
     or v_target_task.task_type <> 'deliverable'
     or v_task.status = 'Erledigt'
     or v_target_task.status = 'Erledigt' then
    raise exception using errcode = 'P0003', message = 'backlog tasks must be active deliverables';
  end if;
  if v_task.updated_at is distinct from p_expected_task_updated_at
     or v_target_task.updated_at is distinct from p_expected_target_updated_at then
    raise exception using errcode = 'P0001', message = 'backlog task was changed concurrently';
  end if;

  with remaining as (
    select task.id, row_number() over (order by task.sort_order, task.id)::integer as position
    from public.tasks as task
    where task.project_id = v_task.project_id
      and task.trashed_at is null
      and task.task_type = 'deliverable'
      and task.status <> 'Erledigt'
      and task.id <> v_task.id
  )
  select case p_placement when 'before' then remaining.position else remaining.position + 1 end
  into v_insert_position
  from remaining
  where remaining.id = v_target_task.id;

  if v_insert_position is null then
    raise exception using errcode = 'P0003', message = 'backlog target is not active';
  end if;

  with remaining as (
    select task.id, row_number() over (order by task.sort_order, task.id)::integer as position
    from public.tasks as task
    where task.project_id = v_task.project_id
      and task.trashed_at is null
      and task.task_type = 'deliverable'
      and task.status <> 'Erledigt'
      and task.id <> v_task.id
  ), positioned as (
    select
      remaining.id,
      case when remaining.position >= v_insert_position then remaining.position + 1 else remaining.position end as position
    from remaining
    union all
    select v_task.id, v_insert_position
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', task.id,
    'sortOrder', task.sort_order,
    'updatedAt', task.updated_at
  ) order by task.sort_order, task.id), '[]'::jsonb)
  into v_before
  from public.tasks as task
  join positioned on positioned.id = task.id
  where task.sort_order is distinct from positioned.position * 10;

  with remaining as (
    select task.id, row_number() over (order by task.sort_order, task.id)::integer as position
    from public.tasks as task
    where task.project_id = v_task.project_id
      and task.trashed_at is null
      and task.task_type = 'deliverable'
      and task.status <> 'Erledigt'
      and task.id <> v_task.id
  ), positioned as (
    select
      remaining.id,
      case when remaining.position >= v_insert_position then remaining.position + 1 else remaining.position end as position
    from remaining
    union all
    select v_task.id, v_insert_position
  ), updated as (
    update public.tasks as task
    set sort_order = positioned.position * 10, updated_at = clock_timestamp()
    from positioned
    where task.id = positioned.id
      and task.sort_order is distinct from positioned.position * 10
    returning task.id, task.sort_order, task.updated_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', updated.id,
    'sortOrder', updated.sort_order,
    'updatedAt', updated.updated_at
  ) order by updated.sort_order, updated.id), '[]'::jsonb)
  into v_updates
  from updated;

  if jsonb_array_length(v_updates) > 0 then
    insert into public.audit_log (
      actor_profile_id,
      action,
      entity_type,
      entity_id,
      before_data,
      after_data,
      request_ip,
      user_agent
    ) values (
      p_actor_profile_id,
      'task.backlog_reorder',
      'task',
      'backlog',
      jsonb_build_object('tasks', v_before),
      jsonb_build_object(
        'taskId', v_task.id,
        'targetTaskId', v_target_task.id,
        'placement', p_placement,
        'updates', v_updates
      ),
      p_request_ip,
      p_user_agent
    );
  end if;

  return v_updates;
end;
$$;


ALTER FUNCTION "public"."move_backlog_task_transaction"("p_task_id" "text", "p_target_task_id" "text", "p_placement" "text", "p_expected_task_updated_at" timestamp with time zone, "p_expected_target_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."move_backlog_task_transaction"("p_task_id" "text", "p_target_task_id" "text", "p_placement" "text", "p_expected_task_updated_at" timestamp with time zone, "p_expected_target_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") IS 'Atomically moves one active backlog Deliverable relative to another with compare-and-set timestamps, authoritative actor validation, and an audit record.';



CREATE OR REPLACE FUNCTION "public"."mutate_planning_approval_command_transaction"("p_task_id" "text", "p_expected_kind" "text", "p_expected_revision" integer, "p_action" "text", "p_actor_profile_id" "text", "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task public.tasks%rowtype;
begin
  if p_expected_kind not in ('initiative', 'deliverable') then
    raise exception using errcode = '22023', message = 'planning approval kind is invalid';
  end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_task.task_type <> p_expected_kind then
    raise exception using errcode = '22023', message = 'planning item has no requested approval lifecycle';
  end if;
  if v_task.trashed_at is not null then
    raise exception using errcode = 'P0003', message = 'planning item is trashed';
  end if;
  if v_task.task_type = 'deliverable' and v_task.score_final then
    raise exception using errcode = 'P0009', message = 'planning item final review state is locked';
  end if;
  if v_task.task_type = 'deliverable' and v_task.review_status = 'requested' then
    raise exception using errcode = 'P0009', message = 'planning item active review state is locked';
  end if;
  return public.decide_planning_item_approval_transaction(
    p_task_id,
    p_expected_revision,
    p_action,
    p_actor_profile_id,
    p_note
  );
end;
$$;


ALTER FUNCTION "public"."mutate_planning_approval_command_transaction"("p_task_id" "text", "p_expected_kind" "text", "p_expected_revision" integer, "p_action" "text", "p_actor_profile_id" "text", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mutate_planning_relationship_transaction"("p_operation" "text", "p_task_id" "text", "p_related_task_id" "text", "p_relation_type" "text", "p_relation_id" bigint, "p_note" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_relation public.task_relationship_edges%rowtype;
  v_other_task_id text;
begin
  if p_operation = 'remove' then
    select * into v_relation from public.task_relationship_edges where id = p_relation_id for share;
    if found then
      v_other_task_id := case
        when v_relation.task_id = p_task_id then v_relation.related_task_id
        when v_relation.related_task_id = p_task_id then v_relation.task_id
        else null
      end;
    end if;
  else
    v_other_task_id := p_related_task_id;
  end if;

  if exists (
    select 1
    from public.tasks source
    left join public.tasks source_parent on source_parent.id = source.parent_task_id
    left join public.tasks related on related.id = v_other_task_id
    left join public.tasks related_parent on related_parent.id = related.parent_task_id
    where source.id = p_task_id
      and 'Erledigt' = any(array[
        source.status,
        source_parent.status,
        related.status,
        related_parent.status
      ])
  ) then
    raise exception using errcode = 'P0016', message = 'completed relationship planning item is locked';
  end if;

  return public.mutate_planning_relationship_transaction_without_completed_guard(
    p_operation,
    p_task_id,
    p_related_task_id,
    p_relation_type,
    p_relation_id,
    p_note,
    p_expected_updated_at,
    p_actor_profile_id,
    p_request_ip,
    p_user_agent
  );
end;
$$;


ALTER FUNCTION "public"."mutate_planning_relationship_transaction"("p_operation" "text", "p_task_id" "text", "p_related_task_id" "text", "p_relation_type" "text", "p_relation_id" bigint, "p_note" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mutate_planning_relationship_transaction_without_completed_guar"("p_operation" "text", "p_task_id" "text", "p_related_task_id" "text", "p_relation_type" "text", "p_relation_id" bigint, "p_note" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor public.profiles%rowtype;
  v_source public.tasks%rowtype;
  v_related public.tasks%rowtype;
  v_relation public.task_relationship_edges%rowtype;
  v_initiative_id text;
  v_initiative public.tasks%rowtype;
  v_accountable_profile_id text;
  v_other_task_id text;
  v_can_manage_all boolean := false;
  v_can_manage_blocked_by boolean := false;
  v_review_locked boolean := false;
begin
  if p_operation not in ('add', 'remove')
     or nullif(trim(coalesce(p_task_id, '')), '') is null
     or nullif(trim(coalesce(p_actor_profile_id, '')), '') is null
     or (p_operation = 'add' and (
       nullif(trim(coalesce(p_related_task_id, '')), '') is null
       or p_relation_type not in ('blocked_by', 'blocks', 'relates_to')
       or p_relation_id is not null
     ))
     or (p_operation = 'remove' and (p_relation_id is null or p_relation_id <= 0))
     or char_length(coalesce(p_note, '')) > 500 then
    raise exception using errcode = '22023', message = 'planning relationship command is invalid';
  end if;

  select * into v_actor
  from public.profiles
  where id = p_actor_profile_id
  for share;
  if not found or v_actor.platform_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'planning relationship actor is forbidden';
  end if;
  v_can_manage_all := v_actor.platform_role in ('ceo', 'deputy');

  if p_operation = 'remove' then
    select * into v_relation
    from public.task_relationship_edges
    where id = p_relation_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'planning relationship not found';
    end if;
    if v_relation.task_id <> p_task_id and v_relation.related_task_id <> p_task_id then
      raise exception using errcode = 'P0006', message = 'planning relationship does not belong to task';
    end if;
    v_other_task_id := case
      when v_relation.task_id = p_task_id then v_relation.related_task_id
      else v_relation.task_id
    end;
  else
    if p_related_task_id = p_task_id then
      raise exception using errcode = '22023', message = 'planning item cannot relate to itself';
    end if;
    v_other_task_id := p_related_task_id;
  end if;

  perform 1
  from public.tasks
  where id = any(array[p_task_id, v_other_task_id])
  order by id
  for update;

  select * into v_source
  from public.tasks
  where id = p_task_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_source.trashed_at is not null then
    raise exception using errcode = 'P0010', message = 'planning item is trashed';
  end if;
  select * into v_related
  from public.tasks
  where id = v_other_task_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'related planning item not found';
  end if;
  if v_related.trashed_at is not null then
    raise exception using errcode = 'P0011', message = 'related planning item is trashed';
  end if;
  if p_expected_updated_at is not null and v_source.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;

  if v_source.task_type = 'initiative' then
    v_initiative_id := v_source.id;
  elsif v_source.task_type = 'deliverable' then
    v_initiative_id := v_source.parent_task_id;
  elsif v_source.task_type = 'sub_issue' and v_source.parent_task_id is not null then
    select parent_task_id into v_initiative_id
    from public.tasks
    where id = v_source.parent_task_id and task_type = 'deliverable';
  end if;
  if v_initiative_id is not null then
    select * into v_initiative
    from public.tasks
    where id = v_initiative_id and task_type = 'initiative' and trashed_at is null;
    select profile_id into v_accountable_profile_id
    from public.planning_item_raci_assignments
    where task_id = v_initiative_id and role = 'accountable'
    order by sort_order, profile_id
    limit 1;
  end if;

  v_can_manage_blocked_by := v_actor.platform_role = 'founder'
    and v_source.task_type in ('deliverable', 'sub_issue')
    and (
      v_source.assignee in (v_actor.id, v_actor.name)
      or v_source.owner in (v_actor.id, v_actor.name)
      or coalesce(v_accountable_profile_id, v_initiative.owner, '') = v_actor.id
    );

  if p_operation = 'add' then
    if not v_can_manage_all and not (v_can_manage_blocked_by and p_relation_type = 'blocked_by') then
      raise exception using errcode = 'P0006', message = 'planning relationship mutation is forbidden';
    end if;
  elsif not v_can_manage_all and not (
    v_can_manage_blocked_by
    and v_relation.task_id = p_task_id
    and v_relation.relation_type = 'blocked_by'
  ) then
    raise exception using errcode = 'P0006', message = 'planning relationship removal is forbidden';
  end if;

  select exists (
    select 1
    from public.tasks candidate
    where candidate.id = any(array[
      v_source.id,
      v_source.parent_task_id,
      v_related.id,
      v_related.parent_task_id
    ])
      and (
        (candidate.review_status = 'requested' and not coalesce(candidate.score_final, false))
        or (candidate.review_status = 'accepted' and coalesce(candidate.score_final, false))
      )
  ) into v_review_locked;
  if v_review_locked then
    raise exception using errcode = 'P0008', message = 'planning relationship is review locked';
  end if;

  if p_operation = 'add' then
    if exists (
      select 1
      from public.task_relationship_edges
      where task_id = p_task_id
        and related_task_id = p_related_task_id
        and relation_type = p_relation_type
    ) then
      raise exception using errcode = 'P0003', message = 'planning relationship already exists';
    end if;
    insert into public.task_relationship_edges (
      task_id,
      related_task_id,
      relation_type,
      note,
      created_by
    ) values (
      p_task_id,
      p_related_task_id,
      p_relation_type,
      nullif(trim(coalesce(p_note, '')), ''),
      p_actor_profile_id
    )
    returning * into v_relation;
  else
    delete from public.task_relationship_edges
    where id = p_relation_id
    returning * into v_relation;
    if not found then
      raise exception using errcode = 'P0002', message = 'planning relationship not found';
    end if;
  end if;

  update public.tasks
  set github_issue_sync_status = 'not_synced',
      github_issue_sync_error = null,
      updated_at = clock_timestamp()
  where id = any(array[v_relation.task_id, v_relation.related_task_id])
    and task_type in ('deliverable', 'sub_issue');

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    request_ip,
    user_agent
  ) values (
    p_actor_profile_id,
    case when p_operation = 'add' then 'task.relationship_created' else 'task.relationship_deleted' end,
    'task',
    p_task_id,
    case when p_operation = 'remove' then to_jsonb(v_relation) else null end,
    case when p_operation = 'add' then jsonb_build_object(
      'relationType', v_relation.relation_type,
      'relatedTaskId', v_relation.related_task_id,
      'note', coalesce(v_relation.note, '')
    ) else null end,
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'operation', p_operation,
    'relation', to_jsonb(v_relation),
    'affectedItemIds', jsonb_build_array(v_relation.task_id, v_relation.related_task_id)
  );
end;
$$;


ALTER FUNCTION "public"."mutate_planning_relationship_transaction_without_completed_guar"("p_operation" "text", "p_task_id" "text", "p_related_task_id" "text", "p_relation_type" "text", "p_relation_id" bigint, "p_note" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mutate_planning_reparent_command_transaction"("p_task_id" "text", "p_expected_kind" "text", "p_expected_updated_at" timestamp with time zone, "p_parent_task_id" "text", "p_expected_parent_updated_at" timestamp with time zone, "p_actor_profile_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task public.tasks%rowtype;
  v_old_parent public.tasks%rowtype;
  v_parent public.tasks%rowtype;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  if v_task.status = 'Erledigt' then
    raise exception using errcode = 'P0016', message = 'completed planning item is locked';
  end if;
  if v_task.parent_task_id is not null then
    select * into v_old_parent from public.tasks where id = v_task.parent_task_id for share;
    if found and v_old_parent.status = 'Erledigt' then
      raise exception using errcode = 'P0016', message = 'completed current parent planning item is locked';
    end if;
  end if;
  if nullif(trim(coalesce(p_parent_task_id, '')), '') is not null then
    select * into v_parent from public.tasks where id = p_parent_task_id for share;
    if found and v_parent.status = 'Erledigt' then
      raise exception using errcode = 'P0016', message = 'completed target parent planning item is locked';
    end if;
  end if;
  return public.mutate_planning_reparent_command_transaction_without_completed_guard(
    p_task_id,
    p_expected_kind,
    p_expected_updated_at,
    p_parent_task_id,
    p_expected_parent_updated_at,
    p_actor_profile_id
  );
end;
$$;


ALTER FUNCTION "public"."mutate_planning_reparent_command_transaction"("p_task_id" "text", "p_expected_kind" "text", "p_expected_updated_at" timestamp with time zone, "p_parent_task_id" "text", "p_expected_parent_updated_at" timestamp with time zone, "p_actor_profile_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mutate_planning_reparent_command_transaction_without_completed_"("p_task_id" "text", "p_expected_kind" "text", "p_expected_updated_at" timestamp with time zone, "p_parent_task_id" "text", "p_expected_parent_updated_at" timestamp with time zone, "p_actor_profile_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_old_parent public.tasks%rowtype;
  v_actor public.profiles%rowtype;
  v_parent_id text := nullif(trim(coalesce(p_parent_task_id, '')), '');
  v_operational boolean;
  v_owns_task boolean;
  v_result jsonb;
  v_updated_task public.tasks%rowtype;
begin
  select * into v_actor from public.profiles where id = p_actor_profile_id for share;
  if not found or v_actor.platform_role not in ('ceo','deputy','founder') then
    raise exception using errcode = 'P0006', message = 'planning reparent actor is forbidden';
  end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  if v_task.task_type <> p_expected_kind then raise exception using errcode = '22023', message = 'planning item kind changed'; end if;
  if v_task.trashed_at is not null then raise exception using errcode = 'P0003', message = 'planning item is trashed'; end if;
  if v_task.updated_at is distinct from p_expected_updated_at then raise exception using errcode = 'P0001', message = 'planning item was changed concurrently'; end if;
  v_operational := v_actor.platform_role in ('ceo','deputy');
  v_owns_task := v_task.owner in (v_actor.id,v_actor.name) or v_task.assignee in (v_actor.id,v_actor.name);
  if v_task.task_type in ('initiative','deliverable') and not v_operational then
    raise exception using errcode = 'P0006', message = 'planning reparent requires ceo or deputy';
  end if;
  if v_task.task_type = 'sub_issue' and not v_operational and not v_owns_task then
    raise exception using errcode = 'P0006', message = 'sub-issue reparent requires ownership';
  end if;
  if v_task.task_type = 'deliverable' and v_task.review_status = 'accepted' and v_task.score_final then
    raise exception using errcode = 'P0009', message = 'planning item final review state is locked';
  end if;
  if v_task.task_type = 'deliverable' and (v_task.review_status = 'requested' or v_task.score_final) then
    raise exception using errcode = 'P0009', message = 'planning item active review state is locked';
  end if;
  if v_task.parent_task_id is not null then
    select * into v_old_parent from public.tasks where id = v_task.parent_task_id for share;
    if found and v_old_parent.review_status = 'accepted' and v_old_parent.score_final then
      raise exception using errcode = 'P0009', message = 'current parent final review state is locked';
    end if;
    if found and (v_old_parent.review_status = 'requested' or v_old_parent.score_final) then
      raise exception using errcode = 'P0009', message = 'current parent active review state is locked';
    end if;
  end if;
  if v_parent_id is not null then
    select * into v_parent from public.tasks where id = v_parent_id for share;
    if not found or v_parent.trashed_at is not null then raise exception using errcode = 'P0012', message = 'planning item parent changed concurrently'; end if;
    if p_expected_parent_updated_at is null or v_parent.updated_at is distinct from p_expected_parent_updated_at then
      raise exception using errcode = 'P0012', message = 'planning item parent changed concurrently';
    end if;
    if v_task.task_type = 'deliverable' and v_parent.approval_status = 'rejected' then
      raise exception using errcode = '23514', message = 'deliverable parent initiative is rejected';
    end if;
  end if;
  if v_parent_id is not distinct from v_task.parent_task_id then
    return jsonb_build_object('task', to_jsonb(v_task));
  end if;
  v_result := public.reparent_planning_item_transaction(p_task_id,p_expected_updated_at,v_parent_id,p_actor_profile_id);
  if v_task.task_type in ('deliverable','sub_issue') then
    update public.tasks
    set github_issue_sync_status = 'not_synced',
        github_issue_sync_error = null,
        updated_at = clock_timestamp()
    where id = p_task_id
    returning * into v_updated_task;
    v_result := jsonb_set(v_result, '{task}', to_jsonb(v_updated_task), true);
  end if;
  return v_result;
end;
$$;


ALTER FUNCTION "public"."mutate_planning_reparent_command_transaction_without_completed_"("p_task_id" "text", "p_expected_kind" "text", "p_expected_updated_at" timestamp with time zone, "p_parent_task_id" "text", "p_expected_parent_updated_at" timestamp with time zone, "p_actor_profile_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mutate_planning_review_command_transaction"("p_action" "text", "p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_reviewer_profile_id" "text", "p_decision" "text", "p_comment" "text", "p_checklist" "jsonb", "p_points" integer, "p_reason" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task public.tasks%rowtype;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if found and v_task.status = 'Erledigt' and p_action <> 'reopen' then
    raise exception using errcode = 'P0016', message = 'completed planning item review is locked';
  end if;
  return public.mutate_planning_review_command_transaction_without_completed_guard(
    p_action, p_task_id, p_expected_updated_at, p_actor_profile_id,
    p_reviewer_profile_id, p_decision, p_comment, p_checklist, p_points,
    p_reason, p_activity_messages, p_notifications, p_audit_after_data,
    p_request_ip, p_user_agent
  );
end;
$$;


ALTER FUNCTION "public"."mutate_planning_review_command_transaction"("p_action" "text", "p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_reviewer_profile_id" "text", "p_decision" "text", "p_comment" "text", "p_checklist" "jsonb", "p_points" integer, "p_reason" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mutate_planning_review_command_transaction_without_completed_gu"("p_action" "text", "p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_reviewer_profile_id" "text", "p_decision" "text", "p_comment" "text", "p_checklist" "jsonb", "p_points" integer, "p_reason" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor public.profiles%rowtype;
  v_task public.tasks%rowtype;
  v_reviewer public.profiles%rowtype;
  v_sprint_locked boolean := false;
  v_operational boolean := false;
  v_owns_task boolean := false;
  v_initiative_id text;
  v_initiative_owner_id text;
  v_accountable_profile_id text;
  v_default_reviewer_profile_id text;
  v_result jsonb;
  v_patch jsonb;
begin
  if p_action not in ('request', 'decide', 'withdraw', 'reopen')
     or nullif(trim(coalesce(p_task_id, '')), '') is null
     or p_expected_updated_at is null
     or nullif(trim(coalesce(p_actor_profile_id, '')), '') is null
     or jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_checklist, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_audit_after_data, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'planning review command is invalid';
  end if;

  select * into v_actor
  from public.profiles
  where id = p_actor_profile_id
  for share;
  if not found or v_actor.platform_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'planning review actor is forbidden';
  end if;
  v_operational := v_actor.platform_role in ('ceo', 'deputy');

  select * into v_task
  from public.tasks
  where id = p_task_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_task.trashed_at is not null then
    raise exception using errcode = 'P0010', message = 'planning item is trashed';
  end if;
  if v_task.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;
  v_owns_task := v_task.assignee in (v_actor.id, v_actor.name)
    or v_task.owner in (v_actor.id, v_actor.name);

  if p_action in ('request', 'decide', 'reopen') and v_task.sprint_id is not null then
    select coalesce(score_locked, false) into v_sprint_locked
    from public.sprints
    where id = v_task.sprint_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'review sprint not found';
    end if;
    if v_sprint_locked then
      raise exception using errcode = 'P0003', message = 'sprint score is locked';
    end if;
  end if;

  if p_action = 'request' then
    if not v_operational and not (v_actor.platform_role = 'founder' and v_owns_task) then
      raise exception using errcode = 'P0006', message = 'planning review request is forbidden';
    end if;
    if v_task.task_type <> 'deliverable' or v_task.approval_status <> 'approved' then
      raise exception using errcode = 'P0004', message = 'only approved deliverables may request review';
    end if;
    if v_task.score_final or v_task.review_status = 'requested' or v_task.status = 'Review' then
      raise exception using errcode = 'P0004', message = 'review request state is invalid';
    end if;
    if nullif(trim(coalesce(p_reviewer_profile_id, '')), '') is null then
      raise exception using errcode = '22023', message = 'review owner is required';
    end if;
    v_initiative_id := case when v_task.task_type = 'deliverable' then v_task.parent_task_id else null end;
    if v_initiative_id is not null then
      select owner into v_initiative_owner_id
      from public.tasks
      where id = v_initiative_id
        and task_type = 'initiative'
        and trashed_at is null;
      select profile_id into v_accountable_profile_id
      from public.planning_item_raci_assignments
      where task_id = v_initiative_id and role = 'accountable'
      order by sort_order, profile_id
      limit 1;
    end if;
    v_default_reviewer_profile_id := coalesce(
      nullif(trim(coalesce(v_task.review_owner_profile_id, '')), ''),
      nullif(trim(coalesce(v_accountable_profile_id, '')), ''),
      nullif(trim(coalesce(v_initiative_owner_id, '')), '')
    );
    if v_actor.platform_role <> 'ceo'
       and p_reviewer_profile_id is distinct from v_default_reviewer_profile_id then
      raise exception using errcode = 'P0006', message = 'only the CEO may assign the review owner';
    end if;
    select * into v_reviewer
    from public.profiles
    where id = p_reviewer_profile_id
    for share;
    if not found or v_reviewer.platform_role not in ('ceo', 'deputy', 'founder') then
      raise exception using errcode = 'P0007', message = 'review owner must be a contributor';
    end if;

    v_patch := jsonb_build_object(
      'status', 'Review',
      'review_status', 'requested',
      'review_owner_profile_id', p_reviewer_profile_id,
      'review_requested_at', clock_timestamp(),
      'score_points', 0,
      'score_final', false,
      'github_issue_sync_status', 'not_synced',
      'github_issue_sync_error', null
    );
    v_result := public.update_task_transaction(
      p_task_id,
      p_expected_updated_at,
      v_patch,
      false,
      null,
      false,
      null,
      coalesce(p_activity_messages, '{}'::text[]),
      coalesce(p_notifications, '[]'::jsonb)
    );
    insert into public.audit_log (
      actor_profile_id,
      action,
      entity_type,
      entity_id,
      before_data,
      after_data,
      request_ip,
      user_agent
    ) values (
      p_actor_profile_id,
      'task.review.request',
      'task',
      p_task_id,
      jsonb_build_object(
        'status', v_task.status,
        'reviewStatus', v_task.review_status,
        'reviewOwnerProfileId', v_task.review_owner_profile_id,
        'scoreFinal', v_task.score_final
      ),
      coalesce(p_audit_after_data, '{}'::jsonb),
      p_request_ip,
      p_user_agent
    );
    return v_result;
  end if;

  if p_action = 'withdraw' then
    if not v_operational and not (v_actor.platform_role = 'founder' and v_owns_task) then
      raise exception using errcode = 'P0006', message = 'planning review withdrawal is forbidden';
    end if;
    if v_task.review_status <> 'requested' or v_task.score_final then
      raise exception using errcode = 'P0004', message = 'review is not active';
    end if;
    if char_length(trim(coalesce(p_reason, ''))) < 2 then
      raise exception using errcode = '22023', message = 'withdraw reason is required';
    end if;
    return public.transition_task_review_transaction(
      p_task_id,
      p_expected_updated_at,
      'withdraw',
      p_actor_profile_id,
      p_reason,
      coalesce(p_activity_messages[1], 'Review zurückgezogen'),
      coalesce(p_notifications, '[]'::jsonb),
      coalesce(p_audit_after_data, '{}'::jsonb),
      p_request_ip,
      p_user_agent
    );
  end if;

  if not v_operational and v_task.review_owner_profile_id is distinct from p_actor_profile_id then
    raise exception using errcode = 'P0006', message = 'planning review decision is forbidden';
  end if;
  if v_task.task_type <> 'deliverable' or v_task.approval_status <> 'approved' then
    raise exception using errcode = 'P0004', message = 'only approved deliverables may be reviewed';
  end if;

  if p_action = 'decide' then
    if v_task.review_status <> 'requested' or v_task.status <> 'Review' or v_task.score_final then
      raise exception using errcode = 'P0004', message = 'review is not active';
    end if;
    if p_decision not in ('accepted', 'partial', 'changes_requested') then
      raise exception using errcode = '22023', message = 'review decision is invalid';
    end if;
    return public.review_task_transaction(
      p_task_id,
      v_task.sprint_id,
      p_expected_updated_at,
      '{}'::jsonb,
      p_actor_profile_id,
      p_decision,
      p_points,
      p_comment,
      coalesce(p_checklist, '{}'::jsonb),
      coalesce(p_activity_messages[1], 'Review finalisiert'),
      coalesce(p_notifications, '[]'::jsonb),
      coalesce(p_audit_after_data, '{}'::jsonb),
      p_request_ip,
      p_user_agent
    );
  end if;

  if v_task.review_status <> 'accepted' or not v_task.score_final then
    raise exception using errcode = 'P0004', message = 'only a final accepted review may be reopened';
  end if;
  if v_task.review_owner_profile_id is null then
    raise exception using errcode = '22023', message = 'review owner is required';
  end if;
  select * into v_reviewer
  from public.profiles
  where id = v_task.review_owner_profile_id
  for share;
  if not found or v_reviewer.platform_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0007', message = 'review owner must be a contributor';
  end if;
  return public.transition_task_review_transaction(
    p_task_id,
    p_expected_updated_at,
    'reopen',
    p_actor_profile_id,
    null,
    coalesce(p_activity_messages[1], 'Review wieder geöffnet'),
    coalesce(p_notifications, '[]'::jsonb),
    coalesce(p_audit_after_data, '{}'::jsonb),
    p_request_ip,
    p_user_agent
  );
end;
$$;


ALTER FUNCTION "public"."mutate_planning_review_command_transaction_without_completed_gu"("p_action" "text", "p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_reviewer_profile_id" "text", "p_decision" "text", "p_comment" "text", "p_checklist" "jsonb", "p_points" integer, "p_reason" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mutate_planning_trash_command_transaction"("p_action" "text", "p_root_type" "text", "p_root_id" "text", "p_expected_revision" integer, "p_actor_profile_id" "text", "p_reason" "text" DEFAULT NULL::"text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_root public.tasks%rowtype;
begin
  if p_action not in ('withdraw', 'restore')
     or p_root_type not in ('initiative', 'deliverable') then
    raise exception using errcode = '22023', message = 'planning trash action is invalid';
  end if;

  select * into v_root
  from public.tasks
  where id = p_root_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_root.task_type <> p_root_type then
    raise exception using errcode = '22023', message = 'planning trash root type is invalid';
  end if;

  if p_action = 'withdraw' then
    if v_root.task_type = 'deliverable' and v_root.review_status = 'accepted' and v_root.score_final then
      raise exception using errcode = 'P0009', message = 'planning item final review state is locked';
    end if;
    if v_root.task_type = 'deliverable' and (v_root.review_status = 'requested' or v_root.score_final) then
      raise exception using errcode = 'P0009', message = 'planning item active review state is locked';
    end if;
    return public.withdraw_planning_item_transaction(
      p_root_type,
      p_root_id,
      p_expected_revision,
      p_actor_profile_id,
      p_reason,
      p_request_ip,
      p_user_agent
    );
  end if;
  if p_action = 'restore' then
    if nullif(trim(coalesce(p_reason, '')), '') is not null then
      raise exception using errcode = '22023', message = 'planning restore reason is invalid';
    end if;
    return public.restore_planning_item_transaction(
      p_root_type,
      p_root_id,
      p_expected_revision,
      p_actor_profile_id,
      p_request_ip,
      p_user_agent
    );
  end if;
  raise exception using errcode = '22023', message = 'planning trash action is invalid';
end;
$$;


ALTER FUNCTION "public"."mutate_planning_trash_command_transaction"("p_action" "text", "p_root_type" "text", "p_root_id" "text", "p_expected_revision" integer, "p_actor_profile_id" "text", "p_reason" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mutate_team_planning_reparent_command_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_id" "text", "p_item_type" "text", "p_expected_updated_at" timestamp with time zone, "p_parent_task_id" "text", "p_expected_parent_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_changed_field" "text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_request public.team_planning_item_update_requests%rowtype;
  v_result jsonb;
  v_response jsonb;
  v_before public.tasks%rowtype;
  v_after jsonb;
  v_effects jsonb := '[]'::jsonb;
begin
  if p_token_id is null or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or nullif(trim(coalesce(p_item_id, '')), '') is null
     or p_item_type not in ('initiative','deliverable','sub_issue')
     or p_expected_updated_at is null or p_idempotency_key is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$'
     or p_changed_field not in ('parentTaskId','packageId','milestoneId') then
    raise exception using errcode = '22023', message = 'team planning reparent input is invalid';
  end if;
  select * into v_token from public.team_task_intake_tokens
  where id = p_token_id and profile_id = p_profile_id and revoked_at is null and expires_at > now()
  for update;
  if not found then raise exception using errcode = 'P0004', message = 'planning items token is inactive'; end if;
  if not ('write:planning-items:update' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning items update scope is missing';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('planning-items-update:' || p_token_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_request from public.team_planning_item_update_requests
  where token_id = p_token_id and idempotency_key = p_idempotency_key;
  if found then
    if v_request.request_hash <> p_request_hash then
      raise exception using errcode = 'P0013', message = 'idempotency key conflict';
    end if;
    return jsonb_set(v_request.response, '{replayed}', 'true'::jsonb, true);
  end if;
  select * into v_before from public.tasks where id = p_item_id for update;
  v_result := public.mutate_planning_reparent_command_transaction(
    p_item_id,p_item_type,p_expected_updated_at,p_parent_task_id,p_expected_parent_updated_at,p_profile_id
  );
  v_after := v_result->'task';
  if v_before.approval_status is distinct from v_after->>'approval_status' then
    v_effects := v_effects || jsonb_build_array(jsonb_build_object('field','approvalStatus','before',v_before.approval_status,'after',v_after->>'approval_status','reason','Parent-Wechsel benötigt eine neue Freigabe.'));
  end if;
  if v_before.approval_revision is distinct from (v_after->>'approval_revision')::integer then
    v_effects := v_effects || jsonb_build_array(jsonb_build_object('field','approvalRevision','before',v_before.approval_revision,'after',(v_after->>'approval_revision')::integer,'reason','Neue Freigabe-Revision.'));
  end if;
  if v_before.sprint_id is distinct from nullif(v_after->>'sprint_id','') then
    v_effects := v_effects || jsonb_build_array(jsonb_build_object('field','sprintId','before',coalesce(v_before.sprint_id,''),'after',coalesce(v_after->>'sprint_id',''),'reason','Freigabewechsel entfernt die Sprint-Zuordnung.'));
  end if;
  if v_before.review_status is distinct from v_after->>'review_status' then
    v_effects := v_effects || jsonb_build_array(jsonb_build_object('field','reviewStatus','before',v_before.review_status,'after',v_after->>'review_status','reason','Freigabewechsel beendet den laufenden Review-Zustand.'));
  end if;
  if v_before.score_points is distinct from (v_after->>'score_points')::integer then
    v_effects := v_effects || jsonb_build_array(jsonb_build_object('field','scorePoints','before',v_before.score_points,'after',(v_after->>'score_points')::integer,'reason','Freigabewechsel setzt den Score zurück.'));
  end if;
  if v_before.score_final is distinct from (v_after->>'score_final')::boolean then
    v_effects := v_effects || jsonb_build_array(jsonb_build_object('field','scoreFinal','before',v_before.score_final,'after',(v_after->>'score_final')::boolean,'reason','Freigabewechsel setzt den finalen Score zurück.'));
  end if;
  if p_item_type in ('deliverable','sub_issue') and v_before.parent_task_id is distinct from nullif(v_after->>'parent_task_id','') then
    v_effects := v_effects || jsonb_build_array(jsonb_build_object('field','githubIssueSyncStatus','before',v_before.github_issue_sync_status,'after',v_after->>'github_issue_sync_status','reason','Planungsänderung markiert die GitHub-Projektion als erneut zu synchronisieren.'));
  end if;
  v_response := jsonb_build_object(
    'replayed', false,
    'commandKind', 'changeParent',
    'itemType', p_item_type,
    'item', v_result->'task',
    'changedFields', case when v_before.parent_task_id is distinct from nullif(v_after->>'parent_task_id','') then jsonb_build_array(p_changed_field) else '[]'::jsonb end,
    'systemEffects', v_effects
  );
  insert into public.team_planning_item_update_requests (
    token_id,profile_id,item_type,item_id,expected_updated_at,idempotency_key,request_hash,response
    ,contract_version
  ) values (
    p_token_id,p_profile_id,p_item_type,p_item_id,p_expected_updated_at,p_idempotency_key,p_request_hash,v_response,2
  );
  return v_response;
end;
$_$;


ALTER FUNCTION "public"."mutate_team_planning_reparent_command_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_id" "text", "p_item_type" "text", "p_expected_updated_at" timestamp with time zone, "p_parent_task_id" "text", "p_expected_parent_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_changed_field" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mutate_team_planning_reparent_with_projection_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_id" "text", "p_item_type" "text", "p_expected_updated_at" timestamp with time zone, "p_parent_task_id" "text", "p_expected_parent_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_changed_field" "text", "p_projection_command" "jsonb" DEFAULT NULL::"jsonb", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_result jsonb;
  v_request public.planning_github_projection_outbox%rowtype;
  v_operation_id text := 'team-update:' || p_token_id::text || ':' || p_idempotency_key::text;
begin
  v_result := public.mutate_team_planning_reparent_command_transaction(
    p_token_id, p_profile_id, p_item_id, p_item_type, p_expected_updated_at,
    p_parent_task_id, p_expected_parent_updated_at, p_idempotency_key,
    p_request_hash, p_changed_field, p_request_ip, p_user_agent
  );
  if p_projection_command is not null and not coalesce((v_result->>'replayed')::boolean, false) then
    v_request := public.enqueue_planning_github_projection_request(
      v_operation_id, p_item_id, p_profile_id,
      coalesce((p_projection_command->>'createIfMissing')::boolean, false),
      'team_update', p_token_id, p_idempotency_key, null
    );
    v_result := jsonb_set(v_result, '{githubSync}', jsonb_build_object('status', 'accepted'), true);
    update public.team_planning_item_update_requests
    set response = v_result
    where token_id = p_token_id and idempotency_key = p_idempotency_key;
  end if;
  return v_result || jsonb_build_object('projectionOperationId', v_operation_id);
end;
$$;


ALTER FUNCTION "public"."mutate_team_planning_reparent_with_projection_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_id" "text", "p_item_type" "text", "p_expected_updated_at" timestamp with time zone, "p_parent_task_id" "text", "p_expected_parent_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_changed_field" "text", "p_projection_command" "jsonb", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_planning_github_issue_reference"("p_task_type" "text", "p_github_repo" "text", "p_github_issue_number" integer, "p_issue_number" "text", "p_github_issue_url" "text", "p_issue_url" "text") RETURNS TABLE("reference_status" "text", "normalized_repo" "text", "normalized_issue_number" integer, "error_message" "text")
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $_$
declare
  v_row_repo text := lower(nullif(trim(coalesce(p_github_repo, '')), ''));
  v_legacy_number_text text := nullif(trim(coalesce(p_issue_number, '')), '');
  v_github_url text := nullif(trim(coalesce(p_github_issue_url, '')), '');
  v_legacy_url text := nullif(trim(coalesce(p_issue_url, '')), '');
  v_legacy_number integer;
  v_github_url_match text[];
  v_legacy_url_match text[];
  v_github_url_repo text;
  v_legacy_url_repo text;
  v_github_url_number integer;
  v_legacy_url_number integer;
  v_effective_repo text;
  v_effective_number integer;
begin
  if p_task_type is null or p_task_type not in ('deliverable', 'sub_issue') then
    return query select 'invalid', null::text, null::integer, 'unsupported task type';
    return;
  end if;

  if p_github_issue_number is not null and p_github_issue_number < 1 then
    return query select 'invalid', null::text, null::integer, 'github issue number must be positive';
    return;
  end if;

  if v_legacy_number_text is not null then
    if v_legacy_number_text !~ '^[1-9][0-9]*$' then
      return query select 'invalid', null::text, null::integer, 'legacy issue number is malformed';
      return;
    end if;
    if v_legacy_number_text::numeric > 2147483647 then
      return query select 'invalid', null::text, null::integer, 'legacy issue number is malformed';
      return;
    end if;
    v_legacy_number := v_legacy_number_text::integer;
  end if;

  if v_github_url is not null then
    v_github_url_match := regexp_match(
      v_github_url,
      '^https://github[.]com/([^/?#]+)/([^/?#]+)/issues/([1-9][0-9]*)([?#].*)?$',
      'i'
    );
    if v_github_url_match is null or v_github_url_match[3]::numeric > 2147483647 then
      return query select 'invalid', null::text, null::integer, 'github issue url is malformed';
      return;
    end if;
    v_github_url_repo := lower(v_github_url_match[1] || '/' || v_github_url_match[2]);
    v_github_url_number := v_github_url_match[3]::integer;
  end if;

  if v_legacy_url is not null then
    v_legacy_url_match := regexp_match(
      v_legacy_url,
      '^https://github[.]com/([^/?#]+)/([^/?#]+)/issues/([1-9][0-9]*)([?#].*)?$',
      'i'
    );
    if v_legacy_url_match is null or v_legacy_url_match[3]::numeric > 2147483647 then
      return query select 'invalid', null::text, null::integer, 'legacy issue url is malformed';
      return;
    end if;
    v_legacy_url_repo := lower(v_legacy_url_match[1] || '/' || v_legacy_url_match[2]);
    v_legacy_url_number := v_legacy_url_match[3]::integer;
  end if;

  if v_github_url_repo is not null and v_legacy_url_repo is not null
     and (v_github_url_repo <> v_legacy_url_repo or v_github_url_number <> v_legacy_url_number) then
    return query select 'invalid', null::text, null::integer, 'github issue urls conflict';
    return;
  end if;

  if p_github_issue_number is not null then
    v_effective_repo := v_row_repo;
    v_effective_number := p_github_issue_number;
    if v_legacy_number is not null and v_legacy_number <> v_effective_number then
      return query select 'invalid', null::text, null::integer, 'github issue numbers conflict';
      return;
    end if;
  elsif v_legacy_number is not null then
    v_effective_repo := v_row_repo;
    v_effective_number := v_legacy_number;
  elsif v_github_url_repo is not null or v_legacy_url_repo is not null then
    v_effective_repo := coalesce(v_github_url_repo, v_legacy_url_repo);
    v_effective_number := coalesce(v_github_url_number, v_legacy_url_number);
  else
    return query select 'missing', null::text, null::integer, null::text;
    return;
  end if;

  if v_effective_repo is null then
    return query select 'invalid', null::text, null::integer, 'github repository is missing';
    return;
  end if;

  if (v_github_url_repo is not null
      and (v_github_url_repo <> v_effective_repo or v_github_url_number <> v_effective_number))
     or (v_legacy_url_repo is not null
      and (v_legacy_url_repo <> v_effective_repo or v_legacy_url_number <> v_effective_number)) then
    return query select 'invalid', null::text, null::integer, 'github issue url conflicts with the effective issue';
    return;
  end if;

  if v_effective_repo not in (
       'findmydoc-platform/management',
       'findmydoc-platform/website',
       'findmydoc-platform/clinic-dashboard'
     )
     or (p_task_type = 'deliverable' and v_effective_repo <> 'findmydoc-platform/management') then
    return query select 'invalid', null::text, null::integer, 'github repository is not allowed for this task type';
    return;
  end if;

  return query select 'valid', v_effective_repo, v_effective_number, null::text;
end;
$_$;


ALTER FUNCTION "public"."normalize_planning_github_issue_reference"("p_task_type" "text", "p_github_repo" "text", "p_github_issue_number" integer, "p_issue_number" "text", "p_github_issue_url" "text", "p_issue_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_task_approval_state"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor_profile_id text := nullif(current_setting('app.actor_profile_id', true), '');
  v_backfill boolean := coalesce(current_setting('app.planning_hierarchy_backfill', true), 'false') = 'true';
  v_parent public.tasks%rowtype;
begin
  if new.task_type = 'epic' then
    if new.parent_task_id is not null then
      raise exception using errcode = '23514', message = 'epic cannot have a parent';
    end if;
    new.priority := null;
    new.approval_status := null;
    new.sprint_id := null;
    new.original_sprint_id := null;
    new.carried_from_task_id := null;
    new.carried_from_sprint_id := null;
    new.carryover_reason := null;
    new.carryover_count := 0;
    new.sprint_outcome := null;
    new.review_status := 'not_requested';
    new.review_owner_profile_id := null;
    new.review_requested_at := null;
    new.score_points := 0;
    new.score_final := false;
    new.score_relevant := false;
    new.github_repo := null;
    new.github_issue_number := null;
    new.github_issue_url := null;
    new.github_issue_sync_status := 'not_applicable';
    new.github_issue_last_synced_at := null;
    new.github_issue_sync_error := null;
    return new;
  end if;

  if new.task_type = 'initiative' then
    if new.parent_task_id is not null then
      select * into v_parent from public.tasks where id = new.parent_task_id;
      if not found or v_parent.task_type <> 'epic' then
        raise exception using errcode = '23514', message = 'initiative parent must be an epic';
      end if;
      if new.trashed_at is null and v_parent.trashed_at is not null then
        raise exception using errcode = '23514', message = 'active initiative parent cannot be trashed';
      end if;
    end if;
    new.approval_status := coalesce(new.approval_status, 'proposed');
    new.sprint_id := null;
    new.original_sprint_id := null;
    new.carried_from_task_id := null;
    new.carried_from_sprint_id := null;
    new.carryover_reason := null;
    new.carryover_count := 0;
    new.sprint_outcome := null;
    new.review_status := 'not_requested';
    new.review_owner_profile_id := null;
    new.review_requested_at := null;
    new.score_points := 0;
    new.score_final := false;
    new.score_relevant := false;
    new.github_repo := null;
    new.github_issue_number := null;
    new.github_issue_url := null;
    new.github_issue_sync_status := 'not_applicable';
    new.github_issue_last_synced_at := null;
    new.github_issue_sync_error := null;
    if tg_op = 'UPDATE' and old.task_type = 'initiative' and not v_backfill
       and new.parent_task_id is distinct from old.parent_task_id
       and old.approval_status = 'approved' then
      new.approval_status := 'proposed';
      new.approval_revision := old.approval_revision + 1;
      new.proposed_by := v_actor_profile_id;
      new.proposed_at := now();
      new.decided_by := null;
      new.decided_at := null;
      new.decision_note := null;
    end if;
    return new;
  end if;

  if new.task_type = 'sub_issue' then
    if new.parent_task_id is null then
      raise exception using errcode = '23514', message = 'sub-issue requires a parent deliverable';
    end if;
    select * into v_parent from public.tasks where id = new.parent_task_id;
    if not found or v_parent.task_type <> 'deliverable' then
      raise exception using errcode = '23514', message = 'sub-issue parent must be a deliverable';
    end if;
    if new.trashed_at is null and v_parent.trashed_at is not null then
      raise exception using errcode = '23514', message = 'active sub-issue parent cannot be trashed';
    end if;
    if tg_op = 'INSERT' and not v_backfill and v_parent.approval_status is distinct from 'approved' then
      raise exception using errcode = '23514', message = 'sub-issue parent must be approved';
    end if;
    new.approval_status := null;
    new.sprint_id := null;
    new.review_status := 'not_requested';
    new.review_owner_profile_id := null;
    new.review_requested_at := null;
    new.score_points := 0;
    new.score_final := false;
    new.score_relevant := false;
    return new;
  end if;

  if new.task_type <> 'deliverable' then
    raise exception using errcode = '23514', message = 'unsupported task type';
  end if;
  if new.parent_task_id is not null then
    select * into v_parent from public.tasks where id = new.parent_task_id;
    if not found or v_parent.task_type <> 'initiative' then
      raise exception using errcode = '23514', message = 'deliverable parent must be an initiative';
    end if;
    if new.trashed_at is null and v_parent.trashed_at is not null then
      raise exception using errcode = '23514', message = 'active deliverable parent cannot be trashed';
    end if;
  elsif new.approval_status = 'approved'
    and not v_backfill
    and not (tg_op = 'UPDATE' and new.parent_task_id is distinct from old.parent_task_id) then
    raise exception using errcode = '23514', message = 'approved deliverable requires an initiative parent';
  end if;
  new.approval_status := coalesce(new.approval_status, 'proposed');
  new.github_repo := 'findmydoc-platform/management';
  if tg_op = 'UPDATE' and old.task_type = 'deliverable' and not v_backfill
     and new.parent_task_id is distinct from old.parent_task_id
     and old.approval_status = 'approved' then
    new.approval_status := 'proposed';
    new.approval_revision := old.approval_revision + 1;
    new.proposed_by := v_actor_profile_id;
    new.proposed_at := now();
    new.decided_by := null;
    new.decided_at := null;
    new.decision_note := null;
    new.sprint_id := null;
    new.review_status := 'not_requested';
    new.review_requested_at := null;
    new.score_points := 0;
    new.score_final := false;
    insert into public.task_activity (task_id, message)
    values (new.id, 'Parent geändert: neue Freigabe erforderlich');
  end if;
  if new.approval_status <> 'approved' then
    new.sprint_id := null;
    new.score_relevant := false;
  else
    new.score_relevant := new.sprint_id is not null;
  end if;
  if new.status = 'Review'
     and (new.approval_status is distinct from 'approved' or new.review_status is distinct from 'requested') then
    new.status := 'In Arbeit';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."normalize_task_approval_state"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."normalize_task_approval_state"() IS 'Normalizes the canonical Epic, Initiative, Deliverable and Sub-Issue hierarchy without deriving parent status from children.';



CREATE OR REPLACE FUNCTION "public"."planning_legacy_item_id"("p_kind" "text", "p_project_id" "text", "p_legacy_id" "text") RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
declare
  v_primary text := p_kind || '-' || md5(p_kind || ':' || p_project_id || ':' || p_legacy_id);
  v_fallback text := p_kind || '-legacy-' || md5('fallback:' || p_kind || ':' || p_project_id || ':' || p_legacy_id);
begin
  if p_kind not in ('epic', 'initiative')
     or nullif(trim(coalesce(p_project_id, '')), '') is null
     or nullif(trim(coalesce(p_legacy_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'legacy planning identity input is invalid';
  end if;

  if not exists (select 1 from public.tasks where id = v_primary) then
    return v_primary;
  end if;

  if not exists (select 1 from public.tasks where id = v_fallback) then
    return v_fallback;
  end if;

  raise exception using errcode = '23505', message = 'deterministic planning identity collision';
end;
$$;


ALTER FUNCTION "public"."planning_legacy_item_id"("p_kind" "text", "p_project_id" "text", "p_legacy_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."planning_trash_root_is_purge_eligible"("p_root_type" "text", "p_root_id" "text", "p_trash_revision" integer) RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
declare
  v_root public.tasks%rowtype;
begin
  if p_root_type not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_root_id, '')), '') is null
     or p_trash_revision is null or p_trash_revision < 1 then
    return false;
  end if;
  select * into v_root from public.tasks
  where id = p_root_id and task_type = p_root_type and trashed_at is not null
    and trash_root_type = p_root_type and trash_root_id = p_root_id
    and trash_revision = p_trash_revision and purge_after <= now();
  if not found then return false; end if;

  if exists (
    with recursive expected as (
      select id from public.tasks where id = p_root_id
      union all
      select child.id from public.tasks child join expected parent on child.parent_task_id = parent.id
    )
    select 1 from expected
    join public.tasks item using (id)
    where item.trashed_at is distinct from v_root.trashed_at
       or item.purge_after is distinct from v_root.purge_after
       or item.trash_cause is distinct from v_root.trash_cause
       or item.trash_root_type is distinct from p_root_type
       or item.trash_root_id is distinct from p_root_id
       or item.trash_revision is distinct from p_trash_revision
  ) or exists (
    with recursive expected as (
      select id from public.tasks where id = p_root_id
      union all
      select child.id from public.tasks child join expected parent on child.parent_task_id = parent.id
    )
    select 1 from public.tasks item
    where item.trashed_at is not null and item.trash_root_type = p_root_type
      and item.trash_root_id = p_root_id and item.trash_revision = p_trash_revision
      and not exists (select 1 from expected where expected.id = item.id)
  ) then
    return false;
  end if;

  if exists (
    with recursive expected as (
      select id, task_type from public.tasks where id = p_root_id
      union all
      select child.id, child.task_type from public.tasks child join expected parent on child.parent_task_id = parent.id
    )
    select 1 from expected item
    where item.task_type in ('deliverable', 'sub_issue')
      and not exists (
        select 1 from public.planning_github_lifecycle_outbox lifecycle
        where lifecycle.root_type = p_root_type and lifecycle.root_id = p_root_id
          and lifecycle.root_trash_revision = p_trash_revision and lifecycle.task_id = item.id
          and lifecycle.action = 'close_not_planned' and lifecycle.status = 'completed'
          and ((lifecycle.github_issue_number is null and lifecycle.status_reason = 'issue_missing')
            or (lifecycle.github_issue_number is not null and lifecycle.status_reason = 'delivered'))
      )
  ) or exists (
    with recursive expected as (
      select id, task_type from public.tasks where id = p_root_id
      union all
      select child.id, child.task_type from public.tasks child join expected parent on child.parent_task_id = parent.id
    )
    select 1 from public.planning_github_lifecycle_outbox lifecycle
    where lifecycle.root_type = p_root_type and lifecycle.root_id = p_root_id
      and lifecycle.root_trash_revision = p_trash_revision and lifecycle.action = 'close_not_planned'
      and not exists (
        select 1 from expected where expected.id = lifecycle.task_id
          and expected.task_type in ('deliverable', 'sub_issue')
      )
  ) then
    return false;
  end if;
  return true;
end;
$$;


ALTER FUNCTION "public"."planning_trash_root_is_purge_eligible"("p_root_type" "text", "p_root_id" "text", "p_trash_revision" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_empty_epic_delete"("p_item_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_epic public.tasks%rowtype;
  v_initiative_count bigint := 0;
  v_task_count bigint := 0;
begin
  if nullif(trim(coalesce(p_item_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'empty epic delete preparation input is invalid';
  end if;
  select * into v_epic from public.tasks
  where id = p_item_id and project_id = 'findmydoc-founder-execution'
    and task_type = 'epic' and trashed_at is null;
  if not found then
    return jsonb_build_object('item', null, 'children', jsonb_build_object('initiatives', 0, 'tasks', 0));
  end if;
  with recursive descendants as (
    select id, task_type from public.tasks where parent_task_id = p_item_id and trashed_at is null
    union all
    select child.id, child.task_type
    from public.tasks child join descendants parent on child.parent_task_id = parent.id
    where child.trashed_at is null
  )
  select count(*) filter (where task_type = 'initiative'),
    count(*) filter (where task_type in ('deliverable', 'sub_issue'))
  into v_initiative_count, v_task_count from descendants;
  return jsonb_build_object(
    'item', to_jsonb(v_epic),
    'children', jsonb_build_object('initiatives', v_initiative_count, 'tasks', v_task_count)
  );
end;
$$;


ALTER FUNCTION "public"."prepare_empty_epic_delete"("p_item_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_google_team_workweek_reconciliation"("p_owner_profile_id" "text", "p_source_publication_id" "uuid", "p_source_publication_revision" integer, "p_effective_from" "date", "p_observations" "jsonb", "p_windows" "jsonb", "p_fingerprint" "text", "p_observed_at" timestamp with time zone DEFAULT "clock_timestamp"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_source public.team_workweek_publications%rowtype;
  v_existing public.team_workweek_versions%rowtype;
  v_target_version_id uuid;
  v_target_publication_id uuid;
  v_revision integer;
  v_recurrence_count integer;
  v_window jsonb;
  v_weekday smallint;
  v_start_minute smallint;
  v_end_minute smallint;
  v_today date;
  v_next_monday date;
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
    and effective_to is null
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
      and version.effective_from > v_source.effective_from
      and not exists (
        select 1
        from public.team_workweek_publications as publication
        where publication.source_version_id = version.id
      )
  ) then
    raise exception using errcode = 'P0003', message = 'an owner workweek draft is already preparing';
  end if;

  v_today := (p_observed_at at time zone 'Europe/Berlin')::date;
  v_next_monday := v_today + case
    when extract(isodow from v_today)::integer = 1 then 7
    else 8 - extract(isodow from v_today)::integer
  end;
  if p_effective_from is null
    or extract(isodow from p_effective_from)::integer <> 1
    or p_effective_from < v_next_monday
    or p_effective_from <= v_source.effective_from then
    raise exception using errcode = '22023', message = 'Google reconciliation must start at a future Monday';
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

  insert into public.team_workweek_versions (
    owner_profile_id,
    effective_from,
    origin,
    google_reconciliation_source_publication_id,
    google_reconciliation_fingerprint
  ) values (
    p_owner_profile_id,
    p_effective_from,
    'google_reconciliation',
    p_source_publication_id,
    p_fingerprint
  ) returning id into v_target_version_id;

  for v_window in select value from jsonb_array_elements(p_windows)
  loop
    if jsonb_typeof(v_window) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(v_window) as key
        where key not in ('weekday', 'startMinute', 'endMinute')
      )
      or v_window->>'weekday' is null
      or v_window->>'startMinute' is null
      or v_window->>'endMinute' is null then
      raise exception using errcode = '22023', message = 'Google reconciliation window contains unsupported fields';
    end if;
    begin
      v_weekday := (v_window->>'weekday')::smallint;
      v_start_minute := (v_window->>'startMinute')::smallint;
      v_end_minute := (v_window->>'endMinute')::smallint;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'Google reconciliation window contains invalid values';
    end;
    if v_weekday not between 1 and 7
      or v_start_minute not between 0 and 1438
      or v_end_minute not between 1 and 1439
      or v_start_minute >= v_end_minute
      or (
        select count(*) from public.team_workweek_windows
        where version_id = v_target_version_id and weekday = v_weekday
      ) >= 12
      or exists (
        select 1 from public.team_workweek_windows
        where version_id = v_target_version_id
          and weekday = v_weekday
          and v_start_minute < end_minute
          and v_end_minute > start_minute
      ) then
      raise exception using errcode = '22023', message = 'Google reconciliation windows overlap or are invalid';
    end if;
    insert into public.team_workweek_windows (version_id, weekday, start_minute, end_minute)
    values (v_target_version_id, v_weekday, v_start_minute, v_end_minute);
  end loop;

  select coalesce(max(publication_revision), 0) + 1
  into v_revision
  from public.team_workweek_publications
  where owner_profile_id = p_owner_profile_id;

  insert into public.team_workweek_publications (
    source_version_id,
    owner_profile_id,
    effective_from,
    timezone,
    windows,
    publication_revision,
    predecessor_publication_id
  ) values (
    v_target_version_id,
    p_owner_profile_id,
    p_effective_from,
    'Europe/Berlin',
    p_windows,
    v_revision,
    p_source_publication_id
  ) returning id into v_target_publication_id;

  v_recurrence_count := (p_effective_from - v_source.effective_from) / 7;
  insert into public.team_workweek_google_series_transitions (
    activation_publication_id,
    predecessor_series_id,
    owner_profile_id,
    expected_etag,
    expected_founderops_revision,
    recurrence_count,
    state,
    confirmed_etag,
    last_observed_at,
    last_confirmed_at,
    created_at,
    updated_at
  )
  select
    v_target_publication_id,
    series.id,
    p_owner_profile_id,
    series.confirmed_etag,
    series.confirmed_founderops_revision,
    v_recurrence_count,
    'confirmed',
    series.confirmed_etag,
    p_observed_at,
    p_observed_at,
    p_observed_at,
    p_observed_at
  from public.team_workweek_google_series as series
  where series.publication_id = p_source_publication_id
    and series.state = 'confirmed'
    and series.provider_state = 'deleted';

  insert into public.team_workweek_google_reconciliation_status (
    publication_id,
    owner_profile_id,
    state,
    last_observed_at,
    last_error_class,
    updated_at
  ) values (
    p_source_publication_id,
    p_owner_profile_id,
    'pending',
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

  return jsonb_build_object(
    'versionId', v_target_version_id,
    'effectiveFrom', p_effective_from,
    'replayed', false
  );
end;
$_$;


ALTER FUNCTION "public"."prepare_google_team_workweek_reconciliation"("p_owner_profile_id" "text", "p_source_publication_id" "uuid", "p_source_publication_revision" integer, "p_effective_from" "date", "p_observations" "jsonb", "p_windows" "jsonb", "p_fingerprint" "text", "p_observed_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_google_workspace_disconnect"("p_owner_profile_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_owner_role text;
  v_operation public.google_workspace_disconnect_operations%rowtype;
  v_today date := (clock_timestamp() at time zone 'Europe/Berlin')::date;
  v_cutoff date;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  select profile.platform_role into v_owner_role
  from public.profiles as profile where profile.id = p_owner_profile_id;
  if not found or nullif(btrim(p_owner_profile_id), '') is null or v_owner_role not in ('ceo', 'founder', 'deputy') then
    raise exception using errcode = '42501', message = 'planning contributor profile required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id, 0));
  select * into v_operation from public.google_workspace_disconnect_operations
  where owner_profile_id = p_owner_profile_id and state <> 'completed'
  for update;
  if found then
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

  insert into public.google_workspace_disconnect_series (
    operation_id, series_id, calendar_id, google_event_id, expected_etag,
    expected_founderops_revision, cleanup_action, recurrence_count
  )
  select v_operation.id, series.id, series.calendar_id, series.google_event_id,
    series.confirmed_etag, series.confirmed_founderops_revision,
    case when publication.effective_from >= v_cutoff then 'delete' else 'truncate' end,
    case when publication.effective_from >= v_cutoff then null else (v_cutoff - publication.effective_from) / 7 end
  from public.team_workweek_google_series as series
  join public.team_workweek_publications as publication on publication.id = series.publication_id
  where publication.owner_profile_id = p_owner_profile_id
    and publication.status = 'published'
    and (publication.effective_to is null or publication.effective_to >= v_cutoff)
    and series.state = 'confirmed'
    and series.provider_state = 'active';

  update public.team_workweek_google_series as series
  set future_cleanup_state = 'pending', future_cleanup_confirmed_at = null, updated_at = clock_timestamp()
  where exists (
    select 1 from public.google_workspace_disconnect_series as target
    where target.operation_id = v_operation.id and target.series_id = series.id
  );

  return jsonb_build_object(
    'id', v_operation.id,
    'state', v_operation.state,
    'pendingSeries', (select count(*) from public.google_workspace_disconnect_series where operation_id = v_operation.id),
    'replayed', false
  );
end;
$$;


ALTER FUNCTION "public"."prepare_google_workspace_disconnect"("p_owner_profile_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_planning_approval_command"("p_item_id" "text", "p_expected_kind" "text", "p_actor_profile_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_actor_role text;
  v_accountable_count integer := 0;
  v_responsible_count integer := 0;
begin
  if nullif(trim(coalesce(p_item_id, '')), '') is null
     or p_expected_kind not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_actor_profile_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'planning approval preparation input is invalid';
  end if;
  select * into v_task from public.tasks where id = p_item_id;
  if v_task.id is not null and v_task.parent_task_id is not null then
    select * into v_parent from public.tasks where id = v_task.parent_task_id;
  end if;
  if v_task.task_type = 'initiative' then
    select count(*) filter (where role = 'accountable'), count(*) filter (where role = 'responsible')
    into v_accountable_count, v_responsible_count
    from public.planning_item_raci_assignments where task_id = v_task.id;
  end if;
  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  return jsonb_build_object(
    'task', case when v_task.id is null then null else to_jsonb(v_task) end,
    'parent', case when v_parent.id is null then null else to_jsonb(v_parent) end,
    'actorRole', coalesce(v_actor_role, ''),
    'accountableCount', v_accountable_count,
    'responsibleCount', v_responsible_count,
    'profiles', coalesce((select jsonb_agg(jsonb_build_object('id', profile.id, 'name', profile.name))
      from public.profiles profile where profile.id in (v_task.owner, v_task.assignee, v_task.created_by)), '[]'::jsonb),
    'strategy', (select to_jsonb(strategy) from public.planning_item_strategy strategy where strategy.task_id = v_task.id),
    'raciAssignments', coalesce((select jsonb_agg(to_jsonb(raci) order by raci.sort_order, raci.profile_id)
      from public.planning_item_raci_assignments raci where raci.task_id = v_task.id), '[]'::jsonb)
  );
end;
$$;


ALTER FUNCTION "public"."prepare_planning_approval_command"("p_item_id" "text", "p_expected_kind" "text", "p_actor_profile_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_planning_relationship_command"("p_task_id" "text", "p_related_task_id" "text", "p_relation_id" bigint, "p_relation_type" "text", "p_actor_profile_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_source public.tasks%rowtype;
  v_related public.tasks%rowtype;
  v_relation public.task_relationship_edges%rowtype;
  v_existing public.task_relationship_edges%rowtype;
  v_actor_name text;
  v_initiative_id text;
  v_initiative public.tasks%rowtype;
  v_accountable_profile_id text;
  v_other_task_id text;
  v_review_locked boolean := false;
  v_final_review_locked boolean := false;
begin
  if nullif(trim(coalesce(p_task_id, '')), '') is null
     or nullif(trim(coalesce(p_actor_profile_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'planning relationship preparation input is invalid';
  end if;

  select name into v_actor_name
  from public.profiles
  where id = p_actor_profile_id;

  select * into v_source
  from public.tasks
  where id = p_task_id;

  if p_relation_id is not null then
    select * into v_relation
    from public.task_relationship_edges
    where id = p_relation_id;
    if found then
      v_other_task_id := case
        when v_relation.task_id = p_task_id then v_relation.related_task_id
        when v_relation.related_task_id = p_task_id then v_relation.task_id
        else null
      end;
    end if;
  else
    v_other_task_id := nullif(trim(coalesce(p_related_task_id, '')), '');
  end if;

  if v_other_task_id is not null then
    select * into v_related
    from public.tasks
    where id = v_other_task_id;
  end if;

  if p_relation_id is null and v_source.id is not null and v_related.id is not null then
    select * into v_existing
    from public.task_relationship_edges
    where task_id = v_source.id
      and related_task_id = v_related.id
      and relation_type = p_relation_type
    order by id
    limit 1;
  end if;

  if v_source.task_type = 'initiative' then
    v_initiative_id := v_source.id;
  elsif v_source.task_type = 'deliverable' then
    v_initiative_id := v_source.parent_task_id;
  elsif v_source.task_type = 'sub_issue' and v_source.parent_task_id is not null then
    select parent_task_id into v_initiative_id
    from public.tasks
    where id = v_source.parent_task_id and task_type = 'deliverable';
  end if;

  if v_initiative_id is not null then
    select * into v_initiative
    from public.tasks
    where id = v_initiative_id and task_type = 'initiative' and trashed_at is null;
    select profile_id into v_accountable_profile_id
    from public.planning_item_raci_assignments
    where task_id = v_initiative_id and role = 'accountable'
    order by sort_order, profile_id
    limit 1;
  end if;

  if v_source.id is not null then
    select exists (
      select 1
      from public.tasks candidate
      where candidate.id = any(array[
        v_source.id,
        v_source.parent_task_id,
        v_related.id,
        v_related.parent_task_id
      ])
        and (
          (candidate.review_status = 'requested' and not coalesce(candidate.score_final, false))
          or (candidate.review_status = 'accepted' and coalesce(candidate.score_final, false))
        )
    ) into v_review_locked;
    select exists (
      select 1
      from public.tasks candidate
      where candidate.id = any(array[
        v_source.id,
        v_source.parent_task_id,
        v_related.id,
        v_related.parent_task_id
      ])
        and candidate.review_status = 'accepted'
        and coalesce(candidate.score_final, false)
    ) into v_final_review_locked;
  end if;

  return jsonb_build_object(
    'source', case when v_source.id is null then null else to_jsonb(v_source) end,
    'related', case when v_related.id is null then null else to_jsonb(v_related) end,
    'relation', case when v_relation.id is null then null else to_jsonb(v_relation) end,
    'existingRelation', case when v_existing.id is null then null else to_jsonb(v_existing) end,
    'actorName', coalesce(v_actor_name, ''),
    'initiative', case when v_initiative.id is null then null else jsonb_build_object(
      'id', v_initiative.id,
      'ownerId', coalesce(v_initiative.owner, ''),
      'accountableProfileId', coalesce(v_accountable_profile_id, v_initiative.owner, '')
    ) end,
    'reviewLocked', v_review_locked,
    'finalReviewLocked', v_final_review_locked
  );
end;
$$;


ALTER FUNCTION "public"."prepare_planning_relationship_command"("p_task_id" "text", "p_related_task_id" "text", "p_relation_id" bigint, "p_relation_type" "text", "p_actor_profile_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_planning_reparent_command"("p_item_id" "text", "p_parent_id" "text", "p_expected_kind" "text", "p_actor_profile_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_old_parent public.tasks%rowtype;
  v_actor public.profiles%rowtype;
  v_item_id text := nullif(trim(coalesce(p_item_id, '')), '');
  v_parent_id text := nullif(trim(coalesce(p_parent_id, '')), '');
begin
  if v_item_id is null or p_expected_kind not in ('initiative', 'deliverable', 'sub_issue', 'any') then
    raise exception using errcode = '22023', message = 'planning reparent preparation input is invalid';
  end if;
  select * into v_task from public.tasks where id = v_item_id;
  if v_task.id is not null and v_task.parent_task_id is not null then
    select * into v_old_parent from public.tasks where id = v_task.parent_task_id;
  end if;
  if v_parent_id is not null then select * into v_parent from public.tasks where id = v_parent_id; end if;
  select * into v_actor from public.profiles where id = p_actor_profile_id;
  return jsonb_build_object(
    'task', case when v_task.id is null then null else to_jsonb(v_task) end,
    'parent', case when v_parent.id is null then null else to_jsonb(v_parent) end,
    'oldParent', case when v_old_parent.id is null then null else to_jsonb(v_old_parent) end,
    'requestedParentId', v_parent_id,
    'actor', case when v_actor.id is null then null else jsonb_build_object(
      'id', v_actor.id, 'name', v_actor.name, 'role', v_actor.platform_role
    ) end,
    'profiles', coalesce((select jsonb_agg(jsonb_build_object('id', profile.id, 'name', profile.name))
      from public.profiles profile where profile.id in (v_task.owner, v_task.assignee, v_task.created_by)), '[]'::jsonb),
    'strategy', (select to_jsonb(strategy) from public.planning_item_strategy strategy where strategy.task_id = v_task.id),
    'raciAssignments', coalesce((select jsonb_agg(to_jsonb(raci) order by raci.sort_order, raci.profile_id)
      from public.planning_item_raci_assignments raci where raci.task_id = v_task.id), '[]'::jsonb)
  );
end;
$$;


ALTER FUNCTION "public"."prepare_planning_reparent_command"("p_item_id" "text", "p_parent_id" "text", "p_expected_kind" "text", "p_actor_profile_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_planning_review_command"("p_task_id" "text", "p_requested_reviewer_profile_id" "text", "p_actor_profile_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task public.tasks%rowtype;
  v_actor_name text;
  v_reviewer public.profiles%rowtype;
  v_default_reviewer public.profiles%rowtype;
  v_reviewer_profile_id text;
  v_default_reviewer_profile_id text;
  v_initiative_id text;
  v_initiative_owner_id text;
  v_accountable_profile_id text;
  v_sprint_locked boolean := false;
begin
  if nullif(trim(coalesce(p_task_id, '')), '') is null
     or nullif(trim(coalesce(p_actor_profile_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'planning review preparation input is invalid';
  end if;

  select name into v_actor_name
  from public.profiles
  where id = p_actor_profile_id;

  select * into v_task
  from public.tasks
  where id = p_task_id;

  if v_task.id is not null then
    if v_task.task_type = 'initiative' then
      v_initiative_id := v_task.id;
    elsif v_task.task_type = 'deliverable' then
      v_initiative_id := v_task.parent_task_id;
    end if;

    if v_initiative_id is not null then
      select owner into v_initiative_owner_id
      from public.tasks
      where id = v_initiative_id
        and task_type = 'initiative'
        and trashed_at is null;
      select profile_id into v_accountable_profile_id
      from public.planning_item_raci_assignments
      where task_id = v_initiative_id and role = 'accountable'
      order by sort_order, profile_id
      limit 1;
    end if;

    v_default_reviewer_profile_id := coalesce(
      nullif(trim(coalesce(v_task.review_owner_profile_id, '')), ''),
      nullif(trim(coalesce(v_accountable_profile_id, '')), ''),
      nullif(trim(coalesce(v_initiative_owner_id, '')), '')
    );
    v_reviewer_profile_id := coalesce(
      nullif(trim(coalesce(p_requested_reviewer_profile_id, '')), ''),
      v_default_reviewer_profile_id
    );
    if v_reviewer_profile_id is not null then
      select * into v_reviewer
      from public.profiles
      where id = v_reviewer_profile_id;
    end if;
    if v_default_reviewer_profile_id is not null then
      select * into v_default_reviewer
      from public.profiles
      where id = v_default_reviewer_profile_id;
    end if;
    if v_task.sprint_id is not null then
      select coalesce(score_locked, false) into v_sprint_locked
      from public.sprints
      where id = v_task.sprint_id;
    end if;
  end if;

  return jsonb_build_object(
    'task', case when v_task.id is null then null else to_jsonb(v_task) end,
    'actorName', coalesce(v_actor_name, ''),
    'reviewer', case when v_reviewer.id is null then null else jsonb_build_object(
      'id', v_reviewer.id,
      'contributor', v_reviewer.platform_role in ('ceo', 'deputy', 'founder')
    ) end,
    'defaultReviewer', case when v_default_reviewer.id is null then null else jsonb_build_object(
      'id', v_default_reviewer.id,
      'contributor', v_default_reviewer.platform_role in ('ceo', 'deputy', 'founder')
    ) end,
    'sprintLocked', v_sprint_locked
  );
end;
$$;


ALTER FUNCTION "public"."prepare_planning_review_command"("p_task_id" "text", "p_requested_reviewer_profile_id" "text", "p_actor_profile_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_planning_trash_command"("p_item_id" "text", "p_expected_kind" "text", "p_actor_profile_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_actor_role text;
  v_item_id text := nullif(trim(coalesce(p_item_id, '')), '');
  v_affected_task_ids text[] := array[]::text[];
begin
  if v_item_id is null
     or p_expected_kind not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_actor_profile_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'planning trash preparation input is invalid';
  end if;

  select * into v_task from public.tasks where id = v_item_id;
  if v_task.id is not null and v_task.parent_task_id is not null then
    select * into v_parent from public.tasks where id = v_task.parent_task_id;
  end if;
  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;

  if v_task.id is not null then
    if v_task.trashed_at is null then
      with recursive planning_tree as (
        select task.id
        from public.tasks task
        where task.id = v_task.id
        union all
        select child.id
        from public.tasks child
        join planning_tree parent on child.parent_task_id = parent.id
        where child.trashed_at is null
      )
      select coalesce(array_agg(id order by id), array[]::text[])
      into v_affected_task_ids
      from planning_tree;
    else
      select coalesce(array_agg(id order by id), array[]::text[])
      into v_affected_task_ids
      from public.tasks
      where trash_root_type = v_task.trash_root_type
        and trash_root_id = v_task.trash_root_id
        and trash_revision = v_task.trash_revision
        and trashed_at is not null;
    end if;
  end if;

  return jsonb_build_object(
    'task', case when v_task.id is null then null else to_jsonb(v_task) end,
    'parent', case when v_parent.id is null then null else to_jsonb(v_parent) end,
    'actorRole', coalesce(v_actor_role, ''),
    'affectedTaskIds', to_jsonb(v_affected_task_ids)
  );
end;
$$;


ALTER FUNCTION "public"."prepare_planning_trash_command"("p_item_id" "text", "p_expected_kind" "text", "p_actor_profile_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_task_deletion_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text" DEFAULT NULL::"text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_operation public.task_deletion_operations%rowtype;
  v_task public.tasks%rowtype;
  v_deleted_task_ids text[];
  v_task_snapshots jsonb;
begin
  if nullif(trim(coalesce(p_task_id, '')), '') is null or p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'task id and expected update timestamp are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_task_id, 0));

  select * into v_operation
  from public.task_deletion_operations
  where task_id = p_task_id;

  if v_operation.id is not null then
    if v_operation.status = 'completed' then
      select * into v_task from public.tasks where id = p_task_id for update;
      if v_task.id is null then
        return jsonb_build_object(
          'operationId', v_operation.id,
          'status', v_operation.status,
          'task', v_operation.task_snapshot,
          'tasks', v_operation.task_snapshots,
          'deletedTaskIds', to_jsonb(v_operation.deleted_task_ids),
          'githubClosed', v_operation.github_closed
        );
      end if;
      delete from public.task_deletion_operations where id = v_operation.id;
      v_operation := null;
    else
      select * into v_task from public.tasks where id = p_task_id for update;
      if v_task.id is null then
        raise exception using errcode = 'P0002', message = 'task not found';
      end if;

      if v_task.updated_at = v_operation.task_updated_at then
        return jsonb_build_object(
          'operationId', v_operation.id,
          'status', v_operation.status,
          'task', v_operation.task_snapshot,
          'tasks', v_operation.task_snapshots,
          'deletedTaskIds', to_jsonb(v_operation.deleted_task_ids),
          'githubClosed', v_operation.github_closed
        );
      end if;

      delete from public.task_deletion_operations where id = v_operation.id;
      v_operation := null;
    end if;
  end if;

  select * into v_task
  from public.tasks
  where id = p_task_id
    and updated_at = p_expected_updated_at
  for update;

  if v_task.id is null then
    if exists (select 1 from public.tasks where id = p_task_id) then
      raise exception using errcode = 'P0001', message = 'task was changed concurrently';
    end if;
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  with recursive deletion_tree as (
    select id from public.tasks where id = p_task_id
    union
    select child.id
    from public.tasks as child
    join deletion_tree as parent on child.parent_task_id = parent.id
  )
  select coalesce(array_agg(id order by id), '{}'::text[])
  into v_deleted_task_ids
  from deletion_tree;

  select coalesce(jsonb_agg(to_jsonb(task) order by task.id), '[]'::jsonb)
  into v_task_snapshots
  from public.tasks as task
  where task.id = any(v_deleted_task_ids);

  insert into public.task_deletion_operations (
    task_id,
    task_updated_at,
    task_snapshot,
    task_snapshots,
    deleted_task_ids,
    actor_profile_id,
    request_ip,
    user_agent
  )
  values (
    p_task_id,
    v_task.updated_at,
    to_jsonb(v_task),
    v_task_snapshots,
    v_deleted_task_ids,
    p_actor_profile_id,
    p_request_ip,
    p_user_agent
  )
  returning * into v_operation;

  return jsonb_build_object(
    'operationId', v_operation.id,
    'status', v_operation.status,
    'task', v_operation.task_snapshot,
    'tasks', v_operation.task_snapshots,
    'deletedTaskIds', to_jsonb(v_operation.deleted_task_ids),
    'githubClosed', v_operation.github_closed
  );
end;
$$;


ALTER FUNCTION "public"."prepare_task_deletion_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."prepare_task_deletion_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") IS 'Validates task deletion with compare-and-set and stores a durable deletion snapshot.';



CREATE OR REPLACE FUNCTION "public"."prepare_team_workweek_google_conflict_resolution"("p_conflict_id" "uuid", "p_owner_profile_id" "text", "p_conflict_revision" integer, "p_decision" "text", "p_google_observations" "jsonb", "p_google_fingerprint" "text", "p_founderops_fingerprint" "text", "p_resolution_fingerprint" "text", "p_observed_at" timestamp with time zone DEFAULT "clock_timestamp"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_conflict public.team_workweek_google_conflicts%rowtype;
  v_founderops_version public.team_workweek_versions%rowtype;
  v_version_id uuid;
  v_effective_from date;
  v_windows jsonb;
  v_window jsonb;
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
      and effective_to is null
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
      and candidate.origin = 'owner'
      and not exists (
        select 1 from public.team_workweek_publications as publication
        where publication.source_version_id = candidate.id
      )
    order by candidate.created_at desc, candidate.id desc
    limit 1
  ) then
    raise exception using errcode = 'P0004', message = 'FounderOps draft changed after conflict capture';
  end if;

  perform public.apply_google_team_workweek_observations(
    v_conflict.base_publication_id,
    v_conflict.base_publication_revision,
    p_google_observations,
    p_observed_at
  );

  if p_decision = 'google' then
    v_effective_from := v_conflict.google_effective_from;
    v_windows := v_conflict.google_windows;
  else
    v_effective_from := v_founderops_version.effective_from;
    select coalesce(jsonb_agg(jsonb_build_object(
      'weekday', work_window.weekday,
      'startMinute', work_window.start_minute,
      'endMinute', work_window.end_minute
    ) order by work_window.weekday, work_window.start_minute, work_window.end_minute, work_window.id), '[]'::jsonb)
    into v_windows
    from public.team_workweek_windows as work_window
    where work_window.version_id = v_founderops_version.id;
  end if;

  insert into public.team_workweek_versions (
    owner_profile_id,
    effective_from,
    origin,
    google_reconciliation_source_publication_id,
    google_reconciliation_fingerprint
  ) values (
    p_owner_profile_id,
    v_effective_from,
    'google_reconciliation',
    v_conflict.base_publication_id,
    p_resolution_fingerprint
  )
  returning id into v_version_id;

  for v_window in select value from jsonb_array_elements(v_windows)
  loop
    insert into public.team_workweek_windows (version_id, weekday, start_minute, end_minute)
    values (
      v_version_id,
      (v_window->>'weekday')::smallint,
      (v_window->>'startMinute')::smallint,
      (v_window->>'endMinute')::smallint
    );
  end loop;

  update public.team_workweek_google_conflicts
  set state = 'resolving',
    decision = p_decision,
    resolution_version_id = v_version_id,
    updated_at = p_observed_at
  where id = v_conflict.id;

  return jsonb_build_object('versionId', v_version_id, 'state', 'resolving', 'replayed', false);
end;
$_$;


ALTER FUNCTION "public"."prepare_team_workweek_google_conflict_resolution"("p_conflict_id" "uuid", "p_owner_profile_id" "text", "p_conflict_revision" integer, "p_decision" "text", "p_google_observations" "jsonb", "p_google_fingerprint" "text", "p_founderops_fingerprint" "text", "p_resolution_fingerprint" "text", "p_observed_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_team_workweek_publication"("p_version_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_owner_profile_id text;
  v_owner_role text;
  v_version public.team_workweek_versions%rowtype;
  v_publication public.team_workweek_publications%rowtype;
  v_predecessor public.team_workweek_publications%rowtype;
  v_window record;
  v_series_id uuid;
  v_windows jsonb;
  v_series jsonb;
  v_transitions jsonb;
  v_revision integer;
  v_recurrence_count integer;
begin
  select profile.id, profile.platform_role into v_owner_profile_id, v_owner_role
  from public.profiles as profile where profile.auth_user_id = auth.uid();
  if not found or v_owner_profile_id is null or v_owner_role not in ('ceo', 'founder', 'deputy') then
    raise exception using errcode = '42501', message = 'planning contributor profile required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner_profile_id, 0));
  select * into v_version from public.team_workweek_versions
  where id = p_version_id and owner_profile_id = v_owner_profile_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'private team workweek version not found'; end if;
  select * into v_publication from public.team_workweek_publications
  where source_version_id = v_version.id and owner_profile_id = v_owner_profile_id for update;
  if not found then
    if exists (select 1 from public.team_workweek_publications where owner_profile_id = v_owner_profile_id and status = 'preparing') then
      raise exception using errcode = 'P0003', message = 'another team workweek publication is still preparing';
    end if;
    select * into v_predecessor from public.team_workweek_publications
    where owner_profile_id = v_owner_profile_id and status = 'published'
    order by effective_from desc, publication_revision desc, id desc limit 1 for update;
    if found and v_version.effective_from <= v_predecessor.effective_from then
      raise exception using errcode = '22023', message = 'effective boundary must follow latest published workweek';
    end if;
    select coalesce(max(publication_revision), 0) + 1 into v_revision
    from public.team_workweek_publications where owner_profile_id = v_owner_profile_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'weekday', work_window.weekday, 'startMinute', work_window.start_minute, 'endMinute', work_window.end_minute
    ) order by work_window.weekday, work_window.start_minute, work_window.end_minute, work_window.id), '[]'::jsonb)
    into v_windows from public.team_workweek_windows as work_window where work_window.version_id = v_version.id;
    insert into public.team_workweek_publications (
      source_version_id, owner_profile_id, effective_from, timezone, windows, publication_revision, predecessor_publication_id
    ) values (
      v_version.id, v_owner_profile_id, v_version.effective_from, v_version.timezone, v_windows, v_revision, v_predecessor.id
    ) returning * into v_publication;
  end if;
  if v_publication.predecessor_publication_id is not null then
    select * into v_predecessor from public.team_workweek_publications
    where id = v_publication.predecessor_publication_id and owner_profile_id = v_owner_profile_id and status = 'published' for update;
    if not found then raise exception using errcode = 'P0004', message = 'published workweek revision is stale'; end if;
    if v_publication.effective_from <= v_predecessor.effective_from then
      raise exception using errcode = '22023', message = 'effective boundary must follow latest published workweek';
    end if;
    v_recurrence_count := (v_publication.effective_from - v_predecessor.effective_from) / 7;
    insert into public.team_workweek_google_series_transitions (
      activation_publication_id, predecessor_series_id, owner_profile_id, expected_etag, expected_founderops_revision, recurrence_count
    )
    select v_publication.id, series.id, v_owner_profile_id, series.confirmed_etag,
      series.confirmed_founderops_revision, v_recurrence_count
    from public.team_workweek_google_series as series
    where series.publication_id = v_predecessor.id and series.state = 'confirmed' and series.provider_state = 'active'
    on conflict (activation_publication_id, predecessor_series_id) do nothing;
    if (
      select count(*)
      from public.team_workweek_google_series_transitions as transition
      join public.team_workweek_google_series as predecessor_series on predecessor_series.id = transition.predecessor_series_id
      where transition.activation_publication_id = v_publication.id
        and predecessor_series.provider_state = 'active'
    )
      <> (select count(*) from public.team_workweek_google_series where publication_id = v_predecessor.id and state = 'confirmed' and provider_state = 'active') then
      raise exception using errcode = 'P0003', message = 'predecessor Google series are not fully confirmed';
    end if;
  end if;
  for v_window in select id from public.team_workweek_windows where version_id = v_version.id
    order by weekday, start_minute, end_minute, id
  loop
    v_series_id := gen_random_uuid();
    insert into public.team_workweek_google_series (id, publication_id, source_window_id, owner_profile_id, google_event_id)
    values (v_series_id, v_publication.id, v_window.id, v_owner_profile_id, 'fops' || replace(v_series_id::text, '-', ''))
    on conflict (source_window_id) do nothing;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', series.id, 'calendarId', series.calendar_id, 'googleEventId', series.google_event_id,
    'state', series.state, 'confirmedEtag', series.confirmed_etag, 'weekday', work_window.weekday,
    'startMinute', work_window.start_minute, 'endMinute', work_window.end_minute
  ) order by work_window.weekday, work_window.start_minute, work_window.end_minute, series.id), '[]'::jsonb)
  into v_series from public.team_workweek_google_series as series
  join public.team_workweek_windows as work_window on work_window.id = series.source_window_id
  where series.publication_id = v_publication.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', transition.id, 'calendarId', predecessor_series.calendar_id,
    'googleEventId', predecessor_series.google_event_id, 'predecessorSeriesId', predecessor_series.id,
    'state', transition.state, 'expectedEtag', transition.expected_etag,
    'expectedFounderopsRevision', transition.expected_founderops_revision,
    'recurrenceCount', transition.recurrence_count, 'confirmedEtag', transition.confirmed_etag
  ) order by predecessor_series.google_event_id, transition.id), '[]'::jsonb)
  into v_transitions from public.team_workweek_google_series_transitions as transition
  join public.team_workweek_google_series as predecessor_series on predecessor_series.id = transition.predecessor_series_id
  where transition.activation_publication_id = v_publication.id;
  return jsonb_build_object(
    'id', v_publication.id, 'sourceVersionId', v_publication.source_version_id,
    'ownerProfileId', v_owner_profile_id, 'effectiveFrom', v_publication.effective_from,
    'timezone', v_publication.timezone, 'status', v_publication.status, 'syncState', v_publication.sync_state,
    'publicationRevision', v_publication.publication_revision, 'publishedAt', v_publication.published_at,
    'lastSyncAt', v_publication.last_sync_at, 'series', v_series, 'transitions', v_transitions
  );
end;
$$;


ALTER FUNCTION "public"."prepare_team_workweek_publication"("p_version_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_score_objection_transaction"("p_sprint_id" "text", "p_objection_id" bigint, "p_actor_profile_id" "text", "p_action" "text", "p_status" "text", "p_resolution_comment" "text", "p_delivery_points" integer, "p_form_points" integer, "p_weekly_points" integer, "p_second_reviewer_profile_id" "text", "p_second_review_decision" "text", "p_request_ip" "text", "p_user_agent" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_sprint_locked boolean;
  v_objection public.score_objections%rowtype;
  v_before jsonb;
  v_score jsonb := null;
  v_score_id bigint;
  v_total integer;
  v_actor_role text;
  v_second_reviewer_role text;
begin
  select score_locked into v_sprint_locked
  from public.sprints
  where id = p_sprint_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'sprint not found';
  end if;
  if v_sprint_locked then
    raise exception using errcode = 'P0003', message = 'sprint score is locked';
  end if;

  select platform_role into v_actor_role
  from public.profiles
  where id = p_actor_profile_id;
  if not found or v_actor_role not in ('ceo', 'founder', 'deputy') then
    raise exception using errcode = 'P0005', message = 'contributor profile is required';
  end if;

  select * into v_objection
  from public.score_objections
  where id = p_objection_id and sprint_id = p_sprint_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'score objection not found';
  end if;
  v_before := to_jsonb(v_objection);

  if p_action = 'assign_second_review' then
    if v_actor_role <> 'ceo' then
      raise exception using errcode = 'P0005', message = 'only CEO may assign second review';
    end if;
    if v_objection.status <> 'open' or v_objection.second_reviewed_at is not null then
      raise exception using errcode = 'P0006', message = 'second review can no longer be assigned';
    end if;
    if p_second_reviewer_profile_id is null
      or p_second_reviewer_profile_id = p_actor_profile_id
      or p_second_reviewer_profile_id = v_objection.profile_id then
      raise exception using errcode = 'P0005', message = 'second reviewer must be independent';
    end if;
    select platform_role into v_second_reviewer_role
    from public.profiles
    where id = p_second_reviewer_profile_id;
    if not found or v_second_reviewer_role not in ('ceo', 'founder', 'deputy') then
      raise exception using errcode = 'P0005', message = 'second reviewer must be a contributor';
    end if;

    update public.score_objections
    set second_reviewer_profile_id = p_second_reviewer_profile_id,
        second_review_decision = null,
        second_reviewed_at = null
    where id = p_objection_id
    returning * into v_objection;
  elsif p_action = 'second_review' then
    if v_objection.status <> 'open' then
      raise exception using errcode = 'P0004', message = 'score objection is already resolved';
    end if;
    if v_objection.second_reviewer_profile_id is distinct from p_actor_profile_id then
      raise exception using errcode = 'P0005', message = 'only assigned second reviewer may submit';
    end if;
    if v_objection.second_reviewed_at is not null then
      raise exception using errcode = 'P0006', message = 'second review is already complete';
    end if;
    if nullif(trim(coalesce(p_second_review_decision, '')), '') is null then
      raise exception using errcode = '22023', message = 'second review decision is required';
    end if;

    update public.score_objections
    set second_review_decision = trim(p_second_review_decision),
        second_reviewed_at = clock_timestamp()
    where id = p_objection_id
    returning * into v_objection;
  elsif p_action = 'resolve' then
    if v_actor_role <> 'ceo' then
      raise exception using errcode = 'P0005', message = 'only CEO may resolve score objection';
    end if;
    if v_objection.status <> 'open' then
      raise exception using errcode = 'P0004', message = 'score objection is already resolved';
    end if;
    if v_objection.second_reviewer_profile_id is not null and v_objection.second_reviewed_at is null then
      raise exception using errcode = 'P0004', message = 'assigned second review is pending';
    end if;
    if v_objection.profile_id = p_actor_profile_id and v_objection.second_reviewed_at is null then
      raise exception using errcode = 'P0005', message = 'CEO own objection requires independent second review';
    end if;
    if p_status not in ('reviewed', 'dismissed', 'accepted') then
      raise exception using errcode = '22023', message = 'invalid score objection status';
    end if;
    if nullif(trim(coalesce(p_resolution_comment, '')), '') is null then
      raise exception using errcode = '22023', message = 'resolution comment is required';
    end if;

    if p_status = 'accepted' then
      if p_delivery_points is null or p_delivery_points not between 0 and 12
        or p_form_points is null or p_form_points not between 0 and 4
        or p_weekly_points is null or p_weekly_points not between 0 and 4 then
        raise exception using errcode = '22023', message = 'accepted objection requires valid score components';
      end if;
      v_total := p_delivery_points + p_form_points + p_weekly_points;
      insert into public.founder_sprint_scores (
        sprint_id, profile_id, delivery_points, form_points, weekly_points, total_points,
        fulfilled, away_neutral, finalized_at, finalized_by, reason_summary
      ) values (
        p_sprint_id, v_objection.profile_id, p_delivery_points, p_form_points, p_weekly_points, v_total,
        v_total >= 12, false, clock_timestamp(), p_actor_profile_id,
        format('Korrigiert nach angenommenem Score-Einwand #%s.', p_objection_id)
      )
      on conflict (sprint_id, profile_id) do update
      set delivery_points = excluded.delivery_points,
          form_points = excluded.form_points,
          weekly_points = excluded.weekly_points,
          total_points = excluded.total_points,
          fulfilled = excluded.fulfilled,
          away_neutral = excluded.away_neutral,
          finalized_at = excluded.finalized_at,
          finalized_by = excluded.finalized_by,
          reason_summary = excluded.reason_summary
      returning id, to_jsonb(founder_sprint_scores) into v_score_id, v_score;
    end if;

    update public.score_objections
    set status = p_status,
        resolution_comment = trim(p_resolution_comment),
        reviewed_by = p_actor_profile_id,
        reviewed_at = clock_timestamp(),
        founder_sprint_score_id = coalesce(v_score_id, founder_sprint_score_id),
        resolved_delivery_points = case when p_status = 'accepted' then p_delivery_points else null end,
        resolved_form_points = case when p_status = 'accepted' then p_form_points else null end,
        resolved_weekly_points = case when p_status = 'accepted' then p_weekly_points else null end
    where id = p_objection_id
    returning * into v_objection;
  else
    raise exception using errcode = '22023', message = 'invalid score objection action';
  end if;

  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id, before_data, after_data, request_ip, user_agent
  ) values (
    p_actor_profile_id,
    case
      when p_action = 'assign_second_review' then 'score_objection.second_review_assigned'
      when p_action = 'second_review' then 'score_objection.second_review'
      else 'score_objection.review'
    end,
    'score_objection',
    p_objection_id::text,
    v_before,
    to_jsonb(v_objection),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object('objection', to_jsonb(v_objection), 'score', v_score);
end;
$$;


ALTER FUNCTION "public"."process_score_objection_transaction"("p_sprint_id" "text", "p_objection_id" bigint, "p_actor_profile_id" "text", "p_action" "text", "p_status" "text", "p_resolution_comment" "text", "p_delivery_points" integer, "p_form_points" integer, "p_weekly_points" integer, "p_second_reviewer_profile_id" "text", "p_second_review_decision" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."profile_color_palette"() RETURNS "text"[]
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select array[
    '#22c55e',
    '#4f46e5',
    '#f97316',
    '#ec4899',
    '#06b6d4',
    '#ef4444',
    '#84cc16',
    '#8b5cf6',
    '#f59e0b',
    '#1e3a8a',
    '#14b8a6',
    '#c026d3',
    '#92400e',
    '#e11d48',
    '#3b82f6',
    '#0f766e',
    '#64748b',
    '#4d7c0f',
    '#701a75',
    '#334155'
  ]::text[];
$$;


ALTER FUNCTION "public"."profile_color_palette"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purge_expired_planning_trash_batch"("p_limit" integer DEFAULT 25, "p_dry_run" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 25));
  v_scan_limit integer := least(greatest(1, coalesce(p_limit, 25)) * 4, 100);
  v_candidate record;
  v_root public.tasks%rowtype;
  v_item_ids text[];
  v_projection_item_ids text[];
  v_item_count integer;
  v_projection_count integer;
  v_completed_count integer;
  v_resolved_count integer;
  v_purged_roots integer := 0;
  v_purged_tasks integer := 0;
  v_resolved_notifications integer := 0;
  v_eligible_roots integer := 0;
  v_eligible_tasks integer := 0;
  v_blocked_expired_roots integer := 0;
  v_locked_roots integer := 0;
  v_has_more boolean := false;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('planning-trash-purge', 0)) then
    return jsonb_build_object('busy', true, 'dryRun', coalesce(p_dry_run, false),
      'eligibleRoots', 0, 'eligibleTasks', 0, 'purgedRoots', 0, 'purgedTasks', 0,
      'resolvedNotifications', 0, 'blockedExpiredRoots', 0, 'hasMore', true);
  end if;
  perform set_config('founderops.trash_lifecycle_write', 'on', true);

  for v_candidate in
    select item.task_type as root_type, item.id as root_id, item.trash_revision, item.purge_after
    from public.tasks item
    where item.task_type in ('initiative', 'deliverable')
      and item.trashed_at is not null
      and item.trash_root_type = item.task_type
      and item.trash_root_id = item.id
      and item.purge_after <= now()
    order by item.purge_after, item.task_type, item.id
    limit v_scan_limit
  loop
    exit when v_locked_roots >= v_limit;
    if not public.planning_trash_root_is_purge_eligible(
      v_candidate.root_type, v_candidate.root_id, v_candidate.trash_revision
    ) then continue; end if;

    select * into v_root from public.tasks
    where id = v_candidate.root_id and task_type = v_candidate.root_type
      and trashed_at is not null and trash_root_type = v_candidate.root_type
      and trash_root_id = v_candidate.root_id and trash_revision = v_candidate.trash_revision
      and purge_after <= now()
    for update skip locked;
    if v_root.id is null then continue; end if;
    v_locked_roots := v_locked_roots + 1;

    select coalesce(array_agg(item.id order by item.id), '{}'::text[]), count(*)::integer,
      coalesce(array_agg(item.id order by item.id) filter (where item.task_type in ('deliverable', 'sub_issue')), '{}'::text[]),
      count(*) filter (where item.task_type in ('deliverable', 'sub_issue'))::integer
    into v_item_ids, v_item_count, v_projection_item_ids, v_projection_count
    from public.tasks item
    where item.trashed_at is not null and item.trash_root_type = v_candidate.root_type
      and item.trash_root_id = v_candidate.root_id and item.trash_revision = v_candidate.trash_revision;
    perform id from public.tasks where id = any(v_item_ids) order by id for update;
    if not public.planning_trash_root_is_purge_eligible(
      v_candidate.root_type, v_candidate.root_id, v_candidate.trash_revision
    ) then continue; end if;

    select count(*) filter (
      where lifecycle.status = 'completed'
        and ((lifecycle.github_issue_number is null and lifecycle.status_reason = 'issue_missing')
          or (lifecycle.github_issue_number is not null and lifecycle.status_reason = 'delivered'))
    )::integer
    into v_completed_count
    from public.planning_github_lifecycle_outbox lifecycle
    where lifecycle.root_type = v_candidate.root_type and lifecycle.root_id = v_candidate.root_id
      and lifecycle.root_trash_revision = v_candidate.trash_revision
      and lifecycle.action = 'close_not_planned';
    if v_completed_count <> v_projection_count then continue; end if;

    if coalesce(p_dry_run, false) then
      v_eligible_roots := v_eligible_roots + 1;
      v_eligible_tasks := v_eligible_tasks + v_item_count;
      continue;
    end if;

    update public.notification_events notification
    set status = 'resolved', resolved_at = coalesce(notification.resolved_at, now()),
        resolution_reason = coalesce(notification.resolution_reason, 'source_purged')
    where notification.status in ('pending', 'sent', 'failed')
      and ((notification.entity_type = 'initiative' and notification.entity_id = v_candidate.root_id)
        or (notification.entity_type = 'task' and notification.entity_id = any(v_item_ids)));
    get diagnostics v_resolved_count = row_count;
    v_resolved_notifications := v_resolved_notifications + v_resolved_count;

    if v_candidate.root_type = 'initiative' then
      update public.profile_ui_preferences preference
      set expanded_item_ids = array_remove(preference.expanded_item_ids, v_candidate.root_id),
          planning_filters = case
            when preference.planning_filters->>'initiativeId' = v_candidate.root_id
              then jsonb_set(preference.planning_filters, '{initiativeId}', '"Alle"'::jsonb, true)
            else preference.planning_filters
          end,
          updated_at = now()
      where v_candidate.root_id = any(preference.expanded_item_ids)
         or preference.planning_filters->>'initiativeId' = v_candidate.root_id;
    end if;

    insert into public.audit_log (action, entity_type, entity_id, before_data, after_data)
    values ('planning_trash.purge', v_candidate.root_type, v_candidate.root_id,
      jsonb_build_object('trashCause', v_root.trash_cause, 'trashedAt', v_root.trashed_at,
        'purgeAfter', v_root.purge_after, 'trashRevision', v_candidate.trash_revision),
      jsonb_build_object('purgedAt', now(), 'taskCount', v_item_count,
        'completedGitHubLifecycleJobs', v_completed_count, 'resolvedNotifications', v_resolved_count));

    delete from public.planning_github_lifecycle_outbox lifecycle
    where lifecycle.root_type = v_candidate.root_type and lifecycle.root_id = v_candidate.root_id
      and lifecycle.root_trash_revision = v_candidate.trash_revision;
    delete from public.tasks item
    where item.id = any(v_item_ids) and item.trashed_at is not null
      and item.trash_root_type = v_candidate.root_type and item.trash_root_id = v_candidate.root_id
      and item.trash_revision = v_candidate.trash_revision;
    v_purged_roots := v_purged_roots + 1;
    v_purged_tasks := v_purged_tasks + v_item_count;
  end loop;

  select exists (
    select 1 from public.tasks item
    where item.task_type in ('initiative', 'deliverable') and item.trashed_at is not null
      and item.trash_root_type = item.task_type and item.trash_root_id = item.id and item.purge_after <= now()
  ) into v_has_more;
  select count(*)::integer into v_blocked_expired_roots
  from (
    select item.task_type, item.id, item.trash_revision
    from public.tasks item
    where item.task_type in ('initiative', 'deliverable') and item.trashed_at is not null
      and item.trash_root_type = item.task_type and item.trash_root_id = item.id and item.purge_after <= now()
    order by item.purge_after, item.task_type, item.id limit v_scan_limit
  ) candidate
  where not public.planning_trash_root_is_purge_eligible(candidate.task_type, candidate.id, candidate.trash_revision);
  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  return jsonb_build_object('busy', false, 'dryRun', coalesce(p_dry_run, false),
    'eligibleRoots', v_eligible_roots, 'eligibleTasks', v_eligible_tasks,
    'purgedRoots', v_purged_roots, 'purgedTasks', v_purged_tasks,
    'resolvedNotifications', v_resolved_notifications,
    'blockedExpiredRoots', v_blocked_expired_roots, 'hasMore', v_has_more);
exception when others then
  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  raise;
end;
$$;


ALTER FUNCTION "public"."purge_expired_planning_trash_batch"("p_limit" integer, "p_dry_run" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."purge_expired_planning_trash_batch"("p_limit" integer, "p_dry_run" boolean) IS 'Purges at most 25 expired planning trash roots after complete GitHub lifecycle processing while retaining audit and notification history.';



CREATE OR REPLACE FUNCTION "public"."rebase_google_workspace_disconnect_series"("p_target_id" "uuid", "p_expected_etag" "text", "p_observed_etag" "text", "p_observed_at" timestamp with time zone DEFAULT "clock_timestamp"()) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_operation_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if nullif(btrim(p_observed_etag), '') is null or p_observed_at is null then
    raise exception using errcode = '22023', message = 'observed disconnect ETag is invalid';
  end if;
  update public.google_workspace_disconnect_series
  set expected_etag = btrim(p_observed_etag), last_error_class = null,
    last_observed_at = p_observed_at, updated_at = p_observed_at
  where id = p_target_id and state = 'pending' and expected_etag = p_expected_etag
  returning operation_id into v_operation_id;
  if not found then
    raise exception using errcode = 'P0004', message = 'disconnect target changed before ETag rebase';
  end if;
  update public.google_workspace_disconnect_operations
  set revision = revision + 1, last_error_class = null, updated_at = p_observed_at
  where id = v_operation_id and state in ('cleaning', 'cleanup_pending');
  if not found then
    raise exception using errcode = 'P0004', message = 'disconnect operation is not rebasable';
  end if;
end;
$$;


ALTER FUNCTION "public"."rebase_google_workspace_disconnect_series"("p_target_id" "uuid", "p_expected_etag" "text", "p_observed_etag" "text", "p_observed_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_google_team_workweek_reconciliation_state"("p_publication_id" "uuid", "p_publication_revision" integer, "p_state" "text", "p_error_class" "text", "p_observed_at" timestamp with time zone DEFAULT "clock_timestamp"()) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_publication public.team_workweek_publications%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_state not in ('confirmed', 'delayed', 'conflict')
    or (p_state = 'confirmed' and p_error_class is not null)
    or (
      p_state in ('delayed', 'conflict')
      and p_error_class not in (
        'provider_unavailable',
        'quota_exceeded',
        'oauth_reconnect_required',
        'provider_identity_mismatch',
        'invalid_series',
        'invalid_windows',
        'founderops_changed',
        'storage_failed'
      )
    )
    or p_observed_at is null then
    raise exception using errcode = '22023', message = 'Google reconciliation state is invalid';
  end if;

  select * into v_publication
  from public.team_workweek_publications
  where id = p_publication_id
    and publication_revision = p_publication_revision
  for update;

  if not found then
    raise exception using errcode = 'P0004', message = 'FounderOps workweek changed during reconciliation';
  end if;

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
    p_state,
    p_observed_at,
    p_error_class,
    p_observed_at
  )
  on conflict (publication_id) do update
  set owner_profile_id = excluded.owner_profile_id,
    state = excluded.state,
    last_observed_at = excluded.last_observed_at,
    last_error_class = excluded.last_error_class,
    updated_at = excluded.updated_at;
end;
$$;


ALTER FUNCTION "public"."record_google_team_workweek_reconciliation_state"("p_publication_id" "uuid", "p_publication_revision" integer, "p_state" "text", "p_error_class" "text", "p_observed_at" timestamp with time zone) OWNER TO "postgres";


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


ALTER FUNCTION "public"."refresh_team_workweek_google_conflict_resolution"("p_conflict_id" "uuid", "p_owner_profile_id" "text", "p_conflict_revision" integer, "p_decision" "text", "p_google_observations" "jsonb", "p_google_fingerprint" "text", "p_observed_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_github_issue_sync_lock"("p_resource_key" "text", "p_lock_token" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_deleted integer := 0;
begin
  delete from public.github_issue_sync_locks
  where resource_key = trim(p_resource_key)
    and lock_token = p_lock_token;

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;


ALTER FUNCTION "public"."release_github_issue_sync_lock"("p_resource_key" "text", "p_lock_token" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reparent_planning_item_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_parent_task_id" "text", "p_actor_profile_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_parent_task_id text := nullif(trim(coalesce(p_parent_task_id, '')), '');
  v_updated_task public.tasks%rowtype;
begin
  perform set_config('app.actor_profile_id', coalesce(p_actor_profile_id, ''), true);
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_task.trashed_at is not null then
    raise exception using errcode = 'P0003', message = 'planning item is trashed';
  end if;
  if v_task.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;
  if v_task.task_type = 'epic' then
    raise exception using errcode = '22023', message = 'epic cannot change parent';
  end if;

  if v_task.task_type = 'initiative' then
    return public.update_planning_item_transaction(
      p_task_id,
      p_expected_updated_at,
      jsonb_build_object('parent_task_id', v_parent_task_id),
      null,
      null,
      p_actor_profile_id
    );
  end if;

  if v_task.task_type = 'sub_issue' and v_parent_task_id is null then
    raise exception using errcode = '23514', message = 'sub-issue requires a deliverable parent';
  end if;
  if v_parent_task_id is not null then
    select * into v_parent from public.tasks where id = v_parent_task_id and trashed_at is null for share;
    if not found then
      raise exception using errcode = '23514', message = 'planning item parent was not found';
    end if;
    if (v_task.task_type = 'deliverable' and v_parent.task_type <> 'initiative')
       or (v_task.task_type = 'sub_issue' and v_parent.task_type <> 'deliverable') then
      raise exception using errcode = '23514', message = 'planning item parent has the wrong type';
    end if;
    if v_task.task_type = 'sub_issue' and v_parent.approval_status is distinct from 'approved' then
      raise exception using errcode = '23514', message = 'sub-issue parent must be approved';
    end if;
  end if;

  update public.tasks
  set parent_task_id = v_parent_task_id,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning * into v_updated_task;

  insert into public.task_activity (task_id, message)
  values (p_task_id, 'Übergeordnete Planungsebene geändert');
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
  values (
    nullif(p_actor_profile_id, ''),
    'task.parent_changed',
    'task',
    p_task_id,
    jsonb_build_object('parentTaskId', v_task.parent_task_id),
    jsonb_build_object('parentTaskId', v_updated_task.parent_task_id)
  );

  return jsonb_build_object('task', to_jsonb(v_updated_task));
end;
$$;


ALTER FUNCTION "public"."reparent_planning_item_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_parent_task_id" "text", "p_actor_profile_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."replace_planning_item_raci_assignments"("p_task_id" "text", "p_assignments" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_assignments jsonb := coalesce(p_assignments, '[]'::jsonb);
begin
  if jsonb_typeof(v_assignments) <> 'array'
     or jsonb_array_length(v_assignments) > 100 then
    raise exception using errcode = '22023', message = 'RACI assignments must be an array with at most 100 entries';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_assignments) assignment(value)
    where jsonb_typeof(assignment.value) <> 'object'
      or nullif(trim(assignment.value->>'profileId'), '') is null
      or assignment.value->>'role' not in ('accountable', 'responsible', 'consulted', 'informed')
      or coalesce(assignment.value->>'sortOrder', '0') !~ '^[0-9]+$'
  ) then
    raise exception using errcode = '22023', message = 'RACI assignment is invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_assignments) assignment(value)
    left join public.profiles profile on profile.id = assignment.value->>'profileId'
    where profile.id is null
  ) then
    raise exception using errcode = '23503', message = 'RACI assignment profile was not found';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(v_assignments) assignment(value)
    where assignment.value->>'role' = 'accountable'
  ) > 1 then
    raise exception using errcode = '23514', message = 'planning item can have at most one accountable RACI assignment';
  end if;

  if exists (
    select 1
    from (
      select assignment.value->>'profileId' as profile_id, assignment.value->>'role' as role, count(*) as duplicate_count
      from jsonb_array_elements(v_assignments) assignment(value)
      group by assignment.value->>'profileId', assignment.value->>'role'
    ) duplicates
    where duplicates.duplicate_count > 1
  ) then
    raise exception using errcode = '23505', message = 'RACI assignment is duplicated';
  end if;

  delete from public.planning_item_raci_assignments where task_id = p_task_id;

  insert into public.planning_item_raci_assignments (task_id, profile_id, role, sort_order)
  select
    p_task_id,
    assignment.value->>'profileId',
    assignment.value->>'role',
    coalesce((assignment.value->>'sortOrder')::integer, assignment.ordinality::integer - 1)
  from jsonb_array_elements(v_assignments) with ordinality assignment(value, ordinality);
end;
$_$;


ALTER FUNCTION "public"."replace_planning_item_raci_assignments"("p_task_id" "text", "p_assignments" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."replace_task_evidence_links"("p_task_id" "text", "p_evidence_links" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_links jsonb := coalesce(p_evidence_links, '[]'::jsonb);
begin
  if jsonb_typeof(v_links) <> 'array' or jsonb_array_length(v_links) > 20 then
    raise exception using errcode = '22023', message = 'evidence links must be an array with at most 20 entries';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_links) as entry(value)
    where jsonb_typeof(entry.value) <> 'string'
      or nullif(trim(entry.value #>> '{}'), '') is null
      or length(trim(entry.value #>> '{}')) > 2048
      or trim(entry.value #>> '{}') !~* '^https?://'
  ) then
    raise exception using errcode = '22023', message = 'evidence links must contain valid HTTP or HTTPS URLs';
  end if;

  if (
    select count(distinct lower(trim(entry.value #>> '{}')))
    from jsonb_array_elements(v_links) as entry(value)
  ) <> jsonb_array_length(v_links) then
    raise exception using errcode = '22023', message = 'evidence links must not contain duplicates';
  end if;

  delete from public.task_links
  where task_id = p_task_id
    and type = 'evidence';

  insert into public.task_links (task_id, type, label, url, position, metadata)
  select
    p_task_id,
    'evidence',
    trim(entry.value),
    trim(entry.value),
    entry.ordinality::integer - 1,
    '{}'::jsonb
  from jsonb_array_elements_text(v_links) with ordinality as entry(value, ordinality);

  return v_links;
end;
$$;


ALTER FUNCTION "public"."replace_task_evidence_links"("p_task_id" "text", "p_evidence_links" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."replace_task_evidence_links"("p_task_id" "text", "p_evidence_links" "jsonb") IS 'Replaces only the manual evidence URL projection for one task.';



CREATE OR REPLACE FUNCTION "public"."resolve_github_issue_comment_webhook_tasks"("p_repository_full_name" "text", "p_issue_number" integer) RETURNS TABLE("task_id" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_repository_full_name text := lower(nullif(trim(coalesce(p_repository_full_name, '')), ''));
begin
  if v_repository_full_name is null or p_issue_number is null or p_issue_number < 1 then
    raise exception using errcode = '22023', message = 'repository and Issue number are required';
  end if;

  return query
  select task.id
  from public.tasks task
  cross join lateral public.normalize_planning_github_issue_reference(
    task.task_type,
    task.github_repo,
    task.github_issue_number,
    task.issue_number,
    task.github_issue_url,
    task.issue_url
  ) issue_reference
  where issue_reference.reference_status = 'valid'
    and issue_reference.normalized_repo = v_repository_full_name
    and issue_reference.normalized_issue_number = p_issue_number
  order by task.id
  limit 2;
end;
$$;


ALTER FUNCTION "public"."resolve_github_issue_comment_webhook_tasks"("p_repository_full_name" "text", "p_issue_number" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resolve_github_issue_comment_webhook_tasks"("p_repository_full_name" "text", "p_issue_number" integer) IS 'Resolves at most two tasks through the shared modern and legacy GitHub Issue reference contract so the processor can fail closed on ambiguity.';



CREATE OR REPLACE FUNCTION "public"."resolve_github_planning_webhook_actor"("p_github_user_id" bigint) RETURNS TABLE("profile_id" "text", "profile_name" "text", "platform_role" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select profile.id, profile.name, profile.platform_role
  from public.github_app_user_tokens token
  join public.profiles profile on profile.id = token.profile_id
  where token.github_user_id = p_github_user_id
    and token.revoked_at is null
    and profile.auth_user_id is not null
    and profile.platform_role in ('ceo', 'deputy', 'founder')
  limit 1
$$;


ALTER FUNCTION "public"."resolve_github_planning_webhook_actor"("p_github_user_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_github_planning_webhook_tasks"("p_repository_full_name" "text", "p_issue_number" integer) RETURNS TABLE("task_id" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_repository_full_name text := lower(nullif(trim(coalesce(p_repository_full_name, '')), ''));
begin
  if v_repository_full_name is null or p_issue_number is null or p_issue_number < 1 then
    raise exception using errcode = '22023', message = 'repository and Issue number are required';
  end if;

  return query
  select task.id
  from public.tasks task
  cross join lateral public.normalize_planning_github_issue_reference(
    task.task_type,
    task.github_repo,
    task.github_issue_number,
    task.issue_number,
    task.github_issue_url,
    task.issue_url
  ) issue_reference
  where task.trashed_at is null
    and issue_reference.reference_status = 'valid'
    and issue_reference.normalized_repo = v_repository_full_name
    and issue_reference.normalized_issue_number = p_issue_number
  order by task.id
  limit 2;
end;
$$;


ALTER FUNCTION "public"."resolve_github_planning_webhook_tasks"("p_repository_full_name" "text", "p_issue_number" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_score_objection_transaction"("p_sprint_id" "text", "p_objection_id" bigint, "p_actor_profile_id" "text", "p_action" "text", "p_status" "text" DEFAULT NULL::"text", "p_resolution_comment" "text" DEFAULT NULL::"text", "p_delivery_points" integer DEFAULT NULL::integer, "p_form_points" integer DEFAULT NULL::integer, "p_weekly_points" integer DEFAULT NULL::integer, "p_second_review_decision" "text" DEFAULT NULL::"text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_sprint_locked boolean;
  v_objection public.score_objections%rowtype;
  v_before jsonb;
  v_score jsonb := null;
  v_score_id bigint;
  v_total integer;
begin
  select score_locked into v_sprint_locked
  from public.sprints
  where id = p_sprint_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'sprint not found';
  end if;
  if v_sprint_locked then
    raise exception using errcode = 'P0003', message = 'sprint score is locked';
  end if;

  select * into v_objection
  from public.score_objections
  where id = p_objection_id
    and sprint_id = p_sprint_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'score objection not found';
  end if;

  v_before := to_jsonb(v_objection);

  if p_action = 'resolve' then
    if v_objection.status <> 'open' then
      raise exception using errcode = 'P0004', message = 'score objection is already resolved';
    end if;
    if p_status not in ('reviewed', 'dismissed', 'accepted') then
      raise exception using errcode = '22023', message = 'invalid score objection status';
    end if;
    if nullif(trim(coalesce(p_resolution_comment, '')), '') is null then
      raise exception using errcode = '22023', message = 'resolution comment is required';
    end if;

    if p_status = 'accepted' then
      if p_delivery_points is null or p_delivery_points not between 0 and 12
        or p_form_points is null or p_form_points not between 0 and 4
        or p_weekly_points is null or p_weekly_points not between 0 and 4 then
        raise exception using errcode = '22023', message = 'accepted objection requires valid score components';
      end if;

      v_total := p_delivery_points + p_form_points + p_weekly_points;

      insert into public.founder_sprint_scores (
        sprint_id,
        profile_id,
        delivery_points,
        form_points,
        weekly_points,
        total_points,
        fulfilled,
        away_neutral,
        finalized_at,
        finalized_by,
        reason_summary
      )
      values (
        p_sprint_id,
        v_objection.profile_id,
        p_delivery_points,
        p_form_points,
        p_weekly_points,
        v_total,
        v_total >= 12,
        false,
        clock_timestamp(),
        p_actor_profile_id,
        format('Korrigiert nach angenommenem Score-Einwand #%s.', p_objection_id)
      )
      on conflict (sprint_id, profile_id) do update
      set delivery_points = excluded.delivery_points,
          form_points = excluded.form_points,
          weekly_points = excluded.weekly_points,
          total_points = excluded.total_points,
          fulfilled = excluded.fulfilled,
          away_neutral = excluded.away_neutral,
          finalized_at = excluded.finalized_at,
          finalized_by = excluded.finalized_by,
          reason_summary = excluded.reason_summary
      returning id, to_jsonb(founder_sprint_scores) into v_score_id, v_score;
    end if;

    update public.score_objections
    set status = p_status,
        resolution_comment = trim(p_resolution_comment),
        reviewed_by = p_actor_profile_id,
        reviewed_at = clock_timestamp(),
        founder_sprint_score_id = coalesce(v_score_id, founder_sprint_score_id),
        resolved_delivery_points = case when p_status = 'accepted' then p_delivery_points else null end,
        resolved_form_points = case when p_status = 'accepted' then p_form_points else null end,
        resolved_weekly_points = case when p_status = 'accepted' then p_weekly_points else null end
    where id = p_objection_id
    returning * into v_objection;
  elsif p_action = 'second_review' then
    if v_objection.status = 'open' or v_objection.reviewed_by is null then
      raise exception using errcode = 'P0004', message = 'score objection must be resolved before second review';
    end if;
    if v_objection.second_reviewed_at is not null then
      raise exception using errcode = 'P0006', message = 'second review is already complete';
    end if;
    if v_objection.reviewed_by = p_actor_profile_id then
      raise exception using errcode = 'P0005', message = 'second reviewer must differ from first reviewer';
    end if;
    if nullif(trim(coalesce(p_second_review_decision, '')), '') is null then
      raise exception using errcode = '22023', message = 'second review decision is required';
    end if;

    update public.score_objections
    set second_reviewer_profile_id = p_actor_profile_id,
        second_review_decision = trim(p_second_review_decision),
        second_reviewed_at = clock_timestamp()
    where id = p_objection_id
    returning * into v_objection;

    if v_objection.founder_sprint_score_id is not null then
      select to_jsonb(score) into v_score
      from public.founder_sprint_scores as score
      where id = v_objection.founder_sprint_score_id;
    end if;
  else
    raise exception using errcode = '22023', message = 'invalid score objection action';
  end if;

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    request_ip,
    user_agent
  )
  values (
    p_actor_profile_id,
    case when p_action = 'second_review' then 'score_objection.second_review' else 'score_objection.review' end,
    'score_objection',
    p_objection_id::text,
    v_before,
    to_jsonb(v_objection),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'objection', to_jsonb(v_objection),
    'score', v_score
  );
end;
$$;


ALTER FUNCTION "public"."resolve_score_objection_transaction"("p_sprint_id" "text", "p_objection_id" bigint, "p_actor_profile_id" "text", "p_action" "text", "p_status" "text", "p_resolution_comment" "text", "p_delivery_points" integer, "p_form_points" integer, "p_weekly_points" integer, "p_second_review_decision" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resolve_score_objection_transaction"("p_sprint_id" "text", "p_objection_id" bigint, "p_actor_profile_id" "text", "p_action" "text", "p_status" "text", "p_resolution_comment" "text", "p_delivery_points" integer, "p_form_points" integer, "p_weekly_points" integer, "p_second_review_decision" "text", "p_request_ip" "text", "p_user_agent" "text") IS 'Atomically resolves score objections, persists accepted score corrections, and enforces one independent second review.';



CREATE OR REPLACE FUNCTION "public"."restore_planning_item_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_trash_revision" integer, "p_actor_profile_id" "text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor_role text;
  v_root public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_updated_root public.tasks%rowtype;
  v_task_ids text[] := array[]::text[];
  v_task_id text;
begin
  if p_root_type not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_root_id, '')), '') is null
     or p_expected_trash_revision is null
     or p_expected_trash_revision < 1 then
    raise exception using errcode = '22023', message = 'planning restore input is invalid';
  end if;
  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id for share;
  if not found or v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'planning restore requires operational lead';
  end if;

  select * into v_root from public.tasks where id = p_root_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_root.task_type <> p_root_type
     or v_root.trashed_at is null
     or v_root.trash_root_type <> p_root_type
     or v_root.trash_root_id <> p_root_id then
    raise exception using errcode = 'P0003', message = 'planning item is not a trash root';
  end if;
  if v_root.trash_revision <> p_expected_trash_revision then
    raise exception using errcode = 'P0001', message = 'planning trash revision changed';
  end if;
  if v_root.parent_task_id is not null then
    select * into v_parent from public.tasks where id = v_root.parent_task_id for share;
    if not found or v_parent.trashed_at is not null then
      raise exception using errcode = 'P0003', message = 'parent planning item must be restored first';
    end if;
  end if;

  select coalesce(array_agg(id order by
    case task_type when 'initiative' then 0 when 'deliverable' then 1 else 2 end,
    id
  ), array[]::text[])
  into v_task_ids
  from public.tasks
  where trash_root_type = p_root_type
    and trash_root_id = p_root_id
    and trash_revision = p_expected_trash_revision
    and trashed_at is not null;
  perform id from public.tasks where id = any(v_task_ids) order by id for update;
  perform set_config('founderops.trash_lifecycle_write', 'on', true);

  foreach v_task_id in array v_task_ids loop
    update public.tasks
    set approval_status = case when task_type in ('initiative', 'deliverable') then 'proposed' else null end,
        approval_revision = case when task_type in ('initiative', 'deliverable') then approval_revision + 1 else approval_revision end,
        proposed_by = case when task_type in ('initiative', 'deliverable') then p_actor_profile_id else proposed_by end,
        proposed_at = case when task_type in ('initiative', 'deliverable') then clock_timestamp() else proposed_at end,
        decided_by = null,
        decided_at = null,
        decision_note = null,
        sprint_id = case when task_type = 'deliverable' then null else sprint_id end,
        review_status = case when task_type = 'deliverable' then 'not_requested' else review_status end,
        review_owner_profile_id = case when task_type = 'deliverable' then null else review_owner_profile_id end,
        review_requested_at = case when task_type = 'deliverable' then null else review_requested_at end,
        score_points = case when task_type = 'deliverable' then 0 else score_points end,
        score_final = case when task_type = 'deliverable' then false else score_final end,
        score_relevant = false,
        trashed_at = null,
        trashed_by = null,
        trash_reason = null,
        trash_cause = null,
        purge_after = null,
        trash_root_type = null,
        trash_root_id = null,
        updated_at = clock_timestamp()
    where id = v_task_id;
  end loop;

  select * into v_updated_root from public.tasks where id = p_root_id;
  insert into public.planning_github_lifecycle_outbox (
    root_type, root_id, root_trash_revision, task_id, github_repo,
    github_issue_number, action, source_type, source_revision, reason,
    status, status_reason, last_error
  )
  select
    p_root_type,
    p_root_id,
    p_expected_trash_revision,
    task.id,
    closed.github_repo,
    closed.github_issue_number,
    'reopen',
    'approval',
    p_expected_trash_revision,
    null,
    case when closed.github_issue_number is null then 'failed' else 'pending' end,
    case when closed.github_issue_number is null then 'missing_close_target' end,
    case when closed.github_issue_number is null then 'No durable close target is available for the restored planning item.' end
  from public.tasks task
  left join lateral (
    select prior.github_repo, prior.github_issue_number
    from public.planning_github_lifecycle_outbox prior
    where prior.task_id = task.id
      and prior.action = 'close_not_planned'
      and prior.root_type = p_root_type
      and prior.root_id = p_root_id
      and prior.root_trash_revision = p_expected_trash_revision
    order by prior.created_at desc, prior.id desc
    limit 1
  ) closed on true
  where task.id = any(v_task_ids)
    and task.task_type in ('deliverable', 'sub_issue')
  on conflict (root_type, root_id, root_trash_revision, task_id, action) do nothing;

  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  insert into public.task_activity (task_id, message)
  values (p_root_id, case when p_root_type = 'initiative' then 'Initiative aus dem Papierkorb wiederhergestellt · erneut vorgeschlagen' else 'Deliverable aus dem Papierkorb wiederhergestellt · erneut vorgeschlagen' end);
  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id, before_data, after_data, request_ip, user_agent
  ) values (
    p_actor_profile_id,
    'planning_item.restored',
    'task',
    p_root_id,
    jsonb_build_object('trashRevision', p_expected_trash_revision),
    jsonb_build_object('affectedTaskIds', to_jsonb(v_task_ids), 'approvalStatus', v_updated_root.approval_status),
    p_request_ip,
    p_user_agent
  );
  return jsonb_build_object(
    'rootType', p_root_type,
    'rootId', p_root_id,
    'affectedTaskIds', to_jsonb(v_task_ids),
    'trashRevision', p_expected_trash_revision,
    'item', to_jsonb(v_updated_root),
    'eventIds', '[]'::jsonb
  );
end;
$$;


ALTER FUNCTION "public"."restore_planning_item_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_trash_revision" integer, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."restore_planning_item_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_trash_revision" integer, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") IS 'Atomically restores one planning trash root while requiring a fresh approval cycle.';



CREATE OR REPLACE FUNCTION "public"."retain_private_team_workweek_after_deactivation"("p_owner_profile_id" "text", "p_cutoff" "date") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_version_id uuid;
  v_publication public.team_workweek_publications%rowtype;
  v_window jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  select * into v_publication from public.team_workweek_publications
  where owner_profile_id = p_owner_profile_id and status = 'inactive'
  order by publication_revision desc, id desc limit 1;
  if not found then return null; end if;

  insert into public.team_workweek_versions (owner_profile_id, effective_from, origin)
  values (p_owner_profile_id, p_cutoff, 'owner') returning id into v_version_id;
  for v_window in select value from jsonb_array_elements(v_publication.windows)
  loop
    insert into public.team_workweek_windows (version_id, weekday, start_minute, end_minute)
    values (
      v_version_id,
      (v_window->>'weekday')::smallint,
      (v_window->>'startMinute')::smallint,
      (v_window->>'endMinute')::smallint
    );
  end loop;
  return v_version_id;
end;
$$;


ALTER FUNCTION "public"."retain_private_team_workweek_after_deactivation"("p_owner_profile_id" "text", "p_cutoff" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_task_transaction"("p_task_id" "text", "p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_reviewer_profile_id" "text", "p_decision" "text", "p_points" integer, "p_comment" "text", "p_checklist" "jsonb", "p_activity_message" "text", "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text", "p_user_agent" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_sprint_locked boolean;
  v_task public.tasks%rowtype;
  v_update_result jsonb;
  v_review jsonb;
  v_checked_count integer;
  v_expected_points integer;
  v_status text;
  v_score_final boolean;
  v_patch jsonb;
begin
  if p_expected_updated_at is null or p_reviewer_profile_id is null then
    raise exception using errcode = '22023', message = 'review revision and reviewer are required';
  end if;
  if p_decision not in ('accepted', 'partial', 'changes_requested') then
    raise exception using errcode = '22023', message = 'invalid review decision';
  end if;
  if jsonb_typeof(coalesce(p_checklist, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'review checklist must be a JSON object';
  end if;
  if jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'review notifications must be a JSON array';
  end if;

  if p_sprint_id is not null then
    select score_locked into v_sprint_locked
    from public.sprints
    where id = p_sprint_id
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'sprint not found';
    end if;
    if v_sprint_locked then
      raise exception using errcode = 'P0003', message = 'sprint score is locked';
    end if;
  end if;

  select * into v_task
  from public.tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
  if v_task.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'task was changed concurrently';
  end if;
  if v_task.sprint_id is distinct from p_sprint_id then
    raise exception using errcode = '22023', message = 'task sprint changed during review';
  end if;
  if v_task.status <> 'Review' or v_task.review_status <> 'requested' or v_task.score_final then
    raise exception using errcode = 'P0004', message = 'task is not in active review';
  end if;

  v_checked_count :=
    case when coalesce(p_checklist->'acceptanceCriteriaMet', p_checklist->'dodMet', 'false'::jsonb) = 'true'::jsonb then 1 else 0 end
    + case when coalesce(p_checklist->'evidenceProvided', 'false'::jsonb) = 'true'::jsonb then 1 else 0 end
    + case when coalesce(p_checklist->'communicationClear', 'false'::jsonb) = 'true'::jsonb then 1 else 0 end
    + case when coalesce(p_checklist->'blockerHandled', 'false'::jsonb) = 'true'::jsonb then 1 else 0 end;
  v_expected_points := round((v_checked_count::numeric / 4) * 10)::integer;

  if p_decision = 'accepted' then
    if v_checked_count <> 4 or p_points <> 10 then
      raise exception using errcode = '22023', message = 'accepted review requires four checks and ten points';
    end if;
    v_status := 'Erledigt';
    v_score_final := true;
  elsif p_decision = 'partial' then
    if v_checked_count not between 1 and 3 or p_points <> v_expected_points then
      raise exception using errcode = '22023', message = 'partial review requires one to three checks and derived points';
    end if;
    if nullif(trim(coalesce(p_comment, '')), '') is null then
      raise exception using errcode = '22023', message = 'partial review comment is required';
    end if;
    v_status := 'Nacharbeit';
    v_score_final := false;
  else
    if p_points <> 0 or nullif(trim(coalesce(p_comment, '')), '') is null then
      raise exception using errcode = '22023', message = 'rework requires zero points and a comment';
    end if;
    v_status := 'Nacharbeit';
    v_score_final := false;
  end if;

  v_patch := jsonb_build_object(
    'status', v_status,
    'review_status', p_decision,
    'score_points', case when p_decision = 'changes_requested' then 0 else v_expected_points end,
    'score_final', v_score_final,
    'review_requested_at', null,
    'github_issue_sync_status', 'not_synced',
    'github_issue_sync_error', null
  );

  v_update_result := public.update_task_transaction(
    p_task_id,
    p_expected_updated_at,
    v_patch,
    false,
    null,
    false,
    null,
    array[p_activity_message],
    coalesce(p_notifications, '[]'::jsonb)
  );

  insert into public.task_reviews (
    task_id,
    sprint_id,
    reviewer_profile_id,
    decision,
    points,
    comment,
    checklist
  ) values (
    p_task_id,
    p_sprint_id,
    p_reviewer_profile_id,
    p_decision,
    case when p_decision = 'changes_requested' then 0 else v_expected_points end,
    trim(coalesce(p_comment, '')),
    coalesce(p_checklist, '{}'::jsonb)
  ) returning to_jsonb(task_reviews) into v_review;

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    request_ip,
    user_agent
  ) values (
    p_reviewer_profile_id,
    'task.review',
    'task',
    p_task_id,
    jsonb_build_object('status', v_task.status, 'reviewStatus', v_task.review_status, 'scorePoints', v_task.score_points, 'scoreFinal', v_task.score_final),
    coalesce(p_audit_after_data, '{}'::jsonb) || jsonb_build_object('status', v_status, 'scoreFinal', v_score_final, 'points', case when p_decision = 'changes_requested' then 0 else v_expected_points end),
    p_request_ip,
    p_user_agent
  );

  return v_update_result || jsonb_build_object('review', v_review);
end;
$$;


ALTER FUNCTION "public"."review_task_transaction"("p_task_id" "text", "p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_reviewer_profile_id" "text", "p_decision" "text", "p_points" integer, "p_comment" "text", "p_checklist" "jsonb", "p_activity_message" "text", "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."review_task_transaction"("p_task_id" "text", "p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_reviewer_profile_id" "text", "p_decision" "text", "p_points" integer, "p_comment" "text", "p_checklist" "jsonb", "p_activity_message" "text", "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text", "p_user_agent" "text") IS 'Atomically applies a task review with compare-and-set task state, immutable review history, activity, notification, and audit.';



CREATE OR REPLACE FUNCTION "public"."revoke_team_planning_items_token"("p_token_id" "uuid", "p_profile_id" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_token_id uuid;
begin
  update public.team_task_intake_tokens
  set revoked_at = now()
  where id = p_token_id
    and profile_id = p_profile_id
    and revoked_at is null
  returning id into v_token_id;

  return v_token_id;
end;
$$;


ALTER FUNCTION "public"."revoke_team_planning_items_token"("p_token_id" "uuid", "p_profile_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revoke_team_task_intake_token"("p_token_id" "uuid", "p_profile_id" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_token_id uuid;
begin
  update public.team_task_intake_tokens
  set revoked_at = now()
  where id = p_token_id
    and profile_id = p_profile_id
    and revoked_at is null
  returning id into v_token_id;

  return v_token_id;
end;
$$;


ALTER FUNCTION "public"."revoke_team_task_intake_token"("p_token_id" "uuid", "p_profile_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."revoke_team_task_intake_token"("p_token_id" "uuid", "p_profile_id" "text") IS 'Revokes one active personal Team Task Intake token owned by the current profile.';



CREATE OR REPLACE FUNCTION "public"."set_github_comment_notification_watermark"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_new_reference record;
  v_old_reference record;
begin
  select * into v_new_reference
  from public.normalize_planning_github_issue_reference(
    new.task_type,
    new.github_repo,
    new.github_issue_number,
    new.issue_number,
    new.github_issue_url,
    new.issue_url
  );

  if tg_op = 'UPDATE' then
    select * into v_old_reference
    from public.normalize_planning_github_issue_reference(
      old.task_type,
      old.github_repo,
      old.github_issue_number,
      old.issue_number,
      old.github_issue_url,
      old.issue_url
    );
  end if;

  if v_new_reference.reference_status <> 'valid' then
    new.github_comment_notifications_after := null;
  elsif tg_op = 'INSERT' then
    new.github_comment_notifications_after := clock_timestamp();
  elsif v_old_reference.reference_status <> 'valid'
    or v_old_reference.normalized_repo is distinct from v_new_reference.normalized_repo
    or v_old_reference.normalized_issue_number is distinct from v_new_reference.normalized_issue_number
  then
    new.github_comment_notifications_after := clock_timestamp();
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."set_github_comment_notification_watermark"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."task_audit_action_from_legacy_message"("p_message" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select case
    when trim(coalesce(p_message, '')) like 'Titel geändert:%' then 'task.title_changed'
    when trim(coalesce(p_message, '')) like 'Status geändert:%' then 'task.status_changed'
    when trim(coalesce(p_message, '')) like 'Review geändert:%' then 'task.review_status_changed'
    when trim(coalesce(p_message, '')) like 'Review Owner geändert:%' then 'task.review_owner_changed'
    when trim(coalesce(p_message, '')) like 'Zuständigkeit geändert:%'
      or trim(coalesce(p_message, '')) like 'Assignee geändert:%'
      or trim(coalesce(p_message, '')) like 'Owner geändert:%'
      then 'task.assignment_changed'
    when trim(coalesce(p_message, '')) like 'Priorität geändert:%' then 'task.priority_changed'
    when trim(coalesce(p_message, '')) like 'Sprint-Zuordnung geändert:%' then 'task.sprint_changed'
    when trim(coalesce(p_message, '')) like 'Epic / Meilenstein geändert:%'
      or trim(coalesce(p_message, '')) like 'Initiative geändert:%'
      then 'task.structure_changed'
    when trim(coalesce(p_message, '')) like 'Zeitraum geändert:%' then 'task.schedule_changed'
    when trim(coalesce(p_message, '')) like 'Evidence-Link geändert%' then 'task.evidence_changed'
    when trim(coalesce(p_message, '')) like 'Anhang hochgeladen:%' then 'task.attachment_uploaded'
    when trim(coalesce(p_message, '')) like 'GitHub-Sync fehlgeschlagen:%' then 'task.github_sync_failed'
    when trim(coalesce(p_message, '')) like 'GitHub-Sync ausgeführt:%' then 'task.github_sync_succeeded'
    else null
  end;
$$;


ALTER FUNCTION "public"."task_audit_action_from_legacy_message"("p_message" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."task_audit_action_from_legacy_message"("p_message" "text") IS 'Maps the remaining legacy task activity writes to typed task audit actions during the compatibility period.';



CREATE OR REPLACE FUNCTION "public"."touch_milestone_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_milestone_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_package_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_package_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_planning_item_strategy_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_planning_item_strategy_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transition_task_review_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_action" "text", "p_actor_profile_id" "text", "p_reason" "text", "p_activity_message" "text", "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text", "p_user_agent" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task public.tasks%rowtype;
  v_patch jsonb;
  v_result jsonb;
begin
  if p_expected_updated_at is null or p_action not in ('withdraw', 'reopen') then
    raise exception using errcode = '22023', message = 'invalid review transition';
  end if;
  if jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'review notifications must be a JSON array';
  end if;

  select * into v_task
  from public.tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
  if v_task.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'task was changed concurrently';
  end if;

  if p_action = 'withdraw' then
    if v_task.review_status <> 'requested' or v_task.score_final then
      raise exception using errcode = 'P0004', message = 'review is not active';
    end if;
    if nullif(trim(coalesce(p_reason, '')), '') is null then
      raise exception using errcode = '22023', message = 'withdraw reason is required';
    end if;
    v_patch := jsonb_build_object(
      'status', 'In Arbeit',
      'review_status', 'not_requested',
      'score_points', 0,
      'score_final', false,
      'review_requested_at', null,
      'github_issue_sync_status', 'not_synced',
      'github_issue_sync_error', null
    );
  else
    if v_task.review_status <> 'accepted' or not v_task.score_final then
      raise exception using errcode = 'P0004', message = 'only a final accepted review may be reopened';
    end if;
    if v_task.review_owner_profile_id is null then
      raise exception using errcode = '22023', message = 'review owner is required';
    end if;
    v_patch := jsonb_build_object(
      'status', 'Review',
      'review_status', 'requested',
      'score_points', 0,
      'score_final', false,
      'review_requested_at', clock_timestamp(),
      'github_issue_sync_status', 'not_synced',
      'github_issue_sync_error', null
    );
  end if;

  v_result := public.update_task_transaction(
    p_task_id,
    p_expected_updated_at,
    v_patch,
    false,
    null,
    false,
    null,
    array[p_activity_message],
    coalesce(p_notifications, '[]'::jsonb)
  );

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    request_ip,
    user_agent
  ) values (
    p_actor_profile_id,
    case when p_action = 'withdraw' then 'task.review.withdraw' else 'task.review.reopen' end,
    'task',
    p_task_id,
    jsonb_build_object('status', v_task.status, 'reviewStatus', v_task.review_status, 'scorePoints', v_task.score_points, 'scoreFinal', v_task.score_final),
    coalesce(p_audit_after_data, '{}'::jsonb),
    p_request_ip,
    p_user_agent
  );

  return v_result;
end;
$$;


ALTER FUNCTION "public"."transition_task_review_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_action" "text", "p_actor_profile_id" "text", "p_reason" "text", "p_activity_message" "text", "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trash_planning_item_tree_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_revision" integer, "p_actor_profile_id" "text", "p_reason" "text", "p_cause" "text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor_role text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_root public.tasks%rowtype;
  v_updated_root public.tasks%rowtype;
  v_task_ids text[] := array[]::text[];
  v_trash_revision integer;
  v_trashed_at timestamptz := clock_timestamp();
begin
  if p_root_type not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_root_id, '')), '') is null
     or p_expected_revision is null
     or p_expected_revision < 1
     or p_cause not in ('withdrawn', 'rejected')
     or v_reason is null
     or char_length(v_reason) > 2000 then
    raise exception using errcode = '22023', message = 'planning trash input is invalid';
  end if;

  select platform_role into v_actor_role
  from public.profiles
  where id = p_actor_profile_id
  for share;
  if not found then
    raise exception using errcode = 'P0006', message = 'planning trash actor not found';
  end if;

  select * into v_root
  from public.tasks
  where id = p_root_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_root.task_type <> p_root_type then
    raise exception using errcode = '22023', message = 'planning trash root type is invalid';
  end if;
  if v_root.trashed_at is not null then
    raise exception using errcode = 'P0003', message = 'planning item is already trashed';
  end if;
  if v_root.approval_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'planning approval revision changed';
  end if;
  if p_cause = 'withdrawn' then
    if v_root.approval_status not in ('draft', 'proposed') then
      raise exception using errcode = 'P0003', message = 'only draft or proposed planning items may be withdrawn';
    end if;
    if v_actor_role not in ('ceo', 'deputy')
       and coalesce(v_root.proposed_by, '') <> p_actor_profile_id then
      raise exception using errcode = 'P0006', message = 'planning item withdrawal requires proposer or operational lead';
    end if;
  else
    if v_root.approval_status <> 'proposed' then
      raise exception using errcode = 'P0003', message = 'only proposed planning items may be rejected';
    end if;
    if v_actor_role not in ('ceo', 'deputy') then
      raise exception using errcode = 'P0006', message = 'only ceo or deputy may reject planning items';
    end if;
  end if;

  with recursive planning_tree as (
    select task.id
    from public.tasks task
    where task.id = p_root_id
    union all
    select child.id
    from public.tasks child
    join planning_tree parent on child.parent_task_id = parent.id
    where child.trashed_at is null
  )
  select coalesce(array_agg(id order by id), array[]::text[])
  into v_task_ids
  from planning_tree;

  perform id
  from public.tasks
  where id = any(v_task_ids)
  order by id
  for update;

  v_trash_revision := v_root.trash_revision + 1;
  perform set_config('founderops.trash_lifecycle_write', 'on', true);

  update public.tasks
  set approval_status = case
        when id = p_root_id and p_cause = 'rejected' then 'rejected'
        else approval_status
      end,
      approval_revision = case
        when id = p_root_id and p_cause = 'rejected' then approval_revision + 1
        else approval_revision
      end,
      decided_by = case when id = p_root_id and p_cause = 'rejected' then p_actor_profile_id else decided_by end,
      decided_at = case when id = p_root_id and p_cause = 'rejected' then v_trashed_at else decided_at end,
      decision_note = case when id = p_root_id and p_cause = 'rejected' then v_reason else decision_note end,
      sprint_id = case when task_type = 'deliverable' then null else sprint_id end,
      review_status = case when task_type = 'deliverable' then 'not_requested' else review_status end,
      review_owner_profile_id = case when task_type = 'deliverable' then null else review_owner_profile_id end,
      review_requested_at = case when task_type = 'deliverable' then null else review_requested_at end,
      score_points = case when task_type = 'deliverable' then 0 else score_points end,
      score_final = case when task_type = 'deliverable' then false else score_final end,
      score_relevant = false,
      trashed_at = v_trashed_at,
      trashed_by = p_actor_profile_id,
      trash_reason = v_reason,
      trash_cause = p_cause,
      purge_after = v_trashed_at + interval '90 days',
      trash_root_type = p_root_type,
      trash_root_id = p_root_id,
      trash_revision = v_trash_revision,
      updated_at = clock_timestamp()
  where id = any(v_task_ids)
    and trashed_at is null
    and id <> p_root_id;

  update public.tasks
  set approval_status = case when p_cause = 'rejected' then 'rejected' else approval_status end,
      approval_revision = case when p_cause = 'rejected' then approval_revision + 1 else approval_revision end,
      decided_by = case when p_cause = 'rejected' then p_actor_profile_id else decided_by end,
      decided_at = case when p_cause = 'rejected' then v_trashed_at else decided_at end,
      decision_note = case when p_cause = 'rejected' then v_reason else decision_note end,
      sprint_id = case when task_type = 'deliverable' then null else sprint_id end,
      review_status = case when task_type = 'deliverable' then 'not_requested' else review_status end,
      review_owner_profile_id = case when task_type = 'deliverable' then null else review_owner_profile_id end,
      review_requested_at = case when task_type = 'deliverable' then null else review_requested_at end,
      score_points = case when task_type = 'deliverable' then 0 else score_points end,
      score_final = case when task_type = 'deliverable' then false else score_final end,
      score_relevant = false,
      trashed_at = v_trashed_at,
      trashed_by = p_actor_profile_id,
      trash_reason = v_reason,
      trash_cause = p_cause,
      purge_after = v_trashed_at + interval '90 days',
      trash_root_type = p_root_type,
      trash_root_id = p_root_id,
      trash_revision = v_trash_revision,
      updated_at = clock_timestamp()
  where id = p_root_id
  returning * into v_updated_root;

  insert into public.planning_github_lifecycle_outbox (
    root_type, root_id, root_trash_revision, task_id, github_repo,
    github_issue_number, action, source_type, source_revision, reason,
    status, status_reason, last_error
  )
  select
    p_root_type,
    p_root_id,
    v_trash_revision,
    task.id,
    issue_reference.normalized_repo,
    issue_reference.normalized_issue_number,
    'close_not_planned',
    p_cause,
    v_trash_revision,
    v_reason,
    case when issue_reference.reference_status = 'invalid' then 'failed' else 'pending' end,
    case when issue_reference.reference_status = 'invalid' then 'invalid_issue_reference' end,
    case when issue_reference.reference_status = 'invalid' then issue_reference.error_message end
  from public.tasks task
  cross join lateral public.normalize_planning_github_issue_reference(
    task.task_type,
    task.github_repo,
    task.github_issue_number,
    task.issue_number,
    task.github_issue_url,
    task.issue_url
  ) issue_reference
  where task.id = any(v_task_ids)
    and task.task_type in ('deliverable', 'sub_issue')
  on conflict (root_type, root_id, root_trash_revision, task_id, action) do nothing;

  perform set_config('founderops.trash_lifecycle_write', 'off', true);
  insert into public.task_activity (task_id, message)
  values (
    p_root_id,
    case p_cause
      when 'rejected' then case when p_root_type = 'initiative' then 'Initiative abgelehnt und in den Papierkorb verschoben' else 'Deliverable abgelehnt und in den Papierkorb verschoben' end
      else case when p_root_type = 'initiative' then 'Initiative zurückgezogen' else 'Deliverable zurückgezogen' end
    end || ' · Begründung: ' || v_reason
  );
  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id, before_data, after_data, request_ip, user_agent
  ) values (
    p_actor_profile_id,
    case when p_cause = 'rejected' then 'planning_item.rejected' else 'planning_item.withdrawn' end,
    'task',
    p_root_id,
    jsonb_build_object('approvalStatus', v_root.approval_status, 'approvalRevision', v_root.approval_revision),
    jsonb_build_object('trashRevision', v_trash_revision, 'affectedTaskIds', to_jsonb(v_task_ids)),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'rootType', p_root_type,
    'rootId', p_root_id,
    'affectedTaskIds', to_jsonb(v_task_ids),
    'trashRevision', v_trash_revision,
    'item', to_jsonb(v_updated_root),
    'eventIds', '[]'::jsonb
  );
end;
$$;


ALTER FUNCTION "public"."trash_planning_item_tree_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_revision" integer, "p_actor_profile_id" "text", "p_reason" "text", "p_cause" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."try_acquire_github_issue_sync_lock"("p_resource_key" "text", "p_task_id" "text" DEFAULT NULL::"text", "p_locked_by_profile_id" "text" DEFAULT NULL::"text", "p_ttl_seconds" integer DEFAULT 600) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_lock_token uuid := gen_random_uuid();
begin
  if p_resource_key is null or length(trim(p_resource_key)) = 0 then
    raise exception 'github sync resource key is required';
  end if;

  insert into public.github_issue_sync_locks (
    resource_key,
    task_id,
    locked_by_profile_id,
    lock_token,
    locked_at,
    expires_at
  )
  values (
    trim(p_resource_key),
    nullif(p_task_id, ''),
    nullif(p_locked_by_profile_id, ''),
    v_lock_token,
    now(),
    now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 600), 1))
  )
  on conflict (resource_key) do update
    set task_id = excluded.task_id,
        locked_by_profile_id = excluded.locked_by_profile_id,
        lock_token = excluded.lock_token,
        locked_at = excluded.locked_at,
        expires_at = excluded.expires_at
    where public.github_issue_sync_locks.expires_at <= now()
  returning lock_token into v_lock_token;

  if not found then
    return null;
  end if;

  return v_lock_token;
end;
$$;


ALTER FUNCTION "public"."try_acquire_github_issue_sync_lock"("p_resource_key" "text", "p_task_id" "text", "p_locked_by_profile_id" "text", "p_ttl_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_backlog_order_transaction"("p_updates" "jsonb", "p_actor_profile_id" "text" DEFAULT NULL::"text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_expected_count integer;
  v_locked_count integer;
  v_before jsonb;
  v_updates jsonb;
begin
  if jsonb_typeof(p_updates) <> 'array' or jsonb_array_length(p_updates) = 0 or jsonb_array_length(p_updates) > 250 then
    raise exception using errcode = '22023', message = 'backlog updates must be a non-empty array with at most 250 entries';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_updates) as item
    where jsonb_typeof(item) <> 'object'
      or nullif(trim(item->>'id'), '') is null
      or case
        when coalesce(item->>'sortOrder', '') ~ '^\d{1,10}$'
          then (item->>'sortOrder')::numeric > 2147483647
        else true
      end
      or nullif(trim(item->>'expectedUpdatedAt'), '') is null
  ) then
    raise exception using errcode = '22023', message = 'backlog update entry is invalid';
  end if;

  select count(*) into v_expected_count from jsonb_array_elements(p_updates);
  if (
    select count(distinct item->>'id')
    from jsonb_array_elements(p_updates) as item
  ) <> v_expected_count then
    raise exception using errcode = '22023', message = 'backlog updates contain duplicate tasks';
  end if;

  perform 1
  from public.tasks as task
  join jsonb_to_recordset(p_updates) as requested(id text, "expectedUpdatedAt" timestamptz)
    on requested.id = task.id
  order by task.id
  for update of task;
  get diagnostics v_locked_count = row_count;

  if v_locked_count <> v_expected_count then
    raise exception using errcode = 'P0002', message = 'at least one task was not found';
  end if;

  if exists (
    select 1
    from public.tasks as task
    join jsonb_to_recordset(p_updates) as requested(id text, "expectedUpdatedAt" timestamptz)
      on requested.id = task.id
    where task.updated_at <> requested."expectedUpdatedAt"
  ) then
    raise exception using errcode = 'P0001', message = 'at least one task was changed concurrently';
  end if;

  select jsonb_agg(jsonb_build_object(
    'id', task.id,
    'sortOrder', task.sort_order,
    'updatedAt', task.updated_at
  ) order by task.id)
  into v_before
  from public.tasks as task
  join jsonb_to_recordset(p_updates) as requested(id text) on requested.id = task.id;

  with updated as (
    update public.tasks as task
    set sort_order = requested."sortOrder",
        updated_at = clock_timestamp()
    from jsonb_to_recordset(p_updates) as requested(id text, "sortOrder" integer)
    where task.id = requested.id
    returning task.id, task.sort_order, task.updated_at
  )
  select jsonb_agg(jsonb_build_object(
    'id', updated.id,
    'sortOrder', updated.sort_order,
    'updatedAt', updated.updated_at
  ) order by updated.sort_order, updated.id)
  into v_updates
  from updated;

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    request_ip,
    user_agent
  )
  values (
    p_actor_profile_id,
    'task.backlog_reorder',
    'task',
    'backlog',
    jsonb_build_object('tasks', coalesce(v_before, '[]'::jsonb)),
    jsonb_build_object('updates', coalesce(v_updates, '[]'::jsonb)),
    p_request_ip,
    p_user_agent
  );

  return coalesce(v_updates, '[]'::jsonb);
end;
$_$;


ALTER FUNCTION "public"."update_backlog_order_transaction"("p_updates" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_backlog_order_transaction"("p_updates" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") IS 'Atomically applies a compare-and-set backlog reorder and its audit record.';



CREATE OR REPLACE FUNCTION "public"."update_browser_planning_item_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_patch" "jsonb", "p_strategy" "jsonb", "p_raci_assignments" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor_role text;
  v_task public.tasks%rowtype;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  if not found or v_actor_role = 'viewer' then
    raise exception using errcode = 'P0006', message = 'planning revise actor is not allowed';
  end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  if v_task.trashed_at is not null then raise exception using errcode = 'P0003', message = 'planning item is trashed'; end if;
  if v_task.task_type not in ('epic', 'initiative') then
    raise exception using errcode = '22023', message = 'strategic revise requires an Epic or Initiative';
  end if;
  if v_patch ? 'parent_task_id' then
    raise exception using errcode = '22023', message = 'parent changes require the planning parent command';
  end if;
  if v_task.task_type = 'epic' and v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'Epic revise requires an operational lead';
  end if;
  if v_task.task_type = 'initiative' and v_actor_role not in ('ceo', 'deputy')
     and p_actor_profile_id is distinct from v_task.owner
     and p_actor_profile_id is distinct from v_task.assignee then
    raise exception using errcode = 'P0006', message = 'Initiative revise requires ownership';
  end if;
  if v_actor_role not in ('ceo', 'deputy') and (
    v_patch ?| array['owner', 'assignee'] or p_raci_assignments is not null
  ) then
    raise exception using errcode = 'P0006', message = 'Owner and RACI changes require an operational lead';
  end if;
  return public.update_planning_item_transaction(
    p_task_id, p_expected_updated_at, v_patch, p_strategy, p_raci_assignments, p_actor_profile_id
  );
end;
$$;


ALTER FUNCTION "public"."update_browser_planning_item_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_patch" "jsonb", "p_strategy" "jsonb", "p_raci_assignments" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_browser_planning_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_actor_profile_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_patch jsonb := coalesce(p_task_patch, '{}'::jsonb);
  v_completed_reopen boolean := false;
  v_actor_role text;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;

  v_completed_reopen := v_task.status = 'Erledigt'
    and v_patch->>'status' = 'Offen'
    and not coalesce(p_note_present, false)
    and not coalesce(p_dependency_present, false)
    and not exists (
      select 1 from jsonb_object_keys(v_patch) as patch_key(value)
      where patch_key.value not in (
        'status', 'score_final', 'score_points', 'review_status', 'review_owner_profile_id',
        'review_requested_at', 'github_issue_sync_status', 'github_issue_sync_error'
      )
    );
  if v_task.status = 'Erledigt' and not v_completed_reopen then
    raise exception using errcode = 'P0016', message = 'completed planning item is locked';
  end if;

  if v_task.task_type = 'sub_issue' and v_task.parent_task_id is not null then
    select * into v_parent from public.tasks where id = v_task.parent_task_id for share;
    if found and v_parent.status = 'Erledigt' then
      raise exception using errcode = 'P0016', message = 'completed parent planning item is locked';
    end if;
  end if;

  if v_completed_reopen then
    select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id for share;
    if not found
       or (v_task.task_type = 'deliverable' and v_actor_role <> 'ceo')
       or (v_task.task_type = 'sub_issue' and v_actor_role not in ('ceo', 'deputy', 'founder')) then
      raise exception using errcode = 'P0006', message = 'completed planning item reopen is not allowed';
    end if;
    return public.update_planning_task_transaction(
      p_task_id,
      p_expected_updated_at,
      v_patch,
      false,
      null,
      false,
      null,
      p_activity_messages,
      p_notifications,
      p_actor_profile_id
    );
  end if;

  return public.update_browser_planning_task_transaction_without_completed_guard(
    p_task_id,
    p_expected_updated_at,
    p_task_patch,
    p_note_present,
    p_note,
    p_dependency_present,
    p_dependency_note,
    p_activity_messages,
    p_notifications,
    p_actor_profile_id
  );
end;
$$;


ALTER FUNCTION "public"."update_browser_planning_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_actor_profile_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_browser_planning_task_transaction_without_completed_guar"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_actor_profile_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor_role text;
  v_task public.tasks%rowtype;
  v_patch jsonb := coalesce(p_task_patch, '{}'::jsonb);
  v_core_patch jsonb;
  v_result jsonb;
  v_updated_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_target_sprint public.sprints%rowtype;
  v_source_sprint public.sprints%rowtype;
  v_target_sprint_id text;
  v_key text;
begin
  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  if not found or v_actor_role = 'viewer' then
    raise exception using errcode = 'P0006', message = 'planning revise actor is not allowed';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if v_task.trashed_at is not null then raise exception using errcode = 'P0003', message = 'task is trashed'; end if;
  if v_task.task_type not in ('deliverable', 'sub_issue') then
    raise exception using errcode = '22023', message = 'delivery revise requires a Deliverable or Sub-Issue';
  end if;
  if v_patch ? 'parent_task_id' then
    raise exception using errcode = '22023', message = 'parent changes require the planning parent command';
  end if;

  if (v_task.review_status = 'requested' and not coalesce(v_task.score_final, false))
     or (v_task.review_status = 'accepted' and coalesce(v_task.score_final, false)) then
    if coalesce(v_task.score_final, false)
       or p_note_present
       or p_dependency_present
       or exists (
         select 1 from jsonb_object_keys(v_patch) as patch_key(value)
         where patch_key.value <> 'review_owner_profile_id'
       ) then
      raise exception using errcode = 'P0010', message = 'planning item review is locked';
    end if;
  end if;

  if v_task.task_type = 'sub_issue' and v_task.parent_task_id is not null then
    select * into v_parent from public.tasks where id = v_task.parent_task_id for share;
    if found and (
      (v_parent.review_status = 'requested' and not coalesce(v_parent.score_final, false))
      or (v_parent.review_status = 'accepted' and coalesce(v_parent.score_final, false))
    ) then
      raise exception using errcode = 'P0010', message = 'parent planning item review is locked';
    end if;
  end if;

  if v_patch ? 'sprint_id' then
    if v_task.parent_task_id is not null then
      select * into v_parent from public.tasks where id = v_task.parent_task_id for share;
    end if;
    if v_task.task_type <> 'deliverable'
       or v_task.approval_status <> 'approved'
       or v_task.status = 'Erledigt'
       or coalesce(nullif(trim(v_task.assignee), ''), nullif(trim(v_task.owner), '')) is null
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

  if v_actor_role not in ('ceo', 'deputy')
     and p_actor_profile_id is distinct from v_task.owner
     and p_actor_profile_id is distinct from v_task.assignee then
    if v_task.task_type <> 'sub_issue' then
      raise exception using errcode = 'P0006', message = 'Deliverable revise requires ownership';
    end if;
    for v_key in select jsonb_object_keys(v_patch) loop
      if v_key not in ('status', 'score_final', 'review_status', 'review_requested_at', 'github_issue_sync_status', 'github_issue_sync_error') then
        raise exception using errcode = 'P0006', message = 'Unowned Sub-Issue revise is limited to status transitions';
      end if;
    end loop;
    if p_note_present or p_dependency_present then
      raise exception using errcode = 'P0006', message = 'Unowned Sub-Issue revise cannot change notes';
    end if;
  end if;

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
    p_actor_profile_id
  );
  if v_patch ?| array['title', 'description', 'workstream', 'estimate_hours', 'github_repo'] then
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


ALTER FUNCTION "public"."update_browser_planning_task_transaction_without_completed_guar"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_actor_profile_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_founderops_github_project_transaction"("p_project_id" "text", "p_expected_owner" "text", "p_expected_number" integer, "p_github_project_owner" "text", "p_github_project_number" integer, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_actor public.profiles%rowtype;
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

  select * into v_actor
  from public.profiles
  where id = p_actor_profile_id;

  if not found or v_actor.platform_role <> 'ceo' then
    raise exception using errcode = 'P0005', message = 'only CEO may update the FounderOps GitHub Project';
  end if;

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

  update public.projects
  set github_project_owner = p_github_project_owner,
      github_project_number = p_github_project_number
  where id = p_project_id;

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    request_ip,
    user_agent
  ) values (
    p_actor_profile_id,
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
$_$;


ALTER FUNCTION "public"."update_founderops_github_project_transaction"("p_project_id" "text", "p_expected_owner" "text", "p_expected_number" integer, "p_github_project_owner" "text", "p_github_project_number" integer, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_founderops_review_window_transaction"("p_project_id" "text", "p_expected_hours" integer, "p_review_objection_window_hours" integer, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor_role text;
  v_project public.projects%rowtype;
  v_updated_sprints jsonb;
begin
  if p_expected_hours is null
    or p_review_objection_window_hours is null
    or p_review_objection_window_hours not between 1 and 336 then
    raise exception using errcode = '22023', message = 'review and objection window must be between 1 and 336 hours';
  end if;

  select platform_role into v_actor_role
  from public.profiles
  where id = p_actor_profile_id;

  if not found or v_actor_role <> 'ceo' then
    raise exception using errcode = 'P0005', message = 'only CEO may update FounderOps process settings';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('founderops-review-window:' || p_project_id, 0));

  select * into v_project
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;
  if v_project.review_objection_window_hours <> p_expected_hours then
    raise exception using errcode = 'P0001', message = 'FounderOps process settings changed concurrently';
  end if;

  update public.projects
  set review_objection_window_hours = p_review_objection_window_hours
  where id = p_project_id;

  update public.sprints
  set review_due_at = ((end_date::date + time '23:59:59.999') at time zone 'Europe/Berlin')
      + make_interval(hours => p_review_objection_window_hours),
      updated_at = clock_timestamp()
  where project_id = p_project_id
    and score_locked is false
    and end_date is not null;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', sprint.id,
        'reviewDueAt', sprint.review_due_at
      )
      order by sprint.start_date, sprint.id
    ),
    '[]'::jsonb
  ) into v_updated_sprints
  from public.sprints as sprint
  where sprint.project_id = p_project_id
    and sprint.score_locked is false;

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    request_ip,
    user_agent
  ) values (
    p_actor_profile_id,
    'founderops.review_window.update',
    'project',
    p_project_id,
    jsonb_build_object('reviewObjectionWindowHours', v_project.review_objection_window_hours),
    jsonb_build_object('reviewObjectionWindowHours', p_review_objection_window_hours),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'project', jsonb_build_object(
      'id', p_project_id,
      'reviewObjectionWindowHours', p_review_objection_window_hours
    ),
    'sprints', v_updated_sprints
  );
end;
$$;


ALTER FUNCTION "public"."update_founderops_review_window_transaction"("p_project_id" "text", "p_expected_hours" integer, "p_review_objection_window_hours" integer, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_planning_item_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_patch" "jsonb" DEFAULT '{}'::"jsonb", "p_strategy" "jsonb" DEFAULT NULL::"jsonb", "p_raci_assignments" "jsonb" DEFAULT NULL::"jsonb", "p_actor_profile_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_task public.tasks%rowtype;
  v_updated_task public.tasks%rowtype;
  v_parent_changed boolean := false;
begin
  perform set_config('app.actor_profile_id', coalesce(p_actor_profile_id, ''), true);

  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'planning item revision is required';
  end if;
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'planning item patch must be an object';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(v_patch) key
    where key not in ('title', 'description', 'status', 'priority', 'owner', 'assignee', 'target_date', 'parent_task_id', 'sort_order')
  ) then
    raise exception using errcode = '22023', message = 'planning item patch contains an unsupported field';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning item not found';
  end if;
  if v_task.task_type not in ('epic', 'initiative') then
    raise exception using errcode = '22023', message = 'task is not a strategic planning item';
  end if;
  if v_task.trashed_at is not null then
    raise exception using errcode = 'P0003', message = 'planning item is trashed';
  end if;
  if v_task.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;

  v_parent_changed := v_patch ? 'parent_task_id'
    and nullif(trim(coalesce(v_patch->>'parent_task_id', '')), '') is distinct from v_task.parent_task_id;

  update public.tasks
  set title = case when v_patch ? 'title' then nullif(trim(v_patch->>'title'), '') else v_task.title end,
      description = case when v_patch ? 'description' then nullif(trim(coalesce(v_patch->>'description', '')), '') else v_task.description end,
      status = case when v_patch ? 'status' then nullif(trim(v_patch->>'status'), '') else v_task.status end,
      priority = case
        when v_task.task_type = 'epic' then null
        when v_patch ? 'priority' then nullif(trim(v_patch->>'priority'), '')
        else v_task.priority
      end,
      owner = case when v_patch ? 'owner' then nullif(trim(coalesce(v_patch->>'owner', '')), '') else v_task.owner end,
      assignee = case when v_patch ? 'assignee' then nullif(trim(coalesce(v_patch->>'assignee', '')), '') else v_task.assignee end,
      target_date = case when v_patch ? 'target_date' then nullif(trim(coalesce(v_patch->>'target_date', '')), '')::date else v_task.target_date end,
      parent_task_id = case when v_patch ? 'parent_task_id' then nullif(trim(coalesce(v_patch->>'parent_task_id', '')), '') else v_task.parent_task_id end,
      sort_order = case when v_patch ? 'sort_order' then (v_patch->>'sort_order')::integer else v_task.sort_order end,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning * into v_updated_task;

  if p_strategy is not null then
    if v_task.task_type <> 'initiative' or jsonb_typeof(p_strategy) <> 'object' then
      raise exception using errcode = '22023', message = 'only initiatives can update strategy';
    end if;
    insert into public.planning_item_strategy (task_id, goal, success_criteria, scope_constraints)
    values (
      p_task_id,
      coalesce(p_strategy->>'goal', ''),
      coalesce(p_strategy->>'successCriteria', ''),
      coalesce(p_strategy->>'scopeConstraints', '')
    )
    on conflict (task_id) do update
      set goal = excluded.goal,
          success_criteria = excluded.success_criteria,
          scope_constraints = excluded.scope_constraints;
  end if;

  if p_raci_assignments is not null then
    if v_task.task_type <> 'initiative' then
      raise exception using errcode = '22023', message = 'only initiatives can update RACI assignments';
    end if;
    perform public.replace_planning_item_raci_assignments(p_task_id, p_raci_assignments);
  end if;

  if v_parent_changed then
    insert into public.task_activity (task_id, message)
    values (p_task_id, case when v_task.approval_status = 'approved'
      then 'Epic-Zuordnung geändert: neue Freigabe erforderlich'
      else 'Epic-Zuordnung geändert' end);
  end if;

  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
  values (
    nullif(p_actor_profile_id, ''),
    'planning_item.updated',
    'task',
    p_task_id,
    jsonb_build_object('parentTaskId', v_task.parent_task_id, 'approvalStatus', v_task.approval_status),
    jsonb_build_object('parentTaskId', v_updated_task.parent_task_id, 'approvalStatus', v_updated_task.approval_status)
  );

  return jsonb_build_object('task', to_jsonb(v_updated_task));
end;
$$;


ALTER FUNCTION "public"."update_planning_item_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_patch" "jsonb", "p_strategy" "jsonb", "p_raci_assignments" "jsonb", "p_actor_profile_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_planning_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb" DEFAULT '{}'::"jsonb", "p_note_present" boolean DEFAULT false, "p_note" "text" DEFAULT NULL::"text", "p_dependency_present" boolean DEFAULT false, "p_dependency_note" "text" DEFAULT NULL::"text", "p_activity_messages" "text"[] DEFAULT '{}'::"text"[], "p_notifications" "jsonb" DEFAULT '[]'::"jsonb", "p_actor_profile_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_patch jsonb := coalesce(p_task_patch, '{}'::jsonb);
  v_evidence_links_present boolean := v_patch ? 'evidence_links';
  v_evidence_links jsonb := v_patch->'evidence_links';
  v_changes_parent boolean := v_patch ? 'parent_task_id';
  v_changes_status boolean := v_patch ? 'status';
  v_parent_id text;
  v_initial_parent_id text;
  v_initial_task_type text;
  v_before_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_updated_task public.tasks%rowtype;
  v_result jsonb;
begin
  perform set_config('app.actor_profile_id', coalesce(p_actor_profile_id, ''), true);
  v_patch := v_patch - 'evidence_links';
  if not v_changes_parent and not v_changes_status then
    v_result := public.update_task_transaction(
      p_task_id, p_expected_updated_at, v_patch, p_note_present, p_note,
      p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
    );
    if v_evidence_links_present then perform public.replace_task_evidence_links(p_task_id, v_evidence_links); end if;
    return v_result;
  end if;
  select task_type, parent_task_id into v_initial_task_type, v_initial_parent_id
  from public.tasks where id = p_task_id;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if v_changes_parent then
    if v_initial_task_type <> 'sub_issue' then
      raise exception using errcode = '22023', message = 'only sub-issues may change parent';
    end if;
    v_parent_id := nullif(trim(v_patch->>'parent_task_id'), '');
  elsif v_initial_task_type = 'sub_issue' then
    v_parent_id := v_initial_parent_id;
  else
    v_result := public.update_task_transaction(
      p_task_id, p_expected_updated_at, v_patch, p_note_present, p_note,
      p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
    );
    if v_evidence_links_present then perform public.replace_task_evidence_links(p_task_id, v_evidence_links); end if;
    return v_result;
  end if;
  if v_parent_id is null then raise exception using errcode = '22023', message = 'sub-issue parent is required'; end if;
  select * into v_parent from public.tasks
  where id = v_parent_id and task_type = 'deliverable' and trashed_at is null for share;
  if not found then raise exception using errcode = '22023', message = 'sub-issue parent must be an active deliverable'; end if;
  if v_changes_status and v_parent.approval_status is distinct from 'approved' then
    raise exception using errcode = 'P0008', message = 'sub-issue parent is not approved';
  end if;
  select * into v_before_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if v_before_task.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'task was changed concurrently';
  end if;
  if v_before_task.task_type <> 'sub_issue' then
    raise exception using errcode = '22023', message = 'only sub-issues may change parent';
  end if;
  if v_before_task.trashed_at is not null then raise exception using errcode = 'P0003', message = 'sub-issue is trashed'; end if;
  if not v_changes_parent and v_before_task.parent_task_id is distinct from v_parent_id then
    raise exception using errcode = 'P0001', message = 'sub-issue parent changed concurrently';
  end if;
  if not v_changes_parent then
    v_result := public.update_task_transaction(
      p_task_id, p_expected_updated_at, v_patch, p_note_present, p_note,
      p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
    );
    if v_evidence_links_present then perform public.replace_task_evidence_links(p_task_id, v_evidence_links); end if;
    return jsonb_set(v_result, '{parentApprovalStatus}', to_jsonb(v_parent.approval_status), true);
  end if;
  v_result := public.update_task_transaction(
    p_task_id, p_expected_updated_at, v_patch - 'parent_task_id', p_note_present, p_note,
    p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
  );
  update public.tasks set parent_task_id = v_parent_id, updated_at = clock_timestamp()
  where id = p_task_id returning * into v_updated_task;
  if v_evidence_links_present then perform public.replace_task_evidence_links(p_task_id, v_evidence_links); end if;
  if v_before_task.parent_task_id is distinct from v_updated_task.parent_task_id then
    insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
    values (p_actor_profile_id, 'task.parent_changed', 'task', p_task_id,
      jsonb_build_object('parentTaskId', v_before_task.parent_task_id),
      jsonb_build_object('parentTaskId', v_updated_task.parent_task_id));
  end if;
  return jsonb_set(jsonb_set(v_result, '{task}', to_jsonb(v_updated_task), true),
    '{parentApprovalStatus}', to_jsonb(v_parent.approval_status), true);
end;
$$;


ALTER FUNCTION "public"."update_planning_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_actor_profile_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_planning_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_actor_profile_id" "text") IS 'Atomically applies task updates, evidence links, and locked Sub-Issue parent approval state.';



CREATE OR REPLACE FUNCTION "public"."update_profile_admin_transaction"("p_profile_id" "text", "p_actor_profile_id" "text", "p_profile_patch" "jsonb" DEFAULT '{}'::"jsonb", "p_notification_events" "jsonb" DEFAULT '{}'::"jsonb", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_patch jsonb := coalesce(p_profile_patch, '{}'::jsonb);
  v_before jsonb;
  v_profile jsonb;
  v_preferences jsonb;
  v_current_role text;
  v_next_role text;
  v_demoted_ceo_ids text[] := array[]::text[];
begin
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'profile patch must be a JSON object';
  end if;

  lock table public.profiles in share row exclusive mode;

  select to_jsonb(profile), profile.platform_role
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
      select coalesce(array_agg(profile.id order by profile.id), '{}')
      into v_demoted_ceo_ids
      from public.profiles as profile
      where profile.id <> p_profile_id
        and profile.platform_role = 'ceo';

      update public.profiles
      set platform_role = 'founder',
          org_role = 'Founder',
          deputy_for = null,
          deputy_active_from = null,
          deputy_active_until = null
      where id <> p_profile_id
        and platform_role = 'ceo';
    elsif v_current_role = 'ceo' and not exists (
      select 1
      from public.profiles
      where id <> p_profile_id
        and platform_role = 'ceo'
    ) then
      raise exception using errcode = '23514', message = 'at least one CEO must remain';
    end if;
  end if;

  if v_patch ? 'profile_color' then
    if not v_patch ? 'profile_color_duplicate_mode'
       or jsonb_typeof(v_patch -> 'profile_color_duplicate_mode') <> 'boolean' then
      raise exception using errcode = '22023', message = 'profile color duplicate mode is required';
    end if;
    perform public.apply_profile_color_change(
      p_profile_id,
      v_patch ->> 'profile_color',
      (v_patch ->> 'profile_color_duplicate_mode')::boolean
    );
  elsif v_patch ? 'profile_color_duplicate_mode' then
    raise exception using errcode = '22023', message = 'profile color duplicate mode requires a color change';
  end if;

  update public.profiles as profile
  set github_login = case when v_patch ? 'github_login' then nullif(v_patch ->> 'github_login', '') else profile.github_login end,
      platform_role = case when v_patch ? 'platform_role' then v_patch ->> 'platform_role' else profile.platform_role end,
      org_role = case when v_patch ? 'org_role' then nullif(v_patch ->> 'org_role', '') else profile.org_role end,
      deputy_for = case when v_patch ? 'deputy_for' then nullif(v_patch ->> 'deputy_for', '') else profile.deputy_for end,
      deputy_active_from = case when v_patch ? 'deputy_active_from' then nullif(v_patch ->> 'deputy_active_from', '')::date else profile.deputy_active_from end,
      deputy_active_until = case when v_patch ? 'deputy_active_until' then nullif(v_patch ->> 'deputy_active_until', '')::date else profile.deputy_active_until end,
      focus = case when v_patch ? 'focus' then nullif(v_patch ->> 'focus', '') else profile.focus end,
      weekly_capacity = case when v_patch ? 'weekly_capacity' then (v_patch ->> 'weekly_capacity')::integer else profile.weekly_capacity end,
      google_chat_user_id = case when v_patch ? 'google_chat_user_id' then nullif(v_patch ->> 'google_chat_user_id', '') else profile.google_chat_user_id end,
      google_chat_dm_space = case when v_patch ? 'google_chat_dm_space' then nullif(v_patch ->> 'google_chat_dm_space', '') else profile.google_chat_dm_space end,
      notifications_enabled = case when v_patch ? 'notifications_enabled' then (v_patch ->> 'notifications_enabled')::boolean else profile.notifications_enabled end
  where profile.id = p_profile_id
  returning to_jsonb(profile) into v_profile;

  if (select count(*) from public.profiles where platform_role = 'ceo') <> 1 then
    raise exception using errcode = '23514', message = 'exactly one CEO is required';
  end if;

  v_preferences := public.upsert_profile_notification_preferences(p_profile_id, p_notification_events);

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    request_ip,
    user_agent
  )
  values (
    p_actor_profile_id,
    'profile.update',
    'profile',
    p_profile_id,
    v_before,
    jsonb_build_object(
      'profile', v_profile,
      'notification_events', coalesce(p_notification_events, '{}'::jsonb),
      'demoted_ceo_ids', to_jsonb(v_demoted_ceo_ids)
    ),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'profile', v_profile,
    'notification_preferences', v_preferences
  );
end;
$$;


ALTER FUNCTION "public"."update_profile_admin_transaction"("p_profile_id" "text", "p_actor_profile_id" "text", "p_profile_patch" "jsonb", "p_notification_events" "jsonb", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_profile_admin_transaction"("p_profile_id" "text", "p_actor_profile_id" "text", "p_profile_patch" "jsonb", "p_notification_events" "jsonb", "p_request_ip" "text", "p_user_agent" "text") IS 'Atomically updates an admin-managed profile, CEO transfer, notification preferences, and audit entry.';



CREATE OR REPLACE FUNCTION "public"."update_profile_settings_transaction"("p_profile_id" "text", "p_profile_patch" "jsonb" DEFAULT '{}'::"jsonb", "p_ui_preferences" "jsonb" DEFAULT NULL::"jsonb", "p_notification_events" "jsonb" DEFAULT '{}'::"jsonb", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_patch jsonb := coalesce(p_profile_patch, '{}'::jsonb);
  v_filters jsonb;
  v_expanded_ids jsonb;
  v_before jsonb;
  v_profile jsonb;
  v_ui_preference jsonb := null;
  v_preferences jsonb;
begin
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'profile patch must be a JSON object';
  end if;

  lock table public.profiles in row exclusive mode;

  select to_jsonb(profile)
  into v_before
  from public.profiles as profile
  where profile.id = p_profile_id
  for update;

  if v_before is null then
    raise exception using errcode = 'P0002', message = 'profile not found';
  end if;

  if v_patch ? 'profile_color' then
    if not v_patch ? 'profile_color_duplicate_mode'
       or jsonb_typeof(v_patch -> 'profile_color_duplicate_mode') <> 'boolean' then
      raise exception using errcode = '22023', message = 'profile color duplicate mode is required';
    end if;
    perform public.apply_profile_color_change(
      p_profile_id,
      v_patch ->> 'profile_color',
      (v_patch ->> 'profile_color_duplicate_mode')::boolean
    );
  elsif v_patch ? 'profile_color_duplicate_mode' then
    raise exception using errcode = '22023', message = 'profile color duplicate mode requires a color change';
  end if;

  update public.profiles as profile
  set focus = case when v_patch ? 'focus' then nullif(v_patch ->> 'focus', '') else profile.focus end,
      notifications_enabled = case when v_patch ? 'notifications_enabled' then (v_patch ->> 'notifications_enabled')::boolean else profile.notifications_enabled end
  where profile.id = p_profile_id
  returning to_jsonb(profile) into v_profile;

  if p_ui_preferences is not null then
    if jsonb_typeof(p_ui_preferences) <> 'object' then
      raise exception using errcode = '22023', message = 'UI preferences must be a JSON object';
    end if;

    v_filters := coalesce(p_ui_preferences -> 'planning_filters', '{}'::jsonb);
    if jsonb_typeof(v_filters) <> 'object' or v_filters ?| array['packageId', 'owner'] then
      raise exception using errcode = '22023', message = 'Planning filters must use canonical fields';
    end if;

    v_expanded_ids := coalesce(p_ui_preferences -> 'expanded_item_ids', '[]'::jsonb);
    if jsonb_typeof(v_expanded_ids) <> 'array' then
      raise exception using errcode = '22023', message = 'Expanded Planning item IDs must be an array';
    end if;

    insert into public.profile_ui_preferences as preference (
      profile_id,
      default_workspace,
      default_task_view,
      planning_filters,
      expanded_item_ids,
      updated_at
    )
    values (
      p_profile_id,
      p_ui_preferences ->> 'default_workspace',
      p_ui_preferences ->> 'default_task_view',
      v_filters,
      array(select jsonb_array_elements_text(v_expanded_ids)),
      now()
    )
    on conflict (profile_id) do update
      set default_workspace = excluded.default_workspace,
          default_task_view = excluded.default_task_view,
          planning_filters = excluded.planning_filters,
          expanded_item_ids = excluded.expanded_item_ids,
          updated_at = excluded.updated_at
    returning jsonb_build_object(
      'profile_id', preference.profile_id,
      'default_workspace', preference.default_workspace,
      'default_task_view', preference.default_task_view,
      'planning_filters', preference.planning_filters,
      'expanded_item_ids', to_jsonb(preference.expanded_item_ids),
      'created_at', preference.created_at,
      'updated_at', preference.updated_at
    ) into v_ui_preference;
  end if;

  v_preferences := public.upsert_profile_notification_preferences(p_profile_id, p_notification_events);

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    request_ip,
    user_agent
  )
  values (
    p_profile_id,
    'profile.self_service.update',
    'profile',
    p_profile_id,
    v_before,
    jsonb_build_object(
      'profile', v_profile,
      'ui_preference', v_ui_preference,
      'notification_events', coalesce(p_notification_events, '{}'::jsonb)
    ),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'profile', v_profile,
    'ui_preference', v_ui_preference,
    'notification_preferences', v_preferences
  );
end;
$$;


ALTER FUNCTION "public"."update_profile_settings_transaction"("p_profile_id" "text", "p_profile_patch" "jsonb", "p_ui_preferences" "jsonb", "p_notification_events" "jsonb", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_profile_settings_transaction"("p_profile_id" "text", "p_profile_patch" "jsonb", "p_ui_preferences" "jsonb", "p_notification_events" "jsonb", "p_request_ip" "text", "p_user_agent" "text") IS 'Atomically updates self-service profile fields, UI preferences, notification preferences, and audit entry.';



CREATE OR REPLACE FUNCTION "public"."update_sprint_schedule_transaction"("p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_sprint_patch" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_project_id text;
  v_window_hours integer;
  v_sprint public.sprints%rowtype;
  v_updated public.sprints%rowtype;
  v_before jsonb;
  v_next_name text;
  v_next_status text;
  v_next_start_date date;
  v_next_end_date date;
  v_next_review_due_at timestamptz;
  v_timeline_changed boolean;
begin
  if p_expected_updated_at is null or jsonb_typeof(coalesce(p_sprint_patch, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'expected sprint revision and patch are required';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(coalesce(p_sprint_patch, '{}'::jsonb)) as patch_key
    where patch_key not in ('name', 'status', 'start_date', 'end_date')
  ) then
    raise exception using errcode = '22023', message = 'sprint patch contains unsupported fields';
  end if;

  select project_id into v_project_id
  from public.sprints
  where id = p_sprint_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'sprint not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('founderops-review-window:' || v_project_id, 0));

  select review_objection_window_hours into v_window_hours
  from public.projects
  where id = v_project_id
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  select * into v_sprint
  from public.sprints
  where id = p_sprint_id and project_id = v_project_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'sprint not found';
  end if;
  if v_sprint.score_locked then
    raise exception using errcode = 'P0003', message = 'locked sprint cannot be changed';
  end if;
  if v_sprint.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'sprint changed concurrently';
  end if;

  v_next_name := case when p_sprint_patch ? 'name' then nullif(trim(p_sprint_patch->>'name'), '') else v_sprint.name end;
  v_next_status := case when p_sprint_patch ? 'status' then nullif(p_sprint_patch->>'status', '') else v_sprint.status end;
  v_next_start_date := case when p_sprint_patch ? 'start_date' then nullif(p_sprint_patch->>'start_date', '')::date else v_sprint.start_date end;
  v_next_end_date := case when p_sprint_patch ? 'end_date' then nullif(p_sprint_patch->>'end_date', '')::date else v_sprint.end_date end;

  if v_next_name is null or v_next_status not in ('planning', 'active', 'review', 'closed') then
    raise exception using errcode = '22023', message = 'sprint name or status is invalid';
  end if;
  if v_next_start_date is not null and v_next_end_date is not null and v_next_start_date > v_next_end_date then
    raise exception using errcode = '22023', message = 'sprint start must not be after sprint end';
  end if;

  v_timeline_changed := v_next_name is distinct from v_sprint.name
    or v_next_start_date is distinct from v_sprint.start_date
    or v_next_end_date is distinct from v_sprint.end_date;
  if v_timeline_changed and exists (select 1 from public.tasks where sprint_id = p_sprint_id) then
    raise exception using errcode = 'P0004', message = 'sprint timeline is protected by assigned tasks';
  end if;

  v_next_review_due_at := case
    when v_next_end_date is null then null
    else ((v_next_end_date + time '23:59:59.999') at time zone 'Europe/Berlin')
      + make_interval(hours => v_window_hours)
  end;
  v_before := to_jsonb(v_sprint);

  update public.sprints
  set name = v_next_name,
      status = v_next_status,
      start_date = v_next_start_date,
      end_date = v_next_end_date,
      review_due_at = v_next_review_due_at,
      updated_at = clock_timestamp()
  where id = p_sprint_id
  returning * into v_updated;

  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id, before_data, after_data, request_ip, user_agent
  ) values (
    p_actor_profile_id, 'sprint.update', 'sprint', p_sprint_id,
    v_before, to_jsonb(v_updated), p_request_ip, p_user_agent
  );

  return to_jsonb(v_updated);
end;
$$;


ALTER FUNCTION "public"."update_sprint_schedule_transaction"("p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_sprint_patch" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb" DEFAULT '{}'::"jsonb", "p_note_present" boolean DEFAULT false, "p_note" "text" DEFAULT NULL::"text", "p_dependency_present" boolean DEFAULT false, "p_dependency_note" "text" DEFAULT NULL::"text", "p_activity_messages" "text"[] DEFAULT '{}'::"text"[], "p_notifications" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_patch jsonb := coalesce(p_task_patch, '{}'::jsonb);
  v_allowed_columns constant text[] := array[
    'acceptance_criteria',
    'assignee',
    'deadline',
    'definition_of_done',
    'end_date',
    'evidence_link',
    'evidence_required',
    'github_issue_sync_error',
    'github_issue_sync_status',
    'intended_outcome',
    'milestone_id',
    'owner',
    'package_id',
    'priority',
    'problem_statement',
    'review_owner_profile_id',
    'review_requested_at',
    'review_status',
    'score_final',
    'score_points',
    'score_relevant',
    'self_blockers_checked',
    'self_dod_checked',
    'self_documented_checked',
    'self_evidence_checked',
    'scope_constraints',
    'sprint_id',
    'start_date',
    'status',
    'task_type'
  ];
  v_assignments text;
  v_task jsonb;
  v_activities jsonb := '[]'::jsonb;
begin
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'expected task update timestamp is required';
  end if;

  if jsonb_typeof(v_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'task patch must be a JSON object';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(v_patch) as patch_key
    where not (patch_key = any(v_allowed_columns))
  ) then
    raise exception using errcode = '22023', message = 'task patch contains unsupported columns';
  end if;

  if jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'task notifications must be a JSON array';
  end if;

  if exists (select 1 from jsonb_object_keys(v_patch)) then
    select string_agg(
      format(
        '%1$I = (jsonb_populate_record(null::public.tasks, to_jsonb(task) || $1)).%1$I',
        patch_key
      ),
      ', '
      order by patch_key
    )
    into v_assignments
    from jsonb_object_keys(v_patch) as patch_key;

    execute format(
      'update public.tasks as task set %s, updated_at = clock_timestamp() where task.id = $2 and task.updated_at = $3 returning to_jsonb(task)',
      v_assignments
    )
    into v_task
    using v_patch, p_task_id, p_expected_updated_at;
  else
    update public.tasks as task
    set updated_at = clock_timestamp()
    where task.id = p_task_id
      and task.updated_at = p_expected_updated_at
    returning to_jsonb(task) into v_task;
  end if;

  if v_task is null then
    if exists (select 1 from public.tasks where id = p_task_id) then
      raise exception using errcode = 'P0001', message = 'task was changed concurrently';
    end if;
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  if p_note_present then
    insert into public.task_notes (task_id, note, updated_at)
    values (p_task_id, coalesce(p_note, ''), now())
    on conflict (task_id) do update
      set note = excluded.note,
          updated_at = excluded.updated_at;
  end if;

  if p_dependency_present then
    delete from public.task_dependencies where task_id = p_task_id;
    if nullif(trim(coalesce(p_dependency_note, '')), '') is not null then
      insert into public.task_dependencies (task_id, note)
      values (p_task_id, left(trim(p_dependency_note), 2000));
    end if;
  end if;

  with inserted as (
    insert into public.task_activity (task_id, message)
    select p_task_id, message
    from unnest(coalesce(p_activity_messages, '{}')) as message
    where nullif(trim(message), '') is not null
    returning id, task_id, message, created_at
  )
  select coalesce(jsonb_agg(to_jsonb(inserted) order by inserted.id), '[]'::jsonb)
  into v_activities
  from inserted;

  insert into public.notification_events (
    type,
    actor_profile_id,
    recipient_profile_id,
    entity_type,
    entity_id,
    title,
    body
  )
  select
    notification.type,
    notification.actor_profile_id,
    notification.recipient_profile_id,
    notification.entity_type,
    notification.entity_id,
    notification.title,
    notification.body
  from jsonb_to_recordset(coalesce(p_notifications, '[]'::jsonb)) as notification(
    type text,
    actor_profile_id text,
    recipient_profile_id text,
    entity_type text,
    entity_id text,
    title text,
    body text
  );

  return jsonb_build_object(
    'task', v_task,
    'activities', v_activities
  );
end;
$_$;


ALTER FUNCTION "public"."update_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb") IS 'Atomically applies a compare-and-set task update with notes, dependencies, activity, and notifications.';



CREATE OR REPLACE FUNCTION "public"."update_team_planning_item_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_type" "text", "p_item_id" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_patch" "jsonb" DEFAULT '{}'::"jsonb", "p_changed_fields" "jsonb" DEFAULT '[]'::"jsonb", "p_system_effects" "jsonb" DEFAULT '[]'::"jsonb", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_completed_reopen boolean := false;
begin
  if exists (
    select 1 from public.team_planning_item_update_requests request
    where request.token_id = p_token_id and request.idempotency_key = p_idempotency_key
  ) then
    return public.update_team_planning_item_transaction_without_completed_guard(
      p_token_id, p_profile_id, p_item_type, p_item_id, p_expected_updated_at,
      p_idempotency_key, p_request_hash, p_patch, p_changed_fields, p_system_effects,
      p_request_ip, p_user_agent
    );
  end if;

  select * into v_task from public.tasks where id = p_item_id for update;
  if found and v_task.task_type in ('deliverable', 'sub_issue') and v_patch <> '{}'::jsonb then
    v_completed_reopen := v_task.status = 'Erledigt'
      and v_patch->>'status' = 'Offen'
      and (select count(*) from jsonb_object_keys(v_patch)) = 1;
    if v_task.status = 'Erledigt' and not v_completed_reopen then
      raise exception using errcode = 'P0016', message = 'completed planning item is locked';
    end if;
    if v_task.task_type = 'sub_issue' and v_task.parent_task_id is not null then
      select * into v_parent from public.tasks where id = v_task.parent_task_id for share;
      if found and v_parent.status = 'Erledigt' then
        raise exception using errcode = 'P0016', message = 'completed parent planning item is locked';
      end if;
    end if;
  end if;

  return public.update_team_planning_item_transaction_without_completed_guard(
    p_token_id, p_profile_id, p_item_type, p_item_id, p_expected_updated_at,
    p_idempotency_key, p_request_hash, p_patch, p_changed_fields, p_system_effects,
    p_request_ip, p_user_agent
  );
end;
$$;


ALTER FUNCTION "public"."update_team_planning_item_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_type" "text", "p_item_id" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_patch" "jsonb", "p_changed_fields" "jsonb", "p_system_effects" "jsonb", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_team_planning_item_transaction_without_completed_guard"("p_token_id" "uuid", "p_profile_id" "text", "p_item_type" "text", "p_item_id" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_patch" "jsonb" DEFAULT '{}'::"jsonb", "p_changed_fields" "jsonb" DEFAULT '[]'::"jsonb", "p_system_effects" "jsonb" DEFAULT '[]'::"jsonb", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_request public.team_planning_item_update_requests%rowtype;
  v_role text;
  v_type text := case nullif(trim(coalesce(p_item_type, '')), '') when 'milestone' then 'epic' else nullif(trim(coalesce(p_item_type, '')), '') end;
  v_task public.tasks%rowtype;
  v_updated_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_review_owner text;
  v_review_owner_role text;
  v_review_status text;
  v_review_requested_at timestamptz;
  v_score_points integer;
  v_score_final boolean;
  v_sprint_locked boolean := false;
  v_parent_review_locked boolean := false;
  v_review_request_started boolean := false;
  v_response jsonb;
  v_before jsonb;
  v_strategy jsonb;
  v_raci jsonb;
  v_allowed text[];
  v_status text;
begin
  if p_token_id is null
     or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or v_type not in ('epic', 'initiative', 'deliverable', 'sub_issue')
     or nullif(trim(coalesce(p_item_id, '')), '') is null
     or p_expected_updated_at is null
     or p_idempotency_key is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_changed_fields, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_system_effects, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'planning items update input is invalid';
  end if;

  select * into v_token from public.team_task_intake_tokens
  where id = p_token_id and profile_id = p_profile_id and revoked_at is null and expires_at > now()
  for update;
  if not found then raise exception using errcode = 'P0004', message = 'planning items token is inactive'; end if;
  if not ('write:planning-items:update' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'planning items update scope is missing';
  end if;
  select platform_role into v_role from public.profiles where id = p_profile_id for share;
  if not found or v_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'planning items profile role is not allowed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('planning-items-update:' || p_token_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_request from public.team_planning_item_update_requests
  where token_id = p_token_id and idempotency_key = p_idempotency_key;
  if found then
    if v_request.request_hash <> p_request_hash then
      raise exception using errcode = 'P0003', message = 'idempotency key conflict';
    end if;
    return jsonb_set(v_request.response, '{replayed}', 'true'::jsonb, true);
  end if;

  select * into v_task from public.tasks
  where id = p_item_id and project_id = 'findmydoc-founder-execution' and trashed_at is null
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'planning item not found'; end if;
  if v_task.task_type <> v_type then raise exception using errcode = '22023', message = 'planning item type does not match'; end if;
  if v_task.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'planning item was changed concurrently';
  end if;
  if v_type = 'epic' and v_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'epic update requires ceo or deputy';
  end if;
  if v_role = 'founder' and v_type = 'initiative' and v_task.owner <> p_profile_id then
    raise exception using errcode = 'P0007', message = 'founder may only update owned initiatives';
  end if;
  if v_role = 'founder' and v_type in ('deliverable', 'sub_issue')
     and v_task.owner <> p_profile_id and v_task.assignee <> p_profile_id
     and not (v_type = 'sub_issue' and p_patch ? 'status' and p_patch - 'status' = '{}'::jsonb) then
    raise exception using errcode = 'P0007', message = 'founder may only update owned planning tasks';
  end if;

  v_allowed := case v_type
    when 'epic' then array['title', 'description', 'status', 'target_date']
    when 'initiative' then array['title', 'description', 'status', 'priority', 'owner', 'assignee', 'target_date', 'parent_task_id', 'strategy', 'raciAssignments']
    when 'deliverable' then array['title', 'description', 'status', 'priority', 'owner', 'assignee', 'parent_task_id', 'workstream', 'start_date', 'end_date', 'deadline', 'estimate_hours', 'problem_statement', 'intended_outcome', 'scope_constraints', 'acceptance_criteria', 'evidence_required', 'definition_of_done']
    else array['title', 'description', 'status', 'owner', 'assignee', 'parent_task_id', 'problem_statement', 'intended_outcome', 'scope_constraints', 'acceptance_criteria', 'evidence_required', 'definition_of_done', 'github_repo']
  end;
  if exists (select 1 from jsonb_object_keys(p_patch) key where not (key = any(v_allowed))) then
    raise exception using errcode = '22023', message = 'planning item patch contains an unsupported field';
  end if;
  if v_type in ('deliverable', 'sub_issue') and p_patch ? 'parent_task_id'
     and (select count(*) from jsonb_object_keys(p_patch)) > 1 then
    raise exception using errcode = '23514', message = 'planning item parent must be changed separately';
  end if;
  if p_patch ? 'status' then
    v_status := nullif(trim(p_patch->>'status'), '');
    if (v_type in ('epic', 'initiative') and v_status not in ('Offen', 'In Arbeit', 'Pausiert', 'Blockiert', 'Erledigt'))
       or (v_type = 'deliverable' and v_status not in ('Offen', 'In Arbeit', 'Review', 'Nacharbeit', 'Blockiert', 'Erledigt'))
       or (v_type = 'sub_issue' and v_status not in ('Offen', 'In Arbeit', 'Blockiert', 'Erledigt')) then
      raise exception using errcode = '22023', message = 'planning item status is invalid';
    end if;
    if v_status is distinct from v_task.status and v_type = 'deliverable' then
      if v_status = 'Erledigt' and v_role <> 'ceo' then
        raise exception using errcode = 'P0007', message = 'only ceo may complete a deliverable finally';
      end if;
      if v_task.status = 'Erledigt' and v_status <> 'Erledigt' and v_role <> 'ceo' then
        raise exception using errcode = 'P0007', message = 'only ceo may reopen a completed deliverable';
      end if;
      if v_role = 'founder' and v_task.status = 'Nacharbeit' and v_status not in ('In Arbeit', 'Review', 'Blockiert') then
        raise exception using errcode = 'P0007', message = 'founder may only resume, block, or review rework';
      end if;
    end if;
  end if;
  if p_patch ? 'parent_task_id' and nullif(trim(coalesce(p_patch->>'parent_task_id', '')), '') is not null then
    select * into v_parent from public.tasks where id = nullif(trim(p_patch->>'parent_task_id'), '') and trashed_at is null for share;
    if not found
       or (v_type = 'initiative' and v_parent.task_type <> 'epic')
       or (v_type = 'deliverable' and (v_parent.task_type <> 'initiative' or v_parent.approval_status = 'rejected'))
       or (v_type = 'sub_issue' and (v_parent.task_type <> 'deliverable' or v_parent.approval_status <> 'approved')) then
      raise exception using errcode = '23514', message = 'planning item parent has the wrong type or approval state';
    end if;
  elsif v_type = 'sub_issue' and p_patch ? 'parent_task_id' then
    raise exception using errcode = '23514', message = 'sub-issue requires a deliverable parent';
  end if;

  if v_type = 'sub_issue' then
    select * into v_parent
    from public.tasks
    where id = coalesce(nullif(trim(coalesce(p_patch->>'parent_task_id', '')), ''), v_task.parent_task_id)
      and trashed_at is null
    for share;
    if not found or v_parent.task_type <> 'deliverable' or v_parent.approval_status <> 'approved' then
      raise exception using errcode = 'P0008', message = 'sub-issue parent must be an approved deliverable';
    end if;
    v_parent_review_locked := (v_parent.review_status = 'requested' and not coalesce(v_parent.score_final, false))
      or (v_parent.review_status = 'accepted' and coalesce(v_parent.score_final, false));
    if v_parent_review_locked and p_patch <> '{}'::jsonb then
      raise exception using errcode = '23514', message = 'parent deliverable review is locked';
    end if;
  end if;

  if v_type = 'deliverable'
     and p_patch <> '{}'::jsonb
     and ((v_task.review_status = 'requested' and not coalesce(v_task.score_final, false))
       or (v_task.review_status = 'accepted' and coalesce(v_task.score_final, false))) then
    raise exception using errcode = '23514', message = 'deliverable review is locked';
  end if;

  v_review_owner := v_task.review_owner_profile_id;
  v_review_status := v_task.review_status;
  v_review_requested_at := v_task.review_requested_at;
  v_score_points := v_task.score_points;
  v_score_final := v_task.score_final;
  if v_type = 'deliverable' and p_patch ? 'status' and p_patch->>'status' = 'Review' then
    if v_task.approval_status <> 'approved' then
      raise exception using errcode = '23514', message = 'only approved deliverables can enter review';
    end if;
    if v_task.score_final then
      raise exception using errcode = '23514', message = 'final deliverable must use review reopen';
    end if;
    if v_task.sprint_id is not null then
      select coalesce(score_locked, false) into v_sprint_locked from public.sprints where id = v_task.sprint_id;
      if v_sprint_locked then
        raise exception using errcode = '23514', message = 'sprint score is locked';
      end if;
    end if;
    if v_review_owner is null and v_task.parent_task_id is not null then
      select profile_id into v_review_owner
      from public.planning_item_raci_assignments
      where task_id = v_task.parent_task_id and role = 'accountable'
      order by sort_order, profile_id
      limit 1;
    end if;
    if v_review_owner is null and v_task.parent_task_id is not null then
      select owner into v_review_owner from public.tasks where id = v_task.parent_task_id;
    end if;
    if v_review_owner is null then
      raise exception using errcode = '23514', message = 'review owner is required';
    end if;
    select platform_role into v_review_owner_role from public.profiles where id = v_review_owner for share;
    if v_review_owner_role is null or v_review_owner_role = 'viewer' then
      raise exception using errcode = '23514', message = 'review owner must have a contributor role';
    end if;
    v_review_status := 'requested';
    v_review_requested_at := clock_timestamp();
    v_score_points := 0;
    v_score_final := false;
    v_review_request_started := true;
  elsif v_type = 'deliverable' and p_patch ? 'status' and v_task.status = 'Erledigt' and p_patch->>'status' <> 'Erledigt' then
    v_review_status := 'not_requested';
    v_review_requested_at := null;
    v_score_final := false;
  elsif v_type = 'deliverable' and p_patch ? 'status' and v_task.status = 'Review' and p_patch->>'status' <> 'Review' then
    v_review_status := 'not_requested';
    v_review_requested_at := null;
  end if;

  v_before := to_jsonb(v_task);
  perform set_config('app.actor_profile_id', p_profile_id, true);
  if p_patch <> '{}'::jsonb then
    update public.tasks
    set title = case when p_patch ? 'title' then nullif(trim(p_patch->>'title'), '') else v_task.title end,
        description = case when p_patch ? 'description' then nullif(trim(coalesce(p_patch->>'description', '')), '') else v_task.description end,
        status = case when p_patch ? 'status' then nullif(trim(p_patch->>'status'), '') else v_task.status end,
        priority = case when v_type = 'epic' then null when p_patch ? 'priority' then nullif(trim(p_patch->>'priority'), '') else v_task.priority end,
        owner = case when p_patch ? 'owner' then nullif(trim(p_patch->>'owner'), '') else v_task.owner end,
        assignee = case when p_patch ? 'assignee' then nullif(trim(p_patch->>'assignee'), '') else v_task.assignee end,
        target_date = case when p_patch ? 'target_date' then nullif(trim(coalesce(p_patch->>'target_date', '')), '')::date else v_task.target_date end,
        parent_task_id = case when p_patch ? 'parent_task_id' then nullif(trim(coalesce(p_patch->>'parent_task_id', '')), '') else v_task.parent_task_id end,
        workstream = case when p_patch ? 'workstream' then nullif(trim(coalesce(p_patch->>'workstream', '')), '') else v_task.workstream end,
        start_date = case when p_patch ? 'start_date' then nullif(trim(coalesce(p_patch->>'start_date', '')), '')::date else v_task.start_date end,
        end_date = case when p_patch ? 'end_date' then nullif(trim(coalesce(p_patch->>'end_date', '')), '')::date else v_task.end_date end,
        deadline = case when p_patch ? 'deadline' then nullif(trim(coalesce(p_patch->>'deadline', '')), '') else v_task.deadline end,
        estimate_hours = case when p_patch ? 'estimate_hours' then coalesce((p_patch->>'estimate_hours')::integer, 0) else v_task.estimate_hours end,
        problem_statement = case when p_patch ? 'problem_statement' then nullif(trim(coalesce(p_patch->>'problem_statement', '')), '') else v_task.problem_statement end,
        intended_outcome = case when p_patch ? 'intended_outcome' then nullif(trim(coalesce(p_patch->>'intended_outcome', '')), '') else v_task.intended_outcome end,
        scope_constraints = case when p_patch ? 'scope_constraints' then nullif(trim(coalesce(p_patch->>'scope_constraints', '')), '') else v_task.scope_constraints end,
        acceptance_criteria = case when p_patch ? 'acceptance_criteria' then nullif(trim(coalesce(p_patch->>'acceptance_criteria', '')), '') else v_task.acceptance_criteria end,
        evidence_required = case when p_patch ? 'evidence_required' then nullif(trim(coalesce(p_patch->>'evidence_required', '')), '') else v_task.evidence_required end,
        definition_of_done = case when p_patch ? 'definition_of_done' then nullif(trim(coalesce(p_patch->>'definition_of_done', '')), '') else v_task.definition_of_done end,
        github_repo = case when p_patch ? 'github_repo' then nullif(trim(coalesce(p_patch->>'github_repo', '')), '') else v_task.github_repo end,
        review_status = v_review_status,
        review_owner_profile_id = v_review_owner,
        review_requested_at = v_review_requested_at,
        score_points = v_score_points,
        score_final = v_score_final,
        github_issue_sync_status = case when v_type in ('deliverable', 'sub_issue') then 'not_synced' else v_task.github_issue_sync_status end,
        github_issue_sync_error = case when v_type in ('deliverable', 'sub_issue') then null else v_task.github_issue_sync_error end,
        updated_at = clock_timestamp()
    where id = p_item_id
    returning * into v_updated_task;
  else
    v_updated_task := v_task;
  end if;

  if v_type = 'initiative' and p_patch ? 'strategy' then
    if jsonb_typeof(p_patch->'strategy') <> 'object' then
      raise exception using errcode = '22023', message = 'initiative strategy is invalid';
    end if;
    insert into public.planning_item_strategy (task_id, goal, success_criteria, scope_constraints)
    values (p_item_id, coalesce(p_patch->'strategy'->>'goal', ''), coalesce(p_patch->'strategy'->>'successCriteria', ''), coalesce(p_patch->'strategy'->>'scopeConstraints', ''))
    on conflict (task_id) do update set
      goal = excluded.goal,
      success_criteria = excluded.success_criteria,
      scope_constraints = excluded.scope_constraints;
  end if;
  if v_type = 'initiative' and p_patch ? 'raciAssignments' then
    perform public.replace_planning_item_raci_assignments(p_item_id, p_patch->'raciAssignments');
  end if;

  if p_patch ? 'status' and v_updated_task.status is distinct from v_task.status then
    insert into public.task_activity (task_id, message)
    values (p_item_id, 'Status geändert: ' || v_task.status || ' → ' || v_updated_task.status);
  end if;
  if v_review_request_started then
    insert into public.notification_events (
      type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body, dedupe_key
    ) values (
      'task.review_requested', p_profile_id, v_review_owner, 'task', p_item_id,
      'Review angefragt: ' || v_updated_task.title,
      'Diese Aufgabe wartet auf deine Accountable-Review.',
      'team-planning-review:' || p_item_id || ':' || v_review_requested_at::text
    );
  end if;
  if v_type = 'initiative' then
    select jsonb_build_object('goal', goal, 'successCriteria', success_criteria, 'scopeConstraints', scope_constraints)
    into v_strategy from public.planning_item_strategy where task_id = p_item_id;
    select coalesce(jsonb_agg(jsonb_build_object('profileId', profile_id, 'role', role, 'sortOrder', sort_order) order by role, sort_order), '[]'::jsonb)
    into v_raci from public.planning_item_raci_assignments where task_id = p_item_id;
  end if;
  v_response := jsonb_build_object(
    'replayed', false,
    'itemType', v_type,
    'item', to_jsonb(v_updated_task)
      || case when v_type = 'initiative' then jsonb_build_object(
        'goal', coalesce(v_strategy->>'goal', ''),
        'success_criteria', coalesce(v_strategy->>'successCriteria', ''),
        'scope_constraints', coalesce(v_strategy->>'scopeConstraints', ''),
        'raci_assignments', coalesce(v_raci, '[]'::jsonb)
      ) else '{}'::jsonb end,
    'changedFields', coalesce(p_changed_fields, '[]'::jsonb),
    'systemEffects', coalesce(p_system_effects, '[]'::jsonb)
  );
  insert into public.team_planning_item_update_requests (token_id, profile_id, item_type, item_id, expected_updated_at, idempotency_key, request_hash, response)
  values (p_token_id, p_profile_id, v_type, p_item_id, p_expected_updated_at, p_idempotency_key, p_request_hash, v_response);
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data, request_ip, user_agent)
  values (p_profile_id, 'team.planning_items.update', 'task', p_item_id, v_before, v_response->'item', p_request_ip, p_user_agent);
  return v_response;
end;
$_$;


ALTER FUNCTION "public"."update_team_planning_item_transaction_without_completed_guard"("p_token_id" "uuid", "p_profile_id" "text", "p_item_type" "text", "p_item_id" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_patch" "jsonb", "p_changed_fields" "jsonb", "p_system_effects" "jsonb", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_team_planning_item_transaction_without_completed_guard"("p_token_id" "uuid", "p_profile_id" "text", "p_item_type" "text", "p_item_id" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_patch" "jsonb", "p_changed_fields" "jsonb", "p_system_effects" "jsonb", "p_request_ip" "text", "p_user_agent" "text") IS 'Atomically updates Planning Items, including role-guarded task status and review transitions.';



CREATE OR REPLACE FUNCTION "public"."update_team_planning_item_with_projection_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_type" "text", "p_item_id" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_patch" "jsonb" DEFAULT '{}'::"jsonb", "p_changed_fields" "jsonb" DEFAULT '[]'::"jsonb", "p_system_effects" "jsonb" DEFAULT '[]'::"jsonb", "p_projection_command" "jsonb" DEFAULT NULL::"jsonb", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_result jsonb;
  v_request public.planning_github_projection_outbox%rowtype;
  v_operation_id text := 'team-update:' || p_token_id::text || ':' || p_idempotency_key::text;
begin
  v_result := public.update_team_planning_item_transaction(
    p_token_id, p_profile_id, p_item_type, p_item_id, p_expected_updated_at,
    p_idempotency_key, p_request_hash, p_patch, p_changed_fields, p_system_effects,
    p_request_ip, p_user_agent
  );
  if p_projection_command is not null and not coalesce((v_result->>'replayed')::boolean, false) then
    if jsonb_typeof(p_projection_command) <> 'object' then
      raise exception using errcode = '22023', message = 'planning github projection command is invalid';
    end if;
    v_request := public.enqueue_planning_github_projection_request(
      v_operation_id, p_item_id, p_profile_id,
      coalesce((p_projection_command->>'createIfMissing')::boolean, false),
      'team_update', p_token_id, p_idempotency_key, null
    );
    v_result := jsonb_set(v_result, '{githubSync}', jsonb_build_object('status', 'accepted'), true);
    update public.team_planning_item_update_requests
    set response = v_result
    where token_id = p_token_id and idempotency_key = p_idempotency_key;
  end if;
  return v_result || jsonb_build_object('projectionOperationId', v_operation_id);
end;
$$;


ALTER FUNCTION "public"."update_team_planning_item_with_projection_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_type" "text", "p_item_id" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_patch" "jsonb", "p_changed_fields" "jsonb", "p_system_effects" "jsonb", "p_projection_command" "jsonb", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_team_planning_item_with_projection_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_type" "text", "p_item_id" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_patch" "jsonb", "p_changed_fields" "jsonb", "p_system_effects" "jsonb", "p_projection_command" "jsonb", "p_request_ip" "text", "p_user_agent" "text") IS 'Atomically revises a Team Planning Item and enqueues its durable GitHub projection request.';



CREATE OR REPLACE FUNCTION "public"."upsert_profile_notification_preferences"("p_profile_id" "text", "p_notification_events" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_events jsonb := coalesce(p_notification_events, '{}'::jsonb);
  v_preferences jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(v_events) <> 'object' then
    raise exception using errcode = '22023', message = 'notification events must be a JSON object';
  end if;

  if exists (
    select 1
    from jsonb_each(v_events) as event
    where jsonb_typeof(event.value) <> 'boolean'
  ) then
    raise exception using errcode = '22023', message = 'notification event values must be boolean';
  end if;

  insert into public.notification_preferences as preference (
    profile_id,
    channel,
    event_type,
    enabled,
    updated_at
  )
  select
    p_profile_id,
    'google_chat',
    event.key,
    (event.value #>> '{}')::boolean,
    now()
  from jsonb_each(v_events) as event
  on conflict (profile_id, channel, event_type) do update
    set enabled = excluded.enabled,
        updated_at = excluded.updated_at;

  select coalesce(jsonb_agg(to_jsonb(preference) order by preference.event_type), '[]'::jsonb)
  into v_preferences
  from public.notification_preferences as preference
  where preference.profile_id = p_profile_id
    and preference.channel = 'google_chat'
    and preference.event_type in (select key from jsonb_each(v_events));

  return v_preferences;
end;
$$;


ALTER FUNCTION "public"."upsert_profile_notification_preferences"("p_profile_id" "text", "p_notification_events" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."withdraw_planning_item_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_revision" integer, "p_actor_profile_id" "text", "p_reason" "text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return public.trash_planning_item_tree_transaction(
    p_root_type,
    p_root_id,
    p_expected_revision,
    p_actor_profile_id,
    p_reason,
    'withdrawn',
    p_request_ip,
    p_user_agent
  );
end;
$$;


ALTER FUNCTION "public"."withdraw_planning_item_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_revision" integer, "p_actor_profile_id" "text", "p_reason" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."withdraw_planning_item_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_revision" integer, "p_actor_profile_id" "text", "p_reason" "text", "p_request_ip" "text", "p_user_agent" "text") IS 'Atomically moves an Initiative or Deliverable tree to planning trash after role and revision checks.';



CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" NOT NULL,
    "priority" "text",
    "owner" "text",
    "assignee" "text",
    "workstream" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "start_date" "date",
    "end_date" "date",
    "deadline" "text",
    "estimate_hours" integer,
    "definition_of_done" "text",
    "evidence_link" "text",
    "issue_number" "text",
    "issue_url" "text",
    "watched" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sprint_id" "text",
    "review_status" "text" DEFAULT 'not_requested'::"text" NOT NULL,
    "score_points" integer DEFAULT 0 NOT NULL,
    "score_final" boolean DEFAULT false NOT NULL,
    "github_repo" "text",
    "github_issue_number" integer,
    "github_issue_url" "text",
    "github_issue_sync_status" "text" DEFAULT 'not_synced'::"text" NOT NULL,
    "github_issue_last_synced_at" timestamp with time zone,
    "github_issue_sync_error" "text",
    "task_type" "text" DEFAULT 'deliverable'::"text" NOT NULL,
    "parent_task_id" "text",
    "score_relevant" boolean DEFAULT true NOT NULL,
    "original_sprint_id" "text",
    "carried_from_task_id" "text",
    "carried_from_sprint_id" "text",
    "carryover_reason" "text",
    "carryover_count" integer DEFAULT 0 NOT NULL,
    "sprint_outcome" "text",
    "self_dod_checked" boolean DEFAULT false NOT NULL,
    "self_evidence_checked" boolean DEFAULT false NOT NULL,
    "self_documented_checked" boolean DEFAULT false NOT NULL,
    "self_blockers_checked" boolean DEFAULT false NOT NULL,
    "problem_statement" "text",
    "intended_outcome" "text",
    "scope_constraints" "text",
    "acceptance_criteria" "text",
    "evidence_required" "text",
    "dod_template_version" "text" DEFAULT 'founder-deliverable-v2'::"text",
    "created_by" "text",
    "review_owner_profile_id" "text",
    "review_requested_at" timestamp with time zone,
    "intake_source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "intake_status" "text" DEFAULT 'confirmed'::"text" NOT NULL,
    "intake_decided_by" "text",
    "intake_decided_at" timestamp with time zone,
    "intake_decision_note" "text",
    "creation_request_id" "text",
    "creation_request_payload" "jsonb",
    "approval_status" "text",
    "approval_revision" integer DEFAULT 1 NOT NULL,
    "proposed_by" "text",
    "proposed_at" timestamp with time zone,
    "decided_by" "text",
    "decided_at" timestamp with time zone,
    "decision_note" "text",
    "trashed_at" timestamp with time zone,
    "trashed_by" "text",
    "trash_reason" "text",
    "trash_cause" "text",
    "purge_after" timestamp with time zone,
    "trash_root_type" "text",
    "trash_root_id" "text",
    "trash_revision" integer DEFAULT 0 NOT NULL,
    "target_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "github_comment_notifications_after" timestamp with time zone,
    CONSTRAINT "tasks_approval_revision_check" CHECK (("approval_revision" >= 1)),
    CONSTRAINT "tasks_approval_sprint_check" CHECK (((("task_type" = 'deliverable'::"text") AND ("approval_status" = 'approved'::"text")) OR ("sprint_id" IS NULL))),
    CONSTRAINT "tasks_approval_status_by_type_check" CHECK (((("task_type" = ANY (ARRAY['epic'::"text", 'sub_issue'::"text"])) AND ("approval_status" IS NULL)) OR (("task_type" = ANY (ARRAY['initiative'::"text", 'deliverable'::"text"])) AND ("approval_status" = ANY (ARRAY['draft'::"text", 'proposed'::"text", 'approved'::"text", 'rejected'::"text"]))))),
    CONSTRAINT "tasks_github_repo_allowed_check" CHECK (((("task_type" = ANY (ARRAY['epic'::"text", 'initiative'::"text"])) AND ("github_repo" IS NULL) AND ("github_issue_number" IS NULL) AND ("github_issue_url" IS NULL) AND ("github_issue_last_synced_at" IS NULL) AND ("github_issue_sync_error" IS NULL)) OR (("task_type" = 'deliverable'::"text") AND ("github_repo" = 'findmydoc-platform/management'::"text")) OR (("task_type" = 'sub_issue'::"text") AND ("github_repo" = ANY (ARRAY['findmydoc-platform/management'::"text", 'findmydoc-platform/website'::"text", 'findmydoc-platform/clinic-dashboard'::"text"]))))),
    CONSTRAINT "tasks_github_sync_status_check" CHECK (((("task_type" = ANY (ARRAY['epic'::"text", 'initiative'::"text"])) AND ("github_issue_sync_status" = 'not_applicable'::"text")) OR (("task_type" = ANY (ARRAY['deliverable'::"text", 'sub_issue'::"text"])) AND ("github_issue_sync_status" = ANY (ARRAY['not_synced'::"text", 'synced'::"text", 'pending'::"text", 'failed'::"text"]))))),
    CONSTRAINT "tasks_intake_source_check" CHECK (("intake_source" = ANY (ARRAY['manual'::"text", 'ceo_intake'::"text", 'agent_api'::"text", 'team_intake'::"text"]))),
    CONSTRAINT "tasks_intake_status_check" CHECK (("intake_status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'rejected'::"text"]))),
    CONSTRAINT "tasks_priority_by_type_check" CHECK (((("task_type" = 'epic'::"text") AND ("priority" IS NULL)) OR (("task_type" <> 'epic'::"text") AND (NULLIF(TRIM(BOTH FROM "priority"), ''::"text") IS NOT NULL)))),
    CONSTRAINT "tasks_review_status_check" CHECK (("review_status" = ANY (ARRAY['not_requested'::"text", 'requested'::"text", 'accepted'::"text", 'partial'::"text", 'changes_requested'::"text"]))),
    CONSTRAINT "tasks_score_relevance_approval_check" CHECK (("score_relevant" = (("task_type" = 'deliverable'::"text") AND ("approval_status" = 'approved'::"text") AND ("sprint_id" IS NOT NULL)))),
    CONSTRAINT "tasks_sprint_outcome_check" CHECK ((("sprint_outcome" IS NULL) OR ("sprint_outcome" = ANY (ARRAY['completed'::"text", 'partial'::"text", 'rework'::"text", 'communicated_blocker'::"text", 'missed_no_review'::"text", 'missed_uncommunicated'::"text"])))),
    CONSTRAINT "tasks_status_by_type_check" CHECK (((("task_type" = ANY (ARRAY['epic'::"text", 'initiative'::"text"])) AND ("status" = ANY (ARRAY['Offen'::"text", 'In Arbeit'::"text", 'Pausiert'::"text", 'Blockiert'::"text", 'Erledigt'::"text"]))) OR (("task_type" = 'deliverable'::"text") AND ("status" = ANY (ARRAY['Offen'::"text", 'In Arbeit'::"text", 'Review'::"text", 'Nacharbeit'::"text", 'Blockiert'::"text", 'Erledigt'::"text"]))) OR (("task_type" = 'sub_issue'::"text") AND ("status" = ANY (ARRAY['Offen'::"text", 'In Arbeit'::"text", 'Blockiert'::"text", 'Erledigt'::"text"]))))),
    CONSTRAINT "tasks_status_not_proposal_check" CHECK (("status" <> 'Vorschlag'::"text")),
    CONSTRAINT "tasks_strategic_operational_fields_check" CHECK ((("task_type" <> ALL (ARRAY['epic'::"text", 'initiative'::"text"])) OR (("sprint_id" IS NULL) AND ("original_sprint_id" IS NULL) AND ("carried_from_task_id" IS NULL) AND ("carried_from_sprint_id" IS NULL) AND ("carryover_reason" IS NULL) AND ("carryover_count" = 0) AND ("sprint_outcome" IS NULL) AND ("review_status" = 'not_requested'::"text") AND ("review_owner_profile_id" IS NULL) AND ("review_requested_at" IS NULL) AND ("score_points" = 0) AND ("score_final" = false) AND ("score_relevant" = false)))),
    CONSTRAINT "tasks_sub_issue_operational_fields_check" CHECK ((("task_type" <> 'sub_issue'::"text") OR (("sprint_id" IS NULL) AND ("review_status" = 'not_requested'::"text") AND ("review_owner_profile_id" IS NULL) AND ("review_requested_at" IS NULL) AND ("score_points" = 0) AND ("score_final" = false) AND ("score_relevant" = false)))),
    CONSTRAINT "tasks_task_type_check" CHECK (("task_type" = ANY (ARRAY['epic'::"text", 'initiative'::"text", 'deliverable'::"text", 'sub_issue'::"text"]))),
    CONSTRAINT "tasks_trash_metadata_check" CHECK (((("trashed_at" IS NULL) AND ("trashed_by" IS NULL) AND ("trash_reason" IS NULL) AND ("trash_cause" IS NULL) AND ("purge_after" IS NULL) AND ("trash_root_type" IS NULL) AND ("trash_root_id" IS NULL)) OR (("trashed_at" IS NOT NULL) AND ("trashed_by" IS NOT NULL) AND (NULLIF(TRIM(BOTH FROM "trash_reason"), ''::"text") IS NOT NULL) AND ("trash_cause" = ANY (ARRAY['withdrawn'::"text", 'rejected'::"text"])) AND ("purge_after" = ("trashed_at" + '90 days'::interval)) AND ("trash_root_type" = ANY (ARRAY['initiative'::"text", 'deliverable'::"text"])) AND (NULLIF(TRIM(BOTH FROM "trash_root_id"), ''::"text") IS NOT NULL) AND ("trash_revision" >= 1)))),
    CONSTRAINT "tasks_trash_revision_check" CHECK (("trash_revision" >= 0))
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


COMMENT ON COLUMN "public"."tasks"."github_issue_sync_status" IS 'Status of the app-to-GitHub issue projection only; comment delivery is tracked separately.';



COMMENT ON COLUMN "public"."tasks"."github_issue_last_synced_at" IS 'Timestamp of the last successful app-to-GitHub issue projection.';



COMMENT ON COLUMN "public"."tasks"."github_issue_sync_error" IS 'Last technical error from the app-to-GitHub issue projection.';



COMMENT ON COLUMN "public"."tasks"."review_owner_profile_id" IS 'Frozen review owner for an active task review request, usually the Initiative Accountable.';



COMMENT ON COLUMN "public"."tasks"."review_requested_at" IS 'Timestamp when the current task review request was opened or renewed.';



COMMENT ON COLUMN "public"."tasks"."intake_source" IS 'Origin of the task row for manual, CEO, agent, and team skill intake flows.';



COMMENT ON COLUMN "public"."tasks"."intake_status" IS 'Confirmation lifecycle for team intake before backlog/GitHub sync eligibility.';



COMMENT ON COLUMN "public"."tasks"."intake_decided_by" IS 'CEO or Deputy profile that confirmed or rejected a team intake item.';



COMMENT ON COLUMN "public"."tasks"."creation_request_payload" IS 'Stores only an MD5 fingerprint of the normalized create request for idempotency comparison.';



COMMENT ON COLUMN "public"."tasks"."github_comment_notifications_after" IS 'GitHub comments updated before this task-specific watermark must not create mention notifications.';



CREATE OR REPLACE VIEW "public"."active_tasks" WITH ("security_invoker"='true') AS
 SELECT "id",
    "project_id",
    "title",
    "description",
    "status",
    "priority",
    "owner",
    "assignee",
    "workstream",
    "sort_order",
    "start_date",
    "end_date",
    "deadline",
    "estimate_hours",
    "definition_of_done",
    "evidence_link",
    "issue_number",
    "issue_url",
    "watched",
    "updated_at",
    "sprint_id",
    "review_status",
    "score_points",
    "score_final",
    "github_repo",
    "github_issue_number",
    "github_issue_url",
    "github_issue_sync_status",
    "github_issue_last_synced_at",
    "github_issue_sync_error",
    "task_type",
    "parent_task_id",
    "score_relevant",
    "original_sprint_id",
    "carried_from_task_id",
    "carried_from_sprint_id",
    "carryover_reason",
    "carryover_count",
    "sprint_outcome",
    "self_dod_checked",
    "self_evidence_checked",
    "self_documented_checked",
    "self_blockers_checked",
    "problem_statement",
    "intended_outcome",
    "scope_constraints",
    "acceptance_criteria",
    "evidence_required",
    "dod_template_version",
    "created_by",
    "review_owner_profile_id",
    "review_requested_at",
    "intake_source",
    "intake_status",
    "intake_decided_by",
    "intake_decided_at",
    "intake_decision_note",
    "creation_request_id",
    "creation_request_payload",
    "approval_status",
    "approval_revision",
    "proposed_by",
    "proposed_at",
    "decided_by",
    "decided_at",
    "decision_note",
    "trashed_at",
    "trashed_by",
    "trash_reason",
    "trash_cause",
    "purge_after",
    "trash_root_type",
    "trash_root_id",
    "trash_revision",
    "target_date",
    "created_at"
   FROM "public"."tasks" "task"
  WHERE ("trashed_at" IS NULL);


ALTER VIEW "public"."active_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" bigint NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "text" NOT NULL,
    "action" "text" NOT NULL,
    "actor_profile_id" "text",
    "before_data" "jsonb",
    "after_data" "jsonb",
    "request_ip" "text",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


ALTER TABLE "public"."audit_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."availability" (
    "id" bigint NOT NULL,
    "profile_id" "text" NOT NULL,
    "type" "text" DEFAULT 'busy'::"text" NOT NULL,
    "weekday" integer,
    "start_date" "date",
    "end_date" "date",
    "start_time" time without time zone,
    "end_time" time without time zone,
    "note" "text",
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "external_id" "text",
    "external_calendar_id" "text",
    "synced_at" timestamp with time zone,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "blocker_kind" "text" DEFAULT 'on_business'::"text" NOT NULL,
    CONSTRAINT "availability_blocker_kind_check" CHECK (("blocker_kind" = ANY (ARRAY['working_hours'::"text", 'on_business'::"text", 'customer_appointment'::"text", 'internal_meeting'::"text", 'focus_time'::"text", 'admin'::"text", 'travel'::"text", 'private_appointment'::"text", 'vacation'::"text", 'sick'::"text", 'care'::"text", 'calendar_event'::"text", 'other'::"text"]))),
    CONSTRAINT "availability_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'google_calendar'::"text"]))),
    CONSTRAINT "availability_type_check" CHECK (("type" = ANY (ARRAY['working_hours'::"text", 'busy'::"text", 'vacation'::"text", 'sick'::"text"]))),
    CONSTRAINT "availability_weekday_check" CHECK ((("weekday" >= 0) AND ("weekday" <= 6)))
);


ALTER TABLE "public"."availability" OWNER TO "postgres";


COMMENT ON COLUMN "public"."availability"."source" IS 'Manual entries are app-owned; google_calendar entries are imported busy blocks from Google Workspace.';



COMMENT ON COLUMN "public"."availability"."external_id" IS 'Provider event id for imported calendar blocks.';



COMMENT ON COLUMN "public"."availability"."external_calendar_id" IS 'Provider calendar id for imported calendar blocks.';



COMMENT ON COLUMN "public"."availability"."synced_at" IS 'Timestamp of the last successful external calendar import.';



COMMENT ON COLUMN "public"."availability"."title" IS 'Short user-facing title for manual availability blockers and imported calendar blocks.';



COMMENT ON COLUMN "public"."availability"."blocker_kind" IS 'Detailed blocker reason used by the Meeting Finder UI; type remains the broad availability category.';



ALTER TABLE "public"."availability" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."availability_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."decision_comments" (
    "id" bigint NOT NULL,
    "decision_id" bigint NOT NULL,
    "profile_id" "text",
    "type" "text" DEFAULT 'comment'::"text" NOT NULL,
    "comment" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "decision_comments_type_check" CHECK (("type" = ANY (ARRAY['comment'::"text", 'objection'::"text"])))
);


ALTER TABLE "public"."decision_comments" OWNER TO "postgres";


ALTER TABLE "public"."decision_comments" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."decision_comments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."decision_confirmations" (
    "id" bigint NOT NULL,
    "decision_id" bigint NOT NULL,
    "profile_id" "text" NOT NULL,
    "confirmed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."decision_confirmations" OWNER TO "postgres";


ALTER TABLE "public"."decision_confirmations" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."decision_confirmations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."decision_log" (
    "id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "context" "text",
    "decision" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "required_profile_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_by" "text",
    "locked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "decision_log_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'open_for_confirmation'::"text", 'locked'::"text"])))
);


ALTER TABLE "public"."decision_log" OWNER TO "postgres";


ALTER TABLE "public"."decision_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."decision_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."decision_task_links" (
    "id" bigint NOT NULL,
    "decision_id" bigint NOT NULL,
    "task_id" "text" NOT NULL,
    "link_type" "text" DEFAULT 'follows_from'::"text" NOT NULL,
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "decision_task_links_link_type_check" CHECK (("link_type" = ANY (ARRAY['follows_from'::"text", 'supports'::"text", 'blocks_decision'::"text"])))
);


ALTER TABLE "public"."decision_task_links" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."decision_task_links_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."decision_task_links_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."decision_task_links_id_seq" OWNED BY "public"."decision_task_links"."id";



CREATE TABLE IF NOT EXISTS "public"."feedback_items" (
    "id" bigint NOT NULL,
    "type" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "severity" "text" DEFAULT 'P2'::"text" NOT NULL,
    "profile_id" "text",
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "page_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "feedback_items_severity_check" CHECK (("severity" = ANY (ARRAY['P0'::"text", 'P1'::"text", 'P2'::"text", 'P3'::"text"]))),
    CONSTRAINT "feedback_items_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'triaged'::"text", 'planned'::"text", 'done'::"text", 'dismissed'::"text"]))),
    CONSTRAINT "feedback_items_type_check" CHECK (("type" = ANY (ARRAY['bug'::"text", 'feature'::"text"])))
);


ALTER TABLE "public"."feedback_items" OWNER TO "postgres";


ALTER TABLE "public"."feedback_items" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."feedback_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."fmd_tools" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "url" "text",
    "owner" "text",
    "status" "text" DEFAULT 'missing_link'::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_curated" boolean DEFAULT false NOT NULL,
    "preview_image_url" "text",
    "preview_image_source" "text" DEFAULT 'none'::"text" NOT NULL,
    CONSTRAINT "fmd_tools_category_check" CHECK (("category" = ANY (ARRAY['tool'::"text", 'repo'::"text", 'knowledge'::"text", 'asset'::"text"]))),
    CONSTRAINT "fmd_tools_preview_image_source_check" CHECK (("preview_image_source" = ANY (ARRAY['none'::"text", 'og'::"text", 'manual'::"text"]))),
    CONSTRAINT "fmd_tools_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'planned'::"text", 'missing_link'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."fmd_tools" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."founder_events" (
    "id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "category" "text" DEFAULT 'other'::"text" NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone,
    "location" "text" DEFAULT ''::"text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "audience_mode" "text" DEFAULT 'all'::"text" NOT NULL,
    "participant_profile_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "reminder_days_before" integer DEFAULT 7 NOT NULL,
    "reminder_generated_at" timestamp with time zone,
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "founder_events_audience_mode_check" CHECK (("audience_mode" = ANY (ARRAY['all'::"text", 'selected'::"text"]))),
    CONSTRAINT "founder_events_category_check" CHECK (("category" = ANY (ARRAY['conference'::"text", 'legal'::"text", 'company'::"text", 'travel'::"text", 'deadline'::"text", 'other'::"text"]))),
    CONSTRAINT "founder_events_end_after_start" CHECK ((("ends_at" IS NULL) OR ("ends_at" >= "starts_at"))),
    CONSTRAINT "founder_events_participant_profile_ids_no_null" CHECK (("array_position"("participant_profile_ids", NULL::"text") IS NULL)),
    CONSTRAINT "founder_events_reminder_days_before_check" CHECK ((("reminder_days_before" >= 0) AND ("reminder_days_before" <= 90))),
    CONSTRAINT "founder_events_selected_has_participants" CHECK ((("audience_mode" = 'all'::"text") OR ("cardinality"("participant_profile_ids") > 0))),
    CONSTRAINT "founder_events_status_check" CHECK (("status" = ANY (ARRAY['planned'::"text", 'done'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."founder_events" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."founder_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."founder_events_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."founder_events_id_seq" OWNED BY "public"."founder_events"."id";



CREATE TABLE IF NOT EXISTS "public"."founder_sprint_scores" (
    "id" bigint NOT NULL,
    "sprint_id" "text" NOT NULL,
    "profile_id" "text" NOT NULL,
    "delivery_points" integer DEFAULT 0 NOT NULL,
    "form_points" integer DEFAULT 0 NOT NULL,
    "weekly_points" integer DEFAULT 0 NOT NULL,
    "total_points" integer DEFAULT 0 NOT NULL,
    "fulfilled" boolean DEFAULT false NOT NULL,
    "away_neutral" boolean DEFAULT false NOT NULL,
    "finalized_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finalized_by" "text",
    "reason_summary" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "founder_sprint_scores_delivery_points_check" CHECK ((("delivery_points" >= 0) AND ("delivery_points" <= 12))),
    CONSTRAINT "founder_sprint_scores_form_points_check" CHECK ((("form_points" >= 0) AND ("form_points" <= 4))),
    CONSTRAINT "founder_sprint_scores_total_points_check" CHECK ((("total_points" >= 0) AND ("total_points" <= 20))),
    CONSTRAINT "founder_sprint_scores_weekly_points_check" CHECK ((("weekly_points" >= 0) AND ("weekly_points" <= 4)))
);


ALTER TABLE "public"."founder_sprint_scores" OWNER TO "postgres";


COMMENT ON TABLE "public"."founder_sprint_scores" IS 'FounderOps v2.1 locked 20-point sprint score: Delivery 12, Form/Review 4, Weekly 4.';



ALTER TABLE "public"."founder_sprint_scores" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."founder_sprint_scores_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."founder_strike_state" (
    "id" bigint NOT NULL,
    "profile_id" "text" NOT NULL,
    "strike_level" integer DEFAULT 0 NOT NULL,
    "fulfilled_reset_streak" integer DEFAULT 0 NOT NULL,
    "last_evaluated_sprint_id" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "founder_strike_state_fulfilled_reset_streak_check" CHECK (("fulfilled_reset_streak" >= 0)),
    CONSTRAINT "founder_strike_state_strike_level_check" CHECK ((("strike_level" >= 0) AND ("strike_level" <= 3)))
);


ALTER TABLE "public"."founder_strike_state" OWNER TO "postgres";


COMMENT ON TABLE "public"."founder_strike_state" IS 'Current FounderOps v2.1 strike level and reset streak per founder.';



ALTER TABLE "public"."founder_strike_state" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."founder_strike_state_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."github_app_user_tokens" (
    "profile_id" "text" NOT NULL,
    "github_login" "text" NOT NULL,
    "github_user_id" bigint,
    "encrypted_access_token" "text" NOT NULL,
    "encrypted_refresh_token" "text",
    "access_token_expires_at" timestamp with time zone,
    "refresh_token_expires_at" timestamp with time zone,
    "connected_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "refreshed_at" timestamp with time zone,
    "last_used_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "last_error" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."github_app_user_tokens" OWNER TO "postgres";


COMMENT ON TABLE "public"."github_app_user_tokens" IS 'Encrypted GitHub App user token vault. Access is service-role only; never expose raw token columns to browser clients.';



CREATE TABLE IF NOT EXISTS "public"."github_issue_sync_locks" (
    "resource_key" "text" NOT NULL,
    "task_id" "text",
    "locked_by_profile_id" "text",
    "lock_token" "uuid" NOT NULL,
    "locked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "github_issue_sync_locks_expires_after_locked" CHECK (("expires_at" > "locked_at")),
    CONSTRAINT "github_issue_sync_locks_resource_key_present" CHECK (("length"(TRIM(BOTH FROM "resource_key")) > 0))
);


ALTER TABLE "public"."github_issue_sync_locks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."github_webhook_deliveries" (
    "delivery_id" "text" NOT NULL,
    "event_name" "text" NOT NULL,
    "action" "text" NOT NULL,
    "installation_id" bigint NOT NULL,
    "repository_id" bigint NOT NULL,
    "repository_full_name" "text" NOT NULL,
    "issue_id" bigint NOT NULL,
    "issue_node_id" "text" NOT NULL,
    "issue_number" integer NOT NULL,
    "issue_updated_at" timestamp with time zone NOT NULL,
    "sender_id" bigint,
    "sender_login" "text",
    "payload_sha256" "text" NOT NULL,
    "status" "text" DEFAULT 'received'::"text" NOT NULL,
    "processing_version" integer DEFAULT 1 NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "available_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "locked_at" timestamp with time zone,
    "lock_token" "uuid",
    "processed_at" timestamp with time zone,
    "last_error" "text",
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "comment_id" bigint,
    "comment_node_id" "text",
    "comment_updated_at" timestamp with time zone,
    "status_reason" "text",
    "archived_at" timestamp with time zone,
    "archive_reason" "text",
    CONSTRAINT "github_webhook_deliveries_action_check" CHECK (((NULLIF(TRIM(BOTH FROM "action"), ''::"text") IS NOT NULL) AND ("length"("action") <= 64))),
    CONSTRAINT "github_webhook_deliveries_archive_check" CHECK (((("archived_at" IS NULL) AND ("archive_reason" IS NULL)) OR (("archived_at" IS NOT NULL) AND (NULLIF(TRIM(BOTH FROM "archive_reason"), ''::"text") IS NOT NULL) AND ("length"("archive_reason") <= 120)))),
    CONSTRAINT "github_webhook_deliveries_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "github_webhook_deliveries_comment_metadata_check" CHECK (((("event_name" = 'issue_comment'::"text") AND ("comment_id" IS NOT NULL) AND ("comment_id" > 0) AND (NULLIF(TRIM(BOTH FROM "comment_node_id"), ''::"text") IS NOT NULL) AND ("length"("comment_node_id") <= 255) AND ("comment_updated_at" IS NOT NULL)) OR (("event_name" <> 'issue_comment'::"text") AND ("comment_id" IS NULL) AND ("comment_node_id" IS NULL) AND ("comment_updated_at" IS NULL)))),
    CONSTRAINT "github_webhook_deliveries_delivery_id_check" CHECK (((NULLIF(TRIM(BOTH FROM "delivery_id"), ''::"text") IS NOT NULL) AND ("length"("delivery_id") <= 128))),
    CONSTRAINT "github_webhook_deliveries_event_name_check" CHECK (((NULLIF(TRIM(BOTH FROM "event_name"), ''::"text") IS NOT NULL) AND ("length"("event_name") <= 64))),
    CONSTRAINT "github_webhook_deliveries_installation_id_check" CHECK (("installation_id" > 0)),
    CONSTRAINT "github_webhook_deliveries_issue_id_check" CHECK (("issue_id" > 0)),
    CONSTRAINT "github_webhook_deliveries_issue_node_id_check" CHECK (((NULLIF(TRIM(BOTH FROM "issue_node_id"), ''::"text") IS NOT NULL) AND ("length"("issue_node_id") <= 255))),
    CONSTRAINT "github_webhook_deliveries_issue_number_check" CHECK (("issue_number" > 0)),
    CONSTRAINT "github_webhook_deliveries_lock_check" CHECK (((("status" = 'processing'::"text") AND ("locked_at" IS NOT NULL) AND ("lock_token" IS NOT NULL)) OR (("status" <> 'processing'::"text") AND ("locked_at" IS NULL) AND ("lock_token" IS NULL)))),
    CONSTRAINT "github_webhook_deliveries_payload_sha256_check" CHECK (("payload_sha256" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "github_webhook_deliveries_processed_check" CHECK (((("status" = 'processed'::"text") AND ("processed_at" IS NOT NULL)) OR (("status" <> 'processed'::"text") AND ("processed_at" IS NULL)))),
    CONSTRAINT "github_webhook_deliveries_processing_version_check" CHECK (("processing_version" >= 1)),
    CONSTRAINT "github_webhook_deliveries_repository_check" CHECK (((NULLIF(TRIM(BOTH FROM "repository_full_name"), ''::"text") IS NOT NULL) AND ("length"("repository_full_name") <= 255))),
    CONSTRAINT "github_webhook_deliveries_repository_id_check" CHECK (("repository_id" > 0)),
    CONSTRAINT "github_webhook_deliveries_sender_id_check" CHECK ((("sender_id" IS NULL) OR ("sender_id" > 0))),
    CONSTRAINT "github_webhook_deliveries_sender_login_check" CHECK ((("sender_login" IS NULL) OR ((NULLIF(TRIM(BOTH FROM "sender_login"), ''::"text") IS NOT NULL) AND ("length"("sender_login") <= 255)))),
    CONSTRAINT "github_webhook_deliveries_status_check" CHECK (("status" = ANY (ARRAY['received'::"text", 'processing'::"text", 'retry_scheduled'::"text", 'processed'::"text", 'ignored'::"text", 'failed'::"text"]))),
    CONSTRAINT "github_webhook_deliveries_status_reason_check" CHECK ((("status_reason" IS NULL) OR ((NULLIF(TRIM(BOTH FROM "status_reason"), ''::"text") IS NOT NULL) AND ("length"("status_reason") <= 128))))
);


ALTER TABLE "public"."github_webhook_deliveries" OWNER TO "postgres";


COMMENT ON TABLE "public"."github_webhook_deliveries" IS 'Verified GitHub Issue and Issue comment webhook delivery journal. Stores normalized trigger metadata and a payload hash, but no Issue or comment content.';



COMMENT ON COLUMN "public"."github_webhook_deliveries"."status" IS 'Receipt and future projection-processing state. Receipt does not mutate FounderOps planning fields.';



COMMENT ON COLUMN "public"."github_webhook_deliveries"."comment_id" IS 'Stable GitHub Issue comment identifier for issue_comment deliveries; null for other events.';



COMMENT ON COLUMN "public"."github_webhook_deliveries"."comment_node_id" IS 'Stable GitHub Issue comment node identifier for issue_comment deliveries; null for other events.';



COMMENT ON COLUMN "public"."github_webhook_deliveries"."comment_updated_at" IS 'GitHub Issue comment timestamp observed in the verified issue_comment delivery; null for other events.';



COMMENT ON COLUMN "public"."github_webhook_deliveries"."status_reason" IS 'Stable processor outcome or retry reason without payload or credential data.';



COMMENT ON COLUMN "public"."github_webhook_deliveries"."archived_at" IS 'Operator acknowledgement timestamp for an unreplayable terminal delivery. The failed delivery metadata remains retained.';



COMMENT ON COLUMN "public"."github_webhook_deliveries"."archive_reason" IS 'Stable operator acknowledgement reason for an archived terminal delivery.';



CREATE TABLE IF NOT EXISTS "public"."google_workspace_connections" (
    "profile_id" "text" NOT NULL,
    "encrypted_access_token" "text" NOT NULL,
    "encrypted_refresh_token" "text" NOT NULL,
    "access_token_expires_at" timestamp with time zone NOT NULL,
    "refresh_token_expires_at" timestamp with time zone,
    "oauth_scopes" "text"[] DEFAULT ARRAY['https://www.googleapis.com/auth/calendar.events.owned'::"text"] NOT NULL,
    "token_type" "text" DEFAULT 'Bearer'::"text" NOT NULL,
    "primary_calendar_id" "text" DEFAULT 'primary'::"text" NOT NULL,
    "connected_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "refreshed_at" timestamp with time zone,
    "last_used_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "last_error_class" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "google_workspace_connections_access_token_encrypted" CHECK (("encrypted_access_token" ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'::"text")),
    CONSTRAINT "google_workspace_connections_bearer_only" CHECK (("lower"("token_type") = 'bearer'::"text")),
    CONSTRAINT "google_workspace_connections_error_class_bounded" CHECK ((("last_error_class" IS NULL) OR ("last_error_class" = ANY (ARRAY['oauth_reconnect_required'::"text", 'oauth_provider_unavailable'::"text", 'oauth_scope_mismatch'::"text", 'oauth_storage_failed'::"text"])))),
    CONSTRAINT "google_workspace_connections_primary_calendar_only" CHECK (("primary_calendar_id" = 'primary'::"text")),
    CONSTRAINT "google_workspace_connections_refresh_token_encrypted" CHECK (("encrypted_refresh_token" ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'::"text")),
    CONSTRAINT "google_workspace_connections_scope_limited" CHECK (("oauth_scopes" = ARRAY['https://www.googleapis.com/auth/calendar.events.owned'::"text"]))
);


ALTER TABLE "public"."google_workspace_connections" OWNER TO "postgres";


COMMENT ON TABLE "public"."google_workspace_connections" IS 'Encrypted Google Workspace OAuth token vault. Access is service-role only; browser and user-credential paths must not expose token columns.';



CREATE TABLE IF NOT EXISTS "public"."google_workspace_disconnect_operations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_profile_id" "text" NOT NULL,
    "requested_by" "text" NOT NULL,
    "revoke_connection" boolean NOT NULL,
    "cutoff_date" "date" NOT NULL,
    "state" "text" DEFAULT 'cleaning'::"text" NOT NULL,
    "revision" integer DEFAULT 1 NOT NULL,
    "retained_version_id" "uuid",
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deactivated_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "last_error_class" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "google_workspace_disconnect_operations_consistent" CHECK (((("state" = ANY (ARRAY['cleaning'::"text", 'cleanup_pending'::"text"])) AND ("completed_at" IS NULL)) OR (("state" = 'revoke_pending'::"text") AND "revoke_connection" AND ("deactivated_at" IS NOT NULL) AND ("completed_at" IS NULL)) OR (("state" = 'completed'::"text") AND ("deactivated_at" IS NOT NULL) AND ("completed_at" IS NOT NULL)))),
    CONSTRAINT "google_workspace_disconnect_operations_request" CHECK (("requested_by" = ANY (ARRAY['owner'::"text", 'external_revocation'::"text"]))),
    CONSTRAINT "google_workspace_disconnect_operations_revision" CHECK (("revision" > 0)),
    CONSTRAINT "google_workspace_disconnect_operations_state" CHECK (("state" = ANY (ARRAY['cleaning'::"text", 'cleanup_pending'::"text", 'revoke_pending'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."google_workspace_disconnect_operations" OWNER TO "postgres";


COMMENT ON TABLE "public"."google_workspace_disconnect_operations" IS 'Service-only durable workflow for removing future FounderOps calendar projection before or after a Google disconnect.';



CREATE TABLE IF NOT EXISTS "public"."google_workspace_disconnect_series" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "operation_id" "uuid" NOT NULL,
    "series_id" "uuid" NOT NULL,
    "calendar_id" "text" DEFAULT 'primary'::"text" NOT NULL,
    "google_event_id" "text" NOT NULL,
    "expected_etag" "text" NOT NULL,
    "expected_founderops_revision" integer NOT NULL,
    "cleanup_action" "text" NOT NULL,
    "recurrence_count" integer,
    "state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "confirmed_etag" "text",
    "last_error_class" "text",
    "last_observed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "google_workspace_disconnect_series_action" CHECK (((("cleanup_action" = 'delete'::"text") AND ("recurrence_count" IS NULL)) OR (("cleanup_action" = 'truncate'::"text") AND ("recurrence_count" > 0)))),
    CONSTRAINT "google_workspace_disconnect_series_calendar" CHECK (("calendar_id" = 'primary'::"text")),
    CONSTRAINT "google_workspace_disconnect_series_identity" CHECK (("google_event_id" ~ '^[a-v0-9]+$'::"text")),
    CONSTRAINT "google_workspace_disconnect_series_state" CHECK (("state" = ANY (ARRAY['pending'::"text", 'confirmed'::"text"])))
);


ALTER TABLE "public"."google_workspace_disconnect_series" OWNER TO "postgres";


COMMENT ON TABLE "public"."google_workspace_disconnect_series" IS 'Service-only exact Google series targets for a disconnect cleanup. Provider identifiers never reach browser clients.';



CREATE TABLE IF NOT EXISTS "public"."meeting_attendance" (
    "id" bigint NOT NULL,
    "meeting_id" bigint NOT NULL,
    "profile_id" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "absence_reason" "text",
    "reason_accepted" boolean DEFAULT false NOT NULL,
    "written_update" "text",
    "points" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "meeting_attendance_points_check" CHECK ((("points" >= 0) AND ("points" <= 4))),
    CONSTRAINT "meeting_attendance_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'present'::"text", 'excused'::"text", 'late_excused'::"text", 'unexcused'::"text", 'no_show'::"text"])))
);


ALTER TABLE "public"."meeting_attendance" OWNER TO "postgres";


ALTER TABLE "public"."meeting_attendance" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."meeting_attendance_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."meetings" (
    "id" bigint NOT NULL,
    "sprint_id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "meeting_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "agenda" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "duration_minutes" integer DEFAULT 60 NOT NULL,
    "google_calendar_id" "text",
    "google_calendar_event_id" "text",
    "google_calendar_html_link" "text",
    "google_calendar_sync_status" "text" DEFAULT 'not_synced'::"text" NOT NULL,
    "google_calendar_sync_error" "text" DEFAULT ''::"text" NOT NULL,
    "google_calendar_synced_at" timestamp with time zone,
    CONSTRAINT "meetings_duration_minutes_check" CHECK ((("duration_minutes" >= 15) AND ("duration_minutes" <= 480))),
    CONSTRAINT "meetings_google_calendar_sync_status_check" CHECK (("google_calendar_sync_status" = ANY (ARRAY['not_synced'::"text", 'synced'::"text", 'skipped'::"text", 'failed'::"text"]))),
    CONSTRAINT "meetings_status_check" CHECK (("status" = ANY (ARRAY['planned'::"text", 'done'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."meetings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."meetings"."duration_minutes" IS 'Meeting duration in minutes, 15 to 480, used by the Meeting Finder and Google Calendar export.';



COMMENT ON COLUMN "public"."meetings"."google_calendar_id" IS 'Organizer calendar email where the event was created.';



COMMENT ON COLUMN "public"."meetings"."google_calendar_event_id" IS 'Google Calendar event id for the synced app meeting.';



COMMENT ON COLUMN "public"."meetings"."google_calendar_sync_status" IS 'Last Google Calendar write attempt for this app-owned meeting.';



ALTER TABLE "public"."meetings" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."meetings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."notification_deliveries" (
    "id" bigint NOT NULL,
    "event_id" bigint NOT NULL,
    "channel" "text" DEFAULT 'google_chat'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "delivered_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "target" "text",
    "payload" "jsonb",
    CONSTRAINT "notification_deliveries_channel_check" CHECK (("channel" = ANY (ARRAY['google_chat'::"text", 'in_app'::"text", 'github'::"text"]))),
    CONSTRAINT "notification_deliveries_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."notification_deliveries" OWNER TO "postgres";


ALTER TABLE "public"."notification_deliveries" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."notification_deliveries_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."notification_events" (
    "id" bigint NOT NULL,
    "type" "text" NOT NULL,
    "actor_profile_id" "text",
    "recipient_profile_id" "text",
    "entity_type" "text" NOT NULL,
    "entity_id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dedupe_key" "text",
    "seen_at" timestamp with time zone,
    "dismissed_at" timestamp with time zone,
    "resolved_at" timestamp with time zone,
    "resolution_reason" "text",
    "actor_label" "text",
    "target_path" "text",
    CONSTRAINT "notification_events_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text", 'dismissed'::"text", 'resolved'::"text"])))
);


ALTER TABLE "public"."notification_events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."notification_events"."seen_at" IS 'Set when the recipient opens an in-app notification; the notification remains open.';



COMMENT ON COLUMN "public"."notification_events"."dismissed_at" IS 'Set when the recipient explicitly closes an in-app notification.';



COMMENT ON COLUMN "public"."notification_events"."resolved_at" IS 'Set by system reconciliation when the source condition is no longer relevant.';



COMMENT ON COLUMN "public"."notification_events"."resolution_reason" IS 'Stable system reason explaining why reconciliation resolved the notification.';



COMMENT ON COLUMN "public"."notification_events"."actor_label" IS 'Trusted display label for an external actor that has no FounderOps profile.';



COMMENT ON COLUMN "public"."notification_events"."target_path" IS 'Optional internal relative path for opening the exact notification target.';



ALTER TABLE "public"."notification_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."notification_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."notification_preferences" (
    "id" bigint NOT NULL,
    "profile_id" "text" NOT NULL,
    "channel" "text" DEFAULT 'google_chat'::"text" NOT NULL,
    "event_type" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notification_preferences_channel_check" CHECK (("channel" = ANY (ARRAY['google_chat'::"text", 'in_app'::"text", 'github'::"text"])))
);


ALTER TABLE "public"."notification_preferences" OWNER TO "postgres";


ALTER TABLE "public"."notification_preferences" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."notification_preferences_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."planning_item_historical_links" (
    "item_type" "text" NOT NULL,
    "historical_id" "text" NOT NULL,
    "task_id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_snapshot" "jsonb" NOT NULL,
    CONSTRAINT "planning_item_historical_links_item_type_check" CHECK (("item_type" = ANY (ARRAY['epic'::"text", 'initiative'::"text"])))
);


ALTER TABLE "public"."planning_item_historical_links" OWNER TO "postgres";


COMMENT ON TABLE "public"."planning_item_historical_links" IS 'Historical app URL mappings and immutable legacy source snapshots retained independently of canonical item retention after the Planning hierarchy cutover.';



CREATE TABLE IF NOT EXISTS "public"."planning_item_raci_assignments" (
    "task_id" "text" NOT NULL,
    "profile_id" "text" NOT NULL,
    "role" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "planning_item_raci_assignments_role_check" CHECK (("role" = ANY (ARRAY['accountable'::"text", 'responsible'::"text", 'consulted'::"text", 'informed'::"text"]))),
    CONSTRAINT "planning_item_raci_assignments_sort_order_check" CHECK (("sort_order" >= 0))
);


ALTER TABLE "public"."planning_item_raci_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."planning_item_strategy" (
    "task_id" "text" NOT NULL,
    "goal" "text" DEFAULT ''::"text" NOT NULL,
    "success_criteria" "text" DEFAULT ''::"text" NOT NULL,
    "scope_constraints" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."planning_item_strategy" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_releases" (
    "version" "text" NOT NULL,
    "schema_version" integer NOT NULL,
    "summary" "text" NOT NULL,
    "published_at" timestamp with time zone NOT NULL,
    "plan_digest" "text" NOT NULL,
    "content_digest" "text" NOT NULL,
    "manifest_digest" "text" NOT NULL,
    "manifest" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "platform_releases_content_digest_check" CHECK (("content_digest" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "platform_releases_manifest_digest_check" CHECK (("manifest_digest" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "platform_releases_manifest_identity_check" CHECK (((("manifest" ->> 'version'::"text") = "version") AND ((("manifest" ->> 'schemaVersion'::"text"))::integer = "schema_version") AND (("manifest" ->> 'manifestDigest'::"text") = "manifest_digest"))),
    CONSTRAINT "platform_releases_manifest_object_check" CHECK (("jsonb_typeof"("manifest") = 'object'::"text")),
    CONSTRAINT "platform_releases_plan_digest_check" CHECK (("plan_digest" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "platform_releases_schema_version_check" CHECK (("schema_version" = ANY (ARRAY[2, 3]))),
    CONSTRAINT "platform_releases_summary_check" CHECK ((("length"(TRIM(BOTH FROM "summary")) >= 1) AND ("length"(TRIM(BOTH FROM "summary")) <= 1000))),
    CONSTRAINT "platform_releases_version_check" CHECK (("version" ~ '^v[0-9]+\.[0-9]+\.[0-9]+$'::"text"))
);


ALTER TABLE "public"."platform_releases" OWNER TO "postgres";


COMMENT ON TABLE "public"."platform_releases" IS 'Immutable application and platform release manifests received from the protected release runner.';



COMMENT ON COLUMN "public"."platform_releases"."manifest" IS 'Exact validated Manifest v2 or v3 payload. Planning relationships are derived at read time.';



CREATE TABLE IF NOT EXISTS "public"."profile_feature_tour_acknowledgements" (
    "profile_id" "text" NOT NULL,
    "tour_id" "text" NOT NULL,
    "seen_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profile_feature_tour_acknowledgements" OWNER TO "postgres";


COMMENT ON TABLE "public"."profile_feature_tour_acknowledgements" IS 'Per-profile acknowledgements for code-defined feature tours.';



CREATE TABLE IF NOT EXISTS "public"."profile_ui_preferences" (
    "profile_id" "text" NOT NULL,
    "default_workspace" "text" DEFAULT 'planning'::"text" NOT NULL,
    "default_task_view" "text" DEFAULT 'board'::"text" NOT NULL,
    "planning_filters" "jsonb" DEFAULT '{"risk": "Alle", "sort": "priority", "query": "", "quick": [], "review": "Alle", "status": "Alle", "assignee": "Alle", "priority": "Alle", "sprintId": "Alle", "targetTo": "", "direction": "asc", "targetFrom": "", "workstream": "Alle", "initiativeId": "Alle"}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expanded_item_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    CONSTRAINT "profile_ui_preferences_default_task_view_check" CHECK (("default_task_view" = ANY (ARRAY['board'::"text", 'structure'::"text", 'table'::"text", 'gantt'::"text"]))),
    CONSTRAINT "profile_ui_preferences_default_workspace_check" CHECK (("default_workspace" = ANY (ARRAY['planning'::"text", 'backlog'::"text", 'events'::"text", 'sprint'::"text", 'projects'::"text", 'tools'::"text", 'team'::"text", 'notifications'::"text", 'profile'::"text"])))
);


ALTER TABLE "public"."profile_ui_preferences" OWNER TO "postgres";


COMMENT ON TABLE "public"."profile_ui_preferences" IS 'Per-profile planning UI defaults. Users write only their own preferences.';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "text" NOT NULL,
    "auth_user_id" "uuid",
    "name" "text" NOT NULL,
    "role" "text" NOT NULL,
    "focus" "text",
    "weekly_capacity" integer DEFAULT 6 NOT NULL,
    "github_login" "text",
    "platform_role" "text" DEFAULT 'founder'::"text" NOT NULL,
    "org_role" "text",
    "deputy_for" "text",
    "deputy_active_from" timestamp with time zone,
    "deputy_active_until" timestamp with time zone,
    "google_chat_user_id" "text",
    "google_chat_dm_space" "text",
    "notifications_enabled" boolean DEFAULT true NOT NULL,
    "profile_color" "text" DEFAULT '#64748b'::"text" NOT NULL,
    "google_calendar_email" "text",
    "google_calendar_sync_enabled" boolean DEFAULT false NOT NULL,
    "google_calendar_last_synced_at" timestamp with time zone,
    CONSTRAINT "profiles_platform_role_check" CHECK (("platform_role" = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text", 'viewer'::"text"]))),
    CONSTRAINT "profiles_profile_color_hex" CHECK (("profile_color" ~ '^#[0-9A-Fa-f]{6}$'::"text")),
    CONSTRAINT "profiles_profile_color_palette" CHECK (("profile_color" = ANY ("public"."profile_color_palette"()))),
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'member'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."google_calendar_email" IS 'Google Workspace calendar email used by the Meeting Finder import.';



COMMENT ON COLUMN "public"."profiles"."google_calendar_sync_enabled" IS 'Controls whether this profile is included in the Google Calendar busy-block import.';



COMMENT ON COLUMN "public"."profiles"."google_calendar_last_synced_at" IS 'Last successful Meeting Finder calendar import timestamp for this profile.';



CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "range_label" "text",
    "review_objection_window_hours" integer DEFAULT 48 NOT NULL,
    "github_project_owner" "text" DEFAULT 'findmydoc-platform'::"text" NOT NULL,
    "github_project_number" integer DEFAULT 21 NOT NULL,
    CONSTRAINT "projects_github_project_number_check" CHECK (("github_project_number" > 0)),
    CONSTRAINT "projects_github_project_owner_check" CHECK ((("github_project_owner" = TRIM(BOTH FROM "github_project_owner")) AND ("github_project_owner" ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'::"text"))),
    CONSTRAINT "projects_review_objection_window_hours_check" CHECK ((("review_objection_window_hours" >= 1) AND ("review_objection_window_hours" <= 336)))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


COMMENT ON COLUMN "public"."projects"."review_objection_window_hours" IS 'CEO-managed combined review and score-objection window in exact hours after the sprint day ends in Europe/Berlin.';



COMMENT ON COLUMN "public"."projects"."github_project_owner" IS 'GitHub organization that owns the Project V2 receiving FounderOps-synced issues.';



COMMENT ON COLUMN "public"."projects"."github_project_number" IS 'GitHub Project V2 number receiving FounderOps-synced issues.';



CREATE TABLE IF NOT EXISTS "public"."score_objections" (
    "id" bigint NOT NULL,
    "sprint_id" "text" NOT NULL,
    "profile_id" "text" NOT NULL,
    "founder_sprint_score_id" bigint,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "comment" "text" NOT NULL,
    "resolution_comment" "text" DEFAULT ''::"text" NOT NULL,
    "reviewed_by" "text",
    "reviewed_at" timestamp with time zone,
    "second_reviewer_profile_id" "text",
    "second_review_decision" "text",
    "second_reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_delivery_points" integer,
    "resolved_form_points" integer,
    "resolved_weekly_points" integer,
    CONSTRAINT "score_objections_resolved_delivery_points_check" CHECK ((("resolved_delivery_points" >= 0) AND ("resolved_delivery_points" <= 12))),
    CONSTRAINT "score_objections_resolved_form_points_check" CHECK ((("resolved_form_points" >= 0) AND ("resolved_form_points" <= 4))),
    CONSTRAINT "score_objections_resolved_weekly_points_check" CHECK ((("resolved_weekly_points" >= 0) AND ("resolved_weekly_points" <= 4))),
    CONSTRAINT "score_objections_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'reviewed'::"text", 'dismissed'::"text", 'accepted'::"text"])))
);


ALTER TABLE "public"."score_objections" OWNER TO "postgres";


COMMENT ON TABLE "public"."score_objections" IS 'Founder score objections and optional one-time second review.';



ALTER TABLE "public"."score_objections" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."score_objections_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sprint_commitments" (
    "id" bigint NOT NULL,
    "sprint_id" "text" NOT NULL,
    "profile_id" "text" NOT NULL,
    "commitment_level" "text" DEFAULT 'Standard'::"text" NOT NULL,
    "weekly_hours" integer DEFAULT 0 NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sprint_commitments_commitment_level_check" CHECK (("commitment_level" = ANY (ARRAY['Lite'::"text", 'Standard'::"text", 'Heavy'::"text", 'Away'::"text"]))),
    CONSTRAINT "sprint_commitments_weekly_hours_check" CHECK ((("weekly_hours" >= 0) AND ("weekly_hours" <= 80)))
);


ALTER TABLE "public"."sprint_commitments" OWNER TO "postgres";


ALTER TABLE "public"."sprint_commitments" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."sprint_commitments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sprints" (
    "id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'planning'::"text" NOT NULL,
    "start_date" "date",
    "end_date" "date",
    "score_locked" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "review_due_at" timestamp with time zone,
    "lock_result" "jsonb",
    CONSTRAINT "sprints_status_check" CHECK (("status" = ANY (ARRAY['planning'::"text", 'active'::"text", 'review'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."sprints" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."strike_events" (
    "id" bigint NOT NULL,
    "profile_id" "text" NOT NULL,
    "sprint_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "previous_strike_level" integer DEFAULT 0 NOT NULL,
    "next_strike_level" integer DEFAULT 0 NOT NULL,
    "reason" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "text",
    CONSTRAINT "strike_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['strike_added'::"text", 'strike_reset'::"text", 'away_neutral'::"text", 'fulfilled_no_change'::"text", 'governance_review_required'::"text"]))),
    CONSTRAINT "strike_events_next_strike_level_check" CHECK ((("next_strike_level" >= 0) AND ("next_strike_level" <= 3))),
    CONSTRAINT "strike_events_previous_strike_level_check" CHECK ((("previous_strike_level" >= 0) AND ("previous_strike_level" <= 3)))
);


ALTER TABLE "public"."strike_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."strike_events" IS 'Append-only FounderOps v2.1 strike and governance-review history.';



ALTER TABLE "public"."strike_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."strike_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE OR REPLACE VIEW "public"."task_activity" WITH ("security_invoker"='true') AS
 SELECT "id",
    "entity_id" AS "task_id",
    COALESCE(("after_data" ->> 'message'::"text"), "action") AS "message",
    "created_at"
   FROM "public"."audit_log" "audit"
  WHERE ("entity_type" = 'task'::"text");


ALTER VIEW "public"."task_activity" OWNER TO "postgres";


COMMENT ON VIEW "public"."task_activity" IS 'Temporary write compatibility view. Task timeline reads use structured audit_log rows directly.';



CREATE OR REPLACE VIEW "public"."task_audit_timeline" WITH ("security_invoker"='true') AS
 SELECT "id",
    "entity_id" AS "task_id",
    "action",
    "actor_profile_id",
    COALESCE(("after_data" ->> 'message'::"text"), ''::"text") AS "message",
    "jsonb_strip_nulls"("jsonb_build_object"('filename', ("after_data" -> 'filename'::"text"), 'note', ("after_data" -> 'note'::"text"), 'relationType', COALESCE(("after_data" -> 'relationType'::"text"), ("before_data" -> 'relation_type'::"text")), 'relatedTaskId', COALESCE(("after_data" -> 'relatedTaskId'::"text"), ("before_data" -> 'related_task_id'::"text")))) AS "payload",
    "created_at"
   FROM "public"."audit_log" "audit"
  WHERE ("entity_type" = 'task'::"text");


ALTER VIEW "public"."task_audit_timeline" OWNER TO "postgres";


COMMENT ON VIEW "public"."task_audit_timeline" IS 'Small user-facing task timeline projection that avoids transferring complete audit snapshots.';



CREATE TABLE IF NOT EXISTS "public"."task_blockers" (
    "id" bigint NOT NULL,
    "task_id" "text" NOT NULL,
    "profile_id" "text",
    "reason" "text" NOT NULL,
    "impact" "text",
    "needs_help_from" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    CONSTRAINT "task_blockers_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'resolved'::"text", 'accepted_carryover'::"text"])))
);


ALTER TABLE "public"."task_blockers" OWNER TO "postgres";


ALTER TABLE "public"."task_blockers" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."task_blockers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."task_comment_github_deliveries" (
    "task_comment_id" bigint NOT NULL,
    "task_id" "text" NOT NULL,
    "author_profile_id" "text",
    "github_issue_number" integer,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "status_reason" "text",
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_attempted_at" timestamp with time zone,
    "next_attempt_at" timestamp with time zone,
    "github_comment_id" bigint,
    "github_comment_url" "text",
    "locked_at" timestamp with time zone,
    "lock_token" "text",
    "last_error" "text",
    "delivered_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "task_comment_github_deliveries_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "task_comment_github_deliveries_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'waiting_for_issue'::"text", 'waiting_for_author_connection'::"text", 'processing'::"text", 'retry_scheduled'::"text", 'delivered'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."task_comment_github_deliveries" OWNER TO "postgres";


COMMENT ON TABLE "public"."task_comment_github_deliveries" IS 'Transactional outbox for author-attributed GitHub comments. Tokens never leave the server-side GitHub App vault.';



CREATE TABLE IF NOT EXISTS "public"."task_comments" (
    "id" bigint NOT NULL,
    "task_id" "text" NOT NULL,
    "profile_id" "text",
    "comment" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "github_delivery_applicable" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."task_comments" OWNER TO "postgres";


ALTER TABLE "public"."task_comments" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."task_comments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."task_deletion_operations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "text" NOT NULL,
    "status" "text" DEFAULT 'prepared'::"text" NOT NULL,
    "task_updated_at" timestamp with time zone NOT NULL,
    "task_snapshot" "jsonb" NOT NULL,
    "deleted_task_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "github_closed" boolean DEFAULT false NOT NULL,
    "actor_profile_id" "text",
    "request_ip" "text",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "task_snapshots" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "task_deletion_operations_status_check" CHECK (("status" = ANY (ARRAY['prepared'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."task_deletion_operations" OWNER TO "postgres";


COMMENT ON TABLE "public"."task_deletion_operations" IS 'Durable saga state for idempotent task deletion across GitHub and PostgreSQL.';



CREATE TABLE IF NOT EXISTS "public"."task_dependencies" (
    "id" bigint NOT NULL,
    "task_id" "text" NOT NULL,
    "note" "text" NOT NULL
);


ALTER TABLE "public"."task_dependencies" OWNER TO "postgres";


ALTER TABLE "public"."task_dependencies" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."task_dependencies_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."task_external_comments" (
    "id" bigint NOT NULL,
    "task_id" "text" NOT NULL,
    "source" "text" DEFAULT 'github'::"text" NOT NULL,
    "external_id" "text" NOT NULL,
    "author_login" "text" NOT NULL,
    "author_avatar_url" "text",
    "body" "text" NOT NULL,
    "html_url" "text",
    "created_at" timestamp with time zone NOT NULL,
    "imported_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "mention_recipient_profile_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "mention_recipients_initialized" boolean DEFAULT false NOT NULL,
    CONSTRAINT "task_external_comments_source_check" CHECK (("source" = 'github'::"text"))
);


ALTER TABLE "public"."task_external_comments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."task_external_comments"."source_updated_at" IS 'Last update timestamp reported by the external source.';



COMMENT ON COLUMN "public"."task_external_comments"."mention_recipient_profile_ids" IS 'FounderOps profile IDs resolved from the last accepted external comment snapshot.';



COMMENT ON COLUMN "public"."task_external_comments"."mention_recipients_initialized" IS 'Whether mention_recipient_profile_ids reflects an accepted post-migration snapshot.';



ALTER TABLE "public"."task_external_comments" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."task_external_comments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."task_focus_items" (
    "id" bigint NOT NULL,
    "profile_id" "text",
    "task_id" "text" NOT NULL,
    "focus_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "position" integer DEFAULT 1 NOT NULL,
    "next_step" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "task_focus_items_status_check" CHECK (("status" = ANY (ARRAY['planned'::"text", 'done'::"text", 'blocked'::"text", 'deferred'::"text", 'needs_decision'::"text"])))
);


ALTER TABLE "public"."task_focus_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."task_focus_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."task_focus_items_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."task_focus_items_id_seq" OWNED BY "public"."task_focus_items"."id";



CREATE TABLE IF NOT EXISTS "public"."task_intake_tokens" (
    "id" bigint NOT NULL,
    "profile_id" "text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "scopes" "text"[] DEFAULT ARRAY['task_context'::"text", 'task_intake'::"text"] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "task_intake_tokens_scopes_allowed" CHECK (("scopes" <@ ARRAY['task_context'::"text", 'task_intake'::"text"])),
    CONSTRAINT "task_intake_tokens_scopes_no_null" CHECK (("array_position"("scopes", NULL::"text") IS NULL)),
    CONSTRAINT "task_intake_tokens_token_hash_sha256" CHECK (("token_hash" ~ '^[a-f0-9]{64}$'::"text"))
);


ALTER TABLE "public"."task_intake_tokens" OWNER TO "postgres";


COMMENT ON TABLE "public"."task_intake_tokens" IS 'Hashed personal tokens for skill-based task context and team task intake.';



COMMENT ON COLUMN "public"."task_intake_tokens"."token_hash" IS 'SHA-256 hash of the one-time visible personal intake token.';



CREATE SEQUENCE IF NOT EXISTS "public"."task_intake_tokens_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."task_intake_tokens_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."task_intake_tokens_id_seq" OWNED BY "public"."task_intake_tokens"."id";



CREATE TABLE IF NOT EXISTS "public"."task_links" (
    "id" bigint NOT NULL,
    "task_id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "label" "text" NOT NULL,
    "url" "text" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "task_links_metadata_object_check" CHECK (("jsonb_typeof"("metadata") = 'object'::"text"))
);


ALTER TABLE "public"."task_links" OWNER TO "postgres";


COMMENT ON COLUMN "public"."task_links"."position" IS 'Stable zero-based display order within a task link type.';



COMMENT ON COLUMN "public"."task_links"."metadata" IS 'Provider-owned metadata for projected task links. Manual evidence URLs remain URL-only.';



ALTER TABLE "public"."task_links" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."task_links_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."task_notes" (
    "task_id" "text" NOT NULL,
    "note" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."task_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_relationship_edges" (
    "id" bigint NOT NULL,
    "task_id" "text" NOT NULL,
    "related_task_id" "text" NOT NULL,
    "relation_type" "text" NOT NULL,
    "note" "text",
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "task_relationship_edges_no_self_relation" CHECK (("task_id" <> "related_task_id")),
    CONSTRAINT "task_relationship_edges_relation_type_check" CHECK (("relation_type" = ANY (ARRAY['blocked_by'::"text", 'blocks'::"text", 'relates_to'::"text"])))
);


ALTER TABLE "public"."task_relationship_edges" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."task_relationship_edges_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."task_relationship_edges_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."task_relationship_edges_id_seq" OWNED BY "public"."task_relationship_edges"."id";



CREATE TABLE IF NOT EXISTS "public"."task_reviews" (
    "id" bigint NOT NULL,
    "task_id" "text" NOT NULL,
    "sprint_id" "text",
    "reviewer_profile_id" "text",
    "decision" "text" NOT NULL,
    "points" integer DEFAULT 0 NOT NULL,
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "checklist" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "task_reviews_decision_check" CHECK (("decision" = ANY (ARRAY['accepted'::"text", 'partial'::"text", 'changes_requested'::"text"])))
);


ALTER TABLE "public"."task_reviews" OWNER TO "postgres";


ALTER TABLE "public"."task_reviews" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."task_reviews_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."team_planning_item_delete_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token_id" "uuid" NOT NULL,
    "profile_id" "text" NOT NULL,
    "item_id" "text" NOT NULL,
    "expected_updated_at" timestamp with time zone NOT NULL,
    "idempotency_key" "uuid" NOT NULL,
    "request_hash" "text" NOT NULL,
    "response" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "contract_version" smallint DEFAULT 2 NOT NULL,
    CONSTRAINT "team_planning_item_delete_requests_contract_version_check" CHECK (("contract_version" = ANY (ARRAY[1, 2]))),
    CONSTRAINT "team_planning_item_delete_requests_request_hash_check" CHECK (("request_hash" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "team_planning_item_delete_requests_response_check" CHECK (("jsonb_typeof"("response") = 'object'::"text"))
);


ALTER TABLE "public"."team_planning_item_delete_requests" OWNER TO "postgres";


COMMENT ON TABLE "public"."team_planning_item_delete_requests" IS 'Immutable canonical Team Planning Item delete replay receipts.';



COMMENT ON COLUMN "public"."team_planning_item_delete_requests"."contract_version" IS 'Wire-contract version of the immutable delete replay snapshot.';



CREATE TABLE IF NOT EXISTS "public"."team_planning_item_update_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token_id" "uuid" NOT NULL,
    "profile_id" "text" NOT NULL,
    "item_type" "text" NOT NULL,
    "item_id" "text" NOT NULL,
    "expected_updated_at" timestamp with time zone NOT NULL,
    "idempotency_key" "uuid" NOT NULL,
    "request_hash" "text" NOT NULL,
    "response" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "contract_version" smallint DEFAULT 2 NOT NULL,
    CONSTRAINT "team_planning_item_update_requests_contract_version_check" CHECK (("contract_version" = ANY (ARRAY[1, 2]))),
    CONSTRAINT "team_planning_item_update_requests_item_type_check" CHECK (("item_type" = ANY (ARRAY['epic'::"text", 'milestone'::"text", 'initiative'::"text", 'deliverable'::"text", 'sub_issue'::"text"]))),
    CONSTRAINT "team_planning_item_update_requests_request_hash_check" CHECK (("request_hash" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "team_planning_item_update_requests_response_check" CHECK (("jsonb_typeof"("response") = 'object'::"text"))
);


ALTER TABLE "public"."team_planning_item_update_requests" OWNER TO "postgres";


COMMENT ON COLUMN "public"."team_planning_item_update_requests"."contract_version" IS 'Wire-contract version of the immutable update replay snapshot.';



CREATE TABLE IF NOT EXISTS "public"."team_task_intake_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token_id" "uuid" NOT NULL,
    "profile_id" "text" NOT NULL,
    "idempotency_key" "uuid" NOT NULL,
    "request_hash" "text" NOT NULL,
    "task_ids" "text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "response_tasks" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "contract_version" smallint DEFAULT 2 NOT NULL,
    CONSTRAINT "team_task_intake_batches_contract_version_check" CHECK (("contract_version" = ANY (ARRAY[1, 2]))),
    CONSTRAINT "team_task_intake_batches_request_hash_check" CHECK (("request_hash" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "team_task_intake_batches_response_tasks_check" CHECK (("jsonb_typeof"("response_tasks") = 'array'::"text")),
    CONSTRAINT "team_task_intake_batches_task_ids_check" CHECK ((("cardinality"("task_ids") >= 1) AND ("cardinality"("task_ids") <= 30)))
);


ALTER TABLE "public"."team_task_intake_batches" OWNER TO "postgres";


COMMENT ON TABLE "public"."team_task_intake_batches" IS 'Immutable idempotency records for atomic Team Task Intake commits.';



COMMENT ON COLUMN "public"."team_task_intake_batches"."response_tasks" IS 'Immutable task-row snapshots returned for deterministic idempotent replays.';



COMMENT ON COLUMN "public"."team_task_intake_batches"."contract_version" IS 'Wire-contract version of the immutable create replay snapshot.';



CREATE TABLE IF NOT EXISTS "public"."team_task_intake_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "text" NOT NULL,
    "label" "text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "token_hint" "text" NOT NULL,
    "scopes" "text"[] DEFAULT ARRAY['read:planning-context'::"text", 'write:planning-items:create'::"text"] NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "team_task_intake_tokens_expiry_check" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "team_task_intake_tokens_hash_check" CHECK (("token_hash" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "team_task_intake_tokens_hint_check" CHECK ((("char_length"("token_hint") >= 4) AND ("char_length"("token_hint") <= 16))),
    CONSTRAINT "team_task_intake_tokens_label_check" CHECK ((("char_length"("label") >= 1) AND ("char_length"("label") <= 80))),
    CONSTRAINT "team_task_intake_tokens_max_expiry_check" CHECK (("expires_at" <= ("created_at" + '90 days'::interval))),
    CONSTRAINT "team_task_intake_tokens_scopes_check" CHECK ((("array_position"("scopes", NULL::"text") IS NULL) AND ("scopes" <@ ARRAY['read:planning-context'::"text", 'write:planning-items:create'::"text", 'write:planning-items:update'::"text", 'write:planning-items:delete-empty'::"text", 'write:planning-items:github-sync'::"text"]) AND ("scopes" @> ARRAY['read:planning-context'::"text", 'write:planning-items:create'::"text"])))
);


ALTER TABLE "public"."team_task_intake_tokens" OWNER TO "postgres";


COMMENT ON TABLE "public"."team_task_intake_tokens" IS 'Hashed personal tokens for task-centered team context and guarded task intake.';



COMMENT ON COLUMN "public"."team_task_intake_tokens"."token_hash" IS 'SHA-256 hash of the one-time visible personal intake token.';



CREATE TABLE IF NOT EXISTS "public"."team_workweek_google_conflicts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_profile_id" "text" NOT NULL,
    "base_publication_id" "uuid" NOT NULL,
    "base_publication_revision" integer NOT NULL,
    "founderops_version_id" "uuid" NOT NULL,
    "google_effective_from" "date" NOT NULL,
    "google_windows" "jsonb" NOT NULL,
    "google_observations" "jsonb" NOT NULL,
    "google_fingerprint" "text" NOT NULL,
    "founderops_fingerprint" "text" NOT NULL,
    "conflict_revision" integer DEFAULT 1 NOT NULL,
    "state" "text" DEFAULT 'open'::"text" NOT NULL,
    "decision" "text",
    "resolution_version_id" "uuid",
    "observed_at" timestamp with time zone NOT NULL,
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "team_workweek_google_conflicts_decision" CHECK ((("decision" IS NULL) OR ("decision" = ANY (ARRAY['founderops'::"text", 'google'::"text"])))),
    CONSTRAINT "team_workweek_google_conflicts_fingerprints" CHECK ((("google_fingerprint" ~ '^[0-9a-f]{64}$'::"text") AND ("founderops_fingerprint" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "team_workweek_google_conflicts_payloads" CHECK ((("jsonb_typeof"("google_windows") = 'array'::"text") AND ("jsonb_typeof"("google_observations") = 'array'::"text"))),
    CONSTRAINT "team_workweek_google_conflicts_resolution" CHECK (((("state" = 'open'::"text") AND ("decision" IS NULL) AND ("resolution_version_id" IS NULL) AND ("resolved_at" IS NULL)) OR (("state" = 'resolving'::"text") AND ("decision" IS NOT NULL) AND ("resolution_version_id" IS NOT NULL) AND ("resolved_at" IS NULL)) OR (("state" = 'resolved'::"text") AND ("decision" IS NOT NULL) AND ("resolution_version_id" IS NOT NULL) AND ("resolved_at" IS NOT NULL)) OR (("state" = 'cancelled'::"text") AND ("decision" IS NULL) AND ("resolution_version_id" IS NULL) AND ("resolved_at" IS NOT NULL)))),
    CONSTRAINT "team_workweek_google_conflicts_state" CHECK (("state" = ANY (ARRAY['open'::"text", 'resolving'::"text", 'resolved'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."team_workweek_google_conflicts" OWNER TO "postgres";


COMMENT ON TABLE "public"."team_workweek_google_conflicts" IS 'Owner-private immutable comparison snapshots for parallel FounderOps and known Google workweek changes.';



CREATE TABLE IF NOT EXISTS "public"."team_workweek_google_reconciliation_status" (
    "publication_id" "uuid" NOT NULL,
    "owner_profile_id" "text" NOT NULL,
    "state" "text" DEFAULT 'confirmed'::"text" NOT NULL,
    "last_observed_at" timestamp with time zone,
    "last_error_class" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "team_workweek_google_reconciliation_status_error" CHECK (((("state" = ANY (ARRAY['confirmed'::"text", 'pending'::"text"])) AND ("last_error_class" IS NULL)) OR (("state" = ANY (ARRAY['delayed'::"text", 'conflict'::"text"])) AND ("last_error_class" IS NOT NULL)))),
    CONSTRAINT "team_workweek_google_reconciliation_status_state" CHECK (("state" = ANY (ARRAY['confirmed'::"text", 'pending'::"text", 'delayed'::"text", 'conflict'::"text"])))
);


ALTER TABLE "public"."team_workweek_google_reconciliation_status" OWNER TO "postgres";


COMMENT ON TABLE "public"."team_workweek_google_reconciliation_status" IS 'Owner-private operational state for reconciliation of a known FounderOps workweek publication.';



CREATE TABLE IF NOT EXISTS "public"."team_workweek_google_series" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "publication_id" "uuid" NOT NULL,
    "source_window_id" bigint NOT NULL,
    "owner_profile_id" "text" NOT NULL,
    "calendar_id" "text" DEFAULT 'primary'::"text" NOT NULL,
    "google_event_id" "text" NOT NULL,
    "private_property_key" "text" DEFAULT 'founderopsWorkweekSeriesId'::"text" NOT NULL,
    "state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "confirmed_etag" "text",
    "confirmed_founderops_revision" integer,
    "last_observed_at" timestamp with time zone,
    "last_confirmed_at" timestamp with time zone,
    "last_error_class" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provider_state" "text" DEFAULT 'active'::"text" NOT NULL,
    "provider_deleted_at" timestamp with time zone,
    "future_cleanup_state" "text" DEFAULT 'not_required'::"text" NOT NULL,
    "future_cleanup_confirmed_at" timestamp with time zone,
    CONSTRAINT "team_workweek_google_series_calendar" CHECK (("calendar_id" = 'primary'::"text")),
    CONSTRAINT "team_workweek_google_series_confirmation" CHECK (((("state" = 'pending'::"text") AND ("confirmed_etag" IS NULL) AND ("confirmed_founderops_revision" IS NULL) AND ("last_confirmed_at" IS NULL)) OR (("state" = 'confirmed'::"text") AND ("confirmed_etag" IS NOT NULL) AND ("confirmed_founderops_revision" IS NOT NULL) AND ("last_confirmed_at" IS NOT NULL)))),
    CONSTRAINT "team_workweek_google_series_event_id" CHECK (((("char_length"("google_event_id") >= 5) AND ("char_length"("google_event_id") <= 1024)) AND ("google_event_id" ~ '^[a-v0-9]+$'::"text"))),
    CONSTRAINT "team_workweek_google_series_future_cleanup" CHECK (((("future_cleanup_state" = 'not_required'::"text") AND ("future_cleanup_confirmed_at" IS NULL)) OR (("future_cleanup_state" = 'pending'::"text") AND ("future_cleanup_confirmed_at" IS NULL)) OR (("future_cleanup_state" = 'confirmed'::"text") AND ("future_cleanup_confirmed_at" IS NOT NULL)))),
    CONSTRAINT "team_workweek_google_series_property_key" CHECK (("private_property_key" = 'founderopsWorkweekSeriesId'::"text")),
    CONSTRAINT "team_workweek_google_series_provider_deletion" CHECK (((("provider_state" = 'active'::"text") AND ("provider_deleted_at" IS NULL)) OR (("provider_state" = 'deleted'::"text") AND ("provider_deleted_at" IS NOT NULL)))),
    CONSTRAINT "team_workweek_google_series_provider_state" CHECK (("provider_state" = ANY (ARRAY['active'::"text", 'deleted'::"text"]))),
    CONSTRAINT "team_workweek_google_series_state" CHECK (("state" = ANY (ARRAY['pending'::"text", 'confirmed'::"text"])))
);


ALTER TABLE "public"."team_workweek_google_series" OWNER TO "postgres";


COMMENT ON TABLE "public"."team_workweek_google_series" IS 'Owner-private durable Google projection identities. Team read models never expose provider identifiers.';



COMMENT ON COLUMN "public"."team_workweek_google_series"."provider_state" IS 'Whether the known recurring master still exists at Google. Deleted masters are never recreated automatically.';



CREATE TABLE IF NOT EXISTS "public"."team_workweek_google_series_transitions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "activation_publication_id" "uuid" NOT NULL,
    "predecessor_series_id" "uuid" NOT NULL,
    "owner_profile_id" "text" NOT NULL,
    "expected_etag" "text" NOT NULL,
    "expected_founderops_revision" integer NOT NULL,
    "recurrence_count" integer NOT NULL,
    "state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "confirmed_etag" "text",
    "last_observed_at" timestamp with time zone,
    "last_confirmed_at" timestamp with time zone,
    "last_error_class" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "team_workweek_google_series_transitions_confirmation" CHECK (((("state" = 'pending'::"text") AND ("confirmed_etag" IS NULL) AND ("last_confirmed_at" IS NULL)) OR (("state" = 'confirmed'::"text") AND ("confirmed_etag" IS NOT NULL) AND ("last_confirmed_at" IS NOT NULL)))),
    CONSTRAINT "team_workweek_google_series_transitions_recurrence_positive" CHECK (("recurrence_count" > 0)),
    CONSTRAINT "team_workweek_google_series_transitions_revision_positive" CHECK (("expected_founderops_revision" > 0)),
    CONSTRAINT "team_workweek_google_series_transitions_state" CHECK (("state" = ANY (ARRAY['pending'::"text", 'confirmed'::"text"])))
);


ALTER TABLE "public"."team_workweek_google_series_transitions" OWNER TO "postgres";


COMMENT ON TABLE "public"."team_workweek_google_series_transitions" IS 'Owner-private, replay-safe updates that end predecessor Google series at a later Monday boundary without changing past occurrences.';



CREATE TABLE IF NOT EXISTS "public"."team_workweek_publications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_version_id" "uuid" NOT NULL,
    "owner_profile_id" "text" NOT NULL,
    "effective_from" "date" NOT NULL,
    "timezone" "text" DEFAULT 'Europe/Berlin'::"text" NOT NULL,
    "windows" "jsonb" NOT NULL,
    "status" "text" DEFAULT 'preparing'::"text" NOT NULL,
    "publication_revision" integer DEFAULT 1 NOT NULL,
    "publication_requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "published_at" timestamp with time zone,
    "last_sync_at" timestamp with time zone,
    "sync_state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "effective_to" "date",
    "predecessor_publication_id" "uuid",
    "superseded_by_publication_id" "uuid",
    "deactivated_at" timestamp with time zone,
    "deactivation_reason" "text",
    CONSTRAINT "team_workweek_publications_consistent" CHECK (((("status" = 'preparing'::"text") AND ("published_at" IS NULL) AND ("sync_state" = ANY (ARRAY['pending'::"text", 'delayed'::"text"])) AND ("deactivated_at" IS NULL) AND ("deactivation_reason" IS NULL)) OR (("status" = 'published'::"text") AND ("published_at" IS NOT NULL) AND ("sync_state" = 'confirmed'::"text") AND ("deactivated_at" IS NULL) AND ("deactivation_reason" IS NULL)) OR (("status" = 'inactive'::"text") AND ("deactivated_at" IS NOT NULL) AND ("deactivation_reason" IS NOT NULL)))),
    CONSTRAINT "team_workweek_publications_deactivation_reason" CHECK ((("deactivation_reason" IS NULL) OR ("deactivation_reason" = ANY (ARRAY['manual_disconnect'::"text", 'external_revocation'::"text"])))),
    CONSTRAINT "team_workweek_publications_effective_range" CHECK ((("effective_to" IS NULL) OR ("effective_to" >= ("effective_from" - 1)))),
    CONSTRAINT "team_workweek_publications_monday_start" CHECK ((EXTRACT(isodow FROM "effective_from") = (1)::numeric)),
    CONSTRAINT "team_workweek_publications_predecessor_distinct" CHECK ((("predecessor_publication_id" IS NULL) OR ("predecessor_publication_id" <> "id"))),
    CONSTRAINT "team_workweek_publications_revision_positive" CHECK (("publication_revision" > 0)),
    CONSTRAINT "team_workweek_publications_status" CHECK (("status" = ANY (ARRAY['preparing'::"text", 'published'::"text", 'inactive'::"text"]))),
    CONSTRAINT "team_workweek_publications_supersession_consistent" CHECK ((("effective_to" IS NULL) = ("superseded_by_publication_id" IS NULL))),
    CONSTRAINT "team_workweek_publications_sync_state" CHECK (("sync_state" = ANY (ARRAY['pending'::"text", 'delayed'::"text", 'confirmed'::"text"]))),
    CONSTRAINT "team_workweek_publications_timezone_fixed" CHECK (("timezone" = 'Europe/Berlin'::"text")),
    CONSTRAINT "team_workweek_publications_windows" CHECK ((("jsonb_typeof"("windows") = 'array'::"text") AND ("jsonb_array_length"("windows") <= 84)))
);


ALTER TABLE "public"."team_workweek_publications" OWNER TO "postgres";


COMMENT ON TABLE "public"."team_workweek_publications" IS 'Immutable team-visible projections of private workweek versions. Preparing rows remain owner-private; confirmed rows are readable by mapped team members.';



CREATE TABLE IF NOT EXISTS "public"."team_workweek_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_profile_id" "text" NOT NULL,
    "effective_from" "date" NOT NULL,
    "timezone" "text" DEFAULT 'Europe/Berlin'::"text" NOT NULL,
    "status" "text" DEFAULT 'preparing'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "origin" "text" DEFAULT 'owner'::"text" NOT NULL,
    "google_reconciliation_source_publication_id" "uuid",
    "google_reconciliation_fingerprint" "text",
    CONSTRAINT "team_workweek_versions_google_reconciliation_consistent" CHECK (((("origin" = 'owner'::"text") AND ("google_reconciliation_source_publication_id" IS NULL) AND ("google_reconciliation_fingerprint" IS NULL)) OR (("origin" = 'google_reconciliation'::"text") AND ("google_reconciliation_source_publication_id" IS NOT NULL) AND ("google_reconciliation_fingerprint" ~ '^[0-9a-f]{64}$'::"text")))),
    CONSTRAINT "team_workweek_versions_monday_start" CHECK ((EXTRACT(isodow FROM "effective_from") = (1)::numeric)),
    CONSTRAINT "team_workweek_versions_origin" CHECK (("origin" = ANY (ARRAY['owner'::"text", 'google_reconciliation'::"text"]))),
    CONSTRAINT "team_workweek_versions_private_status" CHECK (("status" = 'preparing'::"text")),
    CONSTRAINT "team_workweek_versions_timezone_fixed" CHECK (("timezone" = 'Europe/Berlin'::"text"))
);


ALTER TABLE "public"."team_workweek_versions" OWNER TO "postgres";


COMMENT ON TABLE "public"."team_workweek_versions" IS 'Immutable private FounderOps team-workweek versions. Publication is modeled separately and never mutates these drafts.';



COMMENT ON COLUMN "public"."team_workweek_versions"."origin" IS 'Owner input or a validated Google-only reconciliation. Reconciliation metadata remains owner-private.';



CREATE TABLE IF NOT EXISTS "public"."team_workweek_windows" (
    "id" bigint NOT NULL,
    "version_id" "uuid" NOT NULL,
    "weekday" smallint NOT NULL,
    "start_minute" smallint NOT NULL,
    "end_minute" smallint NOT NULL,
    CONSTRAINT "team_workweek_windows_time_range" CHECK (((("start_minute" >= 0) AND ("start_minute" <= 1438)) AND (("end_minute" >= 1) AND ("end_minute" <= 1439)) AND ("start_minute" < "end_minute"))),
    CONSTRAINT "team_workweek_windows_weekday_range" CHECK ((("weekday" >= 1) AND ("weekday" <= 7)))
);


ALTER TABLE "public"."team_workweek_windows" OWNER TO "postgres";


COMMENT ON TABLE "public"."team_workweek_windows" IS 'Europe/Berlin wall-clock windows belonging to one immutable private team-workweek version.';



ALTER TABLE "public"."team_workweek_windows" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."team_workweek_windows_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."decision_task_links" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."decision_task_links_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."founder_events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."founder_events_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."task_focus_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."task_focus_items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."task_intake_tokens" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."task_intake_tokens_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."task_relationship_edges" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."task_relationship_edges_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."availability"
    ADD CONSTRAINT "availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decision_comments"
    ADD CONSTRAINT "decision_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decision_confirmations"
    ADD CONSTRAINT "decision_confirmations_decision_id_profile_id_key" UNIQUE ("decision_id", "profile_id");



ALTER TABLE ONLY "public"."decision_confirmations"
    ADD CONSTRAINT "decision_confirmations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decision_log"
    ADD CONSTRAINT "decision_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decision_task_links"
    ADD CONSTRAINT "decision_task_links_decision_id_task_id_key" UNIQUE ("decision_id", "task_id");



ALTER TABLE ONLY "public"."decision_task_links"
    ADD CONSTRAINT "decision_task_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback_items"
    ADD CONSTRAINT "feedback_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fmd_tools"
    ADD CONSTRAINT "fmd_tools_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."founder_events"
    ADD CONSTRAINT "founder_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."founder_sprint_scores"
    ADD CONSTRAINT "founder_sprint_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."founder_sprint_scores"
    ADD CONSTRAINT "founder_sprint_scores_sprint_id_profile_id_key" UNIQUE ("sprint_id", "profile_id");



ALTER TABLE ONLY "public"."founder_strike_state"
    ADD CONSTRAINT "founder_strike_state_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."founder_strike_state"
    ADD CONSTRAINT "founder_strike_state_profile_id_key" UNIQUE ("profile_id");



ALTER TABLE ONLY "public"."github_app_user_tokens"
    ADD CONSTRAINT "github_app_user_tokens_pkey" PRIMARY KEY ("profile_id");



ALTER TABLE ONLY "public"."github_issue_sync_locks"
    ADD CONSTRAINT "github_issue_sync_locks_pkey" PRIMARY KEY ("resource_key");



ALTER TABLE ONLY "public"."github_planning_webhook_deliveries"
    ADD CONSTRAINT "github_planning_webhook_deliveries_pkey" PRIMARY KEY ("delivery_id");



ALTER TABLE ONLY "public"."github_webhook_deliveries"
    ADD CONSTRAINT "github_webhook_deliveries_pkey" PRIMARY KEY ("delivery_id");



ALTER TABLE ONLY "public"."google_workspace_connections"
    ADD CONSTRAINT "google_workspace_connections_pkey" PRIMARY KEY ("profile_id");



ALTER TABLE ONLY "public"."google_workspace_disconnect_operations"
    ADD CONSTRAINT "google_workspace_disconnect_operations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."google_workspace_disconnect_series"
    ADD CONSTRAINT "google_workspace_disconnect_series_operation_id_series_id_key" UNIQUE ("operation_id", "series_id");



ALTER TABLE ONLY "public"."google_workspace_disconnect_series"
    ADD CONSTRAINT "google_workspace_disconnect_series_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."meeting_attendance"
    ADD CONSTRAINT "meeting_attendance_meeting_id_profile_id_key" UNIQUE ("meeting_id", "profile_id");



ALTER TABLE ONLY "public"."meeting_attendance"
    ADD CONSTRAINT "meeting_attendance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."meetings"
    ADD CONSTRAINT "meetings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_deliveries"
    ADD CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_events"
    ADD CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_profile_id_channel_event_type_key" UNIQUE ("profile_id", "channel", "event_type");



ALTER TABLE ONLY "public"."planning_github_lifecycle_outbox"
    ADD CONSTRAINT "planning_github_lifecycle_outbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."planning_github_lifecycle_outbox"
    ADD CONSTRAINT "planning_github_lifecycle_outbox_root_task_action_key" UNIQUE ("root_type", "root_id", "root_trash_revision", "task_id", "action");



ALTER TABLE ONLY "public"."planning_github_projection_outbox"
    ADD CONSTRAINT "planning_github_projection_ou_planning_operation_id_task_id_key" UNIQUE ("planning_operation_id", "task_id");



ALTER TABLE ONLY "public"."planning_github_projection_outbox"
    ADD CONSTRAINT "planning_github_projection_outbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."planning_item_historical_links"
    ADD CONSTRAINT "planning_item_historical_links_item_type_task_id_key" UNIQUE ("item_type", "task_id");



ALTER TABLE ONLY "public"."planning_item_historical_links"
    ADD CONSTRAINT "planning_item_historical_links_pkey" PRIMARY KEY ("item_type", "historical_id");



ALTER TABLE ONLY "public"."planning_item_raci_assignments"
    ADD CONSTRAINT "planning_item_raci_assignments_pkey" PRIMARY KEY ("task_id", "profile_id", "role");



ALTER TABLE ONLY "public"."planning_item_strategy"
    ADD CONSTRAINT "planning_item_strategy_pkey" PRIMARY KEY ("task_id");



ALTER TABLE ONLY "public"."platform_releases"
    ADD CONSTRAINT "platform_releases_manifest_digest_key" UNIQUE ("manifest_digest");



ALTER TABLE ONLY "public"."platform_releases"
    ADD CONSTRAINT "platform_releases_pkey" PRIMARY KEY ("version");



ALTER TABLE ONLY "public"."profile_feature_tour_acknowledgements"
    ADD CONSTRAINT "profile_feature_tour_acknowledgements_pkey" PRIMARY KEY ("profile_id", "tour_id");



ALTER TABLE ONLY "public"."profile_ui_preferences"
    ADD CONSTRAINT "profile_ui_preferences_pkey" PRIMARY KEY ("profile_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_auth_user_id_key" UNIQUE ("auth_user_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_github_login_key" UNIQUE ("github_login");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."score_objections"
    ADD CONSTRAINT "score_objections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sprint_commitments"
    ADD CONSTRAINT "sprint_commitments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sprint_commitments"
    ADD CONSTRAINT "sprint_commitments_sprint_id_profile_id_key" UNIQUE ("sprint_id", "profile_id");



ALTER TABLE ONLY "public"."sprints"
    ADD CONSTRAINT "sprints_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."strike_events"
    ADD CONSTRAINT "strike_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_blockers"
    ADD CONSTRAINT "task_blockers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_comment_github_deliveries"
    ADD CONSTRAINT "task_comment_github_deliveries_pkey" PRIMARY KEY ("task_comment_id");



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_deletion_operations"
    ADD CONSTRAINT "task_deletion_operations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_deletion_operations"
    ADD CONSTRAINT "task_deletion_operations_task_id_key" UNIQUE ("task_id");



ALTER TABLE ONLY "public"."task_dependencies"
    ADD CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_external_comments"
    ADD CONSTRAINT "task_external_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_external_comments"
    ADD CONSTRAINT "task_external_comments_source_external_id_key" UNIQUE ("source", "external_id");



ALTER TABLE ONLY "public"."task_focus_items"
    ADD CONSTRAINT "task_focus_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_focus_items"
    ADD CONSTRAINT "task_focus_items_profile_id_task_id_focus_date_key" UNIQUE ("profile_id", "task_id", "focus_date");



ALTER TABLE ONLY "public"."task_intake_tokens"
    ADD CONSTRAINT "task_intake_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_intake_tokens"
    ADD CONSTRAINT "task_intake_tokens_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."task_links"
    ADD CONSTRAINT "task_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_notes"
    ADD CONSTRAINT "task_notes_pkey" PRIMARY KEY ("task_id");



ALTER TABLE ONLY "public"."task_relationship_edges"
    ADD CONSTRAINT "task_relationship_edges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_relationship_edges"
    ADD CONSTRAINT "task_relationship_edges_unique" UNIQUE ("task_id", "related_task_id", "relation_type");



ALTER TABLE ONLY "public"."task_reviews"
    ADD CONSTRAINT "task_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_planning_item_delete_requests"
    ADD CONSTRAINT "team_planning_item_delete_req_token_id_idempotency_key_key" UNIQUE ("token_id", "idempotency_key");



ALTER TABLE ONLY "public"."team_planning_item_delete_requests"
    ADD CONSTRAINT "team_planning_item_delete_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_planning_item_update_requests"
    ADD CONSTRAINT "team_planning_item_update_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_planning_item_update_requests"
    ADD CONSTRAINT "team_planning_item_update_requests_token_id_idempotency_key_key" UNIQUE ("token_id", "idempotency_key");



ALTER TABLE ONLY "public"."team_task_intake_batches"
    ADD CONSTRAINT "team_task_intake_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_task_intake_batches"
    ADD CONSTRAINT "team_task_intake_batches_token_key_unique" UNIQUE ("token_id", "idempotency_key");



ALTER TABLE ONLY "public"."team_task_intake_tokens"
    ADD CONSTRAINT "team_task_intake_tokens_id_profile_unique" UNIQUE ("id", "profile_id");



ALTER TABLE ONLY "public"."team_task_intake_tokens"
    ADD CONSTRAINT "team_task_intake_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_task_intake_tokens"
    ADD CONSTRAINT "team_task_intake_tokens_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."team_workweek_google_conflicts"
    ADD CONSTRAINT "team_workweek_google_conflict_base_publication_id_founderop_key" UNIQUE ("base_publication_id", "founderops_version_id", "google_fingerprint");



ALTER TABLE ONLY "public"."team_workweek_google_conflicts"
    ADD CONSTRAINT "team_workweek_google_conflicts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_workweek_google_reconciliation_status"
    ADD CONSTRAINT "team_workweek_google_reconciliation_status_pkey" PRIMARY KEY ("publication_id");



ALTER TABLE ONLY "public"."team_workweek_google_series"
    ADD CONSTRAINT "team_workweek_google_series_calendar_id_google_event_id_key" UNIQUE ("calendar_id", "google_event_id");



ALTER TABLE ONLY "public"."team_workweek_google_series"
    ADD CONSTRAINT "team_workweek_google_series_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_workweek_google_series"
    ADD CONSTRAINT "team_workweek_google_series_source_window_id_key" UNIQUE ("source_window_id");



ALTER TABLE ONLY "public"."team_workweek_google_series_transitions"
    ADD CONSTRAINT "team_workweek_google_series_t_activation_publication_id_pre_key" UNIQUE ("activation_publication_id", "predecessor_series_id");



ALTER TABLE ONLY "public"."team_workweek_google_series_transitions"
    ADD CONSTRAINT "team_workweek_google_series_transitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_workweek_publications"
    ADD CONSTRAINT "team_workweek_publications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_workweek_publications"
    ADD CONSTRAINT "team_workweek_publications_source_version_id_key" UNIQUE ("source_version_id");



ALTER TABLE ONLY "public"."team_workweek_versions"
    ADD CONSTRAINT "team_workweek_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_workweek_windows"
    ADD CONSTRAINT "team_workweek_windows_pkey" PRIMARY KEY ("id");



CREATE INDEX "audit_log_entity_idx" ON "public"."audit_log" USING "btree" ("entity_type", "entity_id");



CREATE UNIQUE INDEX "availability_google_external_idx" ON "public"."availability" USING "btree" ("external_calendar_id", "external_id") WHERE (("source" = 'google_calendar'::"text") AND ("external_calendar_id" IS NOT NULL) AND ("external_id" IS NOT NULL));



CREATE INDEX "availability_profile_idx" ON "public"."availability" USING "btree" ("profile_id");



CREATE INDEX "availability_source_idx" ON "public"."availability" USING "btree" ("source");



CREATE INDEX "decision_comments_decision_id_idx" ON "public"."decision_comments" USING "btree" ("decision_id");



CREATE INDEX "decision_log_status_idx" ON "public"."decision_log" USING "btree" ("status");



CREATE INDEX "decision_task_links_decision_idx" ON "public"."decision_task_links" USING "btree" ("decision_id");



CREATE INDEX "decision_task_links_task_idx" ON "public"."decision_task_links" USING "btree" ("task_id");



CREATE INDEX "feedback_items_profile_created_idx" ON "public"."feedback_items" USING "btree" ("profile_id", "created_at" DESC);



CREATE INDEX "feedback_items_status_created_idx" ON "public"."feedback_items" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "fmd_tools_category_status_idx" ON "public"."fmd_tools" USING "btree" ("category", "status", "sort_order");



CREATE INDEX "founder_events_participant_profile_ids_idx" ON "public"."founder_events" USING "gin" ("participant_profile_ids");



CREATE INDEX "founder_events_reminder_generated_at_idx" ON "public"."founder_events" USING "btree" ("reminder_generated_at");



CREATE INDEX "founder_events_starts_at_idx" ON "public"."founder_events" USING "btree" ("starts_at");



CREATE INDEX "founder_events_status_idx" ON "public"."founder_events" USING "btree" ("status");



CREATE INDEX "founder_sprint_scores_profile_idx" ON "public"."founder_sprint_scores" USING "btree" ("profile_id");



CREATE INDEX "founder_sprint_scores_sprint_idx" ON "public"."founder_sprint_scores" USING "btree" ("sprint_id");



CREATE UNIQUE INDEX "github_app_user_tokens_active_user_id_uidx" ON "public"."github_app_user_tokens" USING "btree" ("github_user_id") WHERE (("github_user_id" IS NOT NULL) AND ("revoked_at" IS NULL));



COMMENT ON INDEX "public"."github_app_user_tokens_active_user_id_uidx" IS 'One active FounderOps identity per stable GitHub user id. Logins remain display metadata only.';



CREATE INDEX "github_app_user_tokens_github_login_idx" ON "public"."github_app_user_tokens" USING "btree" ("github_login");



CREATE INDEX "github_app_user_tokens_refresh_idx" ON "public"."github_app_user_tokens" USING "btree" ("refresh_token_expires_at");



CREATE INDEX "github_issue_sync_locks_expires_idx" ON "public"."github_issue_sync_locks" USING "btree" ("expires_at");



CREATE INDEX "github_issue_sync_locks_task_idx" ON "public"."github_issue_sync_locks" USING "btree" ("task_id");



CREATE INDEX "github_planning_webhook_deliveries_claim_idx" ON "public"."github_planning_webhook_deliveries" USING "btree" ("status", "available_at", "received_at") WHERE ("status" = ANY (ARRAY['received'::"text", 'processing'::"text", 'retry_scheduled'::"text"]));



CREATE INDEX "github_planning_webhook_deliveries_issue_idx" ON "public"."github_planning_webhook_deliveries" USING "btree" ("repository_full_name", "issue_number", "received_at" DESC) WHERE (("repository_full_name" IS NOT NULL) AND ("issue_number" IS NOT NULL));



CREATE INDEX "github_planning_webhook_deliveries_project_item_idx" ON "public"."github_planning_webhook_deliveries" USING "btree" ("project_item_node_id", "received_at" DESC) WHERE ("project_item_node_id" IS NOT NULL);



CREATE INDEX "github_webhook_deliveries_claim_idx" ON "public"."github_webhook_deliveries" USING "btree" ("status", "available_at", "received_at") WHERE ("status" = ANY (ARRAY['received'::"text", 'processing'::"text", 'retry_scheduled'::"text"]));



CREATE INDEX "github_webhook_deliveries_comment_idx" ON "public"."github_webhook_deliveries" USING "btree" ("comment_id", "received_at" DESC) WHERE ("comment_id" IS NOT NULL);



CREATE INDEX "github_webhook_deliveries_issue_idx" ON "public"."github_webhook_deliveries" USING "btree" ("repository_full_name", "issue_number", "received_at" DESC);



CREATE INDEX "github_webhook_deliveries_issue_node_idx" ON "public"."github_webhook_deliveries" USING "btree" ("issue_node_id", "received_at" DESC);



CREATE UNIQUE INDEX "google_workspace_disconnect_operations_owner_open_unique" ON "public"."google_workspace_disconnect_operations" USING "btree" ("owner_profile_id") WHERE ("state" <> 'completed'::"text");



CREATE INDEX "meeting_attendance_meeting_idx" ON "public"."meeting_attendance" USING "btree" ("meeting_id");



CREATE INDEX "meeting_attendance_profile_idx" ON "public"."meeting_attendance" USING "btree" ("profile_id");



CREATE INDEX "meetings_google_calendar_event_idx" ON "public"."meetings" USING "btree" ("google_calendar_id", "google_calendar_event_id") WHERE ("google_calendar_event_id" IS NOT NULL);



CREATE INDEX "meetings_sprint_id_idx" ON "public"."meetings" USING "btree" ("sprint_id");



CREATE INDEX "notification_deliveries_event_id_idx" ON "public"."notification_deliveries" USING "btree" ("event_id");



CREATE INDEX "notification_deliveries_status_idx" ON "public"."notification_deliveries" USING "btree" ("status");



CREATE UNIQUE INDEX "notification_events_dedupe_key_uidx" ON "public"."notification_events" USING "btree" ("dedupe_key") WHERE ("dedupe_key" IS NOT NULL);



CREATE INDEX "notification_events_entity_idx" ON "public"."notification_events" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "notification_events_recipient_status_idx" ON "public"."notification_events" USING "btree" ("recipient_profile_id", "status");



CREATE INDEX "notification_events_status_created_idx" ON "public"."notification_events" USING "btree" ("status", "created_at");



CREATE INDEX "notification_events_unseen_recipient_created_idx" ON "public"."notification_events" USING "btree" ("recipient_profile_id", "created_at" DESC) WHERE (("status" = 'pending'::"text") AND ("seen_at" IS NULL));



CREATE INDEX "planning_github_lifecycle_delivery_sequence_idx" ON "public"."planning_github_lifecycle_outbox" USING "btree" ("task_id", "delivery_sequence");



CREATE INDEX "planning_github_lifecycle_outbox_claim_idx" ON "public"."planning_github_lifecycle_outbox" USING "btree" ("status", "available_at", "created_at") WHERE ("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'retry_scheduled'::"text"]));



CREATE INDEX "planning_github_lifecycle_outbox_root_idx" ON "public"."planning_github_lifecycle_outbox" USING "btree" ("root_type", "root_id", "root_trash_revision", "action", "status");



CREATE INDEX "planning_github_lifecycle_outbox_task_idx" ON "public"."planning_github_lifecycle_outbox" USING "btree" ("task_id", "created_at");



CREATE INDEX "planning_github_projection_claim_idx" ON "public"."planning_github_projection_outbox" USING "btree" ("status", "available_at", "delivery_sequence") WHERE ("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'retry_scheduled'::"text"]));



CREATE INDEX "planning_github_projection_source_delivery_idx" ON "public"."planning_github_projection_outbox" USING "btree" ("source_delivery_id") WHERE ("source_delivery_id" IS NOT NULL);



CREATE INDEX "planning_github_projection_task_idx" ON "public"."planning_github_projection_outbox" USING "btree" ("task_id", "delivery_sequence");



CREATE INDEX "planning_item_historical_links_task_idx" ON "public"."planning_item_historical_links" USING "btree" ("task_id");



CREATE UNIQUE INDEX "planning_item_raci_one_accountable_idx" ON "public"."planning_item_raci_assignments" USING "btree" ("task_id") WHERE ("role" = 'accountable'::"text");



CREATE INDEX "platform_releases_published_at_idx" ON "public"."platform_releases" USING "btree" ("published_at" DESC, "version" DESC);



CREATE INDEX "profile_feature_tour_acknowledgements_tour_idx" ON "public"."profile_feature_tour_acknowledgements" USING "btree" ("tour_id", "seen_at");



CREATE INDEX "profiles_auth_user_id_idx" ON "public"."profiles" USING "btree" ("auth_user_id");



CREATE INDEX "profiles_github_login_idx" ON "public"."profiles" USING "btree" ("github_login");



CREATE INDEX "profiles_google_calendar_sync_idx" ON "public"."profiles" USING "btree" ("google_calendar_sync_enabled", "google_calendar_email") WHERE (("google_calendar_sync_enabled" = true) AND ("google_calendar_email" IS NOT NULL));



CREATE INDEX "profiles_platform_role_idx" ON "public"."profiles" USING "btree" ("platform_role");



CREATE INDEX "score_objections_profile_idx" ON "public"."score_objections" USING "btree" ("profile_id");



CREATE INDEX "score_objections_sprint_status_idx" ON "public"."score_objections" USING "btree" ("sprint_id", "status");



CREATE INDEX "sprint_commitments_profile_idx" ON "public"."sprint_commitments" USING "btree" ("profile_id");



CREATE INDEX "sprint_commitments_sprint_idx" ON "public"."sprint_commitments" USING "btree" ("sprint_id");



CREATE INDEX "strike_events_profile_sprint_idx" ON "public"."strike_events" USING "btree" ("profile_id", "sprint_id");



CREATE INDEX "strike_events_type_idx" ON "public"."strike_events" USING "btree" ("event_type");



CREATE INDEX "task_blockers_status_idx" ON "public"."task_blockers" USING "btree" ("status");



CREATE INDEX "task_blockers_task_id_idx" ON "public"."task_blockers" USING "btree" ("task_id");



CREATE INDEX "task_comment_github_deliveries_author_status_idx" ON "public"."task_comment_github_deliveries" USING "btree" ("author_profile_id", "status", "next_attempt_at");



CREATE INDEX "task_comment_github_deliveries_task_status_idx" ON "public"."task_comment_github_deliveries" USING "btree" ("task_id", "status", "next_attempt_at");



CREATE INDEX "task_comments_task_id_idx" ON "public"."task_comments" USING "btree" ("task_id");



CREATE INDEX "task_deletion_operations_status_idx" ON "public"."task_deletion_operations" USING "btree" ("status", "updated_at");



CREATE INDEX "task_dependencies_task_id_idx" ON "public"."task_dependencies" USING "btree" ("task_id");



CREATE INDEX "task_external_comments_task_id_created_at_idx" ON "public"."task_external_comments" USING "btree" ("task_id", "created_at");



CREATE INDEX "task_focus_items_profile_date_idx" ON "public"."task_focus_items" USING "btree" ("profile_id", "focus_date", "position");



CREATE INDEX "task_focus_items_task_idx" ON "public"."task_focus_items" USING "btree" ("task_id");



CREATE INDEX "task_intake_tokens_active_profile_idx" ON "public"."task_intake_tokens" USING "btree" ("profile_id") WHERE ("revoked_at" IS NULL);



CREATE INDEX "task_intake_tokens_profile_id_idx" ON "public"."task_intake_tokens" USING "btree" ("profile_id");



CREATE INDEX "task_links_task_id_idx" ON "public"."task_links" USING "btree" ("task_id");



CREATE INDEX "task_links_task_type_position_idx" ON "public"."task_links" USING "btree" ("task_id", "type", "position", "id");



CREATE INDEX "task_relationship_edges_related_task_id_idx" ON "public"."task_relationship_edges" USING "btree" ("related_task_id");



CREATE INDEX "task_relationship_edges_relation_type_idx" ON "public"."task_relationship_edges" USING "btree" ("relation_type");



CREATE INDEX "task_relationship_edges_task_id_idx" ON "public"."task_relationship_edges" USING "btree" ("task_id");



CREATE INDEX "task_reviews_task_id_idx" ON "public"."task_reviews" USING "btree" ("task_id");



CREATE INDEX "tasks_approval_status_idx" ON "public"."tasks" USING "btree" ("approval_status");



CREATE INDEX "tasks_assignee_idx" ON "public"."tasks" USING "btree" ("assignee");



CREATE INDEX "tasks_carried_from_sprint_idx" ON "public"."tasks" USING "btree" ("carried_from_sprint_id");



CREATE INDEX "tasks_carried_from_task_idx" ON "public"."tasks" USING "btree" ("carried_from_task_id");



CREATE INDEX "tasks_created_by_idx" ON "public"."tasks" USING "btree" ("created_by");



CREATE UNIQUE INDEX "tasks_creation_request_id_unique_idx" ON "public"."tasks" USING "btree" ("creation_request_id") WHERE ("creation_request_id" IS NOT NULL);



CREATE INDEX "tasks_github_issue_sync_status_idx" ON "public"."tasks" USING "btree" ("github_issue_sync_status");



CREATE INDEX "tasks_intake_decided_by_idx" ON "public"."tasks" USING "btree" ("intake_decided_by");



CREATE INDEX "tasks_intake_lifecycle_idx" ON "public"."tasks" USING "btree" ("intake_source", "intake_status");



CREATE INDEX "tasks_original_sprint_idx" ON "public"."tasks" USING "btree" ("original_sprint_id");



CREATE INDEX "tasks_owner_idx" ON "public"."tasks" USING "btree" ("owner");



CREATE INDEX "tasks_parent_task_id_idx" ON "public"."tasks" USING "btree" ("parent_task_id");



CREATE INDEX "tasks_planning_parent_type_status_sort_idx" ON "public"."tasks" USING "btree" ("parent_task_id", "task_type", "status", "sort_order");



CREATE INDEX "tasks_planning_type_status_sort_idx" ON "public"."tasks" USING "btree" ("project_id", "task_type", "status", "sort_order");



CREATE INDEX "tasks_project_id_idx" ON "public"."tasks" USING "btree" ("project_id");



CREATE INDEX "tasks_purge_after_idx" ON "public"."tasks" USING "btree" ("purge_after", "id") WHERE ("trashed_at" IS NOT NULL);



CREATE INDEX "tasks_review_owner_profile_id_idx" ON "public"."tasks" USING "btree" ("review_owner_profile_id");



CREATE INDEX "tasks_review_requested_at_idx" ON "public"."tasks" USING "btree" ("review_requested_at");



CREATE INDEX "tasks_review_status_idx" ON "public"."tasks" USING "btree" ("review_status");



CREATE INDEX "tasks_score_relevant_idx" ON "public"."tasks" USING "btree" ("score_relevant");



CREATE INDEX "tasks_sprint_id_idx" ON "public"."tasks" USING "btree" ("sprint_id");



CREATE INDEX "tasks_status_idx" ON "public"."tasks" USING "btree" ("status");



CREATE INDEX "tasks_task_type_idx" ON "public"."tasks" USING "btree" ("task_type");



CREATE INDEX "tasks_trash_root_idx" ON "public"."tasks" USING "btree" ("trash_root_type", "trash_root_id") WHERE ("trashed_at" IS NOT NULL);



CREATE INDEX "team_task_intake_batches_profile_id_idx" ON "public"."team_task_intake_batches" USING "btree" ("profile_id");



CREATE INDEX "team_task_intake_tokens_active_profile_idx" ON "public"."team_task_intake_tokens" USING "btree" ("profile_id", "expires_at") WHERE ("revoked_at" IS NULL);



CREATE INDEX "team_task_intake_tokens_profile_id_idx" ON "public"."team_task_intake_tokens" USING "btree" ("profile_id");



CREATE INDEX "team_workweek_google_series_publication_idx" ON "public"."team_workweek_google_series" USING "btree" ("publication_id", "state", "id");



CREATE INDEX "team_workweek_google_series_transitions_activation_idx" ON "public"."team_workweek_google_series_transitions" USING "btree" ("activation_publication_id", "state", "id");



CREATE INDEX "team_workweek_publications_owner_effective_idx" ON "public"."team_workweek_publications" USING "btree" ("owner_profile_id", "effective_from" DESC, "publication_revision" DESC, "id" DESC);



CREATE UNIQUE INDEX "team_workweek_publications_owner_revision_unique" ON "public"."team_workweek_publications" USING "btree" ("owner_profile_id", "publication_revision");



CREATE UNIQUE INDEX "team_workweek_versions_google_reconciliation_unique" ON "public"."team_workweek_versions" USING "btree" ("google_reconciliation_source_publication_id", "google_reconciliation_fingerprint") WHERE ("origin" = 'google_reconciliation'::"text");



CREATE INDEX "team_workweek_versions_owner_created_idx" ON "public"."team_workweek_versions" USING "btree" ("owner_profile_id", "created_at" DESC, "id" DESC);



CREATE INDEX "team_workweek_windows_version_day_idx" ON "public"."team_workweek_windows" USING "btree" ("version_id", "weekday", "start_minute", "end_minute");



CREATE OR REPLACE TRIGGER "assign_profile_color_before_insert" BEFORE INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."assign_profile_color_on_insert"();



CREATE OR REPLACE TRIGGER "enforce_team_workweek_version_boundary" BEFORE INSERT ON "public"."team_workweek_versions" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_team_workweek_version_boundary"();



CREATE OR REPLACE TRIGGER "github_issue_sync_lock_task_capability" BEFORE INSERT OR UPDATE ON "public"."github_issue_sync_locks" FOR EACH ROW WHEN (("new"."task_id" IS NOT NULL)) EXECUTE FUNCTION "public"."assert_github_delivery_task_capability"();



CREATE OR REPLACE TRIGGER "guard_owner_team_workweek_version_against_reconciliation" BEFORE INSERT ON "public"."team_workweek_versions" FOR EACH ROW EXECUTE FUNCTION "public"."guard_owner_team_workweek_version_against_reconciliation"();



CREATE OR REPLACE TRIGGER "guard_team_workweek_conflict_against_disconnect" BEFORE INSERT OR UPDATE ON "public"."team_workweek_google_conflicts" FOR EACH ROW EXECUTE FUNCTION "public"."guard_team_workweek_conflict_against_disconnect"();



CREATE OR REPLACE TRIGGER "guard_team_workweek_publication_effective_future" BEFORE INSERT ON "public"."team_workweek_publications" FOR EACH ROW EXECUTE FUNCTION "public"."guard_team_workweek_publication_effective_future"();



CREATE OR REPLACE TRIGGER "notification_events_guard_system_resolution" BEFORE UPDATE ON "public"."notification_events" FOR EACH ROW EXECUTE FUNCTION "public"."guard_notification_system_resolution"();



CREATE OR REPLACE TRIGGER "planning_github_lifecycle_task_capability" BEFORE INSERT OR UPDATE ON "public"."planning_github_lifecycle_outbox" FOR EACH ROW EXECUTE FUNCTION "public"."assert_github_delivery_task_capability"();



CREATE OR REPLACE TRIGGER "planning_item_strategy_touch_updated_at" BEFORE UPDATE ON "public"."planning_item_strategy" FOR EACH ROW EXECUTE FUNCTION "public"."touch_planning_item_strategy_updated_at"();



CREATE OR REPLACE TRIGGER "task_activity_insert_compatibility" INSTEAD OF INSERT ON "public"."task_activity" FOR EACH ROW EXECUTE FUNCTION "public"."insert_legacy_task_activity_as_audit"();



CREATE OR REPLACE TRIGGER "task_comment_github_delivery_capability" BEFORE INSERT OR UPDATE ON "public"."task_comment_github_deliveries" FOR EACH ROW EXECUTE FUNCTION "public"."assert_github_delivery_task_capability"();



CREATE OR REPLACE TRIGGER "tasks_github_comment_notification_watermark" BEFORE INSERT OR UPDATE OF "task_type", "github_repo", "github_issue_number", "issue_number", "github_issue_url", "issue_url" ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."set_github_comment_notification_watermark"();



CREATE OR REPLACE TRIGGER "tasks_guard_locked_sub_issue_parent" BEFORE INSERT OR UPDATE OF "parent_task_id" ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."guard_locked_sub_issue_parent"();



CREATE OR REPLACE TRIGGER "tasks_guard_trash_mutation" BEFORE INSERT OR DELETE OR UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."guard_planning_trash_mutation"();



CREATE OR REPLACE TRIGGER "tasks_normalize_approval_state" BEFORE INSERT OR UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_task_approval_state"();



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_actor_profile_id_fkey" FOREIGN KEY ("actor_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."availability"
    ADD CONSTRAINT "availability_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."availability"
    ADD CONSTRAINT "availability_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decision_comments"
    ADD CONSTRAINT "decision_comments_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_log"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decision_comments"
    ADD CONSTRAINT "decision_comments_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."decision_confirmations"
    ADD CONSTRAINT "decision_confirmations_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_log"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decision_confirmations"
    ADD CONSTRAINT "decision_confirmations_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decision_log"
    ADD CONSTRAINT "decision_log_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."decision_task_links"
    ADD CONSTRAINT "decision_task_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."decision_task_links"
    ADD CONSTRAINT "decision_task_links_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_log"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decision_task_links"
    ADD CONSTRAINT "decision_task_links_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback_items"
    ADD CONSTRAINT "feedback_items_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."founder_events"
    ADD CONSTRAINT "founder_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."founder_sprint_scores"
    ADD CONSTRAINT "founder_sprint_scores_finalized_by_fkey" FOREIGN KEY ("finalized_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."founder_sprint_scores"
    ADD CONSTRAINT "founder_sprint_scores_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."founder_sprint_scores"
    ADD CONSTRAINT "founder_sprint_scores_sprint_id_fkey" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."founder_strike_state"
    ADD CONSTRAINT "founder_strike_state_last_evaluated_sprint_id_fkey" FOREIGN KEY ("last_evaluated_sprint_id") REFERENCES "public"."sprints"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."founder_strike_state"
    ADD CONSTRAINT "founder_strike_state_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."github_app_user_tokens"
    ADD CONSTRAINT "github_app_user_tokens_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."github_issue_sync_locks"
    ADD CONSTRAINT "github_issue_sync_locks_locked_by_profile_id_fkey" FOREIGN KEY ("locked_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."github_issue_sync_locks"
    ADD CONSTRAINT "github_issue_sync_locks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."google_workspace_connections"
    ADD CONSTRAINT "google_workspace_connections_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."google_workspace_disconnect_operations"
    ADD CONSTRAINT "google_workspace_disconnect_operations_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."google_workspace_disconnect_operations"
    ADD CONSTRAINT "google_workspace_disconnect_operations_retained_version_id_fkey" FOREIGN KEY ("retained_version_id") REFERENCES "public"."team_workweek_versions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."google_workspace_disconnect_series"
    ADD CONSTRAINT "google_workspace_disconnect_series_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "public"."google_workspace_disconnect_operations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."google_workspace_disconnect_series"
    ADD CONSTRAINT "google_workspace_disconnect_series_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "public"."team_workweek_google_series"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."meeting_attendance"
    ADD CONSTRAINT "meeting_attendance_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."meeting_attendance"
    ADD CONSTRAINT "meeting_attendance_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."meetings"
    ADD CONSTRAINT "meetings_sprint_id_fkey" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_deliveries"
    ADD CONSTRAINT "notification_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."notification_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_events"
    ADD CONSTRAINT "notification_events_actor_profile_id_fkey" FOREIGN KEY ("actor_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notification_events"
    ADD CONSTRAINT "notification_events_recipient_profile_id_fkey" FOREIGN KEY ("recipient_profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."planning_github_projection_outbox"
    ADD CONSTRAINT "planning_github_projection_outbox_actor_profile_id_fkey" FOREIGN KEY ("actor_profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."planning_github_projection_outbox"
    ADD CONSTRAINT "planning_github_projection_outbox_source_delivery_id_fkey" FOREIGN KEY ("source_delivery_id") REFERENCES "public"."github_planning_webhook_deliveries"("delivery_id");



ALTER TABLE ONLY "public"."planning_github_projection_outbox"
    ADD CONSTRAINT "planning_github_projection_outbox_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."planning_item_raci_assignments"
    ADD CONSTRAINT "planning_item_raci_assignments_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."planning_item_raci_assignments"
    ADD CONSTRAINT "planning_item_raci_assignments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."planning_item_strategy"
    ADD CONSTRAINT "planning_item_strategy_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_feature_tour_acknowledgements"
    ADD CONSTRAINT "profile_feature_tour_acknowledgements_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_ui_preferences"
    ADD CONSTRAINT "profile_ui_preferences_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_deputy_for_fkey" FOREIGN KEY ("deputy_for") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."score_objections"
    ADD CONSTRAINT "score_objections_founder_sprint_score_id_fkey" FOREIGN KEY ("founder_sprint_score_id") REFERENCES "public"."founder_sprint_scores"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."score_objections"
    ADD CONSTRAINT "score_objections_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."score_objections"
    ADD CONSTRAINT "score_objections_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."score_objections"
    ADD CONSTRAINT "score_objections_second_reviewer_profile_id_fkey" FOREIGN KEY ("second_reviewer_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."score_objections"
    ADD CONSTRAINT "score_objections_sprint_id_fkey" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sprint_commitments"
    ADD CONSTRAINT "sprint_commitments_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sprint_commitments"
    ADD CONSTRAINT "sprint_commitments_sprint_id_fkey" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sprints"
    ADD CONSTRAINT "sprints_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."strike_events"
    ADD CONSTRAINT "strike_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."strike_events"
    ADD CONSTRAINT "strike_events_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."strike_events"
    ADD CONSTRAINT "strike_events_sprint_id_fkey" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_blockers"
    ADD CONSTRAINT "task_blockers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_blockers"
    ADD CONSTRAINT "task_blockers_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_comment_github_deliveries"
    ADD CONSTRAINT "task_comment_github_deliveries_task_comment_id_fkey" FOREIGN KEY ("task_comment_id") REFERENCES "public"."task_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_comment_github_deliveries"
    ADD CONSTRAINT "task_comment_github_deliveries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_deletion_operations"
    ADD CONSTRAINT "task_deletion_operations_actor_profile_id_fkey" FOREIGN KEY ("actor_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_dependencies"
    ADD CONSTRAINT "task_dependencies_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_external_comments"
    ADD CONSTRAINT "task_external_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_focus_items"
    ADD CONSTRAINT "task_focus_items_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_focus_items"
    ADD CONSTRAINT "task_focus_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_intake_tokens"
    ADD CONSTRAINT "task_intake_tokens_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_links"
    ADD CONSTRAINT "task_links_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_notes"
    ADD CONSTRAINT "task_notes_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_relationship_edges"
    ADD CONSTRAINT "task_relationship_edges_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_relationship_edges"
    ADD CONSTRAINT "task_relationship_edges_related_task_id_fkey" FOREIGN KEY ("related_task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_relationship_edges"
    ADD CONSTRAINT "task_relationship_edges_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_reviews"
    ADD CONSTRAINT "task_reviews_reviewer_profile_id_fkey" FOREIGN KEY ("reviewer_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_reviews"
    ADD CONSTRAINT "task_reviews_sprint_id_fkey" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_reviews"
    ADD CONSTRAINT "task_reviews_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_carried_from_sprint_id_fkey" FOREIGN KEY ("carried_from_sprint_id") REFERENCES "public"."sprints"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_carried_from_task_id_fkey" FOREIGN KEY ("carried_from_task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_intake_decided_by_fkey" FOREIGN KEY ("intake_decided_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_original_sprint_id_fkey" FOREIGN KEY ("original_sprint_id") REFERENCES "public"."sprints"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_owner_fkey" FOREIGN KEY ("owner") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_proposed_by_fkey" FOREIGN KEY ("proposed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_review_owner_profile_id_fkey" FOREIGN KEY ("review_owner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_trashed_by_fkey" FOREIGN KEY ("trashed_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."team_planning_item_delete_requests"
    ADD CONSTRAINT "team_planning_item_delete_requests_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."team_planning_item_delete_requests"
    ADD CONSTRAINT "team_planning_item_delete_requests_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "public"."team_task_intake_tokens"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_planning_item_update_requests"
    ADD CONSTRAINT "team_planning_item_update_requests_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."team_planning_item_update_requests"
    ADD CONSTRAINT "team_planning_item_update_requests_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "public"."team_task_intake_tokens"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_task_intake_batches"
    ADD CONSTRAINT "team_task_intake_batches_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."team_task_intake_batches"
    ADD CONSTRAINT "team_task_intake_batches_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "public"."team_task_intake_tokens"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."team_task_intake_batches"
    ADD CONSTRAINT "team_task_intake_batches_token_profile_fk" FOREIGN KEY ("token_id", "profile_id") REFERENCES "public"."team_task_intake_tokens"("id", "profile_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."team_task_intake_tokens"
    ADD CONSTRAINT "team_task_intake_tokens_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_workweek_google_conflicts"
    ADD CONSTRAINT "team_workweek_google_conflicts_base_publication_id_fkey" FOREIGN KEY ("base_publication_id") REFERENCES "public"."team_workweek_publications"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."team_workweek_google_conflicts"
    ADD CONSTRAINT "team_workweek_google_conflicts_founderops_version_id_fkey" FOREIGN KEY ("founderops_version_id") REFERENCES "public"."team_workweek_versions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."team_workweek_google_conflicts"
    ADD CONSTRAINT "team_workweek_google_conflicts_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_workweek_google_conflicts"
    ADD CONSTRAINT "team_workweek_google_conflicts_resolution_version_id_fkey" FOREIGN KEY ("resolution_version_id") REFERENCES "public"."team_workweek_versions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."team_workweek_google_reconciliation_status"
    ADD CONSTRAINT "team_workweek_google_reconciliation_statu_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_workweek_google_reconciliation_status"
    ADD CONSTRAINT "team_workweek_google_reconciliation_status_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "public"."team_workweek_publications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_workweek_google_series"
    ADD CONSTRAINT "team_workweek_google_series_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_workweek_google_series"
    ADD CONSTRAINT "team_workweek_google_series_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "public"."team_workweek_publications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_workweek_google_series"
    ADD CONSTRAINT "team_workweek_google_series_source_window_id_fkey" FOREIGN KEY ("source_window_id") REFERENCES "public"."team_workweek_windows"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."team_workweek_google_series_transitions"
    ADD CONSTRAINT "team_workweek_google_series_tran_activation_publication_id_fkey" FOREIGN KEY ("activation_publication_id") REFERENCES "public"."team_workweek_publications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_workweek_google_series_transitions"
    ADD CONSTRAINT "team_workweek_google_series_transiti_predecessor_series_id_fkey" FOREIGN KEY ("predecessor_series_id") REFERENCES "public"."team_workweek_google_series"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."team_workweek_google_series_transitions"
    ADD CONSTRAINT "team_workweek_google_series_transitions_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_workweek_publications"
    ADD CONSTRAINT "team_workweek_publications_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_workweek_publications"
    ADD CONSTRAINT "team_workweek_publications_predecessor_publication_id_fkey" FOREIGN KEY ("predecessor_publication_id") REFERENCES "public"."team_workweek_publications"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."team_workweek_publications"
    ADD CONSTRAINT "team_workweek_publications_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "public"."team_workweek_versions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."team_workweek_publications"
    ADD CONSTRAINT "team_workweek_publications_superseded_by_publication_id_fkey" FOREIGN KEY ("superseded_by_publication_id") REFERENCES "public"."team_workweek_publications"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."team_workweek_versions"
    ADD CONSTRAINT "team_workweek_versions_google_reconciliation_source_public_fkey" FOREIGN KEY ("google_reconciliation_source_publication_id") REFERENCES "public"."team_workweek_publications"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."team_workweek_versions"
    ADD CONSTRAINT "team_workweek_versions_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_workweek_windows"
    ADD CONSTRAINT "team_workweek_windows_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "public"."team_workweek_versions"("id") ON DELETE CASCADE;



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_log_insert_operational" ON "public"."audit_log" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



CREATE POLICY "audit_log_select_team" ON "public"."audit_log" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



ALTER TABLE "public"."availability" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "availability_select_team" ON "public"."availability" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "availability_write_operational" ON "public"."availability" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."decision_comments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "decision_comments_insert_team" ON "public"."decision_comments" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



CREATE POLICY "decision_comments_select_team" ON "public"."decision_comments" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



ALTER TABLE "public"."decision_confirmations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "decision_confirmations_insert_team" ON "public"."decision_confirmations" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



CREATE POLICY "decision_confirmations_select_team" ON "public"."decision_confirmations" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



ALTER TABLE "public"."decision_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "decision_log_select_team" ON "public"."decision_log" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "decision_log_write_ceo" ON "public"."decision_log" TO "authenticated" USING ((("public"."current_platform_role"() = 'ceo'::"text") AND ("status" <> 'locked'::"text"))) WITH CHECK (("public"."current_platform_role"() = 'ceo'::"text"));



ALTER TABLE "public"."decision_task_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "decision_task_links_select_team" ON "public"."decision_task_links" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "decision_task_links_write_team" ON "public"."decision_task_links" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."feedback_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feedback_items_insert_team" ON "public"."feedback_items" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



CREATE POLICY "feedback_items_select_team" ON "public"."feedback_items" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "feedback_items_update_operational" ON "public"."feedback_items" FOR UPDATE TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."fmd_tools" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fmd_tools_delete_operational" ON "public"."fmd_tools" FOR DELETE TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



CREATE POLICY "fmd_tools_insert_team" ON "public"."fmd_tools" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



CREATE POLICY "fmd_tools_select_team" ON "public"."fmd_tools" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "fmd_tools_update_team" ON "public"."fmd_tools" FOR UPDATE TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."founder_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "founder_events_select_team" ON "public"."founder_events" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "founder_events_write_members" ON "public"."founder_events" TO "authenticated" USING (("public"."current_profile_role"() = ANY (ARRAY['admin'::"text", 'member'::"text"]))) WITH CHECK (("public"."current_profile_role"() = ANY (ARRAY['admin'::"text", 'member'::"text"])));



ALTER TABLE "public"."founder_sprint_scores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "founder_sprint_scores_select_team" ON "public"."founder_sprint_scores" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "founder_sprint_scores_write_operational" ON "public"."founder_sprint_scores" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."founder_strike_state" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "founder_strike_state_select_team" ON "public"."founder_strike_state" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "founder_strike_state_write_operational" ON "public"."founder_strike_state" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."github_app_user_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."github_issue_sync_locks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."github_planning_webhook_deliveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."github_webhook_deliveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."google_workspace_connections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."google_workspace_disconnect_operations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."google_workspace_disconnect_series" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."meeting_attendance" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "meeting_attendance_select_team" ON "public"."meeting_attendance" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "meeting_attendance_write_team" ON "public"."meeting_attendance" TO "authenticated" USING ((("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])) OR ("profile_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"()))))) WITH CHECK ((("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])) OR ("profile_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"())))));



ALTER TABLE "public"."meetings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "meetings_select_team" ON "public"."meetings" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "meetings_write_operational" ON "public"."meetings" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



CREATE POLICY "meetings_write_team" ON "public"."meetings" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text", 'founder'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text", 'founder'::"text"])));



ALTER TABLE "public"."notification_deliveries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_deliveries_select_operational" ON "public"."notification_deliveries" FOR SELECT TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



CREATE POLICY "notification_deliveries_write_operational" ON "public"."notification_deliveries" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."notification_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_events_insert_team" ON "public"."notification_events" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



CREATE POLICY "notification_events_select_team" ON "public"."notification_events" FOR SELECT TO "authenticated" USING ((("auth"."uid"() IS NOT NULL) AND (("recipient_profile_id" = "public"."current_profile_id"()) OR (("recipient_profile_id" IS NULL) AND ("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"]))))));



CREATE POLICY "notification_events_update_recipient" ON "public"."notification_events" FOR UPDATE TO "authenticated" USING ((("recipient_profile_id" = "public"."current_profile_id"()) OR (("recipient_profile_id" IS NULL) AND ("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"]))))) WITH CHECK ((("recipient_profile_id" = "public"."current_profile_id"()) OR (("recipient_profile_id" IS NULL) AND ("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])))));



ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_preferences_select_team" ON "public"."notification_preferences" FOR SELECT TO "authenticated" USING ((("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])) OR ("profile_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"())))));



CREATE POLICY "notification_preferences_write_self_or_operational" ON "public"."notification_preferences" TO "authenticated" USING ((("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])) OR ("profile_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"()))))) WITH CHECK ((("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])) OR ("profile_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"())))));



ALTER TABLE "public"."planning_github_lifecycle_outbox" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."planning_github_projection_outbox" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."planning_item_historical_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "planning_item_historical_links_select_team" ON "public"."planning_item_historical_links" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



ALTER TABLE "public"."planning_item_raci_assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "planning_item_raci_assignments_select_team" ON "public"."planning_item_raci_assignments" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



ALTER TABLE "public"."planning_item_strategy" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "planning_item_strategy_select_team" ON "public"."planning_item_strategy" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



ALTER TABLE "public"."platform_releases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "platform_releases_select_team" ON "public"."platform_releases" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



ALTER TABLE "public"."profile_feature_tour_acknowledgements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profile_feature_tour_acknowledgements_select_self_or_operationa" ON "public"."profile_feature_tour_acknowledgements" FOR SELECT TO "authenticated" USING ((("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])) OR ("profile_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"())))));



CREATE POLICY "profile_feature_tour_acknowledgements_write_self" ON "public"."profile_feature_tour_acknowledgements" TO "authenticated" USING (("profile_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"())))) WITH CHECK (("profile_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"()))));



ALTER TABLE "public"."profile_ui_preferences" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profile_ui_preferences_select_self_or_operational" ON "public"."profile_ui_preferences" FOR SELECT TO "authenticated" USING ((("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])) OR ("profile_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"())))));



CREATE POLICY "profile_ui_preferences_write_self" ON "public"."profile_ui_preferences" TO "authenticated" USING (("profile_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"())))) WITH CHECK (("profile_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"()))));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_team" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "profiles_update_self_or_admin" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "projects_select_team" ON "public"."projects" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "projects_write_admin" ON "public"."projects" TO "authenticated" USING (("public"."current_profile_role"() = 'admin'::"text")) WITH CHECK (("public"."current_profile_role"() = 'admin'::"text"));



ALTER TABLE "public"."score_objections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "score_objections_insert_founder" ON "public"."score_objections" FOR INSERT TO "authenticated" WITH CHECK ((("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])) AND ("profile_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"())))));



CREATE POLICY "score_objections_select_team" ON "public"."score_objections" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "score_objections_update_operational" ON "public"."score_objections" FOR UPDATE TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."sprint_commitments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sprint_commitments_select_team" ON "public"."sprint_commitments" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "sprint_commitments_write_team" ON "public"."sprint_commitments" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."sprints" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sprints_select_team" ON "public"."sprints" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "sprints_write_operational" ON "public"."sprints" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."strike_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "strike_events_insert_operational" ON "public"."strike_events" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



CREATE POLICY "strike_events_select_team" ON "public"."strike_events" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



ALTER TABLE "public"."task_blockers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_blockers_select_team" ON "public"."task_blockers" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "task_blockers_write_team" ON "public"."task_blockers" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."task_comment_github_deliveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_comments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_comments_insert_team" ON "public"."task_comments" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



CREATE POLICY "task_comments_select_team" ON "public"."task_comments" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



ALTER TABLE "public"."task_deletion_operations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_dependencies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_dependencies_select_team" ON "public"."task_dependencies" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "task_dependencies_write_members" ON "public"."task_dependencies" TO "authenticated" USING (("public"."current_profile_role"() = ANY (ARRAY['admin'::"text", 'member'::"text"]))) WITH CHECK (("public"."current_profile_role"() = ANY (ARRAY['admin'::"text", 'member'::"text"])));



ALTER TABLE "public"."task_external_comments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_external_comments_insert_members" ON "public"."task_external_comments" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



CREATE POLICY "task_external_comments_select_team" ON "public"."task_external_comments" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "task_external_comments_update_members" ON "public"."task_external_comments" FOR UPDATE TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."task_focus_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_focus_items_select_team" ON "public"."task_focus_items" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "task_focus_items_write_team" ON "public"."task_focus_items" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."task_intake_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_links_select_team" ON "public"."task_links" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "task_links_write_members" ON "public"."task_links" TO "authenticated" USING (("public"."current_profile_role"() = ANY (ARRAY['admin'::"text", 'member'::"text"]))) WITH CHECK (("public"."current_profile_role"() = ANY (ARRAY['admin'::"text", 'member'::"text"])));



ALTER TABLE "public"."task_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_notes_select_team" ON "public"."task_notes" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "task_notes_write_members" ON "public"."task_notes" TO "authenticated" USING (("public"."current_profile_role"() = ANY (ARRAY['admin'::"text", 'member'::"text"]))) WITH CHECK (("public"."current_profile_role"() = ANY (ARRAY['admin'::"text", 'member'::"text"])));



ALTER TABLE "public"."task_relationship_edges" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_relationship_edges_delete_authorized" ON "public"."task_relationship_edges" FOR DELETE TO "authenticated" USING ((("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])) OR (("public"."current_platform_role"() = 'founder'::"text") AND ("relation_type" = 'blocked_by'::"text") AND (EXISTS ( SELECT 1
   FROM (("public"."tasks" "item"
     LEFT JOIN "public"."tasks" "deliverable" ON ((("deliverable"."id" = "item"."parent_task_id") AND ("item"."task_type" = 'sub_issue'::"text"))))
     LEFT JOIN "public"."tasks" "initiative" ON (("initiative"."id" =
        CASE
            WHEN ("item"."task_type" = 'deliverable'::"text") THEN "item"."parent_task_id"
            WHEN ("item"."task_type" = 'sub_issue'::"text") THEN "deliverable"."parent_task_id"
            ELSE NULL::"text"
        END)))
  WHERE (("item"."id" = "task_relationship_edges"."task_id") AND ("item"."task_type" = ANY (ARRAY['deliverable'::"text", 'sub_issue'::"text"])) AND (("item"."assignee" = "public"."current_profile_id"()) OR ("item"."owner" = "public"."current_profile_id"()) OR ("initiative"."owner" = "public"."current_profile_id"()) OR (EXISTS ( SELECT 1
           FROM "public"."planning_item_raci_assignments" "raci"
          WHERE (("raci"."task_id" = "initiative"."id") AND ("raci"."role" = 'accountable'::"text") AND ("raci"."profile_id" = "public"."current_profile_id"())))))))))));



CREATE POLICY "task_relationship_edges_insert_authorized" ON "public"."task_relationship_edges" FOR INSERT TO "authenticated" WITH CHECK ((("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])) OR (("public"."current_platform_role"() = 'founder'::"text") AND ("relation_type" = 'blocked_by'::"text") AND ("created_by" = "public"."current_profile_id"()) AND (EXISTS ( SELECT 1
   FROM (("public"."tasks" "item"
     LEFT JOIN "public"."tasks" "deliverable" ON ((("deliverable"."id" = "item"."parent_task_id") AND ("item"."task_type" = 'sub_issue'::"text"))))
     LEFT JOIN "public"."tasks" "initiative" ON (("initiative"."id" =
        CASE
            WHEN ("item"."task_type" = 'deliverable'::"text") THEN "item"."parent_task_id"
            WHEN ("item"."task_type" = 'sub_issue'::"text") THEN "deliverable"."parent_task_id"
            ELSE NULL::"text"
        END)))
  WHERE (("item"."id" = "task_relationship_edges"."task_id") AND ("item"."task_type" = ANY (ARRAY['deliverable'::"text", 'sub_issue'::"text"])) AND (("item"."assignee" = "public"."current_profile_id"()) OR ("item"."owner" = "public"."current_profile_id"()) OR ("initiative"."owner" = "public"."current_profile_id"()) OR (EXISTS ( SELECT 1
           FROM "public"."planning_item_raci_assignments" "raci"
          WHERE (("raci"."task_id" = "initiative"."id") AND ("raci"."role" = 'accountable'::"text") AND ("raci"."profile_id" = "public"."current_profile_id"())))))))))));



CREATE POLICY "task_relationship_edges_select_team" ON "public"."task_relationship_edges" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "task_relationship_edges_update_operational" ON "public"."task_relationship_edges" FOR UPDATE TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."task_reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_reviews_select_team" ON "public"."task_reviews" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



CREATE POLICY "task_reviews_write_founders" ON "public"."task_reviews" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tasks_select_team" ON "public"."tasks" FOR SELECT TO "authenticated" USING (("public"."current_profile_id"() IS NOT NULL));



ALTER TABLE "public"."team_planning_item_delete_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_planning_item_update_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_task_intake_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_task_intake_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_workweek_google_conflicts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_workweek_google_reconciliation_status" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "team_workweek_google_reconciliation_status_select_owner_private" ON "public"."team_workweek_google_reconciliation_status" FOR SELECT TO "authenticated" USING ((("owner_profile_id" = "public"."current_profile_id"()) AND ("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"]))));



ALTER TABLE "public"."team_workweek_google_series" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "team_workweek_google_series_select_owner_private" ON "public"."team_workweek_google_series" FOR SELECT TO "authenticated" USING ((("owner_profile_id" = "public"."current_profile_id"()) AND ("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"]))));



ALTER TABLE "public"."team_workweek_google_series_transitions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "team_workweek_google_series_transitions_select_owner_private" ON "public"."team_workweek_google_series_transitions" FOR SELECT TO "authenticated" USING ((("owner_profile_id" = "public"."current_profile_id"()) AND ("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"]))));



ALTER TABLE "public"."team_workweek_publications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "team_workweek_publications_select_owner_or_published_team" ON "public"."team_workweek_publications" FOR SELECT TO "authenticated" USING (((("owner_profile_id" = "public"."current_profile_id"()) AND ("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"]))) OR (("status" = 'published'::"text") AND ("public"."current_profile_id"() IS NOT NULL))));



ALTER TABLE "public"."team_workweek_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "team_workweek_versions_select_owner_private" ON "public"."team_workweek_versions" FOR SELECT TO "authenticated" USING ((("owner_profile_id" = "public"."current_profile_id"()) AND ("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"]))));



ALTER TABLE "public"."team_workweek_windows" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "team_workweek_windows_select_owner_private" ON "public"."team_workweek_windows" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."team_workweek_versions" "version"
  WHERE (("version"."id" = "team_workweek_windows"."version_id") AND ("version"."owner_profile_id" = "public"."current_profile_id"()) AND ("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"]))))));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";




























































































































































REVOKE ALL ON FUNCTION "public"."apply_github_issue_comment_webhook_projection"("p_delivery_id" "text", "p_lock_token" "uuid", "p_operation" "text", "p_task_id" "text", "p_comment_updated_at" timestamp with time zone, "p_author_login" "text", "p_author_avatar_url" "text", "p_body" "text", "p_html_url" "text", "p_created_at" timestamp with time zone, "p_imported_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_github_issue_comment_webhook_projection"("p_delivery_id" "text", "p_lock_token" "uuid", "p_operation" "text", "p_task_id" "text", "p_comment_updated_at" timestamp with time zone, "p_author_login" "text", "p_author_avatar_url" "text", "p_body" "text", "p_html_url" "text", "p_created_at" timestamp with time zone, "p_imported_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_github_issue_comment_webhook_projection_with_mentions"("p_delivery_id" "text", "p_lock_token" "uuid", "p_operation" "text", "p_task_id" "text", "p_comment_updated_at" timestamp with time zone, "p_author_login" "text", "p_author_avatar_url" "text", "p_body" "text", "p_html_url" "text", "p_created_at" timestamp with time zone, "p_imported_at" timestamp with time zone, "p_actor_profile_id" "text", "p_mention_recipient_profile_ids" "text"[], "p_baseline_mention_recipient_profile_ids" "text"[], "p_baseline_source_updated_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_github_issue_comment_webhook_projection_with_mentions"("p_delivery_id" "text", "p_lock_token" "uuid", "p_operation" "text", "p_task_id" "text", "p_comment_updated_at" timestamp with time zone, "p_author_login" "text", "p_author_avatar_url" "text", "p_body" "text", "p_html_url" "text", "p_created_at" timestamp with time zone, "p_imported_at" timestamp with time zone, "p_actor_profile_id" "text", "p_mention_recipient_profile_ids" "text"[], "p_baseline_mention_recipient_profile_ids" "text"[], "p_baseline_source_updated_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_google_team_workweek_observations"("p_publication_id" "uuid", "p_publication_revision" integer, "p_observations" "jsonb", "p_observed_at" timestamp with time zone) FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."apply_profile_color_change"("p_profile_id" "text", "p_requested_color" "text", "p_duplicate_mode_observed" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_profile_color_change"("p_profile_id" "text", "p_requested_color" "text", "p_duplicate_mode_observed" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."assert_github_delivery_task_capability"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."assign_backlog_tasks_to_sprint_transaction"("p_assignments" "jsonb", "p_sprint_id" "text", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assign_backlog_tasks_to_sprint_transaction"("p_assignments" "jsonb", "p_sprint_id" "text", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."assign_profile_color_on_insert"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."authenticate_team_planning_items_token"("p_token_hash" "text", "p_scope" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."authenticate_team_planning_items_token"("p_token_hash" "text", "p_scope" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."authenticate_team_task_intake_token"("p_token_hash" "text", "p_scope" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."authenticate_team_task_intake_token"("p_token_hash" "text", "p_scope" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."begin_github_issue_sync_transaction"("p_task_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."begin_github_issue_sync_transaction"("p_task_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."begin_github_issue_sync_transaction_v2"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."begin_github_issue_sync_transaction_v2"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_task_deletion_transaction"("p_operation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_task_deletion_transaction"("p_operation_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_github_issue_comment_webhook_delivery"("p_delivery_id" "text", "p_lock_token" "uuid", "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_github_issue_comment_webhook_delivery"("p_delivery_id" "text", "p_lock_token" "uuid", "p_lease_seconds" integer) TO "service_role";



GRANT SELECT,INSERT ON TABLE "public"."github_planning_webhook_deliveries" TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_github_planning_webhook_delivery"("p_delivery_id" "text", "p_lock_token" "uuid", "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_github_planning_webhook_delivery"("p_delivery_id" "text", "p_lock_token" "uuid", "p_lease_seconds" integer) TO "service_role";



GRANT ALL ON SEQUENCE "public"."planning_github_delivery_sequence" TO "service_role";



GRANT ALL ON TABLE "public"."planning_github_lifecycle_outbox" TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_planning_github_lifecycle_jobs"("p_lock_token" "uuid", "p_limit" integer, "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_planning_github_lifecycle_jobs"("p_lock_token" "uuid", "p_limit" integer, "p_lease_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_planning_github_lifecycle_jobs_for_root"("p_lock_token" "uuid", "p_root_type" "text", "p_root_id" "text", "p_task_ids" "text"[], "p_limit" integer, "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_planning_github_lifecycle_jobs_for_root"("p_lock_token" "uuid", "p_root_type" "text", "p_root_id" "text", "p_task_ids" "text"[], "p_limit" integer, "p_lease_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_planning_github_lifecycle_jobs_transaction"("p_lock_token" "uuid", "p_limit" integer, "p_lease_seconds" integer, "p_root_type" "text", "p_root_id" "text", "p_task_ids" "text"[]) FROM PUBLIC;



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."planning_github_projection_outbox" TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_planning_github_projection_requests"("p_lock_token" "uuid", "p_limit" integer, "p_lease_seconds" integer, "p_operation_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_planning_github_projection_requests"("p_lock_token" "uuid", "p_limit" integer, "p_lease_seconds" integer, "p_operation_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_task_comment_github_deliveries"("p_lock_token" "text", "p_task_id" "text", "p_author_profile_id" "text", "p_limit" integer, "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_task_comment_github_deliveries"("p_lock_token" "text", "p_task_id" "text", "p_author_profile_id" "text", "p_limit" integer, "p_lease_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_google_workspace_disconnect"("p_operation_id" "uuid", "p_owner_profile_id" "text", "p_completed_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_google_workspace_disconnect"("p_operation_id" "uuid", "p_owner_profile_id" "text", "p_completed_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_team_workweek_google_conflict_resolution"("p_conflict_id" "uuid", "p_owner_profile_id" "text", "p_conflict_revision" integer, "p_resolved_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_team_workweek_google_conflict_resolution"("p_conflict_id" "uuid", "p_owner_profile_id" "text", "p_conflict_revision" integer, "p_resolved_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_google_team_workweek_observation"("p_publication_id" "uuid", "p_publication_revision" integer, "p_observations" "jsonb", "p_observed_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_google_team_workweek_observation"("p_publication_id" "uuid", "p_publication_revision" integer, "p_observations" "jsonb", "p_observed_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_google_workspace_disconnect_series"("p_target_id" "uuid", "p_expected_etag" "text", "p_confirmed_etag" "text", "p_observed_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_google_workspace_disconnect_series"("p_target_id" "uuid", "p_expected_etag" "text", "p_confirmed_etag" "text", "p_observed_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_team_workweek_google_series"("p_series_id" "uuid", "p_etag" "text", "p_founderops_revision" integer, "p_observed_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_team_workweek_google_series"("p_series_id" "uuid", "p_etag" "text", "p_founderops_revision" integer, "p_observed_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_team_workweek_google_series_transition"("p_transition_id" "uuid", "p_etag" "text", "p_expected_founderops_revision" integer, "p_observed_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_team_workweek_google_series_transition"("p_transition_id" "uuid", "p_etag" "text", "p_expected_founderops_revision" integer, "p_observed_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_browser_planning_item_transaction"("p_item" "jsonb", "p_strategy" "jsonb", "p_raci_assignments" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_browser_planning_item_transaction"("p_item" "jsonb", "p_strategy" "jsonb", "p_raci_assignments" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_planning_item_transaction"("p_item" "jsonb", "p_strategy" "jsonb", "p_raci_assignments" "jsonb", "p_actor_profile_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_planning_item_transaction"("p_item" "jsonb", "p_strategy" "jsonb", "p_raci_assignments" "jsonb", "p_actor_profile_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_planning_task_transaction"("p_task_insert" "jsonb", "p_relation_type" "text", "p_related_task_id" "text", "p_relation_note" "text", "p_activity_message" "text", "p_relation_activity_message" "text", "p_notifications" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text", "p_approve_now" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_planning_task_transaction"("p_task_insert" "jsonb", "p_relation_type" "text", "p_related_task_id" "text", "p_relation_note" "text", "p_activity_message" "text", "p_relation_activity_message" "text", "p_notifications" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text", "p_approve_now" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_private_team_workweek_version"("p_effective_from" "date", "p_windows" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_private_team_workweek_version"("p_effective_from" "date", "p_windows" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_score_objection_transaction"("p_sprint_id" "text", "p_profile_id" "text", "p_comment" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_score_objection_transaction"("p_sprint_id" "text", "p_profile_id" "text", "p_comment" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_sprint_plan_transaction"("p_sprints" "jsonb", "p_meetings" "jsonb", "p_audit_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_sprint_plan_transaction"("p_sprints" "jsonb", "p_meetings" "jsonb", "p_audit_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_sprint_plan_with_review_window_transaction"("p_project_id" "text", "p_sprints" "jsonb", "p_meetings" "jsonb", "p_audit_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_sprint_plan_with_review_window_transaction"("p_project_id" "text", "p_sprints" "jsonb", "p_meetings" "jsonb", "p_audit_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_task_comment_local"("p_task_id" "text", "p_profile_id" "text", "p_comment" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_task_comment_local"("p_task_id" "text", "p_profile_id" "text", "p_comment" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_task_comment_with_github_delivery"("p_task_id" "text", "p_profile_id" "text", "p_comment" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_task_comment_with_github_delivery"("p_task_id" "text", "p_profile_id" "text", "p_comment" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_task_comment_with_notifications"("p_task_id" "text", "p_profile_id" "text", "p_comment" "text", "p_deliver_to_github" boolean, "p_mention_recipient_profile_ids" "text"[], "p_comment_recipient_profile_ids" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_task_comment_with_notifications"("p_task_id" "text", "p_profile_id" "text", "p_comment" "text", "p_deliver_to_github" boolean, "p_mention_recipient_profile_ids" "text"[], "p_comment_recipient_profile_ids" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_task_transaction"("p_task_insert" "jsonb", "p_relation_type" "text", "p_related_task_id" "text", "p_relation_note" "text", "p_activity_message" "text", "p_relation_activity_message" "text", "p_notifications" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_task_transaction"("p_task_insert" "jsonb", "p_relation_type" "text", "p_related_task_id" "text", "p_relation_note" "text", "p_activity_message" "text", "p_relation_activity_message" "text", "p_notifications" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_team_planning_items_token"("p_profile_id" "text", "p_label" "text", "p_token_hash" "text", "p_token_hint" "text", "p_allow_updates" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_team_planning_items_token"("p_profile_id" "text", "p_label" "text", "p_token_hash" "text", "p_token_hint" "text", "p_allow_updates" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_team_planning_items_token_v2"("p_profile_id" "text", "p_label" "text", "p_token_hash" "text", "p_token_hint" "text", "p_allow_updates" boolean, "p_allow_empty_epic_deletes" boolean, "p_allow_github_sync" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_team_planning_items_token_v2"("p_profile_id" "text", "p_label" "text", "p_token_hash" "text", "p_token_hint" "text", "p_allow_updates" boolean, "p_allow_empty_epic_deletes" boolean, "p_allow_github_sync" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_team_planning_items_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_idempotency_key" "uuid", "p_request_hash" "text", "p_items" "jsonb", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_team_planning_items_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_idempotency_key" "uuid", "p_request_hash" "text", "p_items" "jsonb", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_team_planning_items_with_projection_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_idempotency_key" "uuid", "p_request_hash" "text", "p_items" "jsonb", "p_projection_commands" "jsonb", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_team_planning_items_with_projection_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_idempotency_key" "uuid", "p_request_hash" "text", "p_items" "jsonb", "p_projection_commands" "jsonb", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_team_task_intake_token"("p_profile_id" "text", "p_label" "text", "p_token_hash" "text", "p_token_hint" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_team_task_intake_token"("p_profile_id" "text", "p_label" "text", "p_token_hash" "text", "p_token_hint" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_team_workweek_google_conflict"("p_owner_profile_id" "text", "p_base_publication_id" "uuid", "p_base_publication_revision" integer, "p_founderops_version_id" "uuid", "p_google_effective_from" "date", "p_google_windows" "jsonb", "p_google_observations" "jsonb", "p_google_fingerprint" "text", "p_founderops_fingerprint" "text", "p_observed_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_team_workweek_google_conflict"("p_owner_profile_id" "text", "p_base_publication_id" "uuid", "p_base_publication_revision" integer, "p_founderops_version_id" "uuid", "p_google_effective_from" "date", "p_google_windows" "jsonb", "p_google_observations" "jsonb", "p_google_fingerprint" "text", "p_founderops_fingerprint" "text", "p_observed_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_platform_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_platform_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_platform_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_profile_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_profile_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_profile_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_profile_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_profile_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_profile_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."deactivate_team_workweek_for_external_revocation"("p_owner_profile_id" "text", "p_excluded_publication_id" "uuid", "p_observed_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."deactivate_team_workweek_for_external_revocation"("p_owner_profile_id" "text", "p_excluded_publication_id" "uuid", "p_observed_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."decide_planning_item_approval_transaction"("p_task_id" "text", "p_expected_revision" integer, "p_action" "text", "p_actor_profile_id" "text", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decide_planning_item_approval_transaction"("p_task_id" "text", "p_expected_revision" integer, "p_action" "text", "p_actor_profile_id" "text", "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delay_team_workweek_publication"("p_publication_id" "uuid", "p_error_class" "text", "p_observed_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delay_team_workweek_publication"("p_publication_id" "uuid", "p_error_class" "text", "p_observed_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_empty_epic_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_empty_epic_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_empty_epic_with_audit_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_empty_epic_with_audit_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_team_planning_item_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_id" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_team_planning_item_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_id" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_team_workweek_version_boundary"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."enqueue_github_webhook_planning_projection"("p_delivery_id" "text", "p_lock_token" "uuid", "p_task_id" "text", "p_observed_repository_full_name" "text", "p_observed_issue_number" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_github_webhook_planning_projection"("p_delivery_id" "text", "p_lock_token" "uuid", "p_task_id" "text", "p_observed_repository_full_name" "text", "p_observed_issue_number" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_planning_github_projection_request"("p_planning_operation_id" "text", "p_task_id" "text", "p_actor_profile_id" "text", "p_create_if_missing" boolean, "p_receipt_kind" "text", "p_receipt_token_id" "uuid", "p_receipt_idempotency_key" "uuid", "p_receipt_item_index" integer) FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."enqueue_team_planning_github_projection_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_id" "text", "p_idempotency_key" "uuid", "p_create_if_missing" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_team_planning_github_projection_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_id" "text", "p_idempotency_key" "uuid", "p_create_if_missing" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fail_github_issue_sync_transaction"("p_task_id" "text", "p_error_message" "text", "p_activity_message" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fail_github_issue_sync_transaction"("p_task_id" "text", "p_error_message" "text", "p_activity_message" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_github_issue_comment_webhook_delivery"("p_delivery_id" "text", "p_lock_token" "uuid", "p_status" "text", "p_status_reason" "text", "p_last_error" "text", "p_available_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_github_issue_comment_webhook_delivery"("p_delivery_id" "text", "p_lock_token" "uuid", "p_status" "text", "p_status_reason" "text", "p_last_error" "text", "p_available_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_github_issue_sync_transaction"("p_task_id" "text", "p_github_repo" "text", "p_github_issue_number" integer, "p_github_issue_url" "text", "p_synced_at" timestamp with time zone, "p_activity_message" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_github_issue_sync_transaction"("p_task_id" "text", "p_github_repo" "text", "p_github_issue_number" integer, "p_github_issue_url" "text", "p_synced_at" timestamp with time zone, "p_activity_message" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_github_issue_sync_transaction_v2"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_github_repo" "text", "p_github_issue_number" integer, "p_github_issue_url" "text", "p_synced_at" timestamp with time zone, "p_activity_message" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_github_issue_sync_transaction_v2"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_github_repo" "text", "p_github_issue_number" integer, "p_github_issue_url" "text", "p_synced_at" timestamp with time zone, "p_activity_message" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_github_issue_sync_with_pull_requests_v1"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_github_repo" "text", "p_github_issue_number" integer, "p_github_issue_url" "text", "p_synced_at" timestamp with time zone, "p_activity_message" "text", "p_linked_pull_requests" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_github_issue_sync_with_pull_requests_v1"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_github_repo" "text", "p_github_issue_number" integer, "p_github_issue_url" "text", "p_synced_at" timestamp with time zone, "p_activity_message" "text", "p_linked_pull_requests" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_github_planning_webhook_delivery"("p_delivery_id" "text", "p_lock_token" "uuid", "p_status" "text", "p_status_reason" "text", "p_last_error" "text", "p_available_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_github_planning_webhook_delivery"("p_delivery_id" "text", "p_lock_token" "uuid", "p_status" "text", "p_status_reason" "text", "p_last_error" "text", "p_available_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_google_workspace_disconnect"("p_operation_id" "uuid", "p_owner_profile_id" "text", "p_observed_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_google_workspace_disconnect"("p_operation_id" "uuid", "p_owner_profile_id" "text", "p_observed_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_planning_github_lifecycle_job"("p_job_id" "uuid", "p_lock_token" "uuid", "p_succeeded" boolean, "p_error_message" "text", "p_status_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_planning_github_lifecycle_job"("p_job_id" "uuid", "p_lock_token" "uuid", "p_succeeded" boolean, "p_error_message" "text", "p_status_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_planning_github_projection_request"("p_request_id" "uuid", "p_lock_token" "uuid", "p_succeeded" boolean, "p_result" "jsonb", "p_error_message" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_planning_github_projection_request"("p_request_id" "uuid", "p_lock_token" "uuid", "p_succeeded" boolean, "p_result" "jsonb", "p_error_message" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_task_comment_github_delivery"("p_task_comment_id" bigint, "p_lock_token" "text", "p_status" "text", "p_status_reason" "text", "p_github_issue_number" integer, "p_github_comment_id" bigint, "p_github_comment_url" "text", "p_last_error" "text", "p_next_attempt_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_task_comment_github_delivery"("p_task_comment_id" bigint, "p_lock_token" "text", "p_status" "text", "p_status_reason" "text", "p_github_issue_number" integer, "p_github_comment_id" bigint, "p_github_comment_url" "text", "p_last_error" "text", "p_next_attempt_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_task_deletion_transaction"("p_operation_id" "uuid", "p_github_closed" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_task_deletion_transaction"("p_operation_id" "uuid", "p_github_closed" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_team_workweek_publication"("p_publication_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_team_workweek_publication"("p_publication_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."guard_locked_sub_issue_parent"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."guard_notification_system_resolution"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_notification_system_resolution"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_owner_team_workweek_version_against_reconciliation"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."guard_planning_trash_mutation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_planning_trash_mutation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_team_workweek_conflict_against_disconnect"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."guard_team_workweek_publication_effective_future"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."import_github_task_comments_with_mentions"("p_task_id" "text", "p_comments" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_github_task_comments_with_mentions"("p_task_id" "text", "p_comments" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_platform_release_v1"("p_manifest" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_platform_release_v1"("p_manifest" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."insert_legacy_task_activity_as_audit"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."lock_sprint_transaction"("p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_updates" "jsonb", "p_accepted_blocker_task_ids" "text"[], "p_carryover_inserts" "jsonb", "p_notifications" "jsonb", "p_score_rows" "jsonb", "p_strike_state_rows" "jsonb", "p_strike_events" "jsonb", "p_result_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lock_sprint_transaction"("p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_updates" "jsonb", "p_accepted_blocker_task_ids" "text"[], "p_carryover_inserts" "jsonb", "p_notifications" "jsonb", "p_score_rows" "jsonb", "p_strike_state_rows" "jsonb", "p_strike_events" "jsonb", "p_result_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."lock_sprint_with_review_window_transaction"("p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_updates" "jsonb", "p_accepted_blocker_task_ids" "text"[], "p_carryover_inserts" "jsonb", "p_notifications" "jsonb", "p_score_rows" "jsonb", "p_strike_state_rows" "jsonb", "p_strike_events" "jsonb", "p_result_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lock_sprint_with_review_window_transaction"("p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_updates" "jsonb", "p_accepted_blocker_task_ids" "text"[], "p_carryover_inserts" "jsonb", "p_notifications" "jsonb", "p_score_rows" "jsonb", "p_strike_state_rows" "jsonb", "p_strike_events" "jsonb", "p_result_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."move_backlog_task_transaction"("p_task_id" "text", "p_target_task_id" "text", "p_placement" "text", "p_expected_task_updated_at" timestamp with time zone, "p_expected_target_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."move_backlog_task_transaction"("p_task_id" "text", "p_target_task_id" "text", "p_placement" "text", "p_expected_task_updated_at" timestamp with time zone, "p_expected_target_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mutate_planning_approval_command_transaction"("p_task_id" "text", "p_expected_kind" "text", "p_expected_revision" integer, "p_action" "text", "p_actor_profile_id" "text", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mutate_planning_approval_command_transaction"("p_task_id" "text", "p_expected_kind" "text", "p_expected_revision" integer, "p_action" "text", "p_actor_profile_id" "text", "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mutate_planning_relationship_transaction"("p_operation" "text", "p_task_id" "text", "p_related_task_id" "text", "p_relation_type" "text", "p_relation_id" bigint, "p_note" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mutate_planning_relationship_transaction"("p_operation" "text", "p_task_id" "text", "p_related_task_id" "text", "p_relation_type" "text", "p_relation_id" bigint, "p_note" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mutate_planning_relationship_transaction_without_completed_guar"("p_operation" "text", "p_task_id" "text", "p_related_task_id" "text", "p_relation_type" "text", "p_relation_id" bigint, "p_note" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."mutate_planning_reparent_command_transaction"("p_task_id" "text", "p_expected_kind" "text", "p_expected_updated_at" timestamp with time zone, "p_parent_task_id" "text", "p_expected_parent_updated_at" timestamp with time zone, "p_actor_profile_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mutate_planning_reparent_command_transaction"("p_task_id" "text", "p_expected_kind" "text", "p_expected_updated_at" timestamp with time zone, "p_parent_task_id" "text", "p_expected_parent_updated_at" timestamp with time zone, "p_actor_profile_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mutate_planning_reparent_command_transaction_without_completed_"("p_task_id" "text", "p_expected_kind" "text", "p_expected_updated_at" timestamp with time zone, "p_parent_task_id" "text", "p_expected_parent_updated_at" timestamp with time zone, "p_actor_profile_id" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."mutate_planning_review_command_transaction"("p_action" "text", "p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_reviewer_profile_id" "text", "p_decision" "text", "p_comment" "text", "p_checklist" "jsonb", "p_points" integer, "p_reason" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mutate_planning_review_command_transaction"("p_action" "text", "p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_reviewer_profile_id" "text", "p_decision" "text", "p_comment" "text", "p_checklist" "jsonb", "p_points" integer, "p_reason" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mutate_planning_review_command_transaction_without_completed_gu"("p_action" "text", "p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_reviewer_profile_id" "text", "p_decision" "text", "p_comment" "text", "p_checklist" "jsonb", "p_points" integer, "p_reason" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."mutate_planning_trash_command_transaction"("p_action" "text", "p_root_type" "text", "p_root_id" "text", "p_expected_revision" integer, "p_actor_profile_id" "text", "p_reason" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mutate_planning_trash_command_transaction"("p_action" "text", "p_root_type" "text", "p_root_id" "text", "p_expected_revision" integer, "p_actor_profile_id" "text", "p_reason" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mutate_team_planning_reparent_command_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_id" "text", "p_item_type" "text", "p_expected_updated_at" timestamp with time zone, "p_parent_task_id" "text", "p_expected_parent_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_changed_field" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mutate_team_planning_reparent_command_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_id" "text", "p_item_type" "text", "p_expected_updated_at" timestamp with time zone, "p_parent_task_id" "text", "p_expected_parent_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_changed_field" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mutate_team_planning_reparent_with_projection_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_id" "text", "p_item_type" "text", "p_expected_updated_at" timestamp with time zone, "p_parent_task_id" "text", "p_expected_parent_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_changed_field" "text", "p_projection_command" "jsonb", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mutate_team_planning_reparent_with_projection_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_id" "text", "p_item_type" "text", "p_expected_updated_at" timestamp with time zone, "p_parent_task_id" "text", "p_expected_parent_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_changed_field" "text", "p_projection_command" "jsonb", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."normalize_planning_github_issue_reference"("p_task_type" "text", "p_github_repo" "text", "p_github_issue_number" integer, "p_issue_number" "text", "p_github_issue_url" "text", "p_issue_url" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."normalize_planning_github_issue_reference"("p_task_type" "text", "p_github_repo" "text", "p_github_issue_number" integer, "p_issue_number" "text", "p_github_issue_url" "text", "p_issue_url" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."normalize_task_approval_state"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."planning_legacy_item_id"("p_kind" "text", "p_project_id" "text", "p_legacy_id" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."planning_trash_root_is_purge_eligible"("p_root_type" "text", "p_root_id" "text", "p_trash_revision" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."planning_trash_root_is_purge_eligible"("p_root_type" "text", "p_root_id" "text", "p_trash_revision" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepare_empty_epic_delete"("p_item_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_empty_epic_delete"("p_item_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepare_google_team_workweek_reconciliation"("p_owner_profile_id" "text", "p_source_publication_id" "uuid", "p_source_publication_revision" integer, "p_effective_from" "date", "p_observations" "jsonb", "p_windows" "jsonb", "p_fingerprint" "text", "p_observed_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_google_team_workweek_reconciliation"("p_owner_profile_id" "text", "p_source_publication_id" "uuid", "p_source_publication_revision" integer, "p_effective_from" "date", "p_observations" "jsonb", "p_windows" "jsonb", "p_fingerprint" "text", "p_observed_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepare_google_workspace_disconnect"("p_owner_profile_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_google_workspace_disconnect"("p_owner_profile_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepare_planning_approval_command"("p_item_id" "text", "p_expected_kind" "text", "p_actor_profile_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_planning_approval_command"("p_item_id" "text", "p_expected_kind" "text", "p_actor_profile_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepare_planning_relationship_command"("p_task_id" "text", "p_related_task_id" "text", "p_relation_id" bigint, "p_relation_type" "text", "p_actor_profile_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_planning_relationship_command"("p_task_id" "text", "p_related_task_id" "text", "p_relation_id" bigint, "p_relation_type" "text", "p_actor_profile_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepare_planning_reparent_command"("p_item_id" "text", "p_parent_id" "text", "p_expected_kind" "text", "p_actor_profile_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_planning_reparent_command"("p_item_id" "text", "p_parent_id" "text", "p_expected_kind" "text", "p_actor_profile_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepare_planning_review_command"("p_task_id" "text", "p_requested_reviewer_profile_id" "text", "p_actor_profile_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_planning_review_command"("p_task_id" "text", "p_requested_reviewer_profile_id" "text", "p_actor_profile_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepare_planning_trash_command"("p_item_id" "text", "p_expected_kind" "text", "p_actor_profile_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_planning_trash_command"("p_item_id" "text", "p_expected_kind" "text", "p_actor_profile_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepare_task_deletion_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_task_deletion_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepare_team_workweek_google_conflict_resolution"("p_conflict_id" "uuid", "p_owner_profile_id" "text", "p_conflict_revision" integer, "p_decision" "text", "p_google_observations" "jsonb", "p_google_fingerprint" "text", "p_founderops_fingerprint" "text", "p_resolution_fingerprint" "text", "p_observed_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_team_workweek_google_conflict_resolution"("p_conflict_id" "uuid", "p_owner_profile_id" "text", "p_conflict_revision" integer, "p_decision" "text", "p_google_observations" "jsonb", "p_google_fingerprint" "text", "p_founderops_fingerprint" "text", "p_resolution_fingerprint" "text", "p_observed_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepare_team_workweek_publication"("p_version_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_team_workweek_publication"("p_version_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."process_score_objection_transaction"("p_sprint_id" "text", "p_objection_id" bigint, "p_actor_profile_id" "text", "p_action" "text", "p_status" "text", "p_resolution_comment" "text", "p_delivery_points" integer, "p_form_points" integer, "p_weekly_points" integer, "p_second_reviewer_profile_id" "text", "p_second_review_decision" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."process_score_objection_transaction"("p_sprint_id" "text", "p_objection_id" bigint, "p_actor_profile_id" "text", "p_action" "text", "p_status" "text", "p_resolution_comment" "text", "p_delivery_points" integer, "p_form_points" integer, "p_weekly_points" integer, "p_second_reviewer_profile_id" "text", "p_second_review_decision" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."profile_color_palette"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."profile_color_palette"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."purge_expired_planning_trash_batch"("p_limit" integer, "p_dry_run" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_expired_planning_trash_batch"("p_limit" integer, "p_dry_run" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rebase_google_workspace_disconnect_series"("p_target_id" "uuid", "p_expected_etag" "text", "p_observed_etag" "text", "p_observed_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rebase_google_workspace_disconnect_series"("p_target_id" "uuid", "p_expected_etag" "text", "p_observed_etag" "text", "p_observed_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_google_team_workweek_reconciliation_state"("p_publication_id" "uuid", "p_publication_revision" integer, "p_state" "text", "p_error_class" "text", "p_observed_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_google_team_workweek_reconciliation_state"("p_publication_id" "uuid", "p_publication_revision" integer, "p_state" "text", "p_error_class" "text", "p_observed_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_team_workweek_google_conflict_resolution"("p_conflict_id" "uuid", "p_owner_profile_id" "text", "p_conflict_revision" integer, "p_decision" "text", "p_google_observations" "jsonb", "p_google_fingerprint" "text", "p_observed_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_team_workweek_google_conflict_resolution"("p_conflict_id" "uuid", "p_owner_profile_id" "text", "p_conflict_revision" integer, "p_decision" "text", "p_google_observations" "jsonb", "p_google_fingerprint" "text", "p_observed_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_github_issue_sync_lock"("p_resource_key" "text", "p_lock_token" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_github_issue_sync_lock"("p_resource_key" "text", "p_lock_token" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reparent_planning_item_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_parent_task_id" "text", "p_actor_profile_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reparent_planning_item_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_parent_task_id" "text", "p_actor_profile_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."replace_planning_item_raci_assignments"("p_task_id" "text", "p_assignments" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."replace_planning_item_raci_assignments"("p_task_id" "text", "p_assignments" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."replace_task_evidence_links"("p_task_id" "text", "p_evidence_links" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."replace_task_evidence_links"("p_task_id" "text", "p_evidence_links" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_github_issue_comment_webhook_tasks"("p_repository_full_name" "text", "p_issue_number" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_github_issue_comment_webhook_tasks"("p_repository_full_name" "text", "p_issue_number" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_github_planning_webhook_actor"("p_github_user_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_github_planning_webhook_actor"("p_github_user_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_github_planning_webhook_tasks"("p_repository_full_name" "text", "p_issue_number" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_github_planning_webhook_tasks"("p_repository_full_name" "text", "p_issue_number" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_score_objection_transaction"("p_sprint_id" "text", "p_objection_id" bigint, "p_actor_profile_id" "text", "p_action" "text", "p_status" "text", "p_resolution_comment" "text", "p_delivery_points" integer, "p_form_points" integer, "p_weekly_points" integer, "p_second_review_decision" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_score_objection_transaction"("p_sprint_id" "text", "p_objection_id" bigint, "p_actor_profile_id" "text", "p_action" "text", "p_status" "text", "p_resolution_comment" "text", "p_delivery_points" integer, "p_form_points" integer, "p_weekly_points" integer, "p_second_review_decision" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."restore_planning_item_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_trash_revision" integer, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restore_planning_item_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_trash_revision" integer, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."retain_private_team_workweek_after_deactivation"("p_owner_profile_id" "text", "p_cutoff" "date") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."review_task_transaction"("p_task_id" "text", "p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_reviewer_profile_id" "text", "p_decision" "text", "p_points" integer, "p_comment" "text", "p_checklist" "jsonb", "p_activity_message" "text", "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_task_transaction"("p_task_id" "text", "p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_reviewer_profile_id" "text", "p_decision" "text", "p_points" integer, "p_comment" "text", "p_checklist" "jsonb", "p_activity_message" "text", "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."revoke_team_planning_items_token"("p_token_id" "uuid", "p_profile_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_team_planning_items_token"("p_token_id" "uuid", "p_profile_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."revoke_team_task_intake_token"("p_token_id" "uuid", "p_profile_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_team_task_intake_token"("p_token_id" "uuid", "p_profile_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_github_comment_notification_watermark"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."task_audit_action_from_legacy_message"("p_message" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."task_audit_action_from_legacy_message"("p_message" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."touch_milestone_updated_at"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."touch_package_updated_at"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."touch_planning_item_strategy_updated_at"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."transition_task_review_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_action" "text", "p_actor_profile_id" "text", "p_reason" "text", "p_activity_message" "text", "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transition_task_review_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_action" "text", "p_actor_profile_id" "text", "p_reason" "text", "p_activity_message" "text", "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."trash_planning_item_tree_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_revision" integer, "p_actor_profile_id" "text", "p_reason" "text", "p_cause" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trash_planning_item_tree_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_revision" integer, "p_actor_profile_id" "text", "p_reason" "text", "p_cause" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."try_acquire_github_issue_sync_lock"("p_resource_key" "text", "p_task_id" "text", "p_locked_by_profile_id" "text", "p_ttl_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."try_acquire_github_issue_sync_lock"("p_resource_key" "text", "p_task_id" "text", "p_locked_by_profile_id" "text", "p_ttl_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_backlog_order_transaction"("p_updates" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_backlog_order_transaction"("p_updates" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_browser_planning_item_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_patch" "jsonb", "p_strategy" "jsonb", "p_raci_assignments" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_browser_planning_item_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_patch" "jsonb", "p_strategy" "jsonb", "p_raci_assignments" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_browser_planning_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_actor_profile_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_browser_planning_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_actor_profile_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_browser_planning_task_transaction_without_completed_guar"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_actor_profile_id" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."update_founderops_github_project_transaction"("p_project_id" "text", "p_expected_owner" "text", "p_expected_number" integer, "p_github_project_owner" "text", "p_github_project_number" integer, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_founderops_github_project_transaction"("p_project_id" "text", "p_expected_owner" "text", "p_expected_number" integer, "p_github_project_owner" "text", "p_github_project_number" integer, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_founderops_review_window_transaction"("p_project_id" "text", "p_expected_hours" integer, "p_review_objection_window_hours" integer, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_founderops_review_window_transaction"("p_project_id" "text", "p_expected_hours" integer, "p_review_objection_window_hours" integer, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_planning_item_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_patch" "jsonb", "p_strategy" "jsonb", "p_raci_assignments" "jsonb", "p_actor_profile_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_planning_item_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_patch" "jsonb", "p_strategy" "jsonb", "p_raci_assignments" "jsonb", "p_actor_profile_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_planning_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_actor_profile_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_planning_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_actor_profile_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_profile_admin_transaction"("p_profile_id" "text", "p_actor_profile_id" "text", "p_profile_patch" "jsonb", "p_notification_events" "jsonb", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_profile_admin_transaction"("p_profile_id" "text", "p_actor_profile_id" "text", "p_profile_patch" "jsonb", "p_notification_events" "jsonb", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_profile_settings_transaction"("p_profile_id" "text", "p_profile_patch" "jsonb", "p_ui_preferences" "jsonb", "p_notification_events" "jsonb", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_profile_settings_transaction"("p_profile_id" "text", "p_profile_patch" "jsonb", "p_ui_preferences" "jsonb", "p_notification_events" "jsonb", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_sprint_schedule_transaction"("p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_sprint_patch" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_sprint_schedule_transaction"("p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_sprint_patch" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_team_planning_item_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_type" "text", "p_item_id" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_patch" "jsonb", "p_changed_fields" "jsonb", "p_system_effects" "jsonb", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_team_planning_item_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_type" "text", "p_item_id" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_patch" "jsonb", "p_changed_fields" "jsonb", "p_system_effects" "jsonb", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_team_planning_item_transaction_without_completed_guard"("p_token_id" "uuid", "p_profile_id" "text", "p_item_type" "text", "p_item_id" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_patch" "jsonb", "p_changed_fields" "jsonb", "p_system_effects" "jsonb", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."update_team_planning_item_with_projection_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_type" "text", "p_item_id" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_patch" "jsonb", "p_changed_fields" "jsonb", "p_system_effects" "jsonb", "p_projection_command" "jsonb", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_team_planning_item_with_projection_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_item_type" "text", "p_item_id" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_request_hash" "text", "p_patch" "jsonb", "p_changed_fields" "jsonb", "p_system_effects" "jsonb", "p_projection_command" "jsonb", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_profile_notification_preferences"("p_profile_id" "text", "p_notification_events" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."withdraw_planning_item_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_revision" integer, "p_actor_profile_id" "text", "p_reason" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."withdraw_planning_item_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_revision" integer, "p_actor_profile_id" "text", "p_reason" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";


















GRANT SELECT ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."active_tasks" TO "service_role";
GRANT SELECT ON TABLE "public"."active_tasks" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."availability" TO "authenticated";
GRANT ALL ON TABLE "public"."availability" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."availability_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."availability_id_seq" TO "service_role";



GRANT SELECT,INSERT ON TABLE "public"."decision_comments" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."decision_comments" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."decision_comments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."decision_comments_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."decision_confirmations" TO "authenticated";
GRANT ALL ON TABLE "public"."decision_confirmations" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."decision_confirmations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."decision_confirmations_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."decision_log" TO "authenticated";
GRANT ALL ON TABLE "public"."decision_log" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."decision_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."decision_log_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."decision_task_links" TO "authenticated";
GRANT ALL ON TABLE "public"."decision_task_links" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."decision_task_links_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."decision_task_links_id_seq" TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."feedback_items" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."feedback_items" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."feedback_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."feedback_items_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."fmd_tools" TO "authenticated";
GRANT ALL ON TABLE "public"."fmd_tools" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."founder_events" TO "authenticated";
GRANT ALL ON TABLE "public"."founder_events" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."founder_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."founder_events_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."founder_sprint_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."founder_sprint_scores" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."founder_sprint_scores_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."founder_sprint_scores_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."founder_strike_state" TO "authenticated";
GRANT ALL ON TABLE "public"."founder_strike_state" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."founder_strike_state_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."founder_strike_state_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."github_app_user_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."github_issue_sync_locks" TO "service_role";



GRANT SELECT,INSERT ON TABLE "public"."github_webhook_deliveries" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."google_workspace_connections" TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."google_workspace_disconnect_operations" TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."google_workspace_disconnect_series" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."meeting_attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."meeting_attendance" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."meeting_attendance_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."meeting_attendance_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."meetings" TO "authenticated";
GRANT ALL ON TABLE "public"."meetings" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."meetings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."meetings_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."notification_deliveries" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_deliveries" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."notification_deliveries_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."notification_deliveries_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."notification_events" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_events" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."notification_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."notification_events_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."notification_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_preferences" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."notification_preferences_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."notification_preferences_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."planning_item_historical_links" TO "service_role";
GRANT SELECT ON TABLE "public"."planning_item_historical_links" TO "authenticated";



GRANT ALL ON TABLE "public"."planning_item_raci_assignments" TO "service_role";
GRANT SELECT ON TABLE "public"."planning_item_raci_assignments" TO "authenticated";



GRANT ALL ON TABLE "public"."planning_item_strategy" TO "service_role";
GRANT SELECT ON TABLE "public"."planning_item_strategy" TO "authenticated";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."platform_releases" TO "service_role";
GRANT SELECT ON TABLE "public"."platform_releases" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."profile_feature_tour_acknowledgements" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_feature_tour_acknowledgements" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."profile_ui_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_ui_preferences" TO "service_role";



GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT,INSERT,DELETE ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT UPDATE("id") ON TABLE "public"."projects" TO "authenticated";



GRANT UPDATE("name") ON TABLE "public"."projects" TO "authenticated";



GRANT UPDATE("range_label") ON TABLE "public"."projects" TO "authenticated";



GRANT SELECT,DELETE ON TABLE "public"."score_objections" TO "authenticated";
GRANT ALL ON TABLE "public"."score_objections" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."score_objections_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."score_objections_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."sprint_commitments" TO "authenticated";
GRANT ALL ON TABLE "public"."sprint_commitments" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."sprint_commitments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sprint_commitments_id_seq" TO "service_role";



GRANT SELECT,DELETE ON TABLE "public"."sprints" TO "authenticated";
GRANT ALL ON TABLE "public"."sprints" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."strike_events" TO "authenticated";
GRANT ALL ON TABLE "public"."strike_events" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."strike_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."strike_events_id_seq" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."task_activity" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."task_audit_timeline" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."task_blockers" TO "authenticated";
GRANT ALL ON TABLE "public"."task_blockers" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."task_blockers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."task_blockers_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."task_comment_github_deliveries" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."task_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."task_comments" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."task_comments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."task_comments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."task_deletion_operations" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."task_dependencies" TO "authenticated";
GRANT ALL ON TABLE "public"."task_dependencies" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."task_dependencies_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."task_dependencies_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."task_external_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."task_external_comments" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."task_external_comments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."task_external_comments_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."task_focus_items" TO "authenticated";
GRANT ALL ON TABLE "public"."task_focus_items" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."task_focus_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."task_focus_items_id_seq" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."task_intake_tokens" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."task_intake_tokens_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."task_intake_tokens_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."task_links" TO "authenticated";
GRANT ALL ON TABLE "public"."task_links" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."task_links_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."task_links_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."task_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."task_notes" TO "service_role";



GRANT SELECT ON TABLE "public"."task_relationship_edges" TO "authenticated";
GRANT ALL ON TABLE "public"."task_relationship_edges" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."task_relationship_edges_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."task_relationship_edges_id_seq" TO "service_role";



GRANT SELECT,DELETE,UPDATE ON TABLE "public"."task_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."task_reviews" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."task_reviews_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."task_reviews_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."team_planning_item_delete_requests" TO "service_role";



GRANT ALL ON TABLE "public"."team_planning_item_update_requests" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."team_task_intake_batches" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."team_task_intake_tokens" TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."team_workweek_google_conflicts" TO "service_role";



GRANT SELECT ON TABLE "public"."team_workweek_google_reconciliation_status" TO "authenticated";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."team_workweek_google_reconciliation_status" TO "service_role";



GRANT SELECT ON TABLE "public"."team_workweek_google_series" TO "authenticated";
GRANT SELECT,UPDATE ON TABLE "public"."team_workweek_google_series" TO "service_role";



GRANT SELECT ON TABLE "public"."team_workweek_google_series_transitions" TO "authenticated";
GRANT SELECT,UPDATE ON TABLE "public"."team_workweek_google_series_transitions" TO "service_role";



GRANT SELECT ON TABLE "public"."team_workweek_publications" TO "authenticated";
GRANT SELECT ON TABLE "public"."team_workweek_publications" TO "service_role";



GRANT SELECT ON TABLE "public"."team_workweek_versions" TO "authenticated";
GRANT SELECT ON TABLE "public"."team_workweek_versions" TO "service_role";



GRANT SELECT ON TABLE "public"."team_workweek_windows" TO "authenticated";
GRANT SELECT ON TABLE "public"."team_workweek_windows" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";

-- Schema dumps intentionally omit DML. Keep the current storage bootstrap
-- configuration idempotent so a fresh project matches production.
INSERT INTO "storage"."buckets" (
  "id",
  "name",
  "public",
  "file_size_limit",
  "allowed_mime_types"
)
VALUES (
  'fmd-tool-previews',
  'fmd-tool-previews',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "public" = EXCLUDED."public",
  "file_size_limit" = EXCLUDED."file_size_limit",
  "allowed_mime_types" = EXCLUDED."allowed_mime_types";




























