import { expect, it } from "vitest";
import { subIssueEvidenceSummary } from "@/features/tasks/model/sub-issue-evidence";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { taskHasValidReviewEvidence } from "@/features/reviews/model/review-evidence";

it("groups unique evidence by direct active Sub-Issue and retains every source", () => {
  const parent = taskDetailStoryTask({ id: "parent" });
  const shared = { title: "Connect form", repository: "example/web", number: 42,
    url: "https://github.com/example/web/pull/42", status: "merged" as const };
  const first = taskDetailStoryTask({ id: "first", title: "Formular prüfen", taskType: "sub_issue", parentTaskId: parent.id,
    evidenceLinks: ["https://example.com/form"], linkedPullRequests: [shared] });
  const second = taskDetailStoryTask({ id: "second", title: "Weiterleitungen prüfen", taskType: "sub_issue", parentTaskId: parent.id,
    evidenceLinks: [shared.url, "https://example.com/redirect"], linkedPullRequests: [shared] });
  const ignored = [
    { ...first, id: "unrelated", parentTaskId: "another-parent", evidenceLinks: ["https://example.com/unrelated"] },
    { ...first, id: "trashed", trashedAt: "2026-10-13T12:00:00Z", evidenceLinks: ["https://example.com/trashed"] },
    { ...first, id: "wrong-type", taskType: "deliverable" as const, evidenceLinks: ["https://example.com/deliverable"] },
  ];
  const result = subIssueEvidenceSummary(parent, [first, second, ...ignored]);
  expect(result.count).toBe(3);
  expect(result.groups.map((group) => [group.source.id, group.entries.map((entry) => entry.url)])).toEqual([
    ["first", [shared.url, "https://example.com/form"]],
    ["second", ["https://example.com/redirect"]],
  ]);
  expect(result.groups[0].entries[0].sources.map((source) => source.id)).toEqual(["first", "second"]);
  expect(result.groups[0].entries[0].pullRequest).toEqual(shared);
  expect(parent.evidenceLinks).toEqual([]);
  expect(taskHasValidReviewEvidence(parent, [first, second])).toBe(true);
});

it("does not inherit evidence through unrelated, trashed or strategic items", () => {
  const parent = taskDetailStoryTask({ id: "parent" });
  const child = taskDetailStoryTask({ id: "child", taskType: "sub_issue", parentTaskId: "other",
    evidenceLinks: ["https://example.com/proof"] });
  expect(taskHasValidReviewEvidence(parent, [child])).toBe(false);
  expect(taskHasValidReviewEvidence(parent, [{ ...child, parentTaskId: parent.id, trashedAt: "2026-10-13" }])).toBe(false);
  expect(subIssueEvidenceSummary({ ...parent, taskType: "initiative" }, [{ ...child, parentTaskId: parent.id }])).toEqual({ count: 0, groups: [] });
  expect(subIssueEvidenceSummary(parent, [{ ...child, parentTaskId: parent.id, evidenceLinks: ["javascript:alert(1)"] }])).toEqual({ count: 0, groups: [] });
});
