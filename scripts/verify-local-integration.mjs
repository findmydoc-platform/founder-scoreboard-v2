import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const root = resolve(import.meta.dirname, "..");
const supabaseCli = resolve(root, "node_modules/.bin/supabase");
const nextCli = resolve(root, "node_modules/.bin/next");
const localDevelopmentScript = resolve(root, "scripts/local-development.mjs");
const seedSourcePath = resolve(root, "src/lib/seed/source.json");
const appOrigin = "http://127.0.0.1:3012";

function parseEnvFile(content) {
  return Object.fromEntries(content.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    return match ? [[match[1], match[2]]] : [];
  }));
}

function localStatus() {
  const status = JSON.parse(execFileSync(supabaseCli, ["status", "-o", "json"], { cwd: root, encoding: "utf8" }));
  const api = new URL(status.API_URL);
  const database = new URL(status.DB_URL);
  if (api.hostname !== "127.0.0.1" || api.port !== "54321" || database.hostname !== "127.0.0.1" || database.port !== "54322") {
    throw new Error("Local integration tests refuse non-loopback Supabase targets.");
  }
  return status;
}

async function waitForServer(child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Next.js local integration server stopped before becoming ready.");
    try {
      const response = await fetch(`${appOrigin}/api/planning-board-data`);
      if (response.status === 401) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error("Next.js local integration server did not become ready within 60 seconds.");
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) throw new Error(`${label}: expected ${expected}, received ${response.status}.`);
}

function nextBerlinMondayIso(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const current = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`);
  const weekday = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + (weekday === 1 ? 7 : 8 - weekday));
  return current.toISOString().slice(0, 10);
}

async function apiRequest(path, token, profileId, init = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (profileId) headers.set("x-fmd-dev-profile-id", profileId);
  return fetch(`${appOrigin}${path}`, { ...init, headers });
}

async function verifySeedConvergence(status, source) {
  const client = new pg.Client({ connectionString: status.DB_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(
      "insert into profiles (id,name,role,platform_role) values ($1,$2,'member','founder')",
      ["local-stale-profile", "Local Stale Profile"],
    );
    await client.query(
      "insert into fmd_tools (id,name,category,kind) values ($1,$2,'tool','internal')",
      ["local-stale-tool", "Local Stale Tool"],
    );
    await client.query(
      "insert into sprints (id,project_id,name,status) values ($1,$2,$3,'planning')",
      ["local-stale-sprint", source.project.id, "Local Stale Sprint"],
    );
    await client.query(
      "insert into tasks (id,project_id,title,status,task_type,score_relevant,approval_status) values ($1,$2,$3,'Offen','epic',false,null)",
      ["local-stale-epic", source.project.id, "Local Stale Epic"],
    );
    await client.query(
      "insert into tasks (id,project_id,parent_task_id,title,status,priority,task_type,score_relevant,approval_status) values ($1,$2,$3,$4,'Offen','P2','initiative',false,'proposed')",
      ["local-stale-initiative", source.project.id, "local-stale-epic", "Local Stale Initiative"],
    );
    await client.query(
      "insert into tasks (id,project_id,parent_task_id,title,status,priority,sprint_id,task_type,score_relevant,approval_status) values ($1,$2,$3,$4,'Offen','P3',$5,'deliverable',false,'proposed')",
      ["local-stale-task", source.project.id, "local-stale-initiative", "Local Stale Task", "local-stale-sprint"],
    );
    await client.query(
      "insert into meetings (sprint_id,title,meeting_at) values ($1,$2,now())",
      ["local-stale-sprint", "Local Stale Meeting"],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }

  execFileSync(process.execPath, [localDevelopmentScript, "seed"], { cwd: root, stdio: "inherit" });

  const verifier = new pg.Client({ connectionString: status.DB_URL });
  await verifier.connect();
  try {
    const result = await verifier.query(
      `select
        (select count(*)::integer from profiles) as profiles,
        (select count(*)::integer from fmd_tools) as tools,
        (select count(*)::integer from tasks where project_id=$1) as tasks,
        (select count(*)::integer from tasks where project_id=$1 and task_type='epic') as epics,
        (select count(*)::integer from tasks where project_id=$1 and task_type='initiative') as initiatives,
        (select count(*)::integer from tasks where project_id=$1 and task_type='deliverable') as deliverables,
        (select count(*)::integer from tasks where project_id=$1 and task_type='sub_issue') as sub_issues,
        (select count(*)::integer from sprints where project_id=$1) as sprints,
        (select count(*)::integer from meetings where sprint_id in (select id from sprints where project_id=$1)) as meetings,
        (select github_project_owner from projects where id=$1) as github_project_owner,
        (select github_project_number from projects where id=$1) as github_project_number`,
      [source.project.id],
    );
    const row = result.rows[0];
    const expected = {
      profiles: source.profiles.length,
      tools: source.fmdTools.length,
      tasks: source.epics.length + source.initiatives.length + source.tasks.length,
      epics: source.epics.length,
      initiatives: source.initiatives.length,
      deliverables: source.tasks.filter((task) => (task.taskType || "deliverable") === "deliverable").length,
      sub_issues: source.tasks.filter((task) => task.taskType === "sub_issue").length,
      sprints: source.sprints.length,
      meetings: source.meetings.length,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (row[key] !== value) throw new Error(`Local seed did not converge ${key}: expected ${value}, received ${row[key]}.`);
    }
    if (row.github_project_owner !== source.project.githubProjectOwner) {
      throw new Error("Local seed did not persist the GitHub Project owner.");
    }
    if (row.github_project_number !== source.project.githubProjectNumber) {
      throw new Error("Local seed did not persist the GitHub Project number.");
    }
  } finally {
    await verifier.end();
  }
}

async function verifyCanonicalPlanningPreferences(status) {
  const client = new pg.Client({ connectionString: status.DB_URL });
  await client.connect();
  try {
    await client.query("begin");
    const canonical = {
      default_workspace: "planning",
      default_task_view: "board",
      planning_filters: { assignee: "volkan", initiativeId: "GC1" },
      expanded_item_ids: ["GC1"],
    };
    const result = await client.query(
      "select public.update_profile_settings_transaction($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6) as result",
      ["volkan", {}, canonical, {}, null, null],
    );
    const stored = await client.query(
      "select planning_filters,expanded_item_ids from public.profile_ui_preferences where profile_id=$1",
      ["volkan"],
    );
    const preference = stored.rows[0];
    if (JSON.stringify(result.rows[0]?.result?.ui_preference?.expanded_item_ids) !== JSON.stringify(["GC1"])) {
      throw new Error("Profile settings RPC did not return canonical expanded Planning item IDs.");
    }
    if (JSON.stringify(preference?.planning_filters) !== JSON.stringify(canonical.planning_filters)
      || JSON.stringify(preference?.expanded_item_ids) !== JSON.stringify(["GC1"])) {
      throw new Error("Profile settings RPC did not persist canonical Planning preferences.");
    }
    await client.query("rollback");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

async function insertGitHubWebhookDelivery(client, {
  deliveryId,
  eventName,
  action = "created",
  repositoryFullName = "findmydoc-platform/management",
  issueNumber = 17,
  commentId = null,
  commentNodeId = null,
  commentUpdatedAt = null,
  receivedAt = null,
}) {
  await client.query(
    `insert into public.github_webhook_deliveries (
      delivery_id,
      event_name,
      action,
      installation_id,
      repository_id,
      repository_full_name,
      issue_id,
      issue_node_id,
      issue_number,
      issue_updated_at,
      comment_id,
      comment_node_id,
      comment_updated_at,
      payload_sha256,
      received_at
    ) values ($1,$2,$3,42,101,$4,202,'I_kwDOExample',$5,$6,$7,$8,$9,$10,coalesce($11::timestamptz,clock_timestamp()))`,
    [
      deliveryId,
      eventName,
      action,
      repositoryFullName,
      issueNumber,
      "2026-08-14T12:30:00Z",
      commentId,
      commentNodeId,
      commentUpdatedAt,
      "a".repeat(64),
      receivedAt,
    ],
  );
}

async function insertGitHubPlanningWebhookDelivery(client, {
  deliveryId,
  issueNumber = 17,
  status = "received",
  statusReason = null,
  attempts = 0,
  availableAt = null,
  lastError = null,
  archivedAt = null,
  archiveReason = null,
}) {
  await client.query(
    `insert into public.github_planning_webhook_deliveries (
      delivery_id,
      event_name,
      action,
      installation_id,
      repository_id,
      repository_full_name,
      issue_id,
      issue_node_id,
      issue_number,
      issue_updated_at,
      payload_sha256,
      status,
      status_reason,
      attempts,
      available_at,
      last_error,
      archived_at,
      archive_reason
    ) values (
      $1,'issues','edited',42,101,'findmydoc-platform/management',202,'I_kwDOExample',$2,
      '2026-08-14T12:30:00Z',$3,$4,$5,$6,coalesce($7::timestamptz,clock_timestamp()),$8,$9::timestamptz,$10
    )`,
    [
      deliveryId,
      issueNumber,
      "b".repeat(64),
      status,
      statusReason,
      attempts,
      availableAt,
      lastError,
      archivedAt,
      archiveReason,
    ],
  );
}

async function applyGitHubCommentProjection(client, {
  deliveryId,
  lockToken,
  operation,
  taskId,
  commentUpdatedAt,
  authorLogin = null,
  authorAvatarUrl = null,
  body = null,
  htmlUrl = null,
  createdAt = null,
  importedAt = null,
}) {
  const result = await client.query(
    `select public.apply_github_issue_comment_webhook_projection(
      $1,$2::uuid,$3,$4,$5::timestamptz,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz
    ) as result`,
    [
      deliveryId,
      lockToken,
      operation,
      taskId,
      commentUpdatedAt,
      authorLogin,
      authorAvatarUrl,
      body,
      htmlUrl,
      createdAt,
      importedAt,
    ],
  );
  return result.rows[0]?.result;
}

async function expectGitHubWebhookDeliveryConstraintViolation(client, label, insert) {
  await client.query("savepoint github_webhook_delivery_constraint");
  let rejected = false;
  try {
    await insert();
  } catch (error) {
    if (error?.code !== "23514") throw error;
    rejected = true;
  } finally {
    await client.query("rollback to savepoint github_webhook_delivery_constraint");
  }
  if (!rejected) throw new Error(`${label} unexpectedly bypassed the webhook delivery constraint.`);
}

async function verifyGitHubWebhookDeliveryJournal(status, source) {
  const client = new pg.Client({ connectionString: status.DB_URL });
  await client.connect();
  try {
    await client.query("begin");

    const columns = await client.query(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'github_webhook_deliveries'
         and column_name like 'comment\\_%' escape '\\'
       order by column_name`,
    );
    const commentColumns = columns.rows.map((row) => row.column_name);
    const expectedCommentColumns = ["comment_id", "comment_node_id", "comment_updated_at"];
    if (JSON.stringify(commentColumns) !== JSON.stringify(expectedCommentColumns)) {
      throw new Error(`GitHub webhook delivery comment columns changed: ${commentColumns.join(", ")}.`);
    }

    const functionComment = await client.query(
      `select obj_description(
        'public.claim_github_issue_comment_webhook_delivery(text,uuid,integer)'::regprocedure,
        'pg_proc'
      ) as description`,
    );
    const expectedFunctionComment = "Claims one verified Issue comment delivery for idempotent projection. Exact redelivery can recover retryable, failed, or stale processing rows unless an operator archived the delivery; archived failures remain retained and are never reclaimed.";
    if (functionComment.rows[0]?.description !== expectedFunctionComment) {
      throw new Error("GitHub Issue comment claim function documentation is stale.");
    }

    await insertGitHubPlanningWebhookDelivery(client, {
      deliveryId: "verify-planning-archived",
      status: "retry_scheduled",
      statusReason: "processing_error",
      attempts: 4,
      availableAt: "2026-08-14T12:30:00Z",
      lastError: "Planning retry retained for archive verification.",
      archivedAt: "2026-08-14T12:35:00Z",
      archiveReason: "local_integration_archive",
    });
    const archivedPlanningClaim = await client.query(
      `select *
       from public.claim_github_planning_webhook_delivery($1,$2::uuid,$3)`,
      ["verify-planning-archived", randomUUID(), 120],
    );
    if (archivedPlanningClaim.rows.length !== 0) {
      throw new Error("An archived GitHub planning delivery was claimed again.");
    }
    const archivedPlanningState = await client.query(
      `select status,status_reason,attempts,locked_at,lock_token,last_error,archived_at,archive_reason
       from public.github_planning_webhook_deliveries
       where delivery_id = 'verify-planning-archived'`,
    );
    if (archivedPlanningState.rows[0]?.status !== "retry_scheduled"
      || archivedPlanningState.rows[0]?.status_reason !== "processing_error"
      || Number(archivedPlanningState.rows[0]?.attempts) !== 4
      || archivedPlanningState.rows[0]?.locked_at !== null
      || archivedPlanningState.rows[0]?.lock_token !== null
      || archivedPlanningState.rows[0]?.last_error !== "Planning retry retained for archive verification."
      || !archivedPlanningState.rows[0]?.archived_at
      || archivedPlanningState.rows[0]?.archive_reason !== "local_integration_archive") {
      throw new Error("Archived GitHub planning delivery state changed during claim.");
    }

    await insertGitHubWebhookDelivery(client, {
      deliveryId: "verify-comment-archived",
      eventName: "issue_comment",
      commentId: 405,
      commentNodeId: "IC_kwDOArchived",
      commentUpdatedAt: "2026-08-14T12:31:00Z",
    });
    await client.query(
      `update public.github_webhook_deliveries
       set status='failed',
           status_reason='processing_error',
           attempts=5,
           last_error='Comment failure retained for archive verification.',
           archived_at='2026-08-14T12:35:00Z',
           archive_reason='local_integration_archive'
       where delivery_id='verify-comment-archived'`,
    );
    const archivedCommentClaim = await client.query(
      `select *
       from public.claim_github_issue_comment_webhook_delivery($1,$2::uuid,$3)`,
      ["verify-comment-archived", randomUUID(), 120],
    );
    if (archivedCommentClaim.rows.length !== 0) {
      throw new Error("An archived GitHub Issue comment delivery was claimed again.");
    }
    const archivedCommentState = await client.query(
      `select status,status_reason,attempts,locked_at,lock_token,last_error,archived_at,archive_reason
       from public.github_webhook_deliveries
       where delivery_id = 'verify-comment-archived'`,
    );
    if (archivedCommentState.rows[0]?.status !== "failed"
      || archivedCommentState.rows[0]?.status_reason !== "processing_error"
      || Number(archivedCommentState.rows[0]?.attempts) !== 5
      || archivedCommentState.rows[0]?.locked_at !== null
      || archivedCommentState.rows[0]?.lock_token !== null
      || archivedCommentState.rows[0]?.last_error !== "Comment failure retained for archive verification."
      || !archivedCommentState.rows[0]?.archived_at
      || archivedCommentState.rows[0]?.archive_reason !== "local_integration_archive") {
      throw new Error("Archived GitHub Issue comment delivery state changed during claim.");
    }

    await insertGitHubWebhookDelivery(client, {
      deliveryId: "verify-comment-valid",
      eventName: "issue_comment",
      commentId: 404,
      commentNodeId: "IC_kwDOExample",
      commentUpdatedAt: "2026-08-14T12:31:00Z",
    });
    const stored = await client.query(
      `select
        comment_id = 404 as id_matches,
        comment_node_id = 'IC_kwDOExample' as node_id_matches,
        comment_updated_at = '2026-08-14T12:31:00Z'::timestamptz as timestamp_matches
       from public.github_webhook_deliveries
       where delivery_id = 'verify-comment-valid'`,
    );
    if (!stored.rows[0]?.id_matches || !stored.rows[0]?.node_id_matches || !stored.rows[0]?.timestamp_matches) {
      throw new Error("Valid GitHub Issue comment delivery metadata did not persist exactly.");
    }

    const privilege = await client.query(
      `select
        has_function_privilege(
          'service_role',
          'public.claim_github_issue_comment_webhook_delivery(text,uuid,integer)',
          'EXECUTE'
        ) as service_can_claim,
        has_function_privilege(
          'authenticated',
          'public.claim_github_issue_comment_webhook_delivery(text,uuid,integer)',
          'EXECUTE'
        ) as authenticated_can_claim,
        has_function_privilege(
          'service_role',
          'public.resolve_github_issue_comment_webhook_tasks(text,integer)',
          'EXECUTE'
        ) as service_can_resolve,
        has_function_privilege(
          'authenticated',
          'public.resolve_github_issue_comment_webhook_tasks(text,integer)',
          'EXECUTE'
        ) as authenticated_can_resolve,
        has_function_privilege(
          'service_role',
          'public.apply_github_issue_comment_webhook_projection(text,uuid,text,text,timestamptz,text,text,text,text,timestamptz,timestamptz)',
          'EXECUTE'
        ) as service_can_apply,
        has_function_privilege(
          'authenticated',
          'public.apply_github_issue_comment_webhook_projection(text,uuid,text,text,timestamptz,text,text,text,text,timestamptz,timestamptz)',
          'EXECUTE'
        ) as authenticated_can_apply,
        has_table_privilege(
          'service_role',
          'public.github_webhook_deliveries',
          'UPDATE'
        ) as service_can_update_directly`,
    );
    if (!privilege.rows[0]?.service_can_claim
      || privilege.rows[0]?.authenticated_can_claim
      || !privilege.rows[0]?.service_can_resolve
      || privilege.rows[0]?.authenticated_can_resolve
      || !privilege.rows[0]?.service_can_apply
      || privilege.rows[0]?.authenticated_can_apply
      || privilege.rows[0]?.service_can_update_directly) {
      throw new Error("GitHub Issue comment webhook RPC authorization boundary changed.");
    }

    const lockToken = randomUUID();
    const claim = await client.query(
      `select *
       from public.claim_github_issue_comment_webhook_delivery($1,$2::uuid,$3)`,
      ["verify-comment-valid", lockToken, 120],
    );
    if (claim.rows.length !== 1
      || claim.rows[0]?.delivery_id !== "verify-comment-valid"
      || claim.rows[0]?.action !== "created"
      || Number(claim.rows[0]?.comment_id) !== 404
      || new Date(claim.rows[0]?.comment_updated_at).toISOString() !== "2026-08-14T12:31:00.000Z"
      || Number(claim.rows[0]?.attempts) !== 1) {
      throw new Error("GitHub Issue comment delivery claim did not return the locked identity.");
    }

    const wrongFinalize = await client.query(
      `select public.finalize_github_issue_comment_webhook_delivery(
        $1,$2::uuid,'processed','comment_upserted',null,null
      ) as finalized`,
      ["verify-comment-valid", randomUUID()],
    );
    if (wrongFinalize.rows[0]?.finalized !== false) {
      throw new Error("GitHub Issue comment delivery accepted a foreign lock token.");
    }

    const finalize = await client.query(
      `select public.finalize_github_issue_comment_webhook_delivery(
        $1,$2::uuid,'processed','comment_upserted',null,null
      ) as finalized`,
      ["verify-comment-valid", lockToken],
    );
    if (finalize.rows[0]?.finalized !== true) {
      throw new Error("GitHub Issue comment delivery could not be finalized by its lock owner.");
    }
    const finalState = await client.query(
      `select status,status_reason,attempts,locked_at,lock_token,processed_at
       from public.github_webhook_deliveries
       where delivery_id = 'verify-comment-valid'`,
    );
    if (finalState.rows[0]?.status !== "processed"
      || finalState.rows[0]?.status_reason !== "comment_upserted"
      || Number(finalState.rows[0]?.attempts) !== 1
      || finalState.rows[0]?.locked_at !== null
      || finalState.rows[0]?.lock_token !== null
      || !finalState.rows[0]?.processed_at) {
      throw new Error("GitHub Issue comment delivery final state is inconsistent.");
    }
    const replayClaim = await client.query(
      `select *
       from public.claim_github_issue_comment_webhook_delivery($1,$2::uuid,$3)`,
      ["verify-comment-valid", randomUUID(), 120],
    );
    if (replayClaim.rows.length !== 0) {
      throw new Error("A processed GitHub Issue comment delivery was claimed again.");
    }

    const mappingTaskId = "verify-github-comment-mapping";
    const ambiguousTaskId = "verify-github-comment-ambiguous";
    const mappingIssueNumber = 2147483001;
    const mappingRepository = "findmydoc-platform/management";
    const mappingIssueUrl = `https://github.com/${mappingRepository}/issues/${mappingIssueNumber}`;
    const parentInitiativeId = source.initiatives[0]?.id;
    if (!parentInitiativeId) throw new Error("Local seed has no Initiative for GitHub comment mapping verification.");

    await client.query(
      `insert into public.tasks (
        id,project_id,parent_task_id,title,status,priority,task_type,score_relevant,
        approval_status,github_repo,issue_number
      ) values ($1,$2,$3,$4,'Offen','P3','deliverable',false,'proposed',$5,$6)`,
      [
        mappingTaskId,
        source.project.id,
        parentInitiativeId,
        "GitHub comment webhook mapping verifier",
        mappingRepository,
        String(mappingIssueNumber),
      ],
    );

    let mapping = await client.query(
      "select * from public.resolve_github_issue_comment_webhook_tasks($1,$2)",
      [mappingRepository, mappingIssueNumber],
    );
    if (mapping.rows.length !== 1 || mapping.rows[0]?.task_id !== mappingTaskId) {
      throw new Error("Legacy issue_number mapping did not resolve through the shared compatibility contract.");
    }

    await client.query(
      `update public.tasks
       set github_repo=null,issue_number=null,issue_url=$2
       where id=$1`,
      [mappingTaskId, mappingIssueUrl],
    );
    mapping = await client.query(
      "select * from public.resolve_github_issue_comment_webhook_tasks($1,$2)",
      [mappingRepository, mappingIssueNumber],
    );
    if (mapping.rows.length !== 1 || mapping.rows[0]?.task_id !== mappingTaskId) {
      throw new Error("Legacy issue_url mapping did not resolve through the shared compatibility contract.");
    }

    await client.query(
      `update public.tasks
       set github_repo=$2,github_issue_number=$3,github_issue_url=$4,issue_number=null,issue_url=null
       where id=$1`,
      [mappingTaskId, mappingRepository, mappingIssueNumber, mappingIssueUrl],
    );
    mapping = await client.query(
      "select * from public.resolve_github_issue_comment_webhook_tasks($1,$2)",
      [mappingRepository, mappingIssueNumber],
    );
    if (mapping.rows.length !== 1 || mapping.rows[0]?.task_id !== mappingTaskId) {
      throw new Error("Modern GitHub Issue mapping did not resolve through the shared compatibility contract.");
    }

    await client.query(
      "update public.tasks set issue_number=$2 where id=$1",
      [mappingTaskId, String(mappingIssueNumber + 1)],
    );
    mapping = await client.query(
      "select * from public.resolve_github_issue_comment_webhook_tasks($1,$2)",
      [mappingRepository, mappingIssueNumber],
    );
    if (mapping.rows.length !== 0) {
      throw new Error("Conflicting GitHub Issue references unexpectedly resolved to a webhook task.");
    }
    await client.query(
      "update public.tasks set issue_number=null where id=$1",
      [mappingTaskId],
    );

    await client.query(
      `insert into public.tasks (
        id,project_id,parent_task_id,title,status,priority,task_type,score_relevant,
        approval_status,github_repo,github_issue_number,github_issue_url
      ) values ($1,$2,$3,$4,'Offen','P3','deliverable',false,'proposed',$5,$6,$7)`,
      [
        ambiguousTaskId,
        source.project.id,
        parentInitiativeId,
        "Ambiguous GitHub comment webhook mapping verifier",
        mappingRepository,
        mappingIssueNumber,
        mappingIssueUrl,
      ],
    );
    mapping = await client.query(
      "select * from public.resolve_github_issue_comment_webhook_tasks($1,$2)",
      [mappingRepository, mappingIssueNumber],
    );
    if (mapping.rows.length !== 2) {
      throw new Error("Ambiguous GitHub Issue mapping did not fail closed with two candidates.");
    }
    await client.query(
      "update public.tasks set github_issue_number=$2,github_issue_url=$3 where id=$1",
      [
        ambiguousTaskId,
        mappingIssueNumber - 1,
        `https://github.com/${mappingRepository}/issues/${mappingIssueNumber - 1}`,
      ],
    );

    const deletedCommentId = 9100000001;
    const deletedVersion = "2026-08-14T12:40:00Z";
    await client.query(
      `insert into public.task_external_comments (
        task_id,source,external_id,author_login,body,html_url,created_at,imported_at
      ) values ($1,'github',$2,'old-author','Old snapshot',$3,$4,$4)`,
      [
        mappingTaskId,
        String(deletedCommentId),
        `${mappingIssueUrl}#issuecomment-${deletedCommentId}`,
        "2026-08-14T12:30:00Z",
      ],
    );
    await insertGitHubWebhookDelivery(client, {
      deliveryId: "verify-comment-old-before-delete",
      eventName: "issue_comment",
      action: "edited",
      issueNumber: mappingIssueNumber,
      commentId: deletedCommentId,
      commentNodeId: "IC_verifyOldBeforeDelete",
      commentUpdatedAt: deletedVersion,
      receivedAt: "2026-08-14T12:40:01Z",
    });
    await insertGitHubWebhookDelivery(client, {
      deliveryId: "verify-comment-delete",
      eventName: "issue_comment",
      action: "deleted",
      issueNumber: mappingIssueNumber,
      commentId: deletedCommentId,
      commentNodeId: "IC_verifyDelete",
      commentUpdatedAt: deletedVersion,
      receivedAt: "2026-08-14T12:40:02Z",
    });
    const oldDeleteRaceLock = randomUUID();
    const deleteLock = randomUUID();
    await client.query(
      "select * from public.claim_github_issue_comment_webhook_delivery($1,$2::uuid,120)",
      ["verify-comment-old-before-delete", oldDeleteRaceLock],
    );
    await client.query(
      "select * from public.claim_github_issue_comment_webhook_delivery($1,$2::uuid,120)",
      ["verify-comment-delete", deleteLock],
    );
    const deleteResult = await applyGitHubCommentProjection(client, {
      deliveryId: "verify-comment-delete",
      lockToken: deleteLock,
      operation: "delete",
      taskId: mappingTaskId,
      commentUpdatedAt: deletedVersion,
    });
    const staleDeleteRaceResult = await applyGitHubCommentProjection(client, {
      deliveryId: "verify-comment-old-before-delete",
      lockToken: oldDeleteRaceLock,
      operation: "upsert",
      taskId: mappingTaskId,
      commentUpdatedAt: deletedVersion,
      authorLogin: "old-author",
      body: "Resurrected stale snapshot",
      htmlUrl: `${mappingIssueUrl}#issuecomment-${deletedCommentId}`,
      createdAt: "2026-08-14T12:30:00Z",
      importedAt: "2026-08-14T12:40:03Z",
    });
    const deletedProjection = await client.query(
      "select body from public.task_external_comments where source='github' and external_id=$1",
      [String(deletedCommentId)],
    );
    if (deleteResult !== "applied"
      || staleDeleteRaceResult !== "stale"
      || deletedProjection.rows.length !== 0) {
      throw new Error("A stale GitHub comment snapshot resurrected a verified deletion.");
    }

    const editedCommentId = 9100000002;
    const oldEditVersion = "2026-08-14T12:41:00Z";
    const newEditVersion = "2026-08-14T12:42:00Z";
    await insertGitHubWebhookDelivery(client, {
      deliveryId: "verify-comment-old-edit",
      eventName: "issue_comment",
      action: "edited",
      issueNumber: mappingIssueNumber,
      commentId: editedCommentId,
      commentNodeId: "IC_verifyOldEdit",
      commentUpdatedAt: oldEditVersion,
      receivedAt: "2026-08-14T12:41:01Z",
    });
    await insertGitHubWebhookDelivery(client, {
      deliveryId: "verify-comment-new-edit",
      eventName: "issue_comment",
      action: "edited",
      issueNumber: mappingIssueNumber,
      commentId: editedCommentId,
      commentNodeId: "IC_verifyNewEdit",
      commentUpdatedAt: newEditVersion,
      receivedAt: "2026-08-14T12:42:01Z",
    });
    const oldEditLock = randomUUID();
    const newEditLock = randomUUID();
    await client.query(
      "select * from public.claim_github_issue_comment_webhook_delivery($1,$2::uuid,120)",
      ["verify-comment-old-edit", oldEditLock],
    );
    await client.query(
      "select * from public.claim_github_issue_comment_webhook_delivery($1,$2::uuid,120)",
      ["verify-comment-new-edit", newEditLock],
    );
    const newEditResult = await applyGitHubCommentProjection(client, {
      deliveryId: "verify-comment-new-edit",
      lockToken: newEditLock,
      operation: "upsert",
      taskId: mappingTaskId,
      commentUpdatedAt: newEditVersion,
      authorLogin: "new-author",
      body: "Newest snapshot",
      htmlUrl: `${mappingIssueUrl}#issuecomment-${editedCommentId}`,
      createdAt: "2026-08-14T12:30:00Z",
      importedAt: "2026-08-14T12:42:02Z",
    });
    const oldEditResult = await applyGitHubCommentProjection(client, {
      deliveryId: "verify-comment-old-edit",
      lockToken: oldEditLock,
      operation: "upsert",
      taskId: mappingTaskId,
      commentUpdatedAt: oldEditVersion,
      authorLogin: "old-author",
      body: "Older snapshot",
      htmlUrl: `${mappingIssueUrl}#issuecomment-${editedCommentId}`,
      createdAt: "2026-08-14T12:30:00Z",
      importedAt: "2026-08-14T12:42:03Z",
    });
    const editedProjection = await client.query(
      "select body from public.task_external_comments where source='github' and external_id=$1",
      [String(editedCommentId)],
    );
    if (newEditResult !== "applied"
      || oldEditResult !== "stale"
      || editedProjection.rows[0]?.body !== "Newest snapshot") {
      throw new Error("An older GitHub comment snapshot overwrote the newest edit.");
    }

    await expectGitHubWebhookDeliveryConstraintViolation(client, "Incomplete Issue comment delivery", () => (
      insertGitHubWebhookDelivery(client, {
        deliveryId: "verify-comment-incomplete",
        eventName: "issue_comment",
      })
    ));
    await expectGitHubWebhookDeliveryConstraintViolation(client, "Issue delivery with comment metadata", () => (
      insertGitHubWebhookDelivery(client, {
        deliveryId: "verify-issue-with-comment",
        eventName: "issues",
        commentId: 405,
        commentNodeId: "IC_kwDOUnexpected",
        commentUpdatedAt: "2026-08-14T12:32:00Z",
      })
    ));

    await client.query("rollback");
    console.log("GitHub webhook delivery journal metadata, claim lifecycle, and RPC authorization verified.");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function verifyGitHubProjectRoleBoundary(status, source) {
  const client = new pg.Client({ connectionString: status.DB_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("savepoint deputy_attempt");
    try {
      await client.query(
        "select public.update_founderops_github_project_transaction($1,$2,$3,$2,$3,$4,$5,$6)",
        [
          source.project.id,
          source.project.githubProjectOwner,
          source.project.githubProjectNumber,
          "local-deputy",
          "127.0.0.1",
          "local-integration-verifier",
        ],
      );
      throw new Error("Deputy unexpectedly changed the global GitHub Project through the database RPC.");
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Deputy unexpectedly")) throw error;
      if (error?.code !== "P0005") throw error;
    }
    await client.query("rollback to savepoint deputy_attempt");
    await client.query(
      "select public.update_founderops_github_project_transaction($1,$2,$3,$2,$3,$4,$5,$6)",
      [
        source.project.id,
        source.project.githubProjectOwner,
        source.project.githubProjectNumber,
        "volkan",
        "127.0.0.1",
        "local-integration-verifier",
      ],
    );
    await client.query("rollback");
  } finally {
    await client.end();
  }
}

async function verifyUnmappedAuthReadBoundary(status) {
  const adminKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY;
  if (!adminKey) throw new Error("Local Supabase status did not expose an admin key.");

  const admin = createClient(status.API_URL, adminKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const unmapped = createClient(status.API_URL, status.ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `unmapped-rls-${Date.now()}@example.test`;
  const password = "Local-only-unmapped-RLS-2026!";
  let userId = "";

  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      throw new Error("Could not create the temporary unmapped local Auth user.");
    }
    userId = created.user.id;

    const { data: signIn, error: signInError } = await unmapped.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError || !signIn.session) {
      throw new Error("Temporary unmapped local Auth user could not sign in.");
    }

    for (const [table, identityColumn] of [
      ["profiles", "id"],
      ["tasks", "id"],
      ["platform_releases", "version"],
      ["team_workweek_versions", "id"],
      ["team_workweek_windows", "id"],
      ["team_workweek_publications", "id"],
      ["team_workweek_google_reconciliation_status", "publication_id"],
      ["team_workweek_google_series", "id"],
      ["team_workweek_google_series_transitions", "id"],
    ]) {
      const { data, error } = await unmapped.from(table).select(identityColumn).limit(1);
      if (error) throw new Error(`Unmapped Auth RLS read failed unexpectedly for ${table}.`);
      if (data?.length) {
        throw new Error(`Unmapped Auth user unexpectedly read team data from ${table}.`);
      }
    }

    for (const table of [
      "team_workweek_google_conflicts",
      "google_workspace_disconnect_operations",
      "google_workspace_disconnect_series",
    ]) {
      const { data: deniedInternal, error: deniedInternalError } = await unmapped
        .from(table).select("id").limit(1);
      if (!deniedInternalError || deniedInternalError.code !== "42501" || deniedInternal) {
        throw new Error(`Unmapped Auth user unexpectedly reached internal ${table} state.`);
      }
    }

    const { data: deniedDraft, error: deniedDraftError } = await unmapped.rpc(
      "create_private_team_workweek_version",
      { p_effective_from: nextBerlinMondayIso(), p_windows: [] },
    );
    if (!deniedDraftError || deniedDraftError.code !== "42501" || deniedDraft) {
      throw new Error("Unmapped Auth user unexpectedly created a private team workweek.");
    }
  } finally {
    await unmapped.auth.signOut({ scope: "local" }).catch(() => undefined);
    if (userId) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
      if (deleteError) throw new Error("Temporary unmapped local Auth user could not be removed.");
    }
  }
}

async function verifyPrivateTeamWorkweekAccessBoundary(status, mapped) {
  const adminKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY;
  if (!adminKey) throw new Error("Local Supabase status did not expose an admin key.");
  const admin = createClient(status.API_URL, adminKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const database = new pg.Client({ connectionString: status.DB_URL });
  const temporaryUsers = [];
  const ownerIds = ["volkan", "sebastian"];
  const effectiveFrom = nextBerlinMondayIso();
  await database.connect();

  async function createMappedClient(profileId, label) {
    const email = `${label}-${Date.now()}-${randomUUID()}@example.test`;
    const password = `Local-${randomUUID()}!`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      throw new Error(`Could not create the temporary ${label} Auth user: ${createError?.message || "missing user"}.`);
    }
    temporaryUsers.push(created.user.id);
    await database.query("update public.profiles set auth_user_id=$1 where id=$2", [created.user.id, profileId]);
    const client = createClient(status.API_URL, status.ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError || !signIn.session) throw new Error(`Temporary ${label} Auth user could not sign in.`);
    return client;
  }

  let founder;
  let viewer;
  try {
    const firstWindows = [
      { weekday: 1, startMinute: 540, endMinute: 720 },
      { weekday: 1, startMinute: 780, endMinute: 1020 },
      { weekday: 3, startMinute: 600, endMinute: 900 },
    ];
    const { data: first, error: firstError } = await mapped.rpc(
      "create_private_team_workweek_version",
      { p_effective_from: effectiveFrom, p_windows: firstWindows },
    );
    if (firstError || !first?.id || first.status !== "preparing") {
      throw new Error(`Mapped owner could not create a private team workweek version: ${firstError?.code || "missing_data"} ${firstError?.message || "missing result"}`);
    }
    const { data: second, error: secondError } = await mapped.rpc(
      "create_private_team_workweek_version",
      { p_effective_from: effectiveFrom, p_windows: [] },
    );
    if (secondError || !second?.id || second.id === first.id) {
      throw new Error("Saving a private team workweek did not create a new immutable version.");
    }

    const { data: ownerVersions, error: ownerReadError } = await mapped
      .from("team_workweek_versions")
      .select("id,owner_profile_id,team_workweek_windows(weekday,start_minute,end_minute)")
      .order("created_at", { ascending: true });
    if (ownerReadError || ownerVersions?.length !== 2
      || ownerVersions.some((version) => version.owner_profile_id !== "volkan")
      || ownerVersions[0].team_workweek_windows?.length !== firstWindows.length
      || ownerVersions[1].team_workweek_windows?.length !== 0) {
      throw new Error("Owner-only reads did not preserve both private team-workweek versions.");
    }

    const { error: insertError } = await mapped.from("team_workweek_versions").insert({
      owner_profile_id: "volkan",
      effective_from: effectiveFrom,
    });
    const { error: updateError } = await mapped.from("team_workweek_versions")
      .update({ effective_from: effectiveFrom }).eq("id", first.id);
    const { error: deleteError } = await mapped.from("team_workweek_versions").delete().eq("id", first.id);
    if (!insertError || insertError.code !== "42501"
      || !updateError || updateError.code !== "42501"
      || !deleteError || deleteError.code !== "42501") {
      throw new Error("Authenticated users unexpectedly bypassed the immutable workweek RPC boundary.");
    }

    const { error: overlapError } = await mapped.rpc("create_private_team_workweek_version", {
      p_effective_from: effectiveFrom,
      p_windows: [
        { weekday: 2, startMinute: 540, endMinute: 720 },
        { weekday: 2, startMinute: 600, endMinute: 780 },
      ],
    });
    if (!overlapError || overlapError.code !== "22023") {
      throw new Error("Overlapping private team-workweek windows were unexpectedly accepted.");
    }
    for (const malformedWindows of [
      [{ weekday: 1, startMinute: 540 }],
      [{}],
      [{ weekday: 1, startMinute: null, endMinute: 720 }],
    ]) {
      const { error } = await mapped.rpc("create_private_team_workweek_version", {
        p_effective_from: effectiveFrom,
        p_windows: malformedWindows,
      });
      if (!error || error.code !== "22023") {
        throw new Error("Malformed private team-workweek windows did not preserve the input-error contract.");
      }
    }
    const { data: ownerAfterMalformed, error: ownerAfterMalformedError } = await mapped
      .from("team_workweek_versions").select("id");
    if (ownerAfterMalformedError || ownerAfterMalformed?.length !== 2) {
      throw new Error("Rejected workweek input left a partial version behind.");
    }

    founder = await createMappedClient("sebastian", "foreign-founder-workweek");
    const { data: foreignBefore, error: foreignBeforeError } = await founder
      .from("team_workweek_versions").select("id");
    if (foreignBeforeError || foreignBefore?.length) {
      throw new Error("Foreign founder unexpectedly read another profile's private team workweek.");
    }
    const { data: foreignVersion, error: foreignCreateError } = await founder.rpc(
      "create_private_team_workweek_version",
      { p_effective_from: effectiveFrom, p_windows: [{ weekday: 5, startMinute: 600, endMinute: 720 }] },
    );
    if (foreignCreateError || !foreignVersion?.id) {
      throw new Error("Foreign founder could not create their own private team workweek.");
    }
    const { data: ownerAfterForeign, error: ownerAfterForeignError } = await mapped
      .from("team_workweek_versions").select("id");
    if (ownerAfterForeignError || ownerAfterForeign?.length !== 2) {
      throw new Error("Owner RLS exposed a foreign founder's private team workweek.");
    }

    const { data: prepared, error: prepareError } = await mapped.rpc(
      "prepare_team_workweek_publication",
      { p_version_id: first.id },
    );
    if (prepareError || prepared?.status !== "preparing" || prepared?.syncState !== "pending"
      || prepared?.sourceVersionId !== first.id
      || prepared?.series?.length !== firstWindows.length
      || prepared.series.some((series) => !series.id || !series.googleEventId || series.calendarId !== "primary")) {
      throw new Error("Owner could not prepare one durable Google series identity per workweek window.");
    }
    const { data: preparedAgain, error: prepareAgainError } = await mapped.rpc(
      "prepare_team_workweek_publication",
      { p_version_id: first.id },
    );
    if (prepareAgainError
      || JSON.stringify(preparedAgain?.series) !== JSON.stringify(prepared?.series)) {
      throw new Error("Repeated workweek publication did not preserve the durable Google series identities.");
    }
    const { error: prematureFinalizeError } = await mapped.rpc(
      "finalize_team_workweek_publication",
      { p_publication_id: prepared.id },
    );
    if (!prematureFinalizeError || prematureFinalizeError.code !== "P0003") {
      throw new Error("A partial Google projection unexpectedly became team-visible.");
    }
    const { data: foreignSeries, error: foreignSeriesError } = await founder
      .from("team_workweek_google_series").select("id");
    if (foreignSeriesError || foreignSeries?.length) {
      throw new Error("Provider projection identities leaked to another FounderOps profile.");
    }
    for (const series of prepared.series) {
      const { error: confirmError } = await admin.rpc("confirm_team_workweek_google_series", {
        p_series_id: series.id,
        p_etag: `\"etag-${series.id}\"`,
        p_founderops_revision: prepared.publicationRevision,
        p_observed_at: "2026-08-25T09:00:00.000Z",
      });
      if (confirmError) throw new Error("Service role could not persist a confirmed Google series.");
    }
    const { data: published, error: publishError } = await mapped.rpc(
      "finalize_team_workweek_publication",
      { p_publication_id: prepared.id },
    );
    if (publishError || published?.status !== "published" || published?.syncState !== "confirmed") {
      throw new Error("A fully confirmed workweek did not publish atomically for the team.");
    }
    const { data: reconciledDelay, error: reconciledDelayError } = await admin.rpc(
      "delay_team_workweek_publication",
      {
        p_publication_id: prepared.id,
        p_error_class: "provider_unavailable",
        p_observed_at: "2026-08-25T09:01:00.000Z",
      },
    );
    if (reconciledDelayError || reconciledDelay?.status !== "published" || reconciledDelay?.syncState !== "confirmed") {
      throw new Error("A delayed parallel result did not reconcile to an already published workweek.");
    }
    const { data: unchangedDraft, error: unchangedDraftError } = await mapped
      .from("team_workweek_versions")
      .select("id,status,owner_profile_id")
      .eq("id", first.id)
      .single();
    if (unchangedDraftError || unchangedDraft?.status !== "preparing" || unchangedDraft?.owner_profile_id !== "volkan") {
      throw new Error("Publication mutated the immutable private source version.");
    }
    const { data: foreignPublished, error: foreignPublishedError } = await founder
      .from("team_workweek_publications")
      .select("id,source_version_id,owner_profile_id,status,windows")
      .eq("id", prepared.id)
      .maybeSingle();
    if (foreignPublishedError || foreignPublished?.owner_profile_id !== "volkan"
      || foreignPublished?.status !== "published"
      || foreignPublished?.source_version_id !== first.id
      || foreignPublished.windows?.length !== firstWindows.length) {
      throw new Error("Published workweek did not become read-only team data.");
    }

    const staleBoundaryPrepare = await mapped.rpc(
      "prepare_team_workweek_publication",
      { p_version_id: second.id },
    );
    if (!staleBoundaryPrepare.error || staleBoundaryPrepare.error.code !== "22023" || staleBoundaryPrepare.data) {
      throw new Error("A later immutable draft unexpectedly reused an already published Monday boundary.");
    }

    const laterBoundary = new Date(`${effectiveFrom}T00:00:00.000Z`);
    laterBoundary.setUTCDate(laterBoundary.getUTCDate() + 14);
    const laterEffectiveFrom = laterBoundary.toISOString().slice(0, 10);
    const laterWindows = [{ weekday: 2, startMinute: 600, endMinute: 840 }];
    const { data: laterVersion, error: laterVersionError } = await mapped.rpc(
      "create_private_team_workweek_version",
      { p_effective_from: laterEffectiveFrom, p_windows: laterWindows },
    );
    if (laterVersionError || !laterVersion?.id) {
      throw new Error("Owner could not create an immutable version at a later Monday boundary.");
    }
    const { data: preparedLater, error: prepareLaterError } = await mapped.rpc(
      "prepare_team_workweek_publication",
      { p_version_id: laterVersion.id },
    );
    if (prepareLaterError
      || preparedLater?.publicationRevision !== 2
      || preparedLater?.series?.length !== laterWindows.length
      || preparedLater?.transitions?.length !== firstWindows.length
      || preparedLater.transitions.some((transition) => transition.recurrenceCount !== 2
        || transition.expectedFounderopsRevision !== 1
        || !transition.expectedEtag)) {
      throw new Error("A later version did not prepare its own series and every predecessor transition.");
    }
    const { data: delayedLater, error: delayedLaterError } = await admin.rpc(
      "delay_team_workweek_publication",
      {
        p_publication_id: preparedLater.id,
        p_error_class: "provider_unavailable",
        p_observed_at: "2026-08-25T10:00:00.000Z",
      },
    );
    const { data: stillCurrent, error: stillCurrentError } = await founder
      .from("team_workweek_publications")
      .select("id,status,effective_to")
      .eq("id", prepared.id)
      .single();
    if (delayedLaterError || delayedLater?.syncState !== "delayed"
      || stillCurrentError || stillCurrent?.status !== "published" || stillCurrent.effective_to !== null) {
      throw new Error("A delayed later version changed the previously published team state.");
    }
    const staleTransition = preparedLater.transitions[0];
    const { error: staleTransitionError } = await admin.rpc("confirm_team_workweek_google_series_transition", {
      p_transition_id: staleTransition.id,
      p_etag: '"unexpected"',
      p_expected_founderops_revision: 2,
      p_observed_at: "2026-08-25T10:01:00.000Z",
    });
    if (!staleTransitionError || staleTransitionError.code !== "22023") {
      throw new Error("A stale FounderOps predecessor revision unexpectedly overwrote transition state.");
    }
    for (const series of preparedLater.series) {
      const { error: confirmError } = await admin.rpc("confirm_team_workweek_google_series", {
        p_series_id: series.id,
        p_etag: `"etag-${series.id}"`,
        p_founderops_revision: preparedLater.publicationRevision,
        p_observed_at: "2026-08-25T10:02:00.000Z",
      });
      if (confirmError) throw new Error("Service role could not confirm a later Google series.");
    }
    const { error: transitionGateError } = await mapped.rpc(
      "finalize_team_workweek_publication",
      { p_publication_id: preparedLater.id },
    );
    if (!transitionGateError || transitionGateError.code !== "P0003") {
      throw new Error("A later version became team-visible before predecessor series were ended.");
    }
    for (const transition of preparedLater.transitions) {
      const { error: confirmError } = await admin.rpc("confirm_team_workweek_google_series_transition", {
        p_transition_id: transition.id,
        p_etag: `"transition-etag-${transition.id}"`,
        p_expected_founderops_revision: transition.expectedFounderopsRevision,
        p_observed_at: "2026-08-25T10:03:00.000Z",
      });
      if (confirmError) throw new Error("Service role could not confirm a predecessor series transition.");
    }
    const { data: publishedLater, error: publishedLaterError } = await mapped.rpc(
      "finalize_team_workweek_publication",
      { p_publication_id: preparedLater.id },
    );
    const expectedPreviousEnd = new Date(`${laterEffectiveFrom}T00:00:00.000Z`);
    expectedPreviousEnd.setUTCDate(expectedPreviousEnd.getUTCDate() - 1);
    const { data: versionHistory, error: versionHistoryError } = await mapped
      .from("team_workweek_publications")
      .select("id,effective_from,effective_to,superseded_by_publication_id,publication_revision,status")
      .order("publication_revision", { ascending: true });
    if (publishedLaterError || publishedLater?.status !== "published"
      || versionHistoryError || versionHistory?.length !== 2
      || versionHistory[0].effective_to !== expectedPreviousEnd.toISOString().slice(0, 10)
      || versionHistory[0].superseded_by_publication_id !== preparedLater.id
      || versionHistory[1].publication_revision !== 2
      || versionHistory[1].effective_to !== null) {
      throw new Error("Sequential workweek publication did not preserve an immutable Monday-bounded history.");
    }
    const { data: foreignTransitions, error: foreignTransitionsError } = await founder
      .from("team_workweek_google_series_transitions").select("id");
    if (foreignTransitionsError || foreignTransitions?.length) {
      throw new Error("Provider transition identities leaked to another FounderOps profile.");
    }

    const emptyBoundary = new Date(`${laterEffectiveFrom}T00:00:00.000Z`);
    emptyBoundary.setUTCDate(emptyBoundary.getUTCDate() + 7);
    const emptyEffectiveFrom = emptyBoundary.toISOString().slice(0, 10);
    const { data: emptyVersion, error: emptyVersionError } = await mapped.rpc(
      "create_private_team_workweek_version",
      { p_effective_from: emptyEffectiveFrom, p_windows: [] },
    );
    const { data: preparedEmpty, error: preparedEmptyError } = emptyVersionError ? { data: null, error: emptyVersionError } : await mapped.rpc(
      "prepare_team_workweek_publication",
      { p_version_id: emptyVersion.id },
    );
    if (preparedEmptyError || preparedEmpty?.publicationRevision !== 3
      || preparedEmpty?.series?.length !== 0 || preparedEmpty?.transitions?.length !== laterWindows.length) {
      throw new Error("An empty workweek version did not preserve the predecessor transition contract.");
    }
    for (const transition of preparedEmpty.transitions) {
      const { error: confirmError } = await admin.rpc("confirm_team_workweek_google_series_transition", {
        p_transition_id: transition.id,
        p_etag: `"transition-etag-${transition.id}"`,
        p_expected_founderops_revision: transition.expectedFounderopsRevision,
        p_observed_at: "2026-08-25T10:04:00.000Z",
      });
      if (confirmError) throw new Error("Service role could not end the series before an empty workweek.");
    }
    const { data: publishedEmpty, error: publishedEmptyError } = await mapped.rpc(
      "finalize_team_workweek_publication",
      { p_publication_id: preparedEmpty.id },
    );
    if (publishedEmptyError || publishedEmpty?.status !== "published") {
      throw new Error("A fully confirmed empty workweek did not publish.");
    }

    const afterEmptyBoundary = new Date(`${emptyEffectiveFrom}T00:00:00.000Z`);
    afterEmptyBoundary.setUTCDate(afterEmptyBoundary.getUTCDate() + 7);
    const afterEmptyEffectiveFrom = afterEmptyBoundary.toISOString().slice(0, 10);
    const afterEmptyWindows = [{ weekday: 4, startMinute: 540, endMinute: 720 }];
    const { data: afterEmptyVersion, error: afterEmptyVersionError } = await mapped.rpc(
      "create_private_team_workweek_version",
      { p_effective_from: afterEmptyEffectiveFrom, p_windows: afterEmptyWindows },
    );
    const { data: preparedAfterEmpty, error: preparedAfterEmptyError } = afterEmptyVersionError ? { data: null, error: afterEmptyVersionError } : await mapped.rpc(
      "prepare_team_workweek_publication",
      { p_version_id: afterEmptyVersion.id },
    );
    if (preparedAfterEmptyError || preparedAfterEmpty?.publicationRevision !== 4
      || preparedAfterEmpty?.series?.length !== afterEmptyWindows.length || preparedAfterEmpty?.transitions?.length !== 0) {
      throw new Error("A successor to an empty workweek did not preserve an empty provider transition set.");
    }
    for (const series of preparedAfterEmpty.series) {
      const { error: confirmError } = await admin.rpc("confirm_team_workweek_google_series", {
        p_series_id: series.id,
        p_etag: `"etag-${series.id}"`,
        p_founderops_revision: preparedAfterEmpty.publicationRevision,
        p_observed_at: "2026-08-25T10:05:00.000Z",
      });
      if (confirmError) throw new Error("Service role could not confirm the successor to an empty workweek.");
    }
    const { data: publishedAfterEmpty, error: publishedAfterEmptyError } = await mapped.rpc(
      "finalize_team_workweek_publication",
      { p_publication_id: preparedAfterEmpty.id },
    );
    const expectedEmptyEnd = new Date(`${afterEmptyEffectiveFrom}T00:00:00.000Z`);
    expectedEmptyEnd.setUTCDate(expectedEmptyEnd.getUTCDate() - 1);
    const { data: emptyHistory, error: emptyHistoryError } = await mapped
      .from("team_workweek_publications")
      .select("id,effective_to,superseded_by_publication_id,publication_revision")
      .order("publication_revision", { ascending: true });
    if (publishedAfterEmptyError || publishedAfterEmpty?.status !== "published"
      || emptyHistoryError || emptyHistory?.length !== 4
      || emptyHistory[2].effective_to !== expectedEmptyEnd.toISOString().slice(0, 10)
      || emptyHistory[2].superseded_by_publication_id !== preparedAfterEmpty.id
      || emptyHistory[3].publication_revision !== 4) {
      throw new Error("A successor to an empty workweek left an overlapping open validity interval.");
    }

    const { data: activeGoogleSeries, error: activeGoogleSeriesError } = await admin
      .from("team_workweek_google_series")
      .select("id,confirmed_etag,confirmed_founderops_revision")
      .eq("publication_id", preparedAfterEmpty.id)
      .single();
    if (activeGoogleSeriesError || !activeGoogleSeries?.confirmed_etag || !activeGoogleSeries.confirmed_founderops_revision) {
      throw new Error("The active workweek Google identity was not available for reconciliation.");
    }
    const changedGoogleEtag = `"google-change-${activeGoogleSeries.id}"`;
    const googleChangeBoundary = new Date(`${afterEmptyEffectiveFrom}T00:00:00.000Z`);
    googleChangeBoundary.setUTCDate(googleChangeBoundary.getUTCDate() + 7);
    const googleChangeEffectiveFrom = googleChangeBoundary.toISOString().slice(0, 10);
    const googleChangeWindows = [{ weekday: 4, startMinute: 600, endMinute: 780 }];
    const googleChangeObservations = [{
      seriesId: activeGoogleSeries.id,
      priorEtag: activeGoogleSeries.confirmed_etag,
      observedEtag: changedGoogleEtag,
      founderopsRevision: activeGoogleSeries.confirmed_founderops_revision,
      providerState: "active",
    }];
    const { data: googleChange, error: googleChangeError } = await admin.rpc(
      "prepare_google_team_workweek_reconciliation",
      {
        p_owner_profile_id: "volkan",
        p_source_publication_id: preparedAfterEmpty.id,
        p_source_publication_revision: preparedAfterEmpty.publicationRevision,
        p_effective_from: googleChangeEffectiveFrom,
        p_observations: googleChangeObservations,
        p_windows: googleChangeWindows,
        p_fingerprint: "a".repeat(64),
        p_observed_at: "2026-08-25T10:06:00.000Z",
      },
    );
    const { data: googleChangeReplay, error: googleChangeReplayError } = googleChangeError
      ? { data: null, error: googleChangeError }
      : await admin.rpc("prepare_google_team_workweek_reconciliation", {
        p_owner_profile_id: "volkan",
        p_source_publication_id: preparedAfterEmpty.id,
        p_source_publication_revision: preparedAfterEmpty.publicationRevision,
        p_effective_from: googleChangeEffectiveFrom,
        p_observations: googleChangeObservations,
        p_windows: googleChangeWindows,
        p_fingerprint: "a".repeat(64),
        p_observed_at: "2026-08-25T10:06:00.000Z",
      });
    const { data: preparedGoogleChange, error: preparedGoogleChangeError } = googleChangeReplayError
      ? { data: null, error: googleChangeReplayError }
      : await mapped.rpc("prepare_team_workweek_publication", { p_version_id: googleChange.versionId });
    if (googleChangeError || !googleChange?.versionId
      || googleChangeReplayError || googleChangeReplay?.versionId !== googleChange.versionId || googleChangeReplay?.replayed !== true
      || preparedGoogleChangeError || preparedGoogleChange?.publicationRevision !== 5
      || preparedGoogleChange?.series?.length !== 1 || preparedGoogleChange?.transitions?.length !== 1
      || preparedGoogleChange.transitions[0].expectedEtag !== changedGoogleEtag) {
      throw new Error("A validated Google series change did not prepare one replay-safe Monday version.");
    }
    const { data: ownerReconciliationStatus, error: ownerReconciliationStatusError } = await mapped
      .from("team_workweek_google_reconciliation_status")
      .select("publication_id,state,last_error_class")
      .eq("publication_id", preparedAfterEmpty.id)
      .single();
    const { data: foreignReconciliationStatus, error: foreignReconciliationStatusError } = await founder
      .from("team_workweek_google_reconciliation_status")
      .select("publication_id")
      .eq("publication_id", preparedAfterEmpty.id);
    const { data: blockedOwnerDraft, error: blockedOwnerDraftError } = await mapped.rpc(
      "create_private_team_workweek_version",
      { p_effective_from: googleChangeEffectiveFrom, p_windows: googleChangeWindows },
    );
    if (ownerReconciliationStatusError || ownerReconciliationStatus?.state !== "pending"
      || ownerReconciliationStatus.last_error_class !== null
      || foreignReconciliationStatusError || foreignReconciliationStatus?.length
      || !blockedOwnerDraftError || blockedOwnerDraftError.code !== "P0003" || blockedOwnerDraft) {
      throw new Error("Pending Google reconciliation state was exposed across owners or accepted a competing owner draft.");
    }
    for (const series of preparedGoogleChange.series) {
      const { error } = await admin.rpc("confirm_team_workweek_google_series", {
        p_series_id: series.id,
        p_etag: `"etag-${series.id}"`,
        p_founderops_revision: preparedGoogleChange.publicationRevision,
        p_observed_at: "2026-08-25T10:07:00.000Z",
      });
      if (error) throw new Error("Google-reconciled replacement series could not be confirmed.");
    }
    for (const transition of preparedGoogleChange.transitions) {
      const { error } = await admin.rpc("confirm_team_workweek_google_series_transition", {
        p_transition_id: transition.id,
        p_etag: `"transition-${transition.id}"`,
        p_expected_founderops_revision: transition.expectedFounderopsRevision,
        p_observed_at: "2026-08-25T10:07:00.000Z",
      });
      if (error) throw new Error("Google-reconciled predecessor transition could not be confirmed.");
    }
    const { data: publishedGoogleChange, error: publishedGoogleChangeError } = await mapped.rpc(
      "finalize_team_workweek_publication",
      { p_publication_id: preparedGoogleChange.id },
    );
    if (publishedGoogleChangeError || publishedGoogleChange?.status !== "published") {
      throw new Error("A fully confirmed Google-only change did not become the next team version.");
    }

    const { data: changedReplacementSeries, error: changedReplacementSeriesError } = await admin
      .from("team_workweek_google_series")
      .select("id,confirmed_etag,confirmed_founderops_revision")
      .eq("publication_id", preparedGoogleChange.id)
      .single();
    const googleDeletionBoundary = new Date(`${googleChangeEffectiveFrom}T00:00:00.000Z`);
    googleDeletionBoundary.setUTCDate(googleDeletionBoundary.getUTCDate() + 7);
    const googleDeletionEffectiveFrom = googleDeletionBoundary.toISOString().slice(0, 10);
    const googleDeletionObservations = changedReplacementSeries ? [{
      seriesId: changedReplacementSeries.id,
      priorEtag: changedReplacementSeries.confirmed_etag,
      observedEtag: changedReplacementSeries.confirmed_etag,
      founderopsRevision: changedReplacementSeries.confirmed_founderops_revision,
      providerState: "deleted",
    }] : [];
    const { data: googleDeletion, error: googleDeletionError } = changedReplacementSeriesError
      ? { data: null, error: changedReplacementSeriesError }
      : await admin.rpc("prepare_google_team_workweek_reconciliation", {
        p_owner_profile_id: "volkan",
        p_source_publication_id: preparedGoogleChange.id,
        p_source_publication_revision: preparedGoogleChange.publicationRevision,
        p_effective_from: googleDeletionEffectiveFrom,
        p_observations: googleDeletionObservations,
        p_windows: [],
        p_fingerprint: "b".repeat(64),
        p_observed_at: "2026-08-25T10:08:00.000Z",
      });
    const { data: preparedGoogleDeletion, error: preparedGoogleDeletionError } = googleDeletionError
      ? { data: null, error: googleDeletionError }
      : await mapped.rpc("prepare_team_workweek_publication", { p_version_id: googleDeletion.versionId });
    if (googleDeletionError || !googleDeletion?.versionId
      || preparedGoogleDeletionError || preparedGoogleDeletion?.publicationRevision !== 6
      || preparedGoogleDeletion?.series?.length !== 0 || preparedGoogleDeletion?.transitions?.length !== 1
      || preparedGoogleDeletion.transitions[0].state !== "confirmed") {
      throw new Error("A known full-series deletion was not accepted without recreating or rewriting the deleted series.");
    }
    const { data: publishedGoogleDeletion, error: publishedGoogleDeletionError } = await mapped.rpc(
      "finalize_team_workweek_publication",
      { p_publication_id: preparedGoogleDeletion.id },
    );
    if (publishedGoogleDeletionError || publishedGoogleDeletion?.status !== "published") {
      throw new Error("A confirmed Google series deletion did not publish the empty successor week.");
    }

    const { error: staleGoogleObservationError } = await admin.rpc("confirm_google_team_workweek_observation", {
      p_publication_id: preparedGoogleChange.id,
      p_publication_revision: preparedGoogleChange.publicationRevision,
      p_observations: googleDeletionObservations,
      p_observed_at: "2026-08-25T10:09:00.000Z",
    });
    if (!staleGoogleObservationError || staleGoogleObservationError.code !== "P0004") {
      throw new Error("A stale Google observation unexpectedly changed a superseded FounderOps week.");
    }

    const conflictBoundary = new Date(`${googleDeletionEffectiveFrom}T00:00:00.000Z`);
    conflictBoundary.setUTCDate(conflictBoundary.getUTCDate() + 7);
    const conflictEffectiveFrom = conflictBoundary.toISOString().slice(0, 10);
    const conflictFounderopsWindows = [{ weekday: 2, startMinute: 540, endMinute: 720 }];
    const { data: conflictDraft, error: conflictDraftError } = await mapped.rpc("create_private_team_workweek_version", {
      p_effective_from: conflictEffectiveFrom,
      p_windows: conflictFounderopsWindows,
    });
    const { data: initialConflict, error: initialConflictError } = conflictDraftError
      ? { data: null, error: conflictDraftError }
      : await admin.rpc("create_team_workweek_google_conflict", {
        p_owner_profile_id: "volkan",
        p_base_publication_id: preparedGoogleDeletion.id,
        p_base_publication_revision: preparedGoogleDeletion.publicationRevision,
        p_founderops_version_id: conflictDraft.id,
        p_google_effective_from: conflictEffectiveFrom,
        p_google_windows: [{ weekday: 3, startMinute: 600, endMinute: 780 }],
        p_google_observations: [],
        p_google_fingerprint: "c".repeat(64),
        p_founderops_fingerprint: "d".repeat(64),
        p_observed_at: "2026-08-25T10:10:00.000Z",
      });
    const { data: newerConflictDraft, error: newerConflictDraftError } = initialConflictError
      ? { data: null, error: initialConflictError }
      : await mapped.rpc("create_private_team_workweek_version", {
        p_effective_from: conflictEffectiveFrom,
        p_windows: [{ weekday: 2, startMinute: 600, endMinute: 780 }],
      });
    const { error: intermediateDraftDecisionError } = newerConflictDraftError
      ? { error: newerConflictDraftError }
      : await admin.rpc("prepare_team_workweek_google_conflict_resolution", {
        p_conflict_id: initialConflict.id,
        p_owner_profile_id: "volkan",
        p_conflict_revision: initialConflict.conflictRevision,
        p_decision: "founderops",
        p_google_observations: [],
        p_google_fingerprint: "c".repeat(64),
        p_founderops_fingerprint: "d".repeat(64),
        p_resolution_fingerprint: "e".repeat(64),
        p_observed_at: "2026-08-25T10:10:30.000Z",
      });
    const { data: capturedConflict, error: capturedConflictError } = newerConflictDraftError
      ? { data: null, error: newerConflictDraftError }
      : await admin.rpc("create_team_workweek_google_conflict", {
        p_owner_profile_id: "volkan",
        p_base_publication_id: preparedGoogleDeletion.id,
        p_base_publication_revision: preparedGoogleDeletion.publicationRevision,
        p_founderops_version_id: newerConflictDraft.id,
        p_google_effective_from: conflictEffectiveFrom,
        p_google_windows: [{ weekday: 3, startMinute: 600, endMinute: 780 }],
        p_google_observations: [],
        p_google_fingerprint: "c".repeat(64),
        p_founderops_fingerprint: "d".repeat(64),
        p_observed_at: "2026-08-25T10:10:45.000Z",
      });
    const { data: ownerConflict, error: ownerConflictError } = capturedConflictError
      ? { data: null, error: capturedConflictError }
      : await mapped.from("team_workweek_google_conflicts").select("id,state,google_windows").eq("id", capturedConflict.id).single();
    const { data: foreignConflict, error: foreignConflictError } = await founder
      .from("team_workweek_google_conflicts").select("id");
    const { data: preparedConflictResolution, error: preparedConflictResolutionError } = capturedConflictError
      ? { data: null, error: capturedConflictError }
      : await admin.rpc("prepare_team_workweek_google_conflict_resolution", {
        p_conflict_id: capturedConflict.id,
        p_owner_profile_id: "volkan",
        p_conflict_revision: capturedConflict.conflictRevision,
        p_decision: "founderops",
        p_google_observations: [],
        p_google_fingerprint: "c".repeat(64),
        p_founderops_fingerprint: "d".repeat(64),
        p_resolution_fingerprint: "e".repeat(64),
        p_observed_at: "2026-08-25T10:11:00.000Z",
      });
    const { data: conflictPublication, error: conflictPublicationError } = preparedConflictResolutionError
      ? { data: null, error: preparedConflictResolutionError }
      : await mapped.rpc("prepare_team_workweek_publication", { p_version_id: preparedConflictResolution.versionId });
    if (conflictDraftError || !conflictDraft?.id || initialConflictError || !initialConflict?.id
      || newerConflictDraftError || !newerConflictDraft?.id
      || !intermediateDraftDecisionError || intermediateDraftDecisionError.code !== "P0004"
      || capturedConflictError || !capturedConflict?.id
      || !ownerConflictError || ownerConflictError.code !== "42501" || ownerConflict
      || !foreignConflictError || foreignConflictError.code !== "42501" || foreignConflict
      || preparedConflictResolutionError || !preparedConflictResolution?.versionId
      || conflictPublicationError || conflictPublication?.series?.length !== 1 || conflictPublication?.transitions?.length !== 0) {
      throw new Error("An owner-private parallel conflict did not prepare exactly one selected resolution.");
    }
    const { error: confirmConflictSeriesError } = await admin.rpc("confirm_team_workweek_google_series", {
      p_series_id: conflictPublication.series[0].id,
      p_etag: `"etag-${conflictPublication.series[0].id}"`,
      p_founderops_revision: conflictPublication.publicationRevision,
      p_observed_at: "2026-08-25T10:12:00.000Z",
    });
    const { data: publishedConflictResolution, error: publishedConflictResolutionError } = confirmConflictSeriesError
      ? { data: null, error: confirmConflictSeriesError }
      : await mapped.rpc("finalize_team_workweek_publication", { p_publication_id: conflictPublication.id });
    const { error: completeConflictError } = publishedConflictResolutionError
      ? { error: publishedConflictResolutionError }
      : await admin.rpc("complete_team_workweek_google_conflict_resolution", {
        p_conflict_id: capturedConflict.id,
        p_owner_profile_id: "volkan",
        p_conflict_revision: capturedConflict.conflictRevision,
        p_resolved_at: "2026-08-25T10:13:00.000Z",
      });
    const { data: replayedConflictResolution, error: replayedConflictResolutionError } = completeConflictError
      ? { data: null, error: completeConflictError }
      : await admin.rpc("prepare_team_workweek_google_conflict_resolution", {
        p_conflict_id: capturedConflict.id,
        p_owner_profile_id: "volkan",
        p_conflict_revision: capturedConflict.conflictRevision,
        p_decision: "founderops",
        p_google_observations: [],
        p_google_fingerprint: "c".repeat(64),
        p_founderops_fingerprint: "d".repeat(64),
        p_resolution_fingerprint: "e".repeat(64),
        p_observed_at: "2026-08-25T10:14:00.000Z",
      });
    const { error: staleConflictDecisionError } = await admin.rpc("prepare_team_workweek_google_conflict_resolution", {
      p_conflict_id: capturedConflict.id,
      p_owner_profile_id: "volkan",
      p_conflict_revision: capturedConflict.conflictRevision,
      p_decision: "google",
      p_google_observations: [],
      p_google_fingerprint: "c".repeat(64),
      p_founderops_fingerprint: "d".repeat(64),
      p_resolution_fingerprint: "f".repeat(64),
      p_observed_at: "2026-08-25T10:14:00.000Z",
    });
    if (publishedConflictResolution?.status !== "published" || completeConflictError
      || replayedConflictResolutionError || replayedConflictResolution?.versionId !== preparedConflictResolution.versionId
      || !staleConflictDecisionError || staleConflictDecisionError.code !== "P0004") {
      throw new Error("Conflict resolution was not publication-gated, replay-safe, and stale-decision protected.");
    }

    await database.query("update public.profiles set platform_role='viewer' where id='sebastian'");
    const { data: demotedVersions, error: demotedVersionsError } = await founder
      .from("team_workweek_versions").select("id,status");
    const { data: demotedWindows, error: demotedWindowsError } = await founder
      .from("team_workweek_windows").select("id");
    const { data: demotedPublications, error: demotedPublicationsError } = await founder
      .from("team_workweek_publications").select("id,status");
    const { data: demotedWrite, error: demotedWriteError } = await founder.rpc(
      "create_private_team_workweek_version",
      { p_effective_from: effectiveFrom, p_windows: [] },
    );
    if (demotedVersionsError || demotedVersions?.length
      || demotedWindowsError || demotedWindows?.length
      || demotedPublicationsError || demotedPublications?.length !== 7 || demotedPublications.some((publication) => publication.status !== "published")
      || !demotedWriteError || demotedWriteError.code !== "42501" || demotedWrite) {
      throw new Error("A profile demoted to viewer did not retain only published team-workweek access.");
    }
    await database.query("update public.profiles set platform_role='founder' where id='sebastian'");

    viewer = await createMappedClient("local-viewer", "viewer-workweek");
    const { data: viewerVersion, error: viewerCreateError } = await viewer.rpc(
      "create_private_team_workweek_version",
      { p_effective_from: effectiveFrom, p_windows: [] },
    );
    if (!viewerCreateError || viewerCreateError.code !== "42501" || viewerVersion) {
      throw new Error("Viewer unexpectedly created a private team workweek.");
    }
    const { data: viewerRead, error: viewerReadError } = await viewer.from("team_workweek_versions").select("id");
    const { data: viewerPublications, error: viewerPublicationsError } = await viewer
      .from("team_workweek_publications").select("id,status");
    const { data: viewerReconciliationStatus, error: viewerReconciliationStatusError } = await viewer
      .from("team_workweek_google_reconciliation_status").select("publication_id");
    const { data: viewerConflicts, error: viewerConflictsError } = await viewer
      .from("team_workweek_google_conflicts").select("id");
    if (viewerReadError || viewerRead?.length
      || viewerPublicationsError || viewerPublications?.length !== 7
      || viewerReconciliationStatusError || viewerReconciliationStatus?.length
      || !viewerConflictsError || viewerConflictsError.code !== "42501" || viewerConflicts
      || !viewerPublications.some((publication) => publication.id === prepared.id)
      || !viewerPublications.some((publication) => publication.id === preparedLater.id)
      || !viewerPublications.some((publication) => publication.id === preparedEmpty.id)
      || !viewerPublications.some((publication) => publication.id === preparedAfterEmpty.id)
      || !viewerPublications.some((publication) => publication.id === preparedGoogleChange.id)
      || !viewerPublications.some((publication) => publication.id === preparedGoogleDeletion.id)
      || !viewerPublications.some((publication) => publication.id === conflictPublication.id)) {
      throw new Error("Viewer did not receive the published version history while private drafts stayed hidden.");
    }

    const { data: directDisconnect, error: directDisconnectError } = await mapped.rpc(
      "prepare_google_workspace_disconnect",
      { p_owner_profile_id: "volkan" },
    );
    if (!directDisconnectError || directDisconnectError.code !== "42501" || directDisconnect) {
      throw new Error("Owner JWT unexpectedly bypassed the confirmed disconnect API boundary.");
    }
    const disconnectRaceBoundary = new Date(`${effectiveFrom}T00:00:00.000Z`);
    disconnectRaceBoundary.setUTCDate(disconnectRaceBoundary.getUTCDate() + 70);
    const { data: disconnectRaceDraft, error: disconnectRaceDraftError } = await mapped.rpc(
      "create_private_team_workweek_version",
      {
        p_effective_from: disconnectRaceBoundary.toISOString().slice(0, 10),
        p_windows: [{ weekday: 4, startMinute: 600, endMinute: 720 }],
      },
    );
    if (disconnectRaceDraftError || !disconnectRaceDraft?.id) {
      throw new Error("Could not create the concurrency fixture before disconnect.");
    }
    const { data: blockedDisconnect, error: blockedDisconnectError } = await admin.rpc(
      "prepare_google_workspace_disconnect",
      { p_owner_profile_id: "volkan" },
    );
    if (!blockedDisconnectError || blockedDisconnectError.code !== "P0003" || blockedDisconnect) {
      throw new Error("Disconnect unexpectedly bypassed an unresolved parallel-change conflict.");
    }
    await database.query("delete from public.team_workweek_google_conflicts where id=$1", [initialConflict.id]);
    const { data: preparedDisconnect, error: preparedDisconnectError } = await admin.rpc(
      "prepare_google_workspace_disconnect",
      { p_owner_profile_id: "volkan" },
    );
    const { data: racedPublication, error: racedPublicationError } = preparedDisconnectError
      ? { data: null, error: preparedDisconnectError }
      : await mapped.rpc("prepare_team_workweek_publication", { p_version_id: disconnectRaceDraft.id });
    const { data: privateDisconnectOperations, error: privateDisconnectOperationsError } = await founder
      .from("google_workspace_disconnect_operations").select("id");
    const { data: disconnectTargets, error: disconnectTargetsError } = preparedDisconnectError
      ? { data: null, error: preparedDisconnectError }
      : await admin.from("google_workspace_disconnect_series")
        .select("id,expected_etag,state")
        .eq("operation_id", preparedDisconnect.id)
        .order("id", { ascending: true });
    if (preparedDisconnectError || !preparedDisconnect?.id
      || !racedPublicationError || racedPublicationError.code !== "P0003" || racedPublication
      || !privateDisconnectOperationsError || privateDisconnectOperationsError.code !== "42501" || privateDisconnectOperations
      || disconnectTargetsError || !disconnectTargets?.length) {
      throw new Error(`Owner-confirmed Google disconnect did not create service-only exact cleanup targets (${JSON.stringify({
        prepareCode: preparedDisconnectError?.code || null,
        prepared: Boolean(preparedDisconnect?.id),
        privateReadCode: privateDisconnectOperationsError?.code || null,
        targetReadCode: disconnectTargetsError?.code || null,
        targetCount: disconnectTargets?.length || 0,
      })}).`);
    }
    for (const target of disconnectTargets) {
      const { error } = await admin.rpc("confirm_google_workspace_disconnect_series", {
        p_target_id: target.id,
        p_expected_etag: target.expected_etag,
        p_confirmed_etag: `"disconnect-${target.id}"`,
        p_observed_at: "2026-08-25T10:20:00.000Z",
      });
      if (error) throw new Error("A confirmed future-series cleanup could not be persisted.");
    }
    const { data: finalizedDisconnect, error: finalizedDisconnectError } = await admin.rpc(
      "finalize_google_workspace_disconnect",
      {
        p_operation_id: preparedDisconnect.id,
        p_owner_profile_id: "volkan",
        p_observed_at: "2026-08-25T10:21:00.000Z",
      },
    );
    const { error: removedDisconnectConnectionError } = finalizedDisconnectError
      ? { error: finalizedDisconnectError }
      : await admin.from("google_workspace_connections").delete().eq("profile_id", "volkan");
    const { error: completedDisconnectError } = removedDisconnectConnectionError
      ? { error: removedDisconnectConnectionError }
      : await admin.rpc("complete_google_workspace_disconnect", {
        p_operation_id: preparedDisconnect.id,
        p_owner_profile_id: "volkan",
        p_completed_at: "2026-08-25T10:22:00.000Z",
      });
    const { data: inactiveOwnerPublications, error: inactiveOwnerPublicationsError } = await mapped
      .from("team_workweek_publications").select("id,status,deactivation_reason");
    const { data: hiddenViewerPublications, error: hiddenViewerPublicationsError } = await viewer
      .from("team_workweek_publications").select("id,status");
    const { data: retainedPrivateVersion, error: retainedPrivateVersionError } = finalizedDisconnect?.retainedVersionId
      ? await mapped.from("team_workweek_versions").select("id,status").eq("id", finalizedDisconnect.retainedVersionId).single()
      : { data: null, error: finalizedDisconnectError };
    const disconnectReplayState = (await database.query(
      "select (select count(*)::integer from public.google_workspace_connections where profile_id=$1) as connections, (select count(*)::integer from public.team_workweek_publications where owner_profile_id=$1 and status='published') as published, (select jsonb_agg(jsonb_build_object('state', state, 'requestedBy', requested_by) order by requested_at) from public.google_workspace_disconnect_operations where owner_profile_id=$1) as operations",
      ["volkan"],
    )).rows[0];
    const retainedSnapshot = (await database.query(
      "select publication.windows as published_windows, coalesce(jsonb_agg(jsonb_build_object('weekday', work_window.weekday, 'startMinute', work_window.start_minute, 'endMinute', work_window.end_minute) order by work_window.weekday, work_window.start_minute, work_window.end_minute, work_window.id) filter (where work_window.id is not null), '[]'::jsonb) as retained_windows from public.team_workweek_publications publication left join public.team_workweek_windows work_window on work_window.version_id=$2 where publication.id=$1 group by publication.windows",
      [conflictPublication.id, finalizedDisconnect.retainedVersionId],
    )).rows[0];
    const { data: replayedDisconnect, error: replayedDisconnectError } = await admin.rpc(
      "prepare_google_workspace_disconnect",
      { p_owner_profile_id: "volkan" },
    );
    if (finalizedDisconnectError || finalizedDisconnect?.state !== "revoke_pending"
      || removedDisconnectConnectionError || completedDisconnectError
      || inactiveOwnerPublicationsError || inactiveOwnerPublications?.length !== 7
      || inactiveOwnerPublications.some((publication) => publication.status !== "inactive" || publication.deactivation_reason !== "manual_disconnect")
      || hiddenViewerPublicationsError || hiddenViewerPublications?.length
      || retainedPrivateVersionError || retainedPrivateVersion?.id !== finalizedDisconnect.retainedVersionId
      || JSON.stringify(retainedSnapshot?.published_windows) !== JSON.stringify(retainedSnapshot?.retained_windows)
      || replayedDisconnectError || replayedDisconnect?.state !== "completed" || !replayedDisconnect?.replayed) {
      throw new Error(`Disconnect did not preserve one private inactive configuration, hide the team week, and replay safely (${JSON.stringify({
        finalizeCode: finalizedDisconnectError?.code || null,
        finalizedState: finalizedDisconnect?.state || null,
        connectionRemovalCode: removedDisconnectConnectionError?.code || null,
        completeCode: completedDisconnectError?.code || null,
        inactiveReadCode: inactiveOwnerPublicationsError?.code || null,
        inactiveCount: inactiveOwnerPublications?.length || 0,
        inactiveStates: [...new Set((inactiveOwnerPublications || []).map((row) => `${row.status}:${row.deactivation_reason}`))],
        viewerReadCode: hiddenViewerPublicationsError?.code || null,
        viewerCount: hiddenViewerPublications?.length || 0,
        retainedReadCode: retainedPrivateVersionError?.code || null,
        retainedMatches: retainedPrivateVersion?.id === finalizedDisconnect?.retainedVersionId,
        retainedSnapshotMatches: JSON.stringify(retainedSnapshot?.published_windows) === JSON.stringify(retainedSnapshot?.retained_windows),
        replayCode: replayedDisconnectError?.code || null,
        replayState: replayedDisconnect?.state || null,
        replayed: replayedDisconnect?.replayed || false,
        replayPrerequisites: disconnectReplayState,
      })}).`);
    }

    await database.query(
      "update public.team_workweek_versions set effective_from=date '2026-08-17' where id=$1",
      [finalizedDisconnect.retainedVersionId],
    );

    const { data: preparedRepublish, error: preparedRepublishError } = await mapped.rpc(
      "prepare_team_workweek_publication",
      { p_version_id: finalizedDisconnect.retainedVersionId },
    );
    const { data: viewerDuringRepublish, error: viewerDuringRepublishError } = await viewer
      .from("team_workweek_publications").select("id,status");
    if (preparedRepublishError || !preparedRepublish?.id || preparedRepublish.series?.length !== 1
      || preparedRepublish.effectiveFrom !== effectiveFrom
      || viewerDuringRepublishError || viewerDuringRepublish?.length) {
      throw new Error("A retained private week was not kept private while explicit republishing prepared Google series.");
    }
    for (const series of preparedRepublish.series) {
      const { error } = await admin.rpc("confirm_team_workweek_google_series", {
        p_series_id: series.id,
        p_etag: `"republish-${series.id}"`,
        p_founderops_revision: preparedRepublish.publicationRevision,
        p_observed_at: "2026-08-25T10:24:00.000Z",
      });
      if (error) throw new Error("An explicitly republished Google series could not be confirmed.");
    }
    const { data: finalizedRepublish, error: finalizedRepublishError } = await mapped.rpc(
      "finalize_team_workweek_publication",
      { p_publication_id: preparedRepublish.id },
    );
    const { data: viewerAfterRepublish, error: viewerAfterRepublishError } = await viewer
      .from("team_workweek_publications").select("id,status");
    if (finalizedRepublishError || finalizedRepublish?.status !== "published"
      || viewerAfterRepublishError || viewerAfterRepublish?.length !== 1
      || viewerAfterRepublish[0].id !== preparedRepublish.id) {
      throw new Error("Only an explicit fully confirmed republish restored team visibility.");
    }
  } finally {
    await founder?.auth.signOut({ scope: "local" }).catch(() => undefined);
    await viewer?.auth.signOut({ scope: "local" }).catch(() => undefined);
    await database.query(
      "update public.team_workweek_publications set predecessor_publication_id=null, superseded_by_publication_id=null, effective_to=null where owner_profile_id = any($1::text[])",
      [ownerIds],
    );
    await database.query("delete from public.google_workspace_disconnect_operations where owner_profile_id = any($1::text[])", [ownerIds]);
    await database.query("delete from public.team_workweek_google_conflicts where owner_profile_id = any($1::text[])", [ownerIds]);
    const cleanupPublications = await database.query(
      "select id, source_version_id from public.team_workweek_publications where owner_profile_id = any($1::text[]) order by publication_revision desc",
      [ownerIds],
    );
    for (const publication of cleanupPublications.rows) {
      await database.query("delete from public.team_workweek_publications where id=$1", [publication.id]);
      await database.query("delete from public.team_workweek_versions where id=$1", [publication.source_version_id]);
    }
    await database.query("delete from public.team_workweek_versions where owner_profile_id = any($1::text[])", [ownerIds]);
    await database.query(
      "update public.profiles set auth_user_id=null, platform_role=case when id='sebastian' then 'founder' else platform_role end where id = any($1::text[])",
      [["sebastian", "local-viewer"]],
    );
    await database.end();
    for (const userId of temporaryUsers) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw new Error("Temporary workweek Auth user could not be removed.");
    }
  }
}

async function verifyPlatformReleaseAccessBoundary(status, mapped) {
  const { data: releases, error: readError } = await mapped
    .from("platform_releases")
    .select("version,summary,manifest")
    .limit(1);
  if (readError || !releases?.length) {
    throw new Error("Mapped local profile could not read the seeded Platform Release through RLS.");
  }

  const release = releases[0];
  const { data: updateData, error: updateError } = await mapped
    .from("platform_releases")
    .update({ summary: release.summary })
    .eq("version", release.version)
    .select("version");
  if (!updateError || updateError.code !== "42501" || updateData?.length) {
    throw new Error("Authenticated user unexpectedly mutated a Platform Release directly.");
  }

  const { data: deniedRpcData, error: deniedRpcError } = await mapped
    .rpc("ingest_platform_release_v1", { p_manifest: release.manifest });
  if (!deniedRpcError || deniedRpcError.code !== "42501" || deniedRpcData) {
    throw new Error("Authenticated user unexpectedly executed the Platform Release ingest RPC.");
  }

  const adminKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY;
  if (!adminKey) throw new Error("Local Supabase status did not expose an admin key.");
  const admin = createClient(status.API_URL, adminKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: replay, error: replayError } = await admin
    .rpc("ingest_platform_release_v1", { p_manifest: release.manifest });
  if (replayError || replay?.version !== release.version || replay?.replayed !== true) {
    throw new Error("Service role could not replay the seeded Platform Release through the ingest RPC.");
  }
}

async function verifyPlatformReleaseIngestModes(status) {
  const client = new pg.Client({ connectionString: status.DB_URL });
  const publishedAt = "2026-08-17T12:00:00.000Z";
  const base = {
    summary: "Lokaler Integrationstest für Release-Benachrichtigungen.",
    publishedAt,
    planDigest: "1".repeat(64),
    contentDigest: "2".repeat(64),
    components: [],
    changes: [],
    highlights: [],
    visuals: [],
  };
  const standard = { ...base, schemaVersion: 2, version: "v9.98.1", manifestDigest: "3".repeat(64) };
  const silent = {
    ...base,
    schemaVersion: 3,
    version: "v9.98.2",
    manifestDigest: "4".repeat(64),
    releaseMode: "application",
    notificationMode: "silent",
    source: { kind: "github-release-import", importedAt: publishedAt },
  };
  await client.connect();
  try {
    await client.query("begin");
    const profileCount = Number((await client.query("select count(*)::integer as count from public.profiles")).rows[0].count);
    const before = Number((await client.query("select count(*)::integer as count from public.notification_events")).rows[0].count);
    const standardResult = (await client.query("select public.ingest_platform_release_v1($1::jsonb) as result", [JSON.stringify(standard)])).rows[0].result;
    if (standardResult.replayed !== false) throw new Error("Manifest v2 was not accepted as a first ingest.");
    const afterStandard = Number((await client.query("select count(*)::integer as count from public.notification_events")).rows[0].count);
    if (afterStandard !== before + profileCount) throw new Error("Manifest v2 did not create exactly one notification per profile.");
    const standardReplay = (await client.query("select public.ingest_platform_release_v1($1::jsonb) as result", [JSON.stringify(standard)])).rows[0].result;
    if (standardReplay.replayed !== true) throw new Error("Manifest v2 replay was not idempotent.");
    const silentResult = (await client.query("select public.ingest_platform_release_v1($1::jsonb) as result", [JSON.stringify(silent)])).rows[0].result;
    if (silentResult.replayed !== false) throw new Error("Silent Manifest v3 was not accepted as a first ingest.");
    const afterSilent = Number((await client.query("select count(*)::integer as count from public.notification_events")).rows[0].count);
    if (afterSilent !== afterStandard) throw new Error("Silent Manifest v3 unexpectedly created notifications.");
    const silentReplay = (await client.query("select public.ingest_platform_release_v1($1::jsonb) as result", [JSON.stringify(silent)])).rows[0].result;
    if (silentReplay.replayed !== true) throw new Error("Silent Manifest v3 replay was not idempotent.");
    const stored = (await client.query(
      "select schema_version, manifest = $2::jsonb as exact from public.platform_releases where version = $1",
      [silent.version, JSON.stringify(silent)],
    )).rows[0];
    if (stored.schema_version !== 3 || stored.exact !== true) {
      throw new Error("Silent Manifest v3 was not stored exactly with schema version 3.");
    }
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}

async function verifyDirectProfileMutationDenied(supabase, userId) {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,role,platform_role,profile_color")
    .eq("auth_user_id", userId)
    .single();
  if (profileError || !profile) throw new Error("Mapped local profile could not be read through RLS.");

  const { data, error } = await supabase
    .from("profiles")
    .update({
      role: profile.role,
      platform_role: profile.platform_role,
      profile_color: profile.profile_color,
    })
    .eq("id", profile.id)
    .select("id");
  if (!error || error.code !== "42501" || data?.length) {
    throw new Error("Authenticated user unexpectedly mutated an authorization profile directly.");
  }
}

async function verifyPlanningApiGitHubSyncScope(sessionToken, taskId) {
  const issuedTokenIds = [];
  const issueToken = async (allowGitHubSync) => {
    const response = await apiRequest(
      "/api/team/planning-items/v2/tokens",
      sessionToken,
      "sebastian",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: allowGitHubSync ? "Local GitHub sync verification" : "Local default scope verification",
          allowGitHubSync,
        }),
      },
    );
    assertStatus(response, 200, `Planning API token issuance (${allowGitHubSync ? "enabled" : "disabled"})`);
    const body = await response.json();
    if (!body.token || !body.tokenRecord?.id || !Array.isArray(body.tokenRecord.scopes)) {
      throw new Error("Planning API token issuance returned an incomplete response.");
    }
    issuedTokenIds.push(body.tokenRecord.id);
    return body;
  };

  try {
    const defaultToken = await issueToken(false);
    if (defaultToken.tokenRecord.scopes.includes("write:planning-items:github-sync")) {
      throw new Error("New Planning API token unexpectedly received the GitHub sync scope by default.");
    }
    const deniedStartedAt = Date.now() - 1_000;
    const denied = await apiRequest(
      `/api/team/planning-items/v2/items/${taskId}/github-sync`,
      defaultToken.token,
      "",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          githubSyncMode: "async",
          createIfMissing: false,
        }),
      },
    );
    assertStatus(denied, 403, "Planning API GitHub sync without scope");
    const deniedBody = await denied.json();
    if (
      deniedBody.code !== "INSUFFICIENT_SCOPE"
      || deniedBody._meta?.operation !== "planningItems.githubSync"
      || deniedBody._meta?.mode !== "commit"
      || deniedBody._meta?.access?.decision !== "denied"
      || !deniedBody._meta?.access?.missingScopes?.includes("write:planning-items:github-sync")
      || !deniedBody._meta?.access?.token?.expiresAt
      || !Number.isInteger(deniedBody._meta?.access?.token?.remainingSeconds)
      || JSON.stringify(deniedBody).includes(defaultToken.token)
    ) {
      throw new Error("Planning API scope denial did not return the safe access receipt.");
    }
    const tokenList = await apiRequest(
      "/api/team/planning-items/v2/tokens",
      sessionToken,
      "sebastian",
    );
    assertStatus(tokenList, 200, "Planning API token usage receipt");
    const usedToken = (await tokenList.json()).tokens?.find(
      (token) => token.id === defaultToken.tokenRecord.id,
    );
    if (!usedToken?.lastUsedAt || Date.parse(usedToken.lastUsedAt) < deniedStartedAt) {
      throw new Error("Planning API scope denial did not update token usage metadata.");
    }

    const enabledToken = await issueToken(true);
    if (!enabledToken.tokenRecord.scopes.includes("write:planning-items:github-sync")) {
      throw new Error("Planning API token did not receive the explicitly requested GitHub sync scope.");
    }
    const ineligible = await apiRequest(
      `/api/team/planning-items/v2/items/${taskId}/github-sync`,
      enabledToken.token,
      "",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          githubSyncMode: "async",
          createIfMissing: false,
        }),
      },
    );
    assertStatus(ineligible, 409, "Planning API GitHub sync preflight");
    const ineligibleBody = await ineligible.json();
    if (
      ineligibleBody._meta?.access?.decision !== "allowed"
      || !ineligibleBody._meta?.access?.token?.grantedScopes?.includes("write:planning-items:github-sync")
    ) {
      throw new Error("Planning API authorized failure did not retain access metadata.");
    }
  } finally {
    for (const tokenId of issuedTokenIds.reverse()) {
      const response = await apiRequest(
        `/api/team/planning-items/v2/tokens/${tokenId}`,
        sessionToken,
        "sebastian",
        { method: "DELETE" },
      );
      assertStatus(response, 200, "Planning API verification token cleanup");
    }
  }
}

async function verifyEmptyEpicDeleteRoutes(sessionToken) {
  const createEpic = async (title) => {
    const response = await apiRequest("/api/tasks", sessionToken, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskType: "epic",
        creationRequestId: randomUUID(),
        title,
        description: "Local integration fixture",
        status: "Offen",
      }),
    });
    assertStatus(response, 200, `${title} creation`);
    const body = await response.json();
    if (!body.task?.id || !body.task?.updatedAt) throw new Error(`${title} creation returned an incomplete response.`);
    return body.task;
  };

  const browserEpic = await createEpic("Browser empty Epic delete verification");
  const founderDenied = await apiRequest(`/api/tasks/${browserEpic.id}`, sessionToken, "sebastian", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedUpdatedAt: browserEpic.updatedAt }),
  });
  assertStatus(founderDenied, 403, "Founder empty Epic deletion");
  const browserDelete = await apiRequest(`/api/tasks/${browserEpic.id}`, sessionToken, "", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedUpdatedAt: browserEpic.updatedAt }),
  });
  assertStatus(browserDelete, 200, "Browser empty Epic deletion");
  const browserBody = await browserDelete.json();
  if (browserBody.task?.id !== browserEpic.id) throw new Error("Browser empty Epic deletion changed its response shape.");

  const teamEpic = await createEpic("Team empty Epic delete verification");
  let tokenId = "";
  try {
    const issued = await apiRequest("/api/team/planning-items/v2/tokens", sessionToken, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Local empty Epic delete verification", allowEmptyEpicDeletes: true }),
    });
    assertStatus(issued, 200, "Empty Epic delete token issuance");
    const tokenBody = await issued.json();
    tokenId = String(tokenBody.tokenRecord?.id || "");
    if (!tokenBody.token || !tokenId || !tokenBody.tokenRecord?.scopes?.includes("write:planning-items:delete-empty")) {
      throw new Error("Empty Epic delete token issuance returned an incomplete response.");
    }
    const payload = JSON.stringify({ expectedUpdatedAt: teamEpic.updatedAt });
    const preview = await apiRequest(`/api/team/planning-items/v2/items/${teamEpic.id}/delete/preview`, tokenBody.token, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    assertStatus(preview, 200, "Team empty Epic deletion preview");
    const previewBody = await preview.json();
    if (!previewBody.valid || !previewBody.canDelete || previewBody.itemType !== "epic") {
      throw new Error("Team empty Epic deletion preview changed its response shape.");
    }

    const idempotencyKey = randomUUID();
    const commitRequest = {
      method: "DELETE",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: payload,
    };
    const committed = await apiRequest(`/api/team/planning-items/v2/items/${teamEpic.id}`, tokenBody.token, "", commitRequest);
    assertStatus(committed, 200, "Team empty Epic deletion");
    const committedBody = await committed.json();
    if (committedBody.replayed || committedBody.itemType !== "epic" || committedBody.item?.id !== teamEpic.id) {
      throw new Error("Team empty Epic deletion changed its response shape.");
    }
    const replayed = await apiRequest(`/api/team/planning-items/v2/items/${teamEpic.id}`, tokenBody.token, "", commitRequest);
    assertStatus(replayed, 200, "Team empty Epic deletion replay");
    const replayedBody = await replayed.json();
    if (!replayedBody.replayed || replayedBody.item?.id !== teamEpic.id) {
      throw new Error("Team empty Epic deletion replay was not stable.");
    }
  } finally {
    if (tokenId) {
      const revoked = await apiRequest(`/api/team/planning-items/v2/tokens/${tokenId}`, sessionToken, "", { method: "DELETE" });
      assertStatus(revoked, 200, "Empty Epic delete token cleanup");
    }
  }
}

async function verifyPlanningRelationshipRoutes(sessionToken, sourceTaskId, relatedTaskId) {
  const created = await apiRequest(`/api/tasks/${sourceTaskId}/relationships`, sessionToken, "", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ relationType: "blocked_by", relatedTaskId, note: "Local integration fixture" }),
  });
  assertStatus(created, 200, "Browser planning relationship creation");
  const createdBody = await created.json();
  if (
    !createdBody.ok
    || !Number.isInteger(createdBody.relation?.id)
    || createdBody.relation.taskId !== sourceTaskId
    || createdBody.relation.relatedTaskId !== relatedTaskId
    || createdBody.relation.relationType !== "blocked_by"
  ) {
    throw new Error("Browser planning relationship creation changed its response shape.");
  }

  const removed = await apiRequest(`/api/tasks/${sourceTaskId}/relationships`, sessionToken, "", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ relationId: createdBody.relation.id }),
  });
  assertStatus(removed, 200, "Browser planning relationship removal");
  const removedBody = await removed.json();
  if (!removedBody.ok || removedBody.relationId !== createdBody.relation.id) {
    throw new Error("Browser planning relationship removal changed its response shape.");
  }
}

async function verifyPlanningReviewRoutes(status, sessionToken, parentTaskId) {
  const taskId = `local-review-route-${randomUUID()}`;
  const client = new pg.Client({ connectionString: status.DB_URL });
  await client.connect();
  try {
    const inserted = await client.query(
      `with inserted as (
       insert into public.tasks (
         id, project_id, parent_task_id, title, task_type, status, priority,
         owner, assignee, approval_status, review_status, review_owner_profile_id,
         score_points, score_final, github_issue_sync_status
       ) values ($1, 'findmydoc-founder-execution', $2, 'Local review route verification', 'deliverable', 'In Arbeit', 'P2',
         'volkan', 'volkan', 'approved', 'not_requested', 'volkan', 0, false, 'synced')
       returning updated_at
       ) select to_jsonb(updated_at) #>> '{}' as updated_at from inserted`,
      [taskId, parentTaskId],
    );
    const expectedUpdatedAt = inserted.rows[0]?.updated_at;
    if (!expectedUpdatedAt) throw new Error("Planning review route fixture did not return a revision.");

    const requested = await apiRequest(`/api/tasks/${taskId}`, sessionToken, "", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt, status: "Review", reviewStatus: "requested" }),
    });
    if (requested.status !== 200) {
      throw new Error(`Browser planning review request: expected 200, received ${requested.status}: ${await requested.text()}`);
    }
    const requestedBody = await requested.json();
    if (requestedBody.task?.reviewStatus !== "requested" || requestedBody.task?.reviewOwnerProfileId !== "volkan") {
      throw new Error("Browser planning review request changed its response shape.");
    }

    const decided = await apiRequest(`/api/tasks/${taskId}/review`, sessionToken, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decision: "accepted",
        comment: "Local integration accepted",
        checklist: {
          acceptanceCriteriaMet: true,
          evidenceProvided: true,
          communicationClear: true,
          blockerHandled: true,
        },
      }),
    });
    assertStatus(decided, 200, "Browser planning review decision");
    const decidedBody = await decided.json();
    if (decidedBody.review?.decision !== "accepted" || decidedBody.task?.scoreFinal !== true || !decidedBody.task?.updatedAt) {
      throw new Error("Browser planning review decision changed its response shape.");
    }

    const reopened = await apiRequest(`/api/tasks/${taskId}/review/reopen`, sessionToken, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: decidedBody.task.updatedAt }),
    });
    assertStatus(reopened, 200, "Browser planning review reopen");
    const reopenedBody = await reopened.json();
    if (reopenedBody.task?.reviewStatus !== "requested" || reopenedBody.task?.scoreFinal !== false || !reopenedBody.task?.updatedAt) {
      throw new Error("Browser planning review reopen changed its response shape.");
    }

    const withdrawn = await apiRequest(`/api/tasks/${taskId}/review/withdraw`, sessionToken, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: reopenedBody.task.updatedAt, reason: "Local integration cleanup" }),
    });
    assertStatus(withdrawn, 200, "Browser planning review withdrawal");
    const withdrawnBody = await withdrawn.json();
    if (withdrawnBody.task?.reviewStatus !== "not_requested" || withdrawnBody.task?.status !== "In Arbeit") {
      throw new Error("Browser planning review withdrawal changed its response shape.");
    }
  } finally {
    await client.query("select set_config('founderops.trash_lifecycle_write', 'on', false)");
    await client.query("delete from public.notification_events where entity_id = $1", [taskId]);
    await client.query("delete from public.audit_log where entity_id = $1", [taskId]);
    await client.query("delete from public.task_reviews where task_id = $1", [taskId]);
    await client.query("delete from public.task_activity where task_id = $1", [taskId]);
    await client.query("delete from public.tasks where id = $1", [taskId]);
    await client.end();
  }
}

async function verifyPlanningApprovalRoutes(status, sessionToken) {
  const suffix = randomUUID();
  const epicId = `local-approval-epic-${suffix}`;
  const initiativeId = `local-approval-initiative-${suffix}`;
  const deliverableId = `local-approval-deliverable-${suffix}`;
  const client = new pg.Client({ connectionString: status.DB_URL });
  await client.connect();
  try {
    await client.query(
      `insert into public.tasks (id,project_id,parent_task_id,title,task_type,status,priority,owner,assignee,approval_status,approval_revision,review_status,score_final)
       values
         ($1,'findmydoc-founder-execution',null,'Local Approval Epic','epic','Offen','P2','volkan','volkan',null,1,'not_requested',false),
         ($2,'findmydoc-founder-execution',$1,'Local Approval Initiative','initiative','Offen','P2','volkan','volkan','proposed',1,'not_requested',false),
         ($3,'findmydoc-founder-execution',$2,'Local Approval Deliverable','deliverable','Offen','P2','volkan','volkan','proposed',1,'not_requested',false)`,
      [epicId, initiativeId, deliverableId],
    );
    await client.query(
      "insert into public.planning_item_raci_assignments (task_id,profile_id,role,sort_order) values ($1,'volkan','accountable',0),($1,'anil','responsible',1)",
      [initiativeId],
    );
    const initiative = await apiRequest(`/api/tasks/${initiativeId}/approval`, sessionToken, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", expectedRevision: 1, note: "" }),
    });
    assertStatus(initiative, 200, "Browser Initiative approval");
    const initiativeBody = await initiative.json();
    if (!initiativeBody.ok || initiativeBody.task?.approvalStatus !== "approved" || initiativeBody.lifecycle !== null) {
      throw new Error("Browser Initiative approval changed its response shape.");
    }
    const deliverable = await apiRequest(`/api/tasks/${deliverableId}/approval`, sessionToken, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", expectedRevision: 1, note: "" }),
    });
    assertStatus(deliverable, 200, "Browser Deliverable approval");
    const deliverableBody = await deliverable.json();
    if (!deliverableBody.ok || deliverableBody.task?.approvalStatus !== "approved" || !Object.hasOwn(deliverableBody, "lifecycle")) {
      throw new Error("Browser Deliverable approval changed its response shape.");
    }
  } finally {
    await client.query("select set_config('founderops.trash_lifecycle_write', 'on', false)");
    await client.query("delete from public.audit_log where entity_id = any($1::text[])", [[epicId, initiativeId, deliverableId]]);
    await client.query("delete from public.task_activity where task_id = any($1::text[])", [[epicId, initiativeId, deliverableId]]);
    await client.query("delete from public.planning_item_raci_assignments where task_id = $1", [initiativeId]);
    await client.query("delete from public.tasks where id = any($1::text[])", [[deliverableId, initiativeId, epicId]]);
    await client.end();
  }
}

async function verifyPlanningReparentRoutes(status, sessionToken) {
  const suffix = randomUUID();
  const ids = Object.fromEntries(["epicOne", "epicTwo", "initiativeOne", "initiativeTwo", "deliverableOne", "deliverableTwo", "subIssue", "teamDeliverable"]
    .map((key) => [key, `local-reparent-${key}-${suffix}`]));
  const client = new pg.Client({ connectionString: status.DB_URL });
  let tokenId = "";
  await client.connect();
  try {
    await client.query(
      `insert into public.tasks (id,project_id,parent_task_id,title,task_type,status,priority,owner,assignee,approval_status,approval_revision,review_status,score_final,github_issue_sync_status)
       values
         ($1,'findmydoc-founder-execution',null,'Reparent Epic One','epic','Offen','P2','volkan','volkan',null,1,'not_requested',false,'not_applicable'),
         ($2,'findmydoc-founder-execution',null,'Reparent Epic Two','epic','Offen','P2','volkan','volkan',null,1,'not_requested',false,'not_applicable'),
         ($3,'findmydoc-founder-execution',$1,'Reparent Initiative One','initiative','Offen','P2','volkan','volkan','approved',2,'not_requested',false,'not_applicable'),
         ($4,'findmydoc-founder-execution',$2,'Reparent Initiative Two','initiative','Offen','P2','volkan','volkan','approved',2,'not_requested',false,'not_applicable'),
         ($5,'findmydoc-founder-execution',$3,'Reparent Deliverable One','deliverable','In Arbeit','P2','volkan','volkan','approved',2,'not_requested',false,'synced'),
         ($6,'findmydoc-founder-execution',$4,'Reparent Deliverable Two','deliverable','In Arbeit','P2','volkan','volkan','approved',2,'not_requested',false,'synced'),
         ($7,'findmydoc-founder-execution',$5,'Reparent Sub-Issue','sub_issue','Offen','P2','volkan','volkan',null,1,'not_requested',false,'synced'),
         ($8,'findmydoc-founder-execution',$3,'Team Reparent Deliverable','deliverable','In Arbeit','P2','volkan','volkan','approved',2,'not_requested',false,'synced')
       returning id,updated_at::text as updated_at`,
      [ids.epicOne, ids.epicTwo, ids.initiativeOne, ids.initiativeTwo, ids.deliverableOne, ids.deliverableTwo, ids.subIssue, ids.teamDeliverable],
    );
    await client.query(
      `insert into public.planning_item_raci_assignments (task_id,profile_id,role,sort_order)
       values ($1,'volkan','accountable',0),($1,'anil','responsible',0),($2,'volkan','accountable',0),($2,'anil','responsible',0)`,
      [ids.initiativeOne, ids.initiativeTwo],
    );

    const initiativeRevision = (await client.query("select updated_at::text as revision from public.tasks where id = $1", [ids.initiativeOne])).rows[0]?.revision;
    const initiative = await apiRequest(`/api/tasks/${ids.initiativeOne}`, sessionToken, "", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedUpdatedAt: initiativeRevision, parentTaskId: ids.epicTwo }),
    });
    assertStatus(initiative, 200, "Browser Initiative reparent");
    const initiativeBody = await initiative.json();
    if (!initiativeBody.ok || initiativeBody.task?.parentTaskId !== ids.epicTwo || initiativeBody.task?.approvalStatus !== "proposed") {
      throw new Error("Browser Initiative reparent changed its response shape.");
    }
    const deliverableRevision = (await client.query("select updated_at::text as revision from public.tasks where id = $1", [ids.deliverableOne])).rows[0]?.revision;

    const founderDenied = await apiRequest(`/api/tasks/${ids.deliverableOne}`, sessionToken, "sebastian", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: deliverableRevision, parentTaskId: ids.initiativeTwo }),
    });
    assertStatus(founderDenied, 403, "Founder Deliverable reparent");
    const deliverable = await apiRequest(`/api/tasks/${ids.deliverableOne}`, sessionToken, "", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: deliverableRevision, parentTaskId: ids.initiativeTwo }),
    });
    assertStatus(deliverable, 200, "Browser Deliverable reparent");
    const deliverableBody = await deliverable.json();
    if (deliverableBody.task?.parentTaskId !== ids.initiativeTwo || deliverableBody.task?.approvalStatus !== "proposed" || deliverableBody.task?.githubIssueSyncStatus !== "not_synced") {
      throw new Error("Browser Deliverable reparent changed its response shape.");
    }
    const subIssueRevision = (await client.query("select updated_at::text as revision from public.tasks where id = $1", [ids.subIssue])).rows[0]?.revision;
    const subIssue = await apiRequest(`/api/tasks/${ids.subIssue}`, sessionToken, "", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: subIssueRevision, parentTaskId: ids.deliverableTwo }),
    });
    assertStatus(subIssue, 200, "Browser Sub-Issue reparent");
    const subIssueBody = await subIssue.json();
    if (subIssueBody.task?.parentTaskId !== ids.deliverableTwo || subIssueBody.task?.githubIssueSyncStatus !== "not_synced") {
      throw new Error("Browser Sub-Issue reparent changed its response shape.");
    }

    const issued = await apiRequest("/api/team/planning-items/v2/tokens", sessionToken, "", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: "Local reparent verification", allowUpdates: true }),
    });
    assertStatus(issued, 200, "Reparent token issuance");
    const tokenBody = await issued.json();
    tokenId = String(tokenBody.tokenRecord?.id || "");
    if (!tokenBody.token || !tokenId || !tokenBody.tokenRecord?.scopes?.includes("write:planning-items:update")) {
      throw new Error("Reparent token issuance returned an incomplete response.");
    }
    const teamDeliverableRevision = (await client.query("select updated_at::text as revision from public.tasks where id = $1", [ids.teamDeliverable])).rows[0]?.revision;
    const idempotencyKey = randomUUID();
    const teamRequest = {
      method: "PATCH",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({ expectedUpdatedAt: teamDeliverableRevision, parentTaskId: ids.initiativeTwo }),
    };
    const team = await apiRequest(`/api/team/planning-items/v2/items/${ids.teamDeliverable}`, tokenBody.token, "", teamRequest);
    if (team.status !== 200) throw new Error(`Team Deliverable reparent: expected 200, received ${team.status}: ${await team.text()}`);
    const teamBody = await team.json();
    if (teamBody.replayed || teamBody.item?.parentTaskId !== ids.initiativeTwo || !teamBody.changedFields?.includes("parentTaskId")) {
      throw new Error("Team Deliverable reparent changed its response shape.");
    }
    const replay = await apiRequest(`/api/team/planning-items/v2/items/${ids.teamDeliverable}`, tokenBody.token, "", teamRequest);
    assertStatus(replay, 200, "Team Deliverable reparent replay");
    const replayBody = await replay.json();
    if (!replayBody.replayed || replayBody.item?.parentTaskId !== ids.initiativeTwo) {
      throw new Error("Team Deliverable reparent replay was not stable.");
    }
  } finally {
    if (tokenId) {
      const revoked = await apiRequest(`/api/team/planning-items/v2/tokens/${tokenId}`, sessionToken, "", { method: "DELETE" });
      assertStatus(revoked, 200, "Reparent token cleanup");
    }
    await client.query("select set_config('founderops.trash_lifecycle_write', 'on', false)");
    await client.query("delete from public.team_planning_item_update_requests where item_id = any($1::text[])", [Object.values(ids)]);
    await client.query("delete from public.audit_log where entity_id = any($1::text[])", [Object.values(ids)]);
    await client.query("delete from public.planning_item_raci_assignments where task_id = any($1::text[])", [Object.values(ids)]);
    await client.query("delete from public.tasks where id = any($1::text[])", [Object.values(ids).reverse()]);
    await client.end();
  }
}

async function main() {
  localStatus();
  execFileSync(process.execPath, [localDevelopmentScript, "seed"], { cwd: root, stdio: "inherit" });
  const status = localStatus();
  const source = JSON.parse(readFileSync(seedSourcePath, "utf8"));
  await verifySeedConvergence(status, source);
  await verifyCanonicalPlanningPreferences(status);
  await verifyGitHubWebhookDeliveryJournal(status, source);
  execFileSync(process.execPath, [resolve(root, "scripts/verify-backlog-bulk-sprint-assignment.mjs")], { cwd: root, stdio: "inherit" });
  execFileSync(process.execPath, [resolve(root, "scripts/verify-backlog-move-transaction.mjs")], { cwd: root, stdio: "inherit" });
  execFileSync(process.execPath, [resolve(root, "scripts/verify-planning-relationship-transaction.mjs")], { cwd: root, stdio: "inherit" });
  execFileSync(process.execPath, [resolve(root, "scripts/verify-planning-schema.mjs"), "--local"], { cwd: root, stdio: "inherit" });
  await verifyGitHubProjectRoleBoundary(status, source);
  await verifyUnmappedAuthReadBoundary(status);
  const localEnv = parseEnvFile(readFileSync(resolve(root, ".env.local"), "utf8"));
  const app = spawn(nextCli, ["dev", "--hostname", "127.0.0.1", "--port", "3012"], {
    cwd: root,
    env: { ...process.env, ...localEnv, APP_URL: appOrigin },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  app.stdout.on("data", (chunk) => { serverOutput = `${serverOutput}${chunk}`.slice(-8000); });
  app.stderr.on("data", (chunk) => { serverOutput = `${serverOutput}${chunk}`.slice(-8000); });

  const supabase = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
  try {
    await waitForServer(app);

    const unauthenticated = await apiRequest("/api/planning-board-data", "", "");
    assertStatus(unauthenticated, 401, "Unauthenticated planning data");
    const unauthenticatedRevision = await apiRequest("/api/planning-revision", "", "");
    assertStatus(unauthenticatedRevision, 401, "Unauthenticated planning revision");

    const localLogin = await fetch(`${appOrigin}/api/auth/local-login`, { method: "POST" });
    assertStatus(localLogin, 200, "Simulated local login");
    if (!localLogin.headers.get("set-cookie")) throw new Error("Simulated local login did not create Supabase session cookies.");

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: localEnv.LOCAL_LOGIN_EMAIL,
      password: localEnv.LOCAL_LOGIN_PASSWORD,
    });
    if (signInError || !signInData.session) throw new Error("Seeded local Auth user could not sign in.");
    const token = signInData.session.access_token;
    await verifyDirectProfileMutationDenied(supabase, signInData.user.id);
    await verifyPlatformReleaseAccessBoundary(status, supabase);
    await verifyPrivateTeamWorkweekAccessBoundary(status, supabase);
    await verifyPlatformReleaseIngestModes(status);
    await verifyPlanningApiGitHubSyncScope(token, source.tasks[0].id);
    await verifyEmptyEpicDeleteRoutes(token);
    await verifyPlanningRelationshipRoutes(token, source.tasks[0].id, source.tasks[1].id);
    await verifyPlanningReviewRoutes(status, token, source.initiatives[0].id);
    await verifyPlanningApprovalRoutes(status, token);
    await verifyPlanningReparentRoutes(status, token);

    const expectedProfiles = [
      ["", "ceo"],
      ["sebastian", "founder"],
      ["local-deputy", "deputy"],
      ["local-viewer", "viewer"],
    ];

    const unauthenticatedWorkweekRead = await apiRequest("/api/team-workweek/private-draft", "", "");
    assertStatus(unauthenticatedWorkweekRead, 401, "Unauthenticated private workweek read");
    const unauthenticatedWorkweekWrite = await apiRequest("/api/team-workweek/private-draft", "", "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assertStatus(unauthenticatedWorkweekWrite, 401, "Unauthenticated private workweek write");

    const workweekPayload = {
      effectiveFrom: nextBerlinMondayIso(),
      windows: {
        monday: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }],
        tuesday: [],
        wednesday: [{ start: "10:00", end: "15:00" }],
        thursday: [],
        friday: [],
        saturday: [],
        sunday: [],
      },
    };
    const workweekCreate = await apiRequest("/api/team-workweek/private-draft", token, "sebastian", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(workweekPayload),
    });
    assertStatus(workweekCreate, 201, "Session-owned private workweek write");
    const workweekCreateBody = await workweekCreate.json();
    const { data: sessionOwnedVersions, error: sessionOwnedError } = await supabase
      .from("team_workweek_versions")
      .select("id,owner_profile_id")
      .eq("id", workweekCreateBody.version?.id);
    if (sessionOwnedError || sessionOwnedVersions?.length !== 1 || sessionOwnedVersions[0].owner_profile_id !== "volkan") {
      throw new Error("Private workweek owner was not derived from the authenticated session.");
    }
    const workweekRead = await apiRequest("/api/team-workweek/private-draft", token, "");
    assertStatus(workweekRead, 200, "Owner private workweek read");
    const workweekReadBody = await workweekRead.json();
    if (workweekReadBody.version?.id !== workweekCreateBody.version?.id
      || workweekReadBody.version?.windows?.monday?.length !== 2) {
      throw new Error("Private workweek API did not return the latest owner version.");
    }
    const injectedOwnerWorkweek = await apiRequest("/api/team-workweek/private-draft", token, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...workweekPayload, profileId: "sebastian" }),
    });
    assertStatus(injectedOwnerWorkweek, 400, "Private workweek owner injection");
    const malformedWorkweek = await apiRequest("/api/team-workweek/private-draft", token, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...workweekPayload,
        windows: { ...workweekPayload.windows, monday: [{ start: "09:00" }] },
      }),
    });
    assertStatus(malformedWorkweek, 400, "Malformed private workweek input");
    const viewerWorkweek = await apiRequest("/api/team-workweek/private-draft", token, "local-viewer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(workweekPayload),
    });
    assertStatus(viewerWorkweek, 403, "Viewer private workweek write authorization");

    for (const [profileId, role] of expectedProfiles) {
      const response = await apiRequest("/api/planning-board-data", token, profileId);
      assertStatus(response, 200, `${role} planning data`);
      const body = await response.json();
      if (body.currentProfile?.platformRole !== role) throw new Error(`${role} profile override was not applied.`);
      const expectedPlanningItems = source.epics.length + source.initiatives.length + source.tasks.length;
      if (body.model?.items?.length !== expectedPlanningItems) throw new Error(`${role} did not receive the complete DB seed.`);
    }

    const supportingWorkspaceEndpoints = [
      "/api/events-data",
      "/api/tools-data",
      "/api/team-data",
      "/api/profile-data",
      "/api/notifications-data",
      "/api/sprint-data",
    ];
    for (const endpoint of supportingWorkspaceEndpoints) {
      for (const [profileId, role] of expectedProfiles) {
        const response = await apiRequest(endpoint, token, profileId);
        assertStatus(response, 200, `${role} ${endpoint}`);
        const body = await response.json();
        if (!body.model || body.currentProfile?.platformRole !== role) {
          throw new Error(`${role} did not receive the focused ${endpoint} model.`);
        }
      }
    }

    for (const profileId of ["sebastian", "local-viewer"]) {
      const response = await apiRequest("/api/tasks", token, profileId, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskType: "epic", creationRequestId: randomUUID() }),
      });
      assertStatus(response, 403, `${profileId} Epic authorization`);
    }
    for (const profileId of ["", "local-deputy"]) {
      const response = await apiRequest("/api/tasks", token, profileId, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskType: "epic", creationRequestId: randomUUID() }),
      });
      assertStatus(response, 400, `${profileId || "ceo"} Epic validation`);
    }

    for (const profileId of ["sebastian", "local-viewer"]) {
      const response = await apiRequest("/api/tasks/bulk-sprint-assignment", token, profileId, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assertStatus(response, 403, `${profileId} bulk Sprint assignment authorization`);
    }
    for (const profileId of ["", "local-deputy"]) {
      const response = await apiRequest("/api/tasks/bulk-sprint-assignment", token, profileId, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assertStatus(response, 400, `${profileId || "ceo"} bulk Sprint assignment validation`);
    }

    const viewerToolWrite = await apiRequest("/api/tools", token, "local-viewer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assertStatus(viewerToolWrite, 403, "Viewer tool write authorization");

    const founderToolWrite = await apiRequest("/api/tools", token, "sebastian", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assertStatus(founderToolWrite, 400, "Founder tool write validation");

    const deputyGitHubProject = await apiRequest("/api/founderops-settings/github-project", token, "local-deputy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedGithubProjectOwner: source.project.githubProjectOwner,
        expectedGithubProjectNumber: source.project.githubProjectNumber,
        githubProjectOwner: source.project.githubProjectOwner,
        githubProjectNumber: source.project.githubProjectNumber,
      }),
    });
    assertStatus(deputyGitHubProject, 403, "Deputy global GitHub Project authorization");

    const localGitHubProject = await apiRequest("/api/founderops-settings/github-project", token, "", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedGithubProjectOwner: source.project.githubProjectOwner,
        expectedGithubProjectNumber: source.project.githubProjectNumber,
        githubProjectOwner: source.project.githubProjectOwner,
        githubProjectNumber: source.project.githubProjectNumber,
      }),
    });
    assertStatus(localGitHubProject, 409, "Local external GitHub Project configuration");

    await supabase.auth.signOut({ scope: "global" });
    console.log("Local DB, Auth, session cookies, API guards, and role overrides verified.");
  } catch (error) {
    if (serverOutput.trim()) console.error(serverOutput.replace(/(eyJ[a-zA-Z0-9._-]+)/g, "[redacted-token]"));
    throw error;
  } finally {
    app.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Local integration verification failed.");
  process.exit(1);
});
