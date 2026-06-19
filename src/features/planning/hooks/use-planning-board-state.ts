"use client";

import { useState, type DragEvent } from "react";
import type { PlanningData, Task, TaskStatus } from "@/lib/types";
import {
  createTaskDragPreview,
  founderTaskOwnershipGuardMessage,
  transparentDragImage,
} from "@/features/planning/model/planning-app-model";
import { normalizeStatus } from "@/lib/status";

type UsePlanningBoardStateOptions = {
  canChangeTaskStatus: (task: Task) => boolean;
  data: PlanningData;
  setStatusGuardNotice: (message: string) => void;
  setStatusGuardTaskId: (taskId: string | null) => void;
  updateTask: (task: Task, patch: Partial<Task>) => void;
};

export function usePlanningBoardState({
  canChangeTaskStatus,
  data,
  setStatusGuardNotice,
  setStatusGuardTaskId,
  updateTask,
}: UsePlanningBoardStateOptions) {
  const [expandedPackages, setExpandedPackages] = useState<Record<string, boolean>>({});
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);

  const startTaskDrag = (task: Task, event: DragEvent<HTMLElement>) => {
    if (!canChangeTaskStatus(task)) {
      event.preventDefault();
      setStatusGuardNotice(founderTaskOwnershipGuardMessage());
      setStatusGuardTaskId(task.id);
      return;
    }
    setDraggedTaskId(task.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    event.dataTransfer.setDragImage(transparentDragImage(), 0, 0);

    const preview = createTaskDragPreview(event.currentTarget, event.clientX, event.clientY);
    document.body.style.cursor = "none";

    const movePreview = (dragEvent: globalThis.DragEvent) => {
      if (dragEvent.clientX === 0 && dragEvent.clientY === 0) return;
      preview.style.left = `${dragEvent.clientX - 24}px`;
      preview.style.top = `${dragEvent.clientY - 18}px`;
    };
    const cleanupPreview = () => {
      preview.remove();
      document.body.style.cursor = "";
      window.removeEventListener("dragover", movePreview);
      window.removeEventListener("drop", cleanupPreview);
      window.removeEventListener("dragend", cleanupPreview);
    };

    window.addEventListener("dragover", movePreview);
    window.addEventListener("drop", cleanupPreview, { once: true });
    window.addEventListener("dragend", cleanupPreview, { once: true });
  };

  const dropTaskOnStatus = (status: TaskStatus, event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;
    const task = data.tasks.find((item) => item.id === taskId);
    setDraggedTaskId(null);
    setDragOverStatus(null);
    if (!task || normalizeStatus(task.status) === status) return;
    if (!canChangeTaskStatus(task)) {
      setStatusGuardNotice(founderTaskOwnershipGuardMessage());
      setStatusGuardTaskId(task.id);
      return;
    }
    updateTask(task, { status });
  };

  const endTaskDrag = () => {
    setDraggedTaskId(null);
    setDragOverStatus(null);
  };

  const togglePackageCollapse = (packageId: string) => {
    setExpandedPackages((current) => ({ ...current, [packageId]: !current[packageId] }));
  };

  const setAllPackageCollapse = (collapsed: boolean) => {
    setExpandedPackages(Object.fromEntries(data.packages.map((pack) => [pack.id, !collapsed])));
  };

  return {
    dragOverStatus,
    draggedTaskId,
    dropTaskOnStatus,
    endTaskDrag,
    expandedPackages,
    setAllPackageCollapse,
    setDragOverStatus,
    startTaskDrag,
    togglePackageCollapse,
  };
}
