import { emptyPlanningHeaderData, loadPlanningHeaderData } from "./planning-header-data";
import { hasCorePlanningDataError, loadPlanningDataRows, mapPlanningDataRows, shouldLoad, type PlanningDataQueryScope } from "./planning-data-loader";
import { isOperationalLeadRole } from "./platform";
import { persistResolvedNotificationEvents } from "./notification-resolution";
import { getServerSupabase } from "./supabase";
import { allowsLocalPlanningFallback } from "./planning-data-availability";
import type { PlanningData, PlanningHeaderData, PlatformRole } from "./types";

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

export type PlanningDataResult = {
  data: PlanningData;
  headerData: PlanningHeaderData;
  source: "seed" | "supabase";
  availability: "ready" | "unavailable";
};

function planningDataFailureResult(): PlanningDataResult {
  if (allowsLocalPlanningFallback()) {
    return {
      data: emptyPlanningData,
      headerData: emptyPlanningHeaderData,
      source: "seed",
      availability: "ready",
    };
  }

  return {
    data: emptyPlanningData,
    headerData: emptyPlanningHeaderData,
    source: "supabase",
    availability: "unavailable",
  };
}

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

export async function getPlanningData(scope?: PlanningDataQueryScope, access?: PlanningDataAccessScope): Promise<PlanningDataResult> {
  const supabase = getServerSupabase();
  if (!supabase) return planningDataFailureResult();

  const rows = await loadPlanningDataRows(supabase, scope);
  if (hasCorePlanningDataError(rows)) {
    return planningDataFailureResult();
  }

  const data = filterPlanningDataForWorkspaceAccess(
    await persistResolvedNotificationEvents(supabase, mapPlanningDataRows(rows)),
    access,
  );
  const headerData = await loadPlanningHeaderData(supabase, {
    currentProfileId: access?.currentProfileId || null,
    data,
    fmdToolsLoaded: shouldLoad(scope, "fmdTools"),
    eventsLoaded: shouldLoad(scope, "events"),
    notificationEventsLoaded: shouldLoad(scope, "notificationEvents"),
  });

  return {
    source: "supabase",
    availability: "ready",
    data,
    headerData,
  };
}
