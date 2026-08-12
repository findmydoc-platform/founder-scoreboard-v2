"use client";

import type { Dispatch, SetStateAction } from "react";
import { useFounderEventCommands } from "@/features/events/hooks/use-founder-event-commands";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { useNotificationCommands } from "@/features/planning/hooks/use-notification-commands";
import { usePlanningBoardState } from "@/features/planning/hooks/use-planning-board-state";
import type { usePlanningViewState } from "@/features/planning/hooks/use-planning-view-state";
import { useProfileUiPreferenceSync } from "@/features/profile/hooks/use-profile-ui-preference-sync";
import { useOwnProfileSettingsCommands } from "@/features/profile/hooks/use-own-profile-settings-commands";
import { useInitiativeCommands } from "@/features/projects/hooks/use-initiative-commands";
import { useEpicCommands } from "@/features/projects/hooks/use-epic-commands";
import { useReviewCommands } from "@/features/reviews/hooks/use-review-commands";
import { useSprintCommands } from "@/features/sprint/hooks/use-sprint-commands";
import { useWeeklyAttendanceCommands } from "@/features/sprint/hooks/use-weekly-attendance-commands";
import { useProfileSettingsCommands } from "@/features/team/hooks/use-profile-settings-commands";
import { useTaskCollaborationCommands } from "@/features/tasks/hooks/use-task-collaboration-commands";
import { useTaskMutationCommands } from "@/features/tasks/hooks/use-task-mutation-commands";
import { useFmdToolCommands } from "@/features/tools/hooks/use-fmd-tool-commands";
import { useFounderOpsSettingsCommands } from "@/features/settings/hooks/use-founderops-settings-commands";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import type { PlanningShellState, PlanningHeaderData, Task } from "@/lib/types";

type PlanningViewState = ReturnType<typeof usePlanningViewState>;

type UsePlanningCommandRegistryOptions = {
  closeTaskPanel: () => void;
  commandContext: PlanningCommandContext;
  currentProfileId: string;
  data: PlanningShellState;
  hasPlanningBoardUrlState: boolean;
  hasPlanningFilterUrlState: boolean;
  openTaskPanel: (taskId: string) => void;
  refreshCurrentWorkspaceModel: () => Promise<void>;
  selectedTask: Task | null;
  setFilters: PlanningViewState["setFilters"];
  setHeaderData: Dispatch<SetStateAction<PlanningHeaderData>>;
  setInitiativeDialogDefaults: PlanningViewState["setInitiativeDialogDefaults"];
  setEpicDeleteTarget: PlanningViewState["setEpicDeleteTarget"];
  setEpicDialogDefaults: PlanningViewState["setEpicDialogDefaults"];
  setShowNotifications: PlanningViewState["setShowNotifications"];
  setStatusGuardNotice: Dispatch<SetStateAction<string>>;
  setStatusGuardTaskId: Dispatch<SetStateAction<string | null>>;
  setTaskDialogDefaults: PlanningViewState["setTaskDialogDefaults"];
  setView: PlanningViewState["setView"];
  setWorkspace: (workspace: AppWorkspace) => void;
  sprintPlanningOptions: PlanningViewState["sprintPlanningOptions"];
  workspace: AppWorkspace;
};

export function usePlanningCommandRegistry({
  closeTaskPanel,
  commandContext,
  currentProfileId,
  data,
  hasPlanningBoardUrlState,
  hasPlanningFilterUrlState,
  openTaskPanel,
  refreshCurrentWorkspaceModel,
  selectedTask,
  setFilters,
  setHeaderData,
  setInitiativeDialogDefaults,
  setEpicDeleteTarget,
  setEpicDialogDefaults,
  setShowNotifications,
  setStatusGuardNotice,
  setStatusGuardTaskId,
  setTaskDialogDefaults,
  setView,
  setWorkspace,
  sprintPlanningOptions,
  workspace,
}: UsePlanningCommandRegistryOptions) {
  const taskMutationCommands = useTaskMutationCommands({
    ...commandContext,
    closeTaskPanel,
    refreshCurrentWorkspaceModel,
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
  const epicCommands = useEpicCommands({
    ...commandContext,
    setEpicDeleteTarget,
    setEpicDialogDefaults,
  });
  const boardState = usePlanningBoardState({
    canChangeTaskStatus: commandContext.canChangeTaskStatus,
    data,
    setStatusGuardNotice,
    setStatusGuardTaskId,
    updateTask,
  });
  useProfileUiPreferenceSync({
    currentProfileId,
    data,
    hasPlanningBoardUrlState,
    hasPlanningFilterUrlState,
    setExpandedInitiativeIds: boardState.setExpandedInitiativeIds,
    setFilters,
    setView,
  });
  const eventCommands = useFounderEventCommands(commandContext);
  const weeklyAttendanceCommands = useWeeklyAttendanceCommands(commandContext);
  const reviewCommands = useReviewCommands({
    ...commandContext,
    syncTaskToGitHub,
  });
  const sprintCommands = useSprintCommands({
    ...commandContext,
    refreshCurrentWorkspaceModel,
    sprintPlanningOptions,
  });
  const profileSettingsCommands = useProfileSettingsCommands(commandContext);
  const ownProfileSettingsCommands = useOwnProfileSettingsCommands(commandContext);
  const founderOpsSettingsCommands = useFounderOpsSettingsCommands(commandContext);
  const fmdToolCommands = useFmdToolCommands(commandContext);
  const notificationCommands = useNotificationCommands({
    ...commandContext,
    openTaskPanel,
    refreshCurrentWorkspaceModel,
    setHeaderData,
    setShowNotifications,
    setWorkspace,
    workspace,
  });
  return {
    boardState,
    eventCommands,
    fmdToolCommands,
    founderOpsSettingsCommands,
    initiativeCommands,
    epicCommands,
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
