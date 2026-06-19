"use client";

import type { Dispatch, SetStateAction } from "react";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { persistLocalPlanningTasks } from "@/features/planning/hooks/use-local-planning-state";
import {
  founderStatusGuardMessage,
  founderTaskOwnershipGuardMessage,
  profileForOwnerValue,
  reviewOwnerForTask,
  taskOwnerPatch,
} from "@/features/planning/model/planning-app-model";
import { hasGitHubIssue } from "@/lib/platform";
import type { DecisionTaskLink, Task, TaskStatus } from "@/lib/types";

type UseTaskMutationCommandsOptions = PlanningCommandContext & {
  closeTaskPanel: () => void;
  setStatusGuardNotice: Dispatch<SetStateAction<string>>;
  setStatusGuardTaskId: Dispatch<SetStateAction<string | null>>;
  setTaskDialogDefaults: Dispatch<SetStateAction<Partial<NewTaskDraft> | null>>;
};

export function useTaskMutationCommands({
  apiClient,
  applyPlanningDataUpdate,
  canChangeTaskStatus,
  canManageTaskMeta,
  closeTaskPanel,
  currentProfile,
  data,
  githubProviderTokenAvailable,
  setData,
  setSaveError,
  setStatusGuardNotice,
  setStatusGuardTaskId,
  setTaskDialogDefaults,
  source,
  startTransition,
}: UseTaskMutationCommandsOptions) {
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
      try {
        const { response, body } = await taskApi.syncTaskToGitHubRequest(apiClient, task.id, { createIfMissing: Boolean(options.createIfMissing) });
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
      for (const task of queueTasks) {
        try {
          const { response, body } = await taskApi.syncTaskToGitHubRequest(apiClient, task.id, { createIfMissing: false });
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
      try {
        const { response, body } = await taskApi.updateTaskRequest(apiClient, task.id, {
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
        });
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
      let createdTaskCommitted = false;

      try {
        const { response, body } = await taskApi.createTaskRequest(apiClient, { ...draft, owner: ownerId || draft.owner });
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
          const { response: decisionResponse, body: decisionBody } = await planningApi.linkDecisionTaskRequest(apiClient, draft.decisionId, { taskId: body.task.id, linkType: "follows_from", note: draft.decisionLinkNote });
          if (!decisionResponse.ok || !decisionBody?.link) throw new Error(decisionBody?.error || "Decision-Folgeaufgabe konnte nicht verknüpft werden.");
          setData((current) => ({
            ...current,
            decisionTaskLinks: localDecisionLink
              ? current.decisionTaskLinks.map((link) => (link.id === localDecisionLink.id ? decisionBody.link! : link))
              : [decisionBody.link!, ...current.decisionTaskLinks],
          }));
        }

        if (draft.relatedTaskId && draft.relatedTaskId !== body.task.id) {
          const { response: relationResponse, body: relationBody } = await taskApi.addTaskRelationshipRequest(apiClient, body.task.id, {
            relationType: draft.relationType,
            relatedTaskId: draft.relatedTaskId,
            note: draft.relationNote,
          });
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
          const { response: syncResponse, body: syncBody } = await taskApi.syncTaskToGitHubRequest(apiClient, body.task.id, { createIfMissing: true });
          if (!syncResponse.ok || !syncBody?.task) throw new Error(syncBody?.error || "GitHub-Issue konnte nicht angelegt werden.");
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((task) => (task.id === body.task!.id ? { ...task, ...syncBody.task } : task)),
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
      try {
        const { response, body } = await taskApi.deleteTaskRequest(apiClient, task.id);
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

  return {
    createTask,
    deleteTask,
    syncLinkedGitHubTasks,
    syncTaskToGitHub,
    updateTask,
  };
}
