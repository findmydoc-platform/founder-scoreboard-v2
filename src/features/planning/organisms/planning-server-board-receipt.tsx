"use client";

import { useEffect } from "react";
import { usePlanningBusinessState } from "../hooks/use-planning-business-state";
import type { PlanningBoardOutcome } from "../model/planning-board-delivery";

export function PlanningServerBoardReceipt({ readId, outcome }: { readId: string; outcome: PlanningBoardOutcome }) {
  const owner = usePlanningBusinessState();
  useEffect(() => {
    if (outcome.kind === "summaries" || outcome.kind === "failure" && outcome.area === "summaries") void owner?.acceptServerBoardSummary(readId, outcome);
    else void owner?.acceptServerBoardColumn(readId, outcome);
  }, [owner, readId, outcome]);
  return null;
}
