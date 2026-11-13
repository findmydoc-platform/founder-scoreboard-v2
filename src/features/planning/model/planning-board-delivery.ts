import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import type { PlanningBoardColumn } from "./planning-board-query";
import type { PlanningReadAuthority } from "./planning-server-header-read";
import type { AuthenticatedProfile, Task, TaskRelation, TaskStatus } from "@/lib/types";

export type PlanningBoardColumnFrame = Readonly<{
  kind: "column";
  readId: string;
  column: TaskStatus;
  scopeRevision: string;
  queryRevision: string;
  observedAt: string;
  validUntil: string | null;
  cardIds: readonly string[];
  items: readonly Task[];
  relationships: readonly TaskRelation[];
  columnState: PlanningBoardColumn;
  personalChildren: Record<string, string[]>;
  taskOmittedFields: readonly (keyof Task)[];
}>;
export type PlanningBoardFailureFrame = Readonly<{
  kind: "failure";
  readId: string;
  column?: TaskStatus;
  status: 403 | 409 | 503;
  error: string;
  code?: string;
}>;
export type PlanningBoardColumnOutcome = PlanningBoardColumnFrame | PlanningBoardFailureFrame;
export type PlanningBoardBasisFrame = Readonly<{
  kind: "basis";
  readId: string;
  model: PlanningWorkspaceModel;
  readAuthority: PlanningReadAuthority;
  currentProfile?: AuthenticatedProfile | null;
}>;
export type PlanningBoardStreamFrame = PlanningBoardBasisFrame | PlanningBoardColumnOutcome | Readonly<{ kind: "end"; readId: string }>;
export type PlanningBoardDelivery = Readonly<{
  id: string;
  abort(): void;
  checkPublication(outcome: PlanningBoardColumnOutcome): Promise<PlanningBoardColumnOutcome>;
  columns: Partial<Record<TaskStatus, Promise<PlanningBoardColumnOutcome>>>;
}>;
export type PlanningBoardQueryLoadResult =
  | { status: "ready"; model: PlanningWorkspaceModel; delivery?: PlanningBoardDelivery }
  | { status: "forbidden" | "unavailable" | "staleContinuation" };
