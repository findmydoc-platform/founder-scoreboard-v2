import { backlogModelToPlanningShellState } from "@/features/backlog/model/backlog-planning-shell-projection";
import { backlogModelCoverage, backlogOmittedFields } from "./internal/backlog-read-coverage";
import type { BacklogModel } from "@/features/backlog/model/backlog-read-model";
import type { ServerSessionView } from "@/lib/credentials/session-types";
import type { Profile, PlanningShellState, Task } from "@/lib/types";
import type { BacklogReadCoverage } from "@/features/backlog/model/backlog-read-model";
import type { BacklogSelection, BacklogSelectionQuery } from "@/features/backlog/model/backlog-selection";
import type { PlanningReadCoverage } from "./internal/planning-read-scopes";
import type { PlanningReadAuthority } from "./planning-server-header-read";

export type PlanningBacklogHydration = Readonly<{
  query: BacklogSelectionQuery;
  session: ServerSessionView;
  read: {
    data: PlanningShellState;
    backlogSelection: BacklogSelection;
    readActor: { profileId: string; platformRole: Profile["platformRole"] };
    readAuthority: PlanningReadAuthority;
    scopeRevision?: string;
    coverage?: PlanningReadCoverage;
    taskCoverage?: "complete" | "partial" | "none";
    taskOmittedFields?: readonly (keyof Task)[];
    profileOmittedFields?: readonly (keyof Profile)[];
    backlogCoverage?: BacklogReadCoverage;
  };
}>;

export function backlogSelectionRead(model: BacklogModel, readAuthority: PlanningReadAuthority, readActor: PlanningBacklogHydration["read"]["readActor"] | undefined) {
  return { data: backlogModelToPlanningShellState(model), readAuthority, readActor,
    backlogSelection: model.selection, scopeRevision: model.selection?.scopeRevision,
    coverage: backlogModelCoverage(model), profileOmittedFields: ["notificationsEnabled", "googleChatUserId", "googleChatDmSpace"] as const,
    taskCoverage: model.coverage?.items || "partial", taskOmittedFields: backlogOmittedFields(model), backlogCoverage: model.coverage };
}
