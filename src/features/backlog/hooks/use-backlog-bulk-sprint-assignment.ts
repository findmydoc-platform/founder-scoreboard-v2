"use client";

import { useRef, useState, type Dispatch } from "react";
import type { BacklogAction } from "@/features/backlog/model/backlog-read-model";
import * as taskApi from "@/features/tasks/model/task-api-client";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Sprint, Task } from "@/lib/types";

type UseBacklogBulkSprintAssignmentOptions = {
  apiClient: BrowserApiClient;
  canManageBacklog: boolean;
  dispatch: Dispatch<BacklogAction>;
  refreshBacklogModel: () => Promise<void>;
  setMessage: (message: string) => void;
};

export function useBacklogBulkSprintAssignment({
  apiClient,
  canManageBacklog,
  dispatch,
  refreshBacklogModel,
  setMessage,
}: UseBacklogBulkSprintAssignmentOptions) {
  const [isBulkAssigningSprint, setIsBulkAssigningSprint] = useState(false);
  const assignmentInFlightRef = useRef(false);

  const assignTasksToSprint = async (tasks: Task[], sprint: Sprint): Promise<boolean> => {
    if (!canManageBacklog) {
      setMessage("Nur CEO oder Deputy können Deliverables einem Sprint zuordnen.");
      return false;
    }
    if (!tasks.length || tasks.length > 100 || tasks.some((task) => !task.updatedAt)) {
      setMessage("Wähle zwischen 1 und 100 aktuelle Deliverables aus.");
      return false;
    }
    if (assignmentInFlightRef.current) {
      setMessage("Sprint-Zuordnungen werden bereits gespeichert.");
      return false;
    }

    assignmentInFlightRef.current = true;
    setIsBulkAssigningSprint(true);
    setMessage("");
    try {
      const { response, body } = await taskApi.assignBacklogTasksToSprintRequest(apiClient, {
        assignments: tasks.map((task) => ({ taskId: task.id, expectedUpdatedAt: task.updatedAt! })),
        sprintId: sprint.id,
      });
      if (!response.ok || !body?.updates) {
        await refreshBacklogModel().catch(() => {});
        setMessage(body?.error || "Sprint-Zuordnungen konnten nicht gespeichert werden.");
        return false;
      }

      const updatesById = new Map(body.updates.map((update) => [update.id, update]));
      dispatch({
        type: "itemsPatched",
        patches: [...updatesById].map(([id, update]) => ({
          id,
          scoreRelevant: update.scoreRelevant,
          sprintId: update.sprintId,
          updatedAt: update.updatedAt,
        })),
      });
      setMessage(`${tasks.length} Deliverables wurden dem Sprint „${sprint.name}“ zugeordnet.`);
      return true;
    } catch {
      await refreshBacklogModel().catch(() => {});
      setMessage("Sprint-Zuordnungen konnten nicht gespeichert werden.");
      return false;
    } finally {
      assignmentInFlightRef.current = false;
      setIsBulkAssigningSprint(false);
    }
  };

  return {
    assignTasksToSprint,
    isBulkAssigningSprint,
  };
}
