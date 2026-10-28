"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { berlinDateKey } from "../model/team-workweek-calendar";
import type { WorkweekCalendarScope } from "../model/published-workweek-calendar-state";
import type { PlanningState } from "@/features/planning/model/planning-state";

export function useWorkweekCalendarLoading({ planningState, from, to, enabled, policy }: {
  planningState?: PlanningState;
  from: string;
  to: string;
  enabled: boolean;
  policy: WorkweekCalendarScope["policy"];
}) {
  const [now, setNow] = useState(() => new Date());
  const snapshot = useCallback(() => planningState?.workweekCalendar({ from, to, policy }) || null, [planningState, from, to, policy]);
  const subscribe = useCallback((listener: () => void) => planningState?.subscribe(listener) || (() => {}), [planningState]);
  const view = useSyncExternalStore(subscribe, snapshot, snapshot);
  const rangeKey = `${policy}:${from}/${to}`;
  const [presentation, setPresentation] = useState({ owner: planningState, rangeKey, read: view?.acceptedRead || 0, cached: Boolean(view?.cacheFresh) });
  if (presentation.owner !== planningState || presentation.rangeKey !== rangeKey) setPresentation({ owner: planningState, rangeKey, read: view?.acceptedRead || 0, cached: Boolean(view?.cacheFresh) });
  const canPresent = policy === "header-month" || presentation.cached || (view?.acceptedRead || 0) > presentation.read;
  const today = berlinDateKey(now);
  const load = useCallback(async () => { if (planningState) await planningState.loadWorkweekCalendar({ from, to, policy }); }, [planningState, from, to, policy]);
  useEffect(() => {
    if (!enabled) return;
    const timeout = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [enabled, load, today, view?.invalidation]);
  const nextActivationAt = view?.snapshot?.nextActivationAt;
  useEffect(() => {
    if (!enabled || !nextActivationAt) return;
    let timeout: number;
    const refreshWhenActive = () => {
      const remaining = Date.parse(nextActivationAt) - Date.now() + 100;
      if (remaining > 0) timeout = window.setTimeout(refreshWhenActive, Math.min(2_147_483_647, remaining));
      else { setNow(new Date()); void load(); }
    };
    refreshWhenActive();
    return () => window.clearTimeout(timeout);
  }, [enabled, load, nextActivationAt]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return { snapshot: canPresent ? view?.snapshot || null : null, hasLoadedRange: Boolean(canPresent && view?.snapshot && view.coverage !== "none"), pending: enabled && (!view || view.readStatus === "not-loaded" || view.readStatus === "loading"), message: view?.error || "", load, now };
}
