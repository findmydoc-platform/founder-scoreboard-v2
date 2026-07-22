export const DEFAULT_GITHUB_PROJECT_OWNER = "findmydoc-platform";
export const DEFAULT_GITHUB_PROJECT_NUMBER = 21;

export const FOUNDEROPS_GITHUB_REPOSITORIES = [
  "findmydoc-platform/management",
  "findmydoc-platform/website",
  "findmydoc-platform/clinic-dashboard",
] as const;

export const FOUNDEROPS_GITHUB_PROJECT_FIELDS = [
  { name: "Status", dataType: "SINGLE_SELECT" },
  { name: "Sprint", dataType: "ITERATION" },
  { name: "Workstream", dataType: "SINGLE_SELECT" },
  { name: "Estimate hours", dataType: "NUMBER" },
  { name: "Evidence URL", dataType: "TEXT" },
  { name: "Priority", dataType: "SINGLE_SELECT" },
  { name: "Effort", dataType: "SINGLE_SELECT" },
  { name: "Start date", dataType: "DATE" },
  { name: "Target date", dataType: "DATE" },
] as const;

export function validGitHubProjectOwner(value: unknown): value is string {
  return typeof value === "string"
    && value === value.trim()
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value);
}

export function validGitHubProjectNumber(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

export function githubProjectUrl(owner: string, number: number) {
  return `https://github.com/orgs/${encodeURIComponent(owner)}/projects/${number}`;
}
