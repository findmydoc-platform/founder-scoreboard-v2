"use client";

import type { Dispatch, SetStateAction } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import {
  profileForAssigneeValue,
} from "@/features/planning/model/planning-app-model";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { classifyTaskGitHubSyncResponse } from "@/lib/github-sync/contract";
import { resolveTaskCreationHierarchy, taskCreationRequestPayload } from "@/features/tasks/model/task-creation-draft";
import type { NewTaskCreateCallbacks, NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";

type UseTaskCreateCommandOptions = Pick<
  PlanningCommandContext,
  | "apiClient"
  | "applyPlanningShellStateUpdate"
  | "currentProfile"
  | "data"
  | "setSaveError"
  | "startTransition"
> & {
  setTaskDialogDefaults: Dispatch<SetStateAction<Partial<NewTaskDraft> | null>>;
};

export function useTaskCreateCommand({
  apiClient,
  applyPlanningShellStateUpdate,
  currentProfile,
  data,
  setSaveError,
  setTaskDialogDefaults,
  startTransition,
}: UseTaskCreateCommandOptions) {
  const createTask = (draft: NewTaskDraft, callbacks: NewTaskCreateCallbacks = {}) => {
    setSaveError("");

    const creationDraft = resolveTaskCreationHierarchy(draft, data.tasks);

    const assigneeProfile = profileForAssigneeValue(data.profiles, creationDraft.assignee || currentProfile?.id || "");
    const assigneeId = assigneeProfile?.id || "";
    startTransition(async () => {
      let creationCompleted = false;
      try {
        const requestPayload = taskCreationRequestPayload({
          ...creationDraft,
          assignee: assigneeId || creationDraft.assignee,
        });
        const { response, body } = await taskApi.createTaskRequest(apiClient, requestPayload);
        if (!response.ok || !body?.task) throw new Error(body?.error || "Aufgabe konnte nicht erstellt werden.");

        applyPlanningShellStateUpdate((current) => {
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
          const classification = classifyTaskGitHubSyncResponse(syncResponse.status, syncBody);
          if (classification.kind !== "success") {
            if (classification.result.task) {
              applyPlanningShellStateUpdate((current) => ({
                ...current,
                tasks: current.tasks.map((task) => (
                  task.id === body.task!.id
                    ? { ...task, ...classification.result.task }
                    : task
                )),
              }));
            }
            throw new Error(
              `${classification.result.error || "GitHub Issue konnte nicht angelegt werden."} Die Aufgabe wurde gespeichert und kann erneut synchronisiert werden.`,
            );
          }
          applyPlanningShellStateUpdate((current) => ({
            ...current,
            tasks: current.tasks.map((task) => (
              task.id === body.task!.id
                ? { ...task, ...classification.result.task }
                : task
            )),
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
