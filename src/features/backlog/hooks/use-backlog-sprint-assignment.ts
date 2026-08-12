"use client";

import type { Dispatch } from "react";
import {
  backlogSprintAssignmentMessage,
  getBacklogSprintAssignmentEligibility,
  type BacklogSprintAssignmentEligibility,
} from "@/features/backlog/model/backlog-planning-state";
import type { BacklogAction } from "@/features/backlog/model/backlog-read-model";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { taskUpdateRequestPayload } from "@/features/tasks/model/task-mutation-contract";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Sprint, Task } from "@/lib/types";

type UseBacklogSprintAssignmentOptions = {
  apiClient: BrowserApiClient;
  canManageBacklog: boolean;
  dispatch: Dispatch<BacklogAction>;
  refreshBacklogModel: () => Promise<void>;
  setMessage: (message: string) => void;
  sprintById?: ReadonlyMap<string, Sprint>;
};

export function useBacklogSprintAssignment({
  apiClient,
  canManageBacklog,
  dispatch,
  refreshBacklogModel,
  setMessage,
  sprintById,
}: UseBacklogSprintAssignmentOptions) {
  const assignTaskToSprint = async (task: Task, sprint: Sprint | null): Promise<BacklogSprintAssignmentEligibility> => {
    const eligibility = getBacklogSprintAssignmentEligibility(task, sprint, {
      canManage: canManageBacklog,
      sourceSprintLocked: Boolean(task.sprintId && sprintById?.get(task.sprintId)?.scoreLocked),
    });
    if (!eligibility.ok || eligibility.action === "noop") {
      setMessage(backlogSprintAssignmentMessage(eligibility.reason));
      return eligibility;
    }

    setMessage("");
    try {
      const { response, body } = await taskApi.updateTaskRequest(
        apiClient,
        task.id,
        taskUpdateRequestPayload({ sprintId: sprint?.id || "" }, task.updatedAt || ""),
      );
      if (!response.ok) {
        await refreshBacklogModel().catch(() => {});
        setMessage(body?.error || "Sprint-Zuordnung konnte nicht gespeichert werden.");
        return eligibility;
      }
      dispatch({
        type: "itemsPatched",
        patches: [{ id: task.id, ...(body?.task || { sprintId: sprint?.id || "" }) }],
      });
    } catch {
      await refreshBacklogModel().catch(() => {});
      setMessage("Sprint-Zuordnung konnte nicht gespeichert werden.");
    }
    return eligibility;
  };

  return {
    assignTaskToSprint,
    unassignTaskFromSprint: (task: Task) => assignTaskToSprint(task, null),
  };
}
