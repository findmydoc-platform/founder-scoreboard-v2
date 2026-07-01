"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { hasGitHubIssue } from "@/lib/platform";
import type { Task, TaskRelation, TaskRelationType } from "@/lib/types";

type UseTaskCollaborationCommandsOptions = PlanningCommandContext & {
  selectedTask: Task | null;
};

export function useTaskCollaborationCommands({
  apiClient,
  currentProfile,
  githubAppConnected,
  selectedTask,
  setData,
  setSaveError,
  source,
  startTransition,
}: UseTaskCollaborationCommandsOptions) {
  const autoImportedGitHubCommentsRef = useRef<Set<string>>(new Set());
  const [commentImportNotice, setCommentImportNotice] = useState("");
  const [commentImportPendingTaskIds, setCommentImportPendingTaskIds] = useState<Set<string>>(new Set());

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
      try {
        const { response, body } = await taskApi.createTaskCommentRequest(apiClient, task.id, comment);
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
      throw new Error("Anhänge können nur mit aktiver Verbindung hochgeladen werden.");
    }

    const { response, body } = await taskApi.uploadTaskAttachmentRequest(apiClient, task.id, file);
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
      if (!options.silent) setSaveError("GitHub-Kommentarimport ist in diesem Arbeitsmodus nicht verfügbar.");
      return;
    }

    startTransition(async () => {
      try {
        const { response, body } = await taskApi.importGitHubCommentsRequest(apiClient, task.id);
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
  }, [apiClient, setData, setSaveError, source, startTransition]);

  useEffect(() => {
    if (!selectedTask) return;
    if (source !== "supabase") return;
    if (!githubAppConnected) return;
    if (!hasGitHubIssue(selectedTask)) return;
    if (autoImportedGitHubCommentsRef.current.has(selectedTask.id)) return;

    autoImportedGitHubCommentsRef.current.add(selectedTask.id);
    importGitHubComments(selectedTask, { silent: true });
  }, [githubAppConnected, importGitHubComments, selectedTask, source]);

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
      try {
        const { response, body } = await taskApi.reportTaskBlockerRequest(apiClient, task.id, payload);
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
      try {
        const { response, body } = await taskApi.addTaskRelationshipRequest(apiClient, task.id, payload);
        if (!response.ok || !body?.relation) throw new Error(body?.error || "Abhängigkeit konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          taskRelations: current.taskRelations.map((relation) => (relation.id === localRelation.id ? body.relation! : relation)),
        }));
      } catch (error) {
        setData((current) => ({
          ...current,
          taskRelations: current.taskRelations.filter((relation) => relation.id !== localRelation.id),
        }));
        setSaveError(error instanceof Error ? error.message : "Abhängigkeit konnte nicht gespeichert werden.");
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
      try {
        const { response, body } = await taskApi.removeTaskRelationshipRequest(apiClient, task.id, relation.id);
        if (!response.ok) throw new Error(body?.error || "Abhängigkeit konnte nicht entfernt werden.");
      } catch (error) {
        setData((current) => ({
          ...current,
          taskRelations: [relation, ...current.taskRelations],
        }));
        setSaveError(error instanceof Error ? error.message : "Abhängigkeit konnte nicht entfernt werden.");
      }
    });
  };

  return {
    addTaskComment,
    addTaskRelation,
    commentImportNotice,
    commentImportPendingTaskIds,
    importGitHubComments,
    removeTaskRelation,
    reportTaskBlocker,
    uploadTaskAttachment,
  };
}
