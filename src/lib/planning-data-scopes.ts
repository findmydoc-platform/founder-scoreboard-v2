import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import type { PlanningDataQueryScope } from "@/lib/planning-data-loader";

const baseWorkspaceDataScope = {
  packages: false,
  milestones: false,
  tasks: false,
  sprints: false,
  sprintCommitments: false,
  founderSprintScores: false,
  founderStrikeStates: false,
  strikeEvents: false,
  scoreObjections: false,
  taskComments: false,
  taskExternalComments: false,
  taskBlockers: false,
  taskRelations: false,
  taskActivity: false,
  taskFocusItems: false,
  notificationEvents: false,
  notificationDeliveries: false,
  notificationPreferences: false,
  profileUiPreferences: true,
  profileFeatureTourAcknowledgements: true,
  fmdTools: false,
  events: false,
  meetings: false,
  meetingAttendance: false,
  audit: false,
} satisfies PlanningDataQueryScope;

export const taskDetailPageDataScope = {
  ...baseWorkspaceDataScope,
  packages: true,
  milestones: true,
  tasks: true,
  sprints: true,
} satisfies PlanningDataQueryScope;

export const initiativeDetailPageDataScope = {
  ...baseWorkspaceDataScope,
} satisfies PlanningDataQueryScope;

export const workspaceDataScopes = {
  planning: {
    ...baseWorkspaceDataScope,
    packages: true,
    milestones: true,
    tasks: true,
    sprints: true,
    taskRelations: true,
  },
  backlog: {
    ...baseWorkspaceDataScope,
    packages: true,
    milestones: true,
    tasks: true,
    sprints: true,
    sprintCommitments: true,
  },
  "decision-log": { ...baseWorkspaceDataScope },
  events: { ...baseWorkspaceDataScope, events: true },
  sprint: {
    ...baseWorkspaceDataScope,
    packages: true,
    milestones: true,
    tasks: true,
    sprints: true,
    sprintCommitments: true,
    founderSprintScores: true,
    founderStrikeStates: true,
    strikeEvents: true,
    scoreObjections: true,
    meetings: true,
    meetingAttendance: true,
  },
  projects: {
    ...baseWorkspaceDataScope,
    packages: true,
    milestones: true,
    tasks: true,
    sprints: true,
    taskRelations: true,
  },
  tools: { ...baseWorkspaceDataScope, fmdTools: true },
  team: { ...baseWorkspaceDataScope, tasks: true },
  notifications: {
    ...baseWorkspaceDataScope,
    tasks: true,
    notificationEvents: true,
    notificationDeliveries: true,
  },
  profile: {
    ...baseWorkspaceDataScope,
    packages: true,
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
