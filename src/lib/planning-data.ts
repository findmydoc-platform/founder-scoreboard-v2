import { hasCorePlanningDataError, loadPlanningDataRows, mapPlanningDataRows } from "./planning-data-loader";
import { getServerSupabase } from "./supabase";
import type { PlanningData } from "./types";

export const emptyPlanningData: PlanningData = {
  project: {
    id: "findmydoc-founder-execution",
    name: "findmydoc Founder Execution",
    range: "Geschützter Teamzugriff",
  },
  profiles: [],
  packages: [],
  milestones: [],
  tasks: [],
  sprints: [],
  sprintCommitments: [],
  founderSprintScores: [],
  founderStrikeStates: [],
  strikeEvents: [],
  scoreObjections: [],
  decisions: [],
  decisionComments: [],
  taskComments: [],
  taskExternalComments: [],
  taskBlockers: [],
  taskRelations: [],
  taskActivity: [],
  taskFocusItems: [],
  decisionTaskLinks: [],
  notificationEvents: [],
  notificationDeliveries: [],
  notificationPreferences: [],
  feedbackItems: [],
  fmdTools: [],
  events: [],
  meetings: [],
  meetingAttendance: [],
  audit: [],
  availability: [],
};

export async function getPlanningData(): Promise<{ data: PlanningData; source: "seed" | "supabase" }> {
  const supabase = getServerSupabase();
  if (!supabase) return { data: emptyPlanningData, source: "seed" };

  const rows = await loadPlanningDataRows(supabase);
  if (hasCorePlanningDataError(rows)) {
    return { data: emptyPlanningData, source: "seed" };
  }

  return {
    source: "supabase",
    data: mapPlanningDataRows(rows),
  };
}
