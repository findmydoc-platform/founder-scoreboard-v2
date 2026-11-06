import type { ServerSessionView } from "@/lib/credentials/session-types";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import type { PlanningReadCoverage } from "./internal/planning-read-scopes";
import { hierarchyOmittedFields, hierarchyReadCoverage } from "./internal/hierarchy-read-coverage";
import type { Task } from "@/lib/types";

export type PlanningWorkspaceHydration = Readonly<{
  workspace: "planning" | "projects";
  queryKey: "workspace";
  session: ServerSessionView;
  revision: string;
  coverage: PlanningReadCoverage;
  taskOmittedFields: readonly (keyof Task)[];
}>;

export function planningWorkspaceHydration(workspace: "planning" | "projects", model: PlanningWorkspaceModel, session?: ServerSessionView): PlanningWorkspaceHydration | undefined {
  if (!session) return undefined;
  return { workspace, queryKey: "workspace", session, revision: model.revision, coverage: hierarchyReadCoverage(model), taskOmittedFields: hierarchyOmittedFields(model) };
}
