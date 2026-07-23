import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveGitHubIssueNumber } from "./github-issue-reference";
import { syncFounderOpsGitHubProjectFields, type FounderOpsGitHubSprint } from "./github-project-fields";
import {
  ensureFounderOpsGitHubProjectItem,
  observeFounderOpsGitHubProjectItem,
  validateFounderOpsGitHubProject,
} from "./github-project";
import { validGitHubProjectNumber, validGitHubProjectOwner } from "./github-project-config";
import { resolveTaskGitHubRepository } from "./github-repositories";
import { mapTaskRow, type TaskRowForMapping } from "./planning-task-mappers";
import type { Task } from "./types";

const founderOpsProjectId = "findmydoc-founder-execution";
const allowedRepositories = new Set([
  "all",
  "findmydoc-platform/management",
  "findmydoc-platform/website",
  "findmydoc-platform/clinic-dashboard",
]);

export type FounderOpsGitHubProjectBackfillOptions = {
  afterTaskId: string;
  batchSize: number;
  dryRun: boolean;
  expectedOwner: string;
  expectedProjectNumber: number;
  includeNotSynced: boolean;
  repository: string;
};

type BackfillTask = {
  id: string;
  issueNumber: number;
  repository: string;
  sprint: FounderOpsGitHubSprint | null | undefined;
  sprintWarnings: string[];
  syncStatus: string;
  task: Task;
  taskType: Task["taskType"];
};

type BackfillItemResult = {
  changes: string[];
  error?: string;
  issueNumber: number;
  membership: "added" | "existing" | "missing";
  repository: string;
  taskId: string;
  warnings: string[];
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function positiveInteger(value: unknown, label: string, maximum?: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || (maximum && parsed > maximum)) {
    throw new Error(`${label} must be an integer between 1 and ${maximum || "the supported maximum"}.`);
  }
  return parsed;
}

function booleanValue(value: unknown, label: string) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false" || value === undefined) return false;
  throw new Error(`${label} must be true or false.`);
}

export function normalizeFounderOpsGitHubProjectBackfillOptions(
  input: Record<string, unknown>,
  dryRun: boolean,
): FounderOpsGitHubProjectBackfillOptions {
  const repository = String(input.repository || "all").trim();
  if (!allowedRepositories.has(repository)) {
    throw new Error(`repository is not supported: ${repository}`);
  }
  const expectedOwner = String(input.expectedOwner || "").trim();
  if (!validGitHubProjectOwner(expectedOwner)) throw new Error("expectedOwner is invalid.");

  return {
    afterTaskId: String(input.afterTaskId || "").trim(),
    batchSize: dryRun ? 10000 : positiveInteger(input.batchSize || 20, "batchSize", 50),
    dryRun,
    expectedOwner,
    expectedProjectNumber: positiveInteger(input.expectedProjectNumber, "expectedProjectNumber"),
    includeNotSynced: booleanValue(input.includeNotSynced, "includeNotSynced"),
    repository,
  };
}

function taskRank(task: BackfillTask) {
  return task.taskType === "deliverable" ? 0 : 1;
}

export function selectFounderOpsGitHubProjectBackfillTasks(
  tasks: BackfillTask[],
  options: Pick<FounderOpsGitHubProjectBackfillOptions, "afterTaskId" | "batchSize" | "includeNotSynced" | "repository">,
) {
  const ordered = [...tasks].sort((left, right) => (
    taskRank(left) - taskRank(right)
    || left.id.localeCompare(right.id)
  ));
  const afterIndex = options.afterTaskId
    ? ordered.findIndex((task) => task.id === options.afterTaskId)
    : -1;
  if (options.afterTaskId && afterIndex < 0) {
    throw new Error(`afterTaskId was not found: ${options.afterTaskId}`);
  }

  return ordered
    .slice(afterIndex + 1)
    .filter((task) => options.repository === "all" || task.repository === options.repository)
    .filter((task) => options.includeNotSynced || task.syncStatus === "synced")
    .slice(0, options.batchSize);
}

export function summarizeFounderOpsGitHubProjectBackfillInventory(tasks: BackfillTask[]) {
  const summary: {
    byRepository: Record<string, number>;
    linked: number;
    notSynced: number;
    synced: number;
    total: number;
  } = {
    byRepository: {},
    linked: 0,
    notSynced: 0,
    synced: 0,
    total: tasks.length,
  };
  for (const task of tasks) {
    if (task.issueNumber) summary.linked += 1;
    if (task.syncStatus === "synced") summary.synced += 1;
    else summary.notSynced += 1;
    summary.byRepository[task.repository] = (summary.byRepository[task.repository] || 0) + 1;
  }
  return summary;
}

async function acquireItemLock(
  supabase: SupabaseClient,
  task: BackfillTask,
  actorProfileId: string,
) {
  const resourceKey = `github:${task.repository}#${task.issueNumber}`;
  const { data, error } = await supabase.rpc("try_acquire_github_issue_sync_lock", {
    p_resource_key: resourceKey,
    p_task_id: task.id,
    p_locked_by_profile_id: actorProfileId,
    p_ttl_seconds: 600,
  });
  if (error) throw new Error("GitHub sync lock could not be acquired.");
  if (typeof data !== "string" || !data) throw new Error("GitHub sync is already running for this issue.");
  return { lockToken: data, resourceKey };
}

async function releaseItemLock(supabase: SupabaseClient, resourceKey: string, lockToken: string) {
  await supabase.rpc("release_github_issue_sync_lock", {
    p_resource_key: resourceKey,
    p_lock_token: lockToken,
  });
}

export async function runFounderOpsGitHubProjectBackfill({
  actorProfileId,
  options,
  supabase,
  token,
}: {
  actorProfileId: string;
  options: FounderOpsGitHubProjectBackfillOptions;
  supabase: SupabaseClient;
  token: string;
}) {
  const { data: projectSettings, error: projectSettingsError } = await supabase
    .from("projects")
    .select("github_project_owner,github_project_number")
    .eq("id", founderOpsProjectId)
    .single();
  if (projectSettingsError || !projectSettings) {
    throw new Error("FounderOps GitHub Project settings could not be loaded.");
  }
  if (
    !validGitHubProjectOwner(projectSettings.github_project_owner)
    || !validGitHubProjectNumber(projectSettings.github_project_number)
  ) {
    throw new Error("FounderOps GitHub Project settings are missing or invalid.");
  }
  if (
    projectSettings.github_project_owner !== options.expectedOwner
    || projectSettings.github_project_number !== options.expectedProjectNumber
  ) {
    throw new Error(
      `Target guard failed: configured ${projectSettings.github_project_owner}#${projectSettings.github_project_number}, `
      + `expected ${options.expectedOwner}#${options.expectedProjectNumber}.`,
    );
  }

  await validateFounderOpsGitHubProject(
    projectSettings.github_project_owner,
    projectSettings.github_project_number,
    token,
  );

  const [{ data: taskRows, error: tasksError }, { data: sprintRows, error: sprintsError }] = await Promise.all([
    supabase.from("active_tasks").select("*"),
    supabase.from("sprints").select("id,name,start_date"),
  ]);
  if (tasksError) throw new Error("Active FounderOps tasks could not be loaded.");
  if (sprintsError) throw new Error("FounderOps sprints could not be loaded.");

  const sprintById = new Map(
    (sprintRows || []).map((sprint) => [sprint.id, {
      startDate: sprint.start_date,
      title: sprint.name,
    }]),
  );
  const invalidTasks: Array<{ error: string; taskId: string }> = [];
  const linkedTasks: BackfillTask[] = [];

  for (const row of taskRows || []) {
    const task = mapTaskRow(row as TaskRowForMapping, new Map<string, string>());
    const hasLinkedIssue = Boolean(
      task.githubIssueNumber
      || task.githubIssueUrl
      || task.issueNumber
      || task.issueUrl,
    );
    if (!hasLinkedIssue) continue;
    const repositoryPolicy = resolveTaskGitHubRepository(task.taskType, task.githubRepo);
    if (!repositoryPolicy.ok) {
      invalidTasks.push({ error: repositoryPolicy.error, taskId: task.id });
      continue;
    }

    let issueNumber: number | null | undefined;
    try {
      issueNumber = resolveGitHubIssueNumber(task, {
        repository: repositoryPolicy.repository,
        requireConsistent: true,
      });
    } catch (error) {
      invalidTasks.push({ error: errorMessage(error), taskId: task.id });
      continue;
    }
    if (!issueNumber) continue;

    const sprintRow = task.sprintId ? sprintById.get(task.sprintId) : null;
    const sprintComplete = sprintRow?.title && sprintRow.startDate;
    linkedTasks.push({
      id: task.id,
      issueNumber,
      repository: repositoryPolicy.repository,
      sprint: task.sprintId
        ? (sprintComplete ? { title: sprintRow.title, startDate: sprintRow.startDate } : undefined)
        : null,
      sprintWarnings: task.sprintId && !sprintComplete
        ? [`FounderOps sprint ${task.sprintId} could not be loaded completely; Sprint will not be changed.`]
        : [],
      syncStatus: task.githubIssueSyncStatus,
      task,
      taskType: task.taskType,
    });
  }

  const selectedTasks = selectFounderOpsGitHubProjectBackfillTasks(linkedTasks, {
    ...options,
    batchSize: options.dryRun ? options.batchSize : 10000,
  });
  const results: BackfillItemResult[] = [];
  let appliedItems = 0;
  for (const candidate of selectedTasks) {
    if (!options.dryRun && appliedItems >= options.batchSize) break;
    const itemResult: BackfillItemResult = {
      changes: [],
      issueNumber: candidate.issueNumber,
      membership: "missing",
      repository: candidate.repository,
      taskId: candidate.id,
      warnings: [...candidate.sprintWarnings],
    };
    let itemLock: { lockToken: string; resourceKey: string } | null = null;
    let slotConsumed = false;
    try {
      if (!options.dryRun) itemLock = await acquireItemLock(supabase, candidate, actorProfileId);
      const observed = await observeFounderOpsGitHubProjectItem({
        issueNumber: candidate.issueNumber,
        projectNumber: projectSettings.github_project_number,
        projectOwner: projectSettings.github_project_owner,
        repository: candidate.repository,
        token,
      });
      if (options.dryRun) {
        if (observed.itemId) {
          itemResult.membership = "existing";
          const fieldResult = await syncFounderOpsGitHubProjectFields({
            dryRun: true,
            itemId: observed.itemId,
            projectId: observed.projectId,
            projectNumber: projectSettings.github_project_number,
            projectOwner: projectSettings.github_project_owner,
            sprint: candidate.sprint,
            task: candidate.task,
            token,
          });
          itemResult.changes.push(...fieldResult.changes);
          itemResult.warnings.push(...fieldResult.warnings);
        }
      } else if (observed.itemId) {
        itemResult.membership = "existing";
        const preview = await syncFounderOpsGitHubProjectFields({
          dryRun: true,
          itemId: observed.itemId,
          projectId: observed.projectId,
          projectNumber: projectSettings.github_project_number,
          projectOwner: projectSettings.github_project_owner,
          sprint: candidate.sprint,
          task: candidate.task,
          token,
        });
        if (preview.changes.length) {
          appliedItems += 1;
          slotConsumed = true;
          const fieldResult = await syncFounderOpsGitHubProjectFields({
            itemId: observed.itemId,
            projectId: observed.projectId,
            projectNumber: projectSettings.github_project_number,
            projectOwner: projectSettings.github_project_owner,
            sprint: candidate.sprint,
            task: candidate.task,
            token,
          });
          itemResult.changes.push(...fieldResult.changes);
          itemResult.warnings.push(...fieldResult.warnings);
        } else {
          itemResult.warnings.push(...preview.warnings);
        }
      } else {
        appliedItems += 1;
        slotConsumed = true;
        const ensured = await ensureFounderOpsGitHubProjectItem({
          issueNumber: candidate.issueNumber,
          projectNumber: projectSettings.github_project_number,
          projectOwner: projectSettings.github_project_owner,
          repository: candidate.repository,
          token,
        });
        itemResult.membership = ensured.added ? "added" : "existing";
        const fieldResult = await syncFounderOpsGitHubProjectFields({
          itemId: ensured.itemId,
          projectId: ensured.projectId,
          projectNumber: projectSettings.github_project_number,
          projectOwner: projectSettings.github_project_owner,
          sprint: candidate.sprint,
          task: candidate.task,
          token,
        });
        itemResult.changes.push(...fieldResult.changes);
        itemResult.warnings.push(...fieldResult.warnings);
      }
    } catch (error) {
      if (!options.dryRun && !slotConsumed) appliedItems += 1;
      itemResult.error = errorMessage(error);
    } finally {
      if (itemLock) await releaseItemLock(supabase, itemLock.resourceKey, itemLock.lockToken);
    }
    results.push(itemResult);
  }

  const counts = {
    added: results.filter((result) => result.membership === "added").length,
    errors: results.filter((result) => result.error).length,
    existing: results.filter((result) => result.membership === "existing").length,
    missing: results.filter((result) => result.membership === "missing" && !result.error).length,
    warnings: results.reduce((total, result) => total + result.warnings.length, 0),
  };
  return {
    completedAt: new Date().toISOString(),
    cursor: {
      firstTaskId: results[0]?.taskId || null,
      lastTaskId: results.at(-1)?.taskId || null,
    },
    invalidTasks,
    inventory: summarizeFounderOpsGitHubProjectBackfillInventory(linkedTasks),
    mode: options.dryRun ? "dry-run" : "apply",
    options: {
      afterTaskId: options.afterTaskId || null,
      batchSize: options.batchSize,
      includeNotSynced: options.includeNotSynced,
      repository: options.repository,
    },
    results,
    summary: {
      ...counts,
      appliedItems,
      processed: results.length,
      selected: results.length,
    },
    target: {
      number: projectSettings.github_project_number,
      owner: projectSettings.github_project_owner,
    },
  };
}
