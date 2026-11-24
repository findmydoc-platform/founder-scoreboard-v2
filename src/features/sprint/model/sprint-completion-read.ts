import type { PlanningReadAuthority } from "@/features/planning/model/planning-server-header-read";
import type { SprintLockObservation } from "./sprint-lock";

export type SprintCompletionSource = Readonly<{
  sprintId: string;
  sourceRevision: string;
  readAuthority: PlanningReadAuthority;
  readActor: Readonly<{ profileId: string; platformRole: "ceo" }>;
}>;

export type SprintCompletionRead = SprintCompletionSource & SprintLockObservation & Readonly<{
  evaluatedAt: string;
  validUntil: string;
  reviewDueAt: string | null;
  openObjections: number;
  nextSprintId: string | null;
  decision: Readonly<{ status: "ready"; token: string } | {
    status: "blocked";
    reason: "reviewWindow" | "objections" | "alreadyLocked" | "invalidSchedule";
  }>;
}>;

export type SprintCompletionOutcome<T> = { status: "ready"; read: T }
  | { status: "forbidden" | "notFound" | "stale" | "unavailable" };
