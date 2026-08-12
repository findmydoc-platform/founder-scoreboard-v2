import { sprintReviewDueAt } from "@/lib/sprint-review-window";
import type { PlanningShellState } from "@/lib/types";

export function applyReviewWindowHours(
  data: PlanningShellState,
  reviewObjectionWindowHours: number,
  savedDueDates: Array<{ id: string; reviewDueAt: string }> = [],
): PlanningShellState {
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

export function applyGitHubProjectSettings(
  data: PlanningShellState,
  githubProjectOwner: string,
  githubProjectNumber: number,
): PlanningShellState {
  return {
    ...data,
    project: { ...data.project, githubProjectOwner, githubProjectNumber },
  };
}
