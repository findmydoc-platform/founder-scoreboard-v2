import { emptyPlanningHeaderData, loadPlanningHeaderData, type PlanningHeaderSharedSlotLoaders } from "./planning-header-data";
import { hasCorePlanningDataError, loadPlanningDataRows, mapPlanningDataRows, shouldLoad, type PlanningDataQueryScope } from "./planning-data-loader";
import { isOperationalLeadRole } from "./platform";
import { reconcileNotificationEvents } from "./notification-resolution";
import { getServerSupabase } from "./supabase";
import { allowsLocalPlanningFallback } from "./planning-data-availability";
import type { PlanningData, PlanningHeaderData, PlatformRole } from "./types";

export const emptyPlanningData: PlanningData = {
  project: {
    id: "findmydoc-founder-execution",
    name: "findmydoc Planning",
    range: "Geschützter Teamzugriff",
    reviewObjectionWindowHours: 48,
    githubProjectOwner: "findmydoc-platform",
    githubProjectNumber: 21,
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
  taskReviews: [],
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

export type PlanningDataLoadOptions = {
  headerData?: "eager" | "deferred";
  sharedHeaderSlotLoaders?: PlanningHeaderSharedSlotLoaders;
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
  const currentProfileId = access.currentProfileId || "";
  return {
    ...data,
    notificationEvents: currentProfileId
      ? data.notificationEvents.filter((event) => (
        event.recipientProfileId === currentProfileId
        || !event.recipientProfileId && isOperationalLeadRole(access.platformRole!)
      ))
      : [],
    notificationDeliveries: [],
  };
}

export async function getPlanningData(
  scope?: PlanningDataQueryScope,
  access?: PlanningDataAccessScope,
  options: PlanningDataLoadOptions = {},
): Promise<PlanningDataResult> {
  const supabase = getServerSupabase();
  if (!supabase) return planningDataFailureResult();

  const notificationEventsLoaded = shouldLoad(scope, "notificationEvents");
  const shouldReconcileNotifications = options.headerData !== "deferred" || notificationEventsLoaded;
  const notificationReconciliation = shouldReconcileNotifications
    ? await reconcileNotificationEvents(supabase, {
      currentProfileId: access?.currentProfileId || null,
      platformRole: access?.platformRole || null,
    })
    : null;
  const rows = await loadPlanningDataRows(supabase, scope);
  if (hasCorePlanningDataError(rows)) {
    return planningDataFailureResult();
  }

  const data = filterPlanningDataForWorkspaceAccess(mapPlanningDataRows(rows), access);
  const headerData = options.headerData === "deferred"
    ? emptyPlanningHeaderData
    : await loadPlanningHeaderData(supabase, {
      currentProfileId: access?.currentProfileId || null,
      platformRole: access?.platformRole || null,
      data,
      notificationEventsReconciled: notificationReconciliation?.ok || false,
      fmdToolsLoaded: shouldLoad(scope, "fmdTools"),
      eventsLoaded: shouldLoad(scope, "events"),
      notificationEventsLoaded,
      sharedSlotLoaders: options.sharedHeaderSlotLoaders,
    });

  return {
    source: "supabase",
    availability: "ready",
    data,
    headerData,
  };
}
