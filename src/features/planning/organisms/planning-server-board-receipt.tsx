"use client";

import { useEffect } from "react";
import { usePlanningBusinessState } from "../hooks/use-planning-business-state";
import type { PlanningBoardColumnOutcome } from "../model/planning-board-delivery";

export function PlanningServerBoardReceipt({ readId, outcome }: { readId: string; outcome: PlanningBoardColumnOutcome }) {
  const owner = usePlanningBusinessState();
  useEffect(() => { void owner?.acceptServerBoardColumn(readId, outcome); }, [owner, readId, outcome]);
  return null;
}
