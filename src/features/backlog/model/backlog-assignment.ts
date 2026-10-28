import type { Sprint, Task, TaskActivity } from "@/lib/types";
export type BacklogAssignmentResult = { phase: "saved" | "rejected" | "conflict" | "unconfirmed" | "blocked" | "ended"; confirmedCount: number; error?: string };
export type BacklogAssignmentView = { id: string; phase: "editing" | "saving" | BacklogAssignmentResult["phase"]; tasks: readonly Task[]; targetSprint: Sprint | null; serverTasks: readonly Task[]; serverSprints: readonly Sprint[]; error: string; confirmedTaskIds: readonly string[]; canResave: boolean; checking: boolean };
export interface BacklogAssignmentEditor { view(): BacklogAssignmentView; assign(sprintId: string | null): Promise<BacklogAssignmentResult>; refreshConflict(): Promise<boolean>; resave(): Promise<BacklogAssignmentResult>; checkOutcome(): Promise<boolean>; }
export type BacklogAssignmentAdapter = { assignBacklog?: (tasks: readonly Task[], target: Sprint | null, bulk: boolean) => Promise<{ updates: Partial<Task>[]; activities?: TaskActivity[] }> };
