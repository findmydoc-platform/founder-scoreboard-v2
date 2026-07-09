import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import type { PlanningDataQueryScope } from "@/lib/planning-data-loader";

const baseWorkspaceDataScope = {
  sprintCommitments: false,
  founderSprintScores: false,
  founderStrikeStates: false,
  strikeEvents: false,
  scoreObjections: false,
  taskComments: false,
  taskExternalComments: false,
  taskBlockers: false,
  taskActivity: false,
  taskFocusItems: false,
  notificationDeliveries: false,
  notificationPreferences: false,
  fmdTools: false,
  events: false,
  meetings: false,
  meetingAttendance: false,
  audit: false,
} satisfies PlanningDataQueryScope;

export const taskDetailPageDataScope = {
  ...baseWorkspaceDataScope,
  taskRelations: false,
} satisfies PlanningDataQueryScope;

export const workspaceDataScopes = {
  planning: baseWorkspaceDataScope,
  backlog: {
    ...baseWorkspaceDataScope,
    sprintCommitments: true,
  },
  reviews: baseWorkspaceDataScope,
  events: { ...baseWorkspaceDataScope, events: true },
  sprint: {
    ...baseWorkspaceDataScope,
    sprintCommitments: true,
    founderSprintScores: true,
    founderStrikeStates: true,
    strikeEvents: true,
    scoreObjections: true,
    meetings: true,
    meetingAttendance: true,
  },
  projects: baseWorkspaceDataScope,
  tools: { ...baseWorkspaceDataScope, fmdTools: true },
  team: baseWorkspaceDataScope,
  notifications: {
    ...baseWorkspaceDataScope,
    notificationDeliveries: true,
  },
  "ceo-intake": baseWorkspaceDataScope,
  profile: {
    ...baseWorkspaceDataScope,
    notificationPreferences: true,
  },
} satisfies Record<AppWorkspace, PlanningDataQueryScope>;

export function getPlanningDataScopeForWorkspace(workspace: AppWorkspace): PlanningDataQueryScope {
  return workspaceDataScopes[workspace];
}

export function planningDataWorkspaceFromValue(value: string | null | undefined): AppWorkspace | null {
  if (!value) return null;
  if (value === "settings") return "notifications";
  return Object.prototype.hasOwnProperty.call(workspaceDataScopes, value) ? value as AppWorkspace : null;
}
