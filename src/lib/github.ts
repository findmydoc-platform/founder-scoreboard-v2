import type { LinkedPullRequest } from "./types";
import { githubGraphql } from "./github-graphql";
import { GITHUB_ISSUE_DEPENDENCY_API_VERSION, githubJson } from "./github-http";
import { normalizeGitHubRepository, requireAllowedGitHubRepository, splitGitHubRepository } from "./github-repositories";

export { GitHubApiError } from "./github-http";

export function hasGitHubSyncEnv() {
  return true;
}

export function githubRepoSlug(repository?: string | null) {
  return requireAllowedGitHubRepository(repository);
}

export function isGitHubIssueApiUrl(
  value: string,
  issueNumber: number,
  repository?: string | null,
) {
  const { owner, repo } = splitGitHubRepository(repository);
  try {
    const url = new URL(value);
    const expectedPath = `/repos/${owner}/${repo}/issues/${issueNumber}`.toLowerCase();
    return url.protocol === "https:"
      && url.hostname.toLowerCase() === "api.github.com"
      && url.pathname.replace(/\/$/, "").toLowerCase() === expectedPath;
  } catch {
    return false;
  }
}

function githubRawUrl(path: string, repository?: string | null) {
  const { owner, repo } = splitGitHubRepository(repository);
  const branch = process.env.GITHUB_SYNC_BRANCH || "main";
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export async function githubUserForToken(token: string) {
  return githubJson<{ login: string }>("https://api.github.com/user", {
    token,
    errorMessage: "GitHub-Verbindung konnte nicht geprüft werden",
  });
}

type SubIssueRelationshipData = {
  parentRepository?: {
    issue?: { id?: string; number?: number; url?: string } | null;
  } | null;
  childRepository?: {
    issue?: {
      id?: string;
      number: number;
      url: string;
      repository: { nameWithOwner: string };
      parent?: {
        number: number;
        url: string;
        repository: { nameWithOwner: string };
      } | null;
    } | null;
  } | null;
};

export async function connectGitHubSubIssue({
  parentRepository,
  parentIssueNumber,
  childRepository,
  childIssueNumber,
  token,
}: {
  parentRepository: string;
  parentIssueNumber: number;
  childRepository: string;
  childIssueNumber: number;
  token: string;
}) {
  const parent = splitGitHubRepository(parentRepository);
  const child = splitGitHubRepository(childRepository);
  const query = `query(
    $parentOwner: String!,
    $parentRepo: String!,
    $parentNumber: Int!,
    $childOwner: String!,
    $childRepo: String!,
    $childNumber: Int!
  ) {
    parentRepository: repository(owner: $parentOwner, name: $parentRepo) {
      issue(number: $parentNumber) { id number url }
    }
    childRepository: repository(owner: $childOwner, name: $childRepo) {
      issue(number: $childNumber) {
        id
        number
        url
        repository { nameWithOwner }
        parent { number url repository { nameWithOwner } }
      }
    }
  }`;
  const relationship = await githubGraphql<SubIssueRelationshipData>({
    query,
    variables: {
      parentOwner: parent.owner,
      parentRepo: parent.repo,
      parentNumber: parentIssueNumber,
      childOwner: child.owner,
      childRepo: child.repo,
      childNumber: childIssueNumber,
    },
    token,
    operation: "read",
    errorMessage: "GitHub Sub-Issue-Beziehung konnte nicht geprüft werden",
  });
  const parentIssue = relationship.parentRepository?.issue;
  if (!parentIssue) throw new Error("GitHub Parent-Issue wurde nicht gefunden.");
  if (!parentIssue.id) throw new Error("GitHub Parent-Issue-Node-ID wurde nicht gefunden.");

  const childIssue = relationship.childRepository?.issue;
  if (!childIssue) throw new Error("GitHub Sub-Issue wurde nicht gefunden.");
  if (!childIssue.id) throw new Error("GitHub Sub-Issue-Node-ID wurde nicht gefunden.");

  const currentParent = childIssue.parent;
  const alreadyConnected = currentParent?.number === parentIssueNumber
    && currentParent.repository.nameWithOwner.toLowerCase() === parent.repository.toLowerCase();
  if (alreadyConnected) {
    return {
      addSubIssue: {
        issue: {
          number: parentIssue.number || parentIssueNumber,
          url: parentIssue.url || `https://github.com/${parent.repository}/issues/${parentIssueNumber}`,
        },
        subIssue: childIssue,
      },
    };
  }

  const mutation = `mutation($parent: ID!, $child: ID!) {
    addSubIssue(input: { issueId: $parent, subIssueId: $child, replaceParent: true }) {
      issue { number url }
      subIssue { number url repository { nameWithOwner } parent { number url repository { nameWithOwner } } }
    }
  }`;
  return githubGraphql<unknown>({
    query: mutation,
    variables: { parent: parentIssue.id, child: childIssue.id },
    token,
    operation: "mutation",
    errorMessage: "GitHub Sub-Issue-Beziehung konnte nicht erstellt werden",
  });
}

type LinkedPullRequestData = {
  repository?: {
    issue?: {
      closedByPullRequestsReferences?: {
        nodes?: Array<{
          title?: string | null;
          number?: number | null;
          url?: string | null;
          state?: string | null;
          merged?: boolean | null;
          mergedAt?: string | null;
          repository?: { nameWithOwner?: string | null } | null;
        } | null>;
      } | null;
    } | null;
  } | null;
};

export async function listGitHubIssueLinkedPullRequests(
  issueNumber: number,
  token: string,
  repository?: string | null,
): Promise<LinkedPullRequest[]> {
  const { owner, repo } = splitGitHubRepository(repository);
  const query = `query($owner: String!, $repo: String!, $issueNumber: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $issueNumber) {
        closedByPullRequestsReferences(
          first: 100
          includeClosedPrs: true
          userLinkedOnly: false
        ) {
          nodes {
            title
            number
            url
            state
            merged
            mergedAt
            repository { nameWithOwner }
          }
        }
      }
    }
  }`;
  const data = await githubGraphql<LinkedPullRequestData>({
    query,
    variables: { owner, repo, issueNumber },
    token,
    operation: "read",
    errorMessage: "Verknüpfte GitHub Pull Requests konnten nicht geladen werden",
  });
  const issue = data.repository?.issue;
  if (!issue) throw new Error(`GitHub Issue ${owner}/${repo}#${issueNumber} wurde nicht gefunden.`);

  return (issue.closedByPullRequestsReferences?.nodes || []).flatMap((pullRequest): LinkedPullRequest[] => {
    const title = pullRequest?.title?.trim() || "";
    const number = pullRequest?.number || 0;
    const url = pullRequest?.url || "";
    const pullRequestRepository = pullRequest?.repository?.nameWithOwner || "";
    if (!title || number <= 0 || !url || !pullRequestRepository) return [];
    return [{
      title,
      number,
      repository: pullRequestRepository,
      url,
      status: pullRequest?.merged ? "merged" : pullRequest?.state === "OPEN" ? "open" : "closed",
      ...(pullRequest?.mergedAt ? { mergedAt: pullRequest.mergedAt } : {}),
    }];
  });
}

export async function archiveGitHubIssue(issueNumber: number, token: string, repository?: string | null) {
  const { owner, repo } = splitGitHubRepository(repository);
  return githubJson<{ number: number; html_url: string }>(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
    {
      token,
      method: "PATCH",
      operation: "mutation",
      body: {
        state: "closed",
        state_reason: "not_planned",
        labels: ["task", "test/deleted"],
      },
      errorMessage: "GitHub Issue konnte nicht geschlossen werden",
    },
  );
}

export type GitHubIssueComment = {
  id: number;
  body: string;
  html_url: string;
  issue_url?: string;
  created_at: string;
  updated_at?: string;
  user?: {
    login?: string;
    avatar_url?: string;
  } | null;
};

export async function createGitHubIssueComment(
  issueNumber: number,
  comment: string,
  token: string,
  marker?: string,
  repository?: string | null,
) {
  const { owner, repo } = splitGitHubRepository(repository);
  return githubJson<{ id: number; html_url: string }>(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    {
      token,
      method: "POST",
      operation: "mutation",
      body: {
        body: marker ? `${comment}\n\n<!-- ${marker} -->` : comment,
      },
      errorMessage: "GitHub Kommentar konnte nicht erstellt werden",
    },
  );
}

export async function listGitHubIssueComments(
  issueNumber: number,
  token: string,
  repository?: string | null,
) {
  const { owner, repo } = splitGitHubRepository(repository);
  const comments: GitHubIssueComment[] = [];

  for (let page = 1; page <= 100; page += 1) {
    const pageComments = await githubJson<typeof comments>(
      `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
      {
        token,
        cache: "no-store",
        errorMessage: "GitHub Kommentare konnten nicht geladen werden",
      },
    );
    comments.push(...pageComments);
    if (pageComments.length < 100) break;
  }

  return comments;
}

export async function getGitHubIssueComment(
  commentId: number,
  token: string,
  repository?: string | null,
) {
  const { owner, repo } = splitGitHubRepository(repository);
  return githubJson<GitHubIssueComment>(
    `https://api.github.com/repos/${owner}/${repo}/issues/comments/${commentId}`,
    {
      token,
      cache: "no-store",
      errorMessage: "GitHub Kommentar konnte nicht geladen werden",
    },
  );
}

export async function getGitHubIssue(
  issueNumber: number,
  token: string,
  repository?: string | null,
) {
  const { owner, repo } = splitGitHubRepository(repository);
  return githubJson<{
    id: number;
    node_id?: string;
    number: number;
    title?: string;
    body?: string | null;
    html_url: string;
    state?: "open" | "closed";
    updated_at?: string;
    labels?: Array<string | { name?: string | null }>;
    assignees?: Array<{ id?: number; login?: string }>;
    pull_request?: unknown;
  }>(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
    token,
    cache: "no-store",
    errorMessage: "GitHub Issue konnte nicht geladen werden",
  });
}

export async function listGitHubIssueBlockedBy(
  issueNumber: number,
  token: string,
  repository?: string | null,
) {
  const { owner, repo } = splitGitHubRepository(repository);
  const dependencies = await githubJson<Array<{
    id: number;
    number: number;
    html_url: string;
    repository_url?: string;
  }>>(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/dependencies/blocked_by?per_page=100`,
    {
      token,
      apiVersion: GITHUB_ISSUE_DEPENDENCY_API_VERSION,
      cache: "no-store",
      errorMessage: "GitHub Dependency konnte nicht gelesen werden",
    },
  );
  return dependencies.map((dependency) => {
    let repositoryFullName: string | null = null;
    try {
      const repositoryUrl = new URL(dependency.repository_url || "");
      const match = repositoryUrl.hostname.toLowerCase() === "api.github.com"
        ? repositoryUrl.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/?$/i)
        : null;
      repositoryFullName = match
        ? normalizeGitHubRepository(`${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`)
        : null;
    } catch {
      repositoryFullName = null;
    }
    return { ...dependency, repositoryFullName };
  });
}

export async function uploadGitHubAttachment(
  path: string,
  content: Buffer,
  token: string,
  message = "Add Founder Scoreboard attachment",
  repository?: string | null,
) {
  const { owner, repo } = splitGitHubRepository(repository);
  const result = await githubJson<{
    content?: {
      download_url?: string | null;
      html_url?: string | null;
    };
  }>(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`,
    {
      token,
      method: "PUT",
      operation: "mutation",
      body: {
        message,
        content: content.toString("base64"),
        branch: process.env.GITHUB_SYNC_BRANCH || "main",
      },
      errorMessage: "GitHub-Anhang konnte nicht gespeichert werden",
    },
  );
  return {
    rawUrl: result.content?.download_url || githubRawUrl(path, repository),
    htmlUrl: result.content?.html_url || "",
  };
}
