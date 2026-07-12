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
      taskId={task.id}
      initialData={data}
      headerData={emptyPlanningHeaderData}
      source="seed"
    />
  );
}
