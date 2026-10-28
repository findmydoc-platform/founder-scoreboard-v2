import type { FounderSprintScore, FounderStrikeState, Meeting, MeetingAttendance, Profile, Project, ScoreObjection, Sprint, SprintCommitment, StrikeEvent, Task } from "@/lib/types";

export type SprintReadCoverage = Partial<Record<"project" | "people" | "items" | "sprints" | "commitments" | "scores" | "strikeStates" | "strikeEvents" | "objections" | "meetings" | "attendance", "complete" | "partial">>;
export type SprintWorkspaceModel = Readonly<{
  coverage?: Readonly<SprintReadCoverage>;
  revision: string;
  project: Project;
  people: readonly Profile[];
  items: readonly Task[];
  sprints: readonly Sprint[];
  commitments: readonly SprintCommitment[];
  scores: readonly FounderSprintScore[];
  strikeStates: readonly FounderStrikeState[];
  strikeEvents: readonly StrikeEvent[];
  objections: readonly ScoreObjection[];
  meetings: readonly Meeting[];
  attendance: readonly MeetingAttendance[];
}>;

export type SprintLoadResult = { status: "ready"; model: SprintWorkspaceModel } | { status: "forbidden" } | { status: "unavailable" };

export interface SprintReadModel {
  load(context: { authorized: boolean; actorProfileId: string | null }): Promise<SprintLoadResult>;
}
