import type { BacklogModel } from "@/features/backlog/model/backlog-read-model";
import type { Task } from "@/lib/types";
import type { PlanningReadCoverage } from "./planning-read-scopes";
export function backlogModelCoverage(model: BacklogModel): PlanningReadCoverage {
  return { tasks: model.coverage?.items || "partial", profiles: model.coverage?.people || "partial", sprints: model.coverage?.sprints || "partial", sprintCommitments: model.coverage?.commitments || "partial" };
}
export function backlogOmittedFields(model: BacklogModel): (keyof Task)[] {
  const omitted: (keyof Task)[] = ["dependsOn"];
  if (model.coverage?.strategies !== "complete") omitted.push("strategy");
  if (model.coverage?.raci !== "complete") omitted.push("raciAssignments");
  if (model.coverage?.links !== "complete") omitted.push("evidenceLink", "evidenceLinks", "linkedPullRequests");
  if (model.coverage?.people !== "complete") omitted.push("assignee", "owner", "createdBy");
  if (model.coverage?.items !== "complete") omitted.push("parentApprovalStatus");
  return omitted;
}
