"use client";

import type { Dispatch, SetStateAction } from "react";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PlanningData, Profile, Task } from "@/lib/types";

export type PlanningSource = "seed" | "supabase";
export type PlanningDataUpdater = (updater: (current: PlanningData) => PlanningData) => void;
export type PlanningStartTransition = (callback: () => void) => void;

export type PlanningCommandContext = {
  apiClient: BrowserApiClient;
  applyPlanningDataUpdate: PlanningDataUpdater;
  canChangeTaskStatus: (task: Task) => boolean;
  canManageTaskMeta: boolean;
  currentProfile: Profile | null;
  data: PlanningData;
  githubProviderTokenAvailable: boolean;
  setData: Dispatch<SetStateAction<PlanningData>>;
  setSaveError: Dispatch<SetStateAction<string>>;
  source: PlanningSource;
  startTransition: PlanningStartTransition;
};
