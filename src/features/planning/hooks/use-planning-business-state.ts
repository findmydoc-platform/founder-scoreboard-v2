"use client";
import { createContext, useContext } from "react";
import type { PlanningState } from "../model/planning-state";
export const PlanningBusinessStateContext = createContext<PlanningState | null>(null);
export function usePlanningBusinessState() { return useContext(PlanningBusinessStateContext); }
