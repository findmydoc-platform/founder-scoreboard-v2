"use client";

import type { Dispatch, SetStateAction } from "react";
import { useFounderEventCommands } from "@/features/events/hooks/use-founder-event-commands";
import { useDemoSeedImport } from "@/features/planning/hooks/use-demo-seed-import";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { useNotificationCommands } from "@/features/planning/hooks/use-notification-commands";
import { usePlanningBoardState } from "@/features/planning/hooks/use-planning-board-state";
import type { PlanningFilters, usePlanningViewState } from "@/features/planning/hooks/use-planning-view-state";
import { useProfileUiPreferenceSync } from "@/features/profile/hooks/use-profile-ui-preference-sync";
import { useOwnProfileSettingsCommands } from "@/features/profile/hooks/use-own-profile-settings-commands";
import { useInitiativeCommands } from "@/features/projects/hooks/use-initiative-commands";
import { useReviewCommands } from "@/features/reviews/hooks/use-review-commands";
import { useFeedbackCommands } from "@/features/settings/hooks/use-feedback-commands";
import { useSprintCommands } from "@/features/sprint/hooks/use-sprint-commands";
import { useWeeklyAttendanceCommands } from "@/features/sprint/hooks/use-weekly-attendance-commands";
import { useProfileSettingsCommands } from "@/features/team/hooks/use-profile-settings-commands";
import { useTaskCollaborationCommands } from "@/features/tasks/hooks/use-task-collaboration-commands";
import { useTaskMutationCommands } from "@/features/tasks/hooks/use-task-mutation-commands";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PlanningData, Task, ViewMode } from "@/lib/types";

type PlanningViewState = ReturnType<typeof usePlanningViewState>;

type UsePlanningCommandRegistryOptions = {
  apiClient: BrowserApiClient;
  closeTaskPanel: () => void;
  commandContext: PlanningCommandContext;
  currentProfileId: string;
  data: PlanningData;
  filters: PlanningFilters;
  openTaskPanel: (taskId: string) => void;
  protectedDataLoaded: boolean;
  refreshPlanningData: () => Promise<void>;
  selectedTask: Task | null;
  setFeedbackDialogOpen: PlanningViewState["setFeedbackDialogOpen"];
  setFilters: PlanningViewState["setFilters"];
  setInitiativeDialogDefaults: PlanningViewState["setInitiativeDialogDefaults"];
  setSelectedFeedbackId: PlanningViewState["setSelectedFeedbackId"];
  setShowNotifications: PlanningViewState["setShowNotifications"];
  setStatusGuardNotice: Dispatch<SetStateAction<string>>;
  setStatusGuardTaskId: Dispatch<SetStateAction<string | null>>;
  setTaskDialogDefaults: PlanningViewState["setTaskDialogDefaults"];
  setView: PlanningViewState["setView"];
  setWorkspace: (workspace: AppWorkspace) => void;
  source: "seed" | "supabase";
  sprintPlanningOptions: PlanningViewState["sprintPlanningOptions"];
  view: ViewMode;
  workspace: AppWorkspace;
};

export function usePlanningCommandRegistry({
  apiClient,
  closeTaskPanel,
  commandContext,
  currentProfileId,
  data,
  filters,
  openTaskPanel,
  protectedDataLoaded,
  refreshPlanningData,
  selectedTask,
  setFeedbackDialogOpen,
  setFilters,
  setInitiativeDialogDefaults,
  setSelectedFeedbackId,
  setShowNotifications,
  setStatusGuardNotice,
  setStatusGuardTaskId,
  setTaskDialogDefaults,
  setView,
  setWorkspace,
  source,
  sprintPlanningOptions,
  view,
  workspace,
}: UsePlanningCommandRegistryOptions) {
  const taskMutationCommands = useTaskMutationCommands({
    ...commandContext,
    closeTaskPanel,
    setStatusGuardNotice,
    setStatusGuardTaskId,
    setTaskDialogDefaults,
  });
  const { syncTaskToGitHub, updateTask } = taskMutationCommands;
  const taskCollaborationCommands = useTaskCollaborationCommands({
    ...commandContext,
    selectedTask,
  });
  const initiativeCommands = useInitiativeCommands({
    ...commandContext,
    setInitiativeDialogDefaults,
  });
  const boardState = usePlanningBoardState({
    canChangeTaskStatus: commandContext.canChangeTaskStatus,
    data,
    setStatusGuardNotice,
    setStatusGuardTaskId,
    updateTask,
  });
  useProfileUiPreferenceSync({
    apiClient,
    currentProfileId,
    data,
    expandedPackages: boardState.expandedPackages,
    filters,
    protectedDataLoaded,
    setData: commandContext.setData,
    setExpandedPackageIds: boardState.setExpandedPackageIds,
    setFilters,
    setView,
    setWorkspace,
    source,
    view,
    workspace,
  });
  const eventCommands = useFounderEventCommands(commandContext);
  const weeklyAttendanceCommands = useWeeklyAttendanceCommands(commandContext);
  const reviewCommands = useReviewCommands({
    ...commandContext,
    syncTaskToGitHub,
  });
  const sprintCommands = useSprintCommands({
    ...commandContext,
    refreshPlanningData,
    sprintPlanningOptions,
  });
  const profileSettingsCommands = useProfileSettingsCommands(commandContext);
  const ownProfileSettingsCommands = useOwnProfileSettingsCommands(commandContext);
  const feedbackCommands = useFeedbackCommands({
    ...commandContext,
    setFeedbackDialogOpen,
    setSelectedFeedbackId,
  });
  const notificationCommands = useNotificationCommands({
    ...commandContext,
    openTaskPanel,
    refreshPlanningData,
    setSelectedFeedbackId,
    setShowNotifications,
    setWorkspace,
    workspace,
  });
  const demoSeedImport = useDemoSeedImport({
    apiClient,
    setData: commandContext.setData,
    setSaveError: commandContext.setSaveError,
    source,
  });

  return {
    boardState,
    demoSeedImport,
    eventCommands,
    feedbackCommands,
    initiativeCommands,
    notificationCommands,
    ownProfileSettingsCommands,
    profileSettingsCommands,
    reviewCommands,
    sprintCommands,
    taskCollaborationCommands,
    taskMutationCommands,
    weeklyAttendanceCommands,
  };
}
