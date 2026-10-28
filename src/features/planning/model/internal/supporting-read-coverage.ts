import type { SupportingWorkspace, SupportingWorkspaceModel } from "../supporting-planning-shell-projection";
import type { PlanningReadCoverage } from "./planning-read-scopes";
import type { Task } from "@/lib/types";

export function supportingReadCoverage(workspace: SupportingWorkspace, model: SupportingWorkspaceModel): PlanningReadCoverage {
  const read = model.readCoverage as Partial<Record<string, "complete" | "partial">> | undefined;
  const coverage: PlanningReadCoverage = { profiles: read?.people || "partial" };
  if (workspace === "team" || workspace === "notifications") coverage.tasks = read?.items || "partial";
  if (workspace === "profile") Object.assign(coverage, { project: read?.project || "partial", tasks: read?.initiatives || "partial", notificationPreferences: read?.notificationPreferences || "partial", profileUiPreferences: read?.preferences || "partial" });
  return coverage;
}
export function supportingOmittedFields(model: { readCoverage?: Readonly<Partial<Record<string, "complete" | "partial">>> }): (keyof Task)[] {
  const read = model.readCoverage as Partial<Record<string, "complete" | "partial">> | undefined;
  const omitted: (keyof Task)[] = ["dependsOn"];
  if (read?.strategies !== "complete") omitted.push("strategy");
  if (read?.raci !== "complete") omitted.push("raciAssignments");
  if (read?.links !== "complete") omitted.push("evidenceLink", "evidenceLinks", "linkedPullRequests");
  if (read?.people !== "complete") omitted.push("assignee", "owner", "createdBy");
  return omitted;
}
