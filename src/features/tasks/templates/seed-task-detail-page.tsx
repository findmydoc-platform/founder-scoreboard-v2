"use client";

import { useEffect, useState } from "react";
import { readLocalPlanningData } from "@/features/planning/hooks/use-local-planning-state";
import { PlanningDataUnavailablePage } from "@/features/planning/templates/planning-data-unavailable-page";
import { TaskDetailPage } from "@/features/tasks/templates/task-detail-page";
import { emptyPlanningData } from "@/lib/planning-data";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import type { PlanningData } from "@/lib/types";

export function SeedTaskDetailPage({ taskId }: { taskId: string }) {
  const [data, setData] = useState<PlanningData | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        setData(readLocalPlanningData(emptyPlanningData));
      } catch {
        setData(emptyPlanningData);
      }
    });
  }, []);

  if (!data) return <div className="min-h-screen bg-slate-50" aria-label="Aufgabendetails werden geladen" />;
  const task = data.tasks.find((item) => item.id === taskId);
  if (!task) return <PlanningDataUnavailablePage workspace="planning" />;

  return (
    <TaskDetailPage
      task={task}
      pack={data.packages.find((pack) => pack.id === task.packageId)}
      packages={data.packages}
      sprint={data.sprints.find((sprint) => sprint.id === task.sprintId)}
      subIssues={data.tasks.filter((item) => item.parentTaskId === task.id)}
      comments={data.taskComments.filter((comment) => comment.taskId === task.id)}
      externalComments={data.taskExternalComments.filter((comment) => comment.taskId === task.id)}
      activities={data.taskActivity.filter((activity) => activity.taskId === task.id)}
      blockers={data.taskBlockers.filter((blocker) => blocker.taskId === task.id)}
      taskRelations={data.taskRelations.filter((relation) => relation.taskId === task.id || relation.relatedTaskId === task.id)}
      allTasks={data.tasks}
      profiles={data.profiles}
      sprints={data.sprints}
      milestones={data.milestones}
      headerData={emptyPlanningHeaderData}
      source="seed"
    />
  );
}
