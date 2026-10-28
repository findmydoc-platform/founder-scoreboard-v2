import type { Sprint, Task } from "@/lib/types";
import type { SprintPlanningOptions } from "./sprint-planning-options";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "@/features/planning/model/planning-state";
export type SprintLockBasis = { sprint: Sprint; tasks: readonly Pick<Task, "id" | "title" | "updatedAt">[] };
export type SprintLockReceipt = { sprint: { id: string; status: "closed"; scoreLocked: true }; carryover?: { nextSprintId?: string; created?: number; evaluated?: number }; scoring?: { scores?: number; strikeEvents?: number; governanceReviews?: number }; replayed?: boolean };
export type SprintLockObservation = { basis: SprintLockBasis; tasksComplete: boolean; receipt: SprintLockReceipt | null };
export type SprintLockCheck = Omit<PlanningTaskSaveCheck, "outcome"> & { outcome: PlanningTaskSaveCheck["outcome"] | "confirmed" };
export type SprintLockResult = { ok: true } | { ok: false; kind: "versionConflict" | "rejected" | "unconfirmed" | "sessionSuperseded"; error: string; code?: string };
export type SprintLockView = { sprintId: string; phase: "ready" | "saving" | "locked" | "conflict" | "unconfirmed" | "rejected" | "blocked" | "ended"; submitted: SprintPlanningOptions | null; receipt: SprintLockReceipt | null; error: string; projectionRead: PlanningReadStatus; followUp: { phase: "not-started" | "creating" | "confirmed" | "failed" | "unconfirmed"; error: string }; serverBasis: SprintLockBasis | null; canRelock: boolean };
export interface SprintLockEditor { view(): SprintLockView; lock(options: SprintPlanningOptions): Promise<SprintLockResult>; prepareFollowingPlan(): Promise<boolean>; checkOutcome(): Promise<SprintLockCheck>; refreshConflict(): Promise<boolean>; relock(options: SprintPlanningOptions): Promise<SprintLockResult>; close(): void; }
