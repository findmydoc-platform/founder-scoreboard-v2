import type { SprintReadCoverage, SprintWorkspaceModel } from "@/features/sprint/model/sprint-read-model";
import type { PlanningReadCoverage } from "./planning-read-scopes";
export const sprintScopeKeys = { project: "project", people: "profiles", items: "tasks", sprints: "sprints", commitments: "sprintCommitments", scores: "founderSprintScores", strikeStates: "founderStrikeStates", strikeEvents: "strikeEvents", objections: "scoreObjections", meetings: "meetings", attendance: "meetingAttendance" } as const;
export function sprintModelCoverage(model: SprintWorkspaceModel): PlanningReadCoverage {
  const coverage: PlanningReadCoverage = {};
  for (const [key, shellKey] of Object.entries(sprintScopeKeys)) {
    const field = key as keyof SprintReadCoverage;
    if (model.coverage) { if (model.coverage[field]) coverage[shellKey] = model.coverage[field]; }
    else if (model[field] !== undefined) coverage[shellKey] = field === "project" ? "complete" : "partial";
  }
  return coverage;
}
export function sprintViewCoverage(coverage: PlanningReadCoverage): SprintReadCoverage {
  return Object.fromEntries(Object.entries(sprintScopeKeys).filter(([, shellKey]) => coverage[shellKey]).map(([key, shellKey]) => [key, coverage[shellKey]]));
}
