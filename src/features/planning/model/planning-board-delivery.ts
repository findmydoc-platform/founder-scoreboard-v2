import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import type { PlanningBoardColumn } from "./planning-board-query";
import type { PlanningReadAuthority } from "./planning-server-header-read";
import type { AuthenticatedProfile, Task, TaskRelation, TaskStatus } from "@/lib/types";
import type { PlanningBoardSummaryFrame } from "./planning-board-summaries";

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
  area?: "summaries";
  token?: string;
  status: 403 | 409 | 503;
  error: string;
  code?: string;
}>;
export type PlanningBoardColumnOutcome = PlanningBoardColumnFrame | PlanningBoardFailureFrame;
export type PlanningBoardSummaryOutcome = PlanningBoardSummaryFrame | PlanningBoardFailureFrame;
export type PlanningBoardOutcome = PlanningBoardColumnOutcome | PlanningBoardSummaryOutcome;
export type PlanningBoardBasisFrame = Readonly<{
  kind: "basis";
  readId: string;
  model: PlanningWorkspaceModel;
  readAuthority: PlanningReadAuthority;
  currentProfile?: AuthenticatedProfile | null;
}>;
export type PlanningBoardStreamFrame = PlanningBoardBasisFrame | PlanningBoardOutcome | Readonly<{ kind: "end"; readId: string }>;
export type PlanningBoardDelivery = Readonly<{
  id: string;
  abort(): void;
  checkPublication<T extends PlanningBoardOutcome>(outcome: T, initialSummary?: PlanningBoardSummaryFrame): Promise<T | PlanningBoardFailureFrame>;
  columns: Partial<Record<TaskStatus, Promise<PlanningBoardColumnOutcome>>>;
  summaries?: Promise<PlanningBoardSummaryOutcome>;
}>;
export type PlanningBoardQueryLoadResult =
  | { status: "ready"; model: PlanningWorkspaceModel; delivery?: PlanningBoardDelivery }
  | { status: "forbidden" | "unavailable" | "staleContinuation" };
