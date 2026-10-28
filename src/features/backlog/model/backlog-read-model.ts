import type { Profile, Sprint, SprintCommitment, Task } from "@/lib/types";

export type BacklogReadCoverage = Partial<Record<"items" | "people" | "sprints" | "commitments" | "strategies" | "raci" | "links", "complete" | "partial">>;

export type BacklogModel = Readonly<{
  revision: string;
  coverage?: BacklogReadCoverage;
  items: readonly Task[];
  people: readonly Profile[];
  sprints: readonly Sprint[];
  commitments: readonly SprintCommitment[];
}>;

export type BacklogReadContext = Readonly<{
  authorized: boolean;
  actorProfileId: string | null;
}>;

export type BacklogLoadResult =
  | { status: "ready"; model: BacklogModel }
  | { status: "forbidden" }
  | { status: "unavailable" };

export interface BacklogReadModel {
  load(context: BacklogReadContext): Promise<BacklogLoadResult>;
}
