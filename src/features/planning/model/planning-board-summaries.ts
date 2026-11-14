import type { PlanningBoardResult } from "./planning-board-query";

export type PlanningBoardSummaryRequest = Readonly<{
  token: string;
  cardIds: readonly string[];
  status: "loading" | "current" | "unavailable";
}>;

export type PlanningBoardSummaryFrame = Readonly<{
  kind: "summaries";
  readId: string;
  token: string;
  scopeRevision: string;
  queryRevision: string;
  observedAt: string;
  validUntil: string | null;
  cardIds: readonly string[];
  childProgressById: PlanningBoardResult["childProgressById"];
}>;

export type PlanningBoardSummaryLoadResult =
  | { status: "ready"; summaries: PlanningBoardSummaryFrame }
  | { status: "forbidden" | "unavailable" | "staleContinuation" };
