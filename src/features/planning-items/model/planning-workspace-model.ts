import type { Profile, ProfileUiPreference, Project, Sprint, Task, TaskRelation } from "@/lib/types";

export type PlanningWorkspaceReadCoverage = Partial<Record<"items" | "people" | "strategies" | "raci" | "links" | "sprints" | "relationships" | "preferences" | "blockers", "complete" | "partial">>;

export type PlanningWorkspaceModel = Readonly<{
  revision: string;
  query?: import("@/features/planning/model/planning-board-query").PlanningBoardQuery;
  board?: import("@/features/planning/model/planning-board-query").PlanningBoardResult;
  coverage?: PlanningWorkspaceReadCoverage;
  project: Project;
  items: readonly Task[];
  relationships: readonly TaskRelation[];
  blockers?: readonly import("@/lib/types").TaskBlocker[];
  people: readonly Profile[];
  sprints: readonly Sprint[];
  preferences: readonly ProfileUiPreference[];
}>;

export type PlanningWorkspaceLoadContext = Readonly<{
  authorized: boolean;
  actorProfileId: string | null;
  authorityKey?: string;
  query?: import("@/features/planning/model/planning-board-query").PlanningBoardQueryInput;
}>;

export type PlanningWorkspaceLoadResult =
  | { status: "ready"; model: PlanningWorkspaceModel }
  | { status: "forbidden" }
  | { status: "unavailable" }
  | { status: "staleContinuation" };
