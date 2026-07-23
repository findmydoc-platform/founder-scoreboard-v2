"use client";

import type { Dispatch, SetStateAction } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import {
  profileForAssigneeValue,
} from "@/features/planning/model/planning-app-model";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { resolveTaskCreationHierarchy } from "@/features/tasks/model/task-creation-draft";
import type { NewTaskCreateCallbacks, NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";

type UseTaskCreateCommandOptions = Pick<
  PlanningCommandContext,
  | "apiClient"
  | "applyPlanningDataUpdate"
  | "currentProfile"
  | "data"
  | "setSaveError"
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
