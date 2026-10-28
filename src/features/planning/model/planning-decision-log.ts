import type { NotionDecisionLogResult } from "@/lib/notion-decision-log";
import type { PlanningReadStatus } from "./planning-state";
export type PlanningDecisionLogView = {
  result: NotionDecisionLogResult | null;
  readStatus: PlanningReadStatus;
  completeness: "complete" | "none";
};
