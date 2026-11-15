import type { PlanningBoardResult } from "./planning-board-query";
import type { TaskAttentionSignal } from "@/features/tasks/model/task-attention-signals";

export type PlanningTableRisk = Readonly<{
  attention: readonly TaskAttentionSignal[];
  waitsOn: number;
  blocks: number;
  hasOpenWait: boolean;
}>;

export type PlanningTableRiskFrame = Readonly<{
  kind: "table-risks";
  readId: string;
  token: string;
  scopeRevision: string;
  queryRevision: string;
  observedAt: string;
  validUntil: string | null;
  authorityDeadline?: number | null;
  cardIds: readonly string[];
  risksById: Record<string, PlanningTableRisk>;
}>;

export type PlanningTablePage = Readonly<{
  total: number;
  loaded: number;
  completeness: "complete" | "partial";
  continuation: string | null;
}>;

// Table membership and global ordering are independent of Board level/columns.
export type PlanningTableResult = Readonly<Pick<PlanningBoardResult,
  "query" | "queryKey" | "revision" | "observedAt" | "validUntil" | "metrics"
  | "summaryRequests" | "attentionById" | "workstreams" | "initiativeOptions" | "workspaceRevision"
> & {
  rowIds: readonly string[];
  page: PlanningTablePage;
  risksById?: Record<string, PlanningTableRisk | null>;
}>;
