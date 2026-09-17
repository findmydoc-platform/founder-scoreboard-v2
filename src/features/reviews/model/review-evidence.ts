import type { Task } from "@/lib/types";

export type ReviewEvidenceSubmission = Readonly<{
  evidenceLink?: string;
  evidenceExceptionNote?: string;
}>;

export type StoredReviewEvidenceLink = Readonly<{
  type: string;
  url: string;
  metadata?: unknown;
}>;

export function taskHasValidReviewEvidence(task: Pick<Task, "evidenceLinks" | "linkedPullRequests">) {
  return task.evidenceLinks.length > 0 || task.linkedPullRequests.length > 0;
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
