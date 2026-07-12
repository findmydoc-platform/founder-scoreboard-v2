"use client";

import { useMemo } from "react";
import type { PlanningFilters } from "@/features/planning/hooks/use-planning-view-state";
import { isThisWeek, sortTasks, taskText } from "@/features/planning/model/planning-app-model";
import { taskHasCriticalAttention, taskHasMissingEvidenceAttention } from "@/features/tasks/model/task-attention-signals";
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
        const normalizedQuery = filters.query.trim().toLocaleLowerCase("de");
        const initiative = data.packages.find((pack) => pack.id === task.packageId);
        const sprint = data.sprints.find((item) => item.id === task.sprintId);
        const reviewOwner = data.profiles.find((profile) => profile.id === task.reviewOwnerProfileId);
        const matchesQuery = !normalizedQuery || [
          taskText(task),
          normalized,
          initiative?.title || "",
          initiative?.goal || "",
          sprint?.name || "",
          reviewOwner?.name || "",
        ].join(" ").toLocaleLowerCase("de").includes(normalizedQuery);
        const matchesAssignee = filters.assignee === "Alle" || task.assignee === filters.assignee || task.assigneeId === filters.assignee;
        const matchesStatus = filters.status === "Alle" || normalized === filters.status;
        const matchesPriority = filters.priority === "Alle" || task.priority === filters.priority;
        const matchesPackage = filters.packageId === "Alle" || task.packageId === filters.packageId;
        const matchesQuick = filters.quick.every((quickFilter) => (
          (quickFilter === "mine" && taskBelongsToProfile(task, currentProfile)) ||
          (quickFilter === "open" && normalized === "Offen") ||
          (quickFilter === "critical" && taskHasCriticalAttention(task, data)) ||
          (quickFilter === "blocked" && (normalized === "Blockiert" || Boolean(task.dependsOn) || hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations))) ||
          (quickFilter === "week" && isThisWeek(task)) ||
          (quickFilter === "high" && ["P0", "P1"].includes(task.priority)) ||
          (quickFilter === "evidence" && taskHasMissingEvidenceAttention(task))
        ));

        return matchesQuery && matchesAssignee && matchesStatus && matchesPriority && matchesPackage && matchesQuick;
      }),
    );
  }, [currentProfile, data, filters]);

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
