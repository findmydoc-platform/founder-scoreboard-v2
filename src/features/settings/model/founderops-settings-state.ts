import { sprintReviewDueAt } from "@/lib/sprint-review-window";
import type { PlanningData } from "@/lib/types";

export function applyReviewWindowHours(
  data: PlanningData,
  reviewObjectionWindowHours: number,
  savedDueDates: Array<{ id: string; reviewDueAt: string }> = [],
): PlanningData {
  const savedDueDateBySprintId = new Map(savedDueDates.map((sprint) => [sprint.id, sprint.reviewDueAt]));
  return {
    ...data,
    project: { ...data.project, reviewObjectionWindowHours },
    sprints: data.sprints.map((sprint) => {
      if (sprint.scoreLocked) return sprint;
      const reviewDueAt = savedDueDateBySprintId.get(sprint.id)
        || sprintReviewDueAt(sprint.endDate, reviewObjectionWindowHours);
      return { ...sprint, reviewDueAt };
    }),
  };
}
