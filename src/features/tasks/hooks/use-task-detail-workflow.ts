"use client";

import { useEffect, useState, useTransition } from "react";
import { createBrowserApiClient } from "@/lib/browser-api-client";
import type { DecisionTaskLink, Milestone, Package, PlanningData, Profile, Sprint, Task, TaskActivity, TaskBlocker, TaskComment, TaskExternalComment, TaskFocusItem, TaskRelation } from "@/lib/types";
import { syncTaskToGitHubRequest, updateTaskRequest } from "@/features/tasks/model/task-api-client";
import {
  buildDetailsMilestonePatch,
  buildDetailsPackagePatch,
  buildEditableTaskState,
  buildTaskBriefDraft,
  buildTaskDetailGitHubState,
  buildTaskDetailsDraft,
  buildTaskDetailViewModel,
  type EditableTaskState,
} from "@/features/tasks/model/task-detail-state";
import type { TaskDetailsDraft } from "@/features/tasks/organisms/task-details-card";
import { useTaskComments } from "@/features/tasks/hooks/use-task-comments";
import { useTaskRelationships } from "@/features/tasks/hooks/use-task-relationships";

type UseTaskDetailWorkflowOptions = {
  task: Task;
  pack?: Package;
  packages: Package[];
  sprint?: Sprint;
  comments: TaskComment[];
  externalComments: TaskExternalComment[];
  activities: TaskActivity[];
  blockers: TaskBlocker[];
  taskRelations: TaskRelation[];
  allTasks: Task[];
  profiles: Profile[];
  sprints: Sprint[];
  milestones: Milestone[];
  decisions: PlanningData["decisions"];
  decisionTaskLinks: DecisionTaskLink[];
  focusItems: TaskFocusItem[];
  source: "seed" | "supabase";
  commentImportNotice: string;
};

export function useTaskDetailWorkflow({
  task,
  pack,
  packages,
  sprint,
  comments,
  externalComments,
  activities,
  blockers,
  taskRelations,
  allTasks,
  profiles,
  sprints,
  milestones,
  decisions,
  decisionTaskLinks,
  focusItems,
  source,
  commentImportNotice,
}: UseTaskDetailWorkflowOptions) {
  const [meta, setMeta] = useState<EditableTaskState>(() => buildEditableTaskState(task));
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState("");
  const [briefEditing, setBriefEditing] = useState(false);
  const [detailsEditing, setDetailsEditing] = useState(false);
  const [detailsEditSnapshot, setDetailsEditSnapshot] = useState<TaskDetailsDraft | null>(null);
  const [githubState, setGithubState] = useState(() => buildTaskDetailGitHubState(task));
  const [currentRole, setCurrentRole] = useState<Profile["platformRole"] | "">(source === "seed" ? "ceo" : "");
  const [githubProviderTokenAvailable, setGithubProviderTokenAvailable] = useState(false);
  const [githubReconnectFailed, setGithubReconnectFailed] = useState(false);
  const [apiClient] = useState(() => createBrowserApiClient());
  const [isPending, startTransition] = useTransition();

  const { relations, relationDraft, setRelationDraft, addRelation, removeRelation } = useTaskRelationships({
    task,
    initialRelations: taskRelations,
    apiClient,
    source,
    startTransition,
    setError,
  });

  const {
    taskComments,
    taskExternalComments,
    taskActivities,
    localCommentImportNotice,
    githubCommentImportPending,
    addComment,
    uploadAttachment,
    importGitHubComments,
    appendTaskActivities,
  } = useTaskComments({
    task,
    initialComments: comments,
    initialExternalComments: externalComments,
    initialActivities: activities,
    commentImportNotice,
    profiles,
    apiClient,
    source,
    startTransition,
    setError,
    setMeta,
  });

  const viewModel = buildTaskDetailViewModel({
    task,
    meta,
    githubState,
    pack,
    packages,
    sprint,
    sprints,
    milestones,
    profiles,
    blockers,
    relations,
    allTasks,
    decisions,
    decisionTaskLinks,
    focusItems,
    currentRole,
  });
  const detailsDraft: TaskDetailsDraft = buildTaskDetailsDraft(meta);

  useEffect(() => {
    if (source !== "supabase") {
      window.queueMicrotask(() => setCurrentRole("ceo"));
      return;
    }

    let active = true;
    apiClient.getAuthSnapshot().then((snapshot) => {
      if (!active) return;
      setGithubProviderTokenAvailable(snapshot.githubProviderTokenAvailable);
      if (snapshot.githubProviderTokenAvailable) setGithubReconnectFailed(false);
      const login = snapshot.githubLogin;
      const profile = profiles.find((item) => item.githubLogin === login);
      setCurrentRole(profile?.platformRole || "");
    });

    return () => {
      active = false;
    };
  }, [apiClient, profiles, source]);

  const reconnectGitHub = async () => {
    setError("");
    setGithubReconnectFailed(false);
    const { error: githubError } = await apiClient.startGitHubOAuth();

    if (githubError) {
      setGithubReconnectFailed(true);
      setError("GitHub-Anmeldung konnte nicht gestartet werden.");
    }
  };

  const updateTask = (patch: Partial<EditableTaskState>) => {
    const next = { ...meta, ...patch };
    setMeta(next);
    setError("");
    setSaveState("Speichert...");

    if (source !== "supabase") {
      setSaveState("Lokal geändert");
      return;
    }

    startTransition(async () => {
      try {
        const { response, body } = await updateTaskRequest(apiClient, task.id, patch);
        if (!response.ok) throw new Error(body?.error || "Änderung konnte nicht gespeichert werden.");
        if (body?.activities?.length) appendTaskActivities(body.activities);
        if (body?.task) {
          setMeta((current) => ({
            ...current,
            ...(body.task?.status ? { status: body.task.status } : {}),
            ...(body.task?.reviewStatus ? { reviewStatus: body.task.reviewStatus } : {}),
            ...(body.task?.reviewOwnerProfileId !== undefined ? { reviewOwnerProfileId: body.task.reviewOwnerProfileId || "" } : {}),
          }));
        }
        setSaveState("Gespeichert");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Änderung konnte nicht gespeichert werden.");
        setSaveState("");
      }
    });
  };

  const setDetailsDraft = (patch: Partial<TaskDetailsDraft>) => {
    setMeta((current) => ({ ...current, ...patch }));
  };

  const setDetailsPackage = (packageId: string) => {
    setDetailsDraft(buildDetailsPackagePatch(packageId, packages, meta.milestoneId));
  };

  const setDetailsMilestone = (milestoneId: string) => {
    setDetailsDraft(buildDetailsMilestonePatch(milestoneId, packages, meta.packageId));
  };

  const startDetailsEditing = () => {
    setDetailsEditSnapshot(detailsDraft);
    setDetailsEditing(true);
  };

  const resetDetailsDraft = () => {
    if (detailsEditSnapshot) setMeta((current) => ({ ...current, ...detailsEditSnapshot }));
    setDetailsEditSnapshot(null);
    setDetailsEditing(false);
  };

  const saveDetailsDraft = () => {
    const { reviewOwnerProfileId, ...detailsWithoutReviewOwner } = detailsDraft;
    updateTask(currentRole === "ceo" ? { ...detailsWithoutReviewOwner, reviewOwnerProfileId } : detailsWithoutReviewOwner);
    setDetailsEditSnapshot(null);
    setDetailsEditing(false);
  };

  const resetBriefDraft = () => {
    setBriefEditing(false);
    setMeta((current) => ({ ...current, ...buildTaskBriefDraft(task) }));
  };

  const saveBriefDraft = () => {
    updateTask({
      problemStatement: meta.problemStatement,
      intendedOutcome: meta.intendedOutcome,
      scopeConstraints: meta.scopeConstraints,
      acceptanceCriteria: meta.acceptanceCriteria,
      evidenceRequired: meta.evidenceRequired,
      definitionOfDone: meta.definitionOfDone,
    });
    setBriefEditing(false);
  };

  const updateBriefDraft = (patch: Partial<EditableTaskState>) => {
    setMeta((current) => ({ ...current, ...patch }));
  };

  const updateChecklist = (patch: Partial<EditableTaskState>) => {
    setMeta((current) => ({ ...current, ...patch }));
    updateTask(patch);
  };

  const setEvidenceLink = (evidenceLink: string) => {
    setMeta((current) => ({ ...current, evidenceLink }));
  };

  const syncGitHub = (options: { createIfMissing?: boolean } = {}) => {
    setError("");

    if (source !== "supabase") {
      setError("GitHub-Spiegelung ist in diesem Arbeitsmodus nicht verfügbar.");
      return;
    }

    setGithubState((current) => ({ ...current, githubSyncStatus: "pending", githubSyncError: "" }));

    startTransition(async () => {
      try {
        const { response, body } = await syncTaskToGitHubRequest(apiClient, task.id, { createIfMissing: Boolean(options.createIfMissing) });
        if (!response.ok || !body?.task) throw new Error(body?.error || "GitHub-Spiegelung konnte nicht ausgeführt werden.");

        setGithubState((current) => ({
          githubRepo: body.task?.githubRepo || current.githubRepo,
          githubIssueNumber: body.task?.githubIssueNumber ?? current.githubIssueNumber,
          githubIssueUrl: body.task?.githubIssueUrl || current.githubIssueUrl,
          githubSyncStatus: body.task?.githubSyncStatus || current.githubSyncStatus,
          githubLastSyncedAt: body.task?.githubLastSyncedAt || current.githubLastSyncedAt,
          githubSyncError: body.task?.githubSyncError || "",
        }));
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "GitHub-Spiegelung konnte nicht ausgeführt werden.";
        setGithubState((current) => ({ ...current, githubSyncStatus: "failed", githubSyncError: message }));
        setError(message);
      }
    });
  };

  return {
    addComment,
    addRelation,
    briefEditing,
    currentRole,
    detailsDraft,
    detailsEditing,
    error,
    githubCommentImportPending,
    githubProviderTokenAvailable,
    githubReconnectFailed,
    githubState,
    importGitHubComments,
    isPending,
    localCommentImportNotice,
    meta,
    reconnectGitHub,
    relationDraft,
    removeRelation,
    resetBriefDraft,
    resetDetailsDraft,
    saveBriefDraft,
    saveDetailsDraft,
    saveState,
    setBriefEditing,
    setDetailsDraft,
    setDetailsMilestone,
    setDetailsPackage,
    setEvidenceLink,
    setRelationDraft,
    startDetailsEditing,
    syncGitHub,
    taskActivities,
    taskComments,
    taskExternalComments,
    updateBriefDraft,
    updateChecklist,
    updateTask,
    uploadAttachment,
    viewModel,
  };
}
