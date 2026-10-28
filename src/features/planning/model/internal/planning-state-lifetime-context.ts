"use client";

import { createContext } from "react";
import type { BrowserPlanningLifetime } from "./browser-planning-lifetime";

export const PlanningStateLifetimeContext = createContext<BrowserPlanningLifetime | null>(null);
