import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import type { PlanningDataQueryScope } from "@/lib/planning-data-loader";

export type LegacyPlanningDataWorkspace = Exclude<AppWorkspace, "backlog" | "planning" | "projects" | "events" | "tools" | "team" | "profile" | "notifications" | "sprint">;

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

export const initiativeDetailPageDataScope = {
  ...baseWorkspaceDataScope,
} satisfies PlanningDataQueryScope;

export const workspaceDataScopes = {
  "decision-log": { ...baseWorkspaceDataScope },
} satisfies Record<LegacyPlanningDataWorkspace, PlanningDataQueryScope>;

export function getPlanningDataScopeForWorkspace(workspace: LegacyPlanningDataWorkspace): PlanningDataQueryScope {
  return workspaceDataScopes[workspace];
}

export function planningDataWorkspaceFromValue(value: string | null | undefined): LegacyPlanningDataWorkspace | null {
  if (!value) return null;
  return Object.prototype.hasOwnProperty.call(workspaceDataScopes, value) ? value as LegacyPlanningDataWorkspace : null;
}
