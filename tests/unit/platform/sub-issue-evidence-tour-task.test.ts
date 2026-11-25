import { expect, it } from "vitest";
import { selectSubIssueEvidenceTourTask } from "@/features/product-tours/model/sub-issue-evidence-tour-task";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";

it("opens a Deliverable with inherited evidence even if a different item is selected", () => {
  const selected = taskDetailStoryTask({ id: "selected" });
  const parent = taskDetailStoryTask({ id: "parent" });
  const child = taskDetailStoryTask({ id: "child", taskType: "sub_issue", parentTaskId: parent.id,
    evidenceLinks: ["https://example.com/proof"] });
  expect(selectSubIssueEvidenceTourTask([selected, parent, child], selected.id)?.id).toBe(parent.id);
  expect(selectSubIssueEvidenceTourTask([selected, parent, child], child.id)?.id).toBe(parent.id);
});

it("falls back to an active Deliverable without inventing sample evidence", () => {
  const parent = taskDetailStoryTask({ id: "parent" });
  const trashed = taskDetailStoryTask({ id: "trashed", trashedAt: "2026-10-13" });
  expect(selectSubIssueEvidenceTourTask([trashed, parent], trashed.id)?.id).toBe(parent.id);
  expect(selectSubIssueEvidenceTourTask([trashed], null)).toBeUndefined();
});


it("unknown and stale evidence never outrank current evidence and preserve the selected fallback", () => {
  const selected = taskDetailStoryTask({ id: "selected-unknown" });
  const unknownChild = taskDetailStoryTask({ id: "unknown-child", taskType: "sub_issue", parentTaskId: selected.id, detailAvailability: "summary" });
  Reflect.deleteProperty(unknownChild, "evidenceLinks"); Reflect.deleteProperty(unknownChild, "linkedPullRequests");
  const staleParent = taskDetailStoryTask({ id: "stale-parent" });
  const staleChild = taskDetailStoryTask({ id: "stale-child", taskType: "sub_issue", parentTaskId: staleParent.id, detailAvailability: "stale", evidenceLinks: ["https://example.com/retained"] });
  expect(selectSubIssueEvidenceTourTask([staleParent, staleChild, selected, unknownChild], selected.id)?.id).toBe(selected.id);
  const current = taskDetailStoryTask({ id: "current-parent" });
  const currentChild = taskDetailStoryTask({ id: "current-child", taskType: "sub_issue", parentTaskId: current.id, evidenceLinks: ["https://example.com/current"] });
  expect(selectSubIssueEvidenceTourTask([staleParent, staleChild, selected, unknownChild, current, currentChild], selected.id)?.id).toBe(current.id);
});
