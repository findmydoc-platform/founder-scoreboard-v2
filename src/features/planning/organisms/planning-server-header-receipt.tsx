"use client";

import { useEffect } from "react";
import { usePlanningBusinessState } from "../hooks/use-planning-business-state";
import type { PlanningServerHeaderRead, PlanningServerHeaderResult, PlanningServerHeaderSlot } from "../model/planning-server-header-read";

export function PlanningServerHeaderReceipt({ read, slot, result }: { read: PlanningServerHeaderRead; slot: PlanningServerHeaderSlot; result: PlanningServerHeaderResult }) {
  const owner = usePlanningBusinessState();
  useEffect(() => { owner?.acceptServerHeaderSlot(read, slot, result.headerData); }, [owner, read, slot, result]);
  return null;
}
