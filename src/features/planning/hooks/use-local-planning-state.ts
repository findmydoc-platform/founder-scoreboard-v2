import { useEffect, useState } from "react";
import type { PlanningData, Task } from "@/lib/types";

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
        const stored = window.localStorage.getItem(localStateKey);
        if (stored) {
          const parsed = JSON.parse(stored) as Partial<Record<string, Partial<Task>>>;
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((task) => ({ ...task, ...(parsed[task.id] || {}) })),
          }));
        }
      } catch {
        // Keep seed data if local recovery fails.
      } finally {
        setLocalStateLoaded(true);
      }
    });
  }, [setData, source]);

  return { localStateLoaded };
}
