"use client";

import { useEffect } from "react";
import type { PlanningState } from "../model/planning-state";

export function usePlanningHeaderData({ planningState, enabled, notificationsWorkspace = false }: { planningState: PlanningState; enabled: boolean; notificationsWorkspace?: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    const missing = Object.entries(planningState.header().slots).filter(([, slot]) => slot.readStatus === "not-loaded" || slot.readStatus === "stale").map(([key]) => key) as import("@/lib/planning-header-data").PlanningHeaderSlotKey[];
    if (missing.length) void planningState.refreshHeader(missing);
    const refresh = () => { if (notificationsWorkspace) void planningState.refreshNotifications(); else void planningState.refreshHeader(["notifications"]); };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    const interval = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, [planningState, enabled, notificationsWorkspace]);
  return planningState.header().data;
}
