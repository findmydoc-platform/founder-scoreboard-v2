import type { Task, TaskRelation, TaskRelationType } from "@/lib/types";

export type PlanningTaskCreationInput = Pick<Task, "title" | "description" | "taskType" | "parentTaskId"> & {
  creationRequestId: string;
  ownerId: string;
  relationType?: TaskRelationType;
  relatedTaskId?: string;
  relationNote?: string;
  approveNow?: boolean;
} & Partial<Pick<Task, "githubRepo" | "priority" | "status" | "workstream" | "fixedDate" | "targetDate" | "hours" | "problemStatement" | "intendedOutcome" | "scopeConstraints" | "acceptanceCriteria" | "evidenceRequired" | "definitionOfDone" | "strategy" | "raciAssignments">>;
export type PlanningTaskCreationConfirmation = { task: Task; approvalError?: string; relation?: TaskRelation | null; relatedTask?: (Partial<Task> & { id: string }) | null };
export type PlanningTaskCreationResult = { ok: true; task: Task } | { ok: false; kind: "partiallyConfirmed"; task: Task; error: string } | { ok: false; kind: "rejected" | "unconfirmed" | "sessionSuperseded"; error: string; status?: number };
export type PlanningTaskRemovalConfirmation = { affectedTaskIds?: string[] };
export type PlanningTaskRemovalResult = { ok: true; excludedTaskIds: readonly string[] } | { ok: false; kind: "rejected" | "unconfirmed" | "sessionSuperseded"; error: string; status?: number; code?: string };
export type PlanningTaskLifecycleView = {
  id: string;
  phase: "saving" | "saved" | "rejected" | "unconfirmed" | "blocked" | "partiallyConfirmed";
  taskId: string;
  error: string;
  checkStatus: "not-checked" | "checking" | "checked" | "unavailable" | "forbidden";
} & ({ kind: "create"; submitted: Readonly<PlanningTaskCreationInput> | null } | { kind: "withdraw" | "reject"; submitted: Readonly<{ task: Task; reason: string }> | null });
