"use client";

import { useCallback, useEffect } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import type { TaskActionResult } from "@/features/tasks/hooks/task-mutation-command-types";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { hasGitHubIssue } from "@/lib/platform";
import type { Task, TaskRelation, TaskRelationType } from "@/lib/types";

type UseTaskCollaborationCommandsOptions = PlanningCommandContext & {
  selectedTask: Task | null;
};

export function useTaskCollaborationCommands({
  planningState,
  apiClient,
  currentProfile,
  githubInstallationAvailable,
  selectedTask,
  setData,
  setSaveError,
  source,
  startTransition,
}: UseTaskCollaborationCommandsOptions) {
  const importView = selectedTask ? planningState.taskGitHubImport(selectedTask.id) : null;
  const commentImportNotice = importView?.notice || "";
  const commentImportPendingTaskIds = new Set(importView?.phase === "saving" && selectedTask ? [selectedTask.id] : []);

  const addTaskComment = async (task: Task, comment: string) => {
    if (!currentProfile) {
      setSaveError("GitHub-User ist keinem Teamprofil zugeordnet.");
      throw new Error("GitHub-User ist keinem Teamprofil zugeordnet.");
    }

    setSaveError("");

    const result = await planningState.createTaskComment(task, comment);
    if (!result.ok) { setSaveError(result.error); throw new Error(result.error); }
  };

  const uploadTaskAttachment = async (task: Task, file: File) => {
    setSaveError("");

    if (source !== "supabase") {
      throw new Error("Anhänge können nur mit aktiver Verbindung hochgeladen werden.");
    }

    const result = await planningState.uploadTaskAttachment(task, file);
    if (!result.ok) throw new Error(result.error);
    return result.markdown;
  };

  const importGitHubComments = useCallback((task: Task, options: { silent?: boolean } = {}) => {
    if (!options.silent) setSaveError("");
    if (source !== "supabase") {
      if (!options.silent) setSaveError("GitHub-Kommentarimport ist in diesem Arbeitsmodus nicht verfügbar.");
      return;
    }
    void planningState.importTaskGitHubComments(task, { automatic: options.silent }).then(result => {
      if (!options.silent && !result.ok && result.kind !== "ended") setSaveError(result.error);
    });
  }, [planningState, setSaveError, source]);

  useEffect(() => {
    if (!selectedTask || source !== "supabase" || !githubInstallationAvailable || !hasGitHubIssue(selectedTask)) return;
    importGitHubComments(selectedTask, { silent: true });
  }, [githubInstallationAvailable, importGitHubComments, selectedTask, source]);

  const reportTaskBlocker = async (task: Task, payload: { reason: string; impact: string; needsHelpFrom: string }): Promise<TaskActionResult> => {
    if (!currentProfile) {
      const error = "GitHub-User ist keinem Teamprofil zugeordnet.";
      return { ok: false, error };
    }

    setSaveError("");

    return planningState.reportTaskBlocker(task, payload);
  };

  const addTaskRelation = async (task: Task, payload: { relationType: TaskRelationType; relatedTaskId: string; note: string }): Promise<TaskActionResult> => {
    setSaveError("");
    if (!payload.relatedTaskId || payload.relatedTaskId === task.id) {
      const error = "Bitte eine andere Aufgabe auswählen.";
      return { ok: false, error };
    }

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
          ? { ...item, githubIssueSyncStatus: "not_synced", githubIssueSyncError: "" }
          : item,
      ),
    }));
    if (source !== "supabase") return { ok: true };

    return new Promise<TaskActionResult>((resolve) => {
      startTransition(async () => {
        try {
          const { response, body } = await taskApi.addTaskRelationshipRequest(apiClient, task.id, payload);
          if (!response.ok || !body?.relation) throw new Error(body?.error || "Abhängigkeit konnte nicht gespeichert werden.");

          setData((current) => ({
            ...current,
            taskRelations: current.taskRelations.map((relation) => (relation.id === localRelation.id ? body.relation! : relation)),
          }));
          resolve({ ok: true });
        } catch (caught) {
          const error = caught instanceof Error ? caught.message : "Abhängigkeit konnte nicht gespeichert werden.";
          setData((current) => ({
            ...current,
            taskRelations: current.taskRelations.filter((relation) => relation.id !== localRelation.id),
          }));
          resolve({ ok: false, error });
        }
      });
    });
  };

  const removeTaskRelation = (task: Task, relation: TaskRelation) => {
    setSaveError("");
    setData((current) => ({
      ...current,
      taskRelations: current.taskRelations.filter((item) => item.id !== relation.id),
      tasks: current.tasks.map((item) =>
        item.id === relation.taskId || item.id === relation.relatedTaskId
          ? { ...item, githubIssueSyncStatus: "not_synced", githubIssueSyncError: "" }
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
