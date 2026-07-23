"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBrowserApiClient } from "@/lib/browser-api-client";
import type { AuthenticatedProfile, Milestone, Package, Profile, Sprint, Task, TaskActivity, TaskBlocker, TaskComment, TaskExternalComment, TaskRelation } from "@/lib/types";
import { createTaskRequest, reportTaskBlockerRequest, syncTaskToGitHubRequest, updateTaskRequest, withdrawTaskRequest } from "@/features/tasks/model/task-api-client";
import { buildClientTaskUpdatePatch, taskUpdateRequestPayload } from "@/features/tasks/model/task-mutation-contract";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import {
  buildEditableTaskState,
  buildTaskDetailGitHubState,
  type EditableTaskState,
} from "@/features/tasks/model/task-detail-state";
import { useTaskComments } from "@/features/tasks/hooks/use-task-comments";
import { useTaskRelationships } from "@/features/tasks/hooks/use-task-relationships";
import { githubSyncStatePersistFailedMessage } from "@/lib/github-sync-failure-persistence";
import { isLocalLoginSimulationEnabled } from "@/lib/local-development-auth";

type UseTaskDetailWorkflowOptions = {
  task: Task;
  pack?: Package;
  packages: Package[];
  sprint?: Sprint;
  comments: TaskComment[];
  externalComments: TaskExternalComment[];
  activities: TaskActivity[];
  blockers: TaskBlocker[];
  subIssues: Task[];
  taskRelations: TaskRelation[];
  allTasks: Task[];
  profiles: Profile[];
  sprints: Sprint[];
  milestones: Milestone[];
  source: "supabase";
  commentImportNotice: string;
  initialCurrentProfile?: AuthenticatedProfile | null;
};

const githubSyncStaleMessage = "Die Aufgabe wurde während des GitHub-Syncs geändert. Bitte prüfe den aktuellen Stand und starte den Sync erneut.";

function retryableGitHubSyncMessage(status: number, code?: string, serverMessage?: string) {
  if (status === 409 && code === "github_sync_stale") return serverMessage || githubSyncStaleMessage;
  if (status === 503 && code === "github_sync_state_persist_failed") return serverMessage || githubSyncStatePersistFailedMessage;
  return "";
}

export function useTaskDetailWorkflow({
  task,
  packages,
  comments,
  externalComments,
  activities,
  blockers,
  subIssues,
  taskRelations,
  profiles,
  source,
  commentImportNotice,
  initialCurrentProfile = null,
}: UseTaskDetailWorkflowOptions) {
  const router = useRouter();
  const latestMutationId = useRef(0);
  const mutationEpoch = useRef(0);
  const mutationQueue = useRef(Promise.resolve());
  const updatedAtRef = useRef(task.updatedAt || "");
  const [meta, setMeta] = useState<EditableTaskState>(() => buildEditableTaskState(task));
  const [error, setError] = useState("");
  const [githubState, setGithubState] = useState(() => buildTaskDetailGitHubState(task));
  const [taskBlockers, setTaskBlockers] = useState(blockers);
  const [taskSubIssues, setTaskSubIssues] = useState(subIssues);
  const [subIssueDialogOpen, setSubIssueDialogOpen] = useState(false);
  const [currentProfile, setCurrentProfile] = useState<Pick<Profile, "id" | "name" | "platformRole"> | null>(initialCurrentProfile);
  const [githubInstallationAvailable, setGithubInstallationAvailable] = useState(false);
  const [githubUserConnected, setGithubUserConnected] = useState(false);
  const [waitingGitHubCommentCount, setWaitingGitHubCommentCount] = useState(0);
  const [githubReconnectFailed, setGithubReconnectFailed] = useState(false);
  const [apiClient] = useState(() => createBrowserApiClient());
  const [isPending, startTransition] = useTransition();

  const { relations, addRelation, removeRelation } = useTaskRelationships({
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

  useEffect(() => {
    if (isLocalLoginSimulationEnabled()) return;

    let active = true;
    apiClient.getAuthSnapshot().then((snapshot) => {
      if (!active) return;
      setGithubInstallationAvailable(snapshot.githubInstallationAvailable);
      setGithubUserConnected(snapshot.githubUserConnected);
      setWaitingGitHubCommentCount(snapshot.waitingGitHubCommentCount);
      if (snapshot.githubUserConnected) setGithubReconnectFailed(false);
      const login = snapshot.githubLogin;
      const profile = profiles.find((item) => item.githubLogin === login);
      setCurrentProfile(profile || initialCurrentProfile);
    });

    return () => {
      active = false;
    };
  }, [apiClient, initialCurrentProfile, profiles, source]);

  const reconnectGitHub = async () => {
    setError("");
    setGithubReconnectFailed(false);
    if (isLocalLoginSimulationEnabled()) {
      setError("GitHub ist in der lokalen Entwicklung deaktiviert.");
      return;
    }
    const { error: githubError } = await apiClient.startGitHubAppConnect();

    if (githubError) {
      setGithubReconnectFailed(true);
      setError("GitHub-Anmeldung konnte nicht gestartet werden.");
    }
  };

  const updateTask = (patch: Partial<Task>) => {
    const currentTaskSnapshot = { ...task, ...meta, ...githubState } as Task;
    const normalized = buildClientTaskUpdatePatch(currentTaskSnapshot, patch, profiles, packages);
    if (!normalized.ok) {
      setError(normalized.error);
      return;
    }
    const normalizedPatch = normalized.patch;
    const editablePatch = normalizedPatch as Partial<EditableTaskState>;
    const previousMeta = meta;
    const next = { ...meta, ...editablePatch };
    setMeta(next);
    setError("");

    const mutationId = latestMutationId.current + 1;
    const queuedMutationEpoch = mutationEpoch.current;
    latestMutationId.current = mutationId;
    const queuedMutation = mutationQueue.current.then(async () => {
      if (mutationEpoch.current !== queuedMutationEpoch) return;

      try {
        const { response, body } = await updateTaskRequest(apiClient, task.id, {
          ...taskUpdateRequestPayload(normalizedPatch, updatedAtRef.current),
        });
        if (response.status === 409) {
          mutationEpoch.current += 1;
          setMeta(previousMeta);
          window.location.reload();
          setError(body?.error || "Aufgabe wurde parallel geändert. Der aktuelle Stand wird neu geladen.");
          return;
        }
        if (!response.ok) throw new Error(body?.error || "Änderung konnte nicht gespeichert werden.");
        if (body?.activities?.length) appendTaskActivities(body.activities);
        if (body?.task) {
          if (body.task.updatedAt) updatedAtRef.current = body.task.updatedAt;
          if (latestMutationId.current === mutationId) {
            setMeta((current) => ({
              ...current,
              ...(body.task?.status ? { status: body.task.status } : {}),
              ...(body.task?.reviewStatus ? { reviewStatus: body.task.reviewStatus } : {}),
              ...(body.task?.reviewOwnerProfileId !== undefined ? { reviewOwnerProfileId: body.task.reviewOwnerProfileId || "" } : {}),
              ...(body.task?.reviewRequestedAt !== undefined ? { reviewRequestedAt: body.task.reviewRequestedAt || "" } : {}),
              ...(body.task?.scoreFinal !== undefined ? { scoreFinal: body.task.scoreFinal } : {}),
            }));
          }
        }
      } catch (caught) {
        mutationEpoch.current += 1;
        setMeta(previousMeta);
        setError(caught instanceof Error ? caught.message : "Änderung konnte nicht gespeichert werden.");
      }
    });
    mutationQueue.current = queuedMutation;
    startTransition(async () => {
      await queuedMutation;
    });
  };

  const syncGitHub = (options: { createIfMissing?: boolean } = {}) => {
    setError("");

    if (isLocalLoginSimulationEnabled()) {
      setError("GitHub ist in der lokalen Entwicklung deaktiviert.");
      return;
    }

    const syncStartedAt = new Date().toISOString();
    setGithubState((current) => ({
      ...current,
      githubIssueSyncStatus: "pending",
      githubIssueSyncError: "",
      githubIssueSyncPendingSince: syncStartedAt,
    }));

    startTransition(async () => {
      try {
        const { response, body } = await syncTaskToGitHubRequest(apiClient, task.id, { createIfMissing: Boolean(options.createIfMissing) });
        if (body?.task?.updatedAt) updatedAtRef.current = body.task.updatedAt;
        if (response.status === 409 && body?.code === "github_sync_locked") {
          setGithubState((current) => ({
            ...current,
            githubIssueSyncStatus: "pending",
            githubIssueSyncError: body.error || "GitHub-Sync läuft bereits.",
            githubIssueSyncPendingSince: syncStartedAt,
          }));
          return;
        }
        const retryableMessage = retryableGitHubSyncMessage(response.status, body?.code, body?.error);
        if (retryableMessage) {
          setGithubState((current) => ({
            ...current,
            githubIssueSyncStatus: "not_synced",
            githubIssueSyncError: retryableMessage,
            githubIssueSyncPendingSince: "",
          }));
          setError(retryableMessage);
          return;
        }
        if (!response.ok || !body?.task) throw new Error(body?.error || "GitHub-Sync konnte nicht ausgeführt werden.");

        setGithubState((current) => ({
          githubRepo: body.task?.githubRepo || current.githubRepo,
          githubIssueNumber: body.task?.githubIssueNumber ?? current.githubIssueNumber,
          githubIssueUrl: body.task?.githubIssueUrl || current.githubIssueUrl,
          githubIssueSyncStatus: body.task?.githubIssueSyncStatus || current.githubIssueSyncStatus,
          githubIssueLastSyncedAt: body.task?.githubIssueLastSyncedAt || current.githubIssueLastSyncedAt,
          githubIssueSyncError: body.task?.githubIssueSyncError || "",
          githubIssueSyncPendingSince: "",
        }));
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "GitHub-Sync konnte nicht ausgeführt werden.";
        setGithubState((current) => ({
          ...current,
          githubIssueSyncStatus: "failed",
          githubIssueSyncError: message,
          githubIssueSyncPendingSince: "",
        }));
        setError(message);
      }
    });
  };

  const reportBlocker = (payload: { reason: string; impact: string; needsHelpFrom: string }) => {
    if (!currentProfile) {
      setError("GitHub-User ist keinem Teamprofil zugeordnet.");
      return;
    }
    const previousStatus = meta.status;
    const localBlocker: TaskBlocker = {
      id: Date.now(),
      taskId: task.id,
      profileId: currentProfile.id,
      reason: payload.reason,
      impact: payload.impact,
      needsHelpFrom: payload.needsHelpFrom,
      status: "open",
      createdAt: new Date().toISOString(),
      resolvedAt: "",
    };
    setError("");
    setTaskBlockers((current) => [localBlocker, ...current]);
    setMeta((current) => ({ ...current, status: "Blockiert" }));
    startTransition(async () => {
      const { response, body } = await reportTaskBlockerRequest(apiClient, task.id, payload);
      if (!response.ok || !body?.blocker) {
        setTaskBlockers((current) => current.filter((blocker) => blocker.id !== localBlocker.id));
        setMeta((current) => ({ ...current, status: previousStatus }));
        setError(body?.error || "Blocker konnte nicht gespeichert werden.");
        return;
      }
      setTaskBlockers((current) => current.map((blocker) => blocker.id === localBlocker.id ? body.blocker! : blocker));
    });
  };

  const createSubIssue = (draft: NewTaskDraft) => {
    setError("");
    startTransition(async () => {
      const { response, body } = await createTaskRequest(apiClient, draft);
      if (!response.ok || !body?.task) {
        setError(body?.error || "Sub-Issue konnte nicht erstellt werden.");
        return;
      }
      setTaskSubIssues((current) => [...current, body.task!]);
      setSubIssueDialogOpen(false);
    });
  };

  const withdrawTask = (reason: string) => {
    startTransition(async () => {
      const { response, body } = await withdrawTaskRequest(apiClient, task.id, task.approvalRevision, reason);
      if (!response.ok) {
        setError(body?.error || "Deliverable konnte nicht zurückgezogen werden.");
        return;
      }
      router.replace("/planning");
      router.refresh();
    });
  };

  const taskSnapshot = { ...task, ...meta, ...githubState } as Task;

  return {
    addComment,
    addRelation,
    createSubIssue,
    currentProfile,
    error,
    githubCommentImportPending,
    githubInstallationAvailable,
    githubUserConnected,
    githubReconnectFailed,
    githubState,
    importGitHubComments,
    isPending,
    localCommentImportNotice,
    reconnectGitHub,
    relations,
    removeRelation,
    syncGitHub,
    subIssueDialogOpen,
    taskActivities,
    taskBlockers,
    taskComments,
    taskExternalComments,
    taskSnapshot,
    taskSubIssues,
    waitingGitHubCommentCount,
    withdrawTask,
    updateTask,
    uploadAttachment,
    reportBlocker,
    setSubIssueDialogOpen,
  };
}
