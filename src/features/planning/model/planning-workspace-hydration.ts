import type { ServerSessionView } from "@/lib/credentials/session-types";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import type { PlanningReadCoverage } from "./internal/planning-read-scopes";
import { hierarchyOmittedFields, hierarchyReadCoverage } from "./internal/hierarchy-read-coverage";
import { planningBoardQueryKey } from "./planning-board-query";
import type { Task } from "@/lib/types";

export type PlanningWorkspaceHydration = Readonly<{
  workspace: "planning" | "projects";
  queryKey: string;
  query?: import("./planning-board-query").PlanningBoardQuery;
  queryRevision?: string;
  scopeRevision?: string;
  table?: import("./planning-table-result").PlanningTableResult;
  board?: import("./planning-board-query").PlanningBoardResult;
  session: ServerSessionView;
  readAuthority?: import("./planning-server-header-read").PlanningReadAuthority;
  revision: string;
  coverage: PlanningReadCoverage;
  taskOmittedFields: readonly (keyof Task)[];
}>;

export function planningWorkspaceHydration(workspace: "planning" | "projects", model: PlanningWorkspaceModel, session?: ServerSessionView, readAuthority?: import("./planning-server-header-read").PlanningReadAuthority): PlanningWorkspaceHydration | undefined {
  if (!session) return undefined;
  return { workspace, queryKey: model.query ? planningBoardQueryKey(model.query) : model.board?.queryKey || model.table?.queryKey || "workspace", query: model.query || model.board?.query || model.table?.query, queryRevision: model.queryRevision || model.board?.revision || model.table?.revision, scopeRevision: model.scopeRevision, board: model.board, table: model.table, session, readAuthority, revision: model.revision, coverage: hierarchyReadCoverage(model), taskOmittedFields: hierarchyOmittedFields(model) };
}
