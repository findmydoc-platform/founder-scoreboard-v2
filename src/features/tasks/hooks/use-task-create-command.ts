"use client";

import type { Dispatch, SetStateAction } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { persistLocalPlanningData } from "@/features/planning/hooks/use-local-planning-state";
import {
  profileForAssigneeValue,
  reviewOwnerForTask,
} from "@/features/planning/model/planning-app-model";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { resolveTaskCreationHierarchy } from "@/features/tasks/model/task-creation-draft";
import type { NewTaskCreateCallbacks, NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import type { Task, TaskRelation } from "@/lib/types";

type UseTaskCreateCommandOptions = Pick<
  PlanningCommandContext,
  | "apiClient"
  | "applyPlanningDataUpdate"
  | "currentProfile"
  | "data"
  | "setSaveError"
  | "source"
  | "startTransition"
> & {
  setTaskDialogDefaults: Dispatch<SetStateAction<Partial<NewTaskDraft> | null>>;
};

export function useTaskCreateCommand({
  apiClient,
  applyPlanningDataUpdate,
  currentProfile,
  data,
  setSaveError,
  setTaskDialogDefaults,
  source,
  startTransition,
}: UseTaskCreateCommandOptions) {
  const createTask = (draft: NewTaskDraft, callbacks: NewTaskCreateCallbacks = {}) => {
    setSaveError("");

    const creationDraft = resolveTaskCreationHierarchy(draft, data.tasks);

    const assigneeProfile = profileForAssigneeValue(data.profiles, creationDraft.assignee || currentProfile?.id || "");
    const assigneeId = assigneeProfile?.id || "";
    const assignee = assigneeId ? assigneeProfile?.name || "" : "";
    const localTask: Task = {
      id: `local-${Date.now()}`,
      order: data.tasks.length + 1,
      title: creationDraft.title,
      description: creationDraft.description,
      problemStatement: creationDraft.problemStatement,
      intendedOutcome: creationDraft.intendedOutcome,
      scopeConstraints: creationDraft.scopeConstraints,
      acceptanceCriteria: creationDraft.acceptanceCriteria,
      evidenceRequired: creationDraft.evidenceRequired,
      dodTemplateVersion: "founder-deliverable-v2",
      status: creationDraft.status || "Offen",
      priority: creationDraft.priority || "P2",
      assigneeId,
      assignee,
      ownerId: assigneeId,
      owner: assignee,
      createdById: currentProfile?.id || "",
      workstream: creationDraft.workstream,
      packageId: creationDraft.packageId,
      milestoneId: creationDraft.milestoneId,
      deadline: creationDraft.deadline,
      definitionOfDone: creationDraft.definitionOfDone,
      dependsOn: "",
      evidenceLink: "",
      issueNumber: "",
      issueUrl: "",
      note: "",
      watched: false,
      hours: creationDraft.hours,
      startDate: creationDraft.startDate,
      endDate: creationDraft.endDate,
      sprintId: "",
      reviewStatus: "not_requested",
      reviewOwnerProfileId: reviewOwnerForTask({ packageId: creationDraft.packageId }, data.packages),
      scorePoints: 0,
      scoreFinal: false,
      githubRepo: creationDraft.githubRepo,
      githubIssueNumber: null,
      githubIssueUrl: "",
      githubIssueSyncStatus: "not_synced",
      githubIssueLastSyncedAt: "",
      githubIssueSyncError: "",
      taskType: creationDraft.taskType,
      parentTaskId: creationDraft.parentTaskId,
      approvalStatus: creationDraft.taskType === "sub_issue" ? null : creationDraft.approveNow ? "approved" : "proposed",
      approvalRevision: 1,
      parentApprovalStatus: creationDraft.taskType === "sub_issue"
        ? data.tasks.find((task) => task.id === creationDraft.parentTaskId)?.approvalStatus || null
        : null,
      scoreRelevant: false,
      selfDodChecked: false,
      selfEvidenceChecked: false,
      selfDocumentedChecked: false,
      selfBlockersChecked: false,
    };

    const localRelation: TaskRelation | null = creationDraft.relatedTaskId
      ? {
          id: Date.now(),
          taskId: localTask.id,
          relatedTaskId: creationDraft.relatedTaskId,
          relationType: creationDraft.relationType,
          note: creationDraft.relationNote,
          createdBy: currentProfile?.id || "",
          createdAt: new Date().toISOString(),
        }
      : null;

    if (source !== "supabase") {
      applyPlanningDataUpdate((current) => {
        const nextData = {
          ...current,
          tasks: [...current.tasks, localTask],
          taskRelations: localRelation ? [localRelation, ...current.taskRelations] : current.taskRelations,
        };
        try {
          persistLocalPlanningData(nextData);
        } catch {
          // Local development remains usable when browser storage is unavailable.
        }
        return nextData;
      });
      setTaskDialogDefaults(null);
      return;
    }

    startTransition(async () => {
      let creationCompleted = false;
      try {
        const { response, body } = await taskApi.createTaskRequest(apiClient, { ...creationDraft, assignee: assigneeId || creationDraft.assignee });
        if (!response.ok || !body?.task) throw new Error(body?.error || "Aufgabe konnte nicht erstellt werden.");

        applyPlanningDataUpdate((current) => {
          const tasksWithCreated = current.tasks.some((task) => task.id === body.task!.id)
            ? current.tasks.map((task) => (task.id === body.task!.id ? { ...task, ...body.task } : task))
            : [...current.tasks, body.task!];
          return {
            ...current,
            tasks: tasksWithCreated.map((task) =>
              body.relatedTask && task.id === body.relatedTask.id ? { ...task, ...body.relatedTask } : task,
            ),
            taskRelations: body.relation && !current.taskRelations.some((relation) => relation.id === body.relation!.id)
              ? [body.relation, ...current.taskRelations]
              : current.taskRelations,
          };
        });
        creationCompleted = true;
        setTaskDialogDefaults(null);

        if (creationDraft.createGitHubIssue && body.task.taskType === "deliverable") {
          const { response: syncResponse, body: syncBody } = await taskApi.syncTaskToGitHubRequest(apiClient, body.task.id, { createIfMissing: true });
          if (!syncResponse.ok || !syncBody?.task) {
            if (syncBody?.task) {
              applyPlanningDataUpdate((current) => ({
                ...current,
                tasks: current.tasks.map((task) => (task.id === body.task!.id ? { ...task, ...syncBody.task } : task)),
              }));
            }
            throw new Error(
              `${syncBody?.error || "GitHub Issue konnte nicht angelegt werden."} Die Aufgabe wurde gespeichert und kann erneut synchronisiert werden.`,
            );
          }
          applyPlanningDataUpdate((current) => ({
            ...current,
            tasks: current.tasks.map((task) => (task.id === body.task!.id ? { ...task, ...syncBody.task } : task)),
          }));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Aufgabe konnte nicht erstellt werden.";
        setSaveError(message);
        if (!creationCompleted) callbacks.onError?.(message);
      }
    });
  };

  return { createTask };
}
