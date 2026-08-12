import type { Profile, ProfileUiPreference, Project, Sprint, Task, TaskRelation } from "@/lib/types";

export type PlanningWorkspaceModel = Readonly<{
  revision: string;
  project: Project;
  items: readonly Task[];
  relationships: readonly TaskRelation[];
  people: readonly Profile[];
  sprints: readonly Sprint[];
  preferences: readonly ProfileUiPreference[];
}>;

export type PlanningWorkspaceLoadContext = Readonly<{
  authorized: boolean;
  actorProfileId: string | null;
}>;

export type PlanningWorkspaceLoadResult =
  | { status: "ready"; model: PlanningWorkspaceModel }
  | { status: "forbidden" }
  | { status: "unavailable" };
