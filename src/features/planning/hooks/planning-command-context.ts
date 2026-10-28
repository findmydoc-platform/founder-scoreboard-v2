"use client";

import type { Dispatch, SetStateAction } from "react";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PlanningShellState, Profile, Task } from "@/lib/types";

export type PlanningSource = "supabase";
export type PlanningStartTransition = (callback: () => void) => void;

export type PlanningCommandContext = {
  planningState: import("../model/planning-state").PlanningState;
  apiClient: BrowserApiClient;
  canChangeTaskStatus: (task: Task) => boolean;
  canCorrectOperationally: boolean;
  canManageFinalTaskStatus: boolean;
  canManageTaskMeta: boolean;
  currentProfile: Profile | null;
  data: PlanningShellState;
  githubInstallationAvailable: boolean;
  githubUserConnected: boolean;
  setSaveError: Dispatch<SetStateAction<string>>;
  source: PlanningSource;
  startTransition: PlanningStartTransition;
};
