import type { PlanningShellState } from "@/lib/types";
import type { AppWorkspace } from "../workspace-routes";

export type PlanningReadCoverage = Partial<Record<keyof PlanningShellState, "complete" | "partial">>;
export function workspaceReadCoverage(workspace: AppWorkspace): PlanningReadCoverage {
  switch (workspace) {
    case "planning": case "projects": return { project: "complete", profiles: "complete", tasks: "complete", sprints: "partial", taskRelations: "partial", profileUiPreferences: "complete" };
    case "sprint": return { project: "complete", profiles: "partial", tasks: "partial", sprints: "partial", sprintCommitments: "partial", founderSprintScores: "partial", founderStrikeStates: "partial", strikeEvents: "partial", scoreObjections: "partial", meetings: "partial", meetingAttendance: "partial" };
    case "events": return { profiles: "complete", events: "complete" };
    case "tools": return { profiles: "complete", fmdTools: "complete" };
    case "team": return { profiles: "complete", tasks: "partial" };
    case "profile": return { project: "complete", profiles: "complete", tasks: "partial", notificationPreferences: "partial", profileUiPreferences: "partial" };
    case "notifications": return { profiles: "complete", tasks: "partial", notificationEvents: "complete", notificationDeliveries: "complete" };
    default: return {};
  }
}
export function projectCoveredRead(current: PlanningShellState, incoming: PlanningShellState, coverage: PlanningReadCoverage): PlanningShellState {
  const next = { ...current };
  for (const key of Object.keys(coverage) as (keyof PlanningShellState)[]) {
    const before = current[key];
    const after = incoming[key];
    if (coverage[key] === "partial" && Array.isArray(before) && Array.isArray(after)) {
      const identity = (item: unknown) => key === "profileUiPreferences" ? (item as { profileId: string }).profileId : (item as { id: string | number }).id;
      const replacements = new Map((after as unknown[]).map(item => [identity(item), item]));
      const known = new Set((before as unknown[]).map(identity));
      Object.assign(next, { [key]: [...(before as unknown[]).map(item => replacements.get(identity(item)) || item), ...(after as unknown[]).filter(item => !known.has(identity(item)))] });
    } else Object.assign(next, { [key]: after });
  }
  return next;
}
