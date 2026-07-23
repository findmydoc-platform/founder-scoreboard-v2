import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const root = resolve(import.meta.dirname, "..");
const supabaseCli = resolve(root, "node_modules/.bin/supabase");
const nextCli = resolve(root, "node_modules/.bin/next");
const localEnvPath = resolve(root, ".env.local");
const seedSourcePath = resolve(root, "src/lib/seed/source.json");
const localLoginEmail = "local-ceo@findmydoc.local";
const localProjectId = "findmydoc-founder-execution";

function isLoopbackHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function assertLocalUrl(value, expectedPort, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
  if (!isLoopbackHostname(url.hostname) || url.port !== expectedPort) {
    throw new Error(`${label} must target a loopback host on port ${expectedPort}.`);
  }
  return url;
}

function runCli(args, options = {}) {
  try {
    return execFileSync(supabaseCli, args, {
      cwd: root,
      encoding: "utf8",
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const message = error?.stderr?.toString().trim() || error?.message || "Supabase command failed.";
    throw new Error(message.replace(/(SERVICE_ROLE_KEY|SECRET_KEY|ANON_KEY)=[^\s]+/g, "$1=[redacted]"));
  }
}

function startStack() {
  runCli(["start", "--yes"]);
  console.log("Local Supabase stack is ready.");
}

function stopStack() {
  runCli(["stop", "--yes"]);
  console.log("Local Supabase stack is stopped.");
}

function readStatus() {
  const status = JSON.parse(runCli(["status", "-o", "json"]));
  assertLocalUrl(status.API_URL, "54321", "Local Supabase API URL");
  assertLocalUrl(status.DB_URL, "54322", "Local Supabase database URL");
  if (!status.ANON_KEY || !status.SERVICE_ROLE_KEY) throw new Error("Local Supabase keys are unavailable.");
  return status;
}

function parseEnvFile(content) {
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function updateEnvFile(updates) {
  let content = "";
  try {
    content = readFileSync(localEnvPath, "utf8");
  } catch {
    // The local environment file is created on first setup.
  }
  const managedKeys = Object.keys(updates);
  const retainedLines = content
    .split(/\r?\n/)
    .filter((line) => !managedKeys.some((key) => line.startsWith(`${key}=`)))
    .filter((line) => line !== "# Managed by pnpm local:start/local:seed")
    .filter((line, index, lines) => line || index < lines.length - 1);
  const separator = retainedLines.length && retainedLines.at(-1) !== "" ? [""] : [];
  const managedLines = managedKeys.map((key) => `${key}=${updates[key]}`);
  writeFileSync(localEnvPath, [...retainedLines, ...separator, "# Managed by pnpm local:start/local:seed", ...managedLines, ""].join("\n"), { mode: 0o600 });
  return { ...parseEnvFile(content), ...updates };
}

function syncLocalEnv(status) {
  let current = {};
  try {
    current = parseEnvFile(readFileSync(localEnvPath, "utf8"));
  } catch {
    // Created below.
  }
  return updateEnvFile({
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    REQUIRE_SUPABASE_AUTH: "true",
    ENABLE_LOCAL_LOGIN: "true",
    NEXT_PUBLIC_ENABLE_LOCAL_LOGIN: "true",
    LOCAL_LOGIN_EMAIL: localLoginEmail,
    LOCAL_LOGIN_PASSWORD: current.LOCAL_LOGIN_PASSWORD || randomBytes(24).toString("base64url"),
    APP_URL: "http://localhost:3000",
  });
}

function nullable(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function materializeTasks(source) {
  return source.tasks.map((task) => {
    const assigneeId = task.assigneeId;
    const ownerId = task.ownerId || assigneeId;
    return {
      ...source.taskDefaults,
      ...task,
      ownerId,
      assigneeId,
      approvalStatus: task.taskType === "sub_issue" ? null : task.approvalStatus || "approved",
      approvalRevision: task.approvalRevision || 1,
    };
  });
}

function quoteIdentifier(identifier) {
  if (!/^[a-z_]+$/.test(identifier)) throw new Error(`Unsafe SQL identifier: ${identifier}`);
  return `"${identifier}"`;
}

async function upsertRows(client, table, columns, rows, conflictColumn = "id") {
  if (!rows.length) return;
  const values = [];
  const tuples = rows.map((row) => `(${columns.map((column) => {
    values.push(row[column]);
    return `$${values.length}`;
  }).join(",")})`);
  const assignments = columns
    .filter((column) => column !== conflictColumn)
    .map((column) => `${quoteIdentifier(column)}=excluded.${quoteIdentifier(column)}`)
    .join(",");
  await client.query(
    `insert into ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(",")}) values ${tuples.join(",")} on conflict (${quoteIdentifier(conflictColumn)}) do update set ${assignments}`,
    values,
  );
}

async function seedPlanningData(status) {
  const source = JSON.parse(readFileSync(seedSourcePath, "utf8"));
  if (source.project.id !== localProjectId) {
    throw new Error(`Local seed project must remain ${localProjectId}.`);
  }
  const tasks = materializeTasks(source);
  const client = new pg.Client({ connectionString: status.DB_URL });
  await client.connect();
  try {
    await client.query("begin");
    // This runner is loopback-guarded. Replacing its one project makes local:seed
    // converge to source.json instead of preserving stale local planning rows.
    await client.query("select set_config('founderops.trash_lifecycle_write', 'on', true)");
    await client.query("delete from projects where id=$1", [localProjectId]);
    await client.query("select set_config('founderops.trash_lifecycle_write', 'off', true)");
    await client.query("delete from profiles where not (id = any($1::text[]))", [source.profiles.map((profile) => profile.id)]);
    await client.query("delete from fmd_tools where not (id = any($1::text[]))", [source.fmdTools.map((tool) => tool.id)]);
    await upsertRows(client, "projects", [
      "id",
      "name",
      "range_label",
      "review_objection_window_hours",
      "github_project_owner",
      "github_project_number",
    ], [{
      id: source.project.id,
      name: source.project.name,
      range_label: source.project.range,
      review_objection_window_hours: source.project.reviewObjectionWindowHours || 48,
      github_project_owner: source.project.githubProjectOwner,
      github_project_number: source.project.githubProjectNumber,
    }]);
    await upsertRows(client, "profiles", [
      "id",
      "name",
      "role",
      "platform_role",
      "org_role",
      "github_login",
      "deputy_for",
      "deputy_active_from",
      "deputy_active_until",
      "focus",
      "weekly_capacity",
      "profile_color",
    ], source.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      role: profile.role,
      platform_role: profile.platformRole,
      org_role: nullable(profile.orgRole),
      github_login: nullable(profile.githubLogin),
      deputy_for: nullable(profile.deputyFor),
      deputy_active_from: nullable(profile.deputyActiveFrom),
      deputy_active_until: nullable(profile.deputyActiveUntil),
      focus: nullable(profile.focus),
      weekly_capacity: profile.weeklyCapacity,
      profile_color: profile.color || "#64748b",
    })));
    await upsertRows(client, "sprints", ["id", "project_id", "name", "status", "start_date", "end_date", "review_due_at", "score_locked"], source.sprints.map((sprint) => ({
      id: sprint.id,
      project_id: source.project.id,
      name: sprint.name,
      status: sprint.status,
      start_date: nullable(sprint.startDate),
      end_date: nullable(sprint.endDate),
      review_due_at: nullable(sprint.reviewDueAt),
      score_locked: Boolean(sprint.scoreLocked),
    })));
    await upsertRows(client, "fmd_tools", ["id", "name", "category", "kind", "description", "url", "owner", "status", "is_curated", "preview_image_url", "preview_image_source", "sort_order"], source.fmdTools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      category: tool.category,
      kind: tool.kind,
      description: tool.description || "",
      url: nullable(tool.url),
      owner: nullable(tool.owner),
      status: tool.status,
      is_curated: Boolean(tool.isCurated),
      preview_image_url: nullable(tool.previewImageUrl),
      preview_image_source: tool.previewImageSource || "none",
      sort_order: tool.sortOrder || 0,
    })));
    await upsertRows(client, "packages", ["id", "project_id", "milestone_id", "owner_id", "accountable_profile_id", "responsible_profile_ids", "consulted_profile_ids", "informed_profile_ids", "title", "goal", "priority", "status", "target_date", "success_criteria", "scope_constraints", "sort_order", "approval_status", "approval_revision"], source.packages.map((item) => ({
      id: item.id,
      project_id: source.project.id,
      milestone_id: nullable(item.milestoneId),
      owner_id: nullable(item.ownerId),
      accountable_profile_id: nullable(item.accountableProfileId),
      responsible_profile_ids: item.responsibleProfileIds || [],
      consulted_profile_ids: item.consultedProfileIds || [],
      informed_profile_ids: item.informedProfileIds || [],
      title: item.title,
      goal: nullable(item.goal),
      priority: nullable(item.priority),
      status: item.status || "planned",
      target_date: nullable(item.targetDate),
      success_criteria: item.successCriteria || "",
      scope_constraints: item.scopeConstraints || "",
      sort_order: item.sortOrder || 0,
      approval_status: item.approvalStatus || "approved",
      approval_revision: item.approvalRevision || 1,
    })));
    const taskRows = tasks.map((task) => ({
      id: task.id,
      project_id: source.project.id,
      package_id: nullable(task.packageId),
      title: task.title,
      description: nullable(task.description),
      status: task.status,
      priority: task.priority,
      owner: nullable(task.ownerId),
      assignee: nullable(task.assigneeId),
      created_by: nullable(task.createdById),
      workstream: nullable(task.workstream),
      sort_order: task.order,
      start_date: nullable(task.startDate),
      end_date: nullable(task.endDate),
      deadline: nullable(task.deadline),
      estimate_hours: task.hours || null,
      definition_of_done: nullable(task.definitionOfDone),
      evidence_link: nullable(task.evidenceLink),
      issue_number: nullable(task.issueNumber),
      issue_url: nullable(task.issueUrl),
      watched: Boolean(task.watched),
      sprint_id: nullable(task.sprintId),
      review_status: task.reviewStatus,
      score_points: task.scorePoints,
      score_final: Boolean(task.scoreFinal),
      github_repo: nullable(task.githubRepo),
      github_issue_number: task.githubIssueNumber || null,
      github_issue_url: nullable(task.githubIssueUrl),
      github_issue_sync_status: task.githubIssueSyncStatus,
      github_issue_last_synced_at: nullable(task.githubIssueLastSyncedAt),
      github_issue_sync_error: nullable(task.githubIssueSyncError),
      task_type: task.taskType,
      parent_task_id: nullable(task.parentTaskId),
      score_relevant: Boolean(task.scoreRelevant),
      milestone_id: nullable(task.milestoneId),
      review_owner_profile_id: nullable(task.reviewOwnerProfileId),
      review_requested_at: nullable(task.reviewRequestedAt),
      problem_statement: nullable(task.problemStatement),
      intended_outcome: nullable(task.intendedOutcome),
      scope_constraints: nullable(task.scopeConstraints),
      acceptance_criteria: nullable(task.acceptanceCriteria),
      evidence_required: nullable(task.evidenceRequired),
      dod_template_version: task.dodTemplateVersion || "founder-deliverable-v2",
      original_sprint_id: nullable(task.originalSprintId),
      carried_from_task_id: nullable(task.carriedFromTaskId),
      carried_from_sprint_id: nullable(task.carriedFromSprintId),
      carryover_reason: nullable(task.carryoverReason),
      carryover_count: task.carryoverCount || 0,
      sprint_outcome: nullable(task.sprintOutcome),
      self_dod_checked: Boolean(task.selfDodChecked),
      self_evidence_checked: Boolean(task.selfEvidenceChecked),
      self_documented_checked: Boolean(task.selfDocumentedChecked),
      self_blockers_checked: Boolean(task.selfBlockersChecked),
      approval_status: task.approvalStatus,
      approval_revision: task.approvalRevision || 1,
    }));
    const taskColumns = Object.keys(taskRows[0]);
    const parentFirst = taskRows.sort((left, right) => Number(Boolean(left.parent_task_id)) - Number(Boolean(right.parent_task_id)));
    for (const row of parentFirst) await upsertRows(client, "tasks", taskColumns, [row]);
    await upsertRows(client, "task_notes", ["task_id", "note"], tasks.map((task) => ({ task_id: task.id, note: task.note || "" })), "task_id");
    const taskIds = tasks.map((task) => task.id);
    await client.query("delete from task_dependencies where task_id = any($1::text[])", [taskIds]);
    for (const task of tasks.filter((item) => nullable(item.dependsOn))) {
      await client.query("insert into task_dependencies (task_id,note) values ($1,$2)", [task.id, task.dependsOn.trim()]);
    }
    for (const meeting of source.meetings) {
      const existingMeeting = await client.query(
        "select id from meetings where sprint_id=$1 and title=$2 order by id limit 1",
        [meeting.sprintId, meeting.title],
      );
      const values = [
        meeting.sprintId,
        meeting.title,
        meeting.meetingAt,
        meeting.durationMinutes || 60,
        meeting.status,
        nullable(meeting.agenda),
      ];
      if (existingMeeting.rowCount) {
        await client.query(
          "update meetings set sprint_id=$1,title=$2,meeting_at=$3,duration_minutes=$4,status=$5,agenda=$6 where id=$7",
          [...values, existingMeeting.rows[0].id],
        );
      } else {
        await client.query(
          "insert into meetings (sprint_id,title,meeting_at,duration_minutes,status,agenda) values ($1,$2,$3,$4,$5,$6)",
          values,
        );
      }
    }
    await client.query("commit");
    console.log(`Seeded local planning data: ${source.profiles.length} profiles, ${source.packages.length} initiatives, ${tasks.length} tasks.`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

async function seedLocalAuth(status, env) {
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  let page = 1;
  let user = null;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error("Local Auth users could not be inspected.");
    user = data.users.find((candidate) => candidate.email === env.LOCAL_LOGIN_EMAIL) || null;
    if (user || data.users.length < 100) break;
    page += 1;
  }
  const attributes = {
    email: env.LOCAL_LOGIN_EMAIL,
    password: env.LOCAL_LOGIN_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "Volkan", name: "Volkan" },
    app_metadata: { local_development: true },
  };
  if (user) {
    const { data, error } = await admin.auth.admin.updateUserById(user.id, attributes);
    if (error || !data.user) throw new Error("Local Auth user could not be updated.");
    user = data.user;
  } else {
    const { data, error } = await admin.auth.admin.createUser(attributes);
    if (error || !data.user) throw new Error("Local Auth user could not be created.");
    user = data.user;
  }

  const client = new pg.Client({ connectionString: status.DB_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("update profiles set auth_user_id=null where auth_user_id=$1 and id<>$2", [user.id, "volkan"]);
    const result = await client.query("update profiles set auth_user_id=$1 where id=$2 returning id", [user.id, "volkan"]);
    if (result.rowCount !== 1) throw new Error("CEO seed profile is missing.");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
  console.log("Seeded local Supabase Auth identity for the CEO profile.");
}

async function seed() {
  const status = readStatus();
  const env = syncLocalEnv(status);
  await seedPlanningData(status);
  await seedLocalAuth(status, env);
}

function dev() {
  const status = readStatus();
  const env = syncLocalEnv(status);
  const result = spawnSync(nextCli, ["dev", "--hostname", "127.0.0.1"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  process.exit(result.status ?? 1);
}

async function main() {
  const command = process.argv[2];
  if (command === "start") {
    startStack();
    syncLocalEnv(readStatus());
    return;
  }
  if (command === "stop") {
    stopStack();
    return;
  }
  if (command === "seed") {
    await seed();
    return;
  }
  if (command === "reset") {
    startStack();
    runCli(["db", "reset", "--local", "--no-seed"], { inherit: true });
    await seed();
    return;
  }
  if (command === "dev") {
    dev();
    return;
  }
  throw new Error("Usage: node scripts/local-development.mjs <start|reset|seed|dev|stop>");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Local development command failed.");
  process.exit(1);
});
