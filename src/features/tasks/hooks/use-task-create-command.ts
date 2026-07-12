"use client";

import type { Dispatch, SetStateAction } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { persistLocalPlanningTasks } from "@/features/planning/hooks/use-local-planning-state";
import {
  profileForAssigneeValue,
  reviewOwnerForTask,
} from "@/features/planning/model/planning-app-model";
import * as taskApi from "@/features/tasks/model/task-api-client";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import type { Task } from "@/lib/types";

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
  const createTask = (draft: NewTaskDraft) => {
    setSaveError("");

    const assigneeProfile = profileForAssigneeValue(data.profiles, draft.assignee || currentProfile?.id || "");
    const assigneeId = draft.taskType === "proposal" && !draft.assignee ? "" : assigneeProfile?.id || "";
    const assignee = assigneeId ? assigneeProfile?.name || "" : "";
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
      assigneeId,
      assignee,
      ownerId: assigneeId,
      owner: assignee,
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
      githubIssueSyncStatus: "not_synced",
      githubIssueLastSyncedAt: "",
      githubIssueSyncError: "",
      taskType: draft.taskType,
      parentTaskId: draft.parentTaskId,
      scoreRelevant: draft.taskType === "deliverable",
      selfDodChecked: false,
      selfEvidenceChecked: false,
      selfDocumentedChecked: false,
      selfBlockersChecked: false,
    };

    if (source !== "supabase") {
      applyPlanningDataUpdate((current) => {
        const nextData = {
          ...current,
          tasks: [...current.tasks, localTask],
        };
        try {
          persistLocalPlanningTasks(nextData.tasks);
        } catch {
          // Local development remains usable when browser storage is unavailable.
        }
        return nextData;
      });
      setTaskDialogDefaults(null);
      return;
    }

    startTransition(async () => {
      try {
        const { response, body } = await taskApi.createTaskRequest(apiClient, { ...draft, assignee: assigneeId || draft.assignee });
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
        setTaskDialogDefaults(null);

        if (draft.createGitHubIssue && body.task.taskType === "deliverable") {
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
        setSaveError(error instanceof Error ? error.message : "Aufgabe konnte nicht erstellt werden.");
      }
    });
  };

  return { createTask };
}
