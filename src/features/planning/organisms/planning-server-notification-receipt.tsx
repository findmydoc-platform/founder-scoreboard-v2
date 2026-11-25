"use client";

import { useEffect } from "react";
import { usePlanningBusinessState } from "../hooks/use-planning-business-state";
import type { NotificationEntryOutcome } from "../model/planning-notifications-state";

export function PlanningServerNotificationReceipt({ id, outcome }: { id: string; outcome: NotificationEntryOutcome }) {
  const owner = usePlanningBusinessState();
  useEffect(() => { owner?.acceptNotificationEntry(id, outcome); }, [owner, id, outcome]);
  return null;
}
