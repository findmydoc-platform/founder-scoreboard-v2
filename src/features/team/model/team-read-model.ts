import type { Profile, Task } from "@/lib/types";

export type TeamWorkspaceModel = Readonly<{
  revision: string;
  scopeRevision?: string;
  observedAt?: string;
  readCoverage?: Readonly<Partial<Record<"people" | "items" | "strategies" | "raci" | "links", "complete" | "partial">>>;
  people: readonly Profile[];
  items: readonly Task[];
}>;

export type TeamLoadResult = { status: "ready"; model: TeamWorkspaceModel } | { status: "forbidden" } | { status: "unavailable" };

export interface TeamReadModel {
  load(context: { authorized: boolean; actorProfileId: string | null }): Promise<TeamLoadResult>;
}

export type TeamMetricsModel = Readonly<{
  revision: string;
  scopeRevision: string;
  observedAt: string;
  validUntil: null;
  coverage: "complete";
  metricsByProfileId: Readonly<Record<string, Readonly<import("./team-profile-view-model").TeamMemberStats>>>;
}>;
export type TeamMetricsLoadResult = { status: "ready"; model: TeamMetricsModel } | { status: "forbidden" | "unavailable" | "staleContinuation" };
