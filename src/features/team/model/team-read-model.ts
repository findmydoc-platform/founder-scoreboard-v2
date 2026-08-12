import type { Profile, Task } from "@/lib/types";

export type TeamWorkspaceModel = Readonly<{
  revision: string;
  people: readonly Profile[];
  items: readonly Task[];
}>;

export type TeamLoadResult = { status: "ready"; model: TeamWorkspaceModel } | { status: "forbidden" } | { status: "unavailable" };

export interface TeamReadModel {
  load(context: { authorized: boolean; actorProfileId: string | null }): Promise<TeamLoadResult>;
}
