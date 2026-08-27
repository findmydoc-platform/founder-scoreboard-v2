import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
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

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJsonValue(value[key])]));
}

function localPlatformReleaseManifest(version, publishedAt, summary, titles) {
  const changes = titles.map((title, index) => ({
    id: `${version.replaceAll(".", "-")}-change-${index + 1}`,
    kind: index === titles.length - 1 ? "fix" : "feature",
    pullRequests: [{ repository: index % 2 ? "findmydoc-platform/clinic-dashboard" : "findmydoc-platform/website", number: 1842 - index }],
    section: index % 2 ? "dashboard" : "public",
    summary: [
      "Relevanz, Verfügbarkeit und Bewertungen werden jetzt verständlicher zusammengeführt.",
      "Die Suche versteht Tippfehler und Synonyme und liefert dadurch schneller passende Ergebnisse.",
      "Entfernung und Sprechzeiten lassen sich einfacher und genauer auswählen.",
      "Die Berechnung zeigt kürzere Wege zuverlässiger an.",
      "Ergebnislisten bleiben auch bei vielen Treffern übersichtlich.",
      "Mehrere seltene Darstellungsfehler wurden behoben.",
    ][index] || "Diese Änderung verbessert Stabilität und Verständlichkeit.",
    title,
    visualUrls: [],
  }));
  const component = (key, displayName, repository, productionUrl) => ({
    key,
    displayName,
    productionUrl,
    repository,
    targetSha: key === "website" ? "a1b2c3d" : "d4e5f6a",
    release: { url: `https://github.com/${repository}/releases/tag/${version}` },
    deploymentRun: { url: `https://github.com/${repository}/actions/runs/2387` },
    commits: [{ bump: "patch", message: `Release ${version}`, sha: key === "website" ? "a1b2c3d" : "d4e5f6a", url: `https://github.com/${repository}/commit/${key === "website" ? "a1b2c3d" : "d4e5f6a"}` }],
    pullRequests: changes.filter((change) => change.pullRequests[0].repository === repository).slice(0, 3).map((change) => ({
      number: change.pullRequests[0].number,
      repository,
      title: change.title,
      url: `https://github.com/${repository}/pull/${change.pullRequests[0].number}`,
      commitShas: [key === "website" ? "a1b2c3d" : "d4e5f6a"],
      issues: [{ number: 214 + changes.indexOf(change), repository: "findmydoc-platform/management", title: change.title, url: `https://github.com/findmydoc-platform/management/issues/${214 + changes.indexOf(change)}` }],
    })),
  });
  const planDigest = createHash("sha256").update(`plan:${version}`).digest("hex");
  const contentDigest = createHash("sha256").update(`content:${version}`).digest("hex");
  const unsigned = {
    schemaVersion: 2,
    version,
    summary,
    highlights: changes.slice(0, 6).map((change) => change.id),
    changes,
    components: [component("website", "Website", "findmydoc-platform/website", "https://findmydoc.eu"), component("dashboard", "Clinic Dashboard", "findmydoc-platform/clinic-dashboard", "https://clinics.findmydoc.eu")],
    visuals: [],
    planDigest,
    contentDigest,
    publishedAt,
  };
  const canonical = `${JSON.stringify(stableJsonValue(unsigned), null, 2)}\n`;
  return { ...unsigned, manifestDigest: createHash("sha256").update(canonical).digest("hex") };
}

function localPlatformReleaseManifests() {
  return [
    localPlatformReleaseManifest("v1.0.0", "2026-09-03T08:30:00.000Z", "findmydoc bringt Suche und Praxissteuerung in einer stabilen Hauptversion zusammen.", ["Gemeinsame Plattformbasis", "Verlässliche Release-Nachweise"]),
    localPlatformReleaseManifest("v0.52.0", "2026-08-11T08:24:00.000Z", "Patient:innen finden schneller passende Arzttermine.", ["Relevantere Ergebnisse für Patient:innen", "Fuzzy- und Synonym-Suche", "Neue Optionen für Entfernung und Sprechzeiten", "Kürzere Wege durch präzisere Berechnung", "Bessere Übersicht in den Ergebnissen", "Stabiler und schneller"]),
    localPlatformReleaseManifest("v0.51.0", "2026-07-28T09:10:00.000Z", "Praxen steuern Verfügbarkeiten übersichtlicher.", ["Klarere Verfügbarkeiten", "Einfachere Tagesansicht"]),
    localPlatformReleaseManifest("v0.50.0", "2026-07-09T07:45:00.000Z", "Die Terminsuche reagiert schneller und verständlicher.", ["Schnellere Terminsuche", "Verständlichere Fehlermeldungen"]),
    localPlatformReleaseManifest("v0.49.0", "2026-06-18T11:00:00.000Z", "Patient:innen erkennen passende Praxen auf einen Blick.", ["Bessere Praxisübersicht", "Klarere Kontaktdaten"]),
    localPlatformReleaseManifest("v0.48.0", "2026-06-04T10:15:00.000Z", "Clinic-Teams verwalten Standorte zuverlässiger.", ["Zuverlässigere Standortverwaltung", "Verbesserte Teamansicht"]),
    localApplicationReleaseManifest(),
  ];
}

function localApplicationReleaseManifest() {
  const version = "v0.45.0";
  const targetSha = "c1d2e3f";
  const planDigest = createHash("sha256").update(`plan:${version}`).digest("hex");
  const contentDigest = createHash("sha256").update(`content:${version}`).digest("hex");
  const unsigned = {
    schemaVersion: 3,
    releaseMode: "application",
    notificationMode: "silent",
    source: { kind: "github-release-import", importedAt: "2026-08-17T10:00:00.000Z" },
    version,
    summary: "Die Website bündelt eine klarere Suche und verlässlichere Klinikprofile.",
    highlights: ["website-search"],
    changes: [{
      id: "website-search",
      kind: "feature",
      componentKeys: ["website"],
      pullRequests: [{ repository: "findmydoc-platform/website", number: 1600 }],
      commitShas: [targetSha],
      title: "Klarere Website-Suche",
      summary: "Patient:innen erkennen passende Kliniken schneller und erhalten verlässlichere Profildaten.",
      visualUrls: [],
    }],
    components: [{
      key: "website",
      displayName: "Website",
      productionUrl: "https://findmydoc.eu",
      repository: "findmydoc-platform/website",
      targetSha,
      release: `https://github.com/findmydoc-platform/website/releases/tag/${version}`,
      deploymentRun: null,
      commits: [{ bump: "minor", message: "feat: improve search", sha: targetSha, url: `https://github.com/findmydoc-platform/website/commit/${targetSha}` }],
      pullRequests: [{ number: 1600, repository: "findmydoc-platform/website", title: "feat: improve search", url: "https://github.com/findmydoc-platform/website/pull/1600", commitShas: [targetSha], issues: [] }],
    }],
    visuals: [],
    planDigest,
    contentDigest,
    publishedAt: "2026-05-20T10:00:00.000Z",
  };
  const canonical = `${JSON.stringify(stableJsonValue(unsigned), null, 2)}\n`;
  return { ...unsigned, manifestDigest: createHash("sha256").update(canonical).digest("hex") };
}

function canonicalSeedEpics(source) {
  return (source.epics || []).map((epic) => ({
    id: epic.id,
    project_id: source.project.id,
    title: epic.title,
    description: nullable(epic.description),
    status: epic.status || "Offen",
    priority: null,
    owner: nullable(epic.ownerId),
    assignee: nullable(epic.ownerId),
    sort_order: epic.sortOrder || 0,
    target_date: nullable(epic.targetDate),
    task_type: "epic",
    parent_task_id: null,
    approval_status: null,
    approval_revision: 1,
    github_issue_sync_status: "not_applicable",
    score_relevant: false,
    review_status: "not_requested",
  }));
}

function canonicalSeedInitiatives(source) {
  return source.initiatives.map((item) => ({
    id: item.id,
    project_id: source.project.id,
    title: item.title,
    description: nullable(item.goal),
    status: item.status,
    priority: item.priority || "P2",
    owner: nullable(item.ownerId),
    assignee: nullable(item.ownerId),
    sort_order: item.sortOrder || 0,
    target_date: nullable(item.targetDate),
    task_type: "initiative",
    parent_task_id: nullable(item.parentTaskId),
    approval_status: item.approvalStatus || "approved",
    approval_revision: item.approvalRevision || 1,
    proposed_by: nullable(item.proposedById) || nullable(item.ownerId),
    proposed_at: nullable(item.proposedAt) || new Date().toISOString(),
    decided_by: nullable(item.decidedById),
    decided_at: nullable(item.decidedAt),
    decision_note: nullable(item.decisionNote),
    github_issue_sync_status: "not_applicable",
    score_relevant: false,
    review_status: "not_requested",
  }));
}

function canonicalSeedRaciRows(initiatives) {
  return initiatives.flatMap((item) => [
    item.accountableProfileId ? { task_id: item.id, profile_id: item.accountableProfileId, role: "accountable", sort_order: 0 } : null,
    ...(item.responsibleProfileIds || []).map((profileId, index) => ({ task_id: item.id, profile_id: profileId, role: "responsible", sort_order: index })),
    ...(item.consultedProfileIds || []).map((profileId, index) => ({ task_id: item.id, profile_id: profileId, role: "consulted", sort_order: index })),
    ...(item.informedProfileIds || []).map((profileId, index) => ({ task_id: item.id, profile_id: profileId, role: "informed", sort_order: index })),
  ].filter(Boolean));
}

async function replacePlanningItemRaciRows(client, initiatives) {
  const initiativeIds = initiatives.map((item) => item.id);
  if (!initiativeIds.length) return;
  await client.query("delete from planning_item_raci_assignments where task_id = any($1::text[])", [initiativeIds]);
  const rows = canonicalSeedRaciRows(initiatives);
  if (!rows.length) return;
  const values = [];
  const tuples = rows.map((row) => {
    values.push(row.task_id, row.profile_id, row.role, row.sort_order);
    const offset = values.length - 3;
    return `($${offset},$${offset + 1},$${offset + 2},$${offset + 3})`;
  });
  await client.query(
    `insert into planning_item_raci_assignments (task_id,profile_id,role,sort_order) values ${tuples.join(",")}`,
    values,
  );
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

async function seedPlanningDatabase(status) {
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
    await upsertRows(client, "founder_events", [
      "id",
      "title",
      "category",
      "starts_at",
      "ends_at",
      "location",
      "description",
      "audience_mode",
      "participant_profile_ids",
      "reminder_days_before",
      "status",
      "created_by",
    ], source.founderEvents.map((event) => ({
      id: event.id,
      title: event.title,
      category: event.category,
      starts_at: event.startsAt,
      ends_at: nullable(event.endsAt),
      location: event.location || "",
      description: event.description || "",
      audience_mode: event.audienceMode,
      participant_profile_ids: event.participantProfileIds,
      reminder_days_before: event.reminderDaysBefore,
      status: event.status,
      created_by: event.createdBy,
    })));
    await client.query(
      "select setval(pg_get_serial_sequence('founder_events','id'), greatest(coalesce((select max(id) from founder_events), 1), 1), true)",
    );
    await client.query("delete from notification_events where entity_type='platform_release'");
    await client.query("delete from platform_releases");
    for (const manifest of localPlatformReleaseManifests()) {
      await client.query("select public.ingest_platform_release_v1($1::jsonb)", [JSON.stringify(manifest)]);
    }
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
    const epicRows = canonicalSeedEpics(source);
    const initiativeRows = canonicalSeedInitiatives(source);
    const taskRows = tasks.map((task) => ({
      id: task.id,
      project_id: source.project.id,
      title: task.title,
      description: nullable(task.description),
      status: task.status,
      priority: task.priority,
      owner: nullable(task.ownerId),
      assignee: nullable(task.assigneeId),
      created_by: nullable(task.createdById),
      workstream: nullable(task.workstream),
      sort_order: task.order,
      fixed_date: task.taskType === "deliverable" ? nullable(task.fixedDate) : null,
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
    const allTaskRows = [...epicRows, ...initiativeRows, ...taskRows];
    const taskTypeOrder = { epic: 0, initiative: 1, deliverable: 2, sub_issue: 3 };
    const parentFirst = allTaskRows.sort((left, right) => taskTypeOrder[left.task_type] - taskTypeOrder[right.task_type]);
    for (const row of parentFirst) {
      await upsertRows(client, "tasks", Object.keys(row), [row]);
    }
    const releaseLinkedSubIssues = [
      ["sebastian-contact-route-implementieren", "Relevantere Ergebnisse für Patient:innen"],
      ["sebastian-contact-footer-link-aktualisieren", "Fuzzy- und Synonym-Suche"],
      ["sebastian-contact-partner-link-aktualisieren", "Neue Optionen für Entfernung und Sprechzeiten"],
      ["sebastian-contact-404-regressionstest", "Kürzere Wege durch präzisere Berechnung"],
      ["sebastian-contact-mobile-smoke-test", "Bessere Übersicht in den Ergebnissen"],
    ];
    const releaseLinkedSubIssueIds = releaseLinkedSubIssues.map(([taskId]) => taskId);
    await client.query("update tasks set title='Schnellere Arzttermin-Suche für Patient:innen',github_repo='findmydoc-platform/management',github_issue_number=210,github_issue_url='https://github.com/findmydoc-platform/management/issues/210' where id='GC1'");
    await client.query("update tasks set title='Smart Match Release v0.52',github_repo='findmydoc-platform/management',github_issue_number=213,github_issue_url='https://github.com/findmydoc-platform/management/issues/213' where id='sebastian-contact-404-beheben-oder-links-umstellen'");
    await client.query("delete from task_links where task_id = any($1::text[]) and type = 'github_pull_request'", [releaseLinkedSubIssueIds]);
    for (const [position, [taskId, taskTitle]] of releaseLinkedSubIssues.entries()) {
      await client.query("update tasks set title=$2 where id=$1", [taskId, taskTitle]);
      await client.query(
        "insert into task_links (task_id,type,label,url,position,metadata) values ($1,'github_pull_request',$2,$3,$4,$5::jsonb)",
        [taskId, "Release v0.52.0: schnellere Arztsuche", "https://github.com/findmydoc-platform/website/pull/1842", position, JSON.stringify({ repository: "findmydoc-platform/website", number: 1842, status: "merged", mergedAt: "2026-08-10T15:00:00.000Z" })],
      );
      await client.query(
        "update tasks set github_repo=$2,github_issue_number=$3,github_issue_url=$4 where id=$1",
        [taskId, "findmydoc-platform/management", 214 + position, `https://github.com/findmydoc-platform/management/issues/${214 + position}`],
      );
    }
    await upsertRows(client, "planning_item_strategy", ["task_id", "goal", "success_criteria", "scope_constraints"], source.initiatives.map((item) => ({
      task_id: item.id,
      goal: item.goal || "",
      success_criteria: item.successCriteria || "",
      scope_constraints: item.scopeConstraints || "",
    })), "task_id");
    await replacePlanningItemRaciRows(client, source.initiatives);
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
    console.log(`Seeded local planning data: ${source.profiles.length} profiles, ${(source.epics || []).length} epics, ${source.initiatives.length} initiatives, ${tasks.length} delivery items, ${source.founderEvents.length} founder events.`);
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
  await seedPlanningDatabase(status);
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
