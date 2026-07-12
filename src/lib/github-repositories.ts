import type { TaskType } from "@/lib/types";

export const defaultGitHubRepository = "findmydoc-platform/management";

export const allowedGitHubRepositories = new Set([
  defaultGitHubRepository,
  "findmydoc-platform/website",
  "findmydoc-platform/clinic-dashboard",
]);

export function normalizeGitHubRepository(value?: string | null) {
  const repository = (value || defaultGitHubRepository).trim();
  return allowedGitHubRepositories.has(repository) ? repository : null;
}

export type TaskGitHubRepositoryPolicy =
  | { ok: true; repository: string }
  | { ok: false; error: string };

export function resolveTaskGitHubRepository(taskType: TaskType, value?: string | null): TaskGitHubRepositoryPolicy {
  const repository = normalizeGitHubRepository(value);
  if (!repository) return { ok: false, error: "GitHub-Ziel-Repository ist nicht freigegeben." };
  if (taskType === "deliverable" && repository !== defaultGitHubRepository) {
    return { ok: false, error: "Deliverables werden ausschließlich nach findmydoc-platform/management projiziert." };
  }
  return { ok: true, repository };
}

export function requireAllowedGitHubRepository(value?: string | null) {
  const repository = normalizeGitHubRepository(value);
  if (!repository) throw new Error("GitHub-Ziel-Repository ist nicht freigegeben.");
  return repository;
}

export function splitGitHubRepository(value?: string | null) {
  const repository = requireAllowedGitHubRepository(value);
  const [owner, repo] = repository.split("/");
  return { owner, repo, repository };
}
