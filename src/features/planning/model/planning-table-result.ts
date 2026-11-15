import type { PlanningBoardResult } from "./planning-board-query";

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
}>;
