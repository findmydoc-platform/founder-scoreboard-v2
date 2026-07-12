export type GitHubIssueFields = {
  githubRepo?: string | null;
  github_repo?: string | null;
  githubIssueNumber?: number | null;
  github_issue_number?: number | null;
  githubIssueUrl?: string | null;
  github_issue_url?: string | null;
  issueNumber?: string | null;
  issue_number?: string | null;
  issueUrl?: string | null;
  issue_url?: string | null;
};

export type GitHubIssueUrlReference = {
  repository: string;
  number: number;
};

export function parseGitHubIssueUrl(value?: string | null): GitHubIssueUrlReference | null {
  const match = (value || "").match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)(?:$|[?#])/i);
  return match ? { repository: match[1], number: Number(match[2]) } : null;
}

function positiveInteger(value: unknown) {
  const number = Number(value || 0);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function issueUrls(fields: GitHubIssueFields) {
  return [fields.githubIssueUrl, fields.github_issue_url, fields.issueUrl, fields.issue_url];
}

export function resolveGitHubIssueNumber(
  fields: GitHubIssueFields,
  options: { repository?: string | null; fallback?: number | null } = {},
) {
  const directIssueNumber = positiveInteger(fields.githubIssueNumber ?? fields.github_issue_number);
  if (directIssueNumber) return directIssueNumber;

  const legacyIssueNumber = positiveInteger(fields.issueNumber ?? fields.issue_number);
  if (legacyIssueNumber) return legacyIssueNumber;

  for (const value of issueUrls(fields)) {
    const issue = parseGitHubIssueUrl(value);
    if (!issue || (options.repository && issue.repository !== options.repository)) continue;
    return issue.number;
  }
  return positiveInteger(options.fallback);
}

export function assertGitHubIssueRepository(fields: GitHubIssueFields, repository: string) {
  for (const value of issueUrls(fields)) {
    const issue = parseGitHubIssueUrl(value);
    if (issue && issue.repository !== repository) {
      throw new Error(`Verknüpftes GitHub Issue gehört zu ${issue.repository} statt ${repository}.`);
    }
  }
}
