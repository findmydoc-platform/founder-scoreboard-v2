


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


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






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


SET default_tablespace = '';

SET default_table_access_method = "heap";


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
  if p_lock_token is null
     or p_limit is null
     or p_limit not between 1 and 100
     or p_lease_seconds is null
     or p_lease_seconds not between 30 and 900
     or (
       p_root_type is null
       and (p_root_id is not null or p_task_ids is not null)
     )
     or (
       p_root_type is not null
       and (
         p_root_type not in ('initiative', 'deliverable')
         or nullif(trim(coalesce(p_root_id, '')), '') is null
         or p_task_ids is null
         or cardinality(p_task_ids) < 1
         or exists (
           select 1 from unnest(p_task_ids) task_id
           where nullif(trim(coalesce(task_id, '')), '') is null
         )
       )
     ) then
    raise exception using errcode = '22023', message = 'planning github lifecycle claim input is invalid';
  end if;

  return query
  with candidates as (
    select job.id
    from public.planning_github_lifecycle_outbox job
    where (
      (job.status in ('pending', 'retry_scheduled') and job.available_at <= now())
      or (job.status = 'processing' and job.locked_at < now() - make_interval(secs => p_lease_seconds))
    )
      and (
        p_root_type is null
        or (
          job.root_type = p_root_type
          and job.root_id = p_root_id
          and job.task_id = any(p_task_ids)
        )
      )
      and not exists (
        select 1
        from public.planning_github_lifecycle_outbox predecessor
        where predecessor.task_id = job.task_id
          and predecessor.status <> 'completed'
          and (
            predecessor.created_at < job.created_at
            or (predecessor.created_at = job.created_at and predecessor.id::text < job.id::text)
          )
      )
    order by job.created_at, job.id
    for update skip locked
    limit p_limit
  )
  update public.planning_github_lifecycle_outbox job
  set status = 'processing',
      attempts = attempts + 1,
      locked_at = clock_timestamp(),
      lock_token = p_lock_token,
      status_reason = null,
      last_error = null,
      updated_at = clock_timestamp()
  from candidates
  where job.id = candidates.id
  returning job.*;
end;
$$;


ALTER FUNCTION "public"."claim_planning_github_lifecycle_jobs_transaction"("p_lock_token" "uuid", "p_limit" integer, "p_lease_seconds" integer, "p_root_type" "text", "p_root_id" "text", "p_task_ids" "text"[]) OWNER TO "postgres";


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
  v_requested_sprint_id text := nullif(p_task_insert->>'sprint_id', '');
begin
  perform set_config('app.actor_profile_id', coalesce(p_actor_profile_id, ''), true);
  v_result := public.create_task_transaction(
    v_clean_insert, p_relation_type, p_related_task_id, p_relation_note,
    p_activity_message, p_relation_activity_message, p_notifications,
    p_actor_profile_id, p_request_ip, p_user_agent
  );
  v_task := v_result->'task';

  if coalesce((v_result->>'replayed')::boolean, false) = false and v_task->>'task_type' = 'deliverable' then
    if v_requested_approval_status = 'approved' and not p_approve_now then
      update public.tasks as updated_task
      set approval_status = 'approved',
          approval_revision = greatest(coalesce((p_task_insert->>'approval_revision')::integer, 1), 1),
          sprint_id = v_requested_sprint_id,
          score_relevant = v_requested_sprint_id is not null
      where id = v_task->>'id'
      returning to_jsonb(updated_task.*) into v_task;
    else
      update public.tasks
      set proposed_by = coalesce(nullif(p_task_insert->>'proposed_by', ''), p_actor_profile_id),
          proposed_at = coalesce((p_task_insert->>'proposed_at')::timestamptz, proposed_at, now())
      where id = v_task->>'id';
    end if;
    if p_approve_now then
      v_task := public.decide_deliverable_approval_transaction(
        v_task->>'id', coalesce((v_task->>'approval_revision')::integer, 1),
        'approve', p_actor_profile_id, 'Bei Erstellung durch CEO freigegeben.'
      );
    elsif v_requested_approval_status <> 'approved' or v_requested_approval_status is null then
      select to_jsonb(task) into v_task from public.tasks as task where task.id = v_task->>'id';
    end if;
    v_result := jsonb_set(v_result, '{task}', v_task);
  end if;
  return v_result;
end;
$$;


ALTER FUNCTION "public"."create_planning_task_transaction"("p_task_insert" "jsonb", "p_relation_type" "text", "p_related_task_id" "text", "p_relation_note" "text", "p_activity_message" "text", "p_relation_activity_message" "text", "p_notifications" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text", "p_approve_now" boolean) OWNER TO "postgres";


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

  insert into public.task_activity (task_id, message)
  values (p_task_id, 'Kommentar hinzugefügt: ' || left(p_comment, 160));

  return jsonb_build_object(
    'comment', to_jsonb(v_comment),
    'deliveryStatus', v_status
  );
end;
$_$;


ALTER FUNCTION "public"."create_task_comment_with_github_delivery"("p_task_id" "text", "p_profile_id" "text", "p_comment" "text") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."create_team_task_intake_v2_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_idempotency_key" "uuid", "p_request_hash" "text", "p_items" "jsonb", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_batch public.team_task_intake_batches%rowtype;
  v_role text;
  v_item jsonb;
  v_index integer;
  v_item_type text;
  v_id text;
  v_parent public.tasks%rowtype;
  v_initiative public.packages%rowtype;
  v_created_initiative public.packages%rowtype;
  v_task_insert jsonb;
  v_result jsonb;
  v_entity jsonb;
  v_ids text[] := array[]::text[];
  v_entities jsonb := '[]'::jsonb;
begin
  if p_token_id is null or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or p_idempotency_key is null or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception using errcode = '22023', message = 'team intake v2 input is invalid';
  end if;

  select * into v_token from public.team_task_intake_tokens
  where id = p_token_id and profile_id = p_profile_id and revoked_at is null and expires_at > now()
  for update;
  if not found then raise exception using errcode = 'P0004', message = 'team intake token is inactive'; end if;
  if not ('write:task-intake' = any(v_token.scopes)) then raise exception using errcode = 'P0005', message = 'team intake write scope is missing'; end if;

  select platform_role into v_role from public.profiles where id = p_profile_id for share;
  if not found or v_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'team intake profile role is not allowed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('team-intake-batch:' || p_token_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_batch from public.team_task_intake_batches
  where token_id = p_token_id and idempotency_key = p_idempotency_key;
  if found then
    if v_batch.request_hash <> p_request_hash then raise exception using errcode = 'P0003', message = 'idempotency key conflict'; end if;
    return jsonb_build_object('batchId', v_batch.id, 'replayed', true, 'items', v_batch.response_tasks);
  end if;

  for v_item, v_index in select value, ordinality::integer from jsonb_array_elements(p_items) with ordinality loop
    v_item_type := nullif(trim(v_item->>'itemType'), '');
    v_id := p_profile_id || '-team-intake-v2-' || replace(p_idempotency_key::text, '-', '') || '-' || v_index::text;
    if v_item_type = 'initiative' then
      if v_role not in ('ceo', 'deputy') then raise exception using errcode = 'P0006', message = 'initiative proposal requires ceo or deputy'; end if;
      insert into public.packages (
        id, project_id, milestone_id, owner_id, accountable_profile_id, responsible_profile_ids,
        consulted_profile_ids, informed_profile_ids, title, goal, priority, status, success_criteria,
        scope_constraints, sort_order, approval_status, approval_revision, proposed_by, proposed_at
      ) values (
        v_id, 'findmydoc-founder-execution', nullif(v_item->>'milestoneId', ''), nullif(v_item->>'ownerId', ''),
        nullif(v_item->>'accountableProfileId', ''), coalesce(array(select jsonb_array_elements_text(v_item->'responsibleProfileIds')), array[]::text[]),
        coalesce(array(select jsonb_array_elements_text(v_item->'consultedProfileIds')), array[]::text[]),
        coalesce(array(select jsonb_array_elements_text(v_item->'informedProfileIds')), array[]::text[]),
        trim(v_item->>'title'), coalesce(v_item->>'intendedOutcome', v_item->>'description', ''), coalesce(nullif(v_item->>'priority', ''), 'P2'),
        'planned', coalesce(v_item->>'acceptanceCriteria', ''), coalesce(v_item->>'scopeConstraints', ''),
        coalesce((select max(sort_order) + 1 from public.packages where project_id = 'findmydoc-founder-execution'), 1),
        'proposed', 1, p_profile_id, now()
      ) returning * into v_created_initiative;
      v_entity := to_jsonb(v_created_initiative);
      insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, after_data, request_ip, user_agent)
      values (p_profile_id, 'team.task_intake_v2.initiative_create', 'initiative', v_id, v_entity, p_request_ip, p_user_agent);
    elsif v_item_type in ('deliverable', 'sub_issue') then
      if v_item_type = 'deliverable' then
        select * into v_initiative from public.packages where id = nullif(v_item->>'packageId', '') for share;
        if not found then raise exception using errcode = 'P0002', message = 'team intake v2 initiative not found'; end if;
        if v_initiative.approval_status = 'rejected' then raise exception using errcode = 'P0003', message = 'team intake v2 initiative is rejected'; end if;
      else
        select * into v_parent from public.tasks where id = nullif(v_item->>'parentTaskId', '') and task_type = 'deliverable' for share;
        if not found then raise exception using errcode = 'P0002', message = 'team intake v2 parent deliverable not found'; end if;
      end if;
      if coalesce(nullif(v_item->>'githubRepo', ''), 'findmydoc-platform/management') not in (
        'findmydoc-platform/management', 'findmydoc-platform/website', 'findmydoc-platform/clinic-dashboard'
      ) then raise exception using errcode = '22023', message = 'team intake v2 github repository is not allowed'; end if;
      if v_item_type = 'deliverable'
         and coalesce(nullif(v_item->>'githubRepo', ''), 'findmydoc-platform/management') <> 'findmydoc-platform/management' then
        raise exception using errcode = '22023', message = 'team intake v2 deliverables must use the management repository';
      end if;

      v_task_insert := jsonb_build_object(
        'id', v_id, 'creation_request_id', 'team-v2:' || p_token_id::text || ':' || p_idempotency_key::text || ':' || v_index::text,
        'project_id', 'findmydoc-founder-execution', 'package_id', case when v_item_type = 'sub_issue' then v_parent.package_id else v_initiative.id end,
        'milestone_id', case when v_item_type = 'sub_issue' then v_parent.milestone_id else v_initiative.milestone_id end,
        'title', trim(v_item->>'title'), 'description', coalesce(v_item->>'description', ''),
        'problem_statement', coalesce(v_item->>'problemStatement', ''), 'intended_outcome', coalesce(v_item->>'intendedOutcome', ''),
        'scope_constraints', coalesce(v_item->>'scopeConstraints', ''), 'acceptance_criteria', coalesce(v_item->>'acceptanceCriteria', ''),
        'evidence_required', coalesce(v_item->>'evidenceRequired', ''), 'definition_of_done', coalesce(v_item->>'definitionOfDone', ''),
        'status', 'Offen', 'priority', coalesce(nullif(v_item->>'priority', ''), 'P2'),
        'owner', nullif(v_item->>'ownerId', ''), 'assignee', nullif(v_item->>'ownerId', ''), 'created_by', p_profile_id,
        'workstream', coalesce(v_item->>'workstream', ''), 'sort_order', 0, 'start_date', nullif(v_item->>'startDate', ''),
        'end_date', nullif(v_item->>'endDate', ''), 'deadline', nullif(v_item->>'deadline', ''), 'estimate_hours', coalesce((v_item->>'hours')::integer, 0),
        'sprint_id', null, 'review_status', 'not_requested', 'score_points', 0, 'score_final', false,
        'github_repo', case when v_item_type = 'sub_issue'
          then coalesce(nullif(v_item->>'githubRepo', ''), 'findmydoc-platform/management')
          else 'findmydoc-platform/management' end,
        'task_type', v_item_type, 'parent_task_id', case when v_item_type = 'sub_issue' then v_parent.id else null end,
        'approval_status', case when v_item_type = 'sub_issue' then null else 'proposed' end, 'approval_revision', 1,
        'proposed_by', case when v_item_type = 'deliverable' then p_profile_id else null end,
        'proposed_at', case when v_item_type = 'deliverable' then now() else null end, 'score_relevant', false
      );
      v_result := public.create_planning_task_transaction(v_task_insert, null, null, null,
        case when v_item_type = 'sub_issue' then 'Sub-Issue über Team Intake v2 erstellt' else 'Deliverable über Team Intake v2 vorgeschlagen' end,
        null, '[]'::jsonb, p_profile_id, p_request_ip, p_user_agent, false);
      v_entity := v_result->'task';
    else
      raise exception using errcode = '22023', message = 'team intake v2 item type is invalid';
    end if;
    v_ids := array_append(v_ids, v_id);
    v_entities := v_entities || jsonb_build_array(jsonb_build_object('itemType', v_item_type, 'item', v_entity));
  end loop;

  insert into public.team_task_intake_batches (token_id, profile_id, idempotency_key, request_hash, task_ids, response_tasks)
  values (p_token_id, p_profile_id, p_idempotency_key, p_request_hash, v_ids, v_entities) returning * into v_batch;
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, after_data, request_ip, user_agent)
  values (p_profile_id, 'team.task_intake_v2.commit', 'team_task_intake_batch', v_batch.id::text,
    jsonb_build_object('tokenId', p_token_id, 'entityIds', v_ids), p_request_ip, p_user_agent);
  return jsonb_build_object('batchId', v_batch.id, 'replayed', false, 'items', v_entities);
end;
$_$;


ALTER FUNCTION "public"."create_team_task_intake_v2_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_idempotency_key" "uuid", "p_request_hash" "text", "p_items" "jsonb", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_platform_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select profile.platform_role
  from public.profiles as profile
  where profile.id = public.current_profile_id()
$$;


ALTER FUNCTION "public"."current_platform_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_profile_id"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select profile.id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
     or (
       profile.auth_user_id is null
       and nullif(lower(profile.github_login), '') = nullif(lower(coalesce(
         auth.jwt() -> 'user_metadata' ->> 'user_name',
         auth.jwt() -> 'user_metadata' ->> 'preferred_username'
       )), '')
     )
  order by (profile.auth_user_id = auth.uid()) desc
  limit 1
$$;


ALTER FUNCTION "public"."current_profile_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_profile_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role from public.profiles where auth_user_id = auth.uid()
$$;


ALTER FUNCTION "public"."current_profile_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decide_deliverable_approval_transaction"("p_task_id" "text", "p_expected_revision" integer, "p_action" "text", "p_actor_profile_id" "text", "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task public.tasks%rowtype;
  v_initiative public.packages%rowtype;
  v_actor_role text;
  v_next_status text;
  v_before_status text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_notification_recipient_id text;
  v_trash_result jsonb;
  v_package_id text;
begin
  if p_action is null
     or p_action not in ('approve', 'reject', 'return_to_draft')
     or p_expected_revision is null
     or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'deliverable approval input is invalid';
  end if;
  if char_length(v_note) > 2000 then
    raise exception using errcode = '22023', message = 'approval decision note exceeds 2000 characters';
  end if;
  if p_action in ('reject', 'return_to_draft') and v_note is null then
    raise exception using errcode = '22023', message = 'approval decision note is required';
  end if;

  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  if not found then raise exception using errcode = 'P0006', message = 'approval actor not found'; end if;

  select package_id into v_package_id from public.tasks where id = p_task_id;
  if not found then raise exception using errcode = 'P0002', message = 'deliverable not found'; end if;

  select * into v_initiative from public.packages where id = v_package_id for share;
  if not found or v_initiative.trashed_at is not null then
    raise exception using errcode = 'P0003', message = 'deliverable requires an active initiative';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'deliverable not found'; end if;
  if v_task.package_id is distinct from v_package_id then
    raise exception using errcode = 'P0001', message = 'deliverable initiative changed';
  end if;
  if v_task.task_type <> 'deliverable' then raise exception using errcode = '22023', message = 'task is not a deliverable'; end if;
  if v_task.trashed_at is not null then raise exception using errcode = 'P0003', message = 'deliverable is trashed'; end if;
  if v_task.approval_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'deliverable approval revision changed';
  end if;
  if v_task.approval_status <> 'proposed' then
    raise exception using errcode = 'P0003', message = 'deliverable is not proposed';
  end if;
  if p_action in ('approve', 'reject')
     and v_actor_role <> 'ceo'
     and coalesce(v_initiative.accountable_profile_id, '') <> p_actor_profile_id then
    raise exception using errcode = 'P0006', message = 'deliverable approval requires ceo or initiative accountable';
  end if;
  if p_action = 'return_to_draft'
     and v_actor_role not in ('ceo', 'deputy')
     and coalesce(v_initiative.accountable_profile_id, '') <> p_actor_profile_id then
    raise exception using errcode = 'P0006', message = 'deliverable may only be returned by operational lead or accountable';
  end if;
  if p_action = 'approve' and v_initiative.approval_status <> 'approved' then
    raise exception using errcode = 'P0003', message = 'initiative must be approved first';
  end if;

  if p_action = 'reject' then
    v_trash_result := public.trash_planning_item_tree_transaction(
      'deliverable', p_task_id, p_expected_revision, p_actor_profile_id, v_note, 'rejected', null, null
    );
    return v_trash_result->'item';
  end if;

  v_before_status := v_task.approval_status;
  v_notification_recipient_id := v_task.proposed_by;
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
      github_issue_sync_status = 'not_synced',
      github_issue_sync_error = null,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning * into v_task;

  insert into public.task_activity (task_id, message)
  values (p_task_id, case p_action
    when 'approve' then 'Deliverable freigegeben · Revision ' || v_task.approval_revision
    else 'Deliverable zur Überarbeitung zurückgegeben · Revision ' || v_task.approval_revision || ' · Begründung: ' || v_note
  end);
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_profile_id, 'task.approval_' || p_action, 'task', p_task_id,
    jsonb_build_object('approvalStatus', v_before_status, 'revision', p_expected_revision),
    jsonb_build_object('approvalStatus', v_next_status, 'revision', v_task.approval_revision, 'note', v_note));

  if p_action = 'approve' then
    insert into public.planning_github_lifecycle_outbox (
      root_type, root_id, root_trash_revision, task_id, github_repo, github_issue_number,
      action, source_type, source_revision, reason
    )
    select
      'deliverable',
      p_task_id,
      v_task.trash_revision,
      linked.id,
      prior.github_repo,
      prior.github_issue_number,
      'reopen',
      'approval',
      v_task.approval_revision,
      null
    from public.tasks linked
    join lateral (
      select closed.github_repo, closed.github_issue_number
      from public.planning_github_lifecycle_outbox closed
      where closed.task_id = linked.id and closed.action = 'close_not_planned'
      order by closed.created_at desc, closed.id desc
      limit 1
    ) prior on true
    where (linked.id = p_task_id or linked.parent_task_id = p_task_id)
      and linked.trashed_at is null
      and linked.trash_revision > 0
      and prior.github_repo is not null
      and prior.github_issue_number is not null
    on conflict (root_type, root_id, root_trash_revision, task_id, action) do nothing;
  end if;

  if p_action = 'return_to_draft' and v_notification_recipient_id is not null then
    insert into public.notification_events (
      type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body, dedupe_key
    ) values (
      'planning_item.returned', p_actor_profile_id, v_notification_recipient_id, 'task', p_task_id,
      'Deliverable zur Überarbeitung: ' || v_task.title,
      'Begründung: ' || v_note,
      'planning-item-returned:task:' || p_task_id || ':' || v_task.approval_revision
    );
  end if;

  return to_jsonb(v_task);
end;
$$;


ALTER FUNCTION "public"."decide_deliverable_approval_transaction"("p_task_id" "text", "p_expected_revision" integer, "p_action" "text", "p_actor_profile_id" "text", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decide_initiative_approval_transaction"("p_initiative_id" "text", "p_expected_revision" integer, "p_action" "text", "p_actor_profile_id" "text", "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_initiative public.packages%rowtype;
  v_actor_role text;
  v_next_status text;
  v_before_status text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_notification_recipient_id text;
  v_trash_result jsonb;
begin
  if p_action is null
     or p_action not in ('approve', 'reject', 'return_to_draft')
     or p_expected_revision is null
     or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'initiative approval input is invalid';
  end if;
  if char_length(v_note) > 2000 then
    raise exception using errcode = '22023', message = 'approval decision note exceeds 2000 characters';
  end if;
  if p_action in ('reject', 'return_to_draft') and v_note is null then
    raise exception using errcode = '22023', message = 'approval decision note is required';
  end if;

  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  if not found then raise exception using errcode = 'P0006', message = 'approval actor not found'; end if;

  select * into v_initiative from public.packages where id = p_initiative_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'initiative not found'; end if;
  if v_initiative.trashed_at is not null then raise exception using errcode = 'P0003', message = 'initiative is trashed'; end if;
  if v_initiative.approval_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'initiative approval revision changed';
  end if;
  if v_initiative.approval_status <> 'proposed' then
    raise exception using errcode = 'P0003', message = 'initiative is not proposed';
  end if;

  if p_action in ('approve', 'reject') and v_actor_role <> 'ceo' then
    raise exception using errcode = 'P0006', message = 'only ceo may decide initiative approval';
  end if;
  if p_action = 'return_to_draft' and v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'initiative may only be returned by operational lead';
  end if;

  if p_action = 'reject' then
    v_trash_result := public.trash_planning_item_tree_transaction(
      'initiative', p_initiative_id, p_expected_revision, p_actor_profile_id, v_note, 'rejected', null, null
    );
    return v_trash_result->'item';
  end if;

  v_before_status := v_initiative.approval_status;
  v_notification_recipient_id := v_initiative.proposed_by;
  v_next_status := case p_action when 'approve' then 'approved' else 'draft' end;
  update public.packages
  set approval_status = v_next_status,
      approval_revision = approval_revision + 1,
      decided_by = case when p_action = 'approve' then p_actor_profile_id else null end,
      decided_at = case when p_action = 'approve' then now() else null end,
      decision_note = v_note
  where id = p_initiative_id
  returning * into v_initiative;

  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_profile_id, 'initiative.approval_' || p_action, 'initiative', p_initiative_id,
    jsonb_build_object('approvalStatus', v_before_status, 'revision', p_expected_revision),
    jsonb_build_object('approvalStatus', v_next_status, 'revision', v_initiative.approval_revision, 'note', v_note));

  if p_action = 'return_to_draft' and v_notification_recipient_id is not null then
    insert into public.notification_events (
      type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body, dedupe_key
    ) values (
      'planning_item.returned', p_actor_profile_id, v_notification_recipient_id, 'initiative', p_initiative_id,
      'Initiative zur Überarbeitung: ' || v_initiative.title,
      'Begründung: ' || v_note,
      'planning-item-returned:initiative:' || p_initiative_id || ':' || v_initiative.approval_revision
    );
  end if;

  return to_jsonb(v_initiative);
end;
$$;


ALTER FUNCTION "public"."decide_initiative_approval_transaction"("p_initiative_id" "text", "p_expected_revision" integer, "p_action" "text", "p_actor_profile_id" "text", "p_note" "text") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."guard_planning_trash_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_bypass boolean := coalesce(current_setting('founderops.trash_lifecycle_write', true), '') = 'on';
begin
  if v_bypass then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0003', message = 'planning items may only be deleted by the lifecycle purge';
  end if;

  if tg_op = 'INSERT' then
    if new.trashed_at is not null
       or new.trashed_by is not null
       or new.trash_reason is not null
       or new.trash_cause is not null
       or new.purge_after is not null
       or new.trash_root_type is not null
       or new.trash_root_id is not null
       or new.trash_revision <> 0 then
      raise exception using errcode = 'P0003', message = 'trash metadata requires the planning trash lifecycle';
    end if;
  else
    if old.trashed_at is not null then
      raise exception using errcode = 'P0003', message = 'trashed planning items are immutable';
    end if;
    if new.trashed_at is distinct from old.trashed_at
       or new.trashed_by is distinct from old.trashed_by
       or new.trash_reason is distinct from old.trash_reason
       or new.trash_cause is distinct from old.trash_cause
       or new.purge_after is distinct from old.purge_after
       or new.trash_root_type is distinct from old.trash_root_type
       or new.trash_root_id is distinct from old.trash_root_id
       or new.trash_revision is distinct from old.trash_revision then
      raise exception using errcode = 'P0003', message = 'trash metadata requires the planning trash lifecycle';
    end if;
  end if;

  if tg_table_name = 'tasks' and new.trashed_at is null then
    if exists (
      select 1 from public.packages
      where id = new.package_id and trashed_at is not null
    ) then
      raise exception using errcode = 'P0003', message = 'active tasks require an active initiative';
    end if;
    if new.task_type = 'sub_issue' and exists (
      select 1 from public.tasks
      where id = new.parent_task_id and trashed_at is not null
    ) then
      raise exception using errcode = 'P0003', message = 'active sub-issues require an active parent deliverable';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."guard_planning_trash_mutation"() OWNER TO "postgres";


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
  v_material_change boolean := false;
  v_parent public.tasks%rowtype;
begin
  if new.task_type = 'sub_issue' then
    if new.parent_task_id is null then
      raise exception using errcode = '23514', message = 'sub-issue requires a parent deliverable';
    end if;
    select * into v_parent from public.tasks where id = new.parent_task_id;
    if not found or v_parent.task_type <> 'deliverable' then
      raise exception using errcode = '23514', message = 'sub-issue parent must be a deliverable';
    end if;
    new.package_id := v_parent.package_id;
    new.milestone_id := v_parent.milestone_id;
    new.approval_status := null;
    new.sprint_id := null;
    new.score_relevant := false;
    return new;
  end if;

  if new.approval_status is null then
    new.approval_status := 'proposed';
  end if;

  new.github_repo := 'findmydoc-platform/management';

  if tg_op = 'UPDATE' and old.task_type = 'deliverable' then
    v_material_change :=
      new.package_id is distinct from old.package_id
      or new.title is distinct from old.title
      or new.problem_statement is distinct from old.problem_statement
      or new.intended_outcome is distinct from old.intended_outcome
      or new.scope_constraints is distinct from old.scope_constraints
      or new.acceptance_criteria is distinct from old.acceptance_criteria
      or new.definition_of_done is distinct from old.definition_of_done;
    if v_material_change then
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
      values (new.id, case old.approval_status
        when 'approved' then 'Materielle Änderung: neue Freigabe erforderlich'
        when 'proposed' then 'Freigabeantrag mit neuer Revision aktualisiert'
        else 'Deliverable erneut zur Freigabe eingereicht' end);
      insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
      values (v_actor_profile_id,
        case old.approval_status
          when 'approved' then 'task.approval_reset'
          when 'proposed' then 'task.approval_revised'
          else 'task.approval_resubmitted' end,
        'task', new.id,
        jsonb_build_object('approvalStatus', old.approval_status, 'revision', old.approval_revision),
        jsonb_build_object('approvalStatus', 'proposed', 'revision', new.approval_revision));
    end if;
  end if;

  if new.approval_status <> 'approved' then
    new.sprint_id := null;
    new.score_relevant := false;
  else
    new.score_relevant := new.sprint_id is not null;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."normalize_task_approval_state"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."planning_trash_root_is_purge_eligible"("p_root_type" "text", "p_root_id" "text", "p_trash_revision" integer) RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
declare
  v_root_package_id text;
  v_root_trashed_at timestamptz;
  v_root_purge_after timestamptz;
  v_root_trash_cause text;
begin
  if p_root_type is null
     or p_root_type not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_root_id, '')), '') is null
     or p_trash_revision is null
     or p_trash_revision < 1 then
    return false;
  end if;

  if p_root_type = 'initiative' then
    select package.trashed_at, package.purge_after, package.trash_cause
    into v_root_trashed_at, v_root_purge_after, v_root_trash_cause
    from public.packages package
    where package.id = p_root_id
      and package.trashed_at is not null
      and package.trash_root_type = 'initiative'
      and package.trash_root_id = package.id
      and package.trash_revision = p_trash_revision
      and package.purge_after <= now();
    if not found then
      return false;
    end if;

    if exists (
      select 1
      from public.tasks task
      where task.package_id = p_root_id
        and not (
          task.trashed_at is not distinct from v_root_trashed_at
          and task.purge_after is not distinct from v_root_purge_after
          and task.trash_cause is not distinct from v_root_trash_cause
          and task.trash_root_type = 'initiative'
          and task.trash_root_id = p_root_id
          and task.trash_revision = p_trash_revision
        )
    ) or exists (
      select 1
      from public.tasks task
      where task.trashed_at is not null
        and task.trash_root_type = 'initiative'
        and task.trash_root_id = p_root_id
        and task.trash_revision = p_trash_revision
        and task.package_id is distinct from p_root_id
    ) or exists (
      select 1
      from public.tasks task
      where task.package_id = p_root_id
        and not (
          (task.task_type = 'deliverable' and task.parent_task_id is null)
          or (
            task.task_type = 'sub_issue'
            and exists (
              select 1
              from public.tasks parent
              where parent.id = task.parent_task_id
                and parent.task_type = 'deliverable'
                and parent.package_id = p_root_id
            )
          )
        )
    ) or exists (
      select 1
      from public.tasks external_task
      where external_task.parent_task_id in (
        select member.id
        from public.tasks member
        where member.package_id = p_root_id
      )
        and external_task.package_id is distinct from p_root_id
    ) then
      return false;
    end if;
  else
    select task.package_id, task.trashed_at, task.purge_after, task.trash_cause
    into v_root_package_id, v_root_trashed_at, v_root_purge_after, v_root_trash_cause
    from public.tasks task
    where task.id = p_root_id
      and task.task_type = 'deliverable'
      and task.parent_task_id is null
      and task.package_id is not null
      and task.trashed_at is not null
      and task.trash_root_type = 'deliverable'
      and task.trash_root_id = task.id
      and task.trash_revision = p_trash_revision
      and task.purge_after <= now();
    if not found then
      return false;
    end if;

    if exists (
      select 1
      from public.tasks task
      where (task.id = p_root_id or task.parent_task_id = p_root_id)
        and not (
          task.trashed_at is not distinct from v_root_trashed_at
          and task.purge_after is not distinct from v_root_purge_after
          and task.trash_cause is not distinct from v_root_trash_cause
          and task.trash_root_type = 'deliverable'
          and task.trash_root_id = p_root_id
          and task.trash_revision = p_trash_revision
        )
    ) or exists (
      select 1
      from public.tasks task
      where task.trashed_at is not null
        and task.trash_root_type = 'deliverable'
        and task.trash_root_id = p_root_id
        and task.trash_revision = p_trash_revision
        and task.id is distinct from p_root_id
        and task.parent_task_id is distinct from p_root_id
    ) or exists (
      select 1
      from public.tasks child
      where child.parent_task_id = p_root_id
        and (
          child.task_type <> 'sub_issue'
          or child.package_id is distinct from v_root_package_id
        )
    ) or exists (
      select 1
      from public.tasks descendant
      where descendant.parent_task_id in (
        select child.id
        from public.tasks child
        where child.parent_task_id = p_root_id
      )
    ) then
      return false;
    end if;
  end if;

  if exists (
    select 1
    from public.tasks task
    where task.trashed_at is not null
      and task.trash_root_type = p_root_type
      and task.trash_root_id = p_root_id
      and task.trash_revision = p_trash_revision
      and (
        (p_root_type = 'initiative' and task.package_id = p_root_id)
        or (
          p_root_type = 'deliverable'
          and (task.id = p_root_id or task.parent_task_id = p_root_id)
        )
      )
      and not exists (
        select 1
        from public.planning_github_lifecycle_outbox lifecycle
        where lifecycle.root_type = p_root_type
          and lifecycle.root_id = p_root_id
          and lifecycle.root_trash_revision = p_trash_revision
          and lifecycle.task_id = task.id
          and lifecycle.action = 'close_not_planned'
          and lifecycle.status = 'completed'
          and (
            (lifecycle.github_issue_number is null and lifecycle.status_reason = 'issue_missing')
            or (lifecycle.github_issue_number is not null and lifecycle.status_reason = 'delivered')
          )
      )
  ) or exists (
    select 1
    from public.planning_github_lifecycle_outbox lifecycle
    where lifecycle.root_type = p_root_type
      and lifecycle.root_id = p_root_id
      and lifecycle.root_trash_revision = p_trash_revision
      and lifecycle.action = 'close_not_planned'
      and not exists (
        select 1
        from public.tasks task
        where task.id = lifecycle.task_id
          and task.trashed_at is not null
          and task.trash_root_type = p_root_type
          and task.trash_root_id = p_root_id
          and task.trash_revision = p_trash_revision
          and (
            (p_root_type = 'initiative' and task.package_id = p_root_id)
            or (
              p_root_type = 'deliverable'
              and (task.id = p_root_id or task.parent_task_id = p_root_id)
            )
          )
      )
  ) then
    return false;
  end if;

  return true;
end;
$$;


ALTER FUNCTION "public"."planning_trash_root_is_purge_eligible"("p_root_type" "text", "p_root_id" "text", "p_trash_revision" integer) OWNER TO "postgres";


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



CREATE OR REPLACE FUNCTION "public"."purge_expired_planning_trash_batch"("p_limit" integer DEFAULT 25, "p_dry_run" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 25));
  v_scan_limit integer := least(greatest(1, coalesce(p_limit, 25)) * 4, 100);
  v_candidate record;
  v_root_record record;
  v_task_ids text[];
  v_task_count integer;
  v_outbox_count integer;
  v_completed_outbox_count integer;
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
    return jsonb_build_object(
      'busy', true,
      'dryRun', coalesce(p_dry_run, false),
      'eligibleRoots', 0,
      'eligibleTasks', 0,
      'purgedRoots', 0,
      'purgedTasks', 0,
      'resolvedNotifications', 0,
      'blockedExpiredRoots', 0,
      'hasMore', true
    );
  end if;

  perform set_config('founderops.trash_lifecycle_write', 'on', true);

  for v_candidate in
    with initiative_candidates as (
      select 'initiative'::text as root_type, package.id as root_id,
        package.trash_revision, package.purge_after
      from public.packages package
      where package.trashed_at is not null
        and package.trash_root_type = 'initiative'
        and package.trash_root_id = package.id
        and package.purge_after <= now()
      order by package.purge_after, package.id
      limit v_scan_limit
    ), deliverable_candidates as (
      select 'deliverable'::text as root_type, task.id as root_id,
        task.trash_revision, task.purge_after
      from public.tasks task
      where task.trashed_at is not null
        and task.task_type = 'deliverable'
        and task.trash_root_type = 'deliverable'
        and task.trash_root_id = task.id
        and task.purge_after <= now()
      order by task.purge_after, task.id
      limit v_scan_limit
    ), candidate_roots as (
      select * from initiative_candidates
      union all
      select * from deliverable_candidates
    )
    select candidate.root_type, candidate.root_id, candidate.trash_revision, candidate.purge_after
    from candidate_roots candidate
    order by candidate.purge_after, candidate.root_type, candidate.root_id
    limit v_scan_limit
  loop
    exit when v_locked_roots >= v_limit;

    if not public.planning_trash_root_is_purge_eligible(
      v_candidate.root_type,
      v_candidate.root_id,
      v_candidate.trash_revision
    ) then
      continue;
    end if;

    if v_candidate.root_type = 'initiative' then
      select package.id, package.trash_cause, package.trashed_at, package.purge_after,
        package.trash_revision
      into v_root_record
      from public.packages package
      where package.id = v_candidate.root_id
        and package.trashed_at is not null
        and package.trash_root_type = 'initiative'
        and package.trash_root_id = package.id
        and package.trash_revision = v_candidate.trash_revision
        and package.purge_after <= now()
      for update skip locked;
    else
      select task.id, task.trash_cause, task.trashed_at, task.purge_after,
        task.trash_revision
      into v_root_record
      from public.tasks task
      where task.id = v_candidate.root_id
        and task.trashed_at is not null
        and task.task_type = 'deliverable'
        and task.parent_task_id is null
        and task.package_id is not null
        and task.trash_root_type = 'deliverable'
        and task.trash_root_id = task.id
        and task.trash_revision = v_candidate.trash_revision
        and task.purge_after <= now()
      for update skip locked;
    end if;

    if v_root_record.id is null
    then
      continue;
    end if;

    v_locked_roots := v_locked_roots + 1;
    if v_candidate.root_type = 'initiative' then
      perform task.id
      from public.tasks task
      where task.package_id = v_candidate.root_id
      order by task.id
      for update;
    else
      perform task.id
      from public.tasks task
      where task.id = v_candidate.root_id or task.parent_task_id = v_candidate.root_id
      order by task.id
      for update;
    end if;

    if not public.planning_trash_root_is_purge_eligible(
         v_candidate.root_type,
         v_candidate.root_id,
         v_candidate.trash_revision
       ) then
      continue;
    end if;

    if v_candidate.root_type = 'initiative' then
      select coalesce(array_agg(task.id order by task.id), '{}'::text[]), count(*)::integer
      into v_task_ids, v_task_count
      from public.tasks task
      where task.trash_root_type = 'initiative'
        and task.trash_root_id = v_candidate.root_id
        and task.trash_revision = v_candidate.trash_revision
        and task.package_id = v_candidate.root_id
        and task.trashed_at is not null;
    else
      select coalesce(array_agg(task.id order by task.id), '{}'::text[]), count(*)::integer
      into v_task_ids, v_task_count
      from public.tasks task
      where task.trash_root_type = 'deliverable'
        and task.trash_root_id = v_candidate.root_id
        and task.trash_revision = v_candidate.trash_revision
        and (task.id = v_candidate.root_id or task.parent_task_id = v_candidate.root_id)
        and task.trashed_at is not null;
    end if;

    select count(*)::integer,
      count(*) filter (
        where lifecycle.status = 'completed'
          and (
            (lifecycle.github_issue_number is null and lifecycle.status_reason = 'issue_missing')
            or (lifecycle.github_issue_number is not null and lifecycle.status_reason = 'delivered')
          )
      )::integer
    into v_outbox_count, v_completed_outbox_count
    from public.planning_github_lifecycle_outbox lifecycle
    where lifecycle.root_type = v_candidate.root_type
      and lifecycle.root_id = v_candidate.root_id
      and lifecycle.root_trash_revision = v_candidate.trash_revision
      and lifecycle.action = 'close_not_planned';

    if v_outbox_count <> v_task_count
       or v_completed_outbox_count <> v_task_count
       or exists (
         select 1
         from unnest(v_task_ids) as expected(task_id)
         where not exists (
           select 1
           from public.planning_github_lifecycle_outbox lifecycle
           where lifecycle.root_type = v_candidate.root_type
             and lifecycle.root_id = v_candidate.root_id
             and lifecycle.root_trash_revision = v_candidate.trash_revision
             and lifecycle.task_id = expected.task_id
             and lifecycle.action = 'close_not_planned'
             and lifecycle.status = 'completed'
             and (
               (lifecycle.github_issue_number is null and lifecycle.status_reason = 'issue_missing')
               or (lifecycle.github_issue_number is not null and lifecycle.status_reason = 'delivered')
             )
         )
       )
       or exists (
         select 1
         from public.planning_github_lifecycle_outbox lifecycle
         where lifecycle.root_type = v_candidate.root_type
           and lifecycle.root_id = v_candidate.root_id
           and lifecycle.root_trash_revision = v_candidate.trash_revision
           and lifecycle.action = 'close_not_planned'
           and not (lifecycle.task_id = any(v_task_ids))
       ) then
      continue;
    end if;

    if coalesce(p_dry_run, false) then
      v_eligible_roots := v_eligible_roots + 1;
      v_eligible_tasks := v_eligible_tasks + v_task_count;
      continue;
    end if;

    update public.notification_events notification
    set status = 'resolved',
        resolved_at = coalesce(notification.resolved_at, now()),
        resolution_reason = coalesce(notification.resolution_reason, 'source_purged')
    where notification.status in ('pending', 'sent', 'failed')
      and (
        (
          v_candidate.root_type = 'initiative'
          and notification.entity_type = 'initiative'
          and notification.entity_id = v_candidate.root_id
        )
        or (notification.entity_type = 'task' and notification.entity_id = any(v_task_ids))
      );
    get diagnostics v_resolved_count = row_count;
    v_resolved_notifications := v_resolved_notifications + v_resolved_count;

    if v_candidate.root_type = 'initiative' then
      update public.profile_ui_preferences preference
      set expanded_package_ids = array_remove(preference.expanded_package_ids, v_candidate.root_id),
          planning_filters = case
            when preference.planning_filters->>'packageId' = v_candidate.root_id
              then jsonb_set(preference.planning_filters, '{packageId}', '"Alle"'::jsonb, true)
            else preference.planning_filters
          end,
          updated_at = now()
      where v_candidate.root_id = any(preference.expanded_package_ids)
        or preference.planning_filters->>'packageId' = v_candidate.root_id;
    end if;

    insert into public.audit_log (
      action,
      entity_type,
      entity_id,
      before_data,
      after_data
    ) values (
      'planning_trash.purge',
      v_candidate.root_type,
      v_candidate.root_id,
      jsonb_build_object(
        'trashCause', v_root_record.trash_cause,
        'trashedAt', v_root_record.trashed_at,
        'purgeAfter', v_root_record.purge_after,
        'trashRevision', v_candidate.trash_revision
      ),
      jsonb_build_object(
        'purgedAt', now(),
        'taskCount', v_task_count,
        'completedGitHubLifecycleJobs', v_completed_outbox_count,
        'resolvedNotifications', v_resolved_count
      )
    );

    delete from public.planning_github_lifecycle_outbox lifecycle
    where lifecycle.root_type = v_candidate.root_type
      and lifecycle.root_id = v_candidate.root_id
      and lifecycle.root_trash_revision = v_candidate.trash_revision;

    delete from public.tasks task
    where task.id = any(v_task_ids)
      and task.trashed_at is not null
      and task.trash_root_type = v_candidate.root_type
      and task.trash_root_id = v_candidate.root_id
      and task.trash_revision = v_candidate.trash_revision;

    if v_candidate.root_type = 'initiative' then
      delete from public.packages package
      where package.id = v_candidate.root_id
        and package.trashed_at is not null
        and package.trash_root_type = 'initiative'
        and package.trash_root_id = package.id
        and package.trash_revision = v_candidate.trash_revision;
    end if;

    v_purged_roots := v_purged_roots + 1;
    v_purged_tasks := v_purged_tasks + v_task_count;
  end loop;

  select exists (
    select 1 from public.packages package
    where package.trashed_at is not null
      and package.trash_root_type = 'initiative'
      and package.trash_root_id = package.id
      and package.purge_after <= now()
    union all
    select 1 from public.tasks task
    where task.trashed_at is not null
      and task.task_type = 'deliverable'
      and task.trash_root_type = 'deliverable'
      and task.trash_root_id = task.id
      and task.purge_after <= now()
  ) into v_has_more;

  with initiative_candidates as (
    select 'initiative'::text as root_type, package.id as root_id, package.trash_revision
    from public.packages package
    where package.trashed_at is not null
      and package.trash_root_type = 'initiative'
      and package.trash_root_id = package.id
      and package.purge_after <= now()
    order by package.purge_after, package.id
    limit v_scan_limit
  ), deliverable_candidates as (
    select 'deliverable'::text as root_type, task.id as root_id, task.trash_revision
    from public.tasks task
    where task.trashed_at is not null
      and task.task_type = 'deliverable'
      and task.trash_root_type = 'deliverable'
      and task.trash_root_id = task.id
      and task.purge_after <= now()
    order by task.purge_after, task.id
    limit v_scan_limit
  ), expired_probe as (
    select * from initiative_candidates
    union all
    select * from deliverable_candidates
  )
  select count(*) filter (
      where not public.planning_trash_root_is_purge_eligible(
        candidate.root_type,
        candidate.root_id,
        candidate.trash_revision
      )
    )::integer
  into v_blocked_expired_roots
  from (
    select probe.*
    from expired_probe probe
    order by probe.root_type, probe.root_id
    limit v_scan_limit
  ) candidate;

  perform set_config('founderops.trash_lifecycle_write', 'off', true);

  return jsonb_build_object(
    'busy', false,
    'dryRun', coalesce(p_dry_run, false),
    'eligibleRoots', v_eligible_roots,
    'eligibleTasks', v_eligible_tasks,
    'purgedRoots', v_purged_roots,
    'purgedTasks', v_purged_tasks,
    'resolvedNotifications', v_resolved_notifications,
    'blockedExpiredRoots', v_blocked_expired_roots,
    'hasMore', v_has_more
  );
end;
$$;


ALTER FUNCTION "public"."purge_expired_planning_trash_batch"("p_limit" integer, "p_dry_run" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."purge_expired_planning_trash_batch"("p_limit" integer, "p_dry_run" boolean) IS 'Purges at most 25 expired planning trash roots after complete GitHub lifecycle processing while retaining audit and notification history.';



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
  v_initiative public.packages%rowtype;
  v_root_task public.tasks%rowtype;
  v_package_id text;
  v_task_ids text[] := array[]::text[];
  v_before_data jsonb;
  v_item jsonb;
begin
  if p_root_type is null
     or p_root_type not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_root_id, '')), '') is null
     or p_expected_trash_revision is null
     or p_expected_trash_revision < 1 then
    raise exception using errcode = '22023', message = 'planning restore input is invalid';
  end if;

  select platform_role into v_actor_role
  from public.profiles
  where id = p_actor_profile_id;
  if not found or v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'planning restore requires operational lead';
  end if;

  if p_root_type = 'initiative' then
    select * into v_initiative
    from public.packages
    where id = p_root_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'initiative not found';
    end if;
    if v_initiative.trashed_at is null
       or v_initiative.trash_root_type <> 'initiative'
       or v_initiative.trash_root_id <> p_root_id then
      raise exception using errcode = 'P0003', message = 'initiative is not a trash root';
    end if;
    if v_initiative.trash_revision <> p_expected_trash_revision then
      raise exception using errcode = 'P0001', message = 'initiative trash revision changed';
    end if;

    perform id
    from public.tasks
    where trash_root_type = 'initiative'
      and trash_root_id = p_root_id
      and trash_revision = p_expected_trash_revision
      and trashed_at is not null
    order by id
    for update;

    v_before_data := jsonb_build_object(
      'trashCause', v_initiative.trash_cause,
      'trashReason', v_initiative.trash_reason,
      'trashRevision', v_initiative.trash_revision
    );
    perform set_config('founderops.trash_lifecycle_write', 'on', true);

    update public.packages
    set approval_status = 'draft',
        approval_revision = approval_revision + 1,
        decided_by = null,
        decided_at = null,
        decision_note = null,
        trashed_at = null,
        trashed_by = null,
        trash_reason = null,
        trash_cause = null,
        purge_after = null,
        trash_root_type = null,
        trash_root_id = null
    where id = p_root_id
    returning * into v_initiative;

    with updated as (
      update public.tasks
      set approval_status = case when task_type = 'deliverable' then 'proposed' else null end,
          approval_revision = case when task_type = 'deliverable' then approval_revision + 1 else approval_revision end,
          proposed_at = case when task_type = 'deliverable' then clock_timestamp() else proposed_at end,
          decided_by = case when task_type = 'deliverable' then null else decided_by end,
          decided_at = case when task_type = 'deliverable' then null else decided_at end,
          decision_note = case when task_type = 'deliverable' then null else decision_note end,
          sprint_id = case when task_type = 'deliverable' then null else sprint_id end,
          review_status = case when task_type = 'deliverable' then 'not_requested' else review_status end,
          review_requested_at = case when task_type = 'deliverable' then null else review_requested_at end,
          score_points = case when task_type = 'deliverable' then 0 else score_points end,
          score_final = case when task_type = 'deliverable' then false else score_final end,
          trashed_at = null,
          trashed_by = null,
          trash_reason = null,
          trash_cause = null,
          purge_after = null,
          trash_root_type = null,
          trash_root_id = null,
          updated_at = clock_timestamp()
      where trash_root_type = 'initiative'
        and trash_root_id = p_root_id
        and trash_revision = p_expected_trash_revision
        and trashed_at is not null
      returning id
    )
    select coalesce(array_agg(id order by id), array[]::text[]) into v_task_ids from updated;

    v_item := to_jsonb(v_initiative);
  else
    select package_id into v_package_id
    from public.tasks
    where id = p_root_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'deliverable not found';
    end if;

    select * into v_initiative
    from public.packages
    where id = v_package_id
    for share;
    if not found or v_initiative.trashed_at is not null then
      raise exception using errcode = 'P0003', message = 'parent initiative must be restored first';
    end if;

    select * into v_root_task
    from public.tasks
    where id = p_root_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'deliverable not found';
    end if;
    if v_root_task.package_id is distinct from v_package_id then
      raise exception using errcode = 'P0001', message = 'deliverable initiative changed';
    end if;
    if v_root_task.task_type <> 'deliverable'
       or v_root_task.trashed_at is null
       or v_root_task.trash_root_type <> 'deliverable'
       or v_root_task.trash_root_id <> p_root_id then
      raise exception using errcode = 'P0003', message = 'deliverable is not a trash root';
    end if;
    if v_root_task.trash_revision <> p_expected_trash_revision then
      raise exception using errcode = 'P0001', message = 'deliverable trash revision changed';
    end if;

    perform id
    from public.tasks
    where trash_root_type = 'deliverable'
      and trash_root_id = p_root_id
      and trash_revision = p_expected_trash_revision
      and trashed_at is not null
    order by id
    for update;

    v_before_data := jsonb_build_object(
      'trashCause', v_root_task.trash_cause,
      'trashReason', v_root_task.trash_reason,
      'trashRevision', v_root_task.trash_revision
    );
    perform set_config('founderops.trash_lifecycle_write', 'on', true);

    with updated as (
      update public.tasks
      set approval_status = case when id = p_root_id then 'draft' else approval_status end,
          approval_revision = case when id = p_root_id then approval_revision + 1 else approval_revision end,
          decided_by = case when id = p_root_id then null else decided_by end,
          decided_at = case when id = p_root_id then null else decided_at end,
          decision_note = case when id = p_root_id then null else decision_note end,
          sprint_id = case when id = p_root_id then null else sprint_id end,
          review_status = case when id = p_root_id then 'not_requested' else review_status end,
          review_requested_at = case when id = p_root_id then null else review_requested_at end,
          score_points = case when id = p_root_id then 0 else score_points end,
          score_final = case when id = p_root_id then false else score_final end,
          trashed_at = null,
          trashed_by = null,
          trash_reason = null,
          trash_cause = null,
          purge_after = null,
          trash_root_type = null,
          trash_root_id = null,
          updated_at = clock_timestamp()
      where trash_root_type = 'deliverable'
        and trash_root_id = p_root_id
        and trash_revision = p_expected_trash_revision
        and trashed_at is not null
      returning id
    )
    select coalesce(array_agg(id order by id), array[]::text[]) into v_task_ids from updated;

    select * into v_root_task from public.tasks where id = p_root_id;
    v_item := to_jsonb(v_root_task);
    insert into public.task_activity (task_id, message)
    values (p_root_id, 'Deliverable aus dem Papierkorb wiederhergestellt · neue Freigabe erforderlich');
  end if;

  perform set_config('founderops.trash_lifecycle_write', 'off', true);

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
    case when p_root_type = 'initiative' then 'initiative.restored' else 'task.restored' end,
    p_root_type,
    p_root_id,
    v_before_data,
    jsonb_build_object(
      'trashRevision', p_expected_trash_revision,
      'affectedTaskIds', to_jsonb(v_task_ids),
      'approvalStatus', v_item->'approval_status',
      'approvalRevision', v_item->'approval_revision'
    ),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'rootType', p_root_type,
    'rootId', p_root_id,
    'affectedTaskIds', to_jsonb(v_task_ids),
    'trashRevision', p_expected_trash_revision,
    'item', v_item,
    'eventIds', '[]'::jsonb
  );
end;
$$;


ALTER FUNCTION "public"."restore_planning_item_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_trash_revision" integer, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."restore_planning_item_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_trash_revision" integer, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") IS 'Atomically restores one planning trash root while requiring a fresh approval cycle.';



CREATE OR REPLACE FUNCTION "public"."review_task_transaction"("p_task_id" "text", "p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_reviewer_profile_id" "text", "p_decision" "text", "p_points" integer, "p_comment" "text", "p_checklist" "jsonb", "p_activity_message" "text", "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text", "p_user_agent" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_sprint_locked boolean;
  v_update_result jsonb;
  v_review jsonb;
begin
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'expected task update timestamp is required';
  end if;
  if p_decision not in ('accepted', 'partial', 'changes_requested') then
    raise exception using errcode = '22023', message = 'invalid review decision';
  end if;
  if p_points < 0 or p_points > 10 then
    raise exception using errcode = '22023', message = 'review points must be between 0 and 10';
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

  v_update_result := public.update_task_transaction(
    p_task_id,
    p_expected_updated_at,
    coalesce(p_task_patch, '{}'::jsonb),
    false,
    null,
    false,
    null,
    array[p_activity_message],
    coalesce(p_notifications, '[]'::jsonb)
  );

  if (v_update_result -> 'task' ->> 'sprint_id') is distinct from p_sprint_id then
    raise exception using errcode = '22023', message = 'task sprint changed during review';
  end if;

  insert into public.task_reviews (
    task_id,
    sprint_id,
    reviewer_profile_id,
    decision,
    points,
    comment,
    checklist
  )
  values (
    p_task_id,
    p_sprint_id,
    p_reviewer_profile_id,
    p_decision,
    p_points,
    p_comment,
    coalesce(p_checklist, '{}'::jsonb)
  )
  returning to_jsonb(task_reviews) into v_review;

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
    p_reviewer_profile_id,
    'task.review',
    'task',
    p_task_id,
    coalesce(p_audit_after_data, '{}'::jsonb),
    p_request_ip,
    p_user_agent
  );

  return v_update_result || jsonb_build_object('review', v_review);
end;
$$;


ALTER FUNCTION "public"."review_task_transaction"("p_task_id" "text", "p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_reviewer_profile_id" "text", "p_decision" "text", "p_points" integer, "p_comment" "text", "p_checklist" "jsonb", "p_activity_message" "text", "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."review_task_transaction"("p_task_id" "text", "p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_reviewer_profile_id" "text", "p_decision" "text", "p_points" integer, "p_comment" "text", "p_checklist" "jsonb", "p_activity_message" "text", "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text", "p_user_agent" "text") IS 'Atomically applies a task review with compare-and-set task state, immutable review history, activity, notification, and audit.';



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



CREATE OR REPLACE FUNCTION "public"."trash_planning_item_tree_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_revision" integer, "p_actor_profile_id" "text", "p_reason" "text", "p_cause" "text", "p_request_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor_role text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_trashed_at timestamptz := clock_timestamp();
  v_initiative public.packages%rowtype;
  v_task public.tasks%rowtype;
  v_root_task public.tasks%rowtype;
  v_task_ids text[] := array[]::text[];
  v_event_ids bigint[] := array[]::bigint[];
  v_notification_id bigint;
  v_root_trash_revision integer;
  v_package_id text;
  v_before_data jsonb;
  v_item jsonb;
begin
  if p_root_type is null
     or p_root_type not in ('initiative', 'deliverable')
     or nullif(trim(coalesce(p_root_id, '')), '') is null
     or p_expected_revision is null
     or p_expected_revision < 1
     or p_cause is null
     or p_cause not in ('withdrawn', 'rejected') then
    raise exception using errcode = '22023', message = 'planning trash input is invalid';
  end if;
  if v_reason is null then
    raise exception using errcode = '22023', message = 'planning trash reason is required';
  end if;
  if char_length(v_reason) > 2000 then
    raise exception using errcode = '22023', message = 'planning trash reason exceeds 2000 characters';
  end if;

  select platform_role into v_actor_role
  from public.profiles
  where id = p_actor_profile_id;
  if not found then
    raise exception using errcode = 'P0006', message = 'planning trash actor not found';
  end if;

  if p_root_type = 'initiative' then
    select * into v_initiative
    from public.packages
    where id = p_root_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'initiative not found';
    end if;
    if v_initiative.trashed_at is not null then
      raise exception using errcode = 'P0003', message = 'initiative is already trashed';
    end if;
    if v_initiative.approval_revision <> p_expected_revision then
      raise exception using errcode = 'P0001', message = 'initiative approval revision changed';
    end if;
    if p_cause = 'withdrawn' then
      if v_initiative.approval_status not in ('draft', 'proposed') then
        raise exception using errcode = 'P0003', message = 'only draft or proposed initiatives may be withdrawn';
      end if;
      if v_actor_role not in ('ceo', 'deputy')
         and coalesce(v_initiative.proposed_by, '') <> p_actor_profile_id then
        raise exception using errcode = 'P0006', message = 'initiative withdrawal requires proposer or operational lead';
      end if;
    else
      if v_initiative.approval_status <> 'proposed' then
        raise exception using errcode = 'P0003', message = 'initiative is not proposed';
      end if;
      if v_actor_role <> 'ceo' then
        raise exception using errcode = 'P0006', message = 'only ceo may reject initiative approval';
      end if;
    end if;

    perform id
    from public.tasks
    where package_id = p_root_id and trashed_at is null
    order by id
    for update;

    v_before_data := jsonb_build_object(
      'approvalStatus', v_initiative.approval_status,
      'approvalRevision', v_initiative.approval_revision,
      'trashRevision', v_initiative.trash_revision
    );
    perform set_config('founderops.trash_lifecycle_write', 'on', true);

    update public.packages
    set approval_status = case when p_cause = 'rejected' then 'rejected' else approval_status end,
        approval_revision = case when p_cause = 'rejected' then approval_revision + 1 else approval_revision end,
        decided_by = case when p_cause = 'rejected' then p_actor_profile_id else decided_by end,
        decided_at = case when p_cause = 'rejected' then v_trashed_at else decided_at end,
        decision_note = case when p_cause = 'rejected' then v_reason else decision_note end,
        trashed_at = v_trashed_at,
        trashed_by = p_actor_profile_id,
        trash_reason = v_reason,
        trash_cause = p_cause,
        purge_after = v_trashed_at + interval '90 days',
        trash_root_type = 'initiative',
        trash_root_id = p_root_id,
        trash_revision = trash_revision + 1
    where id = p_root_id
    returning * into v_initiative;

    with updated as (
      update public.tasks
      set trashed_at = v_trashed_at,
          trashed_by = p_actor_profile_id,
          trash_reason = v_reason,
          trash_cause = p_cause,
          purge_after = v_trashed_at + interval '90 days',
          trash_root_type = 'initiative',
          trash_root_id = p_root_id,
          trash_revision = v_initiative.trash_revision,
          updated_at = clock_timestamp()
      where package_id = p_root_id and trashed_at is null
      returning id
    )
    select coalesce(array_agg(id order by id), array[]::text[]) into v_task_ids from updated;

    v_root_trash_revision := v_initiative.trash_revision;
    v_item := to_jsonb(v_initiative);
  else
    select package_id into v_package_id
    from public.tasks
    where id = p_root_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'deliverable not found';
    end if;

    select * into v_initiative
    from public.packages
    where id = v_package_id
    for share;
    if not found or v_initiative.trashed_at is not null then
      raise exception using errcode = 'P0003', message = 'deliverable requires an active initiative';
    end if;

    select * into v_task
    from public.tasks
    where id = p_root_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'deliverable not found';
    end if;
    if v_task.package_id is distinct from v_package_id then
      raise exception using errcode = 'P0001', message = 'deliverable initiative changed';
    end if;
    if v_task.task_type <> 'deliverable' then
      raise exception using errcode = '22023', message = 'only deliverables may be trashed as task roots';
    end if;
    if v_task.trashed_at is not null then
      raise exception using errcode = 'P0003', message = 'deliverable is already trashed';
    end if;
    if v_task.approval_revision <> p_expected_revision then
      raise exception using errcode = 'P0001', message = 'deliverable approval revision changed';
    end if;
    if p_cause = 'withdrawn' then
      if v_task.approval_status not in ('draft', 'proposed') then
        raise exception using errcode = 'P0003', message = 'only draft or proposed deliverables may be withdrawn';
      end if;
      if v_actor_role not in ('ceo', 'deputy')
         and coalesce(v_task.proposed_by, '') <> p_actor_profile_id then
        raise exception using errcode = 'P0006', message = 'deliverable withdrawal requires proposer or operational lead';
      end if;
    else
      if v_task.approval_status <> 'proposed' then
        raise exception using errcode = 'P0003', message = 'deliverable is not proposed';
      end if;
      if v_actor_role <> 'ceo'
         and coalesce(v_initiative.accountable_profile_id, '') <> p_actor_profile_id then
        raise exception using errcode = 'P0006', message = 'deliverable rejection requires ceo or initiative accountable';
      end if;
    end if;

    perform id
    from public.tasks
    where parent_task_id = p_root_id and trashed_at is null
    order by id
    for update;

    v_before_data := jsonb_build_object(
      'approvalStatus', v_task.approval_status,
      'approvalRevision', v_task.approval_revision,
      'trashRevision', v_task.trash_revision
    );
    v_root_trash_revision := v_task.trash_revision + 1;
    perform set_config('founderops.trash_lifecycle_write', 'on', true);

    with updated as (
      update public.tasks
      set approval_status = case
            when id = p_root_id and p_cause = 'rejected' then 'rejected'
            else approval_status
          end,
          approval_revision = case
            when id = p_root_id and p_cause = 'rejected' then approval_revision + 1
            else approval_revision
          end,
          decided_by = case
            when id = p_root_id and p_cause = 'rejected' then p_actor_profile_id
            else decided_by
          end,
          decided_at = case
            when id = p_root_id and p_cause = 'rejected' then v_trashed_at
            else decided_at
          end,
          decision_note = case
            when id = p_root_id and p_cause = 'rejected' then v_reason
            else decision_note
          end,
          sprint_id = case when id = p_root_id then null else sprint_id end,
          review_status = case when id = p_root_id then 'not_requested' else review_status end,
          review_requested_at = case when id = p_root_id then null else review_requested_at end,
          score_points = case when id = p_root_id then 0 else score_points end,
          score_final = case when id = p_root_id then false else score_final end,
          trashed_at = v_trashed_at,
          trashed_by = p_actor_profile_id,
          trash_reason = v_reason,
          trash_cause = p_cause,
          purge_after = v_trashed_at + interval '90 days',
          trash_root_type = 'deliverable',
          trash_root_id = p_root_id,
          trash_revision = v_root_trash_revision,
          updated_at = clock_timestamp()
      where (id = p_root_id or parent_task_id = p_root_id) and trashed_at is null
      returning *
    ), collected as (
      select coalesce(array_agg(id order by id), array[]::text[]) as ids from updated
    )
    select ids into v_task_ids from collected;

    select * into v_root_task from public.tasks where id = p_root_id;
    v_item := to_jsonb(v_root_task);

    insert into public.task_activity (task_id, message)
    values (
      p_root_id,
      case p_cause
        when 'rejected' then 'Deliverable abgelehnt und in den Papierkorb verschoben · Revision ' || v_root_task.approval_revision || ' · Begründung: ' || v_reason
        else 'Deliverable zurückgezogen und in den Papierkorb verschoben · Begründung: ' || v_reason
      end
    );
  end if;

  insert into public.planning_github_lifecycle_outbox (
    root_type,
    root_id,
    root_trash_revision,
    task_id,
    github_repo,
    github_issue_number,
    action,
    source_type,
    source_revision,
    reason,
    status,
    status_reason,
    last_error
  )
  select
    p_root_type,
    p_root_id,
    v_root_trash_revision,
    task.id,
    issue_reference.normalized_repo,
    issue_reference.normalized_issue_number,
    'close_not_planned',
    p_cause,
    v_root_trash_revision,
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
  on conflict (root_type, root_id, root_trash_revision, task_id, action) do nothing;

  perform set_config('founderops.trash_lifecycle_write', 'off', true);

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
    case
      when p_cause = 'rejected' and p_root_type = 'initiative' then 'initiative.approval_reject'
      when p_cause = 'rejected' then 'task.approval_reject'
      when p_root_type = 'initiative' then 'initiative.withdrawn'
      else 'task.withdrawn'
    end,
    case when p_root_type = 'initiative' then 'initiative' else 'task' end,
    p_root_id,
    v_before_data,
    jsonb_build_object(
      'trashCause', p_cause,
      'trashReason', v_reason,
      'trashRevision', v_root_trash_revision,
      'affectedTaskIds', to_jsonb(v_task_ids),
      'approvalStatus', v_item->'approval_status',
      'approvalRevision', v_item->'approval_revision'
    ),
    p_request_ip,
    p_user_agent
  );

  if p_cause = 'rejected' then
    if p_root_type = 'initiative' then
      if v_initiative.proposed_by is not null then
        insert into public.notification_events (
          type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body, dedupe_key
        ) values (
          'planning_item.rejected', p_actor_profile_id, v_initiative.proposed_by, 'initiative', p_root_id,
          'Initiative abgelehnt: ' || v_initiative.title,
          'Begründung: ' || v_reason,
          'planning-item-rejected:initiative:' || p_root_id || ':' || v_initiative.approval_revision
        ) returning id into v_notification_id;
      end if;
    elsif v_root_task.proposed_by is not null then
      insert into public.notification_events (
        type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body, dedupe_key
      ) values (
        'planning_item.rejected', p_actor_profile_id, v_root_task.proposed_by, 'task', p_root_id,
        'Deliverable abgelehnt: ' || v_root_task.title,
        'Begründung: ' || v_reason,
        'planning-item-rejected:task:' || p_root_id || ':' || v_root_task.approval_revision
      ) returning id into v_notification_id;
    end if;
    if v_notification_id is not null then
      v_event_ids := array_append(v_event_ids, v_notification_id);
    end if;
  end if;

  return jsonb_build_object(
    'rootType', p_root_type,
    'rootId', p_root_id,
    'affectedTaskIds', to_jsonb(v_task_ids),
    'trashRevision', v_root_trash_revision,
    'item', v_item,
    'eventIds', to_jsonb(v_event_ids)
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



CREATE OR REPLACE FUNCTION "public"."update_planning_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb" DEFAULT '{}'::"jsonb", "p_note_present" boolean DEFAULT false, "p_note" "text" DEFAULT NULL::"text", "p_dependency_present" boolean DEFAULT false, "p_dependency_note" "text" DEFAULT NULL::"text", "p_activity_messages" "text"[] DEFAULT '{}'::"text"[], "p_notifications" "jsonb" DEFAULT '[]'::"jsonb", "p_actor_profile_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_patch jsonb := coalesce(p_task_patch, '{}'::jsonb);
  v_parent_id text;
  v_before_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_updated_task public.tasks%rowtype;
  v_result jsonb;
begin
  perform set_config('app.actor_profile_id', coalesce(p_actor_profile_id, ''), true);

  if not (v_patch ? 'parent_task_id') then
    return public.update_task_transaction(
      p_task_id, p_expected_updated_at, v_patch, p_note_present, p_note,
      p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
    );
  end if;

  v_parent_id := nullif(trim(v_patch->>'parent_task_id'), '');
  if v_parent_id is null then
    raise exception using errcode = '22023', message = 'sub-issue parent is required';
  end if;

  select * into v_before_task
  from public.tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
  if v_before_task.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'task was changed concurrently';
  end if;
  if v_before_task.task_type <> 'sub_issue' then
    raise exception using errcode = '22023', message = 'only sub-issues may change parent';
  end if;

  select * into v_parent
  from public.tasks
  where id = v_parent_id
    and task_type = 'deliverable'
  for share;
  if not found then
    raise exception using errcode = '22023', message = 'sub-issue parent must be a deliverable';
  end if;

  v_result := public.update_task_transaction(
    p_task_id, p_expected_updated_at, v_patch - 'parent_task_id', p_note_present, p_note,
    p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
  );

  update public.tasks
  set parent_task_id = v_parent_id,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning * into v_updated_task;

  if v_before_task.parent_task_id is distinct from v_updated_task.parent_task_id then
    insert into public.audit_log (
      actor_profile_id,
      action,
      entity_type,
      entity_id,
      before_data,
      after_data
    ) values (
      p_actor_profile_id,
      'task.parent_changed',
      'task',
      p_task_id,
      jsonb_build_object(
        'parentTaskId', v_before_task.parent_task_id,
        'packageId', v_before_task.package_id,
        'milestoneId', v_before_task.milestone_id
      ),
      jsonb_build_object(
        'parentTaskId', v_updated_task.parent_task_id,
        'packageId', v_updated_task.package_id,
        'milestoneId', v_updated_task.milestone_id
      )
    );
  end if;

  return jsonb_set(
    jsonb_set(v_result, '{task}', to_jsonb(v_updated_task), true),
    '{parentApprovalStatus}',
    to_jsonb(v_parent.approval_status),
    true
  );
end;
$$;


ALTER FUNCTION "public"."update_planning_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_actor_profile_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_planning_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_actor_profile_id" "text") IS 'Atomically applies approval-aware task updates and controlled Sub-Issue parent changes with compare-and-set protection and audit history.';



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
  v_demoted_ceo_ids text[] := '{}';
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

  update public.profiles as profile
  set github_login = case when v_patch ? 'github_login' then nullif(v_patch ->> 'github_login', '') else profile.github_login end,
      platform_role = case when v_patch ? 'platform_role' then v_patch ->> 'platform_role' else profile.platform_role end,
      org_role = case when v_patch ? 'org_role' then nullif(v_patch ->> 'org_role', '') else profile.org_role end,
      deputy_for = case when v_patch ? 'deputy_for' then nullif(v_patch ->> 'deputy_for', '') else profile.deputy_for end,
      deputy_active_from = case when v_patch ? 'deputy_active_from' then nullif(v_patch ->> 'deputy_active_from', '')::date else profile.deputy_active_from end,
      deputy_active_until = case when v_patch ? 'deputy_active_until' then nullif(v_patch ->> 'deputy_active_until', '')::date else profile.deputy_active_until end,
      focus = case when v_patch ? 'focus' then nullif(v_patch ->> 'focus', '') else profile.focus end,
      weekly_capacity = case when v_patch ? 'weekly_capacity' then (v_patch ->> 'weekly_capacity')::integer else profile.weekly_capacity end,
      profile_color = case when v_patch ? 'profile_color' then v_patch ->> 'profile_color' else profile.profile_color end,
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
  v_before jsonb;
  v_profile jsonb;
  v_ui_preference jsonb := null;
  v_preferences jsonb;
begin
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'profile patch must be a JSON object';
  end if;

  select to_jsonb(profile)
  into v_before
  from public.profiles as profile
  where profile.id = p_profile_id
  for update;

  if v_before is null then
    raise exception using errcode = 'P0002', message = 'profile not found';
  end if;

  update public.profiles as profile
  set focus = case when v_patch ? 'focus' then nullif(v_patch ->> 'focus', '') else profile.focus end,
      profile_color = case when v_patch ? 'profile_color' then v_patch ->> 'profile_color' else profile.profile_color end,
      notifications_enabled = case when v_patch ? 'notifications_enabled' then (v_patch ->> 'notifications_enabled')::boolean else profile.notifications_enabled end
  where profile.id = p_profile_id
  returning to_jsonb(profile) into v_profile;

  if p_ui_preferences is not null then
    if jsonb_typeof(p_ui_preferences) <> 'object' then
      raise exception using errcode = '22023', message = 'UI preferences must be a JSON object';
    end if;

    insert into public.profile_ui_preferences as preference (
      profile_id,
      default_workspace,
      default_task_view,
      planning_filters,
      expanded_package_ids,
      updated_at
    )
    values (
      p_profile_id,
      p_ui_preferences ->> 'default_workspace',
      p_ui_preferences ->> 'default_task_view',
      p_ui_preferences -> 'planning_filters',
      array(select jsonb_array_elements_text(p_ui_preferences -> 'expanded_package_ids')),
      now()
    )
    on conflict (profile_id) do update
      set default_workspace = excluded.default_workspace,
          default_task_view = excluded.default_task_view,
          planning_filters = excluded.planning_filters,
          expanded_package_ids = excluded.expanded_package_ids,
          updated_at = excluded.updated_at
    returning jsonb_build_object(
      'profile_id', preference.profile_id,
      'default_workspace', preference.default_workspace,
      'default_task_view', preference.default_task_view,
      'planning_filters', preference.planning_filters,
      'expanded_package_ids', to_jsonb(preference.expanded_package_ids),
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



CREATE TABLE IF NOT EXISTS "public"."packages" (
    "id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "goal" "text",
    "priority" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "milestone_id" "text",
    "owner_id" "text",
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "target_date" "date",
    "success_criteria" "text" DEFAULT ''::"text" NOT NULL,
    "scope_constraints" "text" DEFAULT ''::"text" NOT NULL,
    "accountable_profile_id" "text",
    "responsible_profile_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "consulted_profile_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "informed_profile_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "approval_status" "text" DEFAULT 'proposed'::"text" NOT NULL,
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
    CONSTRAINT "packages_approval_revision_check" CHECK (("approval_revision" >= 1)),
    CONSTRAINT "packages_approval_status_check" CHECK (("approval_status" = ANY (ARRAY['draft'::"text", 'proposed'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "packages_consulted_profile_ids_no_null" CHECK (("array_position"("consulted_profile_ids", NULL::"text") IS NULL)),
    CONSTRAINT "packages_informed_profile_ids_no_null" CHECK (("array_position"("informed_profile_ids", NULL::"text") IS NULL)),
    CONSTRAINT "packages_responsible_profile_ids_no_null" CHECK (("array_position"("responsible_profile_ids", NULL::"text") IS NULL)),
    CONSTRAINT "packages_status_check" CHECK (("status" = ANY (ARRAY['planned'::"text", 'active'::"text", 'done'::"text", 'paused'::"text"]))),
    CONSTRAINT "packages_trash_metadata_check" CHECK (((("trashed_at" IS NULL) AND ("trashed_by" IS NULL) AND ("trash_reason" IS NULL) AND ("trash_cause" IS NULL) AND ("purge_after" IS NULL) AND ("trash_root_type" IS NULL) AND ("trash_root_id" IS NULL)) OR (("trashed_at" IS NOT NULL) AND ("trashed_by" IS NOT NULL) AND (NULLIF(TRIM(BOTH FROM "trash_reason"), ''::"text") IS NOT NULL) AND ("trash_cause" = ANY (ARRAY['withdrawn'::"text", 'rejected'::"text"])) AND ("purge_after" = ("trashed_at" + '90 days'::interval)) AND ("trash_root_type" = 'initiative'::"text") AND ("trash_root_id" = "id") AND ("trash_revision" >= 1)))),
    CONSTRAINT "packages_trash_revision_check" CHECK (("trash_revision" >= 0))
);


ALTER TABLE "public"."packages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."packages"."accountable_profile_id" IS 'Mini-RACI Accountable profile for the fachliche Initiative.';



COMMENT ON COLUMN "public"."packages"."responsible_profile_ids" IS 'Mini-RACI Responsible profile IDs for the fachliche Initiative.';



COMMENT ON COLUMN "public"."packages"."consulted_profile_ids" IS 'Mini-RACI Consulted profile IDs for the fachliche Initiative.';



COMMENT ON COLUMN "public"."packages"."informed_profile_ids" IS 'Mini-RACI Informed profile IDs for the fachliche Initiative.';



CREATE OR REPLACE VIEW "public"."active_packages" WITH ("security_invoker"='true') AS
 SELECT "id",
    "project_id",
    "title",
    "goal",
    "priority",
    "sort_order",
    "milestone_id",
    "owner_id",
    "status",
    "target_date",
    "success_criteria",
    "scope_constraints",
    "accountable_profile_id",
    "responsible_profile_ids",
    "consulted_profile_ids",
    "informed_profile_ids",
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
    "trash_revision"
   FROM "public"."packages"
  WHERE ("trashed_at" IS NULL);


ALTER VIEW "public"."active_packages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "package_id" "text",
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" NOT NULL,
    "priority" "text" NOT NULL,
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
    "milestone_id" "text",
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
    CONSTRAINT "tasks_approval_revision_check" CHECK (("approval_revision" >= 1)),
    CONSTRAINT "tasks_approval_sprint_check" CHECK (((("task_type" = 'deliverable'::"text") AND ("approval_status" = 'approved'::"text")) OR ("sprint_id" IS NULL))),
    CONSTRAINT "tasks_approval_status_by_type_check" CHECK (((("task_type" = 'sub_issue'::"text") AND ("approval_status" IS NULL)) OR (("task_type" = 'deliverable'::"text") AND ("approval_status" = ANY (ARRAY['draft'::"text", 'proposed'::"text", 'approved'::"text", 'rejected'::"text"]))))),
    CONSTRAINT "tasks_github_repo_allowed_check" CHECK (((("task_type" = 'sub_issue'::"text") AND ("github_repo" = ANY (ARRAY['findmydoc-platform/management'::"text", 'findmydoc-platform/website'::"text", 'findmydoc-platform/clinic-dashboard'::"text"]))) OR (("task_type" = 'deliverable'::"text") AND ("github_repo" = 'findmydoc-platform/management'::"text")))),
    CONSTRAINT "tasks_github_sync_status_check" CHECK (("github_issue_sync_status" = ANY (ARRAY['not_synced'::"text", 'synced'::"text", 'pending'::"text", 'failed'::"text"]))),
    CONSTRAINT "tasks_intake_source_check" CHECK (("intake_source" = ANY (ARRAY['manual'::"text", 'ceo_intake'::"text", 'agent_api'::"text", 'team_intake'::"text"]))),
    CONSTRAINT "tasks_intake_status_check" CHECK (("intake_status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'rejected'::"text"]))),
    CONSTRAINT "tasks_review_status_check" CHECK (("review_status" = ANY (ARRAY['not_requested'::"text", 'requested'::"text", 'accepted'::"text", 'partial'::"text", 'changes_requested'::"text"]))),
    CONSTRAINT "tasks_score_relevance_approval_check" CHECK (("score_relevant" = (("task_type" = 'deliverable'::"text") AND ("approval_status" = 'approved'::"text") AND ("sprint_id" IS NOT NULL)))),
    CONSTRAINT "tasks_sprint_outcome_check" CHECK ((("sprint_outcome" IS NULL) OR ("sprint_outcome" = ANY (ARRAY['completed'::"text", 'partial'::"text", 'rework'::"text", 'communicated_blocker'::"text", 'missed_no_review'::"text", 'missed_uncommunicated'::"text"])))),
    CONSTRAINT "tasks_status_not_proposal_check" CHECK (("status" <> 'Vorschlag'::"text")),
    CONSTRAINT "tasks_task_type_check" CHECK (("task_type" = ANY (ARRAY['deliverable'::"text", 'sub_issue'::"text"]))),
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



CREATE OR REPLACE VIEW "public"."active_tasks" WITH ("security_invoker"='true') AS
 SELECT "id",
    "project_id",
    "package_id",
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
    "milestone_id",
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
    "trash_revision"
   FROM "public"."tasks"
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



CREATE TABLE IF NOT EXISTS "public"."milestones" (
    "id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "target_date" "date",
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "milestones_status_check" CHECK (("status" = ANY (ARRAY['planned'::"text", 'active'::"text", 'done'::"text"])))
);


ALTER TABLE "public"."milestones" OWNER TO "postgres";


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
    CONSTRAINT "notification_events_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."notification_events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."notification_events"."seen_at" IS 'Set when the recipient opens an in-app notification; the notification remains open.';



COMMENT ON COLUMN "public"."notification_events"."dismissed_at" IS 'Set when the recipient explicitly closes an in-app notification.';



COMMENT ON COLUMN "public"."notification_events"."resolved_at" IS 'Set by system reconciliation when the source condition is no longer relevant.';



COMMENT ON COLUMN "public"."notification_events"."resolution_reason" IS 'Stable system reason explaining why reconciliation resolved the notification.';



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
    "planning_filters" "jsonb" DEFAULT '{"owner": "Alle", "query": "", "quick": "", "status": "Alle", "priority": "Alle", "packageId": "Alle"}'::"jsonb" NOT NULL,
    "expanded_package_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profile_ui_preferences_default_task_view_check" CHECK (("default_task_view" = ANY (ARRAY['board'::"text", 'structure'::"text", 'table'::"text", 'gantt'::"text"]))),
    CONSTRAINT "profile_ui_preferences_default_workspace_check" CHECK (("default_workspace" = ANY (ARRAY['planning'::"text", 'execution'::"text", 'mine'::"text", 'reviews'::"text", 'events'::"text", 'sprint'::"text", 'decisions'::"text", 'meetings'::"text", 'projects'::"text", 'tools'::"text", 'team'::"text", 'settings'::"text", 'ceo-intake'::"text", 'profile'::"text"])))
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
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'member'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."google_calendar_email" IS 'Google Workspace calendar email used by the Meeting Finder import.';



COMMENT ON COLUMN "public"."profiles"."google_calendar_sync_enabled" IS 'Controls whether this profile is included in the Google Calendar busy-block import.';



COMMENT ON COLUMN "public"."profiles"."google_calendar_last_synced_at" IS 'Last successful Meeting Finder calendar import timestamp for this profile.';



CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "range_label" "text"
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


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



CREATE TABLE IF NOT EXISTS "public"."task_activity" (
    "id" bigint NOT NULL,
    "task_id" "text" NOT NULL,
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."task_activity" OWNER TO "postgres";


ALTER TABLE "public"."task_activity" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."task_activity_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



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
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
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
    CONSTRAINT "task_external_comments_source_check" CHECK (("source" = 'github'::"text"))
);


ALTER TABLE "public"."task_external_comments" OWNER TO "postgres";


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
    "url" "text" NOT NULL
);


ALTER TABLE "public"."task_links" OWNER TO "postgres";


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



CREATE TABLE IF NOT EXISTS "public"."team_task_intake_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token_id" "uuid" NOT NULL,
    "profile_id" "text" NOT NULL,
    "idempotency_key" "uuid" NOT NULL,
    "request_hash" "text" NOT NULL,
    "task_ids" "text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "response_tasks" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "team_task_intake_batches_request_hash_check" CHECK (("request_hash" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "team_task_intake_batches_response_tasks_check" CHECK (("jsonb_typeof"("response_tasks") = 'array'::"text")),
    CONSTRAINT "team_task_intake_batches_task_ids_check" CHECK ((("cardinality"("task_ids") >= 1) AND ("cardinality"("task_ids") <= 30)))
);


ALTER TABLE "public"."team_task_intake_batches" OWNER TO "postgres";


COMMENT ON TABLE "public"."team_task_intake_batches" IS 'Immutable idempotency records for atomic Team Task Intake commits.';



COMMENT ON COLUMN "public"."team_task_intake_batches"."response_tasks" IS 'Immutable task-row snapshots returned for deterministic idempotent replays.';



CREATE TABLE IF NOT EXISTS "public"."team_task_intake_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "text" NOT NULL,
    "label" "text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "token_hint" "text" NOT NULL,
    "scopes" "text"[] DEFAULT ARRAY['read:task-context'::"text", 'write:task-intake'::"text"] NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "team_task_intake_tokens_expiry_check" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "team_task_intake_tokens_hash_check" CHECK (("token_hash" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "team_task_intake_tokens_hint_check" CHECK ((("char_length"("token_hint") >= 4) AND ("char_length"("token_hint") <= 16))),
    CONSTRAINT "team_task_intake_tokens_label_check" CHECK ((("char_length"("label") >= 1) AND ("char_length"("label") <= 80))),
    CONSTRAINT "team_task_intake_tokens_max_expiry_check" CHECK (("expires_at" <= ("created_at" + '90 days'::interval))),
    CONSTRAINT "team_task_intake_tokens_scopes_check" CHECK ((("array_position"("scopes", NULL::"text") IS NULL) AND ("scopes" <@ ARRAY['read:task-context'::"text", 'write:task-intake'::"text"]) AND ("scopes" @> ARRAY['read:task-context'::"text", 'write:task-intake'::"text"])))
);


ALTER TABLE "public"."team_task_intake_tokens" OWNER TO "postgres";


COMMENT ON TABLE "public"."team_task_intake_tokens" IS 'Hashed personal tokens for task-centered team context and guarded task intake.';



COMMENT ON COLUMN "public"."team_task_intake_tokens"."token_hash" IS 'SHA-256 hash of the one-time visible personal intake token.';



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



ALTER TABLE ONLY "public"."meeting_attendance"
    ADD CONSTRAINT "meeting_attendance_meeting_id_profile_id_key" UNIQUE ("meeting_id", "profile_id");



ALTER TABLE ONLY "public"."meeting_attendance"
    ADD CONSTRAINT "meeting_attendance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."meetings"
    ADD CONSTRAINT "meetings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."milestones"
    ADD CONSTRAINT "milestones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_deliveries"
    ADD CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_events"
    ADD CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_profile_id_channel_event_type_key" UNIQUE ("profile_id", "channel", "event_type");



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."planning_github_lifecycle_outbox"
    ADD CONSTRAINT "planning_github_lifecycle_outbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."planning_github_lifecycle_outbox"
    ADD CONSTRAINT "planning_github_lifecycle_outbox_root_task_action_key" UNIQUE ("root_type", "root_id", "root_trash_revision", "task_id", "action");



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



ALTER TABLE ONLY "public"."task_activity"
    ADD CONSTRAINT "task_activity_pkey" PRIMARY KEY ("id");



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



CREATE INDEX "github_app_user_tokens_github_login_idx" ON "public"."github_app_user_tokens" USING "btree" ("github_login");



CREATE INDEX "github_app_user_tokens_refresh_idx" ON "public"."github_app_user_tokens" USING "btree" ("refresh_token_expires_at");



CREATE INDEX "github_issue_sync_locks_expires_idx" ON "public"."github_issue_sync_locks" USING "btree" ("expires_at");



CREATE INDEX "github_issue_sync_locks_task_idx" ON "public"."github_issue_sync_locks" USING "btree" ("task_id");



CREATE INDEX "meeting_attendance_meeting_idx" ON "public"."meeting_attendance" USING "btree" ("meeting_id");



CREATE INDEX "meeting_attendance_profile_idx" ON "public"."meeting_attendance" USING "btree" ("profile_id");



CREATE INDEX "meetings_google_calendar_event_idx" ON "public"."meetings" USING "btree" ("google_calendar_id", "google_calendar_event_id") WHERE ("google_calendar_event_id" IS NOT NULL);



CREATE INDEX "meetings_sprint_id_idx" ON "public"."meetings" USING "btree" ("sprint_id");



CREATE INDEX "milestones_project_idx" ON "public"."milestones" USING "btree" ("project_id", "sort_order");



CREATE INDEX "notification_deliveries_event_id_idx" ON "public"."notification_deliveries" USING "btree" ("event_id");



CREATE INDEX "notification_deliveries_status_idx" ON "public"."notification_deliveries" USING "btree" ("status");



CREATE UNIQUE INDEX "notification_events_dedupe_key_uidx" ON "public"."notification_events" USING "btree" ("dedupe_key") WHERE ("dedupe_key" IS NOT NULL);



CREATE INDEX "notification_events_entity_idx" ON "public"."notification_events" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "notification_events_recipient_status_idx" ON "public"."notification_events" USING "btree" ("recipient_profile_id", "status");



CREATE INDEX "notification_events_status_created_idx" ON "public"."notification_events" USING "btree" ("status", "created_at");



CREATE INDEX "notification_events_unseen_recipient_created_idx" ON "public"."notification_events" USING "btree" ("recipient_profile_id", "created_at" DESC) WHERE (("status" = 'pending'::"text") AND ("seen_at" IS NULL));



CREATE INDEX "packages_accountable_profile_id_idx" ON "public"."packages" USING "btree" ("accountable_profile_id");



CREATE INDEX "packages_approval_status_idx" ON "public"."packages" USING "btree" ("approval_status");



CREATE INDEX "packages_milestone_id_idx" ON "public"."packages" USING "btree" ("milestone_id");



CREATE INDEX "packages_owner_id_idx" ON "public"."packages" USING "btree" ("owner_id");



CREATE INDEX "packages_project_id_idx" ON "public"."packages" USING "btree" ("project_id");



CREATE INDEX "packages_purge_after_idx" ON "public"."packages" USING "btree" ("purge_after", "id") WHERE ("trashed_at" IS NOT NULL);



CREATE INDEX "packages_status_idx" ON "public"."packages" USING "btree" ("status");



CREATE INDEX "packages_target_date_idx" ON "public"."packages" USING "btree" ("target_date");



CREATE INDEX "packages_trash_root_idx" ON "public"."packages" USING "btree" ("trash_root_type", "trash_root_id") WHERE ("trashed_at" IS NOT NULL);



CREATE INDEX "planning_github_lifecycle_outbox_claim_idx" ON "public"."planning_github_lifecycle_outbox" USING "btree" ("status", "available_at", "created_at") WHERE ("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'retry_scheduled'::"text"]));



CREATE INDEX "planning_github_lifecycle_outbox_root_idx" ON "public"."planning_github_lifecycle_outbox" USING "btree" ("root_type", "root_id", "root_trash_revision", "action", "status");



CREATE INDEX "planning_github_lifecycle_outbox_task_idx" ON "public"."planning_github_lifecycle_outbox" USING "btree" ("task_id", "created_at");



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



CREATE INDEX "task_activity_task_id_idx" ON "public"."task_activity" USING "btree" ("task_id");



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



CREATE INDEX "tasks_milestone_id_idx" ON "public"."tasks" USING "btree" ("milestone_id");



CREATE INDEX "tasks_original_sprint_idx" ON "public"."tasks" USING "btree" ("original_sprint_id");



CREATE INDEX "tasks_owner_idx" ON "public"."tasks" USING "btree" ("owner");



CREATE INDEX "tasks_package_id_idx" ON "public"."tasks" USING "btree" ("package_id");



CREATE INDEX "tasks_parent_task_id_idx" ON "public"."tasks" USING "btree" ("parent_task_id");



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



CREATE OR REPLACE TRIGGER "notification_events_guard_system_resolution" BEFORE UPDATE ON "public"."notification_events" FOR EACH ROW EXECUTE FUNCTION "public"."guard_notification_system_resolution"();



CREATE OR REPLACE TRIGGER "packages_guard_trash_mutation" BEFORE INSERT OR DELETE OR UPDATE ON "public"."packages" FOR EACH ROW EXECUTE FUNCTION "public"."guard_planning_trash_mutation"();



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



ALTER TABLE ONLY "public"."meeting_attendance"
    ADD CONSTRAINT "meeting_attendance_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."meeting_attendance"
    ADD CONSTRAINT "meeting_attendance_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."meetings"
    ADD CONSTRAINT "meetings_sprint_id_fkey" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."milestones"
    ADD CONSTRAINT "milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_deliveries"
    ADD CONSTRAINT "notification_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."notification_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_events"
    ADD CONSTRAINT "notification_events_actor_profile_id_fkey" FOREIGN KEY ("actor_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notification_events"
    ADD CONSTRAINT "notification_events_recipient_profile_id_fkey" FOREIGN KEY ("recipient_profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_accountable_profile_id_fkey" FOREIGN KEY ("accountable_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_proposed_by_fkey" FOREIGN KEY ("proposed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_trashed_by_fkey" FOREIGN KEY ("trashed_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



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



ALTER TABLE ONLY "public"."task_activity"
    ADD CONSTRAINT "task_activity_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



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
    ADD CONSTRAINT "tasks_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_original_sprint_id_fkey" FOREIGN KEY ("original_sprint_id") REFERENCES "public"."sprints"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_owner_fkey" FOREIGN KEY ("owner") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE SET NULL;



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



ALTER TABLE ONLY "public"."team_task_intake_batches"
    ADD CONSTRAINT "team_task_intake_batches_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."team_task_intake_batches"
    ADD CONSTRAINT "team_task_intake_batches_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "public"."team_task_intake_tokens"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."team_task_intake_batches"
    ADD CONSTRAINT "team_task_intake_batches_token_profile_fk" FOREIGN KEY ("token_id", "profile_id") REFERENCES "public"."team_task_intake_tokens"("id", "profile_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."team_task_intake_tokens"
    ADD CONSTRAINT "team_task_intake_tokens_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_log_insert_operational" ON "public"."audit_log" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



CREATE POLICY "audit_log_select_team" ON "public"."audit_log" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."availability" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "availability_select_team" ON "public"."availability" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "availability_write_operational" ON "public"."availability" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."decision_comments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "decision_comments_insert_team" ON "public"."decision_comments" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



CREATE POLICY "decision_comments_select_team" ON "public"."decision_comments" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."decision_confirmations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "decision_confirmations_insert_team" ON "public"."decision_confirmations" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



CREATE POLICY "decision_confirmations_select_team" ON "public"."decision_confirmations" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."decision_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "decision_log_select_team" ON "public"."decision_log" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "decision_log_write_ceo" ON "public"."decision_log" TO "authenticated" USING ((("public"."current_platform_role"() = 'ceo'::"text") AND ("status" <> 'locked'::"text"))) WITH CHECK (("public"."current_platform_role"() = 'ceo'::"text"));



ALTER TABLE "public"."decision_task_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "decision_task_links_select_team" ON "public"."decision_task_links" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "decision_task_links_write_team" ON "public"."decision_task_links" TO "authenticated" USING (("auth"."uid"() IS NOT NULL)) WITH CHECK (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."feedback_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feedback_items_insert_team" ON "public"."feedback_items" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



CREATE POLICY "feedback_items_select_team" ON "public"."feedback_items" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "feedback_items_update_operational" ON "public"."feedback_items" FOR UPDATE TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."fmd_tools" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fmd_tools_delete_operational" ON "public"."fmd_tools" FOR DELETE TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



CREATE POLICY "fmd_tools_insert_team" ON "public"."fmd_tools" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text", 'viewer'::"text"])));



CREATE POLICY "fmd_tools_select_team" ON "public"."fmd_tools" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "fmd_tools_update_team" ON "public"."fmd_tools" FOR UPDATE TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text", 'viewer'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text", 'viewer'::"text"])));



ALTER TABLE "public"."founder_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "founder_events_select_team" ON "public"."founder_events" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "founder_events_write_members" ON "public"."founder_events" TO "authenticated" USING (("public"."current_profile_role"() = ANY (ARRAY['admin'::"text", 'member'::"text"]))) WITH CHECK (("public"."current_profile_role"() = ANY (ARRAY['admin'::"text", 'member'::"text"])));



ALTER TABLE "public"."founder_sprint_scores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "founder_sprint_scores_select_team" ON "public"."founder_sprint_scores" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "founder_sprint_scores_write_operational" ON "public"."founder_sprint_scores" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."founder_strike_state" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "founder_strike_state_select_team" ON "public"."founder_strike_state" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "founder_strike_state_write_operational" ON "public"."founder_strike_state" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."github_app_user_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."github_issue_sync_locks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."meeting_attendance" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "meeting_attendance_select_team" ON "public"."meeting_attendance" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "meeting_attendance_write_team" ON "public"."meeting_attendance" TO "authenticated" USING ((("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])) OR ("profile_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"()))))) WITH CHECK ((("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])) OR ("profile_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"())))));



ALTER TABLE "public"."meetings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "meetings_select_team" ON "public"."meetings" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "meetings_write_operational" ON "public"."meetings" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



CREATE POLICY "meetings_write_team" ON "public"."meetings" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text", 'founder'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text", 'founder'::"text"])));



ALTER TABLE "public"."milestones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "milestones_select_team" ON "public"."milestones" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "milestones_write_operational" ON "public"."milestones" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



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



ALTER TABLE "public"."packages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "packages_select_team" ON "public"."packages" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."planning_github_lifecycle_outbox" ENABLE ROW LEVEL SECURITY;


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


CREATE POLICY "profiles_select_team" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "profiles_update_self_or_admin" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((("auth_user_id" = "auth"."uid"()) OR ("public"."current_profile_role"() = 'admin'::"text"))) WITH CHECK ((("auth_user_id" = "auth"."uid"()) OR ("public"."current_profile_role"() = 'admin'::"text")));



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "projects_select_team" ON "public"."projects" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "projects_write_admin" ON "public"."projects" TO "authenticated" USING (("public"."current_profile_role"() = 'admin'::"text")) WITH CHECK (("public"."current_profile_role"() = 'admin'::"text"));



ALTER TABLE "public"."score_objections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "score_objections_insert_founder" ON "public"."score_objections" FOR INSERT TO "authenticated" WITH CHECK ((("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])) AND ("profile_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"())))));



CREATE POLICY "score_objections_select_team" ON "public"."score_objections" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "score_objections_update_operational" ON "public"."score_objections" FOR UPDATE TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."sprint_commitments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sprint_commitments_select_team" ON "public"."sprint_commitments" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "sprint_commitments_write_team" ON "public"."sprint_commitments" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."sprints" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sprints_select_team" ON "public"."sprints" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "sprints_write_operational" ON "public"."sprints" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."strike_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "strike_events_insert_operational" ON "public"."strike_events" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



CREATE POLICY "strike_events_select_team" ON "public"."strike_events" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."task_activity" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_activity_insert_members" ON "public"."task_activity" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_profile_role"() = ANY (ARRAY['admin'::"text", 'member'::"text"])));



CREATE POLICY "task_activity_select_team" ON "public"."task_activity" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."task_blockers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_blockers_select_team" ON "public"."task_blockers" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "task_blockers_write_team" ON "public"."task_blockers" TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."task_comment_github_deliveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_comments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_comments_insert_team" ON "public"."task_comments" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



CREATE POLICY "task_comments_select_team" ON "public"."task_comments" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."task_deletion_operations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_dependencies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_dependencies_select_team" ON "public"."task_dependencies" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "task_dependencies_write_members" ON "public"."task_dependencies" TO "authenticated" USING (("public"."current_profile_role"() = ANY (ARRAY['admin'::"text", 'member'::"text"]))) WITH CHECK (("public"."current_profile_role"() = ANY (ARRAY['admin'::"text", 'member'::"text"])));



ALTER TABLE "public"."task_external_comments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_external_comments_insert_members" ON "public"."task_external_comments" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "task_external_comments_select_team" ON "public"."task_external_comments" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "task_external_comments_update_members" ON "public"."task_external_comments" FOR UPDATE TO "authenticated" USING (("auth"."uid"() IS NOT NULL)) WITH CHECK (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."task_focus_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_focus_items_select_team" ON "public"."task_focus_items" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "task_focus_items_write_team" ON "public"."task_focus_items" TO "authenticated" USING (("auth"."uid"() IS NOT NULL)) WITH CHECK (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."task_intake_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_links_select_team" ON "public"."task_links" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "task_links_write_members" ON "public"."task_links" TO "authenticated" USING (("public"."current_profile_role"() = ANY (ARRAY['admin'::"text", 'member'::"text"]))) WITH CHECK (("public"."current_profile_role"() = ANY (ARRAY['admin'::"text", 'member'::"text"])));



ALTER TABLE "public"."task_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_notes_select_team" ON "public"."task_notes" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "task_notes_write_members" ON "public"."task_notes" TO "authenticated" USING (("public"."current_profile_role"() = ANY (ARRAY['admin'::"text", 'member'::"text"]))) WITH CHECK (("public"."current_profile_role"() = ANY (ARRAY['admin'::"text", 'member'::"text"])));



ALTER TABLE "public"."task_relationship_edges" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_relationship_edges_delete_authorized" ON "public"."task_relationship_edges" FOR DELETE TO "authenticated" USING ((("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])) OR (("public"."current_platform_role"() = 'founder'::"text") AND ("relation_type" = 'blocked_by'::"text") AND (EXISTS ( SELECT 1
   FROM ("public"."tasks" "task"
     LEFT JOIN "public"."packages" "initiative" ON (("initiative"."id" = "task"."package_id")))
  WHERE (("task"."id" = "task_relationship_edges"."task_id") AND ("task"."task_type" = ANY (ARRAY['deliverable'::"text", 'sub_issue'::"text"])) AND (("task"."assignee" = "public"."current_profile_id"()) OR ("task"."owner" = "public"."current_profile_id"()) OR (COALESCE("initiative"."accountable_profile_id", "initiative"."owner_id") = "public"."current_profile_id"()))))))));



CREATE POLICY "task_relationship_edges_insert_authorized" ON "public"."task_relationship_edges" FOR INSERT TO "authenticated" WITH CHECK ((("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])) OR (("public"."current_platform_role"() = 'founder'::"text") AND ("relation_type" = 'blocked_by'::"text") AND ("created_by" = "public"."current_profile_id"()) AND (EXISTS ( SELECT 1
   FROM ("public"."tasks" "task"
     LEFT JOIN "public"."packages" "initiative" ON (("initiative"."id" = "task"."package_id")))
  WHERE (("task"."id" = "task_relationship_edges"."task_id") AND ("task"."task_type" = ANY (ARRAY['deliverable'::"text", 'sub_issue'::"text"])) AND (("task"."assignee" = "public"."current_profile_id"()) OR ("task"."owner" = "public"."current_profile_id"()) OR (COALESCE("initiative"."accountable_profile_id", "initiative"."owner_id") = "public"."current_profile_id"()))))))));



CREATE POLICY "task_relationship_edges_select_team" ON "public"."task_relationship_edges" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "task_relationship_edges_update_operational" ON "public"."task_relationship_edges" FOR UPDATE TO "authenticated" USING (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"]))) WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."task_reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_reviews_select_team" ON "public"."task_reviews" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "task_reviews_write_founders" ON "public"."task_reviews" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_platform_role"() = ANY (ARRAY['ceo'::"text", 'founder'::"text", 'deputy'::"text"])));



ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tasks_select_team" ON "public"."tasks" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."team_task_intake_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_task_intake_tokens" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."authenticate_team_task_intake_token"("p_token_hash" "text", "p_scope" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."authenticate_team_task_intake_token"("p_token_hash" "text", "p_scope" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."begin_github_issue_sync_transaction"("p_task_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."begin_github_issue_sync_transaction"("p_task_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_task_deletion_transaction"("p_operation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_task_deletion_transaction"("p_operation_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."planning_github_lifecycle_outbox" TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_planning_github_lifecycle_jobs"("p_lock_token" "uuid", "p_limit" integer, "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_planning_github_lifecycle_jobs"("p_lock_token" "uuid", "p_limit" integer, "p_lease_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_planning_github_lifecycle_jobs_for_root"("p_lock_token" "uuid", "p_root_type" "text", "p_root_id" "text", "p_task_ids" "text"[], "p_limit" integer, "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_planning_github_lifecycle_jobs_for_root"("p_lock_token" "uuid", "p_root_type" "text", "p_root_id" "text", "p_task_ids" "text"[], "p_limit" integer, "p_lease_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_planning_github_lifecycle_jobs_transaction"("p_lock_token" "uuid", "p_limit" integer, "p_lease_seconds" integer, "p_root_type" "text", "p_root_id" "text", "p_task_ids" "text"[]) FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."claim_task_comment_github_deliveries"("p_lock_token" "text", "p_task_id" "text", "p_author_profile_id" "text", "p_limit" integer, "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_task_comment_github_deliveries"("p_lock_token" "text", "p_task_id" "text", "p_author_profile_id" "text", "p_limit" integer, "p_lease_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_planning_task_transaction"("p_task_insert" "jsonb", "p_relation_type" "text", "p_related_task_id" "text", "p_relation_note" "text", "p_activity_message" "text", "p_relation_activity_message" "text", "p_notifications" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text", "p_approve_now" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_planning_task_transaction"("p_task_insert" "jsonb", "p_relation_type" "text", "p_related_task_id" "text", "p_relation_note" "text", "p_activity_message" "text", "p_relation_activity_message" "text", "p_notifications" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text", "p_approve_now" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_sprint_plan_transaction"("p_sprints" "jsonb", "p_meetings" "jsonb", "p_audit_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_sprint_plan_transaction"("p_sprints" "jsonb", "p_meetings" "jsonb", "p_audit_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_task_comment_with_github_delivery"("p_task_id" "text", "p_profile_id" "text", "p_comment" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_task_comment_with_github_delivery"("p_task_id" "text", "p_profile_id" "text", "p_comment" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_task_transaction"("p_task_insert" "jsonb", "p_relation_type" "text", "p_related_task_id" "text", "p_relation_note" "text", "p_activity_message" "text", "p_relation_activity_message" "text", "p_notifications" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_task_transaction"("p_task_insert" "jsonb", "p_relation_type" "text", "p_related_task_id" "text", "p_relation_note" "text", "p_activity_message" "text", "p_relation_activity_message" "text", "p_notifications" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_team_task_intake_token"("p_profile_id" "text", "p_label" "text", "p_token_hash" "text", "p_token_hint" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_team_task_intake_token"("p_profile_id" "text", "p_label" "text", "p_token_hash" "text", "p_token_hint" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_team_task_intake_v2_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_idempotency_key" "uuid", "p_request_hash" "text", "p_items" "jsonb", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_team_task_intake_v2_transaction"("p_token_id" "uuid", "p_profile_id" "text", "p_idempotency_key" "uuid", "p_request_hash" "text", "p_items" "jsonb", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_platform_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_platform_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_platform_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_profile_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_profile_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_profile_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_profile_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_profile_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_profile_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."decide_deliverable_approval_transaction"("p_task_id" "text", "p_expected_revision" integer, "p_action" "text", "p_actor_profile_id" "text", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decide_deliverable_approval_transaction"("p_task_id" "text", "p_expected_revision" integer, "p_action" "text", "p_actor_profile_id" "text", "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."decide_initiative_approval_transaction"("p_initiative_id" "text", "p_expected_revision" integer, "p_action" "text", "p_actor_profile_id" "text", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decide_initiative_approval_transaction"("p_initiative_id" "text", "p_expected_revision" integer, "p_action" "text", "p_actor_profile_id" "text", "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fail_github_issue_sync_transaction"("p_task_id" "text", "p_error_message" "text", "p_activity_message" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fail_github_issue_sync_transaction"("p_task_id" "text", "p_error_message" "text", "p_activity_message" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_github_issue_sync_transaction"("p_task_id" "text", "p_github_repo" "text", "p_github_issue_number" integer, "p_github_issue_url" "text", "p_synced_at" timestamp with time zone, "p_activity_message" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_github_issue_sync_transaction"("p_task_id" "text", "p_github_repo" "text", "p_github_issue_number" integer, "p_github_issue_url" "text", "p_synced_at" timestamp with time zone, "p_activity_message" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_planning_github_lifecycle_job"("p_job_id" "uuid", "p_lock_token" "uuid", "p_succeeded" boolean, "p_error_message" "text", "p_status_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_planning_github_lifecycle_job"("p_job_id" "uuid", "p_lock_token" "uuid", "p_succeeded" boolean, "p_error_message" "text", "p_status_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_task_comment_github_delivery"("p_task_comment_id" bigint, "p_lock_token" "text", "p_status" "text", "p_status_reason" "text", "p_github_issue_number" integer, "p_github_comment_id" bigint, "p_github_comment_url" "text", "p_last_error" "text", "p_next_attempt_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_task_comment_github_delivery"("p_task_comment_id" bigint, "p_lock_token" "text", "p_status" "text", "p_status_reason" "text", "p_github_issue_number" integer, "p_github_comment_id" bigint, "p_github_comment_url" "text", "p_last_error" "text", "p_next_attempt_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_task_deletion_transaction"("p_operation_id" "uuid", "p_github_closed" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_task_deletion_transaction"("p_operation_id" "uuid", "p_github_closed" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_notification_system_resolution"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_notification_system_resolution"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_planning_trash_mutation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_planning_trash_mutation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."lock_sprint_transaction"("p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_updates" "jsonb", "p_accepted_blocker_task_ids" "text"[], "p_carryover_inserts" "jsonb", "p_notifications" "jsonb", "p_score_rows" "jsonb", "p_strike_state_rows" "jsonb", "p_strike_events" "jsonb", "p_result_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lock_sprint_transaction"("p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_updates" "jsonb", "p_accepted_blocker_task_ids" "text"[], "p_carryover_inserts" "jsonb", "p_notifications" "jsonb", "p_score_rows" "jsonb", "p_strike_state_rows" "jsonb", "p_strike_events" "jsonb", "p_result_data" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."normalize_planning_github_issue_reference"("p_task_type" "text", "p_github_repo" "text", "p_github_issue_number" integer, "p_issue_number" "text", "p_github_issue_url" "text", "p_issue_url" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."normalize_planning_github_issue_reference"("p_task_type" "text", "p_github_repo" "text", "p_github_issue_number" integer, "p_issue_number" "text", "p_github_issue_url" "text", "p_issue_url" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."planning_trash_root_is_purge_eligible"("p_root_type" "text", "p_root_id" "text", "p_trash_revision" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."planning_trash_root_is_purge_eligible"("p_root_type" "text", "p_root_id" "text", "p_trash_revision" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepare_task_deletion_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_task_deletion_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."purge_expired_planning_trash_batch"("p_limit" integer, "p_dry_run" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_expired_planning_trash_batch"("p_limit" integer, "p_dry_run" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_github_issue_sync_lock"("p_resource_key" "text", "p_lock_token" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_github_issue_sync_lock"("p_resource_key" "text", "p_lock_token" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_score_objection_transaction"("p_sprint_id" "text", "p_objection_id" bigint, "p_actor_profile_id" "text", "p_action" "text", "p_status" "text", "p_resolution_comment" "text", "p_delivery_points" integer, "p_form_points" integer, "p_weekly_points" integer, "p_second_review_decision" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_score_objection_transaction"("p_sprint_id" "text", "p_objection_id" bigint, "p_actor_profile_id" "text", "p_action" "text", "p_status" "text", "p_resolution_comment" "text", "p_delivery_points" integer, "p_form_points" integer, "p_weekly_points" integer, "p_second_review_decision" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."restore_planning_item_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_trash_revision" integer, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restore_planning_item_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_trash_revision" integer, "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."review_task_transaction"("p_task_id" "text", "p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_reviewer_profile_id" "text", "p_decision" "text", "p_points" integer, "p_comment" "text", "p_checklist" "jsonb", "p_activity_message" "text", "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_task_transaction"("p_task_id" "text", "p_sprint_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_reviewer_profile_id" "text", "p_decision" "text", "p_points" integer, "p_comment" "text", "p_checklist" "jsonb", "p_activity_message" "text", "p_notifications" "jsonb", "p_audit_after_data" "jsonb", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."revoke_team_task_intake_token"("p_token_id" "uuid", "p_profile_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_team_task_intake_token"("p_token_id" "uuid", "p_profile_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."trash_planning_item_tree_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_revision" integer, "p_actor_profile_id" "text", "p_reason" "text", "p_cause" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."try_acquire_github_issue_sync_lock"("p_resource_key" "text", "p_task_id" "text", "p_locked_by_profile_id" "text", "p_ttl_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."try_acquire_github_issue_sync_lock"("p_resource_key" "text", "p_task_id" "text", "p_locked_by_profile_id" "text", "p_ttl_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_backlog_order_transaction"("p_updates" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_backlog_order_transaction"("p_updates" "jsonb", "p_actor_profile_id" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_planning_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_actor_profile_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_planning_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb", "p_actor_profile_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_profile_admin_transaction"("p_profile_id" "text", "p_actor_profile_id" "text", "p_profile_patch" "jsonb", "p_notification_events" "jsonb", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_profile_admin_transaction"("p_profile_id" "text", "p_actor_profile_id" "text", "p_profile_patch" "jsonb", "p_notification_events" "jsonb", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_profile_settings_transaction"("p_profile_id" "text", "p_profile_patch" "jsonb", "p_ui_preferences" "jsonb", "p_notification_events" "jsonb", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_profile_settings_transaction"("p_profile_id" "text", "p_profile_patch" "jsonb", "p_ui_preferences" "jsonb", "p_notification_events" "jsonb", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_task_transaction"("p_task_id" "text", "p_expected_updated_at" timestamp with time zone, "p_task_patch" "jsonb", "p_note_present" boolean, "p_note" "text", "p_dependency_present" boolean, "p_dependency_note" "text", "p_activity_messages" "text"[], "p_notifications" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_profile_notification_preferences"("p_profile_id" "text", "p_notification_events" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."withdraw_planning_item_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_revision" integer, "p_actor_profile_id" "text", "p_reason" "text", "p_request_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."withdraw_planning_item_transaction"("p_root_type" "text", "p_root_id" "text", "p_expected_revision" integer, "p_actor_profile_id" "text", "p_reason" "text", "p_request_ip" "text", "p_user_agent" "text") TO "service_role";


















GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."packages" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."packages" TO "authenticated";
GRANT ALL ON TABLE "public"."packages" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."active_packages" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."active_packages" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."tasks" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."active_tasks" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."active_tasks" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."audit_log_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."audit_log_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."availability" TO "anon";
GRANT ALL ON TABLE "public"."availability" TO "authenticated";
GRANT ALL ON TABLE "public"."availability" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."availability_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."availability_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."decision_comments" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."decision_comments" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."decision_comments" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."decision_comments_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."decision_comments_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."decision_confirmations" TO "anon";
GRANT ALL ON TABLE "public"."decision_confirmations" TO "authenticated";
GRANT ALL ON TABLE "public"."decision_confirmations" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."decision_confirmations_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."decision_confirmations_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."decision_log" TO "anon";
GRANT ALL ON TABLE "public"."decision_log" TO "authenticated";
GRANT ALL ON TABLE "public"."decision_log" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."decision_log_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."decision_log_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."decision_task_links" TO "anon";
GRANT ALL ON TABLE "public"."decision_task_links" TO "authenticated";
GRANT ALL ON TABLE "public"."decision_task_links" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."decision_task_links_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."decision_task_links_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."feedback_items" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."feedback_items" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."feedback_items" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."feedback_items_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."feedback_items_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."fmd_tools" TO "anon";
GRANT ALL ON TABLE "public"."fmd_tools" TO "authenticated";
GRANT ALL ON TABLE "public"."fmd_tools" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."founder_events" TO "anon";
GRANT ALL ON TABLE "public"."founder_events" TO "authenticated";
GRANT ALL ON TABLE "public"."founder_events" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."founder_events_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."founder_events_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."founder_sprint_scores" TO "anon";
GRANT ALL ON TABLE "public"."founder_sprint_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."founder_sprint_scores" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."founder_sprint_scores_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."founder_sprint_scores_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."founder_strike_state" TO "anon";
GRANT ALL ON TABLE "public"."founder_strike_state" TO "authenticated";
GRANT ALL ON TABLE "public"."founder_strike_state" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."founder_strike_state_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."founder_strike_state_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."github_app_user_tokens" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."github_app_user_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."github_app_user_tokens" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."github_issue_sync_locks" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."github_issue_sync_locks" TO "authenticated";
GRANT ALL ON TABLE "public"."github_issue_sync_locks" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."meeting_attendance" TO "anon";
GRANT ALL ON TABLE "public"."meeting_attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."meeting_attendance" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."meeting_attendance_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."meeting_attendance_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."meetings" TO "anon";
GRANT ALL ON TABLE "public"."meetings" TO "authenticated";
GRANT ALL ON TABLE "public"."meetings" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."meetings_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."meetings_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."milestones" TO "anon";
GRANT ALL ON TABLE "public"."milestones" TO "authenticated";
GRANT ALL ON TABLE "public"."milestones" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."notification_deliveries" TO "anon";
GRANT ALL ON TABLE "public"."notification_deliveries" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_deliveries" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."notification_deliveries_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."notification_deliveries_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."notification_events" TO "anon";
GRANT ALL ON TABLE "public"."notification_events" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_events" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."notification_events_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."notification_events_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."notification_preferences" TO "anon";
GRANT ALL ON TABLE "public"."notification_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_preferences" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."notification_preferences_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."notification_preferences_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profile_feature_tour_acknowledgements" TO "anon";
GRANT ALL ON TABLE "public"."profile_feature_tour_acknowledgements" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_feature_tour_acknowledgements" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profile_ui_preferences" TO "anon";
GRANT ALL ON TABLE "public"."profile_ui_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_ui_preferences" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."score_objections" TO "anon";
GRANT ALL ON TABLE "public"."score_objections" TO "authenticated";
GRANT ALL ON TABLE "public"."score_objections" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."score_objections_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."score_objections_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sprint_commitments" TO "anon";
GRANT ALL ON TABLE "public"."sprint_commitments" TO "authenticated";
GRANT ALL ON TABLE "public"."sprint_commitments" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."sprint_commitments_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."sprint_commitments_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sprints" TO "anon";
GRANT ALL ON TABLE "public"."sprints" TO "authenticated";
GRANT ALL ON TABLE "public"."sprints" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."strike_events" TO "anon";
GRANT ALL ON TABLE "public"."strike_events" TO "authenticated";
GRANT ALL ON TABLE "public"."strike_events" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."strike_events_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."strike_events_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."task_activity" TO "anon";
GRANT ALL ON TABLE "public"."task_activity" TO "authenticated";
GRANT ALL ON TABLE "public"."task_activity" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."task_activity_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."task_activity_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."task_blockers" TO "anon";
GRANT ALL ON TABLE "public"."task_blockers" TO "authenticated";
GRANT ALL ON TABLE "public"."task_blockers" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."task_blockers_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."task_blockers_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."task_comment_github_deliveries" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."task_comments" TO "anon";
GRANT ALL ON TABLE "public"."task_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."task_comments" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."task_comments_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."task_comments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."task_deletion_operations" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."task_dependencies" TO "anon";
GRANT ALL ON TABLE "public"."task_dependencies" TO "authenticated";
GRANT ALL ON TABLE "public"."task_dependencies" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."task_dependencies_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."task_dependencies_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."task_external_comments" TO "anon";
GRANT ALL ON TABLE "public"."task_external_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."task_external_comments" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."task_external_comments_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."task_external_comments_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."task_focus_items" TO "anon";
GRANT ALL ON TABLE "public"."task_focus_items" TO "authenticated";
GRANT ALL ON TABLE "public"."task_focus_items" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."task_focus_items_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."task_focus_items_id_seq" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."task_intake_tokens" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."task_intake_tokens_id_seq" TO "service_role";
GRANT SELECT,USAGE ON SEQUENCE "public"."task_intake_tokens_id_seq" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."task_links" TO "anon";
GRANT ALL ON TABLE "public"."task_links" TO "authenticated";
GRANT ALL ON TABLE "public"."task_links" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."task_links_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."task_links_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."task_notes" TO "anon";
GRANT ALL ON TABLE "public"."task_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."task_notes" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."task_relationship_edges" TO "anon";
GRANT ALL ON TABLE "public"."task_relationship_edges" TO "authenticated";
GRANT ALL ON TABLE "public"."task_relationship_edges" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."task_relationship_edges_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."task_relationship_edges_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."task_reviews" TO "anon";
GRANT ALL ON TABLE "public"."task_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."task_reviews" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."task_reviews_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "public"."task_reviews_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."team_task_intake_batches" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."team_task_intake_tokens" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";































