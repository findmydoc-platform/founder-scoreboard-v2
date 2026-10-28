import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import type { Task } from "@/lib/types";
import type { PlanningReadCoverage } from "./planning-read-scopes";

export function hierarchyReadCoverage(model: PlanningWorkspaceModel): PlanningReadCoverage {
  const coverage = model.coverage;
  return { project: "complete", tasks: coverage?.items || "partial", profiles: coverage?.people || "partial", sprints: coverage?.sprints || "partial", taskRelations: coverage?.relationships || "partial", profileUiPreferences: coverage?.preferences || "partial" };
}
export function hierarchyOmittedFields(model: PlanningWorkspaceModel): (keyof Task)[] {
  const omitted: (keyof Task)[] = ["problemStatement", "intendedOutcome", "scopeConstraints", "evidenceRequired", "note"];
  if (model.coverage?.strategies !== "complete") omitted.push("strategy");
  if (model.coverage?.raci !== "complete") omitted.push("raciAssignments");
  if (model.coverage?.links !== "complete") omitted.push("evidenceLink", "evidenceLinks", "linkedPullRequests");
  if (model.coverage?.people !== "complete") omitted.push("assignee", "owner", "createdBy");
  if (model.coverage?.items !== "complete") omitted.push("parentApprovalStatus");
  return omitted;
}
