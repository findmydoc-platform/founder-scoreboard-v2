"use client";

import { useEffect, useMemo, useRef } from "react";
import { normalizePlanningBoardQuery, planningBoardQueryKey } from "../model/planning-board-query";
import { normalizePlanningGanttQuery, planningGanttQueryKey } from "../model/planning-gantt-query";
import { usePlanningBootstrapState, type PlanningBootstrapStateOptions } from "@/features/planning/hooks/use-planning-bootstrap-state";
import { usePlanningCommandRegistry } from "@/features/planning/hooks/use-planning-command-registry";
import { usePlanningDerivedState } from "@/features/planning/hooks/use-planning-derived-state";
import { usePlanningTaskSelection } from "@/features/planning/hooks/use-planning-task-selection";
import { useTaskDetailDataLoader } from "@/features/tasks/hooks/use-task-detail-data-loader";

type PlanningAppControllerOptions = PlanningBootstrapStateOptions;

export function usePlanningAppController({
  initialBacklogRead,
  initialWorkspaceRead,
  initialTaskDetailRead,
  initialServerHeaderRead,
  initialDecisionLogResult,
  initialData,
  initialHeaderData,
  initialWorkspace,
  source,
  authRequired,
  initialAuthUser = null,
  initialCurrentProfile = null,
  initialProtectedDataLoaded = false,
  initialAuthError = "",
  operationalCorrection = false,
  administratorAccess,
}: PlanningAppControllerOptions) {
  const sidebarRef = useRef<HTMLElement | null>(null);
  const bootstrap = usePlanningBootstrapState({
    initialBacklogRead,
    initialWorkspaceRead,
    initialTaskDetailRead,
    initialServerHeaderRead,
    initialDecisionLogResult,
    initialData,
    initialHeaderData,
    initialWorkspace,
    source,
    authRequired,
    initialAuthUser,
    initialCurrentProfile,
    initialProtectedDataLoaded,
    initialAuthError,
    operationalCorrection,
    administratorAccess,
  });
  const {
    actualProfile,
    planningState,
    apiClient,
    authAvailable,
    authBusy,
    authChecked,
    authError,
    authNotice,
    authUser,
    canChangeTaskStatus,
    canCorrectOperationally,
    canManageFinalTaskStatus,
    canManageTaskMeta,
    currentProfile,
    currentProfileId,
    data,
    devProfileId,
    devRoleSwitchAvailable,
    filters,
    focusModeActive,
    hasPlanningBoardUrlState,
    hasPlanningFilterUrlState,
    githubConnectionState,
    githubInstallationAvailable,
    githubUserConnected,
    waitingGitHubCommentCount,
    githubReauthFailed,
    githubSyncQueueOpen,
    headerData,
    isPending,
    initiativeDialogDefaults,
    epicDeleteTarget,
    epicDialogDefaults,
    mobileNavOpen,
    planningLevel,
    planningParentFilterId,
    planningRemoteChangesAvailable,
    planningRemoteChangesUnverified,
    checkForPlanningRemoteChanges,
    planningRemoteChangesRefreshing,
    protectedDataLoaded,
    refreshCurrentWorkspaceModel,
    refreshPlanningRemoteChanges,
    saveError,
    selectedTaskId,
    setDevProfileId,
    setFilters,
    setGithubSyncQueueOpen,
    setInitiativeDialogDefaults,
    setEpicDeleteTarget,
    setEpicDialogDefaults,
    setMobileNavOpen,
    setPlanningLevel,
    setPlanningParentFilterId,
    setSaveError,
    setSelectedTaskId,
    setShowFilters,
    setSprintPlanningOptions,
    setStatusGuardNotice,
    setStatusGuardTaskId,
    setTaskDialogDefaults,
    setView,
    setWorkspace,
    showFilters,
    signIn,
    signOut,
    sprintPlanningOptions,
    startTransition,
    statusGuardNotice,
    statusGuardTaskId,
    taskDialogDefaults,
    toggleFocusMode,
    view,
    workspace,
    navigateWorkspaceHref,
  } = bootstrap;

  const commandContext = {
    planningState,
    apiClient,
    canChangeTaskStatus,
    canCorrectOperationally,
    canManageFinalTaskStatus,
    canManageTaskMeta,
    currentProfile,
    data,
    githubInstallationAvailable,
    githubUserConnected,
    setSaveError,
    source,
    startTransition,
  };

  const taskSelection = usePlanningTaskSelection({
    data,
    planningState,
    selectedTaskId,
    setSelectedTaskId,
  });
  const {
    backTaskPanel,
    closeTaskPanel,
    openTaskPanel,
    selectedTask,
  } = taskSelection;
  const taskDetailDataLoader = useTaskDetailDataLoader({
    scoped: true,
    planningState,
    selectedTask,
    taskId: protectedDataLoaded && authUser ? selectedTaskId || undefined : undefined,
    source,
    startTransition,
  });

  const planningBoard = planningState.board();
  const activeGantt = workspace === "planning" && view === "gantt";
  const ganttQuery = useMemo(() => normalizePlanningGanttQuery({ view: "gantt", filters }), [filters]);
  const submitGanttRead = useRef<(() => Promise<boolean>) | null>(null);
  const previousGanttSearch = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!activeGantt) return;
    const release = planningState.activateGantt();
    return () => {
      previousGanttSearch.current = undefined;
      release();
    };
  }, [activeGantt, planningState]);
  useEffect(() => {
    if (!activeGantt || !protectedDataLoaded || !ganttQuery) return;
    const abort = new AbortController();
    const search = ganttQuery.filters.query;
    const previousSearch = previousGanttSearch.current;
    previousGanttSearch.current = search;
    const load = () => planningState.loadGantt(ganttQuery, { signal: abort.signal });
    const timer = previousSearch !== undefined && previousSearch !== search ? setTimeout(() => { void load(); }, 250) : undefined;
    if (timer === undefined) void load();
    submitGanttRead.current = () => {
      clearTimeout(timer);
      return load();
    };
    return () => {
      clearTimeout(timer);
      abort.abort();
      submitGanttRead.current = null;
    };
  }, [activeGantt, ganttQuery, planningState, protectedDataLoaded]);
  useEffect(() => {
    if (!activeGantt || !protectedDataLoaded) return;
    const release = planningState.activateStructureControls();
    const abort = new AbortController();
    void planningState.loadStructureControls({ signal: abort.signal });
    return () => { abort.abort(); release(); };
  }, [activeGantt, planningState, protectedDataLoaded]);
  const selectedGantt = activeGantt ? planningState.gantt() : undefined;
  const ganttReady = Boolean(selectedGantt?.selection && ganttQuery
    && selectedGantt.selection.queryKey === planningGanttQueryKey(ganttQuery));

  const planningQuery = useMemo(() => normalizePlanningBoardQuery({ view: view === "table" ? "table" : view === "structure" ? "complete" : "board", level: planningLevel, parentId: planningParentFilterId, filters }), [view, planningLevel, planningParentFilterId, filters]);
  const planningQueryKey = planningBoardQueryKey(planningQuery);
  const usesScopedBoard = Boolean(planningBoard.queryKey) || planningBoard.requiresQueryRead === true;
  useEffect(() => {
    if (workspace === "planning" && view !== "structure" && view !== "gantt" && usesScopedBoard && !planningBoard.requiresQueryRead) void planningState.scheduleBoardQuery(planningQuery);
  }, [planningState, planningQuery, workspace, usesScopedBoard, planningBoard.requiresQueryRead, view]);
  const planningQueryReady = view === "structure" || view === "gantt" || !usesScopedBoard || (planningBoard.queryKey === planningQueryKey && JSON.stringify(planningBoard.query) === JSON.stringify(planningQuery));
  const displayedPlanningQuery = !planningQueryReady ? planningBoard.query : undefined;
  const loadCurrentGantt = () => submitGanttRead.current?.() ?? Promise.resolve(false);

  const derivedState = usePlanningDerivedState({
    currentProfile,
    data,
    workspaceTasks: planningState.workspace(workspace).tasks,
    boardResult: workspace === "planning" ? planningBoard.result : undefined,
    tableResult: workspace === "planning" ? planningBoard.table : undefined,
    filters: displayedPlanningQuery?.filters || filters,
    planningLevel: displayedPlanningQuery?.level || planningLevel,
    setInitiativeDialogDefaults,
    setEpicDialogDefaults,
    setTaskDialogDefaults,
    statusGuardTaskId,
    view: displayedPlanningQuery && displayedPlanningQuery.view !== "complete" ? displayedPlanningQuery.view : view,
    workspace,
  });
  const commandRegistry = usePlanningCommandRegistry({
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
    setInitiativeDialogDefaults,
    setStatusGuardNotice,
    setStatusGuardTaskId,
    setTaskDialogDefaults,
    setView,
    setWorkspace,
    workspace,
  });
  const { boardState } = commandRegistry;

  const releaseSidebarFocus = () => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && sidebarRef.current?.contains(activeElement)) {
      activeElement.blur();
    }
  };

  return {
    actualProfile,
    planningState,
    planningQueryReady,
    displayedPlanningQuery,
    submitPlanningSearch: () => activeGantt ? loadCurrentGantt() : planningState.scheduleBoardQuery(planningQuery, { immediate: true }),
    retryPlanningQuery: () => activeGantt ? loadCurrentGantt() : planningState.ensureBoardQuery(planningQuery),
    selectedGantt,
    ganttReady,
    planningBoard,
    beginTaskEdit: planningState.beginTaskEdit,
    authAvailable,
    authBusy,
    authChecked,
    authError,
    authNotice,
    authUser,
    canChangeTaskStatus,
    canCorrectOperationally,
    canManageFinalTaskStatus,
    canManageTaskMeta,
    backTaskPanel,
    closeTaskPanel,
    currentProfile,
    data,
    devProfileId,
    devRoleSwitchAvailable,
    filters,
    filtersAvailable: derivedState.filtersAvailable,
    focusModeActive,
    githubConnectionState,
    githubInstallationAvailable,
    githubUserConnected,
    waitingGitHubCommentCount,
    githubReauthFailed,
    githubSyncQueueOpen,
    headerData,
    headerActions: derivedState.headerActions,
    initiativeDialogDefaults,
    epicDeleteTarget,
    epicDialogDefaults,
    isPending,
    metrics: derivedState.metrics,
    mobileNavOpen,
    planningLevel,
    planningParentFilterId,
    planningRemoteChangesAvailable,
    planningRemoteChangesUnverified,
    checkForPlanningRemoteChanges,
    planningRemoteChangesRefreshing,
    openTaskPanel,
    startTaskPanel: taskSelection.startTaskPanel,
    protectedDataLoaded,
    refreshCurrentWorkspaceModel,
    refreshPlanningRemoteChanges,
    releaseSidebarFocus,
    apiClient,
    saveError,
    selectedInitiative: taskSelection.selectedInitiative,
    selectedTask,
    selectedTaskId,
    selectedTaskActivity: taskSelection.selectedTaskActivity,
    selectedTaskBlockers: taskSelection.selectedTaskBlockers,
    selectedTaskComments: taskSelection.selectedTaskComments,
    retrySelectedTaskDetail: taskDetailDataLoader.retrySelectedTaskDetail,
    selectedTaskDetailError: taskDetailDataLoader.selectedTaskDetailError,
    selectedTaskDetailLoading: taskDetailDataLoader.selectedTaskDetailLoading,
    selectedTaskExternalComments: taskSelection.selectedTaskExternalComments,
    selectedTaskSubIssues: taskSelection.selectedTaskSubIssues,
    taskPanelPreviousTask: taskSelection.taskPanelPreviousTask,
    taskPanelReturnFocusRef: taskSelection.taskPanelReturnFocusRef,
    setDevProfileId,
    setFilters,
    setGithubSyncQueueOpen,
    setInitiativeDialogDefaults,
    setEpicDeleteTarget,
    setEpicDialogDefaults,
    setMobileNavOpen,
    setPlanningLevel,
    setPlanningParentFilterId,
    setShowFilters,
    setSprintPlanningOptions,
    setStatusGuardNotice,
    setStatusGuardTaskId,
    setTaskDialogDefaults,
    setView,
    showFilters,
    sidebarRef,
    signIn,
    signOut,
    sprintPlanningOptions,
    source,
    statusGuardNotice,
    statusGuardTask: derivedState.statusGuardTask,
    taskDialogDefaults,
    toggleFocusMode,
    view,
    viewerOpenSubIssueIdsByDeliverableId: derivedState.viewerOpenSubIssueIdsByDeliverableId,
    visibleTasks: derivedState.visibleTasks,
    workspace,
    setWorkspace,
    navigateWorkspaceHref,
    ...boardState,
    ...commandRegistry.eventCommands,
    ...commandRegistry.fmdToolCommands,
    ...commandRegistry.initiativeCommands,
    ...commandRegistry.notificationCommands,
    ...commandRegistry.ownProfileSettingsCommands,
    ...commandRegistry.profileSettingsCommands,
    ...commandRegistry.reviewCommands,
    ...commandRegistry.taskCollaborationCommands,
    ...commandRegistry.taskMutationCommands,
  };
}

export type PlanningAppController = ReturnType<typeof usePlanningAppController>;
