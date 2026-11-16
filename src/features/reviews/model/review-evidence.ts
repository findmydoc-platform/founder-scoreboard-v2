import type { Task } from "@/lib/types";
import { subIssueEvidenceSummary, type SubIssueEvidenceReadContext } from "@/features/tasks/model/sub-issue-evidence";

export type ReviewEvidenceSubmission = Readonly<{
  evidenceLink?: string;
  evidenceExceptionNote?: string;
}>;

export type StoredReviewEvidenceLink = Readonly<{
  type: string;
  url: string;
  metadata?: unknown;
}>;

export function taskReviewEvidenceStatus(
  task: Pick<Task, "evidenceLinks" | "linkedPullRequests"> & Partial<Pick<Task, "id" | "taskType" | "detailAvailability">>,
  tasks: readonly Task[] = [],
  context: SubIssueEvidenceReadContext = {},
): "present" | "absent" | "unknown" {
  const current = task.detailAvailability !== "summary" && task.detailAvailability !== "stale";
  const hasLinks = Array.isArray(task.evidenceLinks), hasPullRequests = Array.isArray(task.linkedPullRequests);
  if (current && (hasLinks && task.evidenceLinks.length > 0 || hasPullRequests && task.linkedPullRequests.length > 0)) return "present";
  const inherited = task.id && task.taskType ? subIssueEvidenceSummary({ id: task.id, taskType: task.taskType }, tasks, context) : { count: 0, groups: [] };
  if (inherited.count === null ? inherited.knownCount > 0 : inherited.count > 0) return "present";
  return !current || !hasLinks || !hasPullRequests || inherited.count === null ? "unknown" : "absent";
}

export function taskHasValidReviewEvidence(
  task: Pick<Task, "evidenceLinks" | "linkedPullRequests"> & Partial<Pick<Task, "id" | "taskType" | "detailAvailability">>,
  tasks: readonly Task[] = [],
) {
  return taskReviewEvidenceStatus(task, tasks) === "present";
}

export function validReviewEvidenceUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function storedReviewEvidenceLinkIsValid(link: StoredReviewEvidenceLink) {
  if (!validReviewEvidenceUrl(link.url)) return false;
  if (link.type === "evidence") return true;
  if (link.type !== "github_pull_request") return false;
  const metadata = link.metadata && typeof link.metadata === "object" && !Array.isArray(link.metadata)
    ? link.metadata as Record<string, unknown>
    : {};
  const number = typeof metadata.number === "number" ? metadata.number : Number(metadata.number);
  return typeof metadata.repository === "string"
    && Boolean(metadata.repository.trim())
    && Number.isInteger(number)
    && number > 0
    && ["open", "merged", "closed"].includes(String(metadata.status || ""));
}

export function storedReviewEvidenceIsValid(
  legacyEvidenceLink: string | null | undefined,
  links: readonly StoredReviewEvidenceLink[],
) {
  return validReviewEvidenceUrl(legacyEvidenceLink || "")
    || links.some(storedReviewEvidenceLinkIsValid);
}
