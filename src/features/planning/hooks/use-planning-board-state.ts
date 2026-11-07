"use client";

import { useState, type DragEvent } from "react";
import type { PlanningShellState, Task, TaskStatus } from "@/lib/types";
import {
  founderCompletedTaskGuardMessage,
  founderTaskAssignmentGuardMessage,
  initiativePlanningItems,
} from "@/features/planning/model/planning-app-model";
import { normalizeStatus } from "@/lib/status";

type UsePlanningBoardStateOptions = {
  planningState: import("../model/planning-state").PlanningState;
  canChangeTaskStatus: (task: Task) => boolean;
  data: PlanningShellState;
  setStatusGuardNotice: (message: string) => void;
  setStatusGuardTaskId: (taskId: string | null) => void;
  updateTask: import("@/features/tasks/hooks/task-mutation-command-types").TaskUpdateCommand;
};

export function usePlanningBoardState({
  planningState,
  canChangeTaskStatus,
  data,
  setStatusGuardNotice,
  setStatusGuardTaskId,
  updateTask,
}: UsePlanningBoardStateOptions) {
  const [taskEditors, setTaskEditors] = useState<Record<string, import("../model/planning-state").PlanningTaskEditor>>({});
  const beginBoardTaskEdit = (task: Task) => {
    const existing = taskEditors[task.id];
    if (existing && existing.view().phase === "saving") return existing;
    existing?.close();
    const editor = planningState.beginTaskEdit(task);
    setTaskEditors(current => ({ ...current, [task.id]: editor }));
    return editor;
  };
  const updateBoardTask = (task: Task, patch: Partial<Task>) => {
    const editor = taskEditors[task.id] || beginBoardTaskEdit(task);
    return updateTask(task, patch, { editor });
  };
  const conflictedEntry = Object.entries(taskEditors).find(([, editor]) => editor.view().phase === "conflict");
  const boardTaskEditConflict = conflictedEntry ? { taskId: conflictedEntry[0], ...conflictedEntry[1].view() } : null;
  const resaveBoardTask = async () => {
    if (!conflictedEntry) return;
    const [taskId, editor] = conflictedEntry;
    const task = data.tasks.find(item => item.id === taskId);
    const submitted = editor.view().submitted;
    if (task && submitted) await updateTask(task, submitted, { editor, resave: true });
  };
  const reloadBoardTaskConflict = async () => { await conflictedEntry?.[1].refreshConflict(); };
  const [expandedInitiatives, setExpandedInitiatives] = useState<Record<string, boolean>>({});
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);

  const startTaskDrag = (task: Task, event: DragEvent<HTMLElement>) => {
    if (!canChangeTaskStatus(task)) {
      event.preventDefault();
      setStatusGuardNotice(normalizeStatus(task.status) === "Erledigt" ? founderCompletedTaskGuardMessage() : founderTaskAssignmentGuardMessage());
      setStatusGuardTaskId(task.id);
      return;
    }
    beginBoardTaskEdit(task);
    setDraggedTaskId(task.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    const rect = event.currentTarget.getBoundingClientRect();
    event.dataTransfer.setDragImage(event.currentTarget, event.clientX - rect.left, event.clientY - rect.top);
  };

  const dropTaskOnStatus = (status: TaskStatus, event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;
    const task = data.tasks.find((item) => item.id === taskId);
    setDraggedTaskId(null);
    setDragOverStatus(null);
    if (!task || normalizeStatus(task.status) === status) return;
    if (!canChangeTaskStatus(task)) {
      setStatusGuardNotice(normalizeStatus(task.status) === "Erledigt" ? founderCompletedTaskGuardMessage() : founderTaskAssignmentGuardMessage());
      setStatusGuardTaskId(task.id);
      return;
    }
    void updateBoardTask(task, { status });
  };

  const endTaskDrag = () => {
    setDraggedTaskId(null);
    setDragOverStatus(null);
  };

  const toggleInitiativeCollapse = (initiativeId: string) => {
    setExpandedInitiatives((current) => ({ ...current, [initiativeId]: !current[initiativeId] }));
  };

  const setAllInitiativeCollapse = (collapsed: boolean) => {
    setExpandedInitiatives(Object.fromEntries(initiativePlanningItems(data.tasks).map((initiative) => [initiative.id, !collapsed])));
  };

  const setExpandedInitiativeIds = (initiativeIds: string[]) => {
    setExpandedInitiatives(Object.fromEntries(initiativeIds.map((initiativeId) => [initiativeId, true])));
  };

  return {
    beginBoardTaskEdit,
    updateBoardTask,
    boardTaskEditConflict,
    resaveBoardTask,
    reloadBoardTaskConflict,
    dragOverStatus,
    draggedTaskId,
    dropTaskOnStatus,
    endTaskDrag,
    expandedInitiatives,
    setAllInitiativeCollapse,
    setDragOverStatus,
    setExpandedInitiativeIds,
    startTaskDrag,
    toggleInitiativeCollapse,
  };
}
