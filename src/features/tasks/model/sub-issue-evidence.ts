import type { LinkedPullRequest, Task } from "@/lib/types";
import { parseEvidenceUrl } from "./task-evidence-links";

type EvidenceSource = Pick<Task, "id" | "title">;

export type SubIssueEvidenceEntry = {
  url: string;
  pullRequest?: LinkedPullRequest;
  sources: EvidenceSource[];
};

export type SubIssueEvidenceGroup = {
  source: EvidenceSource;
  entries: SubIssueEvidenceEntry[];
};

export function subIssueEvidenceSummary(
  parent: Pick<Task, "id" | "taskType">,
  tasks: readonly Task[],
): { count: number; groups: SubIssueEvidenceGroup[] } {
  if (parent.taskType !== "deliverable") return { count: 0, groups: [] };
  const children = tasks
    .filter((task) => task.taskType === "sub_issue" && task.parentTaskId === parent.id && !task.trashedAt)
    .slice().sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const entries = new Map<string, SubIssueEvidenceEntry>();
  for (const child of children) {
    const source = { id: child.id, title: child.title };
    const links = [
      ...child.linkedPullRequests.map((pullRequest) => ({ url: pullRequest.url, pullRequest })),
      ...child.evidenceLinks.map((url) => ({ url, pullRequest: undefined })),
    ];
    for (const link of links) {
      const url = parseEvidenceUrl(link.url)?.href;
      if (!url) continue;
      const existing = entries.get(url);
      if (existing) {
        if (!existing.sources.some((item) => item.id === source.id)) existing.sources.push(source);
        existing.pullRequest ??= link.pullRequest;
      } else {
        entries.set(url, { url, pullRequest: link.pullRequest, sources: [source] });
      }
    }
  }
  const groups = children.flatMap((child) => {
    const ownedEntries = [...entries.values()].filter((entry) => entry.sources[0].id === child.id);
    return ownedEntries.length ? [{ source: { id: child.id, title: child.title }, entries: ownedEntries }] : [];
  });
  return { count: entries.size, groups };
}
