import { hasCorePlanningDataError, loadPlanningDataRows, mapPlanningDataRows, type PlanningDataQueryScope } from "./planning-data-loader";
import { isOperationalLeadRole } from "./platform";
import { getServerSupabase } from "./supabase";
import type { PlanningData, PlatformRole } from "./types";

export const emptyPlanningData: PlanningData = {
  project: {
    id: "findmydoc-founder-execution",
    name: "findmydoc Planning",
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
  taskComments: [],
  taskExternalComments: [],
  taskBlockers: [],
  taskRelations: [],
  taskActivity: [],
  taskFocusItems: [],
  notificationEvents: [],
  notificationDeliveries: [],
  notificationPreferences: [],
  profileUiPreferences: [],
  profileFeatureTourAcknowledgements: [],
  fmdTools: [],
  events: [],
  meetings: [],
  meetingAttendance: [],
  audit: [],
};

export type PlanningDataAccessScope = {
  workspace?: string | null;
  currentProfileId?: string | null;
  platformRole?: PlatformRole | null;
};

export function filterPlanningDataForWorkspaceAccess(data: PlanningData, access?: PlanningDataAccessScope): PlanningData {
  if (!access?.platformRole) return data;
  if (isOperationalLeadRole(access.platformRole)) return data;

  const currentProfileId = access.currentProfileId || "";
  return {
    ...data,
    notificationEvents: currentProfileId
      ? data.notificationEvents.filter((event) => event.recipientProfileId === currentProfileId)
      : [],
    notificationDeliveries: [],
  };
}

export async function getPlanningData(scope?: PlanningDataQueryScope, access?: PlanningDataAccessScope): Promise<{ data: PlanningData; source: "seed" | "supabase" }> {
  const supabase = getServerSupabase();
  if (!supabase) return { data: emptyPlanningData, source: "seed" };

  const rows = await loadPlanningDataRows(supabase, scope);
  if (hasCorePlanningDataError(rows)) {
    return { data: emptyPlanningData, source: "seed" };
  }

  return {
    source: "supabase",
    data: filterPlanningDataForWorkspaceAccess(mapPlanningDataRows(rows), access),
  };
}
