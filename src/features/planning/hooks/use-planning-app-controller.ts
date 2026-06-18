"use client";

import type { User } from "@supabase/supabase-js";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type DragEvent } from "react";
import { persistLocalPlanningTasks, useLocalPlanningState } from "@/features/planning/hooks/use-local-planning-state";
import { setProtectedPlanningDataCache, usePlanningAuth } from "@/features/planning/hooks/use-planning-auth";
import { usePlanningRequestContext } from "@/features/planning/hooks/use-planning-request-context";
import { usePlanningWorkspace } from "@/features/planning/hooks/use-planning-workspace";
import type { InitiativeDraft } from "@/features/projects/organisms/initiative-dialog";
import type { FeedbackDraft } from "@/features/settings/molecules/feedback-dialog";
import type { SprintPlanningOptions } from "@/features/settings/molecules/settings-sprint-planning";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import type { ReviewOwnerFilter, ReviewStatusFilter } from "@/features/reviews/model/review-workspace-view-model";
import { rememberGitHubProviderToken } from "@/lib/github-provider-token";
import { hasGitHubIssue, hasOpenWaitingRelation, taskBelongsToProfile } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import { getBrowserSupabase, hasSupabaseEnv } from "@/lib/supabase";
import type { AuthenticatedProfile, AvailabilityEntry, DecisionTaskLink, FeedbackItem, Meeting, MeetingAttendance, NotificationDelivery, NotificationEvent, NotificationPreference, Package, PlanningData, PlanningDataResponse, Profile, ScoreObjection, Sprint, SprintCommitment, Task, TaskActivity, TaskExternalComment, TaskFocusItem, TaskRelation, TaskRelationType, TaskStatus, ViewMode } from "@/lib/types";
import {
  addDaysIso,
  buildHygieneAlerts,
  createTaskDragPreview,
  currentIsoDate,
  findCurrentSprint,
  founderStatusGuardMessage,
  founderTaskOwnershipGuardMessage,
  futureSprintDrafts,
  isThisWeek,
  mapScoreObjectionResponse,
  normalizePlanningData,
  packageById,
  planningWorkspaces,
  profileForOwnerValue,
  reviewOwnerForTask,
  sortTasks,
  taskOwnerPatch,
  taskText,
  transparentDragImage,
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

type Filters = {
  query: string;
  owner: string;
  status: string;
  priority: string;
  packageId: string;
  quick: string;
};

type GoogleChatStatus = {
  webhookConfigured: boolean;
  apiConfigured: boolean;
  deliveryEnabled: boolean;
  ready: boolean;
  mode: "direct-dm" | "space-webhook" | "not-configured";
  pending: number;
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
  const autoImportedGitHubCommentsRef = useRef<Set<string>>(new Set());
  const optimisticAvailabilityIdRef = useRef(-1);
  const safeInitialData = useMemo(() => normalizePlanningData(initialData), [initialData]);
  const initialClientData = useMemo(() => safeInitialData, [safeInitialData]);
  const [data, setData] = useState(initialClientData);
  const { localStateLoaded } = useLocalPlanningState({ source, setData });
  const { workspace, setWorkspace } = usePlanningWorkspace();
  const [view, setView] = useState<ViewMode>("board");
  const [expandedPackages, setExpandedPackages] = useState<Record<string, boolean>>({});
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId || null);
  const [focusedReviewTaskId, setFocusedReviewTaskId] = useState(searchParams.get("reviewTask") || "");
  const [selectedReviewDetailTaskId] = useState(initialReviewTaskId);
  const [reviewStatusFilter, setReviewStatusFilter] = useState<ReviewStatusFilter>("open");
  const [reviewOwnerFilter, setReviewOwnerFilter] = useState<ReviewOwnerFilter>("all");
  const [taskDialogDefaults, setTaskDialogDefaults] = useState<Partial<NewTaskDraft> | null>(null);
  const [initiativeDialogDefaults, setInitiativeDialogDefaults] = useState<Partial<InitiativeDraft> | null>(null);
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<number | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState("");
  const [commentImportNotice, setCommentImportNotice] = useState("");
  const [commentImportPendingTaskIds, setCommentImportPendingTaskIds] = useState<Set<string>>(new Set());
  const [statusGuardNotice, setStatusGuardNotice] = useState("");
  const [statusGuardTaskId, setStatusGuardTaskId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [notificationDispatchMessage, setNotificationDispatchMessage] = useState("");
  const [calendarSyncMessage, setCalendarSyncMessage] = useState("");
  const [meetingCreateMessage, setMeetingCreateMessage] = useState("");
  const [googleChatStatus, setGoogleChatStatus] = useState<GoogleChatStatus | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sprintLockMessage, setSprintLockMessage] = useState("");
  const [sprintPlanningOptions, setSprintPlanningOptions] = useState<SprintPlanningOptions>({
    firstSprintNumber: 2,
    anchorStartDate: addDaysIso(safeInitialData.sprints[0]?.startDate || new Date().toISOString().slice(0, 10), 7),
    rhythmWeeks: 2,
    horizonWeeks: 6,
    targetSprintNumber: 0,
  });
  const [filters, setFilters] = useState<Filters>({
    query: "",
    owner: "Alle",
    status: "Alle",
    priority: "Alle",
    packageId: "Alle",
    quick: "",
  });
  const clearSelectedTask = useCallback(() => setSelectedTaskId(null), []);
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

  const selectedTask = data.tasks.find((task) => task.id === selectedTaskId) || null;
  const selectedReviewDetailTask = data.tasks.find((task) => task.id === selectedReviewDetailTaskId) || null;
  const selectedPackage = selectedTask ? packageById(data.packages, selectedTask.packageId) : undefined;
  const selectedTaskSubIssues = selectedTask ? sortTasks(data.tasks.filter((task) => task.parentTaskId === selectedTask.id)) : [];
  const selectedTaskComments = selectedTask ? data.taskComments.filter((comment) => comment.taskId === selectedTask.id) : [];
  const selectedTaskExternalComments = selectedTask ? data.taskExternalComments.filter((comment) => comment.taskId === selectedTask.id) : [];
  const selectedTaskActivity = selectedTask ? data.taskActivity.filter((activity) => activity.taskId === selectedTask.id) : [];
  const selectedTaskBlockers = selectedTask ? data.taskBlockers.filter((blocker) => blocker.taskId === selectedTask.id) : [];
  const fullTaskView = searchParams.get("view") === "full";
  const authAvailable = hasSupabaseEnv();
  const currentGithubLogin = String(authUser?.user_metadata?.user_name || authUser?.user_metadata?.preferred_username || "");
  const {
    actualProfile,
    currentProfile,
    devProfileId,
    setDevProfileId,
    devRoleSwitchAvailable,
    requestHeaders,
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
  const canChangeTaskStatus = (task: Task) => canManageTaskMeta || taskBelongsToProfile(task, currentProfile);
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
  }, [router]);

  const closeTaskPanel = useCallback(() => {
    setSelectedTaskId(null);
    if (pathname?.startsWith("/tasks/")) {
      if (window.history.length > 1) {
        router.back();
      } else {
        router.push("/");
      }
    }
  }, [pathname, router]);

  const openReviewSheet = useCallback((task: Task) => {
    setSelectedTaskId(null);
    setFocusedReviewTaskId(task.id);
    setWorkspace("reviews");
    router.push(`/reviews/${encodeURIComponent(task.id)}`);
  }, [router, setWorkspace]);

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

  const filteredTasks = useMemo(() => {
    return sortTasks(
      data.tasks.filter((task) => {
        if (task.taskType === "sub_issue") return false;
        const normalized = normalizeStatus(task.status);
        const matchesQuery = !filters.query || taskText(task).includes(filters.query.toLowerCase());
        const matchesOwner = filters.owner === "Alle" || task.owner === filters.owner;
        const matchesStatus = filters.status === "Alle" || normalized === filters.status;
        const matchesPriority = filters.priority === "Alle" || task.priority === filters.priority;
        const matchesPackage = filters.packageId === "Alle" || task.packageId === filters.packageId;
        const matchesQuick =
          !filters.quick ||
          (filters.quick === "mine" && taskBelongsToProfile(task, currentProfile)) ||
          (filters.quick === "open" && normalized === "Offen") ||
          (filters.quick === "blocked" && (normalized === "Blockiert" || Boolean(task.dependsOn))) ||
          (filters.quick === "week" && isThisWeek(task)) ||
          (filters.quick === "high" && ["P0", "P1"].includes(task.priority)) ||
          (filters.quick === "evidence" && !task.evidenceLink && !task.issueUrl);

        return matchesQuery && matchesOwner && matchesStatus && matchesPriority && matchesPackage && matchesQuick;
      }),
    );
  }, [currentProfile, data.tasks, filters]);

  const visibleTasks = useMemo(() => {
    if (workspace === "mine") return filteredTasks.filter((task) => taskBelongsToProfile(task, currentProfile));
    return filteredTasks;
  }, [currentProfile, filteredTasks, workspace]);
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

  const updateTask = (task: Task, patch: Partial<Task>) => {
    setSaveError("");
    setStatusGuardNotice("");
    setStatusGuardTaskId(null);
    let normalizedPatch = patch.owner !== undefined || patch.ownerId !== undefined
      ? { ...patch, ...taskOwnerPatch(patch.ownerId || patch.owner || "", data.profiles) }
      : patch;

    if (normalizedPatch.status === "Review" || normalizedPatch.reviewStatus === "requested") {
      if (task.scoreFinal) {
        setSaveError("Final bewertete Aufgaben können nicht erneut in Review gegeben werden.");
        return;
      }
      const nextTask = { ...task, ...normalizedPatch };
      normalizedPatch = {
        ...normalizedPatch,
        status: "Review",
        reviewStatus: "requested",
        scoreFinal: false,
        reviewOwnerProfileId: reviewOwnerForTask(nextTask, data.packages),
        reviewRequestedAt: new Date().toISOString(),
      };
    }

    if (normalizedPatch.status && !canChangeTaskStatus(task)) {
      setStatusGuardNotice(founderTaskOwnershipGuardMessage());
      setStatusGuardTaskId(task.id);
      return;
    }

    if (normalizedPatch.status && !canManageTaskMeta) {
      const guardedMessage = founderStatusGuardMessage(normalizedPatch.status as TaskStatus);
      if (guardedMessage) {
        setStatusGuardNotice(guardedMessage);
        setStatusGuardTaskId(task.id);
        return;
      }
    }

    applyPlanningDataUpdate((current) => {
      const nextData = {
        ...current,
        tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...normalizedPatch, githubSyncStatus: normalizedPatch.githubSyncStatus || "not_synced", githubSyncError: normalizedPatch.githubSyncStatus ? item.githubSyncError : "" } : item)),
      };

      if (source === "seed") {
        try {
          persistLocalPlanningTasks(nextData.tasks);
        } catch {
          // UI remains usable even if browser storage is unavailable.
        }
      }

      return nextData;
    });

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/tasks/${task.id}`, {
          method: "PATCH",
          headers: requestHeaders(token),
          body: JSON.stringify({
            status: normalizedPatch.status,
            owner: normalizedPatch.ownerId || normalizedPatch.owner,
            priority: normalizedPatch.priority,
            packageId: normalizedPatch.packageId,
            startDate: normalizedPatch.startDate,
            endDate: normalizedPatch.endDate,
            deadline: normalizedPatch.deadline,
            note: normalizedPatch.note,
            reviewStatus: normalizedPatch.reviewStatus,
            reviewOwnerProfileId: normalizedPatch.reviewOwnerProfileId,
            scorePoints: normalizedPatch.scorePoints,
            scoreFinal: normalizedPatch.scoreFinal,
            githubSyncStatus: normalizedPatch.githubSyncStatus,
            sprintId: normalizedPatch.sprintId,
            milestoneId: normalizedPatch.milestoneId,
            dependsOn: normalizedPatch.dependsOn,
            evidenceLink: normalizedPatch.evidenceLink,
            selfDodChecked: normalizedPatch.selfDodChecked,
            selfEvidenceChecked: normalizedPatch.selfEvidenceChecked,
            selfDocumentedChecked: normalizedPatch.selfDocumentedChecked,
            selfBlockersChecked: normalizedPatch.selfBlockersChecked,
          }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; activities?: TaskActivity[]; task?: Partial<Task> } | null;
        if (!response.ok) {
          throw new Error(body?.error || "Änderung konnte nicht gespeichert werden.");
        }
        if (body?.activities?.length) {
          applyPlanningDataUpdate((current) => ({
            ...current,
            taskActivity: [...body.activities!, ...current.taskActivity],
          }));
        }
        if (body?.task) {
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...body.task } : item)),
          }));
        }
        if (normalizedPatch.status && hasGitHubIssue(task) && githubProviderTokenAvailable && canManageTaskMeta) {
          syncTaskToGitHub({ ...task, ...normalizedPatch }, { silent: true });
        }
      } catch (error) {
        applyPlanningDataUpdate((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? task : item)),
        }));
        setSaveError(error instanceof Error ? error.message : "Änderung konnte nicht gespeichert werden.");
      }
    });
  };

  const createTask = (draft: NewTaskDraft) => {
    setSaveError("");

    const ownerProfile = profileForOwnerValue(data.profiles, draft.owner || currentProfile?.id || "");
    const ownerId = draft.taskType === "proposal" && !draft.owner ? "" : ownerProfile?.id || "";
    const owner = ownerId ? ownerProfile?.name || "" : "";
    const localTask: Task = {
      id: `local-${Date.now()}`,
      order: data.tasks.length + 1,
      title: draft.title,
      description: draft.description,
      problemStatement: draft.problemStatement,
      intendedOutcome: draft.intendedOutcome,
      scopeConstraints: draft.scopeConstraints,
      acceptanceCriteria: draft.acceptanceCriteria,
      evidenceRequired: draft.evidenceRequired,
      dodTemplateVersion: "founder-deliverable-v2",
      status: draft.taskType === "proposal" ? "Vorschlag" : draft.status || "Offen",
      priority: draft.priority || "P2",
      ownerId,
      owner,
      assigneeId: ownerId,
      assignee: owner,
      createdById: currentProfile?.id || "",
      workstream: draft.workstream,
      packageId: draft.packageId,
      milestoneId: draft.milestoneId,
      deadline: draft.deadline,
      definitionOfDone: draft.definitionOfDone,
      dependsOn: "",
      evidenceLink: "",
      issueNumber: "",
      issueUrl: "",
      note: "",
      watched: false,
      hours: draft.hours,
      startDate: draft.startDate,
      endDate: draft.endDate,
      sprintId: draft.taskType === "proposal" || draft.taskType === "sub_issue" ? "" : draft.sprintId,
      reviewStatus: "not_requested",
      reviewOwnerProfileId: reviewOwnerForTask({ packageId: draft.packageId }, data.packages),
      scorePoints: 0,
      scoreFinal: false,
      githubRepo: "findmydoc-platform/management",
      githubIssueNumber: null,
      githubIssueUrl: "",
      githubSyncStatus: "not_synced",
      githubLastSyncedAt: "",
      githubSyncError: "",
      taskType: draft.taskType,
      parentTaskId: draft.parentTaskId,
      scoreRelevant: draft.taskType === "deliverable",
      selfDodChecked: false,
      selfEvidenceChecked: false,
      selfDocumentedChecked: false,
      selfBlockersChecked: false,
    };

    const localDecisionLink: DecisionTaskLink | null = draft.decisionId
      ? {
        id: -Date.now() - 1,
        decisionId: draft.decisionId,
        taskId: localTask.id,
        linkType: "follows_from",
        note: draft.decisionLinkNote,
        createdBy: currentProfile?.id || "",
        createdAt: new Date().toISOString(),
      }
      : null;

    setData((current) => ({
      ...current,
      tasks: [...current.tasks, localTask],
      decisionTaskLinks: localDecisionLink ? [localDecisionLink, ...current.decisionTaskLinks] : current.decisionTaskLinks,
    }));
    setTaskDialogDefaults(null);

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      let createdTaskCommitted = false;

      try {
        const response = await fetch("/api/tasks", {
          method: "POST",
          headers: requestHeaders(token),
          body: JSON.stringify({ ...draft, owner: ownerId || draft.owner }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; task?: Task } | null;
        if (!response.ok || !body?.task) throw new Error(body?.error || "Aufgabe konnte nicht erstellt werden.");

        setData((current) => ({
          ...current,
          tasks: current.tasks.map((task) => (task.id === localTask.id ? body.task! : task)),
          decisionTaskLinks: localDecisionLink
            ? current.decisionTaskLinks.map((link) => (link.id === localDecisionLink.id ? { ...link, taskId: body.task!.id } : link))
            : current.decisionTaskLinks,
        }));
        createdTaskCommitted = true;

        if (draft.decisionId) {
          const decisionResponse = await fetch(`/api/decisions/${draft.decisionId}/tasks`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ taskId: body.task.id, linkType: "follows_from", note: draft.decisionLinkNote }),
          });
          const decisionBody = (await decisionResponse.json().catch(() => null)) as { error?: string; link?: DecisionTaskLink } | null;
          if (!decisionResponse.ok || !decisionBody?.link) throw new Error(decisionBody?.error || "Decision-Folgeaufgabe konnte nicht verknüpft werden.");
          setData((current) => ({
            ...current,
            decisionTaskLinks: localDecisionLink
              ? current.decisionTaskLinks.map((link) => (link.id === localDecisionLink.id ? decisionBody.link! : link))
              : [decisionBody.link!, ...current.decisionTaskLinks],
          }));
        }

        if (draft.relatedTaskId && draft.relatedTaskId !== body.task.id) {
          const relationResponse = await fetch(`/api/tasks/${body.task.id}/relationships`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              relationType: draft.relationType,
              relatedTaskId: draft.relatedTaskId,
              note: draft.relationNote,
            }),
          });
          const relationBody = (await relationResponse.json().catch(() => null)) as { error?: string; relation?: TaskRelation } | null;
          if (!relationResponse.ok || !relationBody?.relation) throw new Error(relationBody?.error || "Relationship konnte nicht gespeichert werden.");
          setData((current) => ({
            ...current,
            taskRelations: [relationBody.relation!, ...current.taskRelations],
            tasks: current.tasks.map((task) =>
              task.id === body.task!.id || task.id === draft.relatedTaskId
                ? { ...task, githubSyncStatus: "not_synced", githubSyncError: "" }
                : task,
            ),
          }));
        }

        if (draft.createGitHubIssue && body.task.taskType === "deliverable") {
          rememberGitHubProviderToken(session?.data.session?.provider_token);
          const syncResponse = await fetch(`/api/tasks/${body.task.id}/sync-github`, {
            method: "POST",
            headers: requestHeaders(token, { github: true }),
            body: JSON.stringify({ createIfMissing: true }),
          });
          const syncBody = (await syncResponse.json().catch(() => null)) as { error?: string; task?: Task } | null;
          if (!syncResponse.ok || !syncBody?.task) throw new Error(syncBody?.error || "GitHub-Issue konnte nicht angelegt werden.");
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((task) => (task.id === body.task!.id ? syncBody.task! : task)),
          }));
        }
      } catch (error) {
        if (!createdTaskCommitted) {
          setData((current) => ({
            ...current,
            tasks: current.tasks.filter((task) => task.id !== localTask.id),
            decisionTaskLinks: localDecisionLink ? current.decisionTaskLinks.filter((link) => link.id !== localDecisionLink.id) : current.decisionTaskLinks,
          }));
        }
        setSaveError(error instanceof Error ? error.message : "Aufgabe konnte nicht erstellt werden.");
      }
    });
  };

  const saveInitiative = (draft: InitiativeDraft) => {
    setSaveError("");

    const localInitiative: Package = {
      id: draft.id || `local-initiative-${Date.now()}`,
      milestoneId: draft.milestoneId,
      ownerId: draft.ownerId,
      accountableProfileId: draft.accountableProfileId,
      responsibleProfileIds: draft.responsibleProfileIds,
      consultedProfileIds: draft.consultedProfileIds,
      informedProfileIds: draft.informedProfileIds,
      title: draft.title,
      goal: draft.goal,
      priority: draft.priority || "P2",
      status: draft.status || "planned",
      targetDate: draft.targetDate,
      successCriteria: draft.successCriteria,
      scopeConstraints: draft.scopeConstraints,
      sortOrder: draft.id ? data.packages.find((pack) => pack.id === draft.id)?.sortOrder || data.packages.length + 1 : data.packages.length + 1,
    };
    const isEdit = Boolean(draft.id);

    setData((current) => ({
      ...current,
      packages: isEdit
        ? current.packages.map((pack) => (pack.id === draft.id ? { ...pack, ...localInitiative } : pack))
        : [...current.packages, localInitiative],
    }));
    setInitiativeDialogDefaults(null);

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(isEdit ? `/api/initiatives/${draft.id}` : "/api/initiatives", {
          method: isEdit ? "PATCH" : "POST",
          headers: requestHeaders(token),
          body: JSON.stringify(draft),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; initiative?: Package } | null;
        if (!response.ok || !body?.initiative) throw new Error(body?.error || "Initiative konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          packages: isEdit
            ? current.packages.map((pack) => (pack.id === draft.id ? body.initiative! : pack))
            : current.packages.map((pack) => (pack.id === localInitiative.id ? body.initiative! : pack)),
        }));
      } catch (error) {
        setData((current) => ({
          ...current,
          packages: isEdit
            ? current.packages.map((pack) => (pack.id === draft.id ? data.packages.find((original) => original.id === draft.id) || pack : pack))
            : current.packages.filter((pack) => pack.id !== localInitiative.id),
        }));
        setSaveError(error instanceof Error ? error.message : "Initiative konnte nicht gespeichert werden.");
      }
    });
  };

  const upsertFocusItem = (task: Task, nextStep: string, status: TaskFocusItem["status"] = "planned") => {
    setSaveError("");
    if (!currentProfile) {
      setSaveError("Profil konnte nicht bestimmt werden. Bitte erneut anmelden.");
      return;
    }
    const profileId = currentProfile.id;
    const existing = data.taskFocusItems.find((item) => item.profileId === profileId && item.taskId === task.id && item.focusDate === todayFocusDate);
    const position = existing?.position || Math.min(currentProfileFocusItems.length + 1, 3);
    const localItem: TaskFocusItem = {
      id: existing?.id || -Date.now(),
      profileId,
      taskId: task.id,
      focusDate: todayFocusDate,
      position,
      nextStep,
      status,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setData((current) => ({
      ...current,
      taskFocusItems: existing
        ? current.taskFocusItems.map((item) => (item.id === existing.id ? localItem : item))
        : [localItem, ...current.taskFocusItems],
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      try {
        const response = await fetch("/api/focus", {
          method: "POST",
          headers: requestHeaders(token),
          body: JSON.stringify({ taskId: task.id, profileId, focusDate: todayFocusDate, position, nextStep, status }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; focusItem?: TaskFocusItem } | null;
        if (!response.ok || !body?.focusItem) throw new Error(body?.error || "Fokus konnte nicht gespeichert werden.");
        setData((current) => ({
          ...current,
          taskFocusItems: current.taskFocusItems.map((item) => (item.id === localItem.id ? body.focusItem! : item)),
        }));
      } catch (error) {
        setData((current) => ({
          ...current,
          taskFocusItems: existing ? current.taskFocusItems.map((item) => (item.id === existing.id ? existing : item)) : current.taskFocusItems.filter((item) => item.id !== localItem.id),
        }));
        setSaveError(error instanceof Error ? error.message : "Fokus konnte nicht gespeichert werden.");
      }
    });
  };

  const removeFocusItem = (focusItem: TaskFocusItem) => {
    setSaveError("");
    setData((current) => ({
      ...current,
      taskFocusItems: current.taskFocusItems.filter((item) => item.id !== focusItem.id),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      try {
        const response = await fetch(`/api/focus?id=${encodeURIComponent(String(focusItem.id))}`, {
          method: "DELETE",
          headers: requestHeaders(token, { json: false }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(body?.error || "Fokus konnte nicht entfernt werden.");
      } catch (error) {
        setData((current) => ({ ...current, taskFocusItems: [focusItem, ...current.taskFocusItems] }));
        setSaveError(error instanceof Error ? error.message : "Fokus konnte nicht entfernt werden.");
      }
    });
  };

  const linkDecisionTask = (decisionId: number, taskId: string, note: string) => {
    setSaveError("");
    const localLink: DecisionTaskLink = {
      id: -Date.now(),
      decisionId,
      taskId,
      linkType: "follows_from",
      note,
      createdBy: currentProfile?.id || "",
      createdAt: new Date().toISOString(),
    };

    setData((current) => {
      const exists = current.decisionTaskLinks.some((link) => link.decisionId === decisionId && link.taskId === taskId);
      return exists ? current : { ...current, decisionTaskLinks: [localLink, ...current.decisionTaskLinks] };
    });

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      try {
        const response = await fetch(`/api/decisions/${decisionId}/tasks`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ taskId, linkType: "follows_from", note }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; link?: DecisionTaskLink } | null;
        if (!response.ok || !body?.link) throw new Error(body?.error || "Decision-Link konnte nicht gespeichert werden.");
        setData((current) => ({
          ...current,
          decisionTaskLinks: current.decisionTaskLinks.map((link) => (link.id === localLink.id ? body.link! : link)),
        }));
      } catch (error) {
        setData((current) => ({ ...current, decisionTaskLinks: current.decisionTaskLinks.filter((link) => link.id !== localLink.id) }));
        setSaveError(error instanceof Error ? error.message : "Decision-Link konnte nicht gespeichert werden.");
      }
    });
  };

  const removeDecisionTaskLink = (link: DecisionTaskLink) => {
    setSaveError("");
    setData((current) => ({
      ...current,
      decisionTaskLinks: current.decisionTaskLinks.filter((item) => item.id !== link.id),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      try {
        const response = await fetch(`/api/decisions/${link.decisionId}/tasks?linkId=${encodeURIComponent(String(link.id))}`, {
          method: "DELETE",
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        });
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(body?.error || "Decision-Link konnte nicht entfernt werden.");
      } catch (error) {
        setData((current) => ({ ...current, decisionTaskLinks: [link, ...current.decisionTaskLinks] }));
        setSaveError(error instanceof Error ? error.message : "Decision-Link konnte nicht entfernt werden.");
      }
    });
  };

  const startTaskDrag = (task: Task, event: DragEvent<HTMLElement>) => {
    if (!canChangeTaskStatus(task)) {
      event.preventDefault();
      setStatusGuardNotice(founderTaskOwnershipGuardMessage());
      setStatusGuardTaskId(task.id);
      return;
    }
    setDraggedTaskId(task.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    event.dataTransfer.setDragImage(transparentDragImage(), 0, 0);

    const preview = createTaskDragPreview(event.currentTarget, event.clientX, event.clientY);
    document.body.style.cursor = "none";

    const movePreview = (dragEvent: globalThis.DragEvent) => {
      if (dragEvent.clientX === 0 && dragEvent.clientY === 0) return;
      preview.style.left = `${dragEvent.clientX - 24}px`;
      preview.style.top = `${dragEvent.clientY - 18}px`;
    };
    const cleanupPreview = () => {
      preview.remove();
      document.body.style.cursor = "";
      window.removeEventListener("dragover", movePreview);
      window.removeEventListener("drop", cleanupPreview);
      window.removeEventListener("dragend", cleanupPreview);
    };

    window.addEventListener("dragover", movePreview);
    window.addEventListener("drop", cleanupPreview, { once: true });
    window.addEventListener("dragend", cleanupPreview, { once: true });
  };

  const dropTaskOnStatus = (status: TaskStatus, event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;
    const task = data.tasks.find((item) => item.id === taskId);
    setDraggedTaskId(null);
    setDragOverStatus(null);
    if (!task || normalizeStatus(task.status) === status) return;
    if (!canChangeTaskStatus(task)) {
      setStatusGuardNotice(founderTaskOwnershipGuardMessage());
      setStatusGuardTaskId(task.id);
      return;
    }
    updateTask(task, { status });
  };

  const endTaskDrag = () => {
    setDraggedTaskId(null);
    setDragOverStatus(null);
  };

  const togglePackageCollapse = (packageId: string) => {
    setExpandedPackages((current) => ({ ...current, [packageId]: !current[packageId] }));
  };

  const setAllPackageCollapse = (collapsed: boolean) => {
    setExpandedPackages(Object.fromEntries(data.packages.map((pack) => [pack.id, !collapsed])));
  };

  const updateSprint = (sprint: Sprint, patch: Partial<Sprint>) => {
    setSaveError("");

    setData((current) => ({
      ...current,
      sprints: current.sprints.map((item) => (item.id === sprint.id ? { ...item, ...patch } : item)),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/sprints/${sprint.id}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            name: patch.name,
            status: patch.status,
            startDate: patch.startDate,
            endDate: patch.endDate,
            reviewDueAt: patch.reviewDueAt,
          }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || "Sprint konnte nicht gespeichert werden.");
        }

        const body = (await response.json()) as { sprint?: Sprint };
        if (body.sprint) {
          setData((current) => ({
            ...current,
            sprints: current.sprints.map((item) => (item.id === sprint.id ? body.sprint! : item)),
          }));
        }
      } catch (error) {
        setData((current) => ({
          ...current,
          sprints: current.sprints.map((item) => (item.id === sprint.id ? sprint : item)),
        }));
        setSaveError(error instanceof Error ? error.message : "Sprint konnte nicht gespeichert werden.");
      }
    });
  };

  const createSprintPlanAsync = async (options: SprintPlanningOptions, silent = false) => {
    const protectedSprintIds = new Set(data.tasks.filter((task) => task.sprintId).map((task) => task.sprintId));
    const drafts = futureSprintDrafts(data.sprints, options, protectedSprintIds);
    if (!drafts.length) {
      if (!silent) setSprintLockMessage("Die Sprint-Zeiträume entsprechen bereits der aktuellen Logik. Sprints mit Aufgabenbezug werden nicht automatisch umgeplant.");
      return 0;
    }

    const draftIds = new Set(drafts.map((sprint) => sprint.id));
    setData((current) => ({
      ...current,
      sprints: [
        ...current.sprints.filter((sprint) => !draftIds.has(sprint.id)),
        ...drafts,
      ].sort((a, b) => (a.startDate || "").localeCompare(b.startDate || "")),
    }));

    if (source !== "supabase") {
      if (!silent) setSprintLockMessage(`${drafts.length} Sprint${drafts.length === 1 ? "" : "s"} lokal aktualisiert.`);
      return drafts.length;
    }

    const session = await getBrowserSupabase()?.auth.getSession();
    const token = session?.data.session?.access_token;

    try {
      const response = await fetch("/api/sprints", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(options),
      });

      const body = (await response.json().catch(() => null)) as { error?: string; sprints?: Sprint[] } | null;
      if (!response.ok) throw new Error(body?.error || "Sprints konnten nicht angelegt werden.");

      if (body?.sprints) {
        setData((current) => ({
          ...current,
          sprints: [
            ...current.sprints.filter((sprint) => !draftIds.has(sprint.id)),
            ...body.sprints!,
          ].sort((a, b) => (a.startDate || "").localeCompare(b.startDate || "")),
        }));
      }

      if (!silent) setSprintLockMessage(`${body?.sprints?.length || drafts.length} Sprint${(body?.sprints?.length || drafts.length) === 1 ? "" : "s"} aktualisiert. Sprints mit Aufgabenbezug bleiben geschützt.`);
      return body?.sprints?.length || drafts.length;
    } catch (error) {
      setData((current) => ({
        ...current,
        sprints: current.sprints.filter((sprint) => !draftIds.has(sprint.id)),
      }));
      setSaveError(error instanceof Error ? error.message : "Sprints konnten nicht angelegt werden.");
      return 0;
    }
  };

  const createSprintPlan = (options: SprintPlanningOptions) => {
    setSaveError("");
    setSprintLockMessage("");
    startTransition(async () => {
      await createSprintPlanAsync(options);
    });
  };

  const updateSprintCommitment = (commitment: SprintCommitment) => {
    setSaveError("");

    setData((current) => {
      const exists = current.sprintCommitments.some((item) => item.sprintId === commitment.sprintId && item.profileId === commitment.profileId);
      return {
        ...current,
        sprintCommitments: exists
          ? current.sprintCommitments.map((item) => (item.sprintId === commitment.sprintId && item.profileId === commitment.profileId ? commitment : item))
          : [commitment, ...current.sprintCommitments],
      };
    });

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/sprint-commitments", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(commitment),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; commitment?: SprintCommitment } | null;
        if (!response.ok || !body?.commitment) throw new Error(body?.error || "Commitment konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          sprintCommitments: current.sprintCommitments.map((item) =>
            item.sprintId === commitment.sprintId && item.profileId === commitment.profileId ? body.commitment! : item,
          ),
        }));
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Commitment konnte nicht gespeichert werden.");
      }
    });
  };

  const saveProfileSettings = async (profile: Profile, patch: Partial<Profile>, notificationEvents: Record<string, boolean>) => {
    setSaveError("");
    const previousData = data;
    const changedNotificationEvents = Object.entries(notificationEvents).filter(([eventType, enabled]) => {
      const currentPreference = data.notificationPreferences.find((item) => item.profileId === profile.id && item.channel === "google_chat" && item.eventType === eventType);
      return (currentPreference?.enabled !== false) !== enabled;
    });

    setData((current) => {
      const nextPreferences = changedNotificationEvents.reduce((preferences, [eventType, enabled]) => {
        const existing = preferences.find((item) => item.profileId === profile.id && item.channel === "google_chat" && item.eventType === eventType);
        if (existing) {
          return preferences.map((item) =>
            item.profileId === profile.id && item.channel === "google_chat" && item.eventType === eventType ? { ...item, enabled } : item
          );
        }
        return [
          {
            id: Date.now() + preferences.length,
            profileId: profile.id,
            channel: "google_chat",
            eventType,
            enabled,
          } satisfies NotificationPreference,
          ...preferences,
        ];
      }, current.notificationPreferences);

      return {
        ...current,
        profiles: current.profiles.map((item) => {
          if (item.id === profile.id) return { ...item, ...patch };
          if (patch.platformRole === "ceo" && item.platformRole === "ceo") {
            return { ...item, platformRole: "founder", orgRole: item.orgRole === "CEO" ? "Founder" : item.orgRole };
          }
          return item;
        }),
        notificationPreferences: nextPreferences,
      };
    });

    if (source !== "supabase") return;

    const session = await getBrowserSupabase()?.auth.getSession();
    const token = session?.data.session?.access_token;

    try {
      const profileResponse = await fetch(`/api/profiles/${profile.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          githubLogin: patch.githubLogin,
          platformRole: patch.platformRole,
          orgRole: patch.orgRole,
          deputyFor: patch.deputyFor,
          deputyActiveFrom: patch.deputyActiveFrom,
          deputyActiveUntil: patch.deputyActiveUntil,
          focus: patch.focus,
          weeklyCapacity: patch.weeklyCapacity,
          color: patch.color,
          googleChatUserId: patch.googleChatUserId,
          googleChatDmSpace: patch.googleChatDmSpace,
          notificationsEnabled: patch.notificationsEnabled,
          googleCalendarEmail: patch.googleCalendarEmail,
          googleCalendarSyncEnabled: patch.googleCalendarSyncEnabled,
        }),
      });
      const profileBody = (await profileResponse.json().catch(() => null)) as { error?: string; profile?: Profile } | null;
      if (!profileResponse.ok) throw new Error(profileBody?.error || "Profil konnte nicht gespeichert werden.");

      const savedPreferences: NotificationPreference[] = [];
      for (const [eventType, enabled] of changedNotificationEvents) {
        const preferenceResponse = await fetch("/api/notification-preferences", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ profileId: profile.id, eventType, enabled }),
        });
        const preferenceBody = (await preferenceResponse.json().catch(() => null)) as { error?: string; preference?: NotificationPreference } | null;
        if (!preferenceResponse.ok || !preferenceBody?.preference) throw new Error(preferenceBody?.error || "Benachrichtigungseinstellung konnte nicht gespeichert werden.");
        savedPreferences.push(preferenceBody.preference);
      }

      setData((current) => ({
        ...current,
        profiles: profileBody?.profile
          ? current.profiles.map((item) => (item.id === profile.id ? { ...item, ...profileBody.profile } : item))
          : current.profiles,
        notificationPreferences: savedPreferences.length
          ? current.notificationPreferences.map((item) => {
            const saved = savedPreferences.find((preference) => preference.profileId === item.profileId && preference.channel === item.channel && preference.eventType === item.eventType);
            return saved || item;
          })
          : current.notificationPreferences,
      }));
    } catch (error) {
      setData(previousData);
      setSaveError(error instanceof Error ? error.message : "Profil konnte nicht gespeichert werden.");
      throw error;
    }
  };

  const updateMeetingAttendance = (meeting: Meeting, attendance: MeetingAttendance) => {
    setSaveError("");

    const previousData = data;
    setData((current) => {
      const exists = current.meetingAttendance.some((item) => item.meetingId === attendance.meetingId && item.profileId === attendance.profileId);
      return {
        ...current,
        meetingAttendance: exists
          ? current.meetingAttendance.map((item) => (item.meetingId === attendance.meetingId && item.profileId === attendance.profileId ? attendance : item))
          : [attendance, ...current.meetingAttendance],
      };
    });

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/meetings/${meeting.id}/attendance`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            profileId: attendance.profileId,
            status: attendance.status,
            absenceReason: attendance.absenceReason,
            reasonAccepted: attendance.reasonAccepted,
            writtenUpdate: attendance.writtenUpdate,
            points: attendance.points,
          }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; attendance?: MeetingAttendance } | null;
        if (!response.ok || !body?.attendance) throw new Error(body?.error || "Meeting-Rückmeldung konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          meetingAttendance: current.meetingAttendance.map((item) =>
            item.meetingId === attendance.meetingId && item.profileId === attendance.profileId ? body.attendance! : item,
          ),
        }));
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Meeting-Rückmeldung konnte nicht gespeichert werden.");
      }
    });
  };

  const createMeetingFromSlot = (payload: {
    title: string;
    agenda: string;
    sprintId: string;
    meetingAt: string;
    durationMinutes: number;
    profileIds: string[];
  }) => {
    setSaveError("");
    setMeetingCreateMessage("");

    const localMeetingId = Date.now();
    const now = new Date().toISOString();
    const localMeeting: Meeting = {
      id: localMeetingId,
      sprintId: payload.sprintId,
      title: payload.title,
      meetingAt: payload.meetingAt,
      durationMinutes: payload.durationMinutes,
      status: "planned",
      agenda: payload.agenda,
      googleCalendarSyncStatus: "not_synced",
    };
    const localAttendance: MeetingAttendance[] = payload.profileIds.map((profileId, index) => ({
      id: localMeetingId + index + 1,
      meetingId: localMeetingId,
      profileId,
      status: "pending",
      absenceReason: "",
      reasonAccepted: false,
      writtenUpdate: "",
      points: 0,
      createdAt: now,
      updatedAt: now,
    }));
    const previousData = data;

    setData((current) => ({
      ...current,
      meetings: [localMeeting, ...current.meetings],
      meetingAttendance: [...localAttendance, ...current.meetingAttendance],
    }));
    setMeetingCreateMessage(`Meeting vorgemerkt: ${payload.title}`);

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/meetings", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; meeting?: Meeting; attendance?: MeetingAttendance[]; calendarSync?: { status: "synced" | "skipped" | "failed"; htmlLink?: string; error?: string } } | null;
        if (!response.ok || !body?.meeting) throw new Error(body?.error || "Meeting konnte nicht vorgemerkt werden.");

        setData((current) => ({
          ...current,
          meetings: current.meetings.map((item) => (item.id === localMeetingId ? body.meeting! : item)),
          meetingAttendance: [
            ...(body.attendance || []),
            ...current.meetingAttendance.filter((item) => item.meetingId !== localMeetingId),
          ],
        }));
        setMeetingCreateMessage(body.calendarSync?.status === "synced"
          ? `Meeting angelegt und mit Google Kalender synchronisiert: ${body.meeting.title}`
          : body.calendarSync?.status === "failed"
            ? `Meeting angelegt. Google Kalender Sync fehlgeschlagen: ${body.calendarSync.error}`
            : `Meeting in der App angelegt: ${body.meeting.title}`);
      } catch (error) {
        setData(previousData);
        setMeetingCreateMessage("");
        setSaveError(error instanceof Error ? error.message : "Meeting konnte nicht vorgemerkt werden.");
      }
    });
  };

  const updateMeeting = (meeting: Meeting, patch: Partial<Pick<Meeting, "title" | "agenda" | "meetingAt" | "status">>) => {
    setSaveError("");
    setMeetingCreateMessage("");

    const previousData = data;
    const nextMeeting = { ...meeting, ...patch };
    setData((current) => ({
      ...current,
      meetings: current.meetings.map((item) => (item.id === meeting.id ? nextMeeting : item)),
    }));
    setMeetingCreateMessage(nextMeeting.status === "cancelled" ? `Meeting abgesagt: ${nextMeeting.title}` : `Meeting aktualisiert: ${nextMeeting.title}`);

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/meetings", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            id: meeting.id,
            title: patch.title,
            agenda: patch.agenda,
            meetingAt: patch.meetingAt,
            status: patch.status,
          }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; meeting?: Meeting } | null;
        if (!response.ok || !body?.meeting) throw new Error(body?.error || "Meeting konnte nicht aktualisiert werden.");

        setData((current) => ({
          ...current,
          meetings: current.meetings.map((item) => (item.id === meeting.id ? body.meeting! : item)),
        }));
        setMeetingCreateMessage(body.meeting.status === "cancelled" ? `Meeting abgesagt: ${body.meeting.title}` : `Meeting aktualisiert: ${body.meeting.title}`);
      } catch (error) {
        setData(previousData);
        setMeetingCreateMessage("");
        setSaveError(error instanceof Error ? error.message : "Meeting konnte nicht aktualisiert werden.");
      }
    });
  };

  const createAvailability = (entry: Omit<AvailabilityEntry, "id">) => {
    setSaveError("");

    const localEntry: AvailabilityEntry = { ...entry, id: optimisticAvailabilityIdRef.current };
    optimisticAvailabilityIdRef.current -= 1;
    const previousData = data;
    setData((current) => ({
      ...current,
      availability: [localEntry, ...current.availability],
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/availability", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(entry),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; availability?: AvailabilityEntry } | null;
        if (!response.ok || !body?.availability) throw new Error(body?.error || "Verfügbarkeit konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          availability: current.availability.map((item) => (item.id === localEntry.id ? body.availability! : item)),
        }));
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Verfügbarkeit konnte nicht gespeichert werden.");
      }
    });
  };

  const deleteAvailability = (entry: AvailabilityEntry) => {
    setSaveError("");

    const previousData = data;
    setData((current) => ({
      ...current,
      availability: current.availability.filter((item) => item.id !== entry.id),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/availability", {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ id: entry.id }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(body?.error || "Verfügbarkeit konnte nicht gelöscht werden.");
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Verfügbarkeit konnte nicht gelöscht werden.");
      }
    });
  };

  const updateAvailability = (entry: AvailabilityEntry, patch: Partial<Omit<AvailabilityEntry, "id" | "source" | "externalId" | "externalCalendarId" | "syncedAt">>) => {
    setSaveError("");

    const updatedEntry: AvailabilityEntry = { ...entry, ...patch };
    const previousData = data;
    setData((current) => ({
      ...current,
      availability: current.availability.map((item) => (item.id === entry.id ? updatedEntry : item)),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/availability", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ id: entry.id, ...patch }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; availability?: AvailabilityEntry } | null;
        if (!response.ok || !body?.availability) throw new Error(body?.error || "Verfügbarkeit konnte nicht aktualisiert werden.");

        setData((current) => ({
          ...current,
          availability: current.availability.map((item) => (item.id === entry.id ? body.availability! : item)),
        }));
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Verfügbarkeit konnte nicht aktualisiert werden.");
      }
    });
  };

  const syncGoogleCalendar = () => {
    setSaveError("");
    setCalendarSyncMessage("Google Calendar Sync wird geprüft...");

    if (source !== "supabase") {
      setCalendarSyncMessage("Google Calendar Sync ist nur mit Supabase-Datenquelle aktiv.");
      return;
    }

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/calendar-sync", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        });
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          ready?: boolean;
          skipped?: boolean;
          reason?: string;
          imported?: number;
          removed?: number;
          syncedAt?: string;
          availability?: AvailabilityEntry[];
          results?: Array<{ profileId: string; email: string; imported: number; removed?: number; error?: string }>;
        } | null;

        if (!response.ok) throw new Error(body?.error || "Google Calendar Sync konnte nicht ausgeführt werden.");

        if (body?.availability) {
          setData((current) => ({ ...current, availability: body.availability! }));
        }

        const failedProfiles = body?.results?.filter((result) => result.error).length || 0;
        if (body?.skipped) {
          setCalendarSyncMessage(body.reason || "Google Calendar Sync wurde übersprungen.");
        } else {
          setCalendarSyncMessage(`Google Calendar Sync abgeschlossen: ${body?.imported || 0} Kalenderblöcke importiert, ${body?.removed || 0} alte Blöcke entfernt${failedProfiles ? `, ${failedProfiles} Profil(e) mit Fehler` : ""}.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Google Calendar Sync konnte nicht ausgeführt werden.";
        setCalendarSyncMessage(message);
        setSaveError(message);
      }
    });
  };

  const createDecision = (payload: { title: string; context: string; decision: string; requiredProfileIds: string[] }) => {
    setSaveError("");

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/decisions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; decision?: PlanningData["decisions"][number] } | null;
        if (!response.ok || !body?.decision) {
          throw new Error(body?.error || "Decision konnte nicht erstellt werden.");
        }

        setData((current) => ({
          ...current,
          decisions: [body.decision!, ...current.decisions],
          audit: [
            {
              id: Date.now(),
              entityType: "decision",
              entityId: String(body.decision!.id),
              action: "create",
              actorProfileId: currentProfile?.id || "",
              createdAt: new Date().toISOString(),
            },
            ...current.audit,
          ],
        }));
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Decision konnte nicht erstellt werden.");
      }
    });
  };

  const confirmDecision = (decisionId: number) => {
    if (!currentProfile) {
      setSaveError("GitHub-User ist keinem Teamprofil zugeordnet.");
      return;
    }

    setSaveError("");

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/decisions/${decisionId}/confirm`, {
          method: "POST",
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        });

        const body = (await response.json().catch(() => null)) as { error?: string; locked?: boolean; confirmedProfileIds?: string[] } | null;
        if (!response.ok) throw new Error(body?.error || "Bestätigung konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          decisions: current.decisions.map((decision) => {
            if (decision.id !== decisionId) return decision;
            const confirmedProfileIds = body?.confirmedProfileIds || [...new Set([...decision.confirmedProfileIds, currentProfile.id])];
            return {
              ...decision,
              confirmedProfileIds,
              status: body?.locked ? "locked" : decision.status,
              lockedAt: body?.locked ? new Date().toISOString() : decision.lockedAt,
            };
          }),
          audit: [
            {
              id: Date.now(),
              entityType: "decision",
              entityId: String(decisionId),
              action: body?.locked ? "confirm_and_lock" : "confirm",
              actorProfileId: currentProfile.id,
              createdAt: new Date().toISOString(),
            },
            ...current.audit,
          ],
        }));
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Bestätigung konnte nicht gespeichert werden.");
      }
    });
  };

  const editDecision = (decisionId: number, payload: { title: string; context: string; decision: string; requiredProfileIds: string[] }) => {
    setSaveError("");

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/decisions/${decisionId}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; decision?: PlanningData["decisions"][number] } | null;
        if (!response.ok || !body?.decision) throw new Error(body?.error || "Decision konnte nicht aktualisiert werden.");

        setData((current) => ({
          ...current,
          decisions: current.decisions.map((decision) => (decision.id === decisionId ? body.decision! : decision)),
          audit: [
            {
              id: Date.now(),
              entityType: "decision",
              entityId: String(decisionId),
              action: "decision.update",
              actorProfileId: currentProfile?.id || "",
              createdAt: new Date().toISOString(),
              beforeData: current.decisions.find((decision) => decision.id === decisionId) || null,
              afterData: body.decision,
            },
            ...current.audit,
          ],
        }));
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Decision konnte nicht aktualisiert werden.");
      }
    });
  };

  const objectDecision = (decisionId: number, comment: string) => {
    if (!currentProfile) {
      setSaveError("GitHub-User ist keinem Teamprofil zugeordnet.");
      return;
    }

    setSaveError("");

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/decisions/${decisionId}/objections`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ comment }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; comment?: PlanningData["decisionComments"][number] } | null;
        if (!response.ok || !body?.comment) throw new Error(body?.error || "Einwand konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          decisionComments: [body.comment!, ...current.decisionComments],
          audit: [
            {
              id: Date.now(),
              entityType: "decision",
              entityId: String(decisionId),
              action: "decision.objection",
              actorProfileId: currentProfile.id,
              createdAt: new Date().toISOString(),
            },
            ...current.audit,
          ],
        }));
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Einwand konnte nicht gespeichert werden.");
      }
    });
  };

  const reviewTask = (
    task: Task,
    reviewStatus: "accepted" | "partial" | "changes_requested",
    scorePoints: number,
    checklist?: { acceptanceCriteriaMet?: boolean; dodMet?: boolean; evidenceProvided?: boolean; communicationClear?: boolean; blockerHandled?: boolean },
    comment?: string,
  ) => {
    setSaveError("");

    const nextStatus = reviewStatus === "accepted" ? "Erledigt" : reviewStatus === "changes_requested" ? "Nacharbeit" : "Review";
    const scoreFinal = reviewStatus !== "changes_requested";
    const previousTask = task;

    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) =>
        item.id === task.id ? { ...item, status: nextStatus, reviewStatus, scorePoints, scoreFinal, reviewRequestedAt: "" } : item,
      ),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/tasks/${task.id}/review`, {
          method: "POST",
          headers: requestHeaders(token),
          body: JSON.stringify({ decision: reviewStatus, points: scorePoints, checklist, comment }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(body?.error || "Review konnte nicht gespeichert werden.");
        if (hasGitHubIssue(task) && githubProviderTokenAvailable) {
          syncTaskToGitHub({ ...task, status: nextStatus, reviewStatus, scorePoints, scoreFinal }, { silent: true });
        }
      } catch (error) {
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? previousTask : item)),
        }));
        setSaveError(error instanceof Error ? error.message : "Review konnte nicht gespeichert werden.");
      }
    });
  };

  const reopenReviewTask = (task: Task) => {
    setSaveError("");
    const previousTask = task;
    const reviewRequestedAt = new Date().toISOString();

    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) =>
        item.id === task.id ? { ...item, status: "Review", reviewStatus: "requested", scoreFinal: false, scorePoints: 0, reviewRequestedAt } : item,
      ),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/tasks/${task.id}/review/reopen`, {
          method: "POST",
          headers: requestHeaders(token),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; task?: Partial<Task> } | null;
        if (!response.ok || !body?.task) throw new Error(body?.error || "Review konnte nicht wieder geöffnet werden.");
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...body.task } : item)),
        }));
      } catch (error) {
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? previousTask : item)),
        }));
        setSaveError(error instanceof Error ? error.message : "Review konnte nicht wieder geöffnet werden.");
      }
    });
  };

  const addTaskComment = (task: Task, comment: string) => {
    if (!currentProfile) {
      setSaveError("GitHub-User ist keinem Teamprofil zugeordnet.");
      return;
    }

    setSaveError("");

    if (source !== "supabase") {
      setData((current) => ({
        ...current,
        taskComments: [
          {
            id: Date.now(),
            taskId: task.id,
            profileId: currentProfile.id,
            comment,
            createdAt: new Date().toISOString(),
          },
          ...current.taskComments,
        ],
      }));
      return;
    }

    setCommentImportPendingTaskIds((current) => new Set(current).add(task.id));
    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      rememberGitHubProviderToken(session?.data.session?.provider_token);

      try {
        const response = await fetch(`/api/tasks/${task.id}/comments`, {
          method: "POST",
          headers: requestHeaders(token, { github: true }),
          body: JSON.stringify({ comment }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; githubSyncError?: string; comment?: PlanningData["taskComments"][number] } | null;
        if (!response.ok || !body?.comment) throw new Error(body?.error || "Kommentar konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? {
            ...item,
            githubSyncStatus: body.githubSyncError ? "failed" : "not_synced",
            githubSyncError: body.githubSyncError || "",
          } : item)),
          taskComments: [body.comment!, ...current.taskComments],
        }));
        if (body.githubSyncError) {
          setSaveError(`Kommentar gespeichert, aber GitHub-Sync ist fehlgeschlagen: ${body.githubSyncError}`);
        }
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Kommentar konnte nicht gespeichert werden.");
      }
    });
  };

  const uploadTaskAttachment = async (task: Task, file: File) => {
    setSaveError("");

    if (source !== "supabase") {
      throw new Error("Anhänge können nur mit Supabase- und GitHub-Login hochgeladen werden.");
    }

    const session = await getBrowserSupabase()?.auth.getSession();
    const token = session?.data.session?.access_token;
    rememberGitHubProviderToken(session?.data.session?.provider_token);
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`/api/tasks/${task.id}/attachments`, {
      method: "POST",
      headers: requestHeaders(token, { json: false, github: true }),
      body: formData,
    });

    const body = (await response.json().catch(() => null)) as { error?: string; markdown?: string } | null;
    if (!response.ok || !body?.markdown) throw new Error(body?.error || "Anhang konnte nicht hochgeladen werden.");
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, githubSyncStatus: "not_synced", githubSyncError: "" } : item)),
      taskActivity: [
        {
          id: Date.now(),
          taskId: task.id,
          message: `Anhang hochgeladen: ${file.name}`,
          createdAt: new Date().toISOString(),
        },
        ...current.taskActivity,
      ],
    }));
    return body.markdown;
  };

  const importGitHubComments = useCallback((task: Task, options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setSaveError("");
      setCommentImportNotice("");
    }

    if (source !== "supabase") {
      if (!options.silent) setSaveError("GitHub-Kommentarimport ist nur mit Supabase-Datenquelle verfügbar.");
      return;
    }

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      rememberGitHubProviderToken(session?.data.session?.provider_token);

      try {
        const response = await fetch(`/api/tasks/${task.id}/github-comments`, {
          method: "POST",
          headers: requestHeaders(token, { github: true }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; imported?: number; evidenceLink?: string; comments?: TaskExternalComment[] } | null;
        if (!response.ok || !body?.comments) throw new Error(body?.error || "GitHub-Kommentare konnten nicht aktualisiert werden.");

        setData((current) => ({
          ...current,
          tasks: body.evidenceLink
            ? current.tasks.map((item) => (item.id === task.id ? { ...item, evidenceLink: body.evidenceLink || item.evidenceLink, githubSyncStatus: "not_synced" } : item))
            : current.tasks,
          taskExternalComments: [
            ...current.taskExternalComments.filter((comment) => comment.taskId !== task.id),
            ...body.comments!,
          ],
        }));
        const total = body.comments.length;
        if (!options.silent) {
          setCommentImportNotice(
            total > 0
              ? `GitHub-Kommentare geladen: ${total} Kommentar${total === 1 ? "" : "e"}.`
              : "GitHub wurde geprüft, aber für dieses Issue wurden keine externen Kommentare gefunden.",
          );
        }
      } catch (error) {
        if (!options.silent) setSaveError(error instanceof Error ? error.message : "GitHub-Kommentare konnten nicht aktualisiert werden.");
      } finally {
        setCommentImportPendingTaskIds((current) => {
          const next = new Set(current);
          next.delete(task.id);
          return next;
        });
      }
    });
  }, [requestHeaders, source, startTransition]);

  useEffect(() => {
    if (!selectedTask) return;
    if (source !== "supabase") return;
    if (!githubProviderTokenAvailable) return;
    if (!hasGitHubIssue(selectedTask)) return;
    if (autoImportedGitHubCommentsRef.current.has(selectedTask.id)) return;

    autoImportedGitHubCommentsRef.current.add(selectedTask.id);
    importGitHubComments(selectedTask, { silent: true });
  }, [githubProviderTokenAvailable, importGitHubComments, selectedTask, source]);

  const reportTaskBlocker = (task: Task, payload: { reason: string; impact: string; needsHelpFrom: string }) => {
    if (!currentProfile) {
      setSaveError("GitHub-User ist keinem Teamprofil zugeordnet.");
      return;
    }

    setSaveError("");

    const localBlocker = {
      id: Date.now(),
      taskId: task.id,
      profileId: currentProfile.id,
      reason: payload.reason,
      impact: payload.impact,
      needsHelpFrom: payload.needsHelpFrom,
      status: "open" as const,
      createdAt: new Date().toISOString(),
      resolvedAt: "",
    };
    const previousTask = task;

    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, status: "Blockiert", githubSyncStatus: "not_synced", githubSyncError: "" } : item)),
      taskBlockers: [localBlocker, ...current.taskBlockers],
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/tasks/${task.id}/blockers`, {
          method: "POST",
          headers: requestHeaders(token),
          body: JSON.stringify(payload),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; blocker?: PlanningData["taskBlockers"][number] } | null;
        if (!response.ok || !body?.blocker) throw new Error(body?.error || "Blocker konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          taskBlockers: [body.blocker!, ...current.taskBlockers.filter((blocker) => blocker.id !== localBlocker.id)],
        }));
      } catch (error) {
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? previousTask : item)),
          taskBlockers: current.taskBlockers.filter((blocker) => blocker.id !== localBlocker.id),
        }));
        setSaveError(error instanceof Error ? error.message : "Blocker konnte nicht gespeichert werden.");
      }
    });
  };

  const addTaskRelation = (task: Task, payload: { relationType: TaskRelationType; relatedTaskId: string; note: string }) => {
    setSaveError("");
    if (!payload.relatedTaskId || payload.relatedTaskId === task.id) return;

    const localRelation: TaskRelation = {
      id: Date.now(),
      taskId: task.id,
      relatedTaskId: payload.relatedTaskId,
      relationType: payload.relationType,
      note: payload.note,
      createdBy: currentProfile?.id || "",
      createdAt: new Date().toISOString(),
    };

    setData((current) => ({ ...current, taskRelations: [localRelation, ...current.taskRelations] }));
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) =>
        item.id === task.id || item.id === payload.relatedTaskId
          ? { ...item, githubSyncStatus: "not_synced", githubSyncError: "" }
          : item,
      ),
    }));
    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/tasks/${task.id}/relationships`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; relation?: TaskRelation } | null;
        if (!response.ok || !body?.relation) throw new Error(body?.error || "Relationship konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          taskRelations: current.taskRelations.map((relation) => (relation.id === localRelation.id ? body.relation! : relation)),
        }));
      } catch (error) {
        setData((current) => ({
          ...current,
          taskRelations: current.taskRelations.filter((relation) => relation.id !== localRelation.id),
        }));
        setSaveError(error instanceof Error ? error.message : "Relationship konnte nicht gespeichert werden.");
      }
    });
  };

  const removeTaskRelation = (task: Task, relation: TaskRelation) => {
    setSaveError("");
    setData((current) => ({
      ...current,
      taskRelations: current.taskRelations.filter((item) => item.id !== relation.id),
      tasks: current.tasks.map((item) =>
        item.id === relation.taskId || item.id === relation.relatedTaskId
          ? { ...item, githubSyncStatus: "not_synced", githubSyncError: "" }
          : item,
      ),
    }));
    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/tasks/${task.id}/relationships`, {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ relationId: relation.id }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(body?.error || "Relationship konnte nicht entfernt werden.");
      } catch (error) {
        setData((current) => ({
          ...current,
          taskRelations: [relation, ...current.taskRelations],
        }));
        setSaveError(error instanceof Error ? error.message : "Relationship konnte nicht entfernt werden.");
      }
    });
  };

  const syncTaskToGitHub = (task: Task, options: { createIfMissing?: boolean; silent?: boolean } = {}) => {
    if (!options.silent) setSaveError("");

    const previousTask = task;
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, githubSyncStatus: "pending", githubSyncError: "" } : item)),
    }));

    if (source !== "supabase") {
      setSaveError("GitHub Sync ist nur mit Supabase-Datenquelle verfügbar.");
      setData((current) => ({
        ...current,
        tasks: current.tasks.map((item) => (item.id === task.id ? previousTask : item)),
      }));
      return;
    }

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      rememberGitHubProviderToken(session?.data.session?.provider_token);

      try {
        const response = await fetch(`/api/tasks/${task.id}/sync-github`, {
          method: "POST",
          headers: requestHeaders(token, { github: true }),
          body: JSON.stringify({ createIfMissing: Boolean(options.createIfMissing) }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; task?: Partial<Task> } | null;
        if (!response.ok || !body?.task) throw new Error(body?.error || "GitHub Sync konnte nicht ausgeführt werden.");

        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...body.task } : item)),
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "GitHub Sync konnte nicht ausgeführt werden.";
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? { ...previousTask, githubSyncStatus: "failed", githubSyncError: message } : item)),
        }));
        if (!options.silent) setSaveError(message);
      }
    });
  };

  const syncLinkedGitHubTasks = () => {
    setSaveError("");

    if (source !== "supabase") {
      setSaveError("GitHub Sync ist nur mit Supabase-Datenquelle verfügbar.");
      return;
    }

    const queueTasks = data.tasks.filter((task) =>
      task.taskType === "deliverable" &&
      hasGitHubIssue(task) &&
      task.githubSyncStatus !== "synced"
    );

    if (!queueTasks.length) return;

    const previousTasks = new Map(queueTasks.map((task) => [task.id, task]));
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => queueTasks.some((task) => task.id === item.id) ? { ...item, githubSyncStatus: "pending", githubSyncError: "" } : item),
    }));

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      rememberGitHubProviderToken(session?.data.session?.provider_token);

      for (const task of queueTasks) {
        try {
          const response = await fetch(`/api/tasks/${task.id}/sync-github`, {
            method: "POST",
            headers: requestHeaders(token, { github: true }),
            body: JSON.stringify({ createIfMissing: false }),
          });

          const body = (await response.json().catch(() => null)) as { error?: string; task?: Partial<Task> } | null;
          if (!response.ok || !body?.task) throw new Error(body?.error || "GitHub Sync konnte nicht ausgeführt werden.");

          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...body.task } : item)),
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : "GitHub Sync konnte nicht ausgeführt werden.";
          const previousTask = previousTasks.get(task.id) || task;
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? { ...previousTask, githubSyncStatus: "failed", githubSyncError: message } : item)),
          }));
          setSaveError(message);
        }
      }
    });
  };

  const deleteTask = (task: Task) => {
    if (!canManageTaskMeta) {
      setSaveError("Nur CEO oder Deputy können Aufgaben löschen.");
      return;
    }
    const confirmed = window.confirm(
      hasGitHubIssue(task)
        ? "Aufgabe aus der App löschen und das verknüpfte GitHub-Issue schließen?"
        : "Aufgabe aus der App löschen?",
    );
    if (!confirmed) return;

    setSaveError("");
    const previousTask = task;
    const previousRelations = data.taskRelations;
    const previousComments = data.taskComments;
    const previousActivity = data.taskActivity;

    setData((current) => ({
      ...current,
      tasks: current.tasks.filter((item) => item.id !== task.id && item.parentTaskId !== task.id),
      taskRelations: current.taskRelations.filter((relation) => relation.taskId !== task.id && relation.relatedTaskId !== task.id),
      taskComments: current.taskComments.filter((comment) => comment.taskId !== task.id),
      taskActivity: current.taskActivity.filter((activity) => activity.taskId !== task.id),
    }));
    closeTaskPanel();

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      rememberGitHubProviderToken(session?.data.session?.provider_token);

      try {
        const response = await fetch(`/api/tasks/${task.id}`, {
          method: "DELETE",
          headers: requestHeaders(token, { json: false, github: true }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(body?.error || "Aufgabe konnte nicht gelöscht werden.");
      } catch (error) {
        setData((current) => ({
          ...current,
          tasks: [previousTask, ...current.tasks],
          taskRelations: previousRelations,
          taskComments: previousComments,
          taskActivity: previousActivity,
        }));
        setSaveError(error instanceof Error ? error.message : "Aufgabe konnte nicht gelöscht werden.");
      }
    });
  };

  const refreshGoogleChatStatus = useCallback(async () => {
    if (source !== "supabase") return;

    const session = await getBrowserSupabase()?.auth.getSession();
    const token = session?.data.session?.access_token;

    try {
      const response = await fetch("/api/notifications/deliver", {
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
      const body = (await response.json().catch(() => null)) as {
        googleChat?: { webhookConfigured?: boolean; apiConfigured?: boolean; deliveryEnabled?: boolean; ready?: boolean; mode?: GoogleChatStatus["mode"] };
        googleChatConfigured?: boolean;
        pending?: number;
      } | null;
      if (!response.ok || !body) return;

      setGoogleChatStatus({
        webhookConfigured: Boolean(body.googleChat?.webhookConfigured ?? body.googleChatConfigured),
        apiConfigured: Boolean(body.googleChat?.apiConfigured),
        deliveryEnabled: Boolean(body.googleChat?.deliveryEnabled),
        ready: Boolean(body.googleChat?.ready),
        mode: body.googleChat?.mode || "not-configured",
        pending: body.pending || 0,
      });
    } catch {
      // Settings can still show local queue counts when the status endpoint is unavailable.
    }
  }, [source]);

  useEffect(() => {
    if (workspace !== "settings") return;
    const timeout = window.setTimeout(() => {
      void refreshGoogleChatStatus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refreshGoogleChatStatus, workspace]);

  // Task detail route changes remount the planning app. Keep the authenticated
  // in-memory cache aligned with optimistic task edits so the board does not
  // briefly snap back to stale state after closing the detail panel.
  const applyPlanningDataUpdate = useCallback((updater: (current: PlanningData) => PlanningData) => {
    setData((current) => {
      const nextData = updater(current);
      if (source === "supabase" && authUser?.id) {
        setProtectedPlanningDataCache({
          authUserId: authUser.id,
          data: nextData,
          currentProfile: serverCurrentProfile,
        });
      }
      return nextData;
    });
  }, [authUser, serverCurrentProfile, source]);

  const refreshPlanningData = useCallback(async (token?: string) => {
    if (source !== "supabase" || !authUser?.id) return;
    const refreshResponse = await fetch("/api/planning-data", {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    const refreshPayload = await refreshResponse.json().catch(() => null) as (Partial<PlanningDataResponse> & { error?: string }) | null;
    if (!refreshResponse.ok || !refreshPayload?.data) return;
    const nextData = normalizePlanningData(refreshPayload.data);
    setProtectedPlanningDataCache({ authUserId: authUser.id, data: nextData, currentProfile: refreshPayload.currentProfile || serverCurrentProfile });
    setData(nextData);
    setProtectedDataLoaded(true);
  }, [authUser, serverCurrentProfile, setProtectedDataLoaded, source]);

  const runNotificationDelivery = useCallback((payload: Record<string, unknown>, fallbackError: string) => {
    setSaveError("");
    setNotificationDispatchMessage("");

    if (source !== "supabase") {
      setNotificationDispatchMessage("Notification Dispatch braucht Supabase als Datenquelle.");
      return;
    }

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/notifications/deliver", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; sent?: number; failed?: number; skipped?: number } | null;
        if (!response.ok && !body?.error) throw new Error(fallbackError);
        if (!response.ok) throw new Error(body?.error || "Google-Chat-Dispatch konnte nicht ausgeführt werden.");

        setNotificationDispatchMessage(`${body?.sent || 0} gesendet, ${body?.failed || 0} fehlgeschlagen, ${body?.skipped || 0} übersprungen.`);
        await refreshGoogleChatStatus();
        await refreshPlanningData(token);
      } catch (error) {
        setNotificationDispatchMessage(error instanceof Error ? error.message : "Google-Chat-Dispatch konnte nicht ausgeführt werden.");
      }
      });
  }, [refreshGoogleChatStatus, refreshPlanningData, source]);

  const dispatchNotifications = () => {
    runNotificationDelivery({ limit: 20 }, "Google-Chat-Dispatch konnte nicht ausgeführt werden.");
  };

  const retryNotificationDelivery = (delivery: NotificationDelivery) => {
    runNotificationDelivery({ eventIds: [delivery.eventId], limit: 1 }, "Google-Chat-Retry konnte nicht ausgeführt werden.");
  };

  const sendGoogleChatTest = (testDelivery: "webhook_digest" | "direct_dm", profileId?: string) => {
    runNotificationDelivery(
      { testDelivery, ...(profileId ? { profileId } : {}), limit: 1 },
      "Google-Chat-Testversand konnte nicht ausgeführt werden.",
    );
  };

  const createFeedback = (draft: FeedbackDraft) => {
    if (!currentProfile) {
      setFeedbackMessage("GitHub-User ist keinem Teamprofil zugeordnet.");
      return;
    }

    setFeedbackMessage("");
    setSaveError("");

    const localFeedback: FeedbackItem = {
      id: Date.now(),
      type: draft.type,
      status: "open",
      severity: draft.severity,
      profileId: currentProfile.id,
      title: draft.title.trim(),
      description: draft.description.trim(),
      pageUrl: draft.pageUrl.trim(),
      createdAt: new Date().toISOString(),
    };

    setData((current) => ({
      ...current,
      feedbackItems: [localFeedback, ...current.feedbackItems],
    }));
    setSelectedFeedbackId(localFeedback.id);

    if (source !== "supabase") {
      setFeedbackMessage("Feedback wurde lokal erfasst. Mit Supabase wird es als Notification an CEO/Deputy gesendet.");
      setFeedbackDialogOpen(false);
      return;
    }

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/feedback", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(draft),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; feedback?: FeedbackItem } | null;
        if (!response.ok || !body?.feedback) throw new Error(body?.error || "Feedback konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          feedbackItems: [body.feedback!, ...current.feedbackItems.filter((item) => item.id !== localFeedback.id)],
        }));
        setSelectedFeedbackId(body.feedback.id);
        setFeedbackMessage("Feedback wurde gesendet und als Notification zugestellt.");
        setFeedbackDialogOpen(false);
      } catch (error) {
        setData((current) => ({
          ...current,
          feedbackItems: current.feedbackItems.filter((item) => item.id !== localFeedback.id),
        }));
        setSelectedFeedbackId(null);
        setFeedbackMessage(error instanceof Error ? error.message : "Feedback konnte nicht gespeichert werden.");
      }
    });
  };

  const openNotification = (event: NotificationEvent) => {
    if (event.entityType === "task") {
      const task = data.tasks.find((item) => item.id === event.entityId);
      if (!task) {
        setSaveError("Die verknüpfte Aufgabe wurde nicht gefunden. Der Hinweis kann geschlossen werden.");
        setShowNotifications(false);
        return;
      }
      openTaskPanel(task.id);
    } else if (event.entityType === "feedback") {
      setSelectedFeedbackId(Number(event.entityId) || null);
      setWorkspace("settings");
    } else if (event.entityType === "decision") {
      setWorkspace("decisions");
    } else if (event.entityType === "meeting") {
      setWorkspace("meetings");
    }
    setShowNotifications(false);
  };

  const dismissNotification = (eventId: number) => {
    setData((current) => ({
      ...current,
      notificationEvents: current.notificationEvents.map((event) => (event.id === eventId ? { ...event, status: "dismissed" } : event)),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/notifications/${eventId}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ status: "dismissed" }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(body?.error || "Notification konnte nicht geschlossen werden.");
      } catch (error) {
        setData((current) => ({
          ...current,
          notificationEvents: current.notificationEvents.map((event) => (event.id === eventId ? { ...event, status: "pending" } : event)),
        }));
        setSaveError(error instanceof Error ? error.message : "Notification konnte nicht geschlossen werden.");
      }
    });
  };

  const statusGuardTask = statusGuardTaskId ? data.tasks.find((task) => task.id === statusGuardTaskId) : null;

  const createScoreObjection = (sprint: Sprint, comment: string) => {
    if (!currentProfile) {
      setSaveError("GitHub-User ist keinem Teamprofil zugeordnet.");
      return;
    }
    setSaveError("");

    const localObjection: ScoreObjection = {
      id: Date.now(),
      sprintId: sprint.id,
      profileId: currentProfile.id,
      founderSprintScoreId: null,
      status: "open",
      comment,
      resolutionComment: "",
      reviewedBy: "",
      reviewedAt: "",
      secondReviewerProfileId: "",
      secondReviewDecision: "",
      secondReviewedAt: "",
      createdAt: new Date().toISOString(),
    };
    const previousData = data;
    setData((current) => ({ ...current, scoreObjections: [localObjection, ...current.scoreObjections] }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      try {
        const response = await fetch(`/api/sprints/${sprint.id}/score-objections`, {
          method: "POST",
          headers: requestHeaders(token),
          body: JSON.stringify({ comment }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; objection?: Parameters<typeof mapScoreObjectionResponse>[0] } | null;
        if (!response.ok || !body?.objection) throw new Error(body?.error || "Score-Einwand konnte nicht gespeichert werden.");
        const saved = mapScoreObjectionResponse(body.objection);
        setData((current) => ({
          ...current,
          scoreObjections: current.scoreObjections.map((item) => (item.id === localObjection.id ? saved : item)),
        }));
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Score-Einwand konnte nicht gespeichert werden.");
      }
    });
  };

  const reviewScoreObjection = (sprint: Sprint, objectionId: number, status: "reviewed" | "dismissed" | "accepted") => {
    setSaveError("");
    const previousData = data;
    setData((current) => ({
      ...current,
      scoreObjections: current.scoreObjections.map((item) => (item.id === objectionId ? { ...item, status, reviewedBy: currentProfile?.id || "", reviewedAt: new Date().toISOString() } : item)),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      try {
        const response = await fetch(`/api/sprints/${sprint.id}/score-objections`, {
          method: "PATCH",
          headers: requestHeaders(token),
          body: JSON.stringify({ objectionId, status, resolutionComment: status === "accepted" ? "Einwand angenommen." : "Einwand geprüft." }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; objection?: Parameters<typeof mapScoreObjectionResponse>[0] } | null;
        if (!response.ok || !body?.objection) throw new Error(body?.error || "Score-Einwand konnte nicht geprüft werden.");
        const saved = mapScoreObjectionResponse(body.objection);
        setData((current) => ({
          ...current,
          scoreObjections: current.scoreObjections.map((item) => (item.id === saved.id ? saved : item)),
        }));
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Score-Einwand konnte nicht geprüft werden.");
      }
    });
  };

  const lockSprint = (sprintId: string) => {
    setSaveError("");
    setSprintLockMessage("");

    const previousData = data;
    setData((current) => ({
      ...current,
      sprints: current.sprints.map((sprint) => (sprint.id === sprintId ? { ...sprint, status: "closed", scoreLocked: true } : sprint)),
      tasks: current.tasks.map((task) => (task.sprintId === sprintId && !task.scoreFinal ? { ...task, scorePoints: 0, scoreFinal: true } : task)),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/sprints/${sprintId}/lock`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ finalizeNow: true }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; carryover?: { created?: number; evaluated?: number; nextSprintId?: string }; scoring?: { scores?: number; strikeEvents?: number; governanceReviews?: number } } | null;
        if (!response.ok) throw new Error(body?.error || "Sprint konnte nicht gelockt werden.");
        if (body?.carryover) {
          setSprintLockMessage(`${body.carryover.evaluated || 0} offene Deliverables bewertet, ${body.carryover.created || 0} Carry-over-Aufgaben erstellt. ${body.scoring?.scores || 0} FounderOps-Scores finalisiert, ${body.scoring?.strikeEvents || 0} Strike-Ereignisse geschrieben${body.scoring?.governanceReviews ? `, ${body.scoring.governanceReviews} Governance Review nötig` : ""}.`);
        }
        const refreshResponse = await fetch("/api/planning-data", {
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        });
        const refreshPayload = await refreshResponse.json().catch(() => null) as (Partial<PlanningDataResponse> & { error?: string }) | null;
        if (refreshResponse.ok && refreshPayload?.data && authUser?.id) {
          const nextData = normalizePlanningData(refreshPayload.data);
          setProtectedPlanningDataCache({ authUserId: authUser.id, data: nextData, currentProfile: refreshPayload.currentProfile || serverCurrentProfile });
          setData(nextData);
          setProtectedDataLoaded(true);
        }
        await createSprintPlanAsync(sprintPlanningOptions, true);
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Sprint konnte nicht gelockt werden.");
      }
    });
  };

  const metrics = {
    total: visibleTasks.length,
    open: visibleTasks.filter((task) => normalizeStatus(task.status) !== "Erledigt").length,
    blocked: visibleTasks.filter((task) => task.dependsOn || hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations) || normalizeStatus(task.status) === "Blockiert").length,
    done: visibleTasks.filter((task) => normalizeStatus(task.status) === "Erledigt").length,
  };

  const releaseSidebarFocus = () => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && sidebarRef.current?.contains(activeElement)) {
      activeElement.blur();
    }
  };


  return {
    actualProfile,
    addTaskComment,
    addTaskRelation,
    authAvailable,
    authBusy,
    authChecked,
    authError,
    authNotice,
    authUser,
    calendarSyncMessage,
    canChangeTaskStatus,
    canManageTaskMeta,
    canUseCeoIntake,
    closeTaskPanel,
    commentImportNotice,
    commentImportPendingTaskIds,
    confirmDecision,
    createAvailability,
    createDecision,
    createFeedback,
    createMeetingFromSlot,
    createScoreObjection,
    createSprintPlan,
    createTask,
    currentProfile,
    currentProfileFocusItems,
    data,
    deleteAvailability,
    deleteTask,
    devProfileId,
    devRoleSwitchAvailable,
    dismissNotification,
    dispatchNotifications,
    dragOverStatus,
    draggedTaskId,
    dropTaskOnStatus,
    editDecision,
    endTaskDrag,
    expandedPackages,
    feedbackDialogOpen,
    feedbackMessage,
    filters,
    filtersAvailable,
    focusedReviewTaskId,
    fullTaskView,
    githubProviderTokenAvailable,
    githubReauthFailed,
    googleChatStatus,
    headerPrimaryAction,
    hygieneAlerts,
    importGitHubComments,
    initiativeDialogDefaults,
    isPending,
    linkDecisionTask,
    localStateLoaded,
    lockSprint,
    meetingCreateMessage,
    metrics,
    mineOwnerName,
    mobileNavOpen,
    notificationDispatchMessage,
    objectDecision,
    openNotification,
    openReviewSheet,
    openTaskPanel,
    protectedDataLoaded,
    releaseSidebarFocus,
    removeDecisionTaskLink,
    removeFocusItem,
    removeTaskRelation,
    reopenReviewTask,
    reportTaskBlocker,
    requestHeaders,
    retryNotificationDelivery,
    reviewOwnerFilter,
    reviewScoreObjection,
    reviewStatusFilter,
    reviewTask,
    saveError,
    saveInitiative,
    saveProfileSettings,
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
    sendGoogleChatTest,
    setAllPackageCollapse,
    setData,
    setDevProfileId,
    setDragOverStatus,
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
    sprintLockMessage,
    sprintPlanningOptions,
    startTaskDrag,
    statusGuardNotice,
    statusGuardTask,
    syncGoogleCalendar,
    syncLinkedGitHubTasks,
    syncTaskToGitHub,
    taskDialogDefaults,
    togglePackageCollapse,
    unreadNotifications,
    updateAvailability,
    updateMeeting,
    updateMeetingAttendance,
    updateSprint,
    updateSprintCommitment,
    updateTask,
    uploadTaskAttachment,
    upsertFocusItem,
    view,
    visibleTasks,
    workspace,
    setWorkspace,
  };
}

export type PlanningAppController = ReturnType<typeof usePlanningAppController>;
