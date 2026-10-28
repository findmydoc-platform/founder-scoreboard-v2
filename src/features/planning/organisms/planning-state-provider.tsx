"use client";

import { useEffect, useState } from "react";
import { createBrowserPlanningLifetime } from "../model/internal/browser-planning-lifetime";
import { PlanningStateLifetimeContext } from "../model/internal/planning-state-lifetime-context";

export function PlanningStateProvider({ children }: { children: React.ReactNode }) {
  const [lifetime] = useState(createBrowserPlanningLifetime);
  useEffect(() => lifetime.connect(), [lifetime]);
  return <PlanningStateLifetimeContext.Provider value={lifetime}>{children}</PlanningStateLifetimeContext.Provider>;
}
