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

export type SubIssueEvidenceReadContext = Readonly<{ membershipComplete?: boolean }>;
export type SubIssueEvidenceSummary =
  | { count: number; groups: SubIssueEvidenceGroup[] }
  | { count: null; coverage: "partial" | "unknown"; knownCount: number; groups: SubIssueEvidenceGroup[]; retainedGroups: SubIssueEvidenceGroup[] };

export function subIssueEvidenceSummary(
  parent: Pick<Task, "id" | "taskType">,
  tasks: readonly Task[],
  context: SubIssueEvidenceReadContext = {},
): SubIssueEvidenceSummary {
  if (parent.taskType !== "deliverable") return { count: 0, groups: [] };
  const children = tasks
    .filter((task) => task.taskType === "sub_issue" && task.parentTaskId === parent.id && !task.trashedAt)
    .slice().sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const currentEntries = new Map<string, SubIssueEvidenceEntry>();
  const retainedEntries = new Map<string, SubIssueEvidenceEntry>();
  let incomplete = context.membershipComplete === false;
  for (const child of children) {
    const source = { id: child.id, title: child.title };
    const hasPullRequests = Array.isArray(child.linkedPullRequests), hasEvidenceLinks = Array.isArray(child.evidenceLinks);
    const current = child.detailAvailability !== "summary" && child.detailAvailability !== "stale";
    if (!current || !hasPullRequests || !hasEvidenceLinks) incomplete = true;
    const entries = current ? currentEntries : retainedEntries;
    // Missing fields establish no negative evidence. Present stale fields remain
    // visible separately and cannot certify a current review prerequisite.
    const links = [
      ...(hasPullRequests ? child.linkedPullRequests.map((pullRequest) => ({ url: pullRequest.url, pullRequest })) : []),
      ...(hasEvidenceLinks ? child.evidenceLinks.map((url) => ({ url, pullRequest: undefined })) : []),
    ];
    for (const link of links) {
      const url = parseEvidenceUrl(link.url)?.href;
      if (!url) continue;
      const existing = entries.get(url);
      if (existing) {
        if (!existing.sources.some((item) => item.id === source.id)) existing.sources.push(source);
        existing.pullRequest ??= link.pullRequest;
      } else entries.set(url, { url, pullRequest: link.pullRequest, sources: [source] });
    }
  }
  const groupsFor = (entries: Map<string, SubIssueEvidenceEntry>) => children.flatMap((child) => {
    const ownedEntries = [...entries.values()].filter((entry) => entry.sources[0].id === child.id);
    return ownedEntries.length ? [{ source: { id: child.id, title: child.title }, entries: ownedEntries }] : [];
  });
  const groups = groupsFor(currentEntries);
  if (!incomplete) return { count: currentEntries.size, groups };
  for (const url of currentEntries.keys()) retainedEntries.delete(url);
  return { count: null, coverage: currentEntries.size ? "partial" : "unknown", knownCount: currentEntries.size, groups, retainedGroups: groupsFor(retainedEntries) };
}
