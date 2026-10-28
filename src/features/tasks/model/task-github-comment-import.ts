import type { Task, TaskExternalComment } from "@/lib/types";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "@/features/planning/model/planning-state";
export type TaskGitHubImportReceipt = { comments: TaskExternalComment[]; commentsCoverage: "complete" | "partial"; evidenceLink: string; imported: number };
export type TaskGitHubImportView = {
 taskId: string; phase: "saving" | "confirmed" | "rejected" | "unconfirmed";
 automatic: boolean; error: string; notice: string; imported: number | null;
 taskReadStatus: PlanningReadStatus; checking: boolean;
};
export type TaskGitHubImportResult = { ok: true } | { ok: false; kind: "blocked" | "ended" | "rejected" | "unconfirmed"; error: string };
export interface TaskGitHubImportAdapter { importTaskGitHubComments?(taskId: string): Promise<TaskGitHubImportReceipt> }
export interface PlanningTaskGitHubImports {
 importTaskGitHubComments(task: Task, options?: { automatic?: boolean }): Promise<TaskGitHubImportResult>;
 taskGitHubImport(taskId: string): TaskGitHubImportView | null;
 taskGitHubComments(taskId: string): { comments: readonly TaskExternalComment[]; completeness: "complete" | "partial"; readStatus: PlanningReadStatus };
 checkTaskGitHubImport(taskId: string): Promise<PlanningTaskSaveCheck>;
}
