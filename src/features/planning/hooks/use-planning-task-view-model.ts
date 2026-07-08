"use client";

import { useMemo } from "react";
import type { PlanningFilters } from "@/features/planning/hooks/use-planning-view-state";
import { isThisWeek, sortTasks, taskText } from "@/features/planning/model/planning-app-model";
import { hasOpenWaitingRelation, taskBelongsToProfile } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { PlanningData, Profile } from "@/lib/types";

type UsePlanningTaskViewModelOptions = {
  currentProfile: Profile | null;
  data: PlanningData;
  filters: PlanningFilters;
};

export function usePlanningTaskViewModel({
  currentProfile,
  data,
  filters,
}: UsePlanningTaskViewModelOptions) {
  const filteredTasks = useMemo(() => {
    return sortTasks(
      data.tasks.filter((task) => {
        if (task.taskType === "sub_issue") return false;
        const normalized = normalizeStatus(task.status);
        const matchesQuery = !filters.query || taskText(task).includes(filters.query.toLowerCase());
        const matchesAssignee = filters.assignee === "Alle" || task.assignee === filters.assignee || task.assigneeId === filters.assignee;
        const matchesStatus = filters.status === "Alle" || normalized === filters.status;
        const matchesPriority = filters.priority === "Alle" || task.priority === filters.priority;
        const matchesPackage = filters.packageId === "Alle" || task.packageId === filters.packageId;
        const matchesQuick =
          !filters.quick ||
          (filters.quick === "mine" && taskBelongsToProfile(task, currentProfile)) ||
          (filters.quick === "open" && normalized === "Offen") ||
          (filters.quick === "blocked" && (normalized === "Blockiert" || Boolean(task.dependsOn))) ||
          (filters.quick === "week" && isThisWeek(task)) ||
          (filters.quick === "high" && ["P0", "P1"].includes(task.priority)) ||
          (filters.quick === "evidence" && !task.evidenceLink && !task.issueUrl);

        return matchesQuery && matchesAssignee && matchesStatus && matchesPriority && matchesPackage && matchesQuick;
      }),
    );
  }, [currentProfile, data.tasks, filters]);

  const visibleTasks = filteredTasks;

  const metrics = {
    total: visibleTasks.length,
    open: visibleTasks.filter((task) => normalizeStatus(task.status) !== "Erledigt").length,
    blocked: visibleTasks.filter((task) => task.dependsOn || hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations) || normalizeStatus(task.status) === "Blockiert").length,
    done: visibleTasks.filter((task) => normalizeStatus(task.status) === "Erledigt").length,
  };

  return {
    metrics,
    visibleTasks,
  };
}
