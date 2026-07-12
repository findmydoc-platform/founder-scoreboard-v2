import type { buildSprintScoreViewModel } from "@/features/sprint/model/sprint-score-view-model";

export type SprintScoreRow = ReturnType<typeof buildSprintScoreViewModel>["scoreRows"][number];
export type SprintScoreAttentionFilter = "all" | "unfulfilled" | "away" | "strike" | "open";
export type SprintScoreSort = "name" | "score" | "hours" | "open" | "strike";

export type SprintScoreTableFilters = {
  query: string;
  role: string;
  commitment: string;
  attention: SprintScoreAttentionFilter;
  sort: SprintScoreSort;
  direction: "asc" | "desc";
};

export const DEFAULT_SPRINT_SCORE_FILTERS: SprintScoreTableFilters = {
  query: "",
  role: "all",
  commitment: "all",
  attention: "all",
  sort: "name",
  direction: "asc",
};

function matchesAttention(row: SprintScoreRow, attention: SprintScoreAttentionFilter) {
  if (attention === "all") return true;
  if (attention === "unfulfilled") return row.committed > 0 && !row.v21Score.fulfilled && !row.v21Score.awayNeutral;
  if (attention === "away") return row.v21Score.awayNeutral;
  if (attention === "strike") return (row.strikeState?.strikeLevel || 0) > 0;
  return row.openScore > 0 || row.openScoreObjections > 0;
}

export function buildSprintScoreTableViewModel(rows: SprintScoreRow[], filters: SprintScoreTableFilters) {
  const query = filters.query.trim().toLocaleLowerCase("de");
  const direction = filters.direction === "desc" ? -1 : 1;
  const visibleRows = rows
    .filter((row) => !query || [row.profile.name, row.profile.platformRole, row.commitment.commitmentLevel].join(" ").toLocaleLowerCase("de").includes(query))
    .filter((row) => filters.role === "all" || row.profile.platformRole === filters.role)
    .filter((row) => filters.commitment === "all" || row.commitment.commitmentLevel === filters.commitment)
    .filter((row) => matchesAttention(row, filters.attention))
    .sort((left, right) => {
      let comparison = 0;
      if (filters.sort === "score") comparison = left.v21Score.totalPoints - right.v21Score.totalPoints;
      else if (filters.sort === "hours") comparison = left.hours - right.hours;
      else if (filters.sort === "open") comparison = left.openScore + left.openScoreObjections - right.openScore - right.openScoreObjections;
      else if (filters.sort === "strike") comparison = (left.strikeState?.strikeLevel || 0) - (right.strikeState?.strikeLevel || 0);
      else comparison = left.profile.name.localeCompare(right.profile.name, "de");
      return direction * (comparison || left.profile.name.localeCompare(right.profile.name, "de"));
    });

  return { visibleRows, totalCount: rows.length };
}
