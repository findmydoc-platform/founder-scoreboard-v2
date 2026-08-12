"use client";

import type { Dispatch, SetStateAction } from "react";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PlanningShellState, Profile, Task } from "@/lib/types";

export type PlanningSource = "supabase";
export type PlanningShellStateUpdater = (updater: (current: PlanningShellState) => PlanningShellState) => void;
export type PlanningStartTransition = (callback: () => void) => void;

export type PlanningCommandContext = {
  apiClient: BrowserApiClient;
  applyPlanningShellStateUpdate: PlanningShellStateUpdater;
  canChangeTaskStatus: (task: Task) => boolean;
  canManageFinalTaskStatus: boolean;
  canManageTaskMeta: boolean;
  currentProfile: Profile | null;
  data: PlanningShellState;
  githubInstallationAvailable: boolean;
  githubUserConnected: boolean;
  setData: Dispatch<SetStateAction<PlanningShellState>>;
  setSaveError: Dispatch<SetStateAction<string>>;
  source: PlanningSource;
  startTransition: PlanningStartTransition;
};
