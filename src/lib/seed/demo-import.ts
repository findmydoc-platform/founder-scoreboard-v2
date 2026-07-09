import type { SupabaseClient } from "@supabase/supabase-js";
import { seedData } from "./data";

const bootstrapEmptyTables = ["projects", "profiles", "packages", "tasks", "sprints", "meetings"] as const;

export type DemoSeedImportCounts = {
  profiles: number;
  packages: number;
  tasks: number;
  sprints: number;
  fmdTools: number;
  meetings: number;
};

export type DemoSeedImportAvailability = {
  available: boolean;
  status: number;
  error: string;
  counts?: Record<(typeof bootstrapEmptyTables)[number], number>;
};

function textOrNull(value?: string | null) {
  return value?.trim() ? value : null;
}

export function isDemoSeedImportRuntimeAllowed() {
  const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY);
  const hasSupabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);
  return process.env.NODE_ENV !== "production" && hasServiceKey && hasSupabaseUrl;
}

export function isDemoSeedImportButtonAvailable() {
  return process.env.NODE_ENV !== "production";
}

async function countRows(supabase: SupabaseClient, table: (typeof bootstrapEmptyTables)[number]) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

export async function getDemoSeedImportAvailability(supabase: SupabaseClient | null): Promise<DemoSeedImportAvailability> {
  if (process.env.NODE_ENV === "production") {
    return { available: false, status: 403, error: "Demo-Import ist nur lokal verfügbar." };
  }

  if (!isDemoSeedImportRuntimeAllowed()) {
    return { available: false, status: 501, error: "Demo-Import braucht lokale Supabase-URL und Service-Key." };
  }

  if (!supabase) {
    return { available: false, status: 501, error: "Supabase env is not configured." };
  }

  try {
    const entries = await Promise.all(bootstrapEmptyTables.map(async (table) => [table, await countRows(supabase, table)] as const));
    const counts = Object.fromEntries(entries) as Record<(typeof bootstrapEmptyTables)[number], number>;
    const empty = Object.values(counts).every((count) => count === 0);

    if (!empty) {
      return {
        available: false,
        status: 409,
        error: "Demo-Import ist nur für eine leere Supabase-Bootstrap-Datenbank verfügbar.",
        counts,
      };
    }

    return { available: true, status: 200, error: "", counts };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supabase konnte nicht geprüft werden.";
    return { available: false, status: 503, error: `Demo-Import-Verfügbarkeit konnte nicht geprüft werden: ${message}` };
  }
}

function assertResult(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

async function upsertMeetings(supabase: SupabaseClient) {
  for (const meeting of seedData.meetings) {
    const { data: existing, error: readError } = await supabase
      .from("meetings")
      .select("id")
      .eq("sprint_id", meeting.sprintId)
      .eq("title", meeting.title)
      .limit(1)
      .maybeSingle();
    assertResult(readError, "meetings.read");

    const row = {
      sprint_id: meeting.sprintId,
      title: meeting.title,
      meeting_at: meeting.meetingAt,
      status: meeting.status,
      agenda: meeting.agenda || null,
      duration_minutes: meeting.durationMinutes || 60,
    };

    const result = existing?.id
      ? await supabase.from("meetings").update(row).eq("id", existing.id)
      : await supabase.from("meetings").insert(row);
    assertResult(result.error, "meetings.write");
  }
}

export async function importDemoSeed(supabase: SupabaseClient): Promise<DemoSeedImportCounts> {
  const projectResult = await supabase.from("projects").upsert({
    id: seedData.project.id,
    name: seedData.project.name,
    range_label: seedData.project.range,
  });
  assertResult(projectResult.error, "projects");

  const profileRows = seedData.profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    role: profile.role,
    platform_role: profile.platformRole,
    org_role: profile.orgRole,
    github_login: textOrNull(profile.githubLogin),
    focus: textOrNull(profile.focus),
    weekly_capacity: profile.weeklyCapacity,
    profile_color: profile.color || "#64748b",
  }));
  const profileResult = await supabase.from("profiles").upsert(profileRows, { onConflict: "id" });
  assertResult(profileResult.error, "profiles");

  const packageRows = seedData.packages.map((pkg) => ({
    id: pkg.id,
    project_id: seedData.project.id,
    milestone_id: textOrNull(pkg.milestoneId),
    owner_id: textOrNull(pkg.ownerId),
    accountable_profile_id: textOrNull(pkg.accountableProfileId),
    responsible_profile_ids: pkg.responsibleProfileIds || [],
    consulted_profile_ids: pkg.consultedProfileIds || [],
    informed_profile_ids: pkg.informedProfileIds || [],
    title: pkg.title,
    goal: pkg.goal,
    priority: pkg.priority,
    status: pkg.status || "planned",
    target_date: textOrNull(pkg.targetDate),
    success_criteria: pkg.successCriteria || "",
    scope_constraints: pkg.scopeConstraints || "",
    sort_order: pkg.sortOrder,
  }));
  const packageResult = await supabase.from("packages").upsert(packageRows, { onConflict: "id" });
  assertResult(packageResult.error, "packages");

  const sprintRows = seedData.sprints.map((sprint) => ({
    id: sprint.id,
    project_id: seedData.project.id,
    name: sprint.name,
    status: sprint.status,
    start_date: sprint.startDate,
    end_date: sprint.endDate,
    review_due_at: textOrNull(sprint.reviewDueAt),
    score_locked: sprint.scoreLocked,
  }));
  const sprintResult = await supabase.from("sprints").upsert(sprintRows, { onConflict: "id" });
  assertResult(sprintResult.error, "sprints");

  const toolRows = seedData.fmdTools.map((tool) => ({
    id: tool.id,
    name: tool.name,
    category: tool.category,
    kind: tool.kind,
    description: tool.description || "",
    url: textOrNull(tool.url),
    owner: textOrNull(tool.owner),
    status: tool.status,
    is_curated: tool.isCurated,
    preview_image_url: textOrNull(tool.previewImageUrl),
    preview_image_source: tool.previewImageSource,
    sort_order: tool.sortOrder,
  }));
  const toolResult = await supabase.from("fmd_tools").upsert(toolRows, { onConflict: "id" });
  assertResult(toolResult.error, "fmd_tools");

  const taskRows = seedData.tasks.map((task) => ({
    id: task.id,
    project_id: seedData.project.id,
    package_id: textOrNull(task.packageId),
    title: task.title,
    description: textOrNull(task.description),
    status: task.status,
    priority: task.priority,
    owner: textOrNull(task.ownerId || task.assigneeId),
    assignee: textOrNull(task.assigneeId || task.ownerId),
    created_by: textOrNull(task.createdById),
    workstream: textOrNull(task.workstream),
    sort_order: task.order,
    start_date: textOrNull(task.startDate),
    end_date: textOrNull(task.endDate),
    deadline: textOrNull(task.deadline),
    estimate_hours: task.hours || null,
    definition_of_done: textOrNull(task.definitionOfDone),
    evidence_link: textOrNull(task.evidenceLink),
    issue_number: textOrNull(task.issueNumber),
    issue_url: textOrNull(task.issueUrl),
    watched: task.watched,
    sprint_id: textOrNull(task.sprintId),
    review_status: task.reviewStatus,
    score_points: task.scorePoints,
    score_final: task.scoreFinal,
    github_repo: textOrNull(task.githubRepo),
    github_issue_number: task.githubIssueNumber,
    github_issue_url: textOrNull(task.githubIssueUrl),
    github_sync_status: task.githubSyncStatus,
    github_last_synced_at: textOrNull(task.githubLastSyncedAt),
    github_sync_error: textOrNull(task.githubSyncError),
    task_type: task.taskType,
    parent_task_id: textOrNull(task.parentTaskId),
    score_relevant: task.scoreRelevant,
    milestone_id: textOrNull(task.milestoneId),
    review_owner_profile_id: textOrNull(task.reviewOwnerProfileId),
    review_requested_at: textOrNull(task.reviewRequestedAt),
    problem_statement: textOrNull(task.problemStatement),
    intended_outcome: textOrNull(task.intendedOutcome),
    scope_constraints: textOrNull(task.scopeConstraints),
    acceptance_criteria: textOrNull(task.acceptanceCriteria),
    evidence_required: textOrNull(task.evidenceRequired),
    dod_template_version: task.dodTemplateVersion || "founder-deliverable-v2",
    original_sprint_id: textOrNull(task.originalSprintId),
    carried_from_task_id: textOrNull(task.carriedFromTaskId),
    carried_from_sprint_id: textOrNull(task.carriedFromSprintId),
    carryover_reason: textOrNull(task.carryoverReason),
    carryover_count: task.carryoverCount || 0,
    sprint_outcome: textOrNull(task.sprintOutcome),
    self_dod_checked: Boolean(task.selfDodChecked),
    self_evidence_checked: Boolean(task.selfEvidenceChecked),
    self_documented_checked: Boolean(task.selfDocumentedChecked),
    self_blockers_checked: Boolean(task.selfBlockersChecked),
  }));
  const taskResult = await supabase.from("tasks").upsert(taskRows, { onConflict: "id" });
  assertResult(taskResult.error, "tasks");

  const sourceTaskIds = seedData.tasks.map((task) => task.id);
  const dependencyDeleteResult = await supabase.from("task_dependencies").delete().in("task_id", sourceTaskIds);
  assertResult(dependencyDeleteResult.error, "task_dependencies.delete");
  const dependencyRows = seedData.tasks
    .filter((task) => task.dependsOn.trim())
    .map((task) => ({ task_id: task.id, note: task.dependsOn }));
  if (dependencyRows.length) {
    const dependencyInsertResult = await supabase.from("task_dependencies").insert(dependencyRows);
    assertResult(dependencyInsertResult.error, "task_dependencies.insert");
  }

  await upsertMeetings(supabase);

  return {
    profiles: profileRows.length,
    packages: packageRows.length,
    tasks: taskRows.length,
    sprints: sprintRows.length,
    fmdTools: toolRows.length,
    meetings: seedData.meetings.length,
  };
}
