import type { Task, TaskBlocker } from "@/lib/types";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "@/features/planning/model/planning-state";
export type TaskBlockerSubmission = Readonly<{ reason: string; impact: string; needsHelpFrom: string }>;
export type TaskBlockerReportView = Readonly<{
  id: string; taskId: string; phase: "saving" | "confirmed" | "unconfirmed" | "rejected";
  submitted: TaskBlockerSubmission; blocker: TaskBlocker | null; error: string;
  taskReadStatus: PlanningReadStatus; checking: boolean; serverTask: Task | null;
}>;
export type TaskBlockerReportResult = { ok: true; blocker: TaskBlocker } | { ok: false; kind: "rejected" | "unconfirmed" | "blocked" | "ended"; error: string; status?: number };
export type TaskBlockerReportAdapter = { reportBlocker?: (taskId: string, submitted: TaskBlockerSubmission) => Promise<{ blocker: TaskBlocker }> };
export interface PlanningTaskBlockerReports {
  reportTaskBlocker(task: Task, submitted: TaskBlockerSubmission): Promise<TaskBlockerReportResult>;
  taskBlockerReports(taskId?: string): readonly TaskBlockerReportView[];
  checkTaskBlockerReport(id: string): Promise<PlanningTaskSaveCheck>;
}
