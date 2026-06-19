"use client";

import type { User } from "@supabase/supabase-js";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useDecisionCommands } from "@/features/decisions/hooks/use-decision-commands";
import { useExecutionCommands } from "@/features/execution/hooks/use-execution-commands";
import { useFounderEventCommands } from "@/features/events/hooks/use-founder-event-commands";
import { useMeetingCommands } from "@/features/meetings/hooks/use-meeting-commands";
import { useLocalPlanningState } from "@/features/planning/hooks/use-local-planning-state";
import { useNotificationCommands } from "@/features/planning/hooks/use-notification-commands";
import { usePlanningAuth } from "@/features/planning/hooks/use-planning-auth";
import { usePlanningBoardState } from "@/features/planning/hooks/use-planning-board-state";
import { usePlanningDataRefresh } from "@/features/planning/hooks/use-planning-data-refresh";
import { usePlanningRequestContext } from "@/features/planning/hooks/use-planning-request-context";
import { usePlanningTaskViewModel } from "@/features/planning/hooks/use-planning-task-view-model";
import { usePlanningViewState } from "@/features/planning/hooks/use-planning-view-state";
import { usePlanningWorkspace } from "@/features/planning/hooks/use-planning-workspace";
import { useInitiativeCommands } from "@/features/projects/hooks/use-initiative-commands";
import { useReviewCommands } from "@/features/reviews/hooks/use-review-commands";
import { useFeedbackCommands } from "@/features/settings/hooks/use-feedback-commands";
import { useSprintCommands } from "@/features/sprint/hooks/use-sprint-commands";
import { useProfileSettingsCommands } from "@/features/team/hooks/use-profile-settings-commands";
import { useTaskCollaborationCommands } from "@/features/tasks/hooks/use-task-collaboration-commands";
import { useTaskMutationCommands } from "@/features/tasks/hooks/use-task-mutation-commands";
import { taskBelongsToProfile } from "@/lib/platform";
import { hasSupabaseEnv } from "@/lib/supabase";
import type { AuthenticatedProfile, PlanningData, Task } from "@/lib/types";
import {
  buildHygieneAlerts,
  currentIsoDate,
  findCurrentSprint,
  normalizePlanningData,
  packageById,
  planningWorkspaces,
  sortTasks,
} from "@/features/planning/model/planning-app-model";

type PlanningAppControllerOptions = {
  initialData: PlanningData;
  source: "seed" | "supabase";
  authRequired: boolean;
  initialTaskId?: string;
  initialAuthUser?: User | null;
  initialCurrentProfile?: AuthenticatedProfile | null;
  initialProtectedDataLoaded?: boolean;
  initialAuthError?: string;
  initialReviewTaskId?: string;
};

type HeaderPrimaryAction = {
  label: string;
  onClick: () => void;
};

export function usePlanningAppController({
  initialData,
  source,
  authRequired,
  initialTaskId = "",
  initialAuthUser = null,
  initialCurrentProfile = null,
  initialProtectedDataLoaded = false,
  initialAuthError = "",
  initialReviewTaskId = "",
}: PlanningAppControllerOptions) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sidebarRef = useRef<HTMLElement | null>(null);
  const safeInitialData = useMemo(() => normalizePlanningData(initialData), [initialData]);
  const initialClientData = useMemo(() => safeInitialData, [safeInitialData]);
  const [data, setData] = useState(initialClientData);
  const { localStateLoaded } = useLocalPlanningState({ source, setData });
  const { workspace, setWorkspace } = usePlanningWorkspace();
  const {
    feedbackDialogOpen,
    filters,
    focusedReviewTaskId,
    initiativeDialogDefaults,
    mobileNavOpen,
    reviewOwnerFilter,
    reviewStatusFilter,
    selectedFeedbackId,
    selectedReviewDetailTaskId,
    selectedTaskId,
    setFeedbackDialogOpen,
    setFilters,
    setFocusedReviewTaskId,
    setInitiativeDialogDefaults,
    setMobileNavOpen,
    setReviewOwnerFilter,
    setReviewStatusFilter,
    setSelectedFeedbackId,
    setSelectedTaskId,
    setShowFilters,
    setShowNotifications,
    setSprintPlanningOptions,
    setTaskDialogDefaults,
    setView,
    showFilters,
    showNotifications,
    sprintPlanningOptions,
    taskDialogDefaults,
    view,
  } = usePlanningViewState({
    initialData: safeInitialData,
    initialFocusedReviewTaskId: searchParams.get("reviewTask") || "",
    initialReviewTaskId,
    initialTaskId,
  });
  const [isPending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState("");
  const [statusGuardNotice, setStatusGuardNotice] = useState("");
  const [statusGuardTaskId, setStatusGuardTaskId] = useState<string | null>(null);

  const clearSelectedTask = useCallback(() => setSelectedTaskId(null), [setSelectedTaskId]);
  const {
    authUser,
    serverCurrentProfile,
    authChecked,
    protectedDataLoaded,
    setProtectedDataLoaded,
    githubProviderTokenAvailable,
    githubReauthFailed,
    authError,
    authNotice,
    authBusy,
    signIn,
    signOut,
  } = usePlanningAuth({
    authRequired,
    source,
    safeInitialData,
    taskCount: data.tasks.length,
    initialAuthUser,
    initialCurrentProfile,
    initialProtectedDataLoaded,
    initialAuthError,
    setData,
    normalizePlanningData,
    onSignedOut: clearSelectedTask,
  });

  const authAvailable = hasSupabaseEnv();
  const currentGithubLogin = String(authUser?.user_metadata?.user_name || authUser?.user_metadata?.preferred_username || "");
  const {
    actualProfile,
    currentProfile,
    devProfileId,
    setDevProfileId,
    devRoleSwitchAvailable,
    apiClient,
  } = usePlanningRequestContext({
    source,
    profiles: data.profiles,
    currentGithubLogin,
    currentProfileId: serverCurrentProfile?.id || "",
  });
  const mineOwnerName = currentProfile?.name || "deinem Profil";
  const currentProfileId = currentProfile?.id || "";
  const canUseCeoIntake = currentProfile?.platformRole === "ceo";
  const canManageTaskMeta = source === "seed" || currentProfile?.platformRole === "ceo" || currentProfile?.platformRole === "deputy";
  const canChangeTaskStatus = useCallback((task: Task) => (
    canManageTaskMeta || taskBelongsToProfile(task, currentProfile)
  ), [canManageTaskMeta, currentProfile]);
  const { applyPlanningDataUpdate, refreshPlanningData } = usePlanningDataRefresh({
    apiClient,
    authUser,
    serverCurrentProfile,
    setData,
    setProtectedDataLoaded,
    source,
  });

  const commandContext = {
    apiClient,
    applyPlanningDataUpdate,
    canChangeTaskStatus,
    canManageTaskMeta,
    currentProfile,
    data,
    githubProviderTokenAvailable,
    setData,
    setSaveError,
    source,
    startTransition,
  };

  const selectedTask = data.tasks.find((task) => task.id === selectedTaskId) || null;
  const selectedReviewDetailTask = data.tasks.find((task) => task.id === selectedReviewDetailTaskId) || null;
  const selectedPackage = selectedTask ? packageById(data.packages, selectedTask.packageId) : undefined;
  const selectedTaskSubIssues = selectedTask ? sortTasks(data.tasks.filter((task) => task.parentTaskId === selectedTask.id)) : [];
  const selectedTaskComments = selectedTask ? data.taskComments.filter((comment) => comment.taskId === selectedTask.id) : [];
  const selectedTaskExternalComments = selectedTask ? data.taskExternalComments.filter((comment) => comment.taskId === selectedTask.id) : [];
  const selectedTaskActivity = selectedTask ? data.taskActivity.filter((activity) => activity.taskId === selectedTask.id) : [];
  const selectedTaskBlockers = selectedTask ? data.taskBlockers.filter((blocker) => blocker.taskId === selectedTask.id) : [];
  const fullTaskView = searchParams.get("view") === "full";

  const unreadNotifications = useMemo(() => {
    const pending = data.notificationEvents.filter((event) => event.status === "pending");
    if (!currentProfile) return pending;
    return pending.filter((event) => event.recipientProfileId === currentProfile.id);
  }, [currentProfile, data.notificationEvents]);
  const hygieneAlerts = useMemo(() => buildHygieneAlerts(data), [data]);
  const todayFocusDate = currentIsoDate();
  const currentProfileFocusItems = useMemo(() => {
    if (!currentProfileId) return [];
    return data.taskFocusItems
      .filter((item) => item.profileId === currentProfileId && item.focusDate === todayFocusDate)
      .sort((left, right) => left.position - right.position)
      .slice(0, 3);
  }, [currentProfileId, data.taskFocusItems, todayFocusDate]);

  const openTaskPanel = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    router.push(`/tasks/${encodeURIComponent(taskId)}`);
  }, [router, setSelectedTaskId]);

  const closeTaskPanel = useCallback(() => {
    setSelectedTaskId(null);
    if (pathname?.startsWith("/tasks/")) {
      if (window.history.length > 1) {
        router.back();
      } else {
        router.push("/");
      }
    }
  }, [pathname, router, setSelectedTaskId]);

  const openReviewSheet = useCallback((task: Task) => {
    setSelectedTaskId(null);
    setFocusedReviewTaskId(task.id);
    setWorkspace("reviews");
    router.push(`/reviews/${encodeURIComponent(task.id)}`);
  }, [router, setFocusedReviewTaskId, setSelectedTaskId, setWorkspace]);

  useEffect(() => {
    if (workspace === "ceo-intake" && authChecked && !canUseCeoIntake) {
      setWorkspace("planning");
    }
  }, [authChecked, canUseCeoIntake, setWorkspace, workspace]);

  useEffect(() => {
    if (!selectedTaskId) return;

    const closeOnBackspace = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable = target?.closest("input, textarea, select, [contenteditable='true']");
      if (isEditable || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "Backspace") return;

      event.preventDefault();
      closeTaskPanel();
    };

    window.addEventListener("keydown", closeOnBackspace);
    return () => window.removeEventListener("keydown", closeOnBackspace);
  }, [closeTaskPanel, selectedTaskId]);

  const { metrics, visibleTasks } = usePlanningTaskViewModel({ currentProfile, data, filters, workspace });
  const activeSprint = findCurrentSprint(data.sprints) || data.sprints[0];
  const filtersAvailable = planningWorkspaces.includes(workspace);
  const headerPrimaryAction: HeaderPrimaryAction | null = (() => {
    if (workspace === "planning") {
      return {
        label: "Neue Aufgabe",
        onClick: () => setTaskDialogDefaults({ taskType: "deliverable" }),
      };
    }

    if (workspace === "mine") {
      return {
        label: "Vorschlag erstellen",
        onClick: () => setTaskDialogDefaults({ taskType: "proposal" }),
      };
    }

    if (workspace === "sprint") {
      return {
        label: "Aufgabe hinzufügen",
        onClick: () =>
          setTaskDialogDefaults({
            taskType: "deliverable",
            sprintId: activeSprint?.id || "",
            startDate: activeSprint?.startDate || "",
            endDate: activeSprint?.endDate || "",
          }),
      };
    }

    if (workspace === "decisions") {
      return {
        label: "Neue Decision",
        onClick: () => document.getElementById("decision-create")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      };
    }

    if (workspace === "projects") {
      return {
        label: "Neue Initiative",
        onClick: () => setInitiativeDialogDefaults({}),
      };
    }

    if (workspace === "settings") {
      return {
        label: "Feedback erfassen",
        onClick: () => setFeedbackDialogOpen(true),
      };
    }

    return null;
  })();

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
  const executionCommands = useExecutionCommands({
    ...commandContext,
    currentProfileFocusItems,
    todayFocusDate,
  });
  const boardState = usePlanningBoardState({
    canChangeTaskStatus,
    data,
    setStatusGuardNotice,
    setStatusGuardTaskId,
    updateTask,
  });
  const eventCommands = useFounderEventCommands(commandContext);
  const meetingCommands = useMeetingCommands(commandContext);
  const decisionCommands = useDecisionCommands(commandContext);
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

  const statusGuardTask = statusGuardTaskId ? data.tasks.find((task) => task.id === statusGuardTaskId) : null;
  const releaseSidebarFocus = () => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && sidebarRef.current?.contains(activeElement)) {
      activeElement.blur();
    }
  };

  return {
    actualProfile,
    authAvailable,
    authBusy,
    authChecked,
    authError,
    authNotice,
    authUser,
    canChangeTaskStatus,
    canManageTaskMeta,
    canUseCeoIntake,
    closeTaskPanel,
    currentProfile,
    currentProfileFocusItems,
    data,
    devProfileId,
    devRoleSwitchAvailable,
    feedbackDialogOpen,
    filters,
    filtersAvailable,
    focusedReviewTaskId,
    fullTaskView,
    githubProviderTokenAvailable,
    githubReauthFailed,
    headerPrimaryAction,
    hygieneAlerts,
    initiativeDialogDefaults,
    isPending,
    localStateLoaded,
    metrics,
    mineOwnerName,
    mobileNavOpen,
    openReviewSheet,
    openTaskPanel,
    protectedDataLoaded,
    releaseSidebarFocus,
    apiClient,
    reviewOwnerFilter,
    reviewStatusFilter,
    saveError,
    selectedFeedbackId,
    selectedPackage,
    selectedReviewDetailTask,
    selectedReviewDetailTaskId,
    selectedTask,
    selectedTaskActivity,
    selectedTaskBlockers,
    selectedTaskComments,
    selectedTaskExternalComments,
    selectedTaskSubIssues,
    setData,
    setDevProfileId,
    setFeedbackDialogOpen,
    setFilters,
    setFocusedReviewTaskId,
    setInitiativeDialogDefaults,
    setMobileNavOpen,
    setReviewOwnerFilter,
    setReviewStatusFilter,
    setSelectedFeedbackId,
    setShowFilters,
    setShowNotifications,
    setSprintPlanningOptions,
    setStatusGuardNotice,
    setStatusGuardTaskId,
    setTaskDialogDefaults,
    setView,
    showFilters,
    showNotifications,
    sidebarRef,
    signIn,
    signOut,
    sprintPlanningOptions,
    statusGuardNotice,
    statusGuardTask,
    taskDialogDefaults,
    unreadNotifications,
    view,
    visibleTasks,
    workspace,
    setWorkspace,
    ...boardState,
    ...decisionCommands,
    ...eventCommands,
    ...executionCommands,
    ...feedbackCommands,
    ...initiativeCommands,
    ...meetingCommands,
    ...notificationCommands,
    ...profileSettingsCommands,
    ...reviewCommands,
    ...sprintCommands,
    ...taskCollaborationCommands,
    ...taskMutationCommands,
  };
}

export type PlanningAppController = ReturnType<typeof usePlanningAppController>;
