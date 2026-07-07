import { useEffect, useState } from "react";
import { normalizePlanningData } from "@/features/planning/model/planning-app-model";
import type { PlanningData, Task } from "@/lib/types";

const localDataKey = "fmd-planning-local-data-v1";
const localStateKey = "fmd-planning-local-state-v1";

function localTaskState(task: Task) {
  return {
    status: task.status,
    owner: task.owner,
    assignee: task.assignee,
    priority: task.priority,
    packageId: task.packageId,
    startDate: task.startDate,
    endDate: task.endDate,
    deadline: task.deadline,
    note: task.note,
    reviewStatus: task.reviewStatus,
    scorePoints: task.scorePoints,
    githubSyncStatus: task.githubSyncStatus,
    sprintId: task.sprintId,
    milestoneId: task.milestoneId,
    dependsOn: task.dependsOn,
    evidenceLink: task.evidenceLink,
    selfDodChecked: task.selfDodChecked,
    selfEvidenceChecked: task.selfEvidenceChecked,
    selfDocumentedChecked: task.selfDocumentedChecked,
    selfBlockersChecked: task.selfBlockersChecked,
  };
}

export function persistLocalPlanningTasks(tasks: Task[]) {
  const changedTasks = Object.fromEntries(tasks.map((task) => [task.id, localTaskState(task)]));
  window.localStorage.setItem(localStateKey, JSON.stringify(changedTasks));
}

export function persistLocalPlanningData(data: PlanningData) {
  window.localStorage.setItem(localDataKey, JSON.stringify(data));
  persistLocalPlanningTasks(data.tasks);
}

type UseLocalPlanningStateOptions = {
  source: "seed" | "supabase";
  setData: (updater: (current: PlanningData) => PlanningData) => void;
};

export function useLocalPlanningState({ source, setData }: UseLocalPlanningStateOptions) {
  const [localStateLoaded, setLocalStateLoaded] = useState(source === "supabase");

  useEffect(() => {
    if (source === "supabase") return;

    queueMicrotask(() => {
      try {
        const storedData = window.localStorage.getItem(localDataKey);
        const stored = window.localStorage.getItem(localStateKey);
        const parsedData = storedData ? JSON.parse(storedData) as PlanningData : null;
        const parsedTasks = stored ? JSON.parse(stored) as Partial<Record<string, Partial<Task>>> : {};
        setData((current) => {
          const base = normalizePlanningData(parsedData || current);
          return {
            ...base,
            tasks: base.tasks.map((task) => ({ ...task, ...(parsedTasks[task.id] || {}) })),
          };
        });
      } catch {
        // Keep the empty fallback if local recovery fails.
      } finally {
        setLocalStateLoaded(true);
      }
    });
  }, [setData, source]);

  return { localStateLoaded };
}
