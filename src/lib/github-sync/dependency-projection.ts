import type { SupabaseClient } from "@supabase/supabase-js";
import { listGitHubIssueBlockedBy } from "../github";
import {
  GITHUB_ISSUE_DEPENDENCY_API_VERSION,
  githubJson,
  githubRequest,
} from "../github-http";
import { parseGitHubIssueUrl, resolveGitHubIssueNumber } from "../github-issue-reference";
import { normalizeGitHubRepository, splitGitHubRepository } from "../github-repositories";

type RelationshipRow = {
  id: number;
  task_id: string;
  related_task_id: string;
  relation_type: "blocked_by" | "blocks" | "relates_to";
};

type RelationshipTaskRow = {
  id: string;
  github_repo?: string | null;
  github_issue_number?: number | null;
  github_issue_url?: string | null;
  issue_number?: string | null;
  issue_url?: string | null;
};

type GitHubIssueReference = {
  id: number;
  number: number;
  html_url: string;
};

type GitHubIssueDependency = GitHubIssueReference & {
  repository_url?: string;
  repositoryFullName?: string | null;
};

type GitHubIssueCoordinate = Readonly<{
  repository: string;
  issueNumber: number;
}>;

type GitHubIssueDependencyInput = Readonly<{
  blocked: GitHubIssueCoordinate;
  blocking: GitHubIssueCoordinate;
}>;

function coordinateKey(coordinate: GitHubIssueCoordinate) {
  return `${coordinate.repository}#${coordinate.issueNumber}`;
}

function sameCoordinate(left: GitHubIssueCoordinate, right: GitHubIssueCoordinate) {
  return coordinateKey(left) === coordinateKey(right);
}

function rowRepository(row: RelationshipTaskRow, fallbackRepository: string) {
  if (row.github_repo) return normalizeGitHubRepository(row.github_repo);
  for (const value of [row.github_issue_url, row.issue_url]) {
    const reference = parseGitHubIssueUrl(value);
    const repository = reference ? normalizeGitHubRepository(reference.repository) : null;
    if (repository) return repository;
  }
  return normalizeGitHubRepository(fallbackRepository);
}

function dependencyCoordinate(
  dependency: GitHubIssueDependency,
  fallbackRepository: string,
): GitHubIssueCoordinate | null {
  let repository = dependency.repositoryFullName
    ? normalizeGitHubRepository(dependency.repositoryFullName)
    : null;
  if (!repository && dependency.repository_url) {
    try {
      const url = new URL(dependency.repository_url);
      const match = url.hostname.toLowerCase() === "api.github.com"
        ? url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/?$/i)
        : null;
      repository = match
        ? normalizeGitHubRepository(`${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`)
        : null;
    } catch {
      repository = null;
    }
  }
  repository ||= normalizeGitHubRepository(fallbackRepository);
  return repository && Number.isSafeInteger(dependency.number) && dependency.number > 0
    ? { repository, issueNumber: dependency.number }
    : null;
}

function rowIssueCoordinate(
  row: RelationshipTaskRow,
  currentTaskId: string,
  currentIssueNumber: number,
  repository: string,
): GitHubIssueCoordinate | null {
  if (row.id === currentTaskId) return { repository, issueNumber: currentIssueNumber };
  const rowGitHubRepository = rowRepository(row, repository);
  if (!rowGitHubRepository) return null;
  const issueNumber = resolveGitHubIssueNumber(row, { repository: rowGitHubRepository });
  return issueNumber ? { repository: rowGitHubRepository, issueNumber } : null;
}

async function loadDependencyContext(
  supabase: SupabaseClient,
  taskId: string,
  currentIssueNumber: number,
  repository: string,
) {
  const [outgoingRelationships, incomingRelationships, linkedTasks] = await Promise.all([
    supabase
      .from("task_relationship_edges")
      .select("id,task_id,related_task_id,relation_type")
      .eq("task_id", taskId)
      .in("relation_type", ["blocked_by", "blocks"]),
    supabase
      .from("task_relationship_edges")
      .select("id,task_id,related_task_id,relation_type")
      .eq("related_task_id", taskId)
      .in("relation_type", ["blocked_by", "blocks"]),
    supabase
      .from("tasks")
      .select("id,github_repo,github_issue_number,github_issue_url,issue_number,issue_url"),
  ]);

  if (outgoingRelationships.error) throw new Error(outgoingRelationships.error.message);
  if (incomingRelationships.error) throw new Error(incomingRelationships.error.message);
  if (linkedTasks.error) throw new Error(linkedTasks.error.message);

  const issueCoordinateByTaskId = new Map<string, GitHubIssueCoordinate>();
  const managedIssueCoordinates = new Map<string, GitHubIssueCoordinate>();
  for (const row of (linkedTasks.data || []) as RelationshipTaskRow[]) {
    const coordinate = rowIssueCoordinate(row, taskId, currentIssueNumber, repository);
    if (!coordinate) continue;
    issueCoordinateByTaskId.set(row.id, coordinate);
    managedIssueCoordinates.set(coordinateKey(coordinate), coordinate);
  }

  const relationshipById = new Map<number, RelationshipRow>();
  for (const relationship of [...(outgoingRelationships.data || []), ...(incomingRelationships.data || [])] as RelationshipRow[]) {
    relationshipById.set(relationship.id, relationship);
  }

  const desiredDependencies = new Map<string, GitHubIssueDependencyInput>();
  for (const relationship of relationshipById.values()) {
    const blockedTaskId = relationship.relation_type === "blocks" ? relationship.related_task_id : relationship.task_id;
    const blockingTaskId = relationship.relation_type === "blocks" ? relationship.task_id : relationship.related_task_id;
    const blocked = issueCoordinateByTaskId.get(blockedTaskId);
    const blocking = issueCoordinateByTaskId.get(blockingTaskId);
    if (!blocked || !blocking || sameCoordinate(blocked, blocking)) continue;

    desiredDependencies.set(`${coordinateKey(blocked)}:${coordinateKey(blocking)}`, {
      blocked,
      blocking,
    });
  }

  return {
    desiredDependencies: [...desiredDependencies.values()],
    managedIssueCoordinates: [...managedIssueCoordinates.values()],
  };
}

async function listGitHubIssuesBlocking(issueNumber: number, token: string, repository: string) {
  const { owner, repo } = splitGitHubRepository(repository);
  return githubJson<GitHubIssueDependency[]>(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/dependencies/blocking?per_page=100`,
    {
      token,
      apiVersion: GITHUB_ISSUE_DEPENDENCY_API_VERSION,
      cache: "no-store",
      errorMessage: "Von GitHub Issue blockierte Dependencies konnten nicht geladen werden",
    },
  );
}

async function getGitHubIssue(issueNumber: number, token: string, repository: string) {
  const { owner, repo } = splitGitHubRepository(repository);
  return githubJson<GitHubIssueReference>(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
    {
      token,
      cache: "no-store",
      errorMessage: "GitHub Issue konnte nicht geladen werden",
    },
  );
}

async function addGitHubIssueBlockedBy(
  issueNumber: number,
  blockingIssueId: number,
  token: string,
  repository: string,
) {
  const { owner, repo } = splitGitHubRepository(repository);
  return githubJson<GitHubIssueDependency>(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/dependencies/blocked_by`,
    {
      token,
      method: "POST",
      operation: "mutation",
      apiVersion: GITHUB_ISSUE_DEPENDENCY_API_VERSION,
      body: { issue_id: blockingIssueId },
      errorMessage: "GitHub Dependency konnte nicht erstellt werden",
    },
  );
}

async function removeGitHubIssueBlockedBy(
  issueNumber: number,
  blockingIssueId: number,
  token: string,
  repository: string,
) {
  const { owner, repo } = splitGitHubRepository(repository);
  await githubRequest(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/dependencies/blocked_by/${blockingIssueId}`,
    {
      token,
      method: "DELETE",
      operation: "mutation",
      apiVersion: GITHUB_ISSUE_DEPENDENCY_API_VERSION,
      errorMessage: "GitHub Dependency konnte nicht entfernt werden",
      allowedStatuses: [404],
    },
  );
}

export async function projectTaskGitHubDependencies({
  supabase,
  taskId,
  currentIssueNumber,
  repository,
  token,
}: {
  supabase: SupabaseClient;
  taskId: string;
  currentIssueNumber: number;
  repository: string;
  token: string;
}) {
  const current: GitHubIssueCoordinate = {
    repository: splitGitHubRepository(repository).repository,
    issueNumber: currentIssueNumber,
  };
  const { desiredDependencies, managedIssueCoordinates } = await loadDependencyContext(
    supabase,
    taskId,
    currentIssueNumber,
    current.repository,
  );
  const managedCoordinates = new Set(managedIssueCoordinates.map(coordinateKey));
  const desiredBlockingCurrent = new Map<string, GitHubIssueCoordinate>();
  const desiredBlockedByCurrent = new Map<string, GitHubIssueCoordinate>();
  for (const dependency of desiredDependencies) {
    if (sameCoordinate(dependency.blocked, current)) {
      desiredBlockingCurrent.set(coordinateKey(dependency.blocking), dependency.blocking);
    }
    if (sameCoordinate(dependency.blocking, current)) {
      desiredBlockedByCurrent.set(coordinateKey(dependency.blocked), dependency.blocked);
    }
  }

  const issueCache = new Map<string, GitHubIssueReference>();
  const issueReference = async (coordinate: GitHubIssueCoordinate) => {
    const key = coordinateKey(coordinate);
    const cached = issueCache.get(key);
    if (cached) return cached;
    const issue = await getGitHubIssue(coordinate.issueNumber, token, coordinate.repository);
    if (issue.number !== coordinate.issueNumber) {
      throw new Error("GitHub Issue identity changed during dependency projection.");
    }
    issueCache.set(key, issue);
    return issue;
  };

  let added = 0;
  let removed = 0;
  const [existingBlockedBy, existingBlocking] = await Promise.all([
    listGitHubIssueBlockedBy(current.issueNumber, token, current.repository),
    listGitHubIssuesBlocking(current.issueNumber, token, current.repository),
  ]);
  const existingManagedBlockedBy = new Map<string, Readonly<{
    dependency: GitHubIssueDependency;
    coordinate: GitHubIssueCoordinate;
  }>>();
  for (const dependency of existingBlockedBy) {
    const coordinate = dependencyCoordinate(dependency, current.repository);
    if (coordinate && managedCoordinates.has(coordinateKey(coordinate))) {
      existingManagedBlockedBy.set(coordinateKey(coordinate), { dependency, coordinate });
    }
  }
  const existingManagedBlocking = new Map<string, Readonly<{
    dependency: GitHubIssueDependency;
    coordinate: GitHubIssueCoordinate;
  }>>();
  for (const dependency of existingBlocking) {
    const coordinate = dependencyCoordinate(dependency, current.repository);
    if (coordinate && managedCoordinates.has(coordinateKey(coordinate))) {
      existingManagedBlocking.set(coordinateKey(coordinate), { dependency, coordinate });
    }
  }

  for (const [key, blockingCoordinate] of desiredBlockingCurrent) {
    if (existingManagedBlockedBy.has(key)) continue;
    const blockingIssue = await issueReference(blockingCoordinate);
    await addGitHubIssueBlockedBy(current.issueNumber, blockingIssue.id, token, current.repository);
    added += 1;
  }
  for (const [key, existing] of existingManagedBlockedBy) {
    if (desiredBlockingCurrent.has(key)) continue;
    await removeGitHubIssueBlockedBy(
      current.issueNumber,
      existing.dependency.id,
      token,
      current.repository,
    );
    removed += 1;
  }

  let currentIssue: GitHubIssueReference | null = null;
  const currentIssueReference = async () => {
    currentIssue ||= await issueReference(current);
    return currentIssue;
  };
  for (const [key, blockedCoordinate] of desiredBlockedByCurrent) {
    if (existingManagedBlocking.has(key)) continue;
    const blockingIssue = await currentIssueReference();
    await addGitHubIssueBlockedBy(
      blockedCoordinate.issueNumber,
      blockingIssue.id,
      token,
      blockedCoordinate.repository,
    );
    added += 1;
  }
  for (const [key, existing] of existingManagedBlocking) {
    if (desiredBlockedByCurrent.has(key)) continue;
    const blockingIssue = await currentIssueReference();
    await removeGitHubIssueBlockedBy(
      existing.coordinate.issueNumber,
      blockingIssue.id,
      token,
      existing.coordinate.repository,
    );
    removed += 1;
  }

  return { added, removed };
}
