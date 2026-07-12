import { hasGitHubIssue } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { PlanningData, Task } from "@/lib/types";

export type SprintTaskRiskFilter = "all" | "github" | "carryover" | "outcome";
export type SprintTaskReviewFilter = "all" | "not_requested" | "requested" | "changes_requested" | "accepted" | "partial";
export type SprintTaskScoreFilter = "all" | "open" | "final";
export type SprintTaskSort = "priority" | "title" | "status" | "assignee" | "sprint" | "score";

export type SprintTaskTableFilters = {
  query: string;
  status: string;
  assignee: string;
  risk: SprintTaskRiskFilter;
  review: SprintTaskReviewFilter;
  score: SprintTaskScoreFilter;
  sort: SprintTaskSort;
  direction: "asc" | "desc";
};

export const DEFAULT_SPRINT_TASK_FILTERS: SprintTaskTableFilters = {
  query: "",
  status: "Alle",
  assignee: "Alle",
  risk: "all",
  review: "all",
  score: "all",
  sort: "priority",
  direction: "asc",
};

export function buildSprintTaskTableRows(tasks: Task[], data: Pick<PlanningData, "sprints">, filters: SprintTaskTableFilters) {
  const query = filters.query.trim().toLocaleLowerCase("de");
  const priorityRank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
  const direction = filters.direction === "desc" ? -1 : 1;
  return tasks.filter((task) => {
    const queryMatches = !query || [task.title, task.description, task.assignee, task.workstream, task.priority].join(" ").toLocaleLowerCase("de").includes(query);
    const statusMatches = filters.status === "Alle" || normalizeStatus(task.status) === filters.status;
    const assigneeMatches = filters.assignee === "Alle" || task.assigneeId === filters.assignee || task.assignee === filters.assignee;
    const riskMatches = filters.risk === "all"
      || filters.risk === "github" && !hasGitHubIssue(task)
      || filters.risk === "carryover" && Boolean(task.carriedFromSprintId)
      || filters.risk === "outcome" && Boolean(task.sprintOutcome);
    const reviewMatches = filters.review === "all" || task.reviewStatus === filters.review;
    const scoreMatches = filters.score === "all" || filters.score === "final" && task.scoreFinal || filters.score === "open" && !task.scoreFinal;
    return queryMatches && statusMatches && assigneeMatches && riskMatches && reviewMatches && scoreMatches;
  }).sort((left, right) => {
    let comparison = 0;
    if (filters.sort === "title") comparison = left.title.localeCompare(right.title, "de");
    else if (filters.sort === "status") comparison = normalizeStatus(left.status).localeCompare(normalizeStatus(right.status), "de");
    else if (filters.sort === "assignee") comparison = (left.assignee || "").localeCompare(right.assignee || "", "de");
    else if (filters.sort === "sprint") comparison = (data.sprints.find((item) => item.id === left.sprintId)?.name || "").localeCompare(data.sprints.find((item) => item.id === right.sprintId)?.name || "", "de");
    else if (filters.sort === "score") comparison = left.scorePoints - right.scorePoints;
    else comparison = (priorityRank[left.priority] ?? 9) - (priorityRank[right.priority] ?? 9);
    return direction * (comparison || left.order - right.order);
  });
}
