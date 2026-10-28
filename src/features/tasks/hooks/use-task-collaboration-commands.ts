"use client";

import { useCallback, useEffect } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import type { TaskActionResult } from "@/features/tasks/hooks/task-mutation-command-types";
import { hasGitHubIssue } from "@/lib/platform";
import type { Task, TaskRelation, TaskRelationType } from "@/lib/types";

type UseTaskCollaborationCommandsOptions = PlanningCommandContext & {
  selectedTask: Task | null;
};

export function useTaskCollaborationCommands({
  planningState,
  currentProfile,
  githubInstallationAvailable,
  selectedTask,
  setSaveError,
  source,
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
    return planningState.addTaskRelationship(task, payload);
  };

  const removeTaskRelation = (task: Task, relation: TaskRelation) => {
    setSaveError("");
    void planningState.removeTaskRelationship(task, relation);
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
