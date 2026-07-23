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
import { useMilestoneCommands } from "@/features/projects/hooks/use-milestone-commands";
import { useReviewCommands } from "@/features/reviews/hooks/use-review-commands";
import { useSprintCommands } from "@/features/sprint/hooks/use-sprint-commands";
import { useWeeklyAttendanceCommands } from "@/features/sprint/hooks/use-weekly-attendance-commands";
import { useProfileSettingsCommands } from "@/features/team/hooks/use-profile-settings-commands";
import { useTaskCollaborationCommands } from "@/features/tasks/hooks/use-task-collaboration-commands";
import { useTaskMutationCommands } from "@/features/tasks/hooks/use-task-mutation-commands";
import { useFmdToolCommands } from "@/features/tools/hooks/use-fmd-tool-commands";
import { useFounderOpsSettingsCommands } from "@/features/settings/hooks/use-founderops-settings-commands";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import type { PlanningData, PlanningHeaderData, Task } from "@/lib/types";

type PlanningViewState = ReturnType<typeof usePlanningViewState>;

type UsePlanningCommandRegistryOptions = {
  closeTaskPanel: () => void;
  commandContext: PlanningCommandContext;
  currentProfileId: string;
  data: PlanningData;
  hasPlanningFilterUrlState: boolean;
  openTaskPanel: (taskId: string) => void;
  refreshPlanningData: () => Promise<void>;
  selectedTask: Task | null;
  setFilters: PlanningViewState["setFilters"];
  setHeaderData: Dispatch<SetStateAction<PlanningHeaderData>>;
  setInitiativeDialogDefaults: PlanningViewState["setInitiativeDialogDefaults"];
  setMilestoneDeleteTarget: PlanningViewState["setMilestoneDeleteTarget"];
  setMilestoneDialogDefaults: PlanningViewState["setMilestoneDialogDefaults"];
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
  hasPlanningFilterUrlState,
  openTaskPanel,
  refreshPlanningData,
  selectedTask,
  setFilters,
  setHeaderData,
  setInitiativeDialogDefaults,
  setMilestoneDeleteTarget,
  setMilestoneDialogDefaults,
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
    refreshPlanningData,
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
  const milestoneCommands = useMilestoneCommands({
    ...commandContext,
    setMilestoneDeleteTarget,
    setMilestoneDialogDefaults,
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
    hasPlanningFilterUrlState,
    setExpandedPackageIds: boardState.setExpandedPackageIds,
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
    refreshPlanningData,
    sprintPlanningOptions,
  });
  const profileSettingsCommands = useProfileSettingsCommands(commandContext);
  const ownProfileSettingsCommands = useOwnProfileSettingsCommands(commandContext);
  const founderOpsSettingsCommands = useFounderOpsSettingsCommands(commandContext);
  const fmdToolCommands = useFmdToolCommands(commandContext);
  const notificationCommands = useNotificationCommands({
    ...commandContext,
    openTaskPanel,
    refreshPlanningData,
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
    milestoneCommands,
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
