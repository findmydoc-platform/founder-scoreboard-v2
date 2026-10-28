import type { ApprovalDecisionAction, Task, TaskActivity, TaskReview, TaskReviewChecklist, ReviewDecision } from "@/lib/types";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "@/features/planning/model/planning-state";
import type { TaskUpdateResult } from "@/features/tasks/hooks/task-mutation-command-types";

export type TaskReviewDecisionInput = { decision: ReviewDecision; points: number; checklist?: TaskReviewChecklist; comment?: string };
export type TaskReviewRequestInput = Partial<Pick<Task, "reviewOwnerProfileId" | "evidenceLinks" | "reviewEvidenceExceptionNote">>;
export type TaskReviewReceipt = { task: Partial<Task>; review?: TaskReview; activities?: TaskActivity[] };
export type TaskReviewSubmission = { kind: "approval"; action: Exclude<ApprovalDecisionAction,"reject">; note: string } | { kind: "request"; input: TaskReviewRequestInput } | { kind: "decision"; input: TaskReviewDecisionInput } | { kind: "withdraw"; reason: string } | { kind: "reopen"; input: import("./review-evidence").ReviewEvidenceSubmission };
export type TaskReviewOperation = {
 id: string; taskId: string; kind: TaskReviewSubmission["kind"]; phase: "saving" | "confirmed" | "conflict" | "rejected" | "unconfirmed" | "blocked";
 submitted: Readonly<{ task: Task; command: TaskReviewSubmission }> | null;
 error: string; checking: boolean; readStatus: PlanningReadStatus; serverTask: Task | null;
};
export type TaskReviewAdapter = {
 decideTaskApproval?: (task:Task, action:Exclude<ApprovalDecisionAction,"reject">, note:string)=>Promise<TaskReviewReceipt>;
 requestTaskReview?: (task:Task,input:TaskReviewRequestInput)=>Promise<TaskReviewReceipt>;
 decideTaskReview?: (task:Task,input:TaskReviewDecisionInput)=>Promise<TaskReviewReceipt>;
 withdrawTaskReview?: (task:Task,reason:string)=>Promise<TaskReviewReceipt>;
 reopenTaskReview?: (task:Task,input:import("./review-evidence").ReviewEvidenceSubmission)=>Promise<TaskReviewReceipt>;
};
export interface PlanningTaskReviews {
 decideTaskApproval(task:Task,action:Exclude<ApprovalDecisionAction,"reject">,note?:string):Promise<TaskUpdateResult>;
 requestTaskReview(task:Task,input?:TaskReviewRequestInput):Promise<TaskUpdateResult>;
 decideTaskReview(task:Task,input:TaskReviewDecisionInput):Promise<TaskUpdateResult>;
 withdrawTaskReview(task:Task,reason:string):Promise<TaskUpdateResult>;
 reopenTaskReview(task:Task,input?:import("./review-evidence").ReviewEvidenceSubmission):Promise<TaskUpdateResult>;
 taskReviewOperations(taskId?:string):readonly TaskReviewOperation[];
 checkTaskReview(id:string):Promise<PlanningTaskSaveCheck>;
}
