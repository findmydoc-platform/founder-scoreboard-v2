import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GITHUB_ISSUE_DEPENDENCY_API_VERSION,
  githubJson,
  githubRequest,
} from "../github-http";
import { resolveGitHubIssueNumber } from "../github-issue-reference";
import { splitGitHubRepository } from "../github-repositories";

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
};

type GitHubIssueDependencyInput = {
  blockedIssueNumber: number;
  blockingIssueNumber: number;
};

function rowIssueNumber(
  row: RelationshipTaskRow,
  currentTaskId: string,
  currentIssueNumber: number,
  repository: string,
) {
  if (row.id === currentTaskId) return currentIssueNumber;
  if (row.github_repo && row.github_repo !== repository) return null;
  return resolveGitHubIssueNumber(row, { repository });
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

  const issueNumberByTaskId = new Map<string, number>();
  const managedIssueNumbers = new Set<number>();
  for (const row of (linkedTasks.data || []) as RelationshipTaskRow[]) {
    const issueNumber = rowIssueNumber(row, taskId, currentIssueNumber, repository);
    if (!issueNumber) continue;
    issueNumberByTaskId.set(row.id, issueNumber);
    managedIssueNumbers.add(issueNumber);
  }

  const relationshipById = new Map<number, RelationshipRow>();
  for (const relationship of [...(outgoingRelationships.data || []), ...(incomingRelationships.data || [])] as RelationshipRow[]) {
    relationshipById.set(relationship.id, relationship);
  }

  const desiredDependencies = new Map<string, GitHubIssueDependencyInput>();
  for (const relationship of relationshipById.values()) {
    const blockedTaskId = relationship.relation_type === "blocks" ? relationship.related_task_id : relationship.task_id;
    const blockingTaskId = relationship.relation_type === "blocks" ? relationship.task_id : relationship.related_task_id;
    const blockedIssueNumber = issueNumberByTaskId.get(blockedTaskId);
    const blockingIssueNumber = issueNumberByTaskId.get(blockingTaskId);
    if (!blockedIssueNumber || !blockingIssueNumber || blockedIssueNumber === blockingIssueNumber) continue;

    desiredDependencies.set(`${blockedIssueNumber}:${blockingIssueNumber}`, {
      blockedIssueNumber,
      blockingIssueNumber,
    });
  }

  return {
    desiredDependencies: [...desiredDependencies.values()],
    managedIssueNumbers: [...managedIssueNumbers],
  };
}

async function listGitHubIssueBlockedBy(issueNumber: number, token: string, repository: string) {
  const { owner, repo } = splitGitHubRepository(repository);
  return githubJson<GitHubIssueDependency[]>(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/dependencies/blocked_by?per_page=100`,
    {
      token,
      apiVersion: GITHUB_ISSUE_DEPENDENCY_API_VERSION,
      cache: "no-store",
      errorMessage: "GitHub Dependencies konnten nicht geladen werden",
    },
  );
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
  const { desiredDependencies, managedIssueNumbers } = await loadDependencyContext(
    supabase,
    taskId,
    currentIssueNumber,
    repository,
  );
  const managedNumbers = new Set(managedIssueNumbers);
  const desiredBlockingCurrent = new Set<number>();
  const desiredBlockedByCurrent = new Set<number>();
  for (const dependency of desiredDependencies) {
    if (dependency.blockedIssueNumber === currentIssueNumber) {
      desiredBlockingCurrent.add(dependency.blockingIssueNumber);
    }
    if (dependency.blockingIssueNumber === currentIssueNumber) {
      desiredBlockedByCurrent.add(dependency.blockedIssueNumber);
    }
  }

  const issueCache = new Map<number, GitHubIssueReference>();
  const issueReference = async (issueNumber: number) => {
    const cached = issueCache.get(issueNumber);
    if (cached) return cached;
    const issue = await getGitHubIssue(issueNumber, token, repository);
    issueCache.set(issueNumber, issue);
    return issue;
  };

  let added = 0;
  let removed = 0;
  const [existingBlockedBy, existingBlocking] = await Promise.all([
    listGitHubIssueBlockedBy(currentIssueNumber, token, repository),
    listGitHubIssuesBlocking(currentIssueNumber, token, repository),
  ]);
  const existingManagedBlockedBy = new Map(
    existingBlockedBy
      .filter((dependency) => managedNumbers.has(dependency.number))
      .map((dependency) => [dependency.number, dependency]),
  );
  const existingManagedBlocking = new Map(
    existingBlocking
      .filter((dependency) => managedNumbers.has(dependency.number))
      .map((dependency) => [dependency.number, dependency]),
  );

  for (const blockingIssueNumber of desiredBlockingCurrent) {
    if (existingManagedBlockedBy.has(blockingIssueNumber)) continue;
    const blockingIssue = await issueReference(blockingIssueNumber);
    await addGitHubIssueBlockedBy(currentIssueNumber, blockingIssue.id, token, repository);
    added += 1;
  }
  for (const existingDependency of existingManagedBlockedBy.values()) {
    if (desiredBlockingCurrent.has(existingDependency.number)) continue;
    await removeGitHubIssueBlockedBy(
      currentIssueNumber,
      existingDependency.id,
      token,
      repository,
    );
    removed += 1;
  }

  let currentIssue: GitHubIssueReference | null = null;
  const currentIssueReference = async () => {
    currentIssue ||= await issueReference(currentIssueNumber);
    return currentIssue;
  };
  for (const blockedIssueNumber of desiredBlockedByCurrent) {
    if (existingManagedBlocking.has(blockedIssueNumber)) continue;
    const blockingIssue = await currentIssueReference();
    await addGitHubIssueBlockedBy(blockedIssueNumber, blockingIssue.id, token, repository);
    added += 1;
  }
  for (const existingDependency of existingManagedBlocking.values()) {
    if (desiredBlockedByCurrent.has(existingDependency.number)) continue;
    const blockingIssue = await currentIssueReference();
    await removeGitHubIssueBlockedBy(
      existingDependency.number,
      blockingIssue.id,
      token,
      repository,
    );
    removed += 1;
  }

  return { added, removed };
}
