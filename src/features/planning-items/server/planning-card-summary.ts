import type { Task } from "@/lib/types";

// Omitted fields must not clear a previously accepted full detail record.
export const planningCardOmittedFields: readonly (keyof Task)[] = [
  "description", "problemStatement", "intendedOutcome", "scopeConstraints", "acceptanceCriteria", "evidenceRequired", "definitionOfDone", "note",
  "strategy", "raciAssignments", "evidenceLinks", "linkedPullRequests", "reviewEvidenceExceptionNote", "githubIssueSyncError", "decisionNote", "carryoverReason",
];
export function compactPlanningCard(task: Task): Task {
  const summary = { ...task, detailAvailability: "summary" as const };
  for (const field of planningCardOmittedFields) delete summary[field];
  return summary;
}
